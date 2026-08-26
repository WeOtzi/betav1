-- Rediseño Bauhaus 2026 · Vista chat_threads para /client/chats y /artist/inbox
-- + fix: chat_messages y job_board_applications no estaban en la publicación
-- supabase_realtime, por lo que las suscripciones existentes
-- (WeotziData.Realtime.subscribeChatMessages, client-dashboard.js INSERT de
-- postulaciones) nunca disparaban. Solo cambios aditivos.

-- Vista security_invoker: hereda la RLS de quotations_db y chat_messages del
-- usuario que consulta (artista ve sus hilos, cliente los suyos, soporte todo).
create or replace view public.chat_threads
with (security_invoker = on) as
select
  q.quote_id,
  q.id as quotation_id_int,
  q.artist_id,
  q.artist_name,
  q.artist_username,
  q.client_user_id,
  q.client_full_name,
  q.client_email,
  q.quote_status,
  q.tattoo_body_part,
  q.tattoo_style,
  q.tattoo_size,
  q.final_budget_amount,
  q.final_budget_currency,
  q.source,
  lm.message as last_message,
  lm.sender_type as last_message_sender,
  lm.created_at as last_message_at,
  coalesce(uc.unread_for_artist, 0) as unread_for_artist,
  coalesce(uc.unread_for_client, 0) as unread_for_client
from public.quotations_db q
join lateral (
  select m.message, m.sender_type, m.created_at
  from public.chat_messages m
  where m.quotation_id = (q.quote_id)::text
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select
    count(*) filter (where m.sender_type = 'client' and m.is_read is not true) as unread_for_artist,
    count(*) filter (where m.sender_type = 'artist' and m.is_read is not true) as unread_for_client
  from public.chat_messages m
  where m.quotation_id = (q.quote_id)::text
) uc on true
where q.client_user_id is not null;

revoke all on public.chat_threads from anon;
grant select on public.chat_threads to authenticated;

-- Realtime: postgres_changes respeta la RLS de la tabla para usuarios
-- autenticados; agregar estas tablas habilita las suscripciones ya escritas.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_board_applications'
  ) then
    alter publication supabase_realtime add table public.job_board_applications;
  end if;
end
$$;
