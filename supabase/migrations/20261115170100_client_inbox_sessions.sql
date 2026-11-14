-- Inbox del cliente (beta cerrada, 15 nov 2026).
--
-- INB-10. quotation_sessions solo tiene la policy del artista: la pestaña
-- "Reservas" de /client/chats y la "Próxima cita" del dashboard del cliente
-- quedaban siempre vacías. En vez de abrir la tabla (expondría notes,
-- photo_urls y google_event_id, que son del artista) se agrega una RPC
-- security definer con columnas seguras, acotada a cotizaciones del cliente.
--
-- INB-08. El cliente es participante (participant_role = 'client') de hilos
-- del inbox unificado (p. ej. Job Board: "Tu propuesta fue aceptada. Podés
-- coordinar los próximos pasos por acá.") pero no tenía forma de listarlos.
-- list_client_inbox_threads() es el espejo de list_artist_inbox_threads()
-- desde el lado del cliente: la contraparte es el artista (nombre público de
-- artists_db) y el contexto se reduce a claves seguras para el cliente.
-- Enviar, marcar leído y adjuntar ya funcionan para cualquier participante
-- (send_inbox_message, mark_inbox_thread_read, bucket inbox-attachments).
--
-- Idempotente. Reversa: supabase/rollbacks/20261115170100_client_inbox_sessions.down.sql

begin;

create or replace function public.list_client_quotation_sessions(p_quotation_ids integer[])
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

create or replace function public.list_client_inbox_threads()
returns table (
  id uuid,
  category text,
  context_type text,
  context_id uuid,
  artist_user_id uuid,
  artist_name text,
  artist_username text,
  subject text,
  context jsonb,
  status text,
  last_message text,
  last_message_at timestamptz,
  last_sender_user_id uuid,
  is_favorite boolean,
  is_archived boolean,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id, t.category, t.context_type, t.context_id,
    t.artist_user_id,
    coalesce(nullif(btrim(a.name), ''), nullif(btrim(a.username), ''), 'Artista') as artist_name,
    a.username as artist_username,
    t.subject,
    jsonb_strip_nulls(jsonb_build_object(
      'request_id', t.context -> 'request_id',
      'request_code', t.context -> 'request_code',
      'application_id', t.context -> 'application_id',
      'application_status', t.context -> 'application_status',
      'quote_id', t.context -> 'quote_id',
      'budget_min', t.context -> 'budget_min',
      'budget_max', t.context -> 'budget_max',
      'currency', t.context -> 'currency'
    )) as context,
    t.status, t.last_message, t.last_message_at, t.last_sender_user_id,
    p.is_favorite, p.is_archived,
    (
      select count(*)
      from public.inbox_messages m
      where m.thread_id = t.id
        and m.created_at > coalesce(p.last_read_at, p.joined_at)
        and m.sender_user_id is distinct from (select auth.uid())
    )::bigint as unread_count
  from public.inbox_threads t
  join public.inbox_thread_participants p
    on p.thread_id = t.id
   and p.user_id = (select auth.uid())
   and p.participant_role = 'client'
  left join lateral (
    select ad.name, ad.username
    from public.artists_db ad
    where ad.user_id = t.artist_user_id
    limit 1
  ) a on true
  where (select auth.uid()) is not null
  order by coalesce(t.last_message_at, t.created_at) desc, t.id;
$$;

revoke all on function public.list_client_inbox_threads() from public, anon;
grant execute on function public.list_client_inbox_threads() to authenticated;

commit;
