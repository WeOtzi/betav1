-- Auth-confirmed onboarding and location edits commit as a single transaction.
BEGIN;

-- Remove the legacy unconditional INSERT policy: the owner/support policy remains.
DROP POLICY IF EXISTS "Authenticated users can create studios" ON public.studios;

CREATE OR REPLACE FUNCTION public.save_studio_location(p_studio_id uuid, p_location_id uuid, p_location jsonb)
RETURNS public.studio_locations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_studio public.studios;
  v_location public.studio_locations;
  v_primary boolean;
BEGIN
  SELECT * INTO v_studio FROM public.studios WHERE id = p_studio_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR v_studio.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No tenés permiso para administrar este estudio.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_location->>'formatted_address'), '') IS NULL THEN
    RAISE EXCEPTION 'La dirección de la sede es obligatoria.';
  END IF;
  IF p_location_id IS NOT NULL THEN
    SELECT * INTO v_location FROM public.studio_locations WHERE id = p_location_id AND studio_id = p_studio_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sede no encontrada.'; END IF;
  END IF;
  v_primary := coalesce((p_location->>'is_primary')::boolean, false)
    OR coalesce(v_studio.primary_location_id = p_location_id, false)
    OR NOT EXISTS (SELECT 1 FROM public.studio_locations WHERE studio_id = p_studio_id AND is_primary);
  v_primary := coalesce(v_primary, true);
  IF v_primary THEN
    UPDATE public.studio_locations SET is_primary = false WHERE studio_id = p_studio_id AND is_primary;
  END IF;
  v_location := jsonb_populate_record(v_location, jsonb_build_object(
    'label', nullif(btrim(p_location->>'label'), ''), 'is_primary', v_primary,
    'is_active', coalesce((p_location->>'is_active')::boolean, true),
    'country', p_location->>'country', 'country_code', p_location->>'country_code',
    'state_province', p_location->>'state_province', 'city', p_location->>'city',
    'locality', p_location->>'locality', 'street', p_location->>'street',
    'street_number', p_location->>'street_number', 'unit', p_location->>'unit',
    'postal_code', p_location->>'postal_code', 'formatted_address', btrim(p_location->>'formatted_address'),
    'latitude', p_location->'latitude', 'longitude', p_location->'longitude',
    'google_place_id', p_location->>'google_place_id', 'phone', p_location->>'phone',
    'hours_json', p_location->'hours_json', 'geocoded_at', now()
  ));
  IF v_primary AND NOT v_location.is_active THEN RAISE EXCEPTION 'La sede principal debe estar activa.'; END IF;
  IF p_location_id IS NULL THEN
    INSERT INTO public.studio_locations (studio_id, label, is_primary, is_active, country, country_code,
      state_province, city, locality, street, street_number, unit, postal_code, formatted_address,
      latitude, longitude, google_place_id, geocoded_at, phone, hours_json)
    VALUES (p_studio_id, v_location.label, v_primary, v_location.is_active, v_location.country, v_location.country_code,
      v_location.state_province, v_location.city, v_location.locality, v_location.street, v_location.street_number,
      v_location.unit, v_location.postal_code, v_location.formatted_address, v_location.latitude, v_location.longitude,
      v_location.google_place_id, now(), v_location.phone, v_location.hours_json)
    RETURNING * INTO v_location;
  ELSE
    UPDATE public.studio_locations SET label = v_location.label, is_primary = v_primary, is_active = v_location.is_active,
      country = v_location.country, country_code = v_location.country_code, state_province = v_location.state_province,
      city = v_location.city, locality = v_location.locality, street = v_location.street,
      street_number = v_location.street_number, unit = v_location.unit, postal_code = v_location.postal_code,
      formatted_address = v_location.formatted_address, latitude = v_location.latitude, longitude = v_location.longitude,
      google_place_id = v_location.google_place_id, geocoded_at = now(), phone = v_location.phone, hours_json = v_location.hours_json
    WHERE id = p_location_id RETURNING * INTO v_location;
  END IF;
  IF v_primary THEN
    UPDATE public.studios SET primary_location_id = v_location.id, profile_complete = true,
      country = v_location.country, country_code = v_location.country_code, city = v_location.city,
      state_province = v_location.state_province, locality = v_location.locality, street = v_location.street,
      street_number = v_location.street_number, unit = v_location.unit, postal_code = v_location.postal_code,
      formatted_address = v_location.formatted_address, latitude = v_location.latitude, longitude = v_location.longitude,
      google_place_id = v_location.google_place_id, geocoded_at = now()
    WHERE id = p_studio_id;
  END IF;
  RETURN v_location;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_studio_location(p_studio_id uuid, p_location_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_studio public.studios; v_next public.studio_locations;
BEGIN
  SELECT * INTO v_studio FROM public.studios WHERE id = p_studio_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR v_studio.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No tenés permiso para administrar este estudio.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.studio_locations WHERE id = p_location_id AND studio_id = p_studio_id) THEN
    RAISE EXCEPTION 'Sede no encontrada.';
  END IF;
  SELECT * INTO v_next FROM public.studio_locations WHERE studio_id = p_studio_id AND id <> p_location_id
    AND is_active ORDER BY sort_order, created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conservá al menos una sede activa; agregá otra antes de quitar esta.'; END IF;
  DELETE FROM public.studio_locations WHERE id = p_location_id AND studio_id = p_studio_id;
  IF v_studio.primary_location_id = p_location_id OR NOT EXISTS (
    SELECT 1 FROM public.studio_locations WHERE studio_id = p_studio_id AND is_primary
  ) THEN
    PERFORM public.save_studio_location(p_studio_id, v_next.id, to_jsonb(v_next) || '{"is_primary":true}'::jsonb);
  END IF;
END; $$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.complete_studio_registration(p_profile jsonb, p_locations jsonb)
RETURNS public.studios LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END; $$;

CREATE OR REPLACE FUNCTION public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
RETURNS public.studios LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT private.complete_studio_registration(p_profile, p_locations);
$$;
REVOKE ALL ON FUNCTION private.complete_studio_registration(jsonb, jsonb) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.complete_studio_registration(jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.save_studio_location(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_studio_location(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_studio_registration(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_studio_location(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_studio_location(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_studio_registration(jsonb, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
