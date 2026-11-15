-- ===========================================================================
-- Ronda 2 · frente "favoritos" (P22) · Listas de favoritos del cliente
-- ---------------------------------------------------------------------------
-- El cliente crea listas y guarda en ellas artistas, diseños del portfolio,
-- merch y estudios (public/shared/js/wo-favorites.js + /client/favorites).
--
-- 1. public.favorite_lists: listas por usuario (dueño, nombre, orden). Cada
--    usuario tiene UNA lista por defecto ("Favoritos") que no se puede borrar
--    ni desmarcar. Nombre único por dueño (sin distinguir mayúsculas).
-- 2. public.favorite_items: lo guardado en cada lista. kind = artist | design
--    | merch | studio; target_id es texto (artist → artists_db.user_id,
--    studio → studios.id, design/merch de la Store → store_products.id; un
--    diseño del portfolio usa el id estable que pinte el perfil). Snapshot
--    mínimo (label, image_url, url) para pintar "Mis favoritos" sin consultar
--    cada destino. Único por (lista, kind, target). artist_user_id: el artista
--    guardado (kind = artist) o el autor del diseño/merch, si se conoce.
-- 3. RLS de dueño (auth.uid() = owner_user_id) + lectura de soporte, igual que
--    client_favorites. anon no tiene acceso. La FK compuesta
--    (list_id, owner_user_id) impide guardar en la lista de otra persona.
-- 4. Topes contra abuso: 50 listas por usuario y 500 ítems por lista.
-- 5. RPC del dueño (security invoker, pasan por RLS):
--      public.favorites_default_list_id()  → id de su lista por defecto (la crea)
--      public.favorites_save(kind, target, label, image, url, artist, list)
--        → guarda (o refresca el snapshot) en la lista dada o en la de defecto
-- 6. Contadores públicos (security definer, solo agregados, sin datos de quién
--    guardó). Los usa el cálculo "Most Wanted" del perfil público:
--      public.favorite_artist_save_counts(uuid[])
--        → (artist_user_id, saved_count, items_saved_count)
--      public.favorite_target_save_counts(kind, text[])
--        → (target_id, saved_count)
-- 7. Compatibilidad con client_favorites (NO se borra): se copian sus filas a
--    la lista por defecto de cada cliente y dos triggers la mantienen como
--    espejo de "artistas guardados en alguna lista": lo que escribe el código
--    viejo aparece en las listas y lo que se guarda en las listas aparece en
--    client_favorites. Si se revierte esta migración, client_favorites queda
--    completa.
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261116190000_favoritos_listas.down.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Listas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.favorite_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorite_lists_name_check
    CHECK (char_length(name) BETWEEN 1 AND 60 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  CONSTRAINT favorite_lists_sort_order_range CHECK (sort_order BETWEEN 0 AND 100000),
  CONSTRAINT favorite_lists_id_owner_key UNIQUE (id, owner_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS favorite_lists_one_default_idx
  ON public.favorite_lists (owner_user_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS favorite_lists_owner_name_idx
  ON public.favorite_lists (owner_user_id, lower(name));

COMMENT ON TABLE public.favorite_lists IS
  'Listas de favoritos de un usuario (P22). Una por defecto ("Favoritos") por dueño.';

-- ---------------------------------------------------------------------------
-- 2. Ítems
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.favorite_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL,
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL,
  target_id text NOT NULL,
  label text,
  image_url text,
  url text,
  artist_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorite_items_list_owner_fkey
    FOREIGN KEY (list_id, owner_user_id)
    REFERENCES public.favorite_lists (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT favorite_items_kind_check CHECK (kind IN ('artist', 'design', 'merch', 'studio')),
  CONSTRAINT favorite_items_target_check
    CHECK (char_length(target_id) BETWEEN 1 AND 200 AND target_id = btrim(target_id) AND target_id !~ '[[:cntrl:]]'),
  CONSTRAINT favorite_items_label_len CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 160),
  -- Imagen: https absoluta o ruta local del sitio. Nunca data:, javascript: ni //host.
  CONSTRAINT favorite_items_image_url_check CHECK (
    image_url IS NULL OR (
      char_length(image_url) <= 1000
      AND image_url ~ '^(https://[^[:space:]]+|/[^/\\[:space:]][^[:space:]]*)$'
    )
  ),
  -- Destino: solo rutas del mismo sitio ("/algo"), nunca otro origen.
  CONSTRAINT favorite_items_url_check CHECK (
    url IS NULL OR (
      char_length(url) <= 600
      AND url ~ '^/([^/\\[:space:]][^[:space:]]*)?$'
    )
  ),
  CONSTRAINT favorite_items_unique_target UNIQUE (list_id, kind, target_id)
);

CREATE INDEX IF NOT EXISTS favorite_items_owner_idx
  ON public.favorite_items (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS favorite_items_artist_idx
  ON public.favorite_items (artist_user_id, kind) WHERE artist_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS favorite_items_kind_target_idx
  ON public.favorite_items (kind, target_id);

COMMENT ON TABLE public.favorite_items IS
  'Elementos guardados en una lista de favoritos (P22): artista, diseño, merch o estudio, con snapshot mínimo para pintarlos.';
COMMENT ON COLUMN public.favorite_items.target_id IS
  'artist → artists_db.user_id · studio → studios.id · design/merch de la Store → store_products.id · diseño del portfolio → id estable del ítem.';
COMMENT ON COLUMN public.favorite_items.artist_user_id IS
  'Artista guardado (kind = artist, lo completa el trigger) o autor del diseño/merch si el botón lo informa (data-artist-id).';

-- ---------------------------------------------------------------------------
-- 3. Guardas: normalización, campos inmutables y topes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.favorite_lists_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.name := btrim(regexp_replace(coalesce(NEW.name, ''), '\s+', ' ', 'g'));
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      RAISE EXCEPTION 'favorites:owner_immutable' USING ERRCODE = '42501';
    END IF;
    -- La lista por defecto no se puede desmarcar (sí se puede renombrar).
    IF OLD.is_default AND NOT NEW.is_default THEN
      RAISE EXCEPTION 'favorites:default_required' USING ERRCODE = '42501';
    END IF;
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.favorite_lists l WHERE l.owner_user_id = NEW.owner_user_id) >= 50 THEN
    RAISE EXCEPTION 'favorites:list_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION private.favorite_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.target_id := btrim(coalesce(NEW.target_id, ''));
  NEW.label := nullif(left(btrim(regexp_replace(coalesce(NEW.label, ''), '\s+', ' ', 'g')), 160), '');
  NEW.image_url := nullif(btrim(coalesce(NEW.image_url, '')), '');
  NEW.url := nullif(btrim(coalesce(NEW.url, '')), '');
  IF NEW.kind = 'artist' THEN
    NEW.target_id := lower(NEW.target_id);
    NEW.artist_user_id := CASE
      WHEN NEW.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.target_id::uuid
      ELSE NULL
    END;
  ELSIF NEW.kind = 'studio' THEN
    NEW.artist_user_id := NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.target_id IS DISTINCT FROM OLD.target_id THEN
      RAISE EXCEPTION 'favorites:item_immutable' USING ERRCODE = '42501';
    END IF;
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    -- Sin cambio de lista no hay tope que revisar.
    IF NEW.list_id IS NOT DISTINCT FROM OLD.list_id THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Tope por lista. Volver a guardar algo que ya está no cuenta como alta.
  IF (SELECT count(*) FROM public.favorite_items i WHERE i.list_id = NEW.list_id) >= 500
     AND NOT EXISTS (
       SELECT 1 FROM public.favorite_items i
       WHERE i.list_id = NEW.list_id AND i.kind = NEW.kind AND i.target_id = NEW.target_id
     ) THEN
    RAISE EXCEPTION 'favorites:item_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_favorite_lists_guard ON public.favorite_lists;
CREATE TRIGGER trg_favorite_lists_guard
  BEFORE INSERT OR UPDATE ON public.favorite_lists
  FOR EACH ROW EXECUTE FUNCTION private.favorite_lists_guard();

DROP TRIGGER IF EXISTS trg_favorite_lists_updated_at ON public.favorite_lists;
CREATE TRIGGER trg_favorite_lists_updated_at
  BEFORE UPDATE ON public.favorite_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_favorite_items_guard ON public.favorite_items;
CREATE TRIGGER trg_favorite_items_guard
  BEFORE INSERT OR UPDATE ON public.favorite_items
  FOR EACH ROW EXECUTE FUNCTION private.favorite_items_guard();

-- ---------------------------------------------------------------------------
-- 4. RLS y privilegios
-- ---------------------------------------------------------------------------
ALTER TABLE public.favorite_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorite_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favorite_lists_owner_select ON public.favorite_lists;
CREATE POLICY favorite_lists_owner_select ON public.favorite_lists
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id);

DROP POLICY IF EXISTS favorite_lists_owner_insert ON public.favorite_lists;
CREATE POLICY favorite_lists_owner_insert ON public.favorite_lists
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

DROP POLICY IF EXISTS favorite_lists_owner_update ON public.favorite_lists;
CREATE POLICY favorite_lists_owner_update ON public.favorite_lists
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

-- La lista por defecto no se borra (sí cae por CASCADE al borrar la cuenta).
DROP POLICY IF EXISTS favorite_lists_owner_delete ON public.favorite_lists;
CREATE POLICY favorite_lists_owner_delete ON public.favorite_lists
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id AND NOT is_default);

DROP POLICY IF EXISTS favorite_lists_support_read ON public.favorite_lists;
CREATE POLICY favorite_lists_support_read ON public.favorite_lists
  FOR SELECT TO authenticated
  USING (public.is_support_user());

DROP POLICY IF EXISTS favorite_items_owner_all ON public.favorite_items;
CREATE POLICY favorite_items_owner_all ON public.favorite_items
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

DROP POLICY IF EXISTS favorite_items_support_read ON public.favorite_items;
CREATE POLICY favorite_items_support_read ON public.favorite_items
  FOR SELECT TO authenticated
  USING (public.is_support_user());

REVOKE ALL ON public.favorite_lists FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.favorite_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_items TO authenticated;
GRANT ALL ON public.favorite_lists TO service_role;
GRANT ALL ON public.favorite_items TO service_role;

-- ---------------------------------------------------------------------------
-- 5. RPC del dueño
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.favorites_default_list_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'favorites:auth_required' USING ERRCODE = '28000';
  END IF;
  SELECT l.id INTO v_id
  FROM public.favorite_lists l
  WHERE l.owner_user_id = v_uid AND l.is_default
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  -- Una lista "Favoritos" sin marcar (creada a mano) pasa a ser la de defecto.
  UPDATE public.favorite_lists l
  SET is_default = true
  WHERE l.owner_user_id = v_uid AND lower(l.name) = 'favoritos'
  RETURNING l.id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  BEGIN
    INSERT INTO public.favorite_lists (owner_user_id, name, is_default, sort_order)
    VALUES (v_uid, 'Favoritos', true, 0)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Otra pestaña la creó al mismo tiempo.
    SELECT l.id INTO v_id
    FROM public.favorite_lists l
    WHERE l.owner_user_id = v_uid AND l.is_default
    LIMIT 1;
  END;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.favorites_save(
  p_kind text,
  p_target_id text,
  p_label text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_artist_user_id uuid DEFAULT NULL,
  p_list_id uuid DEFAULT NULL
)
RETURNS public.favorite_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_list uuid := p_list_id;
  v_row public.favorite_items;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'favorites:auth_required' USING ERRCODE = '28000';
  END IF;
  IF v_list IS NULL THEN
    v_list := public.favorites_default_list_id();
  END IF;
  INSERT INTO public.favorite_items AS fi
    (list_id, owner_user_id, kind, target_id, label, image_url, url, artist_user_id)
  VALUES
    (v_list, v_uid, p_kind, p_target_id, p_label, p_image_url, p_url, p_artist_user_id)
  ON CONFLICT (list_id, kind, target_id) DO UPDATE
    SET label = coalesce(excluded.label, fi.label),
        image_url = coalesce(excluded.image_url, fi.image_url),
        url = coalesce(excluded.url, fi.url),
        artist_user_id = coalesce(excluded.artist_user_id, fi.artist_user_id)
  RETURNING fi.* INTO v_row;
  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.favorites_default_list_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.favorites_save(text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.favorites_default_list_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.favorites_save(text, text, text, text, text, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.favorites_save(text, text, text, text, text, uuid, uuid) IS
  'Guarda (o refresca el snapshot de) un favorito en la lista dada o, sin lista, en la de defecto del usuario. Pasa por RLS.';

-- ---------------------------------------------------------------------------
-- 6. Contadores públicos (solo agregados)
-- ---------------------------------------------------------------------------
-- saved_count: personas distintas que guardaron al artista (sin contarse a sí
-- mismo). items_saved_count: guardados de sus diseños/merch (persona + ítem),
-- cuando el botón informó al autor. Hasta 200 artistas por llamada.
CREATE OR REPLACE FUNCTION public.favorite_artist_save_counts(p_artist_user_ids uuid[])
RETURNS TABLE (artist_user_id uuid, saved_count integer, items_saved_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ids.id,
         (SELECT count(DISTINCT fi.owner_user_id)
            FROM public.favorite_items fi
           WHERE fi.artist_user_id = ids.id
             AND fi.kind = 'artist'
             AND fi.owner_user_id <> ids.id)::integer,
         (SELECT count(*)
            FROM (SELECT DISTINCT fi.owner_user_id, fi.kind, fi.target_id
                    FROM public.favorite_items fi
                   WHERE fi.artist_user_id = ids.id
                     AND fi.kind IN ('design', 'merch')
                     AND fi.owner_user_id <> ids.id) s)::integer
  FROM (
    SELECT DISTINCT u.id
    FROM unnest((coalesce(p_artist_user_ids, '{}'::uuid[]))[1:200]) AS u(id)
    WHERE u.id IS NOT NULL
  ) ids
$$;

-- Veces guardado de cualquier destino (p. ej. cada diseño del portfolio):
-- personas distintas que lo tienen en alguna lista. Hasta 200 ids por llamada.
CREATE OR REPLACE FUNCTION public.favorite_target_save_counts(p_kind text, p_target_ids text[])
RETURNS TABLE (target_id text, saved_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ids.id,
         (SELECT count(DISTINCT fi.owner_user_id)
            FROM public.favorite_items fi
           WHERE fi.kind = p_kind
             AND fi.target_id = ids.id)::integer
  FROM (
    SELECT DISTINCT CASE WHEN p_kind = 'artist' THEN lower(btrim(u.id)) ELSE btrim(u.id) END AS id
    FROM unnest((coalesce(p_target_ids, '{}'::text[]))[1:200]) AS u(id)
    WHERE u.id IS NOT NULL AND btrim(u.id) <> ''
  ) ids
  WHERE p_kind IN ('artist', 'design', 'merch', 'studio')
$$;

REVOKE ALL ON FUNCTION public.favorite_artist_save_counts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.favorite_target_save_counts(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.favorite_artist_save_counts(uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.favorite_target_save_counts(text, text[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.favorite_artist_save_counts(uuid[]) IS
  'Veces guardado por artista (agregado público para "Most Wanted"): saved_count = personas que guardaron al artista; items_saved_count = guardados de sus diseños/merch.';
COMMENT ON FUNCTION public.favorite_target_save_counts(text, text[]) IS
  'Veces guardado por destino (agregado público): personas distintas que tienen ese artista/diseño/merch/estudio en alguna lista.';

-- ---------------------------------------------------------------------------
-- 7. Compatibilidad con client_favorites
-- ---------------------------------------------------------------------------
-- Snapshot de un artista para pintarlo en "Mis favoritos".
CREATE OR REPLACE FUNCTION private.favorite_artist_snapshot(p_artist_user_id uuid)
RETURNS TABLE (label text, image_url text, url text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(left(btrim(coalesce(a.name, a.username, '')), 160), ''),
         CASE
           WHEN a.profile_picture ~ '^https://[^[:space:]]+$' AND char_length(a.profile_picture) <= 1000
             THEN a.profile_picture
           ELSE NULL
         END,
         CASE
           WHEN a.username ~ '^[A-Za-z0-9._-]{1,80}$' THEN '/artist/profile?artist=' || a.username
           ELSE '/artist/profile?id=' || p_artist_user_id::text
         END
  FROM (SELECT 1) one
  LEFT JOIN public.artists_db a ON a.user_id = p_artist_user_id
$$;

-- 7.a Copia de lo existente (una vez; volver a correrla no duplica).
INSERT INTO public.favorite_lists (owner_user_id, name, is_default, sort_order)
SELECT DISTINCT cf.client_user_id, 'Favoritos', true, 0
FROM public.client_favorites cf
WHERE NOT EXISTS (
  SELECT 1 FROM public.favorite_lists l
  WHERE l.owner_user_id = cf.client_user_id AND (l.is_default OR lower(l.name) = 'favoritos')
);

UPDATE public.favorite_lists l
SET is_default = true
WHERE lower(l.name) = 'favoritos'
  AND NOT l.is_default
  AND EXISTS (SELECT 1 FROM public.client_favorites cf WHERE cf.client_user_id = l.owner_user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.favorite_lists d
    WHERE d.owner_user_id = l.owner_user_id AND d.is_default
  );

INSERT INTO public.favorite_items (list_id, owner_user_id, kind, target_id, label, image_url, url, created_at)
SELECT l.id, cf.client_user_id, 'artist', cf.artist_user_id::text, s.label, s.image_url, s.url, cf.created_at
FROM public.client_favorites cf
JOIN public.favorite_lists l ON l.owner_user_id = cf.client_user_id AND l.is_default
CROSS JOIN LATERAL private.favorite_artist_snapshot(cf.artist_user_id) s
WHERE NOT EXISTS (
  SELECT 1 FROM public.favorite_items fi
  WHERE fi.owner_user_id = cf.client_user_id
    AND fi.kind = 'artist'
    AND fi.target_id = cf.artist_user_id::text
)
ON CONFLICT (list_id, kind, target_id) DO NOTHING;

-- 7.b Listas → client_favorites: guardar/quitar un artista en las listas.
CREATE OR REPLACE FUNCTION private.favorite_items_sync_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'artist' AND NEW.artist_user_id IS NOT NULL THEN
      INSERT INTO public.client_favorites (client_user_id, artist_user_id, created_at)
      VALUES (NEW.owner_user_id, NEW.artist_user_id, NEW.created_at)
      ON CONFLICT (client_user_id, artist_user_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: sale del espejo solo si ya no está en ninguna lista del dueño.
  IF OLD.kind = 'artist' AND OLD.artist_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.favorite_items i
       WHERE i.owner_user_id = OLD.owner_user_id
         AND i.kind = 'artist'
         AND i.artist_user_id = OLD.artist_user_id
     ) THEN
    DELETE FROM public.client_favorites cf
    WHERE cf.client_user_id = OLD.owner_user_id
      AND cf.artist_user_id = OLD.artist_user_id;
  END IF;
  RETURN OLD;
END
$$;

-- 7.c client_favorites → listas: lo que escribe el código anterior.
CREATE OR REPLACE FUNCTION private.client_favorites_sync_lists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_list uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.favorite_items i
    WHERE i.owner_user_id = OLD.client_user_id
      AND i.kind = 'artist'
      AND i.artist_user_id = OLD.artist_user_id;
    RETURN OLD;
  END IF;

  -- Ya está en alguna lista (p. ej. el alta vino de las listas): nada que hacer.
  IF EXISTS (
    SELECT 1 FROM public.favorite_items i
    WHERE i.owner_user_id = NEW.client_user_id
      AND i.kind = 'artist'
      AND i.artist_user_id = NEW.artist_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- El espejo nunca debe hacer fallar la escritura original.
  BEGIN
    SELECT l.id INTO v_list
    FROM public.favorite_lists l
    WHERE l.owner_user_id = NEW.client_user_id AND l.is_default
    LIMIT 1;
    IF v_list IS NULL THEN
      UPDATE public.favorite_lists l
      SET is_default = true
      WHERE l.owner_user_id = NEW.client_user_id AND lower(l.name) = 'favoritos'
      RETURNING l.id INTO v_list;
    END IF;
    IF v_list IS NULL THEN
      INSERT INTO public.favorite_lists (owner_user_id, name, is_default, sort_order)
      VALUES (NEW.client_user_id, 'Favoritos', true, 0)
      RETURNING id INTO v_list;
    END IF;
    INSERT INTO public.favorite_items (list_id, owner_user_id, kind, target_id, label, image_url, url, created_at)
    SELECT v_list, NEW.client_user_id, 'artist', NEW.artist_user_id::text, s.label, s.image_url, s.url, NEW.created_at
    FROM private.favorite_artist_snapshot(NEW.artist_user_id) s
    ON CONFLICT (list_id, kind, target_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'favorites: no se pudo reflejar client_favorites en las listas (%)', SQLERRM;
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_favorite_items_sync_legacy ON public.favorite_items;
CREATE TRIGGER trg_favorite_items_sync_legacy
  AFTER INSERT OR DELETE ON public.favorite_items
  FOR EACH ROW EXECUTE FUNCTION private.favorite_items_sync_legacy();

DROP TRIGGER IF EXISTS trg_client_favorites_sync_lists ON public.client_favorites;
CREATE TRIGGER trg_client_favorites_sync_lists
  AFTER INSERT OR DELETE ON public.client_favorites
  FOR EACH ROW EXECUTE FUNCTION private.client_favorites_sync_lists();

-- Las funciones de trigger y el helper no son RPC.
REVOKE ALL ON FUNCTION private.favorite_lists_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.favorite_items_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.favorite_items_sync_legacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.client_favorites_sync_lists() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.favorite_artist_snapshot(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
