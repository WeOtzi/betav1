-- Cotizaciones · orígenes 'manual' y 'prequote' (15 nov 2026, beta cerrada).
--
-- COT-A-01: create_manual_quotation guarda source = 'manual' y el CHECK vivo
-- quotations_db_source_check solo admitía direct, job_board, recommendation y
-- web_chat: toda cotización manual del artista fallaba con 23514.
-- COT-A-02: el pre-cotizador manda source = 'prequote' (services/quotation-intake.js)
-- y save_web_quotation lo inserta tal cual: el envío del cliente se abortaba.
--
-- Se amplía el CHECK con los dos orígenes. Las filas existentes ya cumplen la
-- regla nueva (se agrega NOT VALID y se valida aparte para no bloquear la tabla).
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261115120000_quotation_source_manual_prequote.down.sql

begin;

alter table public.quotations_db
  drop constraint if exists quotations_db_source_check;
alter table public.quotations_db
  add constraint quotations_db_source_check
  check (source is null or source = any (array[
    'direct'::text, 'job_board'::text, 'recommendation'::text, 'web_chat'::text,
    'manual'::text, 'prequote'::text
  ])) not valid;
alter table public.quotations_db
  validate constraint quotations_db_source_check;

commit;
