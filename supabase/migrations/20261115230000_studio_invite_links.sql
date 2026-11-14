-- ===========================================================================
-- Enlaces de invitación del estudio (beta cerrada · frente roster, ROSTER-03/06)
-- ---------------------------------------------------------------------------
-- El estudio genera un enlace (/artist/join-studio?unirse=<token>) para que
-- los tatuadores se sumen a su equipo: con cuenta, se canjea desde la página
-- del enlace; sin cuenta, el token viaja por el registro y se canjea al crear
-- el perfil (POST /api/register/artist-finalize).
--
-- 1. public.studio_invite_links: el token se guarda solo como SHA-256 (hex).
--    Puede atarse a una sede, tiene rol, vencimiento, tope de usos y
--    revocación. Con invitee_email es una invitación personal (1 uso).
-- 2. public.studio_invite_link_uses: un uso por (enlace, artista).
-- 3. RLS habilitada SIN políticas (igual que studio_claim_links): anon y
--    authenticated no leen ni escriben; el servidor usa service_role.
-- 4. RPC solo service_role:
--    - public.issue_studio_invite_link: valida dueño (o soporte), estudio
--      activo, sede del estudio y un tope diario por estudio.
--    - public.redeem_studio_invite_link: canje atómico (FOR UPDATE + lock del
--      par estudio/artista). Si el par ya tiene un vínculo abierto lo devuelve
--      sin duplicar ni consumir usos. Con aprobación queda 'requested'
--      (initiated_by='artist'); sin aprobación queda 'active'
--      (initiated_by='studio'). Una invitación personal canjeada por otro
--      email cae a 'requested'.
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261115230000_studio_invite_links.down.sql
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.studio_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.studio_locations(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'resident',
  requires_approval boolean NOT NULL DEFAULT true,
  token_hash text NOT NULL,
  label text,
  invitee_email text,
  invitee_name text,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT studio_invite_links_role_check CHECK (role IN ('resident', 'guest', 'itinerant')),
  CONSTRAINT studio_invite_links_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT studio_invite_links_label_len CHECK (label IS NULL OR char_length(label) <= 80),
  CONSTRAINT studio_invite_links_invitee_email_len CHECK (invitee_email IS NULL OR char_length(invitee_email) <= 320),
  CONSTRAINT studio_invite_links_invitee_name_len CHECK (invitee_name IS NULL OR char_length(invitee_name) <= 120),
  CONSTRAINT studio_invite_links_max_uses_range CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 500),
  CONSTRAINT studio_invite_links_uses_count_range CHECK (uses_count >= 0 AND (max_uses IS NULL OR uses_count <= max_uses))
);

CREATE UNIQUE INDEX IF NOT EXISTS studio_invite_links_token_hash_key
  ON public.studio_invite_links (token_hash);
CREATE INDEX IF NOT EXISTS studio_invite_links_studio_created_idx
  ON public.studio_invite_links (studio_id, created_at DESC);

COMMENT ON TABLE public.studio_invite_links IS
  'Enlaces de invitación de un estudio para que tatuadores se sumen a su equipo. El token viaja solo en el enlace; acá se guarda su SHA-256.';

CREATE TABLE IF NOT EXISTS public.studio_invite_link_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.studio_invite_links(id) ON DELETE CASCADE,
  -- Sin FK a artists_db(user_id): la compensación del registro vuelve la fila
  -- del artista a borrador (user_id NULL) y una FK sin ON UPDATE lo bloquearía.
  artist_user_id uuid NOT NULL,
  membership_id uuid REFERENCES public.studio_artist_memberships(id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT studio_invite_link_uses_one_per_artist UNIQUE (link_id, artist_user_id)
);

CREATE INDEX IF NOT EXISTS studio_invite_link_uses_artist_idx
  ON public.studio_invite_link_uses (artist_user_id);

ALTER TABLE public.studio_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_invite_link_uses ENABLE ROW LEVEL SECURITY;
-- Sin políticas: el servidor usa service_role y el canje pasa por la RPC.
REVOKE ALL ON TABLE public.studio_invite_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.studio_invite_link_uses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.studio_invite_links TO service_role;
GRANT ALL ON TABLE public.studio_invite_link_uses TO service_role;

-- ---------------------------------------------------------------------------
-- Emisión (solo service_role; el servidor ya autenticó al dueño).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_studio_invite_link(
  p_studio_id uuid,
  p_created_by uuid,
  p_token_hash text,
  p_location_id uuid DEFAULT NULL,
  p_role text DEFAULT 'resident',
  p_requires_approval boolean DEFAULT true,
  p_max_uses integer DEFAULT NULL,
  p_ttl_days integer DEFAULT 30,
  p_label text DEFAULT NULL,
  p_invitee_email text DEFAULT NULL,
  p_invitee_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_role text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'resident');
  v_email text := nullif(lower(btrim(coalesce(p_invitee_email, ''))), '');
  v_name text := nullif(btrim(coalesce(p_invitee_name, '')), '');
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_ttl integer := least(greatest(coalesce(p_ttl_days, 30), 1), 90);
  v_max integer := p_max_uses;
  v_expires timestamptz;
  v_recent integer;
  v_id uuid;
BEGIN
  IF p_studio_id IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'Faltan el estudio o quien genera el enlace.' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_studio FROM public.studios s WHERE s.id = p_studio_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(v_studio.is_active, false) THEN
    RAISE EXCEPTION 'Ese estudio no está disponible.' USING ERRCODE = '22023';
  END IF;
  IF v_studio.user_id IS DISTINCT FROM p_created_by AND NOT EXISTS (
    SELECT 1 FROM public.support_users_db su WHERE su.user_id = p_created_by AND su.is_active = true
  ) THEN
    RAISE EXCEPTION 'Solo el dueño del estudio genera enlaces de invitación.' USING ERRCODE = '42501';
  END IF;
  IF v_studio.user_id IS NULL THEN
    RAISE EXCEPTION 'El estudio todavía no tiene dueño: nadie podría aprobar las altas.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('resident', 'guest', 'itinerant') THEN
    RAISE EXCEPTION 'Elegí un rol válido: residente, guest o itinerante.' USING ERRCODE = '22023';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.studio_locations l WHERE l.id = p_location_id AND l.studio_id = p_studio_id
  ) THEN
    RAISE EXCEPTION 'La sede elegida no pertenece a tu estudio.' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 320) THEN
    RAISE EXCEPTION 'El email no es válido.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 120 THEN
    v_name := left(v_name, 120);
  END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 80 THEN
    v_label := left(v_label, 80);
  END IF;
  IF v_email IS NOT NULL THEN
    v_max := 1;
  ELSIF v_max IS NOT NULL AND (v_max < 1 OR v_max > 500) THEN
    RAISE EXCEPTION 'El tope de usos va de 1 a 500.' USING ERRCODE = '22023';
  END IF;

  -- Tope anti-abuso: 40 enlaces por estudio en 24 h (incluye los personales).
  SELECT count(*) INTO v_recent
  FROM public.studio_invite_links l
  WHERE l.studio_id = p_studio_id
    AND l.created_at > timezone('utc', now()) - interval '24 hours';
  IF v_recent >= 40 THEN
    RAISE EXCEPTION 'Generaste muchos enlaces hoy. Probá de nuevo mañana.' USING ERRCODE = '23514';
  END IF;

  v_expires := timezone('utc', now()) + make_interval(days => v_ttl);

  INSERT INTO public.studio_invite_links (
    studio_id, location_id, role, requires_approval, token_hash, label,
    invitee_email, invitee_name, max_uses, expires_at, created_by
  ) VALUES (
    p_studio_id, p_location_id, v_role, coalesce(p_requires_approval, true), p_token_hash, v_label,
    v_email, v_name, v_max, v_expires, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'expires_at', v_expires,
    'role', v_role,
    'location_id', p_location_id,
    'requires_approval', coalesce(p_requires_approval, true),
    'max_uses', v_max
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_studio_invite_link(uuid, uuid, text, uuid, text, boolean, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_studio_invite_link(uuid, uuid, text, uuid, text, boolean, integer, integer, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Canje (solo service_role; el servidor ya autenticó al artista o lo acaba de
-- crear en el registro). Devuelve jsonb con `status`:
--   'requested' | 'active'                     → vínculo creado o existente
--   'invalid' | 'revoked' | 'expired' | 'exhausted' | 'unavailable' | 'not_artist'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_studio_invite_link(
  p_token_hash text,
  p_artist_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_link public.studio_invite_links%ROWTYPE;
  v_studio public.studios%ROWTYPE;
  v_artist public.artists_db%ROWTYPE;
  v_open public.studio_artist_memberships%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_status text;
  v_initiated text;
  v_location uuid;
  v_membership_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_artist_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_link FROM public.studio_invite_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_artist FROM public.artists_db a WHERE a.user_id = p_artist_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_artist');
  END IF;

  SELECT * INTO v_studio FROM public.studios s WHERE s.id = v_link.studio_id;
  IF NOT FOUND OR NOT coalesce(v_studio.is_active, false) OR v_studio.user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  PERFORM private.lock_studio_artist_pair(v_link.studio_id, p_artist_user_id);

  -- Vínculo abierto del par (cualquier rol): se devuelve sin duplicar ni
  -- consumir un uso. Un canje repetido del mismo artista es idempotente.
  SELECT * INTO v_open
  FROM public.studio_artist_memberships m
  WHERE m.studio_id = v_link.studio_id
    AND m.artist_user_id = p_artist_user_id
    AND m.status IN ('requested', 'pending_invite', 'pending_acceptance', 'active', 'paused')
  ORDER BY (m.status = 'active') DESC, m.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', v_open.status,
      'membership_id', v_open.id,
      'studio_id', v_open.studio_id,
      'location_id', v_open.location_id,
      'role', v_open.role,
      'already_member', true
    );
  END IF;

  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;
  IF v_link.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF v_link.max_uses IS NOT NULL AND v_link.uses_count >= v_link.max_uses THEN
    RETURN jsonb_build_object('status', 'exhausted');
  END IF;

  v_location := CASE
    WHEN v_link.location_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studio_locations l WHERE l.id = v_link.location_id AND l.studio_id = v_link.studio_id
    ) THEN v_link.location_id
  END;

  -- Invitación personal canjeada por otra persona: queda para aprobar.
  IF v_link.requires_approval
     OR (v_link.invitee_email IS NOT NULL
         AND lower(btrim(coalesce(v_artist.email, ''))) IS DISTINCT FROM lower(v_link.invitee_email)) THEN
    v_status := 'requested';
    v_initiated := 'artist';
  ELSE
    v_status := 'active';
    v_initiated := 'studio';
  END IF;

  INSERT INTO public.studio_artist_memberships (
    studio_id, artist_user_id, location_id, role, status, initiated_by,
    invited_at, invited_by_user_id, started_at
  ) VALUES (
    v_link.studio_id, p_artist_user_id, v_location, v_link.role, v_status, v_initiated,
    v_now, v_link.created_by, CASE WHEN v_status = 'active' THEN v_now END
  )
  RETURNING id INTO v_membership_id;

  IF v_status = 'requested' THEN
    INSERT INTO public.studio_membership_request_details (membership_id, message, portfolio_url, styles)
    VALUES (
      v_membership_id,
      'Se sumó con el enlace de invitación del estudio.',
      CASE WHEN coalesce(v_artist.portafolio, '') ~* '^https?://' AND char_length(v_artist.portafolio) <= 500
           THEN v_artist.portafolio END,
      coalesce(v_artist.styles_array::text[], ARRAY[]::text[])
    )
    ON CONFLICT (membership_id) DO NOTHING;
  END IF;

  UPDATE public.studio_invite_links l
     SET uses_count = l.uses_count + 1
   WHERE l.id = v_link.id;

  INSERT INTO public.studio_invite_link_uses (link_id, artist_user_id, membership_id, used_at)
  VALUES (v_link.id, p_artist_user_id, v_membership_id, v_now)
  ON CONFLICT (link_id, artist_user_id) DO UPDATE SET membership_id = EXCLUDED.membership_id, used_at = EXCLUDED.used_at;

  RETURN jsonb_build_object(
    'status', v_status,
    'membership_id', v_membership_id,
    'studio_id', v_link.studio_id,
    'location_id', v_location,
    'role', v_link.role,
    'already_member', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.redeem_studio_invite_link(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_studio_invite_link(text, uuid) TO service_role;

COMMIT;
