-- Clasificación de cada torneo tal como la publica la fuente (en info64,
-- /{slug}/standings): una fila por jugador o, en los torneos por equipos, por
-- equipo. Cada lectura la sustituye entera; una sin puntos (vacía, o de un
-- torneo aún sin resultados) no borra la guardada.
--
-- En los individuales el jugador no se repite aquí: start_rank es su número
-- del ranking inicial, y su nombre, FIDE ID, título y ELO salen de
-- participations, que ya los guarda sin el año de los menores y con los
-- retirados anonimizados. En los de equipos, start_rank es el número del
-- equipo, y name y rating, su nombre y su ELO medio.
--
-- La clave sigue el orden de la clasificación: la página la recorre sin
-- ordenar. pos se repite si la fuente da el mismo puesto a varios.
CREATE TABLE standings (
	tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
	pos INTEGER NOT NULL,
	start_rank INTEGER NOT NULL,
	name TEXT,
	rating INTEGER,
	points REAL NOT NULL,
	-- Valores de los desempates (JSON), en el orden de tournaments.tiebreaks.
	tiebreaks TEXT NOT NULL,
	PRIMARY KEY (tournament_id, pos, start_rank)
) WITHOUT ROWID;

-- Rondas del torneo según la fuente; ronda tras la que va la clasificación
-- guardada (NULL si la fuente no lo dice, como en los torneos por equipos), y
-- nombres de sus desempates (JSON: ["BH", "BH/M1", …]).
ALTER TABLE tournaments ADD COLUMN rounds INTEGER;
ALTER TABLE tournaments ADD COLUMN standings_round INTEGER;
ALTER TABLE tournaments ADD COLUMN tiebreaks TEXT;
