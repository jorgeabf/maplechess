-- Jugadores que han pedido que no se vea su sexo o su año de nacimiento
-- (oposición, art. 21 RGPD). La FIDE los publica y la lista los trae, así que
-- la importación los aplica al escribir cada jugador: el sexo se guarda NULL y
-- el año, tal cual pero marcado en birth_year_hidden. El año de homónimo del
-- nombre («…, Nombre 1980») se quita de todo nombre que se guarda, como el de
-- los menores. GAMES_REPROCESS aplica la tabla a lo ya guardado. Se rellena a
-- mano (ver CLAUDE.md, «Ocultar el sexo o el año»).
CREATE TABLE ocultaciones (
	id INTEGER PRIMARY KEY,
	-- La petición en el registro de la guía de operación (P-AAAA-NNN).
	peticion TEXT NOT NULL,
	fide_id INTEGER NOT NULL,
	campo TEXT NOT NULL CHECK (campo IN ('sexo', 'anio')),
	creada TEXT NOT NULL,
	-- Es también el índice con el que la importación busca a cada jugador.
	UNIQUE (fide_id, campo)
);

-- El año oculto se queda en birth_year: hace falta para saber si puede ser
-- menor (mayBeMinor, el sitemap, el dossier), y sin año contaría como adulto.
-- Con 1 no sale en ninguna página ni entra en los rankings por edad.
ALTER TABLE players ADD COLUMN birth_year_hidden INTEGER NOT NULL DEFAULT 0;
