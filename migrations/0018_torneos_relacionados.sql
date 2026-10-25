-- Torneos del mismo grupo en la fuente: en info64, el «Grupo de Torneos» que
-- crea el organizador y que su página enseña como pestañas («Preferente»,
-- «Primera», «Segunda»). Un JSON [{"key": "...", "label": "..."}] en su orden
-- y con el propio torneo, también con los que no están guardados: así uno que
-- se guarde más tarde sale solo en las pestañas de sus hermanos. NULL si no
-- tiene grupo. Lo escribe upsertTournament, sin borrar con una lectura que no
-- lo trae. La página del torneo enseña sólo los guardados.
ALTER TABLE tournaments ADD COLUMN related TEXT;
