-- Reversa de supabase/migrations/20261030201000_studio_contracts.sql (M2)
--
-- Deja la base en el estado de M1 (20261030200000_studio_affiliations):
-- restaura las definiciones previas de respond_to_studio_spot_counter_offer,
-- respond_to_studio_invitation y end_studio_membership (vivas al
-- 2026-10-30), el puente de M1 de decide_studio_spot_application, el stub
-- private.close_open_studio_contracts y la vista studio_public_roster sin
-- ends_on. Correr antes las reversas de M3–M5 si están aplicadas.
--
-- Datos: los contratos registrados se pierden (se borra studio_contracts).
-- Las membresías que quedaron activas al firmar siguen activas y las
-- postulaciones preseleccionadas siguen 'shortlisted' (ambos son estados
-- válidos de M1). studio_spots.benefit_tags se borra solo si la creó esta
-- migración: si existe availability_summary, la creó 20261028170000 y se
-- conserva.

begin;

-- 8. Inbox por contrato -------------------------------------------------

drop trigger if exists trg_inbox_from_studio_contract on public.studio_contracts;
drop function if exists public.inbox_from_studio_contract();

-- 7. Roster público sin vigencia (versión de M1) ------------------------

create or replace view public.studio_public_roster
with (security_invoker = false)
as
select
  m.id as membership_id,
  m.studio_id,
  m.artist_user_id,
  m.location_id,
  m.role,
  m.started_at,
  null::date as ends_on
from public.studio_artist_memberships m
where m.status = 'active';

alter view public.studio_public_roster owner to postgres;
revoke all on public.studio_public_roster from public, anon, authenticated;
grant select on public.studio_public_roster to anon, authenticated;

-- 6. Funciones existentes: definiciones previas -------------------------

CREATE OR REPLACE FUNCTION public.end_studio_membership(p_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_is_studio_owner boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.studios s
    where s.id = v_membership.studio_id and s.user_id = auth.uid()
  ) into v_is_studio_owner;

  if v_membership.artist_user_id <> auth.uid()
     and not v_is_studio_owner
     and not public.is_support_user() then
    raise exception 'membership not found' using errcode = '42501';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'only an active membership can be ended' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = 'ended', ended_at = v_now, updated_at = v_now
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', 'ended',
    'ended_at', v_now
  );
end;
$function$;

revoke all on function public.end_studio_membership(uuid) from public, anon;
grant execute on function public.end_studio_membership(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_studio_invitation(p_membership_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid invitation action' using errcode = '22023';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if not found or v_membership.artist_user_id <> auth.uid() then
    raise exception 'invitation not found' using errcode = '42501';
  end if;
  if v_membership.status not in ('pending_invite', 'pending_acceptance') then
    raise exception 'invitation already answered' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = case when p_action = 'accept' then 'active' else 'rejected' end,
      started_at = case when p_action = 'accept' then coalesce(started_at, v_now) else started_at end,
      ended_at = case when p_action = 'reject' then v_now else null end,
      updated_at = v_now
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', case when p_action = 'accept' then 'active' else 'rejected' end,
    'responded_at', v_now
  );
end;
$function$;

revoke all on function public.respond_to_studio_invitation(uuid, text) from public, anon;
grant execute on function public.respond_to_studio_invitation(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_studio_spot_counter_offer(p_offer_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_offer record;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid counter-offer action' using errcode = '22023';
  end if;

  select o.*, a.artist_user_id as applicant_artist_id, s.user_id as studio_owner_id
    into v_offer
  from public.studio_spot_counter_offers o
  join public.studio_spot_applications a on a.id = o.application_id
  join public.studio_spots sp on sp.id = a.spot_id
  join public.studios s on s.id = sp.studio_id
  where o.id = p_offer_id
  for update of o;

  if not found or v_offer.status <> 'pending' then
    raise exception 'pending counter-offer not found' using errcode = '23514';
  end if;
  if v_offer.author_role = 'studio' and v_offer.applicant_artist_id <> auth.uid() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;
  if v_offer.author_role = 'artist'
     and v_offer.studio_owner_id is distinct from auth.uid()
     and not public.is_support_user() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;

  update public.studio_spot_counter_offers
  set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
      decided_at = v_now
  where id = p_offer_id;

  if p_action = 'accept' then
    update public.studio_spot_counter_offers
    set status = 'superseded', decided_at = v_now
    where application_id = v_offer.application_id
      and id <> p_offer_id
      and status = 'pending';

    update public.studio_spot_applications
    set status = 'accepted', decided_at = v_now
    where id = v_offer.application_id;
  end if;

  return jsonb_build_object(
    'offer_id', p_offer_id,
    'application_id', v_offer.application_id,
    'status', case when p_action = 'accept' then 'accepted' else 'rejected' end,
    'decided_at', v_now
  );
end;
$function$;

revoke all on function public.respond_to_studio_spot_counter_offer(uuid, text) from public, anon;
grant execute on function public.respond_to_studio_spot_counter_offer(uuid, text) to authenticated;

-- Puente de M1 (definición previa a M2).
create or replace function public.decide_studio_spot_application(p_application_id uuid, p_status text)
returns public.studio_spot_applications
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
DECLARE v_application public.studio_spot_applications; v_spot public.studio_spots; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Iniciá sesión.' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'Decisión inválida.'; END IF;
  SELECT * INTO v_application FROM public.studio_spot_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;
  SELECT * INTO v_spot FROM public.studio_spots WHERE id = v_application.spot_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.studios WHERE id = v_spot.studio_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para decidir esta postulación.' USING ERRCODE = '42501';
  END IF;
  IF v_application.status = p_status THEN RETURN v_application; END IF;
  IF v_application.status NOT IN ('pending', 'viewed', 'shortlisted') THEN
    RAISE EXCEPTION 'Esta postulación ya fue resuelta o retirada.';
  END IF;
  IF p_status = 'accepted' THEN
    IF v_spot.status NOT IN ('open', 'filled') THEN RAISE EXCEPTION 'Abrí el spot antes de aceptar postulaciones.'; END IF;
    v_role := CASE v_spot.kind WHEN 'resident' THEN 'resident' WHEN 'itinerant' THEN 'itinerant' ELSE 'guest' END;
    INSERT INTO public.studio_artist_memberships (studio_id, artist_user_id, location_id, role, status, revenue_split_pct, started_at)
    SELECT v_spot.studio_id, v_application.artist_user_id, v_spot.location_id, v_role, 'active', v_spot.revenue_split_pct, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.studio_artist_memberships m
      WHERE m.studio_id = v_spot.studio_id
        AND m.artist_user_id = v_application.artist_user_id
        AND m.role = v_role
        AND m.status IN ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
    );
  END IF;
  UPDATE public.studio_spot_applications SET status = p_status, decided_at = now(), decided_by_user_id = auth.uid()
    WHERE id = p_application_id RETURNING * INTO v_application;
  RETURN v_application;
END; $function$;

revoke all on function public.decide_studio_spot_application(uuid, text) from public, anon;
grant execute on function public.decide_studio_spot_application(uuid, text) to authenticated;

-- 5. RPCs de contratos --------------------------------------------------

drop function if exists public.expire_studio_contracts(uuid);
drop function if exists public.terminate_studio_contract(uuid, text, boolean);
drop function if exists public.cancel_studio_contract(uuid, text);
drop function if exists public.decline_studio_contract(uuid, text);
drop function if exists public.sign_studio_contract(uuid, text, boolean);
drop function if exists public.issue_studio_contract(uuid, text, timestamptz);
drop function if exists public.get_current_contract_for_membership(uuid);
drop function if exists public.prepare_contract_for_membership(uuid);
drop function if exists public.prepare_contract_from_application(uuid);
drop function if exists public.save_studio_contract_draft(jsonb);

-- 4. Postulaciones ------------------------------------------------------

drop trigger if exists trg_spot_application_withdrawn_contracts on public.studio_spot_applications;
drop function if exists private.cancel_contracts_on_application_withdrawn();
drop trigger if exists trg_guard_spot_application_write on public.studio_spot_applications;
drop function if exists private.guard_spot_application_write();

-- 3. Helpers privados (vuelve el stub de M1) ----------------------------

create or replace function private.close_open_studio_contracts(
  p_membership_id uuid,
  p_application_id uuid,
  p_to_status text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 0;
end;
$$;

revoke all on function private.close_open_studio_contracts(uuid, uuid, text, text) from public, anon, authenticated;

drop function if exists private.build_studio_contract_snapshot(uuid);
drop function if exists private.clean_contract_text_array(text[]);
drop function if exists private.contract_text_array(jsonb, text);
drop function if exists private.next_studio_contract_number(uuid);

-- 2. Columnas en tablas existentes --------------------------------------

alter table public.studio_artist_memberships
  drop column if exists current_contract_id;

alter table public.studio_spots
  drop constraint if exists studio_spots_compensation_model_check,
  drop constraint if exists studio_spots_fixed_amount_check,
  drop constraint if exists studio_spots_fixed_currency_check,
  drop constraint if exists studio_spots_fixed_period_check,
  drop constraint if exists studio_spots_fixed_payer_check;

alter table public.studio_spots
  drop column if exists compensation_model,
  drop column if exists fixed_amount,
  drop column if exists fixed_currency,
  drop column if exists fixed_period,
  drop column if exists fixed_payer;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'studio_spots' and column_name = 'availability_summary'
  ) then
    alter table public.studio_spots drop constraint if exists studio_spots_benefit_tags_len;
    alter table public.studio_spots drop column if exists benefit_tags;
  end if;
end;
$$;

-- 1. Tabla de contratos -------------------------------------------------

drop table if exists public.studio_contracts;
drop function if exists public.set_studio_contracts_updated_at();

notify pgrst, 'reload schema';
commit;
