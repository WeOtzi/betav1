-- Ronda 2 · Inbox [P8] · Mensajes de voz (16 nov 2026).
--
-- "En el inbox poder enviar mensajes de voz". El audio se graba en el navegador
-- (MediaRecorder) y se sube como adjunto a los buckets privados que ya usa el
-- chat: chat-attachments (chats de cotización) e inbox-attachments (inbox
-- unificado). Esta migración:
--
--   · Admite audio/webm, audio/ogg, audio/mp4 y audio/mpeg en los dos buckets
--     (se SUMAN a los MIME que ya haya: no pisa los que agregue otro frente).
--   · Agrega attachment_duration_ms a chat_messages e inbox_messages.
--   · Tope propio del audio: 6 MB y 3 minutos. El tamaño y el MIME se leen del
--     objeto real en Storage (no del valor que declara el navegador); la
--     duración la declara el cliente y queda acotada por un CHECK.
--   · Un mensaje de voz se guarda como adjunto (message_kind = 'file') con
--     attachment_mime 'audio/…' y attachment_name 'Mensaje de voz'. NO se toca
--     el CHECK de message_kind ni chat_messages_before_insert, chat_threads ni
--     touch_inbox_message_thread: la vista previa del hilo ("Mensaje de voz")
--     sale del nombre del adjunto que ya usan.
--   · Inbox unificado: RPC send_inbox_voice_message (send_inbox_message no
--     recibe duración y queda como está).
--
-- Idempotente. Reversa: supabase/rollbacks/20261116160000_inbox_mensajes_de_voz.down.sql

begin;

create schema if not exists private;

-- ---------------------------------------------------------------- columnas
alter table public.chat_messages add column if not exists attachment_duration_ms integer;
alter table public.inbox_messages add column if not exists attachment_duration_ms integer;

-- La duración solo existe en adjuntos de audio y va de 0,5 s a 3 min.
alter table public.chat_messages drop constraint if exists chat_messages_voice_duration_check;
alter table public.chat_messages
  add constraint chat_messages_voice_duration_check
  check (
    attachment_duration_ms is null
    or (
      attachment_path is not null
      and coalesce(attachment_mime, '') like 'audio/%'
      and attachment_duration_ms between 500 and 180000
    )
  );

alter table public.inbox_messages drop constraint if exists inbox_messages_voice_duration_check;
alter table public.inbox_messages
  add constraint inbox_messages_voice_duration_check
  check (
    attachment_duration_ms is null
    or (
      attachment_path is not null
      and coalesce(attachment_mime, '') like 'audio/%'
      and attachment_duration_ms between 500 and 180000
    )
  );

-- Tope de tamaño del audio (6 MB), más chico que el de los demás adjuntos.
alter table public.chat_messages drop constraint if exists chat_messages_voice_size_check;
alter table public.chat_messages
  add constraint chat_messages_voice_size_check
  check (
    coalesce(attachment_mime, '') not like 'audio/%'
    or (attachment_size is not null and attachment_size between 1 and 6291456)
  );

alter table public.inbox_messages drop constraint if exists inbox_messages_voice_size_check;
alter table public.inbox_messages
  add constraint inbox_messages_voice_size_check
  check (
    coalesce(attachment_mime, '') not like 'audio/%'
    or (attachment_size is not null and attachment_size between 1 and 6291456)
  );

-- ---------------------------------------------------------------- storage
-- Se suman los MIME de audio a los que ya tenga cada bucket.
update storage.buckets b
set allowed_mime_types = (
  select array_agg(distinct m order by m)
  from unnest(b.allowed_mime_types || array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']) as m
)
where b.id in ('chat-attachments', 'inbox-attachments')
  and b.allowed_mime_types is not null;

-- ---------------------------------------------------------------- helpers
-- Tamaño y MIME reales del objeto subido (metadata que escribe Storage).
create or replace function private.inbox_voice_object(p_bucket text, p_path text)
returns table (size_bytes bigint, mime text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint end,
    lower(btrim(split_part(coalesce(o.metadata ->> 'mimetype', ''), ';', 1)))
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.name = p_path
  limit 1;
$$;

revoke all on function private.inbox_voice_object(text, text) from public, anon, authenticated;

-- BEFORE INSERT compartido por chat_messages e inbox_messages (TG_ARGV[0] =
-- bucket). Corre después de los triggers existentes (orden alfabético), así
-- que la ruta del chat de cotización ya viene validada.
create or replace function private.inbox_voice_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := tg_argv[0];
  v_mime text := lower(btrim(split_part(coalesce(new.attachment_mime, ''), ';', 1)));
  v_size bigint;
  v_real_mime text;
  v_prefix text;
begin
  if new.attachment_path is null or v_mime not like 'audio/%' then
    -- La duración solo aplica a mensajes de voz.
    new.attachment_duration_ms := null;
    return new;
  end if;

  if v_mime not in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg') then
    raise exception 'formato de audio no admitido' using errcode = '22023';
  end if;

  if tg_table_name = 'inbox_messages' then
    -- send_inbox_message solo valida el primer segmento (el hilo).
    v_prefix := new.thread_id::text || '/' || coalesce(new.sender_user_id::text, '') || '/';
    if new.sender_user_id is null
       or left(new.attachment_path, char_length(v_prefix)) <> v_prefix
       or position('..' in new.attachment_path) > 0 then
      raise exception 'ruta de adjunto inválida' using errcode = '42501';
    end if;
  end if;

  select o.size_bytes, o.mime into v_size, v_real_mime
  from private.inbox_voice_object(v_bucket, new.attachment_path) o;
  if not found or coalesce(v_real_mime, '') not like 'audio/%' then
    raise exception 'el audio adjunto no existe' using errcode = '22023';
  end if;
  if v_real_mime not in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg') then
    raise exception 'formato de audio no admitido' using errcode = '22023';
  end if;
  if coalesce(v_size, 0) < 1 or v_size > 6291456 then
    raise exception 'el mensaje de voz supera los 6 MB' using errcode = '22023';
  end if;
  if new.attachment_duration_ms is null
     or new.attachment_duration_ms < 500
     or new.attachment_duration_ms > 180000 then
    raise exception 'duración del mensaje de voz inválida' using errcode = '22023';
  end if;

  new.attachment_mime := v_real_mime;
  new.attachment_size := v_size;
  new.attachment_name := 'Mensaje de voz';
  return new;
end;
$$;

revoke all on function private.inbox_voice_before_insert() from public, anon, authenticated;

drop trigger if exists trg_chat_messages_voice on public.chat_messages;
create trigger trg_chat_messages_voice
  before insert on public.chat_messages
  for each row execute function private.inbox_voice_before_insert('chat-attachments');

drop trigger if exists trg_inbox_messages_voice on public.inbox_messages;
create trigger trg_inbox_messages_voice
  before insert on public.inbox_messages
  for each row execute function private.inbox_voice_before_insert('inbox-attachments');

-- ---------------------------------------------------------------- RPC
-- Mensaje de voz en un hilo del inbox unificado. Misma autorización que
-- send_inbox_message (participante del hilo); el trigger de arriba valida el
-- objeto en Storage y completa tamaño, MIME y nombre.
create or replace function public.send_inbox_voice_message(
  p_thread_id uuid,
  p_attachment_path text,
  p_attachment_mime text,
  p_duration_ms integer,
  p_client_nonce uuid default null
)
returns public.inbox_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_message public.inbox_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select participant_role into v_role
  from public.inbox_thread_participants
  where thread_id = p_thread_id and user_id = auth.uid();
  if not found then
    raise exception 'thread not found' using errcode = '42501';
  end if;

  if p_attachment_path is null or coalesce(p_attachment_mime, '') not like 'audio/%' then
    raise exception 'voice attachment is required' using errcode = '22023';
  end if;

  insert into public.inbox_messages (
    thread_id, sender_user_id, sender_role, body, message_kind,
    attachment_path, attachment_name, attachment_mime, attachment_size,
    attachment_duration_ms, client_nonce
  ) values (
    p_thread_id, auth.uid(), v_role, null, 'file',
    p_attachment_path, 'Mensaje de voz', p_attachment_mime, null,
    p_duration_ms, p_client_nonce
  )
  on conflict (sender_user_id, client_nonce)
    where sender_user_id is not null and client_nonce is not null
  do update set body = public.inbox_messages.body
  returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.send_inbox_voice_message(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.send_inbox_voice_message(uuid, text, text, integer, uuid) to authenticated;

commit;
