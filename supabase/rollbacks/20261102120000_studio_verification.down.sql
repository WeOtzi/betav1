-- Reversa de 20261102120000_studio_verification.sql.
-- Restaura complete_studio_registration y el guard de M1, y borra la
-- verificación de estudios (solicitudes y códigos de Instagram incluidos).
-- studios.is_verified se conserva: es anterior a esta migración.

begin;

CREATE OR REPLACE FUNCTION private.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 RETURNS studios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_studio public.studios; v_location jsonb; v_name text; v_slug text; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo e iniciá sesión para completar el registro.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  SELECT * INTO v_studio FROM public.studios WHERE user_id = auth.uid();
  IF FOUND THEN RETURN v_studio; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo antes de crear el estudio.'; END IF;
  v_name := nullif(btrim(p_profile->>'name'), '');
  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 160 THEN RAISE EXCEPTION 'El nombre debe tener entre 2 y 160 caracteres.'; END IF;
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

create or replace function private.guard_studio_protected_columns()
returns trigger
language plpgsql
set search_path to ''
as $function$
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
$function$;

drop function if exists public.decide_studio_verification(uuid, text, text);
drop function if exists public.request_studio_verification(uuid, text, text, text, text[]);
drop function if exists private.open_studio_verification(uuid, text, uuid[], uuid);
drop function if exists public.find_studio_matches(text, text);
drop function if exists private.studio_matches(text, text);
drop function if exists private.studio_name_match(text, text);
drop function if exists private.studio_instagram_key(text);
drop function if exists private.studio_name_tokens(text);
drop function if exists private.studio_name_key(text);
drop function if exists private.approx_distance_m(double precision, double precision, double precision, double precision);
drop table if exists public.studio_instagram_verifications;
drop table if exists public.studio_verification_requests;

alter table public.studios
  drop constraint if exists studios_verification_status_check,
  drop constraint if exists studios_verification_reason_check,
  drop column if exists verification_status,
  drop column if exists verification_required,
  drop column if exists verification_reason,
  drop column if exists verified_at,
  drop column if exists instagram_verified_at,
  drop column if exists instagram_verified_handle;

notify pgrst, 'reload schema';
commit;
