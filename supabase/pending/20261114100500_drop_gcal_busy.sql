-- PENDIENTE · NO APLICAR sin OK del dueño (borra datos en vivo).
-- Desde 20261114100000 la sincronización con Google es solo de ida y nadie lee
-- artist_google_calendar_busy (horarios ocupados importados, sin títulos). Esta
-- limpieza borra la tabla y sus filas. Irreversible: los datos no se recuperan
-- (volverían a importarse solo si se revierte 20261114100000 y se sincroniza).

begin;
drop table if exists public.artist_google_calendar_busy;
commit;
