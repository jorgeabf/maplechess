-- Jugadores que han pedido no salir de ejemplo en la portada (oposición
-- parcial, art. 21 RGPD): su ficha, su dossier y lo demás se quedan. El
-- ejemplo (src/ingest/ejemplo.ts) pasa al siguiente del ranking, y la portada
-- deja de enseñar el guardado en cuanto está aquí (getExample). Se rellena a
-- mano, como ocultaciones; luego, el reprocesado {"ejemplo":true}.
CREATE TABLE portada_excluidos (
	fide_id INTEGER PRIMARY KEY,
	-- La petición en el registro de la guía de operación (P-AAAA-NNN).
	peticion TEXT NOT NULL,
	creada TEXT NOT NULL
);
