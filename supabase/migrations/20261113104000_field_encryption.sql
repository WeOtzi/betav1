-- Ronda 3c · grupo "cifrado": cifrado de datos sensibles a nivel de aplicación.
--
-- NO APLICADA. Aditiva e idempotente. Validar en el proyecto vivo solo dentro
-- de begin … rollback (script en output/figma-v3/reports/r3c-cifrado.md).
-- Reversa: supabase/rollbacks/20261113104000_field_encryption.down.sql
--
-- Orden de despliegue:
--   1. Configurar DATA_ENC_KEY en el servidor (ver deployments/DEPLOY.md).
--   2. Aplicar ESTA migración.
--   3. Desplegar el código (endpoints /api/payout-destinations*).
--   4. node scripts/encrypt-existing-data.cjs            (dry-run)
--      node scripts/encrypt-existing-data.cjs --apply    (cifra y verifica)
--      node scripts/encrypt-existing-data.cjs --verify   (todas deben coincidir)
--   5. Recién ahí, la limpieza de la columna en claro:
--      supabase/pending/20261113104500_drop_plaintext_payout_identifier.sql
--
-- 1 · artist_payout_destinations: el número de cuenta (CBU/IBAN/alias) pasa a
--     guardarse cifrado por el SERVIDOR con AES-256-GCM (lib/field-crypto.js).
--       account_identifier_enc     sobre "wo1:<key_id>:<iv>:<ct>:<tag>"
--       account_identifier_key_id  id de la clave (rotación)
--       account_identifier_last4   lo único que ve el navegador
--     account_identifier (en claro) deja de ser obligatoria y queda como legado
--     hasta la limpieza. authenticated pierde SELECT/INSERT sobre las columnas
--     sensibles: lee solo columnas seguras y escribe por el servidor.
-- 2 · guard_artist_payout_destination confía en service_role (el servidor
--     fuerza 'pending' en altas y cambios de cuenta/método/moneda), así un
--     re-cifrado o una rotación de clave no resetea la verificación.
-- 3 · request_artist_wallet_withdrawal toma los últimos 4 de la columna nueva.
-- 4 · support_review_payout_destination devuelve la fila sin el dato.
-- 5 · sensitive_data_access_log: quién vio un dato completo, cuándo y para qué.
-- 6 · app_settings: los secretos (apify_token, email_routing y toda clave con
--     token/secret/password/api_key) dejan de ser legibles por soporte o
--     clientes; solo service_role (el servidor) los lee y escribe.

begin;

-- ===================== 1 · columnas cifradas =====================
alter table public.artist_payout_destinations
  add column if not exists account_identifier_enc text,
  add column if not exists account_identifier_key_id text,
  add column if not exists account_identifier_last4 text;

alter table public.artist_payout_destinations
  alter column account_identifier drop not null;

-- El check original (inline) exigía 4-64 caracteres y not null implícito.
alter table public.artist_payout_destinations
  drop constraint if exists artist_payout_destinations_account_identifier_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_identifier_len'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_identifier_len
      check (account_identifier is null or char_length(btrim(account_identifier)) between 4 and 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_identifier_present'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_identifier_present
      check (account_identifier is not null or account_identifier_enc is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_identifier_enc_format'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_identifier_enc_format
      check (
        (account_identifier_enc is null and account_identifier_key_id is null)
        or (account_identifier_enc ~ '^wo1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
            and account_identifier_key_id ~ '^[A-Za-z0-9_-]{1,32}$'
            and split_part(account_identifier_enc, ':', 2) = account_identifier_key_id
            and char_length(account_identifier_enc) <= 400)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_identifier_last4_format'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_identifier_last4_format
      check (account_identifier_last4 is null or account_identifier_last4 ~ '^[A-Za-z0-9]{1,4}$');
  end if;
end;
$$;

create index if not exists artist_payout_destinations_key_id_idx
  on public.artist_payout_destinations (account_identifier_key_id)
  where account_identifier_enc is not null;

-- ===================== 2 · guard (service_role de confianza) =====================
create or replace function public.guard_artist_payout_destination()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Soporte decide la verificación; el servidor (service_role) ya aplicó las
  -- reglas de 'pending' y además re-cifra/rota sin cambiar el valor.
  if public.is_support_user() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.verified_at := null;
  else
    new.verification_status := old.verification_status;
    new.verified_at := old.verified_at;
    if new.account_identifier is distinct from old.account_identifier
      or new.account_identifier_enc is distinct from old.account_identifier_enc
      or new.method is distinct from old.method
      or new.currency is distinct from old.currency then
      new.verification_status := 'pending';
      new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- ===================== privilegios por columna =====================
-- authenticated (artista y soporte desde el navegador) lee solo columnas
-- seguras y puede cambiar is_default/active (RPC set_artist_default_payout_destination,
-- security invoker). Altas y cambios de cuenta: SOLO por el servidor.
revoke select, insert, update on table public.artist_payout_destinations from authenticated;
grant select (id, artist_user_id, method, label, holder_name, currency, rail, country_code,
              verification_status, verified_at, is_default, active, metadata_json,
              created_at, updated_at, account_identifier_last4)
  on table public.artist_payout_destinations to authenticated;
grant update (is_default, active) on table public.artist_payout_destinations to authenticated;
grant select, insert, update, delete on table public.artist_payout_destinations to service_role;

-- ===================== 3 · retiro: últimos 4 de la columna nueva =====================
-- Cuerpo de 20261028150000 salvo destination_last4.
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
    jsonb_build_object('requested_by', 'artist', 'destination_last4',
      coalesce(v_dest.account_identifier_last4,
               right(regexp_replace(coalesce(v_dest.account_identifier, ''), '\s', '', 'g'), 4)))
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_artist_wallet_withdrawal(uuid, numeric, text) from public;
grant execute on function public.request_artist_wallet_withdrawal(uuid, numeric, text) to authenticated;

-- ===================== 4 · revisión de soporte sin el dato =====================
-- Cuerpo de 20261112170000; la fila devuelta va sin cuenta ni sobre cifrado.
create or replace function public.support_review_payout_destination(
  p_destination_id uuid,
  p_decision text,
  p_note text default null
)
returns public.artist_payout_destinations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.artist_payout_destinations;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede verificar destinos de retiro.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('verified', 'rejected') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo del rechazo (mínimo 5 caracteres).' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  update public.artist_payout_destinations
     set verification_status = p_decision,
         verified_at = case when p_decision = 'verified' then now() else null end,
         metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
           'review', jsonb_build_object('decision', p_decision, 'note', v_note, 'reviewed_at', now()))
   where id = p_destination_id and active
  returning * into v_row;
  if not found then
    raise exception 'No encontramos ese destino (o fue dado de baja).' using errcode = '22023';
  end if;
  v_row.account_identifier := null;
  v_row.account_identifier_enc := null;
  v_row.account_identifier_key_id := null;
  return v_row;
end;
$$;

revoke all on function public.support_review_payout_destination(uuid, text, text) from public, anon;
grant execute on function public.support_review_payout_destination(uuid, text, text) to authenticated;

-- ===================== 5 · auditoría de accesos =====================
create table if not exists public.sensitive_data_access_log (
  id bigint generated always as identity primary key,
  table_name text not null check (char_length(table_name) between 1 and 80),
  column_name text not null check (char_length(column_name) between 1 and 80),
  row_id uuid not null,
  owner_user_id uuid,
  accessor_user_id uuid not null,
  accessor_role text not null check (accessor_role in ('owner', 'support', 'system')),
  purpose text not null check (char_length(purpose) between 1 and 60),
  created_at timestamptz not null default now()
);

create index if not exists sensitive_data_access_log_row_idx
  on public.sensitive_data_access_log (table_name, row_id, created_at desc);
create index if not exists sensitive_data_access_log_owner_idx
  on public.sensitive_data_access_log (owner_user_id, created_at desc);

alter table public.sensitive_data_access_log enable row level security;

drop policy if exists sensitive_data_access_log_support_read on public.sensitive_data_access_log;
create policy sensitive_data_access_log_support_read on public.sensitive_data_access_log
  for select to authenticated using (public.is_support_user());
drop policy if exists sensitive_data_access_log_owner_read on public.sensitive_data_access_log;
create policy sensitive_data_access_log_owner_read on public.sensitive_data_access_log
  for select to authenticated using ((select auth.uid()) = owner_user_id);

revoke all on table public.sensitive_data_access_log from anon, authenticated;
grant select on table public.sensitive_data_access_log to authenticated;
grant select, insert on table public.sensitive_data_access_log to service_role;

-- ===================== 6 · app_settings: secretos solo para service_role =====================
create or replace function public.app_setting_is_secret(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_key in ('apify_token', 'email_routing')
    or p_key ~* '(token|secret|password|passwd|api_?key|private_?key|credential)',
    false);
$$;

revoke all on function public.app_setting_is_secret(text) from public;
grant execute on function public.app_setting_is_secret(text) to anon, authenticated, service_role;

-- Un secreto nunca puede quedar público.
create or replace function public.guard_app_setting_secret()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.app_setting_is_secret(new.setting_key) then
    new.is_public := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_app_setting_secret on public.app_settings;
create trigger trg_guard_app_setting_secret
  before insert or update on public.app_settings
  for each row execute function public.guard_app_setting_secret();

update public.app_settings set is_public = false
 where public.app_setting_is_secret(setting_key) and is_public;

drop policy if exists "Allow public read for public settings" on public.app_settings;
create policy "Allow public read for public settings" on public.app_settings
  for select to public
  using (is_public = true and not public.app_setting_is_secret(setting_key));

drop policy if exists app_settings_support_write on public.app_settings;
create policy app_settings_support_write on public.app_settings
  for all to authenticated
  using (public.is_support_user() and not public.app_setting_is_secret(setting_key))
  with check (public.is_support_user() and not public.app_setting_is_secret(setting_key));

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
             and policyname = 'Superadmin can manage app settings') then
    drop policy "Superadmin can manage app settings" on public.app_settings;
    create policy "Superadmin can manage app settings" on public.app_settings
      for all to authenticated
      using (lower(auth.jwt() ->> 'email') = 'isai@weotzi.com' and not public.app_setting_is_secret(setting_key))
      with check (lower(auth.jwt() ->> 'email') = 'isai@weotzi.com' and not public.app_setting_is_secret(setting_key));
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
