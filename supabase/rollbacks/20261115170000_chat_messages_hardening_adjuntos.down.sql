-- Reversa de 20261115170000_chat_messages_hardening_adjuntos.sql.
-- Vuelve a la vista chat_threads original, quita trigger, checks, columnas de
-- adjuntos, policies y bucket chat-attachments, y restaura los grants previos
-- (anon/authenticated con privilegios completos, como estaban en vivo).
-- OJO: borra las filas de chat_messages que eran solo adjunto (sin texto),
-- porque un mensaje vacío no tiene sentido sin la columna attachment_path.

begin;

create or replace view public.chat_threads
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
    select m.message, m.sender_type, m.created_at
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

drop trigger if exists trg_chat_messages_before_insert on public.chat_messages;
drop function if exists public.chat_messages_before_insert();

delete from public.chat_messages where btrim(message) = '' and attachment_path is not null;

alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages drop constraint if exists chat_messages_attachment_size_check;
alter table public.chat_messages drop constraint if exists chat_messages_message_kind_check;
alter table public.chat_messages drop column if exists message_kind;
alter table public.chat_messages drop column if exists attachment_size;
alter table public.chat_messages drop column if exists attachment_mime;
alter table public.chat_messages drop column if exists attachment_name;
alter table public.chat_messages drop column if exists attachment_path;

drop policy if exists users_update_read_status on public.chat_messages;
create policy users_update_read_status
  on public.chat_messages
  for update
  to public
  using (
    (sender_type = 'artist' and exists (
      select 1 from public.quotations_db
      where quotations_db.quote_id::text = chat_messages.quotation_id
        and quotations_db.client_user_id = auth.uid()
    ))
    or
    (sender_type = 'client' and exists (
      select 1 from public.quotations_db
      where quotations_db.quote_id::text = chat_messages.quotation_id
        and quotations_db.artist_id = auth.uid()
    ))
  )
  with check (is_read = true);

revoke update (is_read) on table public.chat_messages from authenticated;
grant all on table public.chat_messages to anon, authenticated;

drop policy if exists chat_attachments_party_select on storage.objects;
drop policy if exists chat_attachments_party_insert on storage.objects;
drop policy if exists chat_attachments_owner_delete on storage.objects;
-- El bucket chat-attachments NO se borra por SQL: Supabase bloquea el DELETE
-- directo sobre storage.* (storage.protect_delete). Sin policies queda
-- inaccesible para los usuarios; vaciarlo y borrarlo desde la API/panel de
-- Storage si hace falta.

commit;
