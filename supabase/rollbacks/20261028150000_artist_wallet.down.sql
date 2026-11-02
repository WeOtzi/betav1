-- Reversa de supabase/migrations/20261028150000_artist_wallet.sql
-- (We Ötzi Wallet: destinos de retiro, movimientos y lista de espera de la Card).
-- Borra las tablas nuevas y sus funciones; no toca tablas preexistentes.

begin;

drop function if exists public.request_artist_wallet_withdrawal(uuid, numeric, text);
drop function if exists public.artist_wallet_available_balance(uuid, text);
drop function if exists public.set_artist_default_payout_destination(uuid);

drop table if exists public.wallet_card_waitlist;
drop table if exists public.artist_wallet_movements;

drop trigger if exists trg_guard_artist_payout_destination on public.artist_payout_destinations;
drop table if exists public.artist_payout_destinations;
drop function if exists public.guard_artist_payout_destination();

notify pgrst, 'reload schema';

commit;
