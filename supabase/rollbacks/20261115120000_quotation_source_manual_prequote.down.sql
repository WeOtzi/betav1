-- Reversa de 20261115120000_quotation_source_manual_prequote.sql. Vuelve al
-- CHECK anterior (sin 'manual' ni 'prequote'). Se crea NOT VALID para no
-- fallar si ya hay cotizaciones manuales o del pre-cotizador guardadas: esas
-- filas quedan, pero no se pueden crear nuevas.

begin;

alter table public.quotations_db
  drop constraint if exists quotations_db_source_check;
alter table public.quotations_db
  add constraint quotations_db_source_check
  check (source = any (array['direct'::text, 'job_board'::text, 'recommendation'::text, 'web_chat'::text]))
  not valid;

commit;
