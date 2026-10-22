-- Ranking de /jugadores: los primeros por ELO estándar y los que más suben
-- respecto a la lista FIDE anterior.
--
-- rating_std_prev es el ELO estándar del jugador en la lista anterior, y
-- rating_list, la lista de la que sale su ELO actual (el Last-Modified del
-- fichero). La importación sólo pasa rating_std a rating_std_prev cuando la
-- lista cambia: así un reintento del paso, o un force con el mismo fichero, no
-- lo pisa. Es NULL hasta la primera lista importada tras esta migración, y en
-- quien aparece por primera vez.
ALTER TABLE players ADD COLUMN rating_std_prev INTEGER;
ALTER TABLE players ADD COLUMN rating_list TEXT;

-- Ranking y búsquedas por ELO, en el orden de /jugadores (PLAYER_ORDER): con
-- LIMIT se recorre desde arriba y se para en cuanto hay bastantes, sin ordenar
-- la tabla entera. Los NULL quedan al final.
CREATE INDEX players_rating_std ON players (rating_std DESC, name);

-- Los que más suben. La consulta tiene que repetir la expresión tal cual.
CREATE INDEX players_rating_gain ON players ((rating_std - rating_std_prev) DESC, name);
