-- Personas que han pedido que se las retire (/acerca). La ingesta las anonimiza
-- al escribir: en participantes, partidas (columnas y cabeceras del PGN) y
-- emparejamientos su nombre pasa a «Jugador retirado», sin FIDE ID ni título,
-- y la lista FIDE no las importa, así que no tienen ficha. Las partidas de sus
-- rivales se conservan. GAMES_REPROCESS aplica la lista a lo ya guardado.
--
-- `nombre` es el de la fuente («Apellidos, Nombre»): anonimiza también las
-- partidas en las que la fuente no da su FIDE ID ni casa con un participante.
-- Se rellena a mano (ver CLAUDE.md, «Retirada de datos»).
CREATE TABLE retiradas (
	fide_id INTEGER PRIMARY KEY,
	nombre TEXT NOT NULL,
	creada TEXT NOT NULL
);
