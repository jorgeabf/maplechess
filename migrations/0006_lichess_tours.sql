-- Retransmisiones oficiales de lichess revisadas por la sincronización de
-- lichess (src/ingest/lichess/sync.ts). Guarda qué se decidió de cada una
-- para no volver a pedirla cada día:
--   sin_espanoles: no hay partidas con jugadas de ningún jugador español.
--   duplicado:     es un torneo de info64 que ya tiene partidas, o sus partidas
--                  ya están en otros torneos.
--   enlazado:      es un torneo de info64 sin partidas. La sincronización de
--                  info64 la trata como si info64 la enlazara.
--   propio:        no está en info64; sus partidas van a un torneo con
--                  source 'lichess'.
CREATE TABLE lichess_tours (
	tour_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	-- Página de la retransmisión; NULL si se descartó sin pedirla (sin españoles).
	url TEXT,
	status TEXT NOT NULL CHECK (status IN ('sin_espanoles', 'duplicado', 'enlazado', 'propio')),
	-- Torneo de info64 (duplicado, enlazado) o propio. NULL en sin_espanoles.
	tournament_id INTEGER REFERENCES tournaments (id) ON DELETE SET NULL,
	-- Jugadores españoles con partidas en la retransmisión.
	esp_players INTEGER NOT NULL DEFAULT 0,
	-- Todas sus rondas han terminado: no se vuelve a leer.
	finished INTEGER NOT NULL DEFAULT 0,
	checked_at TEXT NOT NULL
);

CREATE INDEX lichess_tours_tournament ON lichess_tours (tournament_id) WHERE tournament_id IS NOT NULL;
