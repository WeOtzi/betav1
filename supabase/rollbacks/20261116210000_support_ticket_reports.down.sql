-- Reversa de 20261116210000_support_ticket_reports.sql (denuncias → tickets).
--
-- Los tickets de denuncia NO se borran: pasan a kind 'consulta' (conservan
-- category 'reporte', asunto, descripción y adjuntos) para poder restaurar el
-- CHECK original. El expediente (support_ticket_reports) sí se elimina: si
-- hace falta conservarlo, exportarlo antes de correr esta reversa.

begin;

drop function if exists public.create_support_report(jsonb);

drop table if exists public.support_ticket_reports;

drop index if exists public.support_tickets_kind_status_idx;

update public.support_tickets set kind = 'consulta' where kind = 'denuncia';

alter table public.support_tickets
  drop constraint if exists support_tickets_kind_check;
alter table public.support_tickets
  add constraint support_tickets_kind_check
    check (kind = any (array['consulta'::text, 'disputa'::text]));

commit;
