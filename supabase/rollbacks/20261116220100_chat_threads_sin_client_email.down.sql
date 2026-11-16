-- Reversa de 20261116220100_chat_threads_sin_client_email.sql.
-- Vuelve a la vista chat_threads de 20261115170000 (con q.client_email) y a
-- sus privilegios anteriores (los que da el esquema por defecto, sin anon).

begin;

drop view if exists public.chat_threads;

create view public.chat_threads
with (security_invoker = on) as
select q.quote_id,
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
    coalesce(uc.unread_for_artist, 0::bigint) as unread_for_artist,
    coalesce(uc.unread_for_client, 0::bigint) as unread_for_client
from public.quotations_db q
join lateral (
    select coalesce(
             nullif(btrim(m.message), ''),
             case when m.message_kind = 'image' then 'Imagen adjunta'
                  else coalesce(m.attachment_name, 'Archivo adjunto') end
           ) as message,
           m.sender_type,
           m.created_at
    from public.chat_messages m
    where m.quotation_id = q.quote_id::text
    order by m.created_at desc
    limit 1
) lm on true
left join lateral (
    select count(*) filter (where m.sender_type = 'client' and m.is_read is not true) as unread_for_artist,
           count(*) filter (where m.sender_type = 'artist' and m.is_read is not true) as unread_for_client
    from public.chat_messages m
    where m.quotation_id = q.quote_id::text
) uc on true
where q.client_user_id is not null;

revoke all on table public.chat_threads from anon;
grant all on table public.chat_threads to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
