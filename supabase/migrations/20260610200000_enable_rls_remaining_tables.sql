-- Habilita RLS en las 8 tablas que seguian expuestas a la anon key y cubre los
-- huecos de politicas para que ningun flujo actual se rompa:
--   quotations_db, quotations_attachments, quotation_flow_config, body_parts,
--   clients_db, conversation_history, pending_messages, pending_images
--
-- Las politicas "dormidas" ya existentes (creadas por migraciones previas pero
-- inactivas porque RLS estaba deshabilitado) se conservan tal cual.
--
-- El registro de cliente corre sin sesion (confirmacion de email activa), por lo
-- que la creacion del perfil se mueve al trigger handle_new_user (SECURITY
-- DEFINER): lee los datos del formulario desde raw_user_meta_data y vincula las
-- cotizaciones huerfanas por email. El INSERT client-side queda como fallback y
-- falla en silencio bajo RLS.

-- ============================================================
-- 1) handle_new_user: perfil de cliente + vinculo de cotizaciones
--    (logica de artistas sin cambios)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  extracted_name text;
  extracted_username text;
BEGIN
  IF lower(coalesce(new.email, '')) = 'isai@weotzi.com'
     OR lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'superadmin'
     OR lower(coalesce(new.raw_app_meta_data->>'role', '')) = 'superadmin' THEN
    RETURN new;
  END IF;

  extracted_name := COALESCE(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  extracted_username := COALESCE(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'preferred_username',
    split_part(new.email, '@', 1)
  );

  INSERT INTO public.artists_db (user_id, email, name, username)
  VALUES (
    new.id,
    new.email,
    extracted_name,
    extracted_username
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(artists_db.name, EXCLUDED.name),
    username = COALESCE(artists_db.username, EXCLUDED.username);

  IF lower(coalesce(new.raw_user_meta_data->>'user_type', '')) = 'client' THEN
    -- Nunca bloquear el signup por un problema del perfil
    BEGIN
      INSERT INTO public.clients_db (
        user_id, email, full_name, whatsapp, birth_date, age, instagram,
        city_residence, health_conditions, allergies, email_verified
      )
      VALUES (
        new.id,
        new.email,
        extracted_name,
        nullif(new.raw_user_meta_data->>'whatsapp', ''),
        nullif(new.raw_user_meta_data->>'birth_date', '')::date,
        COALESCE(
          nullif(new.raw_user_meta_data->>'age', '')::int,
          CASE WHEN nullif(new.raw_user_meta_data->>'birth_date', '') IS NOT NULL
            THEN date_part('year', age((new.raw_user_meta_data->>'birth_date')::date))::int
          END
        ),
        nullif(new.raw_user_meta_data->>'instagram', ''),
        nullif(new.raw_user_meta_data->>'city_residence', ''),
        nullif(new.raw_user_meta_data->>'health_conditions', ''),
        nullif(new.raw_user_meta_data->>'allergies', ''),
        false
      )
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    BEGIN
      UPDATE public.quotations_db
      SET client_user_id = new.id
      WHERE client_user_id IS NULL
        AND lower((client_email)::text) = lower(coalesce(new.email, ''));
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN new;
END;
$$;

-- ============================================================
-- 2) Politicas faltantes
-- ============================================================

-- Artistas pueden borrar sus cotizaciones archivadas (archive.js)
DROP POLICY IF EXISTS "Artists can delete own archived quotations" ON public.quotations_db;
CREATE POLICY "Artists can delete own archived quotations"
  ON public.quotations_db FOR DELETE TO authenticated
  USING (auth.uid() = artist_id AND is_archived = true);

-- Soporte puede modificar/borrar perfiles de cliente
DROP POLICY IF EXISTS clients_support_update ON public.clients_db;
CREATE POLICY clients_support_update
  ON public.clients_db FOR UPDATE TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());

DROP POLICY IF EXISTS clients_support_delete ON public.clients_db;
CREATE POLICY clients_support_delete
  ON public.clients_db FOR DELETE TO authenticated
  USING (public.is_support_user());

-- quotations_attachments: espeja la visibilidad de su cotizacion padre
DROP POLICY IF EXISTS attachments_public_insert ON public.quotations_attachments;
CREATE POLICY attachments_public_insert
  ON public.quotations_attachments FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS attachments_select_visible ON public.quotations_attachments;
CREATE POLICY attachments_select_visible
  ON public.quotations_attachments FOR SELECT TO anon, authenticated
  USING (
    public.is_support_user()
    OR EXISTS (
      SELECT 1 FROM public.quotations_db q
      WHERE q.quote_id = quotations_attachments.quotation_id
        AND (
          (q.quote_status)::text = 'in_progress'
          OR q.client_user_id = auth.uid()
          OR q.artist_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS attachments_support_update ON public.quotations_attachments;
CREATE POLICY attachments_support_update
  ON public.quotations_attachments FOR UPDATE TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());

DROP POLICY IF EXISTS attachments_support_delete ON public.quotations_attachments;
CREATE POLICY attachments_support_delete
  ON public.quotations_attachments FOR DELETE TO authenticated
  USING (public.is_support_user());

-- quotation_flow_config: lectura publica (config-manager.js), escritura soporte
DROP POLICY IF EXISTS flow_config_public_read ON public.quotation_flow_config;
CREATE POLICY flow_config_public_read
  ON public.quotation_flow_config FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS flow_config_support_write ON public.quotation_flow_config;
CREATE POLICY flow_config_support_write
  ON public.quotation_flow_config FOR ALL TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());

-- body_parts: el catalogo era escribible por cualquiera; ahora solo soporte
DROP POLICY IF EXISTS "Public write access" ON public.body_parts;
DROP POLICY IF EXISTS body_parts_support_write ON public.body_parts;
CREATE POLICY body_parts_support_write
  ON public.body_parts FOR ALL TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());
-- "Public read access" (SELECT using true) se conserva.

-- ============================================================
-- 3) Habilitar RLS
-- ============================================================
ALTER TABLE public.quotations_db          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_flow_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_parts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients_db             ENABLE ROW LEVEL SECURITY;
-- Tablas del chatbot legacy sin uso en el codigo: sin politicas = solo service role
ALTER TABLE public.conversation_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_images         ENABLE ROW LEVEL SECURITY;
