-- Reversa de 20261116120000_cot_respuesta_propuesta.sql.
--
-- Borra las fechas ofrecidas y el mensaje resuelto de las propuestas
-- (artist_availability conserva el resumen en texto). La tabla
-- artist_message_templates se comparte con el frente "inbox" (kind = 'chat',
-- migración 20261116160100): acá solo se borran las respuestas rápidas de
-- cotización, y la tabla (con sus policies) se elimina únicamente si queda
-- vacía Y el inbox no está instalado. La señal de que lo está es su constraint
-- artist_message_templates_chat_limits: con 160100 aplicada la tabla se queda
-- aunque todavía no tenga plantillas de chat (el inbox la consulta).

begin;

alter table public.quotations_db
  drop constraint if exists quotations_db_offered_slots_check,
  drop constraint if exists quotations_db_proposal_message_check;
alter table public.quotations_db
  drop column if exists offered_slots,
  drop column if exists proposal_message;

do $$
begin
  if to_regclass('public.artist_message_templates') is not null then
    delete from public.artist_message_templates where kind = 'quote';
    if not exists (select 1 from public.artist_message_templates)
       and not exists (
         select 1 from pg_catalog.pg_constraint c
          where c.conname = 'artist_message_templates_chat_limits'
            and c.conrelid = 'public.artist_message_templates'::regclass
       ) then
      drop table public.artist_message_templates;
    end if;
  end if;
end
$$;

commit;
