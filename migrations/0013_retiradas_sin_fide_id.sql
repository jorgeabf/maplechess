-- retiradas, con su propio id y el FIDE ID aparte y opcional. En la 0010,
-- fide_id era la clave primaria (INTEGER PRIMARY KEY, el rowid de SQLite):
-- al apuntar con NULL a alguien sin FIDE ID, SQLite le daba el mayor de la
-- tabla más uno, que puede ser el FIDE ID de otra persona, y se retiraba a
-- ésa. Ahora quien no tiene FIDE ID va con fide_id NULL y se le reconoce por
-- el nombre (isRetired).
--
-- SQLite no cambia la clave primaria de una tabla: se rehace. El Worker
-- anterior sigue funcionando con ella, porque lee las mismas columnas. Si a
-- alguien se le apuntó con un número negativo (lo que pedía la guía de
-- operación mientras tanto), pasa a NULL.
CREATE TABLE retiradas_nueva (
	id INTEGER PRIMARY KEY,
	fide_id INTEGER UNIQUE,
	nombre TEXT NOT NULL,
	creada TEXT NOT NULL
);

INSERT INTO retiradas_nueva (fide_id, nombre, creada)
SELECT CASE WHEN fide_id > 0 THEN fide_id END, nombre, creada FROM retiradas;

DROP TABLE retiradas;

ALTER TABLE retiradas_nueva RENAME TO retiradas;
