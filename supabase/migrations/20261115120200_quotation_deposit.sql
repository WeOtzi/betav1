-- Cotizaciones · seña en la respuesta del artista (15 nov 2026, beta cerrada).
--
-- COT-A-09: la respuesta a una solicitud de cliente no podía pedir seña (solo
-- la cotización manual la tenía, en artist_manual_quotes.deposit_*). Se suman
-- dos columnas opcionales a quotations_db:
--   artist_deposit_pct     porcentaje de seña pedido (0–100)
--   artist_deposit_amount  monto de la seña en la moneda del presupuesto (>= 0)
-- Las escribe el artista desde el diálogo "Aceptar y enviar presupuesto" y
-- "Confirmar acuerdo" (grants de tabla existentes; la RLS de update del
-- artista no cambia). El panel de pagos las usa cuando no hay fila manual.
--
-- Aditiva e idempotente. Reversa:
-- supabase/rollbacks/20261115120200_quotation_deposit.down.sql

begin;

alter table public.quotations_db
  add column if not exists artist_deposit_pct numeric,
  add column if not exists artist_deposit_amount numeric;

alter table public.quotations_db
  drop constraint if exists quotations_db_artist_deposit_pct_check;
alter table public.quotations_db
  add constraint quotations_db_artist_deposit_pct_check
  check (artist_deposit_pct is null or (artist_deposit_pct >= 0 and artist_deposit_pct <= 100));

alter table public.quotations_db
  drop constraint if exists quotations_db_artist_deposit_amount_check;
alter table public.quotations_db
  add constraint quotations_db_artist_deposit_amount_check
  check (artist_deposit_amount is null or artist_deposit_amount >= 0);

comment on column public.quotations_db.artist_deposit_pct is
  'Seña pedida por el artista al responder o acordar (porcentaje 0–100).';
comment on column public.quotations_db.artist_deposit_amount is
  'Monto de la seña pedida por el artista, en la moneda del presupuesto.';

commit;
