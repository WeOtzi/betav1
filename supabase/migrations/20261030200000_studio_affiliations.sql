-- =====================================================================
-- M1 · Plataforma de Estudios: alta en dos sentidos, reclamo y guards
-- Contrato: docs/plans/2026-10-30-estudios-plataforma.md (sección M1).
--
-- Estado: NO APLICADA. Se valida contra la base viva dentro de
-- BEGIN … ROLLBACK junto con M2–M5: M1 → M2 → M3 → M4 → M5 se aplican
-- juntas y en ese orden.
-- Dependencias: ninguna migración 20261030* previa (esta es la primera).
--   Deja puentes que M2 (20261030201000_studio_contracts.sql) reemplaza:
--   decide_studio_spot_application, private.close_open_studio_contracts
--   (stub sin contratos) y la vista studio_public_roster (ends_on nulo).
-- Reversa: supabase/rollbacks/20261030200000_studio_affiliations.down.sql
--   (si M2 está aplicada, correr antes la reversa de M2).
--
-- Contenido:
--   1. studio_artist_memberships: initiated_by, estado 'requested' y un
--      único vínculo abierto por (estudio, artista, rol) en lugar del
--      UNIQUE (studio, artist, role, status) que bloqueaba el historial.
--   2. Helpers privados: lock del par estudio↔artista y cierre de
--      contratos abiertos (stub hasta M2).
--   3. Guard private.guard_studio_membership_write (máquina de estados).
--   4. Puente de decide_studio_spot_application sin ON CONFLICT.
--   5. Roster público: fuera sam_public_select_active, vista
--      public.studio_public_roster sin split ni notas.
--   6. studio_membership_request_details + RPCs request/decide/withdraw.
--   7. inbox_from_studio_invitation con textos por (initiated_by, estado).
--   8. Guard private.guard_artist_studio_pointer (artists_db.studio_id).
--   9. Guard private.guard_studio_protected_columns (is_verified, user_id)
--      y fuera studios_anyone_create_via_app.
--  10. Reclamo de estudio: studio_claim_requests, request_studio_claim,
--      decide_studio_claim, list_unowned_studios y el parche de
--      private.complete_studio_registration.
--
-- Todas las funciones reemplazadas parten de pg_get_functiondef en vivo
-- (proyecto flbgmlvfiejfttlawnfu, 2026-10-30); la reversa restaura esa
-- definición previa.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Vínculos estudio ↔ artista
-- ---------------------------------------------------------------------

alter table public.studio_artist_memberships
  add column if not exists initiated_by text not null default 'studio';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studio_artist_memberships'::regclass
      and conname = 'studio_artist_memberships_initiated_by_check'
  ) then
    alter table public.studio_artist_memberships
      add constraint studio_artist_memberships_initiated_by_check
      check (initiated_by in ('studio', 'artist'));
  end if;
end;
$$;

comment on column public.studio_artist_memberships.initiated_by is
  'Quién abrió el vínculo: studio (invitación, decide el artista) o artist (solicitud, decide el estudio).';

-- 'requested' = el artista pidió el alta y decide el estudio.
-- 'pending_acceptance' / 'pending_invite' (legado) = invitó el estudio.
alter table public.studio_artist_memberships
  drop constraint if exists studio_artist_memberships_status_check;
alter table public.studio_artist_memberships
  add constraint studio_artist_memberships_status_check
  check (status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused', 'ended', 'rejected'));

-- El índice parcial nuevo exige que no haya dos vínculos abiertos del mismo
-- rol para el par. En vivo (2026-10-30) hay 0 duplicados; si aparecen, la
-- migración se detiene antes de tocar nada más.
do $$
begin
  if exists (
    select 1
    from public.studio_artist_memberships m
    where m.status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
    group by m.studio_id, m.artist_user_id, m.role
    having count(*) > 1
  ) then
    raise exception 'Hay vínculos abiertos duplicados para el mismo estudio, artista y rol: resolvelos antes de aplicar esta migración.'
      using errcode = '23505';
  end if;
end;
$$;

alter table public.studio_artist_memberships
  drop constraint if exists studio_artist_memberships_no_double_active;

create unique index if not exists studio_memberships_one_open_per_role
  on public.studio_artist_memberships (studio_id, artist_user_id, role)
  where status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused');

-- ---------------------------------------------------------------------
-- 2. Helpers privados
-- ---------------------------------------------------------------------

-- Serializa toda escritura de vínculos (membresías y contratos) de un par
-- estudio↔artista. Clave fija del contrato: 'sam:<studio>:<artist>'.
create or replace function private.lock_studio_artist_pair(p_studio_id uuid, p_artist_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sam:' || p_studio_id::text || ':' || p_artist_user_id::text, 0)
  );
end;
$$;

revoke all on function private.lock_studio_artist_pair(uuid, uuid) from public, anon, authenticated;

-- Puente M1: cierra los contratos 'draft'/'sent' de una membresía o una
-- postulación. La tabla studio_contracts nace en M2, que reemplaza este
-- cuerpo; mientras tanto no hay nada que cerrar.
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

-- ---------------------------------------------------------------------
-- 3. Guard de la máquina de estados de membresías
-- ---------------------------------------------------------------------

-- Las escrituras directas del cliente (dueño del estudio vía RLS) no pueden
-- saltear la máquina de estados. Las RPC SECURITY DEFINER corren como
-- postgres y pasan por el bypass estándar. current_contract_id se lee con
-- to_jsonb porque la columna nace en M2.
create or replace function private.guard_studio_membership_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending_acceptance', 'pending_invite')
       or new.initiated_by is distinct from 'studio'
       or (to_jsonb(new) ->> 'current_contract_id') is not null
       or new.started_at is not null then
      raise exception 'Desde el estudio solo se crean invitaciones pendientes: el alta se confirma cuando el artista acepta o firma.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.studio_id is distinct from old.studio_id
     or new.artist_user_id is distinct from old.artist_user_id
     or new.initiated_by is distinct from old.initiated_by
     or (to_jsonb(new) ->> 'current_contract_id') is distinct from (to_jsonb(old) ->> 'current_contract_id') then
    raise exception 'No podés cambiar el estudio, el artista, el origen ni el contrato de un vínculo.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'active' and new.status = 'paused')
    or (old.status = 'paused' and new.status = 'active')
    or (old.status in ('pending_invite', 'pending_acceptance') and new.status in ('rejected', 'ended'))
    or (old.status = 'requested' and new.status = 'rejected')
  ) then
    raise exception 'Ese cambio de estado del vínculo no está permitido desde acá.'
      using errcode = '23514';
  end if;

  if (to_jsonb(old) ->> 'current_contract_id') is not null
     and (new.role is distinct from old.role
          or new.revenue_split_pct is distinct from old.revenue_split_pct) then
    raise exception 'El rol y el reparto se editan con una nueva versión del contrato.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_studio_membership_write() from public, anon, authenticated;

drop trigger if exists trg_guard_studio_membership_write on public.studio_artist_memberships;
create trigger trg_guard_studio_membership_write
  before insert or update on public.studio_artist_memberships
  for each row execute function private.guard_studio_membership_write();

-- ---------------------------------------------------------------------
-- 4. Puente de decide_studio_spot_application
-- ---------------------------------------------------------------------

-- Cuerpo vivo con un único cambio funcional: el INSERT … ON CONFLICT
-- (studio_id, artist_user_id, role, status) pasa a INSERT … SELECT … WHERE
-- NOT EXISTS (fila abierta del mismo estudio/artista/rol), porque ese UNIQUE
-- ya no existe. Pasa a SECURITY DEFINER: el guard de membresías bloquea los
-- INSERT 'active' directos y esta función inserta uno; la autorización ya
-- estaba explícita en el cuerpo (dueño del estudio). M2 la reemplaza.
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

-- ---------------------------------------------------------------------
-- 5. Roster público
-- ---------------------------------------------------------------------

-- La policy pública exponía revenue_split_pct y notes a anon.
drop policy if exists sam_public_select_active on public.studio_artist_memberships;

-- Proyección pública del roster activo (owner postgres, security_invoker
-- off): solo columnas aptas para el perfil del estudio. M2 la reemplaza con
-- el join al contrato firmado para ends_on.
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
-- La vista es auto-actualizable: sin este revoke los grants por defecto
-- permitirían escribir en la tabla como owner.
revoke all on public.studio_public_roster from public, anon, authenticated;
grant select on public.studio_public_roster to anon, authenticated;

comment on view public.studio_public_roster is
  'Roster activo público por estudio (sin reparto ni notas). Reemplaza la policy sam_public_select_active.';

-- ---------------------------------------------------------------------
-- 6. Solicitudes de alta del artista
-- ---------------------------------------------------------------------

create table if not exists public.studio_membership_request_details (
  membership_id uuid primary key references public.studio_artist_memberships(id) on delete cascade,
  message text,
  portfolio_url text,
  proposed_start_date date,
  styles text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  constraint smrd_message_len check (message is null or char_length(message) <= 1000),
  constraint smrd_portfolio_url_http check (portfolio_url is null or portfolio_url ~* '^https?://')
);

comment on table public.studio_membership_request_details is
  'Detalle de la solicitud de alta que manda el artista (membresía initiated_by=artist). Solo lectura para las partes; se escribe por RPC.';

alter table public.studio_membership_request_details enable row level security;
revoke all on public.studio_membership_request_details from anon, authenticated;
grant select on public.studio_membership_request_details to authenticated;

drop policy if exists smrd_parties_select on public.studio_membership_request_details;
create policy smrd_parties_select on public.studio_membership_request_details
  for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1
      from public.studio_artist_memberships m
      join public.studios s on s.id = m.studio_id
      where m.id = studio_membership_request_details.membership_id
        and (m.artist_user_id = (select auth.uid()) or s.user_id = (select auth.uid()))
    )
  );

-- El artista pide el alta en un estudio (tenga o no dueño todavía).
create or replace function public.request_studio_membership(
  p_studio_id uuid,
  p_role text default 'resident',
  p_location_id uuid default null,
  p_message text default null,
  p_portfolio_url text default null,
  p_proposed_start_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_artist public.artists_db%rowtype;
  v_studio public.studios%rowtype;
  v_role text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'resident');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_portfolio text := nullif(btrim(coalesce(p_portfolio_url, '')), '');
  v_now timestamptz := timezone('utc', now());
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para solicitar el alta.' using errcode = '42501';
  end if;

  select * into v_artist from public.artists_db a where a.user_id = v_uid;
  if not found then
    raise exception 'Necesitás un perfil de artista para solicitar el alta en un estudio.' using errcode = '42501';
  end if;

  select * into v_studio from public.studios s where s.id = p_studio_id;
  if not found or not coalesce(v_studio.is_active, false) then
    raise exception 'Ese estudio no está disponible.' using errcode = '22023';
  end if;
  if v_role not in ('resident', 'guest', 'itinerant') then
    raise exception 'Elegí un rol válido: residente, guest o itinerante.' using errcode = '22023';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.studio_locations l
    where l.id = p_location_id and l.studio_id = p_studio_id
  ) then
    raise exception 'La sede elegida no pertenece a ese estudio.' using errcode = '22023';
  end if;
  if v_message is not null and char_length(v_message) > 1000 then
    raise exception 'El mensaje admite hasta 1000 caracteres.' using errcode = '22023';
  end if;
  if v_portfolio is not null and (v_portfolio !~* '^https?://' or char_length(v_portfolio) > 500) then
    raise exception 'El portfolio tiene que ser un enlace http(s).' using errcode = '22023';
  end if;

  perform private.lock_studio_artist_pair(p_studio_id, v_uid);

  if exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = p_studio_id
      and m.artist_user_id = v_uid
      and m.status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
  ) then
    raise exception 'Ya tenés una solicitud o vínculo abierto con este estudio.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = p_studio_id
      and m.artist_user_id = v_uid
      and m.initiated_by = 'artist'
      and coalesce(m.invited_at, m.created_at) > v_now - interval '72 hours'
  ) then
    raise exception 'Esperá unos días antes de volver a solicitar el alta en este estudio.' using errcode = '23514';
  end if;

  insert into public.studio_artist_memberships (
    studio_id, artist_user_id, location_id, role, status, initiated_by, invited_at
  ) values (
    p_studio_id, v_uid, p_location_id, v_role, 'requested', 'artist', v_now
  )
  returning id into v_membership_id;

  insert into public.studio_membership_request_details (
    membership_id, message, portfolio_url, proposed_start_date, styles
  ) values (
    v_membership_id, v_message, v_portfolio, p_proposed_start_date,
    coalesce(v_artist.styles_array::text[], array[]::text[])
  );

  return jsonb_build_object(
    'membership_id', v_membership_id,
    'studio_has_owner', v_studio.user_id is not null
  );
end;
$$;

revoke all on function public.request_studio_membership(uuid, text, uuid, text, text, date) from public, anon;
grant execute on function public.request_studio_membership(uuid, text, uuid, text, text, date) to authenticated;

-- El dueño del estudio (o soporte) aprueba o rechaza una solicitud.
create or replace function public.decide_studio_membership_request(
  p_membership_id uuid,
  p_decision text,
  p_role text default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.studio_artist_memberships%rowtype;
  v_role text;
  v_location uuid;
  v_status text;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accept', 'reject') then
    raise exception 'Decisión inválida: usá accept o reject.' using errcode = '22023';
  end if;

  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.studios s where s.id = v_membership.studio_id and s.user_id = v_uid)
    or public.is_support_user()
  ) then
    raise exception 'No tenés permiso para decidir esta solicitud.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);
  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id for update;

  if v_membership.status <> 'requested' then
    raise exception 'Esta solicitud ya fue resuelta.' using errcode = '23514';
  end if;

  if p_decision = 'accept' then
    v_role := coalesce(nullif(btrim(coalesce(p_role, '')), ''), v_membership.role);
    if v_role not in ('resident', 'guest', 'itinerant') then
      raise exception 'Elegí un rol válido: residente, guest o itinerante.' using errcode = '22023';
    end if;
    if p_location_id is not null and not exists (
      select 1 from public.studio_locations l
      where l.id = p_location_id and l.studio_id = v_membership.studio_id
    ) then
      raise exception 'La sede elegida no pertenece a tu estudio.' using errcode = '22023';
    end if;
    v_location := coalesce(p_location_id, v_membership.location_id);
    if v_role <> v_membership.role and exists (
      select 1 from public.studio_artist_memberships m
      where m.studio_id = v_membership.studio_id
        and m.artist_user_id = v_membership.artist_user_id
        and m.role = v_role
        and m.id <> p_membership_id
        and m.status in ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
    ) then
      raise exception 'El artista ya tiene otro vínculo abierto con ese rol.' using errcode = '23514';
    end if;

    update public.studio_artist_memberships m
    set status = 'active',
        role = v_role,
        location_id = v_location,
        started_at = coalesce(m.started_at, v_now),
        ended_at = null,
        updated_at = v_now
    where m.id = p_membership_id;
    v_status := 'active';
  else
    update public.studio_artist_memberships m
    set status = 'rejected', ended_at = v_now, updated_at = v_now
    where m.id = p_membership_id;
    v_status := 'rejected';
  end if;

  -- La solicitud se cerró: los borradores o contratos enviados que hubiera
  -- preparado el estudio para ella quedan cancelados.
  perform private.close_open_studio_contracts(
    p_membership_id, null, 'cancelled',
    case when v_status = 'active' then 'La solicitud se aprobó sin contrato' else 'La solicitud no fue aprobada' end
  );

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', v_status,
    'artist_user_id', v_membership.artist_user_id,
    'studio_id', v_membership.studio_id
  );
end;
$$;

revoke all on function public.decide_studio_membership_request(uuid, text, text, uuid) from public, anon;
grant execute on function public.decide_studio_membership_request(uuid, text, text, uuid) to authenticated;

-- El artista retira su propia solicitud pendiente.
create or replace function public.withdraw_studio_membership_request(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.studio_artist_memberships%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id;
  if not found or v_membership.artist_user_id <> v_uid then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);
  select * into v_membership from public.studio_artist_memberships m where m.id = p_membership_id for update;

  if v_membership.status <> 'requested' then
    raise exception 'Esta solicitud ya no está pendiente.' using errcode = '23514';
  end if;

  update public.studio_artist_memberships m
  set status = 'ended', ended_at = v_now, updated_at = v_now
  where m.id = p_membership_id;

  perform private.close_open_studio_contracts(p_membership_id, null, 'cancelled', 'Retiraste la solicitud');
end;
$$;

revoke all on function public.withdraw_studio_membership_request(uuid) from public, anon;
grant execute on function public.withdraw_studio_membership_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Inbox de invitaciones y solicitudes
-- ---------------------------------------------------------------------

-- Parche sobre la definición viva: el mensaje depende de (initiated_by,
-- transición). Las invitaciones del estudio conservan sus textos.
create or replace function public.inbox_from_studio_invitation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_studio public.studios%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_message text;
  v_name text;
  v_old_status text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  v_old_status := case when tg_op = 'UPDATE' then old.status end;
  select * into v_studio from public.studios where id = new.studio_id;
  select * into v_detail from public.studio_membership_invitation_details where membership_id = new.id;
  v_name := coalesce(nullif(btrim(v_studio.name), ''), 'el estudio');
  v_message := case
    when new.initiated_by = 'artist' and new.status = 'requested' then 'Solicitud enviada a ' || v_name || '.'
    when new.initiated_by = 'artist' and v_old_status = 'requested' and new.status = 'active' then v_name || ' aprobó tu solicitud.'
    when new.initiated_by = 'artist' and v_old_status = 'requested' and new.status = 'rejected' then v_name || ' no aprobó tu solicitud.'
    when new.initiated_by = 'artist' and v_old_status = 'requested' and new.status = 'ended' then 'Retiraste tu solicitud.'
    when v_old_status = 'active' and new.status = 'ended' then 'Tu vínculo con ' || v_name || ' terminó.'
    when new.status = 'paused' then 'Tu vínculo con ' || v_name || ' quedó en pausa.'
    when v_old_status = 'paused' and new.status = 'active' then 'Tu vínculo con ' || v_name || ' se reactivó.'
    when v_old_status in ('pending_invite', 'pending_acceptance') and new.status = 'ended' then 'El estudio canceló la invitación.'
    when new.status = 'active' then 'Invitación aceptada. Ya formás parte del roster del estudio.'
    when new.status = 'rejected' then 'La invitación fue rechazada.'
    when new.status = 'pending_invite' then 'Recibiste una nueva invitación del estudio.'
    else 'El estudio te invitó a sumarte a su roster.'
  end;
  perform public.ensure_domain_inbox_thread(
    new.artist_user_id, 'invitations', 'studio_invitation', new.id,
    v_studio.user_id, v_studio.name,
    coalesce(v_detail.duration_label, case when new.initiated_by = 'artist' then 'Solicitud de alta' else 'Invitación al estudio' end),
    jsonb_build_object(
      'membership_id', new.id, 'studio_id', v_studio.id, 'studio_name', v_studio.name,
      'role', new.role, 'membership_status', new.status, 'initiated_by', new.initiated_by,
      'proposed_start_date', v_detail.proposed_start_date,
      'proposed_end_date', v_detail.proposed_end_date
    ), v_message
  );
  return new;
end;
$function$;

revoke execute on function public.inbox_from_studio_invitation() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. artists_db.studio_id solo apunta a un estudio con vínculo activo
-- ---------------------------------------------------------------------

-- Sin error: si el cliente manda un studio_id sin membresía activa se
-- conserva el anterior, así los guardados del dashboard no se rompen.
create or replace function private.guard_artist_studio_pointer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if new.studio_id is distinct from old.studio_id
     and new.studio_id is not null
     and not exists (
       select 1 from public.studio_artist_memberships m
       where m.artist_user_id = new.user_id
         and m.studio_id = new.studio_id
         and m.status = 'active'
     ) then
    new.studio_id := old.studio_id;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_artist_studio_pointer() from public, anon, authenticated;

drop trigger if exists trg_guard_artist_studio_pointer on public.artists_db;
create trigger trg_guard_artist_studio_pointer
  before update of studio_id on public.artists_db
  for each row execute function private.guard_artist_studio_pointer();

-- ---------------------------------------------------------------------
-- 9. Columnas protegidas de studios
-- ---------------------------------------------------------------------

-- Antes de quitar la policy se verificó que el frontend no inserta estudios
-- con user_id (studio-auth.js usa complete_studio_registration; register.js
-- y dashboard.js solo crean fichas de catálogo sin dueño).
create or replace function private.guard_studio_protected_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_verified := false;
    return new;
  end if;

  if new.is_verified is distinct from old.is_verified then
    raise exception 'La verificación del estudio la gestiona soporte de We Ötzi.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'El dueño del estudio solo cambia con un reclamo aprobado por soporte.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_studio_protected_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_studio_protected_columns on public.studios;
create trigger trg_guard_studio_protected_columns
  before insert or update on public.studios
  for each row execute function private.guard_studio_protected_columns();

-- Los estudios con dueño se crean solo por complete_studio_registration
-- (SECURITY DEFINER) o por soporte ("Support can manage studios"). Las
-- fichas de catálogo sin dueño siguen por studios_authenticated_catalog_insert.
drop policy if exists studios_anyone_create_via_app on public.studios;

-- ---------------------------------------------------------------------
-- 10. Reclamo de estudio
-- ---------------------------------------------------------------------

create table if not exists public.studio_claim_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence text,
  contact_name text,
  contact_phone text,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  constraint studio_claim_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint studio_claim_requests_evidence_len check (evidence is null or char_length(evidence) <= 1000),
  constraint studio_claim_requests_contact_name_len check (contact_name is null or char_length(contact_name) <= 160),
  constraint studio_claim_requests_contact_phone_len check (contact_phone is null or char_length(contact_phone) <= 40),
  constraint studio_claim_requests_note_len check (decision_note is null or char_length(decision_note) <= 1000)
);

comment on table public.studio_claim_requests is
  'Reclamos de fichas de estudio sin dueño. Se crean y deciden solo por RPC; soporte aprueba.';

create unique index if not exists studio_claim_requests_one_pending_per_studio
  on public.studio_claim_requests (studio_id) where status = 'pending';
create unique index if not exists studio_claim_requests_one_pending_per_user
  on public.studio_claim_requests (user_id) where status = 'pending';
create index if not exists studio_claim_requests_user_recent_idx
  on public.studio_claim_requests (user_id, created_at desc);

alter table public.studio_claim_requests enable row level security;
revoke all on public.studio_claim_requests from anon, authenticated;
grant select on public.studio_claim_requests to authenticated;

drop policy if exists studio_claim_requests_own_select on public.studio_claim_requests;
create policy studio_claim_requests_own_select on public.studio_claim_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists studio_claim_requests_support_select on public.studio_claim_requests;
create policy studio_claim_requests_support_select on public.studio_claim_requests
  for select to authenticated
  using (public.is_support_user());

create or replace function public.request_studio_claim(
  p_studio_id uuid,
  p_evidence text,
  p_contact_name text default null,
  p_contact_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_studio public.studios%rowtype;
  v_existing public.studio_claim_requests%rowtype;
  v_evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
  v_contact_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_contact_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para reclamar el estudio.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    raise exception 'Confirmá tu email antes de reclamar el estudio.' using errcode = '42501';
  end if;
  if v_evidence is null then
    raise exception 'Contanos cómo podemos verificar que el estudio es tuyo.' using errcode = '22023';
  end if;
  if char_length(v_evidence) > 1000 then
    raise exception 'La evidencia admite hasta 1000 caracteres.' using errcode = '22023';
  end if;
  if (v_contact_name is not null and char_length(v_contact_name) > 160)
     or (v_contact_phone is not null and char_length(v_contact_phone) > 40) then
    raise exception 'Revisá el nombre y el teléfono de contacto.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('studio_claim:' || v_uid::text, 0));

  select * into v_studio from public.studios s where s.id = p_studio_id for update;
  if not found then
    raise exception 'Estudio no encontrado.' using errcode = '22023';
  end if;
  if exists (select 1 from public.studios s where s.user_id = v_uid) then
    raise exception 'Tu cuenta ya administra un estudio.' using errcode = '23514';
  end if;
  if v_studio.user_id is not null then
    raise exception 'Este estudio ya tiene dueño en We Ötzi.' using errcode = '23514';
  end if;

  select * into v_existing
  from public.studio_claim_requests c
  where c.user_id = v_uid and c.status = 'pending';
  if found then
    if v_existing.studio_id = p_studio_id then
      return v_existing.id;
    end if;
    raise exception 'Ya tenés un reclamo en revisión.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.studio_claim_requests c
    where c.studio_id = p_studio_id and c.status = 'pending'
  ) then
    raise exception 'Este estudio ya tiene un reclamo en revisión.' using errcode = '23514';
  end if;

  insert into public.studio_claim_requests (studio_id, user_id, evidence, contact_name, contact_phone)
  values (p_studio_id, v_uid, v_evidence, v_contact_name, v_contact_phone)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.request_studio_claim(uuid, text, text, text) from public, anon;
grant execute on function public.request_studio_claim(uuid, text, text, text) to authenticated;

create or replace function public.decide_studio_claim(
  p_claim_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.studio_claim_requests%rowtype;
  v_studio public.studios%rowtype;
  v_email text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null or not public.is_support_user() then
    raise exception 'Solo soporte de We Ötzi decide los reclamos de estudios.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Decisión inválida: usá approve o reject.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'La nota admite hasta 1000 caracteres.' using errcode = '22023';
  end if;

  select * into v_claim from public.studio_claim_requests c where c.id = p_claim_id;
  if not found then
    raise exception 'Reclamo no encontrado.' using errcode = '22023';
  end if;

  select * into v_studio from public.studios s where s.id = v_claim.studio_id for update;
  select * into v_claim from public.studio_claim_requests c where c.id = p_claim_id for update;

  if v_claim.status <> 'pending' then
    raise exception 'Este reclamo ya fue resuelto.' using errcode = '23514';
  end if;

  if p_decision = 'reject' then
    update public.studio_claim_requests c
    set status = 'rejected', decided_at = v_now, decided_by = v_uid, decision_note = v_note
    where c.id = p_claim_id;
    return jsonb_build_object(
      'claim_id', p_claim_id, 'status', 'rejected',
      'studio_id', v_claim.studio_id, 'user_id', v_claim.user_id
    );
  end if;

  if v_studio.user_id is not null then
    raise exception 'El estudio ya tiene dueño.' using errcode = '23514';
  end if;
  if exists (select 1 from public.studios s where s.user_id = v_claim.user_id) then
    raise exception 'Esa cuenta ya administra otro estudio.' using errcode = '23514';
  end if;
  select u.email into v_email from auth.users u where u.id = v_claim.user_id;
  if v_email is null then
    raise exception 'La cuenta del reclamo no tiene email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.studios s where s.email = v_email and s.id <> v_studio.id) then
    raise exception 'Ese email ya está asociado a otro estudio.' using errcode = '23514';
  end if;

  update public.studios s
  set user_id = v_claim.user_id,
      email = v_email,
      profile_complete = false,
      updated_at = v_now
  where s.id = v_studio.id;

  update public.studio_claim_requests c
  set status = 'approved', decided_at = v_now, decided_by = v_uid, decision_note = v_note
  where c.id = p_claim_id;

  update public.studio_claim_requests c
  set status = 'rejected', decided_at = v_now, decided_by = v_uid,
      decision_note = 'Se aprobó otro reclamo para este estudio.'
  where c.studio_id = v_studio.id
    and c.status = 'pending'
    and c.id <> p_claim_id;

  return jsonb_build_object(
    'claim_id', p_claim_id, 'status', 'approved',
    'studio_id', v_studio.id, 'user_id', v_claim.user_id
  );
end;
$$;

revoke all on function public.decide_studio_claim(uuid, text, text) from public, anon;
grant execute on function public.decide_studio_claim(uuid, text, text) to authenticated;

-- Buscador del catálogo para el registro. Se usa antes de crear la cuenta,
-- por eso anon también la ejecuta: solo devuelve columnas que la tabla
-- studios ya expone en lectura pública.
create or replace function public.list_unowned_studios(p_query text)
returns table (id uuid, name text, slug text, city text, country text, logo_image text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := left(btrim(coalesce(p_query, '')), 80);
  v_pattern text;
begin
  if char_length(v_query) < 2 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select s.id, s.name, s.slug, s.city, s.country, s.logo_image
  from public.studios s
  where s.user_id is null
    and s.is_active
    and (s.name ilike v_pattern or s.normalized_name ilike v_pattern or s.city ilike v_pattern)
  order by (lower(s.name) like lower(v_query) || '%') desc, s.name
  limit 20;
end;
$$;

revoke all on function public.list_unowned_studios(text) from public;
grant execute on function public.list_unowned_studios(text) to anon, authenticated;

-- Parche sobre la definición viva de private.complete_studio_registration:
-- si el nombre normalizado coincide con una ficha de catálogo sin dueño, se
-- ofrece reclamarla en lugar de chocar con el UNIQUE (normalized_name).
CREATE OR REPLACE FUNCTION private.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 RETURNS studios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_studio public.studios; v_location jsonb; v_name text; v_slug text; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo e iniciá sesión para completar el registro.' USING ERRCODE = '42501'; END IF;
  -- Serializes retries from multiple tabs and prevents duplicate owned studios.
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  SELECT * INTO v_studio FROM public.studios WHERE user_id = auth.uid();
  IF FOUND THEN RETURN v_studio; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo antes de crear el estudio.'; END IF;
  v_name := nullif(btrim(p_profile->>'name'), '');
  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 160 THEN RAISE EXCEPTION 'El nombre debe tener entre 2 y 160 caracteres.'; END IF;
  -- Estudios M1: la ficha ya existe en el catálogo y no tiene dueño.
  IF EXISTS (SELECT 1 FROM public.studios WHERE normalized_name = upper(v_name) AND user_id IS NULL) THEN
    RAISE EXCEPTION 'Ese estudio ya está en We Ötzi: reclamalo desde el registro.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_locations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Agregá al menos una sede.'; END IF;
  IF jsonb_array_length(p_locations) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Agregá entre 1 y 30 sedes.'; END IF;
  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := coalesce(nullif(v_slug, ''), 'estudio') || '-' || left(replace(auth.uid()::text, '-', ''), 8);
  INSERT INTO public.studios (user_id, email, name, normalized_name, slug, tagline, bio, founded_year, languages,
    instagram, whatsapp, website, contact_phone, cover_image, logo_image, photo_feed_items, is_active, profile_complete)
  VALUES (auth.uid(), v_email, v_name, upper(v_name), v_slug, nullif(p_profile->>'tagline', ''), nullif(p_profile->>'bio', ''),
    nullif(p_profile->>'founded_year', '')::integer,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_profile->'languages', '[]'::jsonb))),
    nullif(p_profile->>'instagram', ''), nullif(p_profile->>'whatsapp', ''), nullif(p_profile->>'website', ''),
    nullif(p_profile->>'contact_phone', ''), nullif(p_profile->>'cover_image', ''), nullif(p_profile->>'logo_image', ''),
    coalesce(p_profile->'photo_feed_items', '[]'::jsonb), true, false)
  RETURNING * INTO v_studio;
  FOR v_location IN SELECT value FROM jsonb_array_elements(p_locations) LOOP
    PERFORM public.save_studio_location(v_studio.id, NULL, v_location);
  END LOOP;
  SELECT * INTO v_studio FROM public.studios WHERE id = v_studio.id;
  RETURN v_studio;
END; $function$;

notify pgrst, 'reload schema';
commit;
