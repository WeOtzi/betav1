-- Reversa de 20261115120200_quotation_deposit.sql. Borra las columnas de seña
-- de la respuesta (se pierden las señas pedidas desde el detalle; las de la
-- cotización manual siguen en artist_manual_quotes).

begin;

alter table public.quotations_db
  drop constraint if exists quotations_db_artist_deposit_pct_check,
  drop constraint if exists quotations_db_artist_deposit_amount_check;
alter table public.quotations_db
  drop column if exists artist_deposit_pct,
  drop column if exists artist_deposit_amount;

commit;
