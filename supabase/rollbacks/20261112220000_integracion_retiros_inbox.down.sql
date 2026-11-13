-- Reversa de 20261112220000_integracion_retiros_inbox.sql
-- Los retiros ya liquidados quedan como están (completed / failed con
-- metadata_json.settlement): son hechos contables, no se revierten.
begin;

drop function if exists public.support_settle_artist_withdrawal(uuid, text, text, text);

-- list_artist_inbox_threads vuelve a la versión de 20260829153500 (sin filtro de rol).
create or replace function public.list_artist_inbox_threads()
returns table (
  id uuid,
  category text,
  context_type text,
  context_id uuid,
  counterparty_name text,
  counterparty_initials text,
  subject text,
  context jsonb,
  status text,
  is_priority boolean,
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
    t.counterparty_name, t.counterparty_initials, t.subject, t.context,
    t.status, t.is_priority, t.last_message, t.last_message_at,
    t.last_sender_user_id, p.is_favorite, p.is_archived,
    (
      select count(*)
      from public.inbox_messages m
      where m.thread_id = t.id
        and m.created_at > coalesce(p.last_read_at, p.joined_at)
        and m.sender_user_id is distinct from auth.uid()
    )::bigint as unread_count
  from public.inbox_threads t
  join public.inbox_thread_participants p
    on p.thread_id = t.id and p.user_id = auth.uid()
  where auth.uid() is not null
  order by coalesce(t.last_message_at, t.created_at) desc, t.id;
$$;

revoke all on function public.list_artist_inbox_threads() from public, anon;
grant execute on function public.list_artist_inbox_threads() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
