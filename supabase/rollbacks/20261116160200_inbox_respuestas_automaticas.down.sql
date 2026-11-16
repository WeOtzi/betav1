-- Reversa de 20261116160200_inbox_respuestas_automaticas.sql.
-- Los automáticos ya enviados quedan en los hilos como mensajes comunes del
-- artista (se pierde la marca "Mensaje automático"). Se borra la configuración
-- de cada artista.

begin;

drop function if exists public.get_inbox_automation_status();

drop trigger if exists trg_chat_messages_zz_auto_reply on public.chat_messages;
drop trigger if exists trg_zz_inbox_messages_auto_reply on public.inbox_messages;
drop function if exists private.chat_messages_auto_reply();
drop function if exists private.inbox_messages_auto_reply();
drop function if exists private.inbox_auto_reply_pick(uuid, boolean, boolean, timestamptz, boolean);
drop function if exists private.inbox_artist_away_state(uuid, timestamptz);
drop function if exists private.inbox_effective_weekly(uuid, jsonb, date);
drop function if exists private.inbox_weekly_row(jsonb, integer);

drop trigger if exists trg_chat_messages_inbox_auto_guard on public.chat_messages;
drop trigger if exists trg_inbox_messages_inbox_auto_guard on public.inbox_messages;
drop function if exists private.inbox_auto_guard_before_insert();

drop index if exists public.idx_chat_messages_auto;
drop index if exists public.idx_inbox_messages_auto;

alter table public.chat_messages drop constraint if exists chat_messages_auto_kind_check;
alter table public.inbox_messages drop constraint if exists inbox_messages_auto_kind_check;
alter table public.chat_messages drop column if exists auto_kind;
alter table public.inbox_messages drop column if exists auto_kind;

drop table if exists public.artist_inbox_automations;

commit;
