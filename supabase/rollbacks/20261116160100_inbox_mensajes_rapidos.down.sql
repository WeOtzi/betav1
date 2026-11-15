-- Reversa de 20261116160100_inbox_mensajes_rapidos.sql.
--
-- public.artist_message_templates es COMPARTIDA con el frente "cot-respuesta"
-- (kind = 'quote'): acá NO se borra la tabla ni sus policies de dueño. Se
-- quitan las reglas del Inbox y las plantillas kind = 'chat'. La tabla del
-- cliente es solo de este frente y sí se elimina.

begin;

do $$
begin
  if to_regclass('public.artist_message_templates') is not null then
    drop trigger if exists trg_artist_message_templates_chat_limit on public.artist_message_templates;
    alter table public.artist_message_templates
      drop constraint if exists artist_message_templates_chat_limits;
    delete from public.artist_message_templates where kind = 'chat';
  end if;
end;
$$;

drop table if exists public.client_message_templates;
drop function if exists public.inbox_quick_replies_limit();

commit;
