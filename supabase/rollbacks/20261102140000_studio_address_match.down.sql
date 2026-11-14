-- Reversa de 20261102140000_studio_address_match.sql: vuelve al registro de
-- 20261102120000 (40 m o texto idéntico) y borra los helpers de dirección.
begin;

CREATE OR REPLACE FUNCTION private.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 RETURNS studios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_studio public.studios; v_location jsonb; v_name text; v_slug text; v_email text;
  v_match record; v_matched uuid[] := '{}'; v_reason text; v_loc record; v_label text; v_dist double precision;
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
  -- Nombre idéntico a un estudio con dueño (UNIQUE normalized_name).
  IF EXISTS (SELECT 1 FROM public.studios WHERE normalized_name = upper(v_name)) THEN
    RAISE EXCEPTION 'Ya hay un estudio llamado «%» en We Ötzi. Si es el tuyo, iniciá sesión; si es otro, elegí un nombre que lo distinga (por ejemplo, sumá el barrio o la ciudad).', v_name USING ERRCODE = '23505';
  END IF;
  IF jsonb_typeof(p_locations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Agregá al menos una sede.'; END IF;
  IF jsonb_array_length(p_locations) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Agregá entre 1 y 30 sedes.'; END IF;

  -- Coincidencias: ninguna sede puede compartir dirección con un estudio parecido.
  FOR v_match IN SELECT m.studio_id, m.match_kind, s.name FROM private.studio_matches(v_name, p_profile->>'instagram') m
                 JOIN public.studios s ON s.id = m.studio_id LOOP
    v_matched := v_matched || v_match.studio_id;
    v_reason := coalesce(v_reason, CASE WHEN v_match.match_kind = 'instagram' THEN 'instagram_match' ELSE 'name_match' END);
    FOR v_location IN SELECT value FROM jsonb_array_elements(p_locations) LOOP
      v_label := coalesce(nullif(btrim(v_location->>'label'), ''), 'tu sede');
      FOR v_loc IN
        SELECT l.formatted_address, l.latitude, l.longitude FROM public.studio_locations l
        WHERE l.studio_id = v_match.studio_id AND l.is_active IS NOT FALSE
        UNION ALL
        SELECT s.formatted_address, s.latitude, s.longitude FROM public.studios s WHERE s.id = v_match.studio_id
      LOOP
        v_dist := private.approx_distance_m(
          nullif(v_location->>'latitude', '')::double precision, nullif(v_location->>'longitude', '')::double precision,
          v_loc.latitude, v_loc.longitude);
        IF (v_dist IS NOT NULL AND v_dist < 40)
           OR (nullif(btrim(v_location->>'formatted_address'), '') IS NOT NULL
               AND private.studio_name_key(v_location->>'formatted_address') = private.studio_name_key(v_loc.formatted_address)) THEN
          RAISE EXCEPTION 'La dirección de % coincide con «%», que ya está en We Ötzi. Si es tu estudio, iniciá sesión o pedí la ficha; si es una sede de ese estudio, sumala desde su panel.', v_label, v_match.name
            USING ERRCODE = '23P01';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := coalesce(nullif(v_slug, ''), 'estudio') || '-' || left(replace(auth.uid()::text, '-', ''), 8);
  INSERT INTO public.studios (user_id, email, name, normalized_name, slug, tagline, bio, founded_year, languages,
    instagram, whatsapp, website, contact_phone, cover_image, logo_image, photo_feed_items, is_active, profile_complete,
    verification_required, verification_reason)
  VALUES (auth.uid(), v_email, v_name, upper(v_name), v_slug, nullif(p_profile->>'tagline', ''), nullif(p_profile->>'bio', ''),
    nullif(p_profile->>'founded_year', '')::integer,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_profile->'languages', '[]'::jsonb))),
    nullif(p_profile->>'instagram', ''), nullif(p_profile->>'whatsapp', ''), nullif(p_profile->>'website', ''),
    nullif(p_profile->>'contact_phone', ''), nullif(p_profile->>'cover_image', ''), nullif(p_profile->>'logo_image', ''),
    coalesce(p_profile->'photo_feed_items', '[]'::jsonb), true, false,
    cardinality(v_matched) > 0, v_reason)
  RETURNING * INTO v_studio;
  FOR v_location IN SELECT value FROM jsonb_array_elements(p_locations) LOOP
    PERFORM public.save_studio_location(v_studio.id, NULL, v_location);
  END LOOP;
  IF cardinality(v_matched) > 0 THEN
    PERFORM private.open_studio_verification(v_studio.id, v_reason, v_matched, auth.uid());
  END IF;
  SELECT * INTO v_studio FROM public.studios WHERE id = v_studio.id;
  RETURN v_studio;
END; $function$;

drop function if exists private.studio_address_conflict(jsonb, text, text, double precision, double precision);
drop function if exists private.studio_street_key(text);

notify pgrst, 'reload schema';
commit;
