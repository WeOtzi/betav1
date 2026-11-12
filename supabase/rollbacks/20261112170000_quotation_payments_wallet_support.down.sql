-- Reversa de 20261112170000_quotation_payments_wallet_support.sql
-- Los movimientos informativos que dejó en artist_wallet_movements se borran
-- (solo los de origen manual_payment / quotation; no tocan el saldo).
-- Los comprobantes del bucket hay que borrarlos antes desde Storage (API o
-- panel): Supabase no permite borrar storage.objects por SQL.
begin;

drop trigger if exists trg_quotation_completed_wallet_feed on public.quotations_db;
drop trigger if exists trg_quotation_payments_wallet_feed on public.quotation_payments;

drop function if exists public.support_set_artist_verification_state(uuid, text);
drop function if exists public.support_review_verification_document(uuid, text, text);
drop function if exists public.support_review_payout_destination(uuid, text, text);
drop function if exists public.quotation_completed_wallet_feed();
drop function if exists public.quotation_payments_wallet_feed();
drop function if exists public.void_quotation_payment(uuid);
drop function if exists public.record_quotation_payment(integer, text, text, numeric, text, date, text, text, text, text, integer);

delete from public.artist_wallet_movements
 where metadata_json->>'source' in ('manual_payment', 'quotation')
   and coalesce((metadata_json->>'off_platform')::boolean, false);

drop policy if exists quotation_payment_receipts_support_select on storage.objects;
drop policy if exists quotation_payment_receipts_owner_delete on storage.objects;
drop policy if exists quotation_payment_receipts_owner_insert on storage.objects;
drop policy if exists quotation_payment_receipts_owner_select on storage.objects;
-- El bucket se borra desde Storage una vez vacío:
--   select storage.delete_bucket('quotation-payment-receipts');  (o desde el panel)

drop table if exists public.quotation_payments;

notify pgrst, 'reload schema';

commit;
