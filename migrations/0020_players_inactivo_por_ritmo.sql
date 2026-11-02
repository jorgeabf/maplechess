-- Si el jugador está inactivo en rápido y en relámpago, de las listas de cada
-- ritmo (rapid_rating_list.zip y blitz_rating_list.zip). La combinada sólo
-- trae una marca, la del estándar (players.inactive): medido el 2-nov-2026 con
-- 30 jugadores, frente a su perfil FIDE. NULL si no está en la lista de ese
-- ritmo (sin ELO) o hasta la primera importación que las lee. Las lee
-- /api/elo.
ALTER TABLE players ADD COLUMN rapid_inactive INTEGER;
ALTER TABLE players ADD COLUMN blitz_inactive INTEGER;
