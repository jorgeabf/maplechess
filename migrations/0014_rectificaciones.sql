-- Rectificaciones y limitaciones (arts. 16 y 18 RGPD): un dato de una persona
-- en un torneo que está mal, o que deja de mostrarse mientras se comprueba. La
-- ingesta las aplica al escribir participantes y partidas (los emparejamientos
-- los toman de los participantes), después de quitar el año de los menores y
-- antes de la retirada, así que las siguientes lecturas de la fuente las
-- respetan. Se rellena a mano (ver CLAUDE.md, «Rectificación y limitación»).
--
-- Quién: el torneo, por su clave natural (la de tournaments: su id cambia si
-- se borra y se vuelve a crear), y la persona tal como la lee la ingesta de la
-- fuente, antes de rectificar: su FIDE ID, su nombre o los dos. Con ronda,
-- sólo su partida de esa ronda; sin ella, todo el torneo. Ni el id de la
-- partida ni su mesa sirven: cambian entre lecturas.
--
-- Qué: `campo` y su `valor` nuevo. NULL lo deja vacío (desvincular el FIDE ID,
-- quitar el ELO o el título); 'oculta' no guarda la partida.
--
-- `aplicada`: cuándo la aplicó la última escritura que podía hacerlo. NULL si
-- aún no se ha aplicado o si esa escritura no encontró a la persona (la fuente
-- ha cambiado): /api/estado da la alarma.
CREATE TABLE rectificaciones (
	id INTEGER PRIMARY KEY,
	-- La petición en el registro de la guía de operación (P-AAAA-NNN).
	peticion TEXT NOT NULL,
	source TEXT NOT NULL,
	source_key TEXT NOT NULL,
	fide_id INTEGER,
	nombre TEXT,
	ronda INTEGER,
	campo TEXT NOT NULL CHECK (campo IN ('fide_id', 'nombre', 'titulo', 'elo', 'resultado', 'oculta')),
	valor TEXT,
	creada TEXT NOT NULL,
	aplicada TEXT,
	CHECK (fide_id IS NOT NULL OR nombre IS NOT NULL),
	CHECK (ronda IS NOT NULL OR campo NOT IN ('resultado', 'oculta')),
	CHECK (CASE campo
		WHEN 'fide_id' THEN valor IS NULL OR (valor <> '' AND valor NOT GLOB '*[^0-9]*')
		WHEN 'elo' THEN valor IS NULL OR valor GLOB '[1-3][0-9][0-9][0-9]'
		WHEN 'titulo' THEN valor IS NULL OR valor IN ('GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM')
		WHEN 'nombre' THEN valor IS NOT NULL AND trim(valor) <> ''
		WHEN 'resultado' THEN valor IS NOT NULL AND valor IN ('1-0', '0-1', '1/2-1/2')
		WHEN 'oculta' THEN valor IS NULL
	END)
);

-- Un valor por dato y persona: para cambiarlo, UPDATE. Es también el índice con
-- el que la ingesta lee las de un torneo.
CREATE UNIQUE INDEX rectificaciones_dato ON rectificaciones
	(source, source_key, ifnull(fide_id, 0), ifnull(nombre, ''), ifnull(ronda, -1), campo);
