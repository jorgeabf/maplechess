-- Torneos cuya participación revela un dato de salud (art. 9 RGPD): los de la
-- ONCE, los de sordos de la FEDS, los de ajedrez inclusivo… No se guardan: la
-- ingesta se los salta, y GAMES_REPROCESS ({"sensibles":true}) borra los que
-- ya estaban, con sus partidas, participantes, emparejamientos y clasificación
-- (en cascada). Anonimizar a sus jugadores no bastaba: con el ELO, la ronda y
-- la mesa, la página de la fuente dice quién es cada uno.
--
-- Se decide a mano (ver CLAUDE.md, «Torneos sensibles»). La ingesta y el
-- reprocesado apuntan, sin decidir, los que lo parecen por el nombre, y
-- /api/estado da la alarma mientras quede alguno por revisar. `excluido`:
--   NULL  por revisar;
--   1     revela un dato de salud: no se guarda;
--   0     revisado: se guarda como los demás.
--
-- `source` y `source_key` son los de tournaments: en info64, el slug («team/»
-- delante en los de equipos); en lichess, el id de la retransmisión.
CREATE TABLE torneos_sensibles (
	source TEXT NOT NULL,
	source_key TEXT NOT NULL,
	nombre TEXT NOT NULL,
	excluido INTEGER CHECK (excluido IN (0, 1)),
	creado TEXT NOT NULL,
	PRIMARY KEY (source, source_key)
) WITHOUT ROWID;
