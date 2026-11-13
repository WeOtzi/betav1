-- Revision del registro de tatuadores (12 nov 2026, pag. 9):
-- estudio nuevo creado por un tatuador + link de alta para el representante.
--
-- 1. studios.location_verified (default true para no cambiar lo existente) y
--    studios.created_by_artist_user_id (quien lo creo desde el registro).
--    Los estudios que crea un tatuador nacen con location_verified = false.
-- 2. studio_claim_links: link de alta de UN SOLO USO, guardado hasheado
--    (sha256 hex). Solo service-role y funciones SECURITY DEFINER lo leen.
-- 3. public.issue_studio_claim_link (solo service_role): emite un link nuevo y
--    revoca los anteriores sin usar.
-- 4. private.claim_studio_with_link: el representante (logueado, email
--    confirmado) completa el alta: toma el estudio, puede corregir nombre y
--    ubicacion (la sede principal se actualiza EN EL LUGAR para que las
--    membresias de los tatuadores sigan apuntando a ella), propaga el nombre a
--    los tatuadores vinculados y marca la ubicacion como verificada.
-- 5. public.complete_studio_registration delega en (4) cuando el perfil trae
--    claim_token; sin token sigue llamando a private.complete_studio_registration
--    sin cambios.
-- 6. Guard: fuera de service-role/soporte nadie cambia location_verified ni
--    created_by_artist_user_id; los estudios de catalogo que inserta un usuario
--    autenticado nacen sin verificar.
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261112120000_studio_claim_links.down.sql

BEGIN;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS location_verified boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by_artist_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.studios.location_verified IS
  'false mientras el estudio fue creado por un tatuador y ningun representante completo el alta (link de studio_claim_links).';
COMMENT ON COLUMN public.studios.created_by_artist_user_id IS
  'Tatuador que creo el estudio desde su registro; puede regenerar el link de alta mientras el estudio no tenga duenio.';

CREATE INDEX IF NOT EXISTS idx_studios_created_by_artist
  ON public.studios (created_by_artist_user_id)
  WHERE created_by_artist_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.studio_claim_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CONSTRAINT studio_claim_links_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS studio_claim_links_token_hash_key
  ON public.studio_claim_links (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS studio_claim_links_one_open_per_studio
  ON public.studio_claim_links (studio_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.studio_claim_links ENABLE ROW LEVEL SECURITY;
-- Sin politicas: anon/authenticated no leen ni escriben; el servidor usa
-- service-role y el alta pasa por la funcion SECURITY DEFINER.
REVOKE ALL ON TABLE public.studio_claim_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.studio_claim_links TO service_role;

-- ---------------------------------------------------------------------------
-- Guard de las columnas nuevas de studios.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.guard_studio_location_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.role(), '') = 'service_role'
     OR public.is_support_user() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS NULL THEN
      -- Estudio de catalogo creado por un usuario: ubicacion sin verificar.
      NEW.location_verified := false;
      NEW.created_by_artist_user_id := auth.uid();
    ELSE
      NEW.location_verified := true;
      NEW.created_by_artist_user_id := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.location_verified IS DISTINCT FROM OLD.location_verified
     OR NEW.created_by_artist_user_id IS DISTINCT FROM OLD.created_by_artist_user_id THEN
    RAISE EXCEPTION 'La verificación de la ubicación del estudio la gestiona We Ötzi.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_studio_location_verified ON public.studios;
CREATE TRIGGER trg_guard_studio_location_verified
  BEFORE INSERT OR UPDATE ON public.studios
  FOR EACH ROW EXECUTE FUNCTION private.guard_studio_location_verified();

-- ---------------------------------------------------------------------------
-- Emision del link (service-role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_studio_claim_link(
  p_studio_id uuid,
  p_token_hash text,
  p_created_by uuid,
  p_ttl_days integer DEFAULT 30
)
RETURNS TABLE (link_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_ttl integer := greatest(1, least(coalesce(p_ttl_days, 30), 90));
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Hash de link inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_studio FROM public.studios s WHERE s.id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudio no encontrado.' USING ERRCODE = '22023';
  END IF;
  IF v_studio.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'El estudio ya completó su alta en We Ötzi.' USING ERRCODE = '23514';
  END IF;
  IF p_created_by IS NULL OR v_studio.created_by_artist_user_id IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Solo quien creó el estudio puede generar su link de alta.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.studio_claim_links l
     SET revoked_at = now()
   WHERE l.studio_id = p_studio_id AND l.used_at IS NULL AND l.revoked_at IS NULL;

  v_expires := now() + make_interval(days => v_ttl);
  INSERT INTO public.studio_claim_links (studio_id, token_hash, created_by, expires_at)
  VALUES (p_studio_id, p_token_hash, p_created_by, v_expires)
  RETURNING id INTO v_id;

  link_id := v_id;
  expires_at := v_expires;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_studio_claim_link(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_studio_claim_link(uuid, text, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Alta del estudio con el link (representante autenticado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.claim_studio_with_link(p_token text, p_profile jsonb, p_locations jsonb)
RETURNS public.studios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  v_link public.studio_claim_links%ROWTYPE;
  v_studio public.studios%ROWTYPE;
  v_email text;
  v_name text;
  v_normalized text;
  v_slug text;
  v_location jsonb;
  v_primary_done boolean := false;
  v_saved public.studio_locations%ROWTYPE;
  v_city text;
  v_languages text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Confirmá tu correo e iniciá sesión para completar el alta del estudio.' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RAISE EXCEPTION 'El link de alta del estudio no es válido.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.studio_claim_links l WHERE l.token_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El link de alta del estudio no es válido.' USING ERRCODE = '22023';
  END IF;

  -- Reintento del mismo representante despues de un alta exitosa: idempotente.
  IF v_link.used_at IS NOT NULL THEN
    IF v_link.used_by = v_uid THEN
      SELECT * INTO v_studio FROM public.studios s WHERE s.id = v_link.studio_id AND s.user_id = v_uid;
      IF FOUND THEN RETURN v_studio; END IF;
    END IF;
    RAISE EXCEPTION 'Este link de alta ya se usó. Pedile al tatuador que genere uno nuevo.' USING ERRCODE = '23514';
  END IF;
  IF v_link.revoked_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'Este link de alta venció. Pedile al tatuador que genere uno nuevo.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.studios s WHERE s.user_id = v_uid) THEN
    RAISE EXCEPTION 'Tu cuenta ya administra un estudio.' USING ERRCODE = '23514';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirmá tu correo antes de completar el alta del estudio.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_studio FROM public.studios s WHERE s.id = v_link.studio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El estudio de este link ya no existe.' USING ERRCODE = '22023';
  END IF;
  IF v_studio.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este estudio ya completó su alta en We Ötzi.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.studios s WHERE s.email = v_email AND s.id <> v_studio.id) THEN
    RAISE EXCEPTION 'Ese email ya está asociado a otro estudio.' USING ERRCODE = '23505';
  END IF;

  v_name := coalesce(nullif(btrim(p_profile->>'name'), ''), v_studio.name);
  IF length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 2 y 160 caracteres.' USING ERRCODE = '22023';
  END IF;
  v_normalized := upper(v_name);
  IF v_normalized <> v_studio.normalized_name
     AND EXISTS (SELECT 1 FROM public.studios s WHERE s.normalized_name = v_normalized AND s.id <> v_studio.id) THEN
    RAISE EXCEPTION 'Ya hay un estudio llamado «%» en We Ötzi. Elegí un nombre que lo distinga (por ejemplo, sumá el barrio o la ciudad).', v_name
      USING ERRCODE = '23505';
  END IF;
  IF jsonb_typeof(p_locations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_locations) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Agregá entre 1 y 30 sedes.' USING ERRCODE = '22023';
  END IF;

  v_slug := v_studio.slug;
  IF v_slug IS NULL THEN
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    v_slug := coalesce(nullif(v_slug, ''), 'estudio') || '-' || left(replace(v_uid::text, '-', ''), 8);
  END IF;
  v_languages := CASE
    WHEN jsonb_typeof(p_profile->'languages') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_profile->'languages'))
    ELSE v_studio.languages
  END;

  UPDATE public.studios s SET
    user_id = v_uid,
    email = v_email,
    name = v_name,
    normalized_name = v_normalized,
    slug = v_slug,
    tagline = coalesce(nullif(p_profile->>'tagline', ''), s.tagline),
    bio = coalesce(nullif(p_profile->>'bio', ''), s.bio),
    founded_year = coalesce(nullif(p_profile->>'founded_year', '')::integer, s.founded_year),
    languages = coalesce(v_languages, s.languages),
    instagram = coalesce(nullif(p_profile->>'instagram', ''), s.instagram),
    whatsapp = coalesce(nullif(p_profile->>'whatsapp', ''), s.whatsapp),
    website = coalesce(nullif(p_profile->>'website', ''), s.website),
    contact_phone = coalesce(nullif(p_profile->>'contact_phone', ''), s.contact_phone),
    cover_image = coalesce(nullif(p_profile->>'cover_image', ''), s.cover_image),
    logo_image = coalesce(nullif(p_profile->>'logo_image', ''), s.logo_image),
    photo_feed_items = CASE
      WHEN jsonb_typeof(p_profile->'photo_feed_items') = 'array' AND jsonb_array_length(p_profile->'photo_feed_items') > 0
        THEN p_profile->'photo_feed_items'
      ELSE s.photo_feed_items
    END,
    is_active = true,
    profile_complete = false,
    location_verified = true,
    updated_at = now()
  WHERE s.id = v_studio.id;

  -- Sedes: la principal del formulario reemplaza EN EL LUGAR a la sede
  -- principal actual (las membresias de los tatuadores la referencian); el
  -- resto se agregan. save_studio_location exige que el caller sea el duenio,
  -- condicion que ya se cumple.
  FOR v_location IN
    SELECT value FROM jsonb_array_elements(p_locations)
    ORDER BY coalesce((value->>'is_primary')::boolean, false) DESC
  LOOP
    IF NOT v_primary_done THEN
      v_saved := public.save_studio_location(
        v_studio.id,
        v_studio.primary_location_id,
        v_location || '{"is_primary": true}'::jsonb
      );
      v_primary_done := true;
      v_city := coalesce(v_saved.city, v_saved.locality);
    ELSE
      PERFORM public.save_studio_location(v_studio.id, NULL, v_location || '{"is_primary": false}'::jsonb);
    END IF;
  END LOOP;

  -- Los tatuadores vinculados leen el estudio por id; ademas se actualizan las
  -- copias de texto que guardan (nombre del estudio y ciudad de su sede).
  UPDATE public.artist_tattoo_locations t
     SET studio_name = v_normalized,
         city = coalesce(v_city, t.city)
   WHERE t.studio_id = v_studio.id
     AND (t.studio_name IS DISTINCT FROM v_normalized OR (v_city IS NOT NULL AND t.city IS DISTINCT FROM v_city));
  UPDATE public.artists_db a
     SET estudios = v_normalized
   WHERE a.studio_id = v_studio.id
     AND a.estudios IS DISTINCT FROM v_normalized;

  UPDATE public.studio_claim_links l
     SET used_at = now(), used_by = v_uid
   WHERE l.id = v_link.id;
  UPDATE public.studio_claim_links l
     SET revoked_at = now()
   WHERE l.studio_id = v_studio.id AND l.id <> v_link.id AND l.used_at IS NULL AND l.revoked_at IS NULL;

  SELECT * INTO v_studio FROM public.studios s WHERE s.id = v_studio.id;
  RETURN v_studio;
END;
$$;

REVOKE ALL ON FUNCTION private.claim_studio_with_link(text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.claim_studio_with_link(text, jsonb, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Punto de entrada del registro de estudios: misma firma y permisos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
RETURNS public.studios
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text := nullif(btrim(coalesce(p_profile->>'claim_token', '')), '');
BEGIN
  IF v_token IS NOT NULL THEN
    RETURN private.claim_studio_with_link(v_token, p_profile - 'claim_token', p_locations);
  END IF;
  RETURN private.complete_studio_registration(p_profile, p_locations);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_studio_registration(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_studio_registration(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
