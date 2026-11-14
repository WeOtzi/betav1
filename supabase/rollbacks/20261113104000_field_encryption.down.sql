-- Reversa de 20261113104000_field_encryption.sql.
--
-- ⚠ Solo es segura ANTES de la limpieza de la columna en claro
--   (supabase/pending/20261113104500_drop_plaintext_payout_identifier.sql).
--   Si esa limpieza ya corrió, primero hay que restaurar account_identifier
--   descifrando con el servidor:  node scripts/encrypt-existing-data.cjs --restore-plaintext --apply
--   La reversa aborta si queda alguna fila sin el dato en claro.

begin;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'artist_payout_destinations'
               and column_name = 'account_identifier_enc')
     and exists (select 1 from public.artist_payout_destinations where account_identifier is null) then
    raise exception 'Hay destinos sin account_identifier en claro: restauralos con scripts/encrypt-existing-data.cjs --restore-plaintext antes de revertir.';
  end if;
end;
$$;

-- 6 · app_settings: políticas de 20260511000000 / 20260611000000.
drop policy if exists "Allow public read for public settings" on public.app_settings;
create policy "Allow public read for public settings" on public.app_settings
  for select to public using (is_public = true);

drop policy if exists app_settings_support_write on public.app_settings;
create policy app_settings_support_write on public.app_settings
  for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
             and policyname = 'Superadmin can manage app settings') then
    drop policy "Superadmin can manage app settings" on public.app_settings;
    create policy "Superadmin can manage app settings" on public.app_settings
      for all to authenticated
      using (lower(auth.jwt() ->> 'email') = 'isai@weotzi.com')
      with check (lower(auth.jwt() ->> 'email') = 'isai@weotzi.com');
  end if;
end;
$$;

drop trigger if exists trg_guard_app_setting_secret on public.app_settings;
drop function if exists public.guard_app_setting_secret();
drop function if exists public.app_setting_is_secret(text);

-- 5 · auditoría
drop table if exists public.sensitive_data_access_log;

-- 4 · revisión de soporte (cuerpo de 20261112170000).
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
  return v_row;
end;
$$;

-- 3 · retiro (cuerpo de 20261028150000).
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

-- privilegios de 20261028150000
revoke select, insert, update on table public.artist_payout_destinations from authenticated;
grant select, insert, update on table public.artist_payout_destinations to authenticated;

-- 2 · guard (cuerpo de 20261028150000).
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

-- 1 · columnas
drop index if exists public.artist_payout_destinations_key_id_idx;
alter table public.artist_payout_destinations
  drop constraint if exists artist_payout_destinations_no_plaintext,
  drop constraint if exists artist_payout_destinations_identifier_last4_format,
  drop constraint if exists artist_payout_destinations_identifier_enc_format,
  drop constraint if exists artist_payout_destinations_identifier_present,
  drop constraint if exists artist_payout_destinations_identifier_len;
alter table public.artist_payout_destinations
  drop column if exists account_identifier_last4,
  drop column if exists account_identifier_key_id,
  drop column if exists account_identifier_enc;
alter table public.artist_payout_destinations
  alter column account_identifier set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_account_identifier_check'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_account_identifier_check
      check (char_length(btrim(account_identifier)) between 4 and 64);
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
