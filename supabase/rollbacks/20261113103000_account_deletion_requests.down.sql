-- Reversa de 20261113103000_account_deletion_requests.sql (ronda 3c · borrado).
-- OJO: se pierden las solicitudes de baja y su auditoría. Exportá antes
-- account_deletion_requests y account_deletion_events si hay filas.
-- La tabla vieja artist_account_deletion_requests no se tocó y sigue igual.

drop function if exists public.support_review_account_deletion(uuid, text, text);
drop function if exists public.cancel_account_deletion(uuid);
drop function if exists public.request_account_deletion(text, text);
drop function if exists public.account_deletion_blockers(uuid);
drop function if exists public.account_deletion_has_blockers(jsonb);
drop function if exists public.account_deletion_blockers_internal(uuid);
drop function if exists public.account_deletion_item(text, text, text, text, numeric, text);

drop trigger if exists account_deletion_requests_touch on public.account_deletion_requests;
drop function if exists public.account_deletion_touch();

drop table if exists public.account_deletion_events;
drop table if exists public.account_deletion_requests;
