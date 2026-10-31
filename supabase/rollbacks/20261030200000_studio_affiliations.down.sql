-- Reversa de supabase/migrations/20261030200000_studio_affiliations.sql (M1)
--
-- Orden: si M2 (20261030201000_studio_contracts) está aplicada, correr
-- antes supabase/rollbacks/20261030201000_studio_contracts.down.sql.
-- Deshace M1 en orden inverso y restaura las definiciones vivas previas
-- (pg_get_functiondef en flbgmlvfiejfttlawnfu, 2026-10-30) de
-- decide_studio_spot_application, inbox_from_studio_invitation y
-- private.complete_studio_registration, más las policies
-- sam_public_select_active y studios_anyone_create_via_app.
--
-- Pasos que dependen de datos (antes de restaurar el CHECK de status y el
-- UNIQUE (studio_id, artist_user_id, role, status) NULLS NOT DISTINCT):
--   * Las solicitudes 'requested' no existen en el modelo anterior: se
--     borran (sus detalles se van con la tabla). Se borran en vez de pasar a
--     'rejected' para no mandarle al artista un "La invitación fue rechazada".
--   * Con el UNIQUE viejo no pueden convivir dos filas cerradas iguales
--     (p. ej. dos 'ended' del mismo rol). Se conserva la más reciente de
--     cada grupo y se borran las anteriores que no tengan reseñas
--     verificadas (verified_reviews las referencia con ON DELETE RESTRICT).
--     Si aun así quedan duplicados, la reversa se detiene y hay que
--     resolverlos a mano.

begin;

-- 10. Reclamo de estudio ------------------------------------------------

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

drop function if exists public.list_unowned_studios(text);
drop function if exists public.decide_studio_claim(uuid, text, text);
drop function if exists public.request_studio_claim(uuid, text, text, text);
drop table if exists public.studio_claim_requests;

-- 9. Columnas protegidas de studios ------------------------------------

drop trigger if exists trg_guard_studio_protected_columns on public.studios;
drop function if exists private.guard_studio_protected_columns();

drop policy if exists "studios_anyone_create_via_app" on public.studios;
create policy "studios_anyone_create_via_app"
  on public.studios for insert
  with check (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1 from public.support_users_db s
        where s.user_id = auth.uid() and s.is_active = true
      )
    )
  );

-- 8. Puntero artists_db.studio_id --------------------------------------

drop trigger if exists trg_guard_artist_studio_pointer on public.artists_db;
drop function if exists private.guard_artist_studio_pointer();

-- 7. Inbox de invitaciones (definición viva previa) ---------------------

CREATE OR REPLACE FUNCTION public.inbox_from_studio_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_studio public.studios%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into v_studio from public.studios where id = new.studio_id;
  select * into v_detail from public.studio_membership_invitation_details where membership_id = new.id;
  v_message := case new.status
    when 'active' then 'Invitación aceptada. Ya formás parte del roster del estudio.'
    when 'rejected' then 'La invitación fue rechazada.'
    when 'pending_invite' then 'Recibiste una nueva invitación del estudio.'
    else 'El estudio te invitó a sumarte a su roster.'
  end;
  perform public.ensure_domain_inbox_thread(
    new.artist_user_id, 'invitations', 'studio_invitation', new.id,
    v_studio.user_id, v_studio.name, coalesce(v_detail.duration_label, 'Invitación al estudio'),
    jsonb_build_object(
      'membership_id', new.id, 'studio_id', v_studio.id, 'studio_name', v_studio.name,
      'role', new.role, 'membership_status', new.status,
      'proposed_start_date', v_detail.proposed_start_date,
      'proposed_end_date', v_detail.proposed_end_date
    ), v_message
  );
  return new;
end;
$function$;

revoke execute on function public.inbox_from_studio_invitation() from public, anon, authenticated;

-- 6. Solicitudes de alta ------------------------------------------------

drop function if exists public.withdraw_studio_membership_request(uuid);
drop function if exists public.decide_studio_membership_request(uuid, text, text, uuid);
drop function if exists public.request_studio_membership(uuid, text, uuid, text, text, date);
drop table if exists public.studio_membership_request_details;

-- 5. Roster público -----------------------------------------------------

drop view if exists public.studio_public_roster;

drop policy if exists "sam_public_select_active" on public.studio_artist_memberships;
create policy "sam_public_select_active"
  on public.studio_artist_memberships for select
  using (status = 'active');

-- 4. decide_studio_spot_application (definición viva previa, INVOKER) ---

CREATE OR REPLACE FUNCTION public.decide_studio_spot_application(p_application_id uuid, p_status text)
 RETURNS studio_spot_applications
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    VALUES (v_spot.studio_id, v_application.artist_user_id, v_spot.location_id, v_role, 'active', v_spot.revenue_split_pct, now())
    ON CONFLICT (studio_id, artist_user_id, role, status) DO NOTHING;
  END IF;
  UPDATE public.studio_spot_applications SET status = p_status, decided_at = now(), decided_by_user_id = auth.uid()
    WHERE id = p_application_id RETURNING * INTO v_application;
  RETURN v_application;
END; $function$;

revoke all on function public.decide_studio_spot_application(uuid, text) from public, anon;
grant execute on function public.decide_studio_spot_application(uuid, text) to authenticated;

-- 3. Guard de membresías ------------------------------------------------

drop trigger if exists trg_guard_studio_membership_delete on public.studio_artist_memberships;
drop function if exists private.guard_studio_membership_delete();
drop trigger if exists trg_guard_studio_membership_write on public.studio_artist_memberships;
drop function if exists private.guard_studio_membership_write();

-- 2. Helpers privados ---------------------------------------------------

drop function if exists private.close_open_studio_contracts(uuid, uuid, text, text);
drop function if exists private.lock_studio_artist_pair(uuid, uuid);

-- 1. Vínculos: datos, índice, CHECK, initiated_by y UNIQUE viejo --------

delete from public.studio_artist_memberships m
where m.status = 'requested';

with ranked as (
  select m.id,
         row_number() over (
           partition by m.studio_id, m.artist_user_id, m.role, m.status
           order by coalesce(m.ended_at, m.updated_at, m.created_at) desc, m.created_at desc, m.id desc
         ) as rn
  from public.studio_artist_memberships m
)
delete from public.studio_artist_memberships m
using ranked r
where r.id = m.id
  and r.rn > 1
  and not exists (select 1 from public.verified_reviews v where v.studio_membership_id = m.id);

do $$
begin
  if exists (
    select 1 from public.studio_artist_memberships m
    group by m.studio_id, m.artist_user_id, m.role, m.status
    having count(*) > 1
  ) then
    raise exception 'Quedan vínculos duplicados (studio, artist, role, status) con reseñas verificadas: resolvelos a mano antes de restaurar el UNIQUE.';
  end if;
end;
$$;

drop index if exists public.studio_memberships_one_open_per_role;

alter table public.studio_artist_memberships
  drop constraint if exists studio_artist_memberships_status_check;
alter table public.studio_artist_memberships
  add constraint studio_artist_memberships_status_check
  check (status in ('pending_invite', 'pending_acceptance', 'active', 'paused', 'ended', 'rejected'));

alter table public.studio_artist_memberships
  drop constraint if exists studio_artist_memberships_initiated_by_check;
alter table public.studio_artist_memberships
  drop column if exists initiated_by;

alter table public.studio_artist_memberships
  drop constraint if exists studio_artist_memberships_no_double_active;
alter table public.studio_artist_memberships
  add constraint studio_artist_memberships_no_double_active
  unique nulls not distinct (studio_id, artist_user_id, role, status);

notify pgrst, 'reload schema';
commit;
