-- Reversa de 20261112160000_quotation_expiry_terms.sql
-- Las cotizaciones que ya pasaron a 'expired' quedan así (el historial en
-- quotation_status_history conserva el estado anterior).
drop trigger if exists trg_guard_artist_terms_acceptance on public.artists_db;
drop function if exists public.guard_artist_terms_acceptance();
alter table public.artists_db
  drop column if exists terms_version,
  drop column if exists terms_accepted_at;

revoke all on function public.expire_stale_quotations(integer, integer, integer) from service_role;
drop function if exists public.expire_stale_quotations(integer, integer, integer);
drop trigger if exists trg_guard_quotation_expires_at on public.quotations_db;
drop function if exists public.guard_quotation_expires_at();
drop index if exists public.quotations_db_open_status_idx;
alter table public.quotations_db
  drop column if exists quote_expires_at;
