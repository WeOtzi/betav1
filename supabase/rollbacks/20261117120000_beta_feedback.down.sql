-- Reversa de 20261117120000_beta_feedback.sql.
-- Borra la tabla del feedback de la beta (con sus índices, la política de
-- lectura propia, grants y trigger) y la función del updated_at. La migración
-- no da insert a authenticated (solo escribe el servidor), así que no hay
-- política de insert que quitar aparte. Las capturas del bucket
-- `support-attachments` (carpetas <uid>/feedback/) NO se tocan: si hace falta,
-- se borran aparte desde Storage.

begin;

drop table if exists public.beta_feedback cascade;
drop function if exists public.beta_feedback_touch_updated_at();

commit;
