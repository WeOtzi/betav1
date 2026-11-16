-- Reversa de 20261116140000_negociacion_propuestas.sql.
-- Quita la policy que cierra el chat tras el rechazo, los triggers y funciones
-- de negociación, la tabla quotation_proposals y las columnas del acuerdo.
-- OJO: se pierde el historial de contrapropuestas y enmiendas, y el sello
-- "aprobada por ambas partes" (agreement_approved_at / agreement_version).
-- Los valores ya aplicados a quotations_db (final_*, seña, pedido) quedan como
-- están: una enmienda aprobada no se deshace al revertir.

begin;

drop policy if exists chat_closed_after_client_rejection on public.chat_messages;

drop trigger if exists trg_quotation_zz_negociacion_sync on public.quotations_db;
drop trigger if exists trg_quotation_zy_negociacion_guard on public.quotations_db;

drop function if exists public.negociacion_resolve(uuid, uuid, text, text);
drop function if exists public.negociacion_propose(integer, uuid, text, text, jsonb, text);
drop function if exists public.negociacion_deposit_pct(public.quotations_db);
drop function if exists public.negociacion_quotation_sync();
drop function if exists public.negociacion_quotation_guard();

drop table if exists public.quotation_proposals;

alter table public.quotations_db
  drop constraint if exists quotations_db_agreement_version_check;
alter table public.quotations_db
  drop column if exists agreement_version,
  drop column if exists agreement_approved_at;

commit;
