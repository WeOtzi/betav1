-- Registro de estudios · sedes y coincidencias (beta cerrada, 15 nov 2026).
--
-- ER-04: public.save_studio_location escribía geocoded_at = now() siempre, aun
--   para sedes con dirección manual y sin coordenadas (15 de 47 sedes vivas). Ahora
--   geocoded_at solo se escribe cuando la sede tiene latitud y longitud válidas;
--   si no, queda NULL ("pin pendiente"). Lo mismo al sincronizar la sede
--   principal con public.studios. Además valida el rango de las coordenadas.
--   El resto del cuerpo es idéntico a la definición viva (pg_get_functiondef al
--   15 nov 2026): dueño, principal única, principal activa.
-- ER-01: public.find_studio_matches devuelve también `artist_created` (la ficha
--   la sumó un tatuador y tiene link de alta) para ofrecer "Pedile el link de alta
--   al tatuador que lo sumó". Nunca expone el id del tatuador.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115210100_estudio_registro_sedes.down.sql

begin;

create or replace function public.save_studio_location(p_studio_id uuid, p_location_id uuid, p_location jsonb)
returns public.studio_locations
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_studio public.studios;
  v_location public.studio_locations;
  v_primary boolean;
  v_lat double precision;
  v_lng double precision;
  v_geocoded timestamptz;
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
  -- Coordenadas: solo números finitos dentro de rango; si falta una, ninguna.
  v_lat := CASE WHEN jsonb_typeof(p_location->'latitude') IN ('number', 'string')
                 AND (p_location->>'latitude') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                THEN (p_location->>'latitude')::double precision END;
  v_lng := CASE WHEN jsonb_typeof(p_location->'longitude') IN ('number', 'string')
                 AND (p_location->>'longitude') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                THEN (p_location->>'longitude')::double precision END;
  IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
    v_lat := NULL; v_lng := NULL;
  END IF;
  v_geocoded := CASE WHEN v_lat IS NOT NULL AND v_lng IS NOT NULL THEN now() END;

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
    'latitude', v_lat, 'longitude', v_lng,
    'google_place_id', p_location->>'google_place_id', 'phone', p_location->>'phone',
    'hours_json', p_location->'hours_json', 'geocoded_at', v_geocoded
  ));
  IF v_primary AND NOT v_location.is_active THEN RAISE EXCEPTION 'La sede principal debe estar activa.'; END IF;
  IF p_location_id IS NULL THEN
    INSERT INTO public.studio_locations (studio_id, label, is_primary, is_active, country, country_code,
      state_province, city, locality, street, street_number, unit, postal_code, formatted_address,
      latitude, longitude, google_place_id, geocoded_at, phone, hours_json)
    VALUES (p_studio_id, v_location.label, v_primary, v_location.is_active, v_location.country, v_location.country_code,
      v_location.state_province, v_location.city, v_location.locality, v_location.street, v_location.street_number,
      v_location.unit, v_location.postal_code, v_location.formatted_address, v_lat, v_lng,
      v_location.google_place_id, v_geocoded, v_location.phone, v_location.hours_json)
    RETURNING * INTO v_location;
  ELSE
    UPDATE public.studio_locations SET label = v_location.label, is_primary = v_primary, is_active = v_location.is_active,
      country = v_location.country, country_code = v_location.country_code, state_province = v_location.state_province,
      city = v_location.city, locality = v_location.locality, street = v_location.street,
      street_number = v_location.street_number, unit = v_location.unit, postal_code = v_location.postal_code,
      formatted_address = v_location.formatted_address, latitude = v_lat, longitude = v_lng,
      google_place_id = v_location.google_place_id, geocoded_at = v_geocoded, phone = v_location.phone, hours_json = v_location.hours_json
    WHERE id = p_location_id RETURNING * INTO v_location;
  END IF;
  IF v_primary THEN
    UPDATE public.studios SET primary_location_id = v_location.id, profile_complete = true,
      country = v_location.country, country_code = v_location.country_code, city = v_location.city,
      state_province = v_location.state_province, locality = v_location.locality, street = v_location.street,
      street_number = v_location.street_number, unit = v_location.unit, postal_code = v_location.postal_code,
      formatted_address = v_location.formatted_address, latitude = v_lat, longitude = v_lng,
      google_place_id = v_location.google_place_id, geocoded_at = v_geocoded
    WHERE id = p_studio_id;
  END IF;
  RETURN v_location;
END; $function$;

create or replace function public.find_studio_matches(p_name text, p_instagram text default null)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'city', s.city, 'country', s.country, 'logo_image', s.logo_image,
      'owned', s.user_id is not null, 'verified', coalesce(s.is_verified, false), 'match', m.match_kind,
      'artist_created', s.user_id is null and s.created_by_artist_user_id is not null,
      'locations', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'label', l.label, 'formatted_address', l.formatted_address, 'city', l.city,
          'latitude', l.latitude, 'longitude', l.longitude) order by l.is_primary desc, l.sort_order)
        from public.studio_locations l where l.studio_id = s.id and l.is_active is not false
      ), case when s.formatted_address is not null or s.latitude is not null then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'label', 'Dirección del estudio', 'formatted_address', s.formatted_address, 'city', s.city,
          'latitude', s.latitude, 'longitude', s.longitude)) else '[]'::jsonb end)
    ) order by case m.match_kind when 'exact' then 0 when 'instagram' then 1 else 2 end, s.name), '[]'::jsonb)
  from private.studio_matches(
         case when pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) between 2 and 160 then p_name end,
         case when pg_catalog.length(coalesce(p_instagram, '')) <= 200 then p_instagram end) m
  join public.studios s on s.id = m.studio_id;
$function$;

commit;
