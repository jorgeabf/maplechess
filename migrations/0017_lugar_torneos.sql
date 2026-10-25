-- Dónde se juega cada torneo: los códigos del INE de su provincia y de su
-- comunidad, sacados de su ciudad o, si ésta no lo dice, de su nombre
-- (tournamentPlace en src/lib/lugares.ts). Sin provincia si sólo se sabe la
-- comunidad («Extremadura»); sin las dos, si no se sabe o se juega fuera. Los
-- escribe upsertTournament; lo ya guardado lo rellena el reprocesado
-- {"lugares":true}.
ALTER TABLE tournaments ADD COLUMN provincia TEXT;
ALTER TABLE tournaments ADD COLUMN comunidad TEXT;

-- Buscar un sitio en /torneos, en el orden del listado: como
-- tournaments_type_start_date, cada entrada lleva el rowid (= id), así que sale
-- (start_date, id) sin ordenar y el recuento cuenta sólo los de ese sitio. Una
-- comunidad va por su índice y no por sus provincias: con IN habría que leer y
-- ordenar todas. Sólo los torneos con sitio.
CREATE INDEX tournaments_provincia_start_date ON tournaments (provincia, start_date) WHERE provincia IS NOT NULL;
CREATE INDEX tournaments_comunidad_start_date ON tournaments (comunidad, start_date) WHERE comunidad IS NOT NULL;

-- La ciudad entra en el índice de búsqueda: «Gijón» encuentra los torneos que
-- se juegan allí, aunque su nombre no lo diga. Un FTS5 no admite añadir
-- columnas, así que se rehace con sus triggers.
DROP TRIGGER tournaments_ai;
DROP TRIGGER tournaments_ad;
DROP TRIGGER tournaments_au;
DROP TABLE tournaments_fts;

CREATE VIRTUAL TABLE tournaments_fts USING fts5(
	name,
	city,
	content = 'tournaments',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO tournaments_fts (tournaments_fts) VALUES ('rebuild');

CREATE TRIGGER tournaments_ai AFTER INSERT ON tournaments BEGIN
	INSERT INTO tournaments_fts (rowid, name, city) VALUES (new.id, new.name, new.city);
END;
CREATE TRIGGER tournaments_ad AFTER DELETE ON tournaments BEGIN
	INSERT INTO tournaments_fts (tournaments_fts, rowid, name, city) VALUES ('delete', old.id, old.name, old.city);
END;
CREATE TRIGGER tournaments_au AFTER UPDATE OF name, city ON tournaments
	WHEN old.name IS NOT new.name OR old.city IS NOT new.city BEGIN
	INSERT INTO tournaments_fts (tournaments_fts, rowid, name, city) VALUES ('delete', old.id, old.name, old.city);
	INSERT INTO tournaments_fts (rowid, name, city) VALUES (new.id, new.name, new.city);
END;
