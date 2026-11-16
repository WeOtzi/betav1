-- Reversa de 20261116150000_sesiones_confirmacion_ubicacion.sql.
-- Quita guardas, RPC, tablas y columnas de confirmación/ubicación de sesiones.
-- OJO: borra las solicitudes de cambio, los registros/calificaciones por sesión
-- y el vínculo sesión ↔ ticket (los tickets de soporte se conservan). Las
-- ubicaciones de más de 120 caracteres se recortan para volver al límite previo.

begin;

drop trigger if exists trg_gcal_dirty_confirmacion on public.quotation_sessions;
drop trigger if exists trg_sesiones_hold_confirms_session on public.artist_booking_holds;
drop trigger if exists trg_sesiones_close_requests on public.quotation_sessions;
drop trigger if exists trg_sesiones_guard on public.quotation_sessions;

drop function if exists public.sesiones_open_dispute(uuid, uuid, text, text, text, text);
drop function if exists public.sesiones_save_feedback(uuid, uuid, integer, text);
drop function if exists public.sesiones_withdraw_change(uuid, uuid);
drop function if exists public.sesiones_respond_change(uuid, uuid, boolean, text);
drop function if exists public.sesiones_request_change(uuid, uuid, timestamptz, numeric, text, text, uuid, text, text);
drop function if exists public.sesiones_confirm(uuid, uuid);
drop function if exists public.sesiones_hold_confirms_session();
drop function if exists public.sesiones_close_requests();
drop function if exists public.sesiones_guard();

-- La RPC del panel del cliente vuelve a la versión de 20261115170100 (7
-- columnas), antes de quitar la tabla y la columna que lee la versión nueva.
drop function if exists public.list_client_quotation_sessions(integer[]);
create function public.list_client_quotation_sessions(p_quotation_ids integer[])
returns table (
  id uuid,
  quotation_id integer,
  session_number integer,
  session_date timestamptz,
  duration_hours numeric,
  status text,
  location text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.quotation_id, s.session_number, s.session_date,
         s.duration_hours, s.status, s.location
  from public.quotation_sessions s
  join public.quotations_db q on q.id = s.quotation_id
  where (select auth.uid()) is not null
    and s.quotation_id = any (coalesce(p_quotation_ids, '{}'::integer[]))
    and q.client_user_id = (select auth.uid())
  order by s.session_date asc;
$$;

revoke all on function public.list_client_quotation_sessions(integer[]) from public, anon;
grant execute on function public.list_client_quotation_sessions(integer[]) to authenticated;

drop table if exists public.quotation_session_disputes;
drop table if exists public.quotation_session_feedback;
drop table if exists public.quotation_session_change_requests;

alter table public.quotation_sessions drop constraint if exists quotation_sessions_client_confirmation_check;
alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_kind_check;
alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_place_check;
alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_length;

-- Sin triggers de usuario: el recorte no cambia updated_at ni avisa a Google.
alter table public.quotation_sessions disable trigger user;
update public.quotation_sessions
   set location = left(btrim(location), 120)
 where location is not null and char_length(btrim(location)) > 120;
alter table public.quotation_sessions enable trigger user;

alter table public.quotation_sessions add constraint quotation_sessions_location_length
  check (location is null or (char_length(btrim(location)) >= 1 and char_length(btrim(location)) <= 120));

alter table public.quotation_sessions
  drop column if exists client_confirmation,
  drop column if exists client_confirmed_at,
  drop column if exists location_kind,
  drop column if exists location_ref,
  drop column if exists location_place_id;

notify pgrst, 'reload schema';

commit;
