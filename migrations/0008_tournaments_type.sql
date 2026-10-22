-- Filtro por modalidad de /torneos (individual o por equipos), en los dos
-- órdenes del listado: los empezados recorren el índice hacia atrás y los
-- próximos hacia delante, sólo por las entradas de esa modalidad. Como en
-- tournaments_start_date, cada entrada lleva también el rowid (= id), así que
-- sale el orden (start_date, id) sin ordenar. El total cuenta sólo los de esa
-- modalidad: con un torneo por equipos de cada diez, una décima parte de la
-- tabla en vez de toda.
CREATE INDEX tournaments_type_start_date ON tournaments (type, start_date);
