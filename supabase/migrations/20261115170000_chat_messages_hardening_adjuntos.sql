-- Inbox · chat de cotizaciones: endurecimiento + adjuntos (beta cerrada, 15 nov 2026).
--
-- INB-02. La policy users_update_read_status deja que la contraparte haga
-- UPDATE sobre mensajes ajenos y el WITH CHECK solo exige is_read = true: con
-- el GRANT de tabla completo, el cliente podía reescribir el texto de un
-- mensaje del artista (y viceversa) mientras lo marcaba leído. Además anon
-- tenía todos los privilegios de la tabla.
--   · anon pierde todo acceso a chat_messages.
--   · authenticated conserva SELECT/INSERT (acotados por RLS) y solo puede
--     actualizar la columna is_read (grant por columna).
--   · CHECK de contenido: 1-4000 caracteres, o un adjunto.
--   · Trigger BEFORE INSERT: normaliza el texto, fuerza is_read = false y
--     created_at = now() para el usuario final, valida la ruta del adjunto
--     (<quote_id>/<sender_id>/...) y deriva message_kind.
--
-- INB-07 (Figma 801:1149). Adjuntos en los chats de cotización:
--   · columnas attachment_path/name/mime/size + message_kind en chat_messages.
--   · bucket privado chat-attachments (15 MB, imágenes/PDF/texto) con
--     policies por cotización: suben y leen solo el artista y el cliente de
--     la cotización (y soporte puede leer). Cada uno sube en su carpeta.
--   · la vista chat_threads muestra "Imagen adjunta"/nombre del archivo como
--     último mensaje cuando el mensaje no tiene texto.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115170000_chat_messages_hardening_adjuntos.down.sql

begin;

-- ---------------------------------------------------------------- columnas
alter table public.chat_messages add column if not exists attachment_path text;
alter table public.chat_messages add column if not exists attachment_name text;
alter table public.chat_messages add column if not exists attachment_mime text;
alter table public.chat_messages add column if not exists attachment_size bigint;
alter table public.chat_messages add column if not exists message_kind text not null default 'text';

alter table public.chat_messages drop constraint if exists chat_messages_message_kind_check;
alter table public.chat_messages
  add constraint chat_messages_message_kind_check
  check (message_kind in ('text', 'image', 'file'));

alter table public.chat_messages drop constraint if exists chat_messages_attachment_size_check;
alter table public.chat_messages
  add constraint chat_messages_attachment_size_check
  check (attachment_size is null or (attachment_size >= 0 and attachment_size <= 15728640));

alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages
  add constraint chat_messages_content_check
  check (
    char_length(message) <= 4000
    and (char_length(btrim(message)) >= 1 or attachment_path is not null)
  );

-- ---------------------------------------------------------------- trigger
create or replace function public.chat_messages_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
begin
  new.message := btrim(coalesce(new.message, ''));

  -- El usuario final no elige si su mensaje ya está leído ni su fecha.
  if coalesce(auth.role(), '') <> 'service_role' then
    new.is_read := false;
    new.created_at := now();
  end if;

  if new.attachment_path is null then
    new.attachment_name := null;
    new.attachment_mime := null;
    new.attachment_size := null;
    new.message_kind := 'text';
  else
    v_prefix := coalesce(new.quotation_id, '') || '/' || coalesce(new.sender_id::text, '') || '/';
    if left(new.attachment_path, char_length(v_prefix)) <> v_prefix
       or position('..' in new.attachment_path) > 0 then
      raise exception 'invalid attachment path' using errcode = '42501';
    end if;
    new.attachment_name := left(coalesce(nullif(btrim(new.attachment_name), ''), 'archivo'), 200);
    new.message_kind := case
      when coalesce(new.attachment_mime, '') like 'image/%' then 'image'
      else 'file'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_before_insert on public.chat_messages;
create trigger trg_chat_messages_before_insert
  before insert on public.chat_messages
  for each row execute function public.chat_messages_before_insert();

-- ---------------------------------------------------------------- grants
revoke all on table public.chat_messages from anon;
revoke update, delete, truncate, references, trigger on table public.chat_messages from authenticated;
grant select, insert on table public.chat_messages to authenticated;
grant update (is_read) on table public.chat_messages to authenticated;

-- Marcar leído: solo la contraparte, solo a true (la columna ya está acotada
-- por el grant de arriba).
drop policy if exists users_update_read_status on public.chat_messages;
create policy users_update_read_status
  on public.chat_messages
  for update
  to authenticated
  using (
    (sender_type = 'artist' and exists (
      select 1 from public.quotations_db q
      where q.quote_id::text = chat_messages.quotation_id
        and q.client_user_id = (select auth.uid())
    ))
    or
    (sender_type = 'client' and exists (
      select 1 from public.quotations_db q
      where q.quote_id::text = chat_messages.quotation_id
        and q.artist_id = (select auth.uid())
    ))
  )
  with check (is_read = true);

-- ---------------------------------------------------------------- vista
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

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments', 'chat-attachments', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_attachments_party_select on storage.objects;
create policy chat_attachments_party_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      exists (
        select 1 from public.quotations_db q
        where q.quote_id::text = (storage.foldername(objects.name))[1]
          and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
      )
      or public.is_support_user()
    )
  );

drop policy if exists chat_attachments_party_insert on storage.objects;
create policy chat_attachments_party_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.quotations_db q
      where q.quote_id::text = (storage.foldername(objects.name))[1]
        and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
  );

drop policy if exists chat_attachments_owner_delete on storage.objects;
create policy chat_attachments_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

commit;
