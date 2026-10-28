-- We Ötzi Wallet · cuenta del artista (/artist/account#cobros)
-- Figma final del flujo de artista (oct 2026): frames 801:568, 801:569, 801:570.
--
-- NO APLICADA. Aditiva e idempotente.
--
-- ⚠ DECISIÓN PENDIENTE ANTES DE APLICAR: account_identifier guarda el número
--   de cuenta (CBU/IBAN/SWIFT) en texto plano. Antes de producción, tokenizarlo
--   con el proveedor de pagos o cifrarlo con Supabase Vault (pgsodium) y dejar
--   acá solo los últimos 4 dígitos para mostrar.
--
-- Reversa:
--   supabase/rollbacks/20261028150000_artist_wallet.down.sql
--
-- Modelo:
--   artist_payout_destinations  destinos de retiro del artista (Lemon, cuenta
--                               bancaria USD, banco internacional SEPA/SWIFT).
--   artist_wallet_movements     movimientos del wallet. Los escribe el backend
--                               de pagos o soporte; el artista solo lee y pide
--                               retiros con la RPC request_artist_wallet_withdrawal.
--   wallet_card_waitlist        lista de espera de la We Ötzi Card.
--
-- Saldo disponible (mismo cálculo que public/shared/js/wallet-model.js):
--   + release/adjustment completados
--   - withdrawal en proceso o completado
--   - fee/refund completados
-- Los movimientos 'payment' (fondos retenidos por reserva) y 'dispute' solo
-- alimentan los estados pendiente/esperando liberación/bloqueado.
--
-- Seguridad: el artista no puede marcar destinos como verificados ni escribir
-- movimientos directamente; un trigger fuerza verification_status = 'pending'
-- y lo resetea si cambia el identificador de la cuenta.

begin;

-- ===================== destinos de retiro =====================
create table if not exists public.artist_payout_destinations (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  method text not null
    check (method in ('lemon', 'bank_usd', 'bank_international', 'paypal', 'wise', 'usdt', 'mercado_pago')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  holder_name text not null check (char_length(btrim(holder_name)) between 2 and 120),
  currency text not null check (currency ~ '^[A-Z]{3,4}$'),
  account_identifier text not null check (char_length(btrim(account_identifier)) between 4 and 64),
  rail text check (rail is null or rail in ('ACH', 'SEPA', 'SWIFT', 'CBU', 'ALIAS', 'WALLET')),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  is_default boolean not null default false,
  active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists artist_payout_destinations_one_default
  on public.artist_payout_destinations (artist_user_id)
  where is_default and active;
create index if not exists artist_payout_destinations_artist_idx
  on public.artist_payout_destinations (artist_user_id, active, created_at);

-- El artista solo puede crear destinos pendientes y nunca auto-verificarse.
create or replace function public.guard_artist_payout_destination()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  if public.is_support_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.verified_at := null;
  else
    new.verification_status := old.verification_status;
    new.verified_at := old.verified_at;
    if new.account_identifier is distinct from old.account_identifier
      or new.method is distinct from old.method
      or new.currency is distinct from old.currency then
      new.verification_status := 'pending';
      new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_artist_payout_destination on public.artist_payout_destinations;
create trigger trg_guard_artist_payout_destination
  before insert or update on public.artist_payout_destinations
  for each row execute function public.guard_artist_payout_destination();

create or replace function public.set_artist_default_payout_destination(p_destination_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.artist_payout_destinations
    where id = p_destination_id and artist_user_id = v_user_id and active
  ) then
    raise exception 'payout destination not found';
  end if;

  update public.artist_payout_destinations
  set is_default = false
  where artist_user_id = v_user_id and active and is_default and id <> p_destination_id;

  update public.artist_payout_destinations
  set is_default = true
  where id = p_destination_id and artist_user_id = v_user_id and active;
end;
$$;

revoke all on function public.set_artist_default_payout_destination(uuid) from public;
grant execute on function public.set_artist_default_payout_destination(uuid) to authenticated;

-- ===================== movimientos del wallet =====================
create table if not exists public.artist_wallet_movements (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    check (kind in ('payment', 'release', 'withdrawal', 'fee', 'dispute', 'refund', 'adjustment')),
  status text not null default 'completed'
    check (status in ('pending_service', 'awaiting_release', 'blocked', 'processing', 'completed', 'failed', 'cancelled')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  counterparty_name text,
  booking_reference text,
  quote_id text,
  destination_id uuid references public.artist_payout_destinations (id) on delete set null,
  service_date date,
  release_at timestamptz,
  occurred_at timestamptz not null default now(),
  external_reference text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_user_id, external_reference)
);

create index if not exists artist_wallet_movements_artist_idx
  on public.artist_wallet_movements (artist_user_id, occurred_at desc);
create index if not exists artist_wallet_movements_open_idx
  on public.artist_wallet_movements (artist_user_id, status)
  where status in ('pending_service', 'awaiting_release', 'blocked', 'processing');

drop trigger if exists trg_artist_wallet_movements_updated_at on public.artist_wallet_movements;
create trigger trg_artist_wallet_movements_updated_at
  before update on public.artist_wallet_movements
  for each row execute function public.set_updated_at();

-- Saldo disponible por moneda (lo usa la RPC de retiro).
create or replace function public.artist_wallet_available_balance(p_artist uuid, p_currency text)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(case
    when kind in ('release', 'adjustment') and status = 'completed' then amount
    when kind = 'withdrawal' and status in ('processing', 'completed') then -amount
    when kind in ('fee', 'refund') and status = 'completed' then -amount
    else 0 end), 0)
  from public.artist_wallet_movements
  where artist_user_id = p_artist and currency = upper(p_currency);
$$;

revoke all on function public.artist_wallet_available_balance(uuid, text) from public;
grant execute on function public.artist_wallet_available_balance(uuid, text) to authenticated;

-- Solicitud de retiro: valida destino propio, activo y verificado, y saldo
-- suficiente con un lock por artista para evitar retiros concurrentes.
-- La transferencia real la ejecuta el proveedor de pagos (fuera de esta migración).
create or replace function public.request_artist_wallet_withdrawal(
  p_destination_id uuid,
  p_amount numeric,
  p_currency text
)
returns public.artist_wallet_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_dest public.artist_payout_destinations;
  v_available numeric;
  v_row public.artist_wallet_movements;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid amount';
  end if;

  select * into v_dest
  from public.artist_payout_destinations
  where id = p_destination_id and artist_user_id = v_user_id and active;
  if not found then
    raise exception 'payout destination not found';
  end if;
  if v_dest.verification_status <> 'verified' then
    raise exception 'payout destination not verified';
  end if;

  perform pg_advisory_xact_lock(hashtext('artist_wallet_withdrawal:' || v_user_id::text));

  v_available := public.artist_wallet_available_balance(v_user_id, p_currency);
  if p_amount > v_available then
    raise exception 'insufficient balance';
  end if;

  insert into public.artist_wallet_movements (
    artist_user_id, kind, status, amount, currency, title, destination_id, occurred_at, metadata_json
  ) values (
    v_user_id, 'withdrawal', 'processing', p_amount, upper(p_currency),
    'Retiro a ' || v_dest.label, v_dest.id, now(),
    jsonb_build_object('requested_by', 'artist', 'destination_last4', right(regexp_replace(v_dest.account_identifier, '\s', '', 'g'), 4))
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_artist_wallet_withdrawal(uuid, numeric, text) from public;
grant execute on function public.request_artist_wallet_withdrawal(uuid, numeric, text) to authenticated;

-- ===================== lista de espera We Ötzi Card =====================
create table if not exists public.wallet_card_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source text not null default 'artist_wallet' check (source in ('artist_wallet', 'client_wallet', 'landing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

drop trigger if exists trg_wallet_card_waitlist_updated_at on public.wallet_card_waitlist;
create trigger trg_wallet_card_waitlist_updated_at
  before update on public.wallet_card_waitlist
  for each row execute function public.set_updated_at();

-- ===================== RLS =====================
alter table public.artist_payout_destinations enable row level security;
alter table public.artist_wallet_movements enable row level security;
alter table public.wallet_card_waitlist enable row level security;

drop policy if exists artist_payout_destinations_owner_all on public.artist_payout_destinations;
create policy artist_payout_destinations_owner_all on public.artist_payout_destinations
  for all to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);
drop policy if exists artist_payout_destinations_support_all on public.artist_payout_destinations;
create policy artist_payout_destinations_support_all on public.artist_payout_destinations
  for all to authenticated using (public.is_support_user()) with check (public.is_support_user());

drop policy if exists artist_wallet_movements_owner_read on public.artist_wallet_movements;
create policy artist_wallet_movements_owner_read on public.artist_wallet_movements
  for select to authenticated using ((select auth.uid()) = artist_user_id);
drop policy if exists artist_wallet_movements_support_all on public.artist_wallet_movements;
create policy artist_wallet_movements_support_all on public.artist_wallet_movements
  for all to authenticated using (public.is_support_user()) with check (public.is_support_user());

drop policy if exists wallet_card_waitlist_owner_all on public.wallet_card_waitlist;
create policy wallet_card_waitlist_owner_all on public.wallet_card_waitlist
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists wallet_card_waitlist_support_read on public.wallet_card_waitlist;
create policy wallet_card_waitlist_support_read on public.wallet_card_waitlist
  for select to authenticated using (public.is_support_user());

revoke all on table public.artist_payout_destinations from anon;
revoke all on table public.artist_wallet_movements from anon;
revoke all on table public.wallet_card_waitlist from anon;

revoke all on table public.artist_payout_destinations from authenticated;
revoke all on table public.artist_wallet_movements from authenticated;
revoke all on table public.wallet_card_waitlist from authenticated;

grant select, insert, update on table public.artist_payout_destinations to authenticated;
grant select on table public.artist_wallet_movements to authenticated;
grant select, insert, update on table public.wallet_card_waitlist to authenticated;

notify pgrst, 'reload schema';

commit;
