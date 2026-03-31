-- Normalize historical location strings to: Ciudad, Provincia, Pais
-- Applies to artist profile and quotation flow fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_location_city_province_country(raw_location TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  cleaned TEXT;
  parts TEXT[];
  unique_parts TEXT[] := ARRAY[]::TEXT[];
  result_parts TEXT[];
  candidate TEXT;
  start_idx INTEGER;
BEGIN
  IF raw_location IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := btrim(raw_location);
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Normalize separators and whitespace first.
  cleaned := replace(cleaned, ';', ',');
  cleaned := replace(cleaned, '/', ',');
  cleaned := regexp_replace(cleaned, E'\\s+', ' ', 'g');

  -- Remove common postal code patterns, e.g. B1641, 1641, 28013, 10001-1234.
  cleaned := regexp_replace(
    cleaned,
    E'\\m(?:[A-Za-z]{1,3}\\d{3,6}[A-Za-z]{0,3}|\\d{3,8}(?:-\\d{3,4})?)\\M',
    '',
    'gi'
  );

  cleaned := regexp_replace(cleaned, E'\\s+', ' ', 'g');

  parts := regexp_split_to_array(cleaned, E'\\s*,\\s*');

  FOREACH candidate IN ARRAY parts LOOP
    candidate := btrim(regexp_replace(candidate, E'\\s+', ' ', 'g'));
    candidate := regexp_replace(candidate, E'^[,.\\-\\s]+|[,.\\-\\s]+$', '', 'g');

    IF candidate IS NULL OR candidate = '' THEN
      CONTINUE;
    END IF;

    -- Case-insensitive de-duplication while preserving order.
    IF NOT EXISTS (
      SELECT 1
      FROM unnest(unique_parts) AS existing(value)
      WHERE lower(existing.value) = lower(candidate)
    ) THEN
      unique_parts := array_append(unique_parts, candidate);
    END IF;
  END LOOP;

  IF array_length(unique_parts, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Keep only the last 3 components (usually City, Province/State, Country).
  IF array_length(unique_parts, 1) > 3 THEN
    start_idx := array_length(unique_parts, 1) - 2;
    result_parts := unique_parts[start_idx:array_length(unique_parts, 1)];
  ELSE
    result_parts := unique_parts;
  END IF;

  RETURN array_to_string(result_parts, ', ');
END;
$function$;

UPDATE public.artists_db
SET ubicacion = public.normalize_location_city_province_country(ubicacion)
WHERE ubicacion IS NOT NULL
  AND btrim(ubicacion) <> ''
  AND ubicacion IS DISTINCT FROM public.normalize_location_city_province_country(ubicacion);

UPDATE public.quotations_db
SET client_city_residence = public.normalize_location_city_province_country(client_city_residence)
WHERE client_city_residence IS NOT NULL
  AND btrim(client_city_residence) <> ''
  AND client_city_residence IS DISTINCT FROM public.normalize_location_city_province_country(client_city_residence);

UPDATE public.quotations_db
SET artist_current_city = public.normalize_location_city_province_country(artist_current_city)
WHERE artist_current_city IS NOT NULL
  AND btrim(artist_current_city) <> ''
  AND artist_current_city IS DISTINCT FROM public.normalize_location_city_province_country(artist_current_city);

NOTIFY pgrst, 'reload schema';

COMMIT;
