-- Reversa de 20261116160000_inbox_mensajes_de_voz.sql.
-- Los mensajes de voz ya enviados quedan como adjuntos comunes (se conserva el
-- archivo y la fila; se pierde la duración). Los buckets vuelven a rechazar
-- audio nuevo.

begin;

drop function if exists public.send_inbox_voice_message(uuid, text, text, integer, uuid);

drop trigger if exists trg_chat_messages_voice on public.chat_messages;
drop trigger if exists trg_inbox_messages_voice on public.inbox_messages;
drop function if exists private.inbox_voice_before_insert();
drop function if exists private.inbox_voice_object(text, text);

alter table public.chat_messages drop constraint if exists chat_messages_voice_duration_check;
alter table public.chat_messages drop constraint if exists chat_messages_voice_size_check;
alter table public.inbox_messages drop constraint if exists inbox_messages_voice_duration_check;
alter table public.inbox_messages drop constraint if exists inbox_messages_voice_size_check;

alter table public.chat_messages drop column if exists attachment_duration_ms;
alter table public.inbox_messages drop column if exists attachment_duration_ms;

update storage.buckets b
set allowed_mime_types = array(
  select m from unnest(b.allowed_mime_types) as m
  where m not in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg')
  order by m
)
where b.id in ('chat-attachments', 'inbox-attachments')
  and b.allowed_mime_types is not null
  and b.allowed_mime_types && array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];

commit;
