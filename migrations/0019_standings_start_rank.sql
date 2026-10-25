-- El puesto y los puntos de cada torneo en la ficha del jugador
-- (getPlayerTournaments). La clave de standings va por (tournament_id, pos,
-- start_rank), así que sin estos índices cada torneo recorría su
-- clasificación entera.
--
-- En los individuales, su fila por su número inicial, el de participations.
-- Único: cada número sale una vez en la clasificación (en los de equipos, el
-- del equipo), y así SQLite lee una entrada y no dos. Además, con uno no
-- único, que no lleva los puntos, el planificador prefería recorrer la clave
-- (sin estadísticas, en una siembra de 3.000 torneos: 18.497 filas en vez de
-- 1.357). Como la tabla es WITHOUT ROWID, cada entrada lleva también el
-- puesto. replaceStandings
-- inserta con ON CONFLICT DO NOTHING, que también vale para este índice: si
-- por un error la fuente repitiera un número, se quedaría la primera fila y
-- la otra no se guardaría, sin aviso. El 25-oct-2026 no había ninguno.
CREATE UNIQUE INDEX standings_start_rank ON standings (tournament_id, start_rank);

-- En los de equipos, participations no guarda el número del equipo: la fila
-- de su equipo se busca por el nombre, como las plantillas de la página del
-- torneo. Sólo las filas de equipos, que son las que tienen nombre (9.606 de
-- 394.894 el 25-oct-2026). No es único: nada impide dos equipos con el mismo
-- nombre.
CREATE INDEX standings_team_name ON standings (tournament_id, name) WHERE name IS NOT NULL;
