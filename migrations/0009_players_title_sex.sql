-- Filtros de título y de sexo de /jugadores, en el orden de la lista
-- (PLAYER_ORDER: rating_std DESC, name y, al final de cada entrada, el
-- fide_id): se recorren sólo las entradas de ese título o sexo, desde arriba,
-- así que el listado para en cuanto llena la página y el recuento cuenta sólo
-- las suyas. Sin ellos, el recuento recorría la tabla entera:
-- /jugadores?titulo=GM leía 103.538 filas para 60 jugadores.
--
-- El de título, sólo con quien tiene alguno: unos 1.000 de 98.000.
CREATE INDEX players_title ON players (title, rating_std DESC, name) WHERE title IS NOT NULL;
CREATE INDEX players_sex ON players (sex, rating_std DESC, name);
