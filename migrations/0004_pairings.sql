-- Emparejamientos de la próxima ronda de los torneos individuales, que la
-- fuente publica antes de jugarla. Sólo se guarda una ronda por torneo: cada
-- lectura la sustituye entera. Las páginas muestran sólo las rondas que aún no
-- han empezado; las ya jugadas se borran al final de cada sincronización.
--
-- Los jugadores se identifican por su número del ranking inicial, cruzado con
-- participations al guardar. starts_at es la fecha y hora de la ronda en hora
-- local de España, como la publica la fuente ('YYYY-MM-DD HH:MM').
CREATE TABLE pairings (
	tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
	round INTEGER NOT NULL,
	board INTEGER NOT NULL,
	starts_at TEXT,
	white_rank INTEGER NOT NULL,
	white_name TEXT NOT NULL,
	white_title TEXT,
	white_fide_id INTEGER,
	white_rating INTEGER,
	black_rank INTEGER NOT NULL,
	black_name TEXT NOT NULL,
	black_title TEXT,
	black_fide_id INTEGER,
	black_rating INTEGER,
	PRIMARY KEY (tournament_id, board)
) WITHOUT ROWID;

CREATE INDEX pairings_white ON pairings (white_fide_id) WHERE white_fide_id IS NOT NULL;
CREATE INDEX pairings_black ON pairings (black_fide_id) WHERE black_fide_id IS NOT NULL;
