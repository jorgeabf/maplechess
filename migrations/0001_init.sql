-- Esquema inicial.
--
-- Las tablas *_fts son índices FTS5 de "contenido externo": no duplican el
-- texto, lo leen de su tabla base y se mantienen con triggers. El tokenizer
-- unicode61 con remove_diacritics 2 hace que "anton" encuentre "Antón".
-- Los triggers de UPDATE llevan WHEN: los upsert reescriben el nombre aunque
-- no cambie, y sin la condición se reindexaría todo en cada sincronización.

-- Jugadores españoles de la lista FIDE. El FIDE ID es la identidad canónica.
CREATE TABLE players (
	fide_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	sex TEXT,
	title TEXT,
	birth_year INTEGER,
	rating_std INTEGER,
	rating_rapid INTEGER,
	rating_blitz INTEGER,
	inactive INTEGER NOT NULL DEFAULT 0,
	-- Última importación de la lista FIDE en la que apareció como ESP.
	seen_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE players_fts USING fts5(
	name,
	content = 'players',
	content_rowid = 'fide_id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER players_ai AFTER INSERT ON players BEGIN
	INSERT INTO players_fts (rowid, name) VALUES (new.fide_id, new.name);
END;
CREATE TRIGGER players_ad AFTER DELETE ON players BEGIN
	INSERT INTO players_fts (players_fts, rowid, name) VALUES ('delete', old.fide_id, old.name);
END;
CREATE TRIGGER players_au AFTER UPDATE OF name ON players WHEN old.name IS NOT new.name BEGIN
	INSERT INTO players_fts (players_fts, rowid, name) VALUES ('delete', old.fide_id, old.name);
	INSERT INTO players_fts (rowid, name) VALUES (new.fide_id, new.name);
END;

-- Torneos de cualquier fuente; (source, source_key) es la clave natural.
CREATE TABLE tournaments (
	id INTEGER PRIMARY KEY,
	source TEXT NOT NULL,
	source_key TEXT NOT NULL,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('individual', 'team')),
	city TEXT,
	start_date TEXT,
	end_date TEXT,
	time_control TEXT,
	url TEXT NOT NULL,
	games_count INTEGER NOT NULL DEFAULT 0,
	-- De dónde salen sus partidas: la propia fuente del torneo o, si ésta no
	-- las publica, la retransmisión que enlaza ('lichess'). NULL sin partidas.
	games_source TEXT,
	games_source_url TEXT,
	-- Última lectura de la página principal (participantes).
	synced_at TEXT,
	-- Última comprobación de la página de partidas.
	games_checked_at TEXT,
	UNIQUE (source, source_key)
);

CREATE INDEX tournaments_end_date ON tournaments (end_date);
-- Listados por fecha (más recientes primero): recorriendo este índice hacia
-- atrás sale el orden (start_date DESC, id DESC) sin ordenar toda la tabla,
-- porque cada entrada lleva también el rowid (= id).
CREATE INDEX tournaments_start_date ON tournaments (start_date);

CREATE VIRTUAL TABLE tournaments_fts USING fts5(
	name,
	content = 'tournaments',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER tournaments_ai AFTER INSERT ON tournaments BEGIN
	INSERT INTO tournaments_fts (rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER tournaments_ad AFTER DELETE ON tournaments BEGIN
	INSERT INTO tournaments_fts (tournaments_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;
CREATE TRIGGER tournaments_au AFTER UPDATE OF name ON tournaments WHEN old.name IS NOT new.name BEGIN
	INSERT INTO tournaments_fts (tournaments_fts, rowid, name) VALUES ('delete', old.id, old.name);
	INSERT INTO tournaments_fts (rowid, name) VALUES (new.id, new.name);
END;

-- Participantes de cada torneo. En los individuales, start_rank es el número
-- del ranking inicial y team va vacío; en los torneos por equipos, team es el
-- equipo y start_rank el tablero dentro de él (se repite entre equipos). El
-- rating es el de ese torneo; fide_id es NULL para quien no lo tiene.
CREATE TABLE participations (
	tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
	team TEXT NOT NULL DEFAULT '',
	start_rank INTEGER NOT NULL,
	name TEXT NOT NULL,
	name_norm TEXT NOT NULL,
	fide_id INTEGER,
	title TEXT,
	fed TEXT,
	rating INTEGER,
	PRIMARY KEY (tournament_id, team, start_rank)
) WITHOUT ROWID;

CREATE INDEX participations_fide_id ON participations (fide_id) WHERE fide_id IS NOT NULL;

-- Partidas. (round, board, seq) identifica la partida dentro del torneo para
-- que cada resubida haga upsert y los id (y por tanto las URLs) se mantengan;
-- seq sólo pasa de 0 si la fuente repite ronda.tablero (p. ej. desempates).
-- seen_at marca la última sincronización en la que apareció: lo que no se
-- vuelve a ver se borra.
CREATE TABLE games (
	id INTEGER PRIMARY KEY,
	tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
	round INTEGER NOT NULL,
	board INTEGER NOT NULL,
	seq INTEGER NOT NULL DEFAULT 0,
	date TEXT,
	white_name TEXT NOT NULL,
	black_name TEXT NOT NULL,
	white_fide_id INTEGER,
	black_fide_id INTEGER,
	white_elo INTEGER,
	black_elo INTEGER,
	result TEXT NOT NULL,
	eco TEXT,
	opening TEXT,
	ply_count INTEGER NOT NULL,
	pgn TEXT NOT NULL,
	seen_at TEXT NOT NULL,
	UNIQUE (tournament_id, round, board, seq)
);

CREATE INDEX games_white ON games (white_fide_id, date) WHERE white_fide_id IS NOT NULL;
CREATE INDEX games_black ON games (black_fide_id, date) WHERE black_fide_id IS NOT NULL;
CREATE INDEX games_eco ON games (eco);
CREATE INDEX games_date ON games (date);

CREATE VIRTUAL TABLE games_fts USING fts5(
	white_name,
	black_name,
	content = 'games',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER games_ai AFTER INSERT ON games BEGIN
	INSERT INTO games_fts (rowid, white_name, black_name) VALUES (new.id, new.white_name, new.black_name);
END;
CREATE TRIGGER games_ad AFTER DELETE ON games BEGIN
	INSERT INTO games_fts (games_fts, rowid, white_name, black_name)
		VALUES ('delete', old.id, old.white_name, old.black_name);
END;
CREATE TRIGGER games_au AFTER UPDATE OF white_name, black_name ON games
	WHEN old.white_name IS NOT new.white_name OR old.black_name IS NOT new.black_name
BEGIN
	INSERT INTO games_fts (games_fts, rowid, white_name, black_name)
		VALUES ('delete', old.id, old.white_name, old.black_name);
	INSERT INTO games_fts (rowid, white_name, black_name) VALUES (new.id, new.white_name, new.black_name);
END;

-- Estado de las sincronizaciones (p. ej. Last-Modified de la lista FIDE).
CREATE TABLE sync_state (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- Totales de la portada. Contarlos en cada visita recorrería las tablas
-- enteras (D1 cobra por fila leída); se recalculan al terminar cada
-- sincronización. Una sola fila (id = 1).
CREATE TABLE site_totals (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	players INTEGER NOT NULL,
	games INTEGER NOT NULL,
	tournaments INTEGER NOT NULL,
	updated_at TEXT NOT NULL
);
