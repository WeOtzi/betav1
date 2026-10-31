-- Reversa de supabase/migrations/20261030202000_studio_agenda_inventory.sql (M3)
-- Deshace todo en orden inverso. Correr ANTES de revertir M2/M1 y DESPUÉS de
-- revertir M4/M5 (orden inverso de la cadena 20261030*).
--
-- Pasos con datos:
--   - Movimientos 'assignment' pasan a 'consumption' y 'return' a 'adjustment'
--     (mismo signo de stock, así quantity_on_hand no cambia); la nota guarda
--     el tipo original. Recién después se restaura el CHECK de kind.
--   - Citas 'no_show' pasan a 'cancelled' (con "No asistió" en notas) antes
--     de restaurar el CHECK de status.
--   - Se pierden client_phone, service_description, deposit_amount,
--     created_by_role y created_by_user_id de studio_bookings.
-- Las definiciones restauradas son las vivas previas (pg_get_functiondef en
-- flbgmlvfiejfttlawnfu, 2026-10-30).

begin;

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
drop function if exists public.list_my_studio_material_assignments();
drop view if exists public.studio_material_assignment_monthly;
drop view if exists public.studio_artist_material_balance;

-- Definición viva previa de apply_inventory_movement.
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
      ELSE 0
    END;
    UPDATE public.studio_inventory_items SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + delta WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

drop trigger if exists studio_inventory_movements_prepare on public.studio_inventory_movements;
drop function if exists private.prepare_inventory_movement();
drop index if exists public.studio_inventory_movements_artist_item;
alter table public.studio_inventory_movements drop constraint if exists studio_inventory_movements_artist_required;

-- Las filas nuevas no cumplen el CHECK viejo: se reclasifican con el mismo signo.
update public.studio_inventory_movements
set kind = 'consumption', notes = concat_ws(' · ', '[Entrega a artista]', notes)
where kind = 'assignment';
update public.studio_inventory_movements
set kind = 'adjustment', notes = concat_ws(' · ', '[Devolución de artista]', notes)
where kind = 'return';

alter table public.studio_inventory_movements drop constraint if exists studio_inventory_movements_kind_check;
alter table public.studio_inventory_movements
  add constraint studio_inventory_movements_kind_check
  check (kind = any (array['restock'::text, 'consumption'::text, 'adjustment'::text, 'loss'::text]));

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
drop function if exists public.list_studio_artist_busy_blocks(uuid, timestamptz, timestamptz);
drop function if exists public.check_studio_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid);

-- Definición viva previa de complete_studio_booking.
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
  IF booking.status <> 'confirmed' THEN RAISE EXCEPTION 'La reserva está cancelada'; END IF;
  IF booking.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
  UPDATE public.studio_bookings SET status = 'completed' WHERE id = booking.id RETURNING * INTO booking;
  RETURN booking;
END; $function$;

-- Definición viva previa de validate_studio_booking.
CREATE OR REPLACE FUNCTION public.validate_studio_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE generated_job_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'La reserva ya está completada'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.studio_id <> OLD.studio_id THEN RAISE EXCEPTION 'No se puede transferir una reserva'; END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.studio_locations WHERE id = NEW.location_id AND studio_id = NEW.studio_id) THEN RAISE EXCEPTION 'Sede inválida'; END IF;
  IF (TG_OP = 'INSERT' OR NEW.artist_user_id IS DISTINCT FROM OLD.artist_user_id) AND NOT EXISTS (SELECT 1 FROM public.studio_artist_memberships WHERE studio_id = NEW.studio_id AND artist_user_id = NEW.artist_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'El artista debe estar activo en el roster';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.studio_id::text || NEW.artist_user_id::text, 0));
  IF NEW.status = 'confirmed' AND EXISTS (SELECT 1 FROM public.studio_bookings b WHERE b.studio_id = NEW.studio_id AND b.artist_user_id = NEW.artist_user_id AND b.id <> NEW.id AND b.status = 'confirmed' AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at) THEN
    RAISE EXCEPTION 'El artista ya tiene una reserva en ese horario';
  END IF;
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'confirmed' THEN RAISE EXCEPTION 'Primero confirmá la reserva'; END IF;
    IF NEW.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
    INSERT INTO public.studio_jobs_log (studio_id, location_id, artist_user_id, client_display_name, client_email, performed_at, duration_hours, gross_amount, gross_currency, notes)
    VALUES (NEW.studio_id, NEW.location_id, NEW.artist_user_id, NEW.client_name, NEW.client_email, NEW.starts_at, extract(epoch FROM (NEW.ends_at - NEW.starts_at))/3600, NEW.amount, NEW.currency, NEW.notes)
    RETURNING id INTO generated_job_id;
    NEW.job_log_id := generated_job_id;
  ELSIF NEW.job_log_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.job_log_id IS DISTINCT FROM OLD.job_log_id) THEN
    RAISE EXCEPTION 'El trabajo se registra al completar la reserva';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $function$;

drop function if exists private.artist_busy_conflict(uuid, uuid, timestamptz, timestamptz, uuid);
drop function if exists private.artist_busy_intervals(uuid, uuid, timestamptz, timestamptz, uuid);

drop policy if exists studio_bookings_support_all on public.studio_bookings;
drop policy if exists studio_bookings_artist_select on public.studio_bookings;

-- Las citas 'no_show' no cumplen el CHECK viejo: pasan a canceladas.
update public.studio_bookings
set status = 'cancelled', notes = concat_ws(' · ', notes, 'No asistió')
where status = 'no_show';

alter table public.studio_bookings drop constraint if exists studio_bookings_status_check;
alter table public.studio_bookings
  add constraint studio_bookings_status_check
  check (status = any (array['confirmed'::text, 'completed'::text, 'cancelled'::text]));

alter table public.studio_bookings
  drop constraint if exists studio_bookings_created_by_role_check,
  drop constraint if exists studio_bookings_deposit_amount_check,
  drop constraint if exists studio_bookings_service_description_len;

alter table public.studio_bookings
  drop column if exists created_by_user_id,
  drop column if exists created_by_role,
  drop column if exists deposit_amount,
  drop column if exists service_description,
  drop column if exists client_phone;

-- Costos unitarios: vuelven a numeric(10,2) (redondea los valores con más
-- decimales) y se recrea la vista dependiente como estaba.
drop view if exists public.studio_inventory_health_by_currency;
alter table public.studio_inventory_movements alter column unit_cost type numeric(10,2);
alter table public.studio_inventory_items alter column cost_per_unit type numeric(10,2);
create view public.studio_inventory_health_by_currency with (security_invoker = true) as
 SELECT studio_inventory_items.id,
    studio_inventory_items.studio_id,
    studio_inventory_items.name,
    studio_inventory_items.quantity_on_hand,
    studio_inventory_items.reorder_level,
    studio_inventory_items.currency,
    studio_inventory_items.reorder_level IS NOT NULL AND studio_inventory_items.quantity_on_hand <= studio_inventory_items.reorder_level AS needs_reorder,
    (studio_inventory_items.quantity_on_hand * COALESCE(studio_inventory_items.cost_per_unit, 0::numeric))::numeric(14,2) AS stock_value
   FROM public.studio_inventory_items
  WHERE studio_inventory_items.is_active = true;
revoke all on public.studio_inventory_health_by_currency from public, anon;
grant all on public.studio_inventory_health_by_currency to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
