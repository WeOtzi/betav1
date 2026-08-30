-- Centro de cuenta del artista: cobros tokenizados, ledger, sesiones,
-- integraciones y solicitudes auditables de eliminacion.
--
-- Seguridad: no se almacenan PAN, CVV/CVC ni credenciales de proveedor. El
-- campo provider_reference contiene solamente el identificador tokenizado que
-- entrega el proveedor y metadata_json rechaza las claves de tarjeta crudas.

create or replace function public.account_center_json_has_forbidden_keys(
  p_value jsonb,
  p_forbidden text[]
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $$
declare
  v_pair record;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_pair in select key, value from jsonb_each(p_value)
    loop
      if lower(v_pair.key) = any (p_forbidden)
        or public.account_center_json_has_forbidden_keys(v_pair.value, p_forbidden)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_pair in select value from jsonb_array_elements(p_value)
    loop
      if public.account_center_json_has_forbidden_keys(v_pair.value, p_forbidden) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function public.account_center_json_has_forbidden_keys(jsonb, text[]) from public;
grant execute on function public.account_center_json_has_forbidden_keys(jsonb, text[]) to authenticated;
grant execute on function public.account_center_json_has_forbidden_keys(jsonb, text[]) to service_role;

create table if not exists public.artist_payment_methods (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'mercado_pago', 'paypal', 'wise', 'bank_transfer')),
  method_type text not null check (method_type in ('card_token', 'wallet', 'bank_account_token')),
  provider_reference text not null,
  display_name text not null,
  brand text,
  last_four text check (last_four is null or last_four ~ '^[0-9A-Za-z]{4}$'),
  account_hint text,
  metadata_json jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_user_id, provider, provider_reference),
  check (length(provider_reference) between 4 and 255),
  constraint artist_payment_methods_reference_tokenized
    check (provider_reference !~ '^[0-9 -]{12,25}$'),
  constraint artist_payment_methods_metadata_safe
    check (not public.account_center_json_has_forbidden_keys(
      metadata_json,
      array['pan', 'card_number', 'cvv', 'cvc', 'security_code']
    ))
);

-- Mantiene la migracion repetible si la tabla fue creada por una ejecucion
-- parcial anterior con una version menos estricta de los checks.
alter table public.artist_payment_methods
  drop constraint if exists artist_payment_methods_reference_tokenized;
alter table public.artist_payment_methods
  add constraint artist_payment_methods_reference_tokenized
  check (provider_reference !~ '^[0-9 -]{12,25}$');
alter table public.artist_payment_methods
  drop constraint if exists artist_payment_methods_metadata_safe;
alter table public.artist_payment_methods
  add constraint artist_payment_methods_metadata_safe
  check (not public.account_center_json_has_forbidden_keys(
    metadata_json,
    array['pan', 'card_number', 'cvv', 'cvc', 'security_code']
  ));

create unique index if not exists artist_payment_methods_one_default
  on public.artist_payment_methods (artist_user_id)
  where is_default and active;
create index if not exists artist_payment_methods_artist_idx
  on public.artist_payment_methods (artist_user_id, active, created_at desc);

create or replace function public.set_artist_default_payment_method(p_method_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.artist_payment_methods
    where id = p_method_id and artist_user_id = v_user_id and active
  ) then
    raise exception 'payment method not found';
  end if;

  update public.artist_payment_methods
  set is_default = false
  where artist_user_id = v_user_id and active and is_default;

  update public.artist_payment_methods
  set is_default = true
  where id = p_method_id and artist_user_id = v_user_id and active;
end;
$$;

revoke all on function public.set_artist_default_payment_method(uuid) from public;
grant execute on function public.set_artist_default_payment_method(uuid) to authenticated;

drop trigger if exists trg_artist_payment_methods_updated_at on public.artist_payment_methods;
create trigger trg_artist_payment_methods_updated_at
  before update on public.artist_payment_methods
  for each row execute function public.set_updated_at();

create table if not exists public.artist_financial_entries (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  entry_type text not null check (entry_type in ('income', 'fee', 'payout', 'refund', 'adjustment')),
  title text not null,
  amount numeric(14,2) not null check (amount <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  occurred_at timestamptz not null default now(),
  external_reference text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artist_user_id, external_reference)
);

create index if not exists artist_financial_entries_artist_idx
  on public.artist_financial_entries (artist_user_id, occurred_at desc);

create table if not exists public.artist_account_sessions (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  auth_session_id uuid not null,
  device_name text not null,
  browser text,
  operating_system text,
  city text,
  country text,
  user_agent_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  unique (artist_user_id, auth_session_id)
);

create index if not exists artist_account_sessions_active_idx
  on public.artist_account_sessions (artist_user_id, last_seen_at desc)
  where revoked_at is null;

create table if not exists public.artist_integration_connections (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'apple_calendar', 'instagram', 'stripe', 'whatsapp_business')),
  status text not null default 'disconnected' check (status in ('disconnected', 'pending', 'connected', 'error')),
  account_label text,
  provider_reference text,
  scopes text[] not null default '{}'::text[],
  metadata_json jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (artist_user_id, provider),
  constraint artist_integration_connections_metadata_safe
    check (not public.account_center_json_has_forbidden_keys(
      metadata_json,
      array['access_token', 'refresh_token', 'id_token', 'api_key', 'client_secret', 'secret', 'password', 'authorization', 'cookie']
    ))
);

alter table public.artist_integration_connections
  drop constraint if exists artist_integration_connections_metadata_safe;
alter table public.artist_integration_connections
  add constraint artist_integration_connections_metadata_safe
  check (not public.account_center_json_has_forbidden_keys(
    metadata_json,
    array['access_token', 'refresh_token', 'id_token', 'api_key', 'client_secret', 'secret', 'password', 'authorization', 'cookie']
  ));

drop trigger if exists trg_artist_integrations_updated_at on public.artist_integration_connections;
create trigger trg_artist_integrations_updated_at
  before update on public.artist_integration_connections
  for each row execute function public.set_updated_at();

create table if not exists public.artist_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'requested' check (status in ('requested', 'in_review', 'approved', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  audit_note text
);

create unique index if not exists artist_deletion_one_open_request
  on public.artist_account_deletion_requests (artist_user_id)
  where status in ('requested', 'in_review', 'approved');
create index if not exists artist_deletion_requests_status_idx
  on public.artist_account_deletion_requests (status, requested_at desc);

alter table public.artist_payment_methods enable row level security;
alter table public.artist_financial_entries enable row level security;
alter table public.artist_account_sessions enable row level security;
alter table public.artist_integration_connections enable row level security;
alter table public.artist_account_deletion_requests enable row level security;

drop policy if exists artist_payment_methods_owner_all on public.artist_payment_methods;
create policy artist_payment_methods_owner_all on public.artist_payment_methods
  for all to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);
drop policy if exists artist_payment_methods_support_read on public.artist_payment_methods;
create policy artist_payment_methods_support_read on public.artist_payment_methods
  for select to authenticated using (public.is_support_user());

drop policy if exists artist_financial_entries_owner_read on public.artist_financial_entries;
create policy artist_financial_entries_owner_read on public.artist_financial_entries
  for select to authenticated using ((select auth.uid()) = artist_user_id);
drop policy if exists artist_financial_entries_support_all on public.artist_financial_entries;
create policy artist_financial_entries_support_all on public.artist_financial_entries
  for all to authenticated using (public.is_support_user()) with check (public.is_support_user());

drop policy if exists artist_account_sessions_owner_all on public.artist_account_sessions;
create policy artist_account_sessions_owner_all on public.artist_account_sessions
  for all to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);
drop policy if exists artist_account_sessions_support_read on public.artist_account_sessions;
create policy artist_account_sessions_support_read on public.artist_account_sessions
  for select to authenticated using (public.is_support_user());

drop policy if exists artist_integrations_owner_all on public.artist_integration_connections;
create policy artist_integrations_owner_all on public.artist_integration_connections
  for all to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);
drop policy if exists artist_integrations_support_read on public.artist_integration_connections;
create policy artist_integrations_support_read on public.artist_integration_connections
  for select to authenticated using (public.is_support_user());

drop policy if exists artist_deletion_requests_owner_insert on public.artist_account_deletion_requests;
create policy artist_deletion_requests_owner_insert on public.artist_account_deletion_requests
  for insert to authenticated with check ((select auth.uid()) = artist_user_id and status = 'requested');
drop policy if exists artist_deletion_requests_owner_read on public.artist_account_deletion_requests;
create policy artist_deletion_requests_owner_read on public.artist_account_deletion_requests
  for select to authenticated using ((select auth.uid()) = artist_user_id);
drop policy if exists artist_deletion_requests_support_all on public.artist_account_deletion_requests;
create policy artist_deletion_requests_support_all on public.artist_account_deletion_requests
  for all to authenticated using (public.is_support_user()) with check (public.is_support_user());

-- A document pending/rejected can be replaced by its owner. Approved documents
-- stay immutable; support retains the review policy from the base migration.
drop policy if exists artist_verification_docs_owner_update on public.artist_verification_documents;
create policy artist_verification_docs_owner_update on public.artist_verification_documents
  for update to authenticated
  using ((select auth.uid()) = artist_user_id and status in ('pendiente', 'rechazado'))
  with check ((select auth.uid()) = artist_user_id and status = 'pendiente');

drop policy if exists artist_verification_docs_owner_delete on public.artist_verification_documents;
create policy artist_verification_docs_owner_delete on public.artist_verification_documents
  for delete to authenticated
  using ((select auth.uid()) = artist_user_id and status in ('pendiente', 'rechazado'));

revoke all on table public.artist_payment_methods from anon;
revoke all on table public.artist_financial_entries from anon;
revoke all on table public.artist_account_sessions from anon;
revoke all on table public.artist_integration_connections from anon;
revoke all on table public.artist_account_deletion_requests from anon;

revoke all on table public.artist_payment_methods from authenticated;
revoke all on table public.artist_financial_entries from authenticated;
revoke all on table public.artist_account_sessions from authenticated;
revoke all on table public.artist_integration_connections from authenticated;
revoke all on table public.artist_account_deletion_requests from authenticated;

grant select, insert, update, delete on table public.artist_payment_methods to authenticated;
grant select, insert, update, delete on table public.artist_financial_entries to authenticated;
grant select, insert, update, delete on table public.artist_account_sessions to authenticated;
grant select, insert, update, delete on table public.artist_integration_connections to authenticated;
grant select, insert, update, delete on table public.artist_account_deletion_requests to authenticated;
