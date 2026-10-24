-- Cuántas de las partidas guardadas del torneo son de lichess, según sus
-- cabeceras (lichessUrl en src/lib/licenses.ts). Con alguna, la página del
-- torneo cita lichess y la licencia CC BY-SA 4.0 sin leer los PGN, también en
-- los de info64 cuyas partidas son una exportación de lichess (el CE Absoluto
-- 2025). Un recuento y no una marca: así dice si lo son todas o cuántas. La
-- escribe saveGames, con games_count; lo ya guardado lo rellena la pasada
-- completa de GAMES_REPROCESS.
ALTER TABLE tournaments ADD COLUMN lichess_games INTEGER NOT NULL DEFAULT 0;
