-- =====================================================================
-- M3 · Agenda e inventario del estudio (Plataforma de Estudios v2)
-- Contrato: docs/plans/2026-10-30-estudios-plataforma.md, sección M3.
--
-- Agenda
--   1) studio_bookings: client_phone, service_description (≤500),
--      deposit_amount (≥0), created_by_role ('studio'|'support', lo fija el
--      trigger según is_support_user()) y created_by_user_id. El status suma
--      'no_show'.
--   2) RLS: el artista lee sus citas (studio_bookings_artist_select) y
--      soporte opera todo (studio_bookings_support_all).
--   3) Fuentes de "ocupado" compartidas por private.artist_busy_conflict y
--      list_studio_artist_busy_blocks (helper private.artist_busy_intervals):
--        a) artist_calendar_events bloqueantes (mismo conjunto y misma
--           expansión semanal que prevent_artist_calendar_overlap);
--        b) quotation_sessions no canceladas de cotizaciones del artista;
--        c) studio_bookings confirmadas del artista en OTROS estudios.
--   4) validate_studio_booking (desde la definición viva): lock por artista
--      (misma clave que prevent_artist_calendar_overlap), chequeo de ocupado
--      al confirmar/reprogramar y reparto (artist/studio split) al completar
--      según el contrato firmado o el revenue_split_pct de la membresía.
--   5) RPCs check_studio_booking_availability y list_studio_artist_busy_blocks.
--
-- Inventario
--   6) studio_inventory_movements.kind suma 'assignment' (entrega a artista,
--      resta stock) y 'return' (devolución, suma stock); trigger BEFORE
--      studio_inventory_movements_prepare; apply_inventory_movement suma los
--      signos nuevos; vistas studio_artist_material_balance y
--      studio_material_assignment_monthly; RPC
--      list_my_studio_material_assignments para el artista.
--
-- Estado: NO APLICADA. Aplicarla es decisión del usuario.
-- Depende de (se aplican juntas y en orden):
--   - 20261030200000_studio_affiliations.sql (M1): estados de
--     studio_artist_memberships ('active', 'paused', ...).
--   - 20261030201000_studio_contracts.sql (M2): public.studio_contracts y
--     studio_artist_memberships.current_contract_id (reparto al completar).
-- Rollback: supabase/rollbacks/20261030202000_studio_agenda_inventory.down.sql
-- (restaura las definiciones vivas previas de validate_studio_booking,
-- complete_studio_booking y apply_inventory_movement).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Agenda · columnas y estados nuevos de studio_bookings
-- ---------------------------------------------------------------------
alter table public.studio_bookings
  add column if not exists client_phone text,
  add column if not exists service_description text,
  add column if not exists deposit_amount numeric(12,2),
  add column if not exists created_by_role text not null default 'studio',
  add column if not exists created_by_user_id uuid default auth.uid();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studio_bookings_service_description_len'
                 and conrelid = 'public.studio_bookings'::regclass) then
    alter table public.studio_bookings
      add constraint studio_bookings_service_description_len
      check (service_description is null or char_length(service_description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studio_bookings_deposit_amount_check'
                 and conrelid = 'public.studio_bookings'::regclass) then
    alter table public.studio_bookings
      add constraint studio_bookings_deposit_amount_check
      check (deposit_amount is null or deposit_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studio_bookings_created_by_role_check'
                 and conrelid = 'public.studio_bookings'::regclass) then
    alter table public.studio_bookings
      add constraint studio_bookings_created_by_role_check
      check (created_by_role in ('studio', 'support'));
  end if;
end;
$$;

-- El status suma 'no_show' (todas las filas vivas cumplen el CHECK nuevo).
alter table public.studio_bookings drop constraint if exists studio_bookings_status_check;
alter table public.studio_bookings
  add constraint studio_bookings_status_check
  check (status in ('confirmed', 'completed', 'cancelled', 'no_show'));

comment on column public.studio_bookings.client_phone is 'Teléfono del cliente (solo para el estudio y el artista de la cita).';
comment on column public.studio_bookings.service_description is 'Servicio acordado (≤500 caracteres).';
comment on column public.studio_bookings.deposit_amount is 'Seña cobrada, en la moneda de la cita.';
comment on column public.studio_bookings.created_by_role is 'Quién creó la cita: studio | support. Lo fija validate_studio_booking.';
comment on column public.studio_bookings.created_by_user_id is 'Usuario que creó la cita (auth.uid() al insertar).';

-- ---------------------------------------------------------------------
-- 2) Agenda · RLS nueva (la policy del dueño studio_bookings_owner queda igual)
-- ---------------------------------------------------------------------
drop policy if exists studio_bookings_artist_select on public.studio_bookings;
create policy studio_bookings_artist_select on public.studio_bookings
  for select to authenticated
  using (artist_user_id = (select auth.uid()));

drop policy if exists studio_bookings_support_all on public.studio_bookings;
create policy studio_bookings_support_all on public.studio_bookings
  for all to authenticated
  using ((select public.is_support_user()))
  with check ((select public.is_support_user()));

-- ---------------------------------------------------------------------
-- 3) Agenda · fuentes de "ocupado"
-- ---------------------------------------------------------------------
-- Helper interno: intervalos ocupados del artista que se superponen con
-- [p_from, p_to). Sin chequeo de caller: solo lo llaman funciones SD.
-- a) La expansión semanal es la de prevent_artist_calendar_overlap
--    (20260829145232): +2 años con tope de 103 ocurrencias sin until, o hasta
--    until + 1 día. Solo se devuelven las ocurrencias dentro del rango.
-- c) Las citas del propio p_studio_id no cuentan acá (las cubre el chequeo
--    de superposición de validate_studio_booking).
create or replace function private.artist_busy_intervals(
  p_studio_id uuid,
  p_artist uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_booking uuid
)
returns table(starts_at timestamptz, ends_at timestamptz, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.occurrence_start, o.occurrence_end, 'agenda_personal'::text
  from public.artist_calendar_events e
  cross join lateral (
    select
      e.starts_at + (n * interval '7 days') as occurrence_start,
      e.ends_at + (n * interval '7 days') as occurrence_end
    from generate_series(
      0,
      case
        when e.recurrence_rule = 'weekly' then least(
          103,
          greatest(
            0,
            floor(extract(epoch from (
              coalesce(
                e.recurrence_until::timestamptz + interval '1 day',
                e.starts_at + interval '2 years'
              ) - e.starts_at
            )) / 604800)::integer
          )
        )
        else 0
      end
    ) as n
  ) o
  where e.artist_user_id = p_artist
    and e.status <> 'cancelled'
    and e.event_type in (
      'confirmed_session', 'reservation', 'blocked_day',
      'guest_spot', 'convention', 'personal'
    )
    and e.starts_at < p_to
    and o.occurrence_start < p_to
    and o.occurrence_end > p_from

  union all

  select
    qs.session_date,
    qs.session_date + coalesce(qs.duration_hours, 1)::double precision * interval '1 hour',
    'agenda_personal'::text
  from public.quotation_sessions qs
  join public.quotations_db q on q.id = qs.quotation_id
  where q.artist_id = p_artist
    and coalesce(qs.status, '') <> 'cancelled'
    and coalesce(qs.duration_hours, 1) > 0
    and qs.session_date < p_to
    and qs.session_date + coalesce(qs.duration_hours, 1)::double precision * interval '1 hour' > p_from

  union all

  select b.starts_at, b.ends_at, 'otro_estudio'::text
  from public.studio_bookings b
  where b.artist_user_id = p_artist
    and b.status = 'confirmed'
    and b.studio_id <> p_studio_id
    and b.id is distinct from p_exclude_booking
    and b.starts_at < p_to
    and b.ends_at > p_from;
$$;

revoke all on function private.artist_busy_intervals(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- Devuelve null, 'agenda_personal' o 'otro_estudio'. Valida al caller:
-- soporte, service_role, backend sin JWT (postgres/migraciones), o dueño de
-- p_studio_id con el artista 'active' allí. La llama validate_studio_booking
-- (INVOKER) con el rol del cliente, por eso lleva GRANT a authenticated.
create or replace function private.artist_busy_conflict(
  p_studio_id uuid,
  p_artist uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_exclude_booking uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
  v_source text;
begin
  if not (
       (v_uid is null and v_role = '')
    or v_role = 'service_role'
    or public.is_support_user()
    or (
      v_uid is not null
      and exists (select 1 from public.studios s where s.id = p_studio_id and s.user_id = v_uid)
      and exists (
        select 1 from public.studio_artist_memberships m
        where m.studio_id = p_studio_id and m.artist_user_id = p_artist and m.status = 'active'
      )
    )
  ) then
    raise exception 'No tenés acceso a la agenda de este artista' using errcode = '42501';
  end if;

  if p_artist is null or p_starts is null or p_ends is null or p_ends <= p_starts then
    return null;
  end if;

  select b.source into v_source
  from private.artist_busy_intervals(p_studio_id, p_artist, p_starts, p_ends, p_exclude_booking) b
  order by case b.source when 'agenda_personal' then 0 else 1 end
  limit 1;

  return v_source;
end;
$$;

revoke all on function private.artist_busy_conflict(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function private.artist_busy_conflict(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) validate_studio_booking (desde la definición viva)
--    Cambios: autoría forzada, reglas de 'no_show', lock por artista,
--    chequeo de ocupado y reparto al completar. Firma, search_path y
--    SECURITY INVOKER se conservan.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_studio_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE generated_job_id uuid; v_busy text; v_artist_name text; v_model text; v_pct numeric; v_payer text; v_artist_split numeric; v_studio_split numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'La reserva ya está completada'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.studio_id <> OLD.studio_id THEN RAISE EXCEPTION 'No se puede transferir una reserva'; END IF;
  -- M3: la autoría la fija la base; lo que mande el cliente se ignora.
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_role := CASE WHEN public.is_support_user() THEN 'support' ELSE 'studio' END;
    NEW.created_by_user_id := coalesce(auth.uid(), NEW.created_by_user_id);
  ELSE
    NEW.created_by_role := OLD.created_by_role;
    NEW.created_by_user_id := OLD.created_by_user_id;
  END IF;
  -- M3: "No asistió" solo desde una cita confirmada que ya comenzó.
  IF NEW.status = 'no_show' AND (TG_OP = 'INSERT' OR OLD.status <> 'no_show') THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'confirmed' THEN RAISE EXCEPTION 'Solo una cita confirmada puede marcarse como no asistida' USING ERRCODE = '23514'; END IF;
    IF NEW.starts_at > now() THEN RAISE EXCEPTION 'La cita todavía no comenzó' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.studio_locations WHERE id = NEW.location_id AND studio_id = NEW.studio_id) THEN RAISE EXCEPTION 'Sede inválida'; END IF;
  IF (TG_OP = 'INSERT' OR NEW.artist_user_id IS DISTINCT FROM OLD.artist_user_id) AND NOT EXISTS (SELECT 1 FROM public.studio_artist_memberships WHERE studio_id = NEW.studio_id AND artist_user_id = NEW.artist_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'El artista debe estar activo en el roster';
  END IF;
  -- M3: misma clave que prevent_artist_calendar_overlap (serializa agenda personal y citas de estudios).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.artist_user_id::text, 0));
  IF NEW.status = 'confirmed' AND EXISTS (SELECT 1 FROM public.studio_bookings b WHERE b.studio_id = NEW.studio_id AND b.artist_user_id = NEW.artist_user_id AND b.id <> NEW.id AND b.status = 'confirmed' AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at) THEN
    RAISE EXCEPTION 'El artista ya tiene una reserva en ese horario';
  END IF;
  -- M3: ocupado en la agenda personal, en cotizaciones o en otros estudios. Corre al confirmar o reprogramar.
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status <> 'confirmed' OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.artist_user_id IS DISTINCT FROM OLD.artist_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.studio_artist_memberships WHERE studio_id = NEW.studio_id AND artist_user_id = NEW.artist_user_id AND status = 'active') THEN
      RAISE EXCEPTION 'El artista debe estar activo en el roster' USING ERRCODE = '23514';
    END IF;
    v_busy := private.artist_busy_conflict(NEW.studio_id, NEW.artist_user_id, NEW.starts_at, NEW.ends_at, NEW.id);
    IF v_busy IS NOT NULL THEN
      SELECT nullif(btrim(a.name), '') INTO v_artist_name FROM public.artists_db a WHERE a.user_id = NEW.artist_user_id;
      RAISE EXCEPTION '% no está disponible en ese horario (%)', coalesce(v_artist_name, 'El artista'),
        CASE v_busy WHEN 'otro_estudio' THEN 'tiene una cita en otro estudio' ELSE 'agenda personal' END
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'confirmed' THEN RAISE EXCEPTION 'Primero confirmá la reserva'; END IF;
    IF NEW.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
    -- M3: reparto según el contrato firmado vigente o, si no hay, el % de la membresía activa.
    SELECT c.compensation_model, c.artist_percentage, c.fixed_payer INTO v_model, v_pct, v_payer
    FROM public.studio_artist_memberships m
    JOIN public.studio_contracts c ON c.id = m.current_contract_id AND c.status = 'signed'
    WHERE m.studio_id = NEW.studio_id AND m.artist_user_id = NEW.artist_user_id AND m.status IN ('active', 'paused')
    ORDER BY (m.status = 'active') DESC, c.artist_signed_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      SELECT 'percentage', m.revenue_split_pct INTO v_model, v_pct
      FROM public.studio_artist_memberships m
      WHERE m.studio_id = NEW.studio_id AND m.artist_user_id = NEW.artist_user_id AND m.status = 'active' AND m.revenue_split_pct IS NOT NULL
      ORDER BY m.started_at DESC NULLS LAST, m.created_at DESC
      LIMIT 1;
    END IF;
    IF v_model IN ('percentage', 'mixed') AND v_pct IS NOT NULL THEN
      v_artist_split := round(NEW.amount * v_pct / 100, 2);
      v_studio_split := NEW.amount - v_artist_split;
    ELSIF v_model = 'fixed' AND v_payer = 'artist_to_studio' THEN
      v_artist_split := NEW.amount;
      v_studio_split := 0;
    ELSIF v_model = 'fixed' AND v_payer = 'studio_to_artist' THEN
      v_artist_split := NULL;
      v_studio_split := NEW.amount;
    END IF;
    INSERT INTO public.studio_jobs_log (studio_id, location_id, artist_user_id, client_display_name, client_email, performed_at, duration_hours, gross_amount, gross_currency, artist_split_amount, studio_split_amount, notes)
    VALUES (NEW.studio_id, NEW.location_id, NEW.artist_user_id, NEW.client_name, NEW.client_email, NEW.starts_at, extract(epoch FROM (NEW.ends_at - NEW.starts_at))/3600, NEW.amount, NEW.currency, v_artist_split, v_studio_split, NEW.notes)
    RETURNING id INTO generated_job_id;
    NEW.job_log_id := generated_job_id;
  ELSIF NEW.job_log_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.job_log_id IS DISTINCT FROM OLD.job_log_id) THEN
    RAISE EXCEPTION 'El trabajo se registra al completar la reserva';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.validate_studio_booking() FROM PUBLIC, anon, authenticated;

-- complete_studio_booking (desde la definición viva): solo cambia el mensaje
-- para las citas marcadas como no asistidas.
CREATE OR REPLACE FUNCTION public.complete_studio_booking(p_booking_id uuid)
 RETURNS public.studio_bookings
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE booking public.studio_bookings;
BEGIN
  SELECT * INTO booking FROM public.studio_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada'; END IF;
  IF booking.status = 'completed' THEN RETURN booking; END IF;
  IF booking.status = 'no_show' THEN RAISE EXCEPTION 'La cita quedó marcada como no asistida' USING ERRCODE = '23514'; END IF;
  IF booking.status <> 'confirmed' THEN RAISE EXCEPTION 'La reserva está cancelada'; END IF;
  IF booking.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
  UPDATE public.studio_bookings SET status = 'completed' WHERE id = booking.id RETURNING * INTO booking;
  RETURN booking;
END; $function$;

REVOKE ALL ON FUNCTION public.complete_studio_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_studio_booking(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5) Agenda · RPCs (dueño o soporte; el artista tiene que estar 'active')
-- ---------------------------------------------------------------------
-- reason: null | 'mismo_estudio' (otra cita confirmada de este estudio) |
-- 'agenda_personal' | 'otro_estudio'. Mismo orden que validate_studio_booking.
create or replace function public.check_studio_booking_availability(
  p_studio_id uuid,
  p_artist_user_id uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_exclude_booking uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para consultar la agenda' using errcode = '42501';
  end if;
  if not public.is_support_user()
     and not exists (select 1 from public.studios s where s.id = p_studio_id and s.user_id = v_uid) then
    raise exception 'No tenés acceso a este estudio' using errcode = '42501';
  end if;
  if p_artist_user_id is null or not exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = p_studio_id and m.artist_user_id = p_artist_user_id and m.status = 'active'
  ) then
    raise exception 'El artista no está activo en este estudio' using errcode = '42501';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'El fin de la cita tiene que ser posterior al inicio' using errcode = '22023';
  end if;
  if p_exclude_booking is not null and not exists (
    select 1 from public.studio_bookings b where b.id = p_exclude_booking and b.studio_id = p_studio_id
  ) then
    raise exception 'La cita no pertenece a este estudio' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.studio_bookings b
    where b.studio_id = p_studio_id
      and b.artist_user_id = p_artist_user_id
      and b.status = 'confirmed'
      and b.id is distinct from p_exclude_booking
      and b.starts_at < p_ends
      and b.ends_at > p_starts
  ) then
    v_reason := 'mismo_estudio';
  else
    v_reason := private.artist_busy_conflict(p_studio_id, p_artist_user_id, p_starts, p_ends, p_exclude_booking);
  end if;

  return jsonb_build_object('available', v_reason is null, 'reason', v_reason);
end;
$$;

revoke all on function public.check_studio_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.check_studio_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- Bloques "ocupado" de los artistas activos del estudio en [p_from, p_to)
-- (≤62 días). Sin título, cliente ni notas: solo horario y fuente.
create or replace function public.list_studio_artist_busy_blocks(
  p_studio_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table(artist_user_id uuid, starts_at timestamptz, ends_at timestamptz, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para consultar la agenda' using errcode = '42501';
  end if;
  if not public.is_support_user()
     and not exists (select 1 from public.studios s where s.id = p_studio_id and s.user_id = v_uid) then
    raise exception 'No tenés acceso a este estudio' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if p_to - p_from > interval '62 days' then
    raise exception 'Elegí un rango de 62 días o menos' using errcode = '22023';
  end if;

  return query
  select a.artist_user_id, b.starts_at, b.ends_at, b.source
  from (
    select distinct sm.artist_user_id
    from public.studio_artist_memberships sm
    where sm.studio_id = p_studio_id and sm.status = 'active'
  ) a
  cross join lateral private.artist_busy_intervals(p_studio_id, a.artist_user_id, p_from, p_to, null) b
  order by 1, 2, 3;
end;
$$;

revoke all on function public.list_studio_artist_busy_blocks(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_studio_artist_busy_blocks(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6) Inventario · entregas y devoluciones a artistas
-- ---------------------------------------------------------------------
alter table public.studio_inventory_movements drop constraint if exists studio_inventory_movements_kind_check;
alter table public.studio_inventory_movements
  add constraint studio_inventory_movements_kind_check
  check (kind in ('restock', 'consumption', 'adjustment', 'loss', 'assignment', 'return'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studio_inventory_movements_artist_required'
                 and conrelid = 'public.studio_inventory_movements'::regclass) then
    alter table public.studio_inventory_movements
      add constraint studio_inventory_movements_artist_required
      check (kind not in ('assignment', 'return') or related_artist_user_id is not null) not valid;
  end if;
end;
$$;

create index if not exists studio_inventory_movements_artist_item
  on public.studio_inventory_movements (studio_id, related_artist_user_id, item_id)
  where related_artist_user_id is not null;

-- BEFORE INSERT (INVOKER): valida ítem, artista, devoluciones y stock, y
-- completa unit_cost con el cost_per_unit del ítem (salvo en 'restock').
-- El FOR UPDATE del ítem serializa movimientos concurrentes del mismo ítem.
create or replace function private.prepare_inventory_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.studio_inventory_items;
  v_net numeric;
  v_delta numeric;
begin
  select * into v_item
  from public.studio_inventory_items i
  where i.id = new.item_id
  for update;
  if not found or v_item.studio_id is distinct from new.studio_id then
    raise exception 'El ítem no pertenece a este estudio' using errcode = '22023';
  end if;

  -- El costo de una reposición es el de la compra: si no se conoce (p. ej.
  -- moneda distinta en receive_supply_order, M5) queda null.
  if new.unit_cost is null and new.kind <> 'restock' then
    new.unit_cost := v_item.cost_per_unit;
  end if;

  if new.kind = 'assignment' then
    if new.related_artist_user_id is null then
      raise exception 'Indicá a qué artista le entregás el material' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.studio_artist_memberships m
      where m.studio_id = new.studio_id and m.artist_user_id = new.related_artist_user_id and m.status = 'active'
    ) then
      raise exception 'Solo podés entregar materiales a artistas activos del estudio' using errcode = '23514';
    end if;
  elsif new.kind = 'return' then
    if new.related_artist_user_id is null then
      raise exception 'Indicá qué artista devuelve el material' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.studio_artist_memberships m
      where m.studio_id = new.studio_id and m.artist_user_id = new.related_artist_user_id
    ) then
      raise exception 'Ese artista no formó parte del estudio' using errcode = '22023';
    end if;
    select coalesce(sum(case mv.kind when 'assignment' then mv.quantity else -mv.quantity end), 0)
      into v_net
    from public.studio_inventory_movements mv
    where mv.studio_id = new.studio_id
      and mv.item_id = new.item_id
      and mv.related_artist_user_id = new.related_artist_user_id
      and mv.kind in ('assignment', 'return');
    if new.quantity > v_net then
      raise exception 'La devolución supera lo entregado de % (quedan % por devolver)', v_item.name, greatest(v_net, 0)
        using errcode = '23514';
    end if;
  end if;

  v_delta := case new.kind
    when 'restock' then new.quantity
    when 'adjustment' then new.quantity
    when 'return' then new.quantity
    when 'consumption' then -new.quantity
    when 'loss' then -new.quantity
    when 'assignment' then -new.quantity
    else 0
  end;
  if v_delta < 0 and coalesce(v_item.quantity_on_hand, 0) + v_delta < 0 then
    raise exception 'Stock insuficiente de %', v_item.name using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_inventory_movement() from public, anon, authenticated;

drop trigger if exists studio_inventory_movements_prepare on public.studio_inventory_movements;
create trigger studio_inventory_movements_prepare
  before insert on public.studio_inventory_movements
  for each row execute function private.prepare_inventory_movement();

-- apply_inventory_movement (desde la definición viva, mismo search_path):
-- suma 'assignment' (−) y 'return' (+) en las ramas INSERT y DELETE.
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE delta NUMERIC(10,3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := CASE NEW.kind
      WHEN 'restock'    THEN  NEW.quantity
      WHEN 'consumption' THEN -NEW.quantity
      WHEN 'loss'       THEN -NEW.quantity
      WHEN 'adjustment' THEN  NEW.quantity
      WHEN 'assignment' THEN -NEW.quantity
      WHEN 'return'     THEN  NEW.quantity
      ELSE 0
    END;
    UPDATE public.studio_inventory_items SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + delta WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    delta := CASE OLD.kind
      WHEN 'restock'    THEN -OLD.quantity
      WHEN 'consumption' THEN  OLD.quantity
      WHEN 'loss'       THEN  OLD.quantity
      WHEN 'adjustment' THEN -OLD.quantity
      WHEN 'assignment' THEN  OLD.quantity
      WHEN 'return'     THEN -OLD.quantity
      ELSE 0
    END;
    UPDATE public.studio_inventory_items SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + delta WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Balance de materiales por artista e ítem (RLS de movimientos e ítems).
create or replace view public.studio_artist_material_balance
with (security_invoker = true) as
select
  mv.studio_id,
  mv.related_artist_user_id as artist_user_id,
  mv.item_id,
  i.name as item_name,
  i.unit,
  i.currency,
  coalesce(sum(mv.quantity) filter (where mv.kind = 'assignment'), 0) as assigned_qty,
  coalesce(sum(mv.quantity) filter (where mv.kind = 'return'), 0) as returned_qty,
  coalesce(sum(mv.quantity) filter (where mv.kind = 'assignment'), 0)
    - coalesce(sum(mv.quantity) filter (where mv.kind = 'return'), 0) as net_assigned_qty,
  coalesce(sum(mv.quantity) filter (where mv.kind = 'consumption'), 0) as consumed_qty,
  coalesce(sum(mv.quantity * mv.unit_cost) filter (where mv.kind = 'assignment'), 0)
    - coalesce(sum(mv.quantity * mv.unit_cost) filter (where mv.kind = 'return'), 0) as assigned_cost,
  max(mv.performed_at) as last_movement_at
from public.studio_inventory_movements mv
join public.studio_inventory_items i on i.id = mv.item_id
where mv.related_artist_user_id is not null
  and mv.kind in ('assignment', 'return', 'consumption')
group by mv.studio_id, mv.related_artist_user_id, mv.item_id, i.name, i.unit, i.currency;

-- Entregas netas de devoluciones por mes, artista y moneda del ítem.
create or replace view public.studio_material_assignment_monthly
with (security_invoker = true) as
select
  mv.studio_id,
  date_trunc('month', mv.performed_at)::date as month,
  mv.related_artist_user_id as artist_user_id,
  i.currency,
  sum(case when mv.kind = 'assignment' then mv.quantity else -mv.quantity end) as quantity,
  coalesce(sum(case when mv.kind = 'assignment' then mv.quantity * mv.unit_cost else -(mv.quantity * mv.unit_cost) end), 0) as cost
from public.studio_inventory_movements mv
join public.studio_inventory_items i on i.id = mv.item_id
where mv.related_artist_user_id is not null
  and mv.kind in ('assignment', 'return')
group by mv.studio_id, date_trunc('month', mv.performed_at)::date, mv.related_artist_user_id, i.currency;

revoke all on public.studio_artist_material_balance, public.studio_material_assignment_monthly from public, anon, authenticated;
grant select on public.studio_artist_material_balance, public.studio_material_assignment_monthly to authenticated, service_role;

-- Materiales entregados y devueltos al artista que llama, en todos sus estudios.
create or replace function public.list_my_studio_material_assignments()
returns table(studio_id uuid, studio_name text, item_name text, unit text, kind text, quantity numeric, performed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select mv.studio_id, s.name, i.name, i.unit, mv.kind, mv.quantity, mv.performed_at
  from public.studio_inventory_movements mv
  join public.studio_inventory_items i on i.id = mv.item_id
  join public.studios s on s.id = mv.studio_id
  where (select auth.uid()) is not null
    and mv.related_artist_user_id = (select auth.uid())
    and mv.kind in ('assignment', 'return')
  order by mv.performed_at desc, mv.created_at desc;
$$;

revoke all on function public.list_my_studio_material_assignments() from public, anon;
grant execute on function public.list_my_studio_material_assignments() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
