-- Revision del backlog menor de seguridad (2026-06-10/11):
-- politicas USING(true), vistas SECURITY DEFINER y funciones definer
-- ejecutables por anon. Decisiones tomadas con el usuario:
--   - chat de soporte: lectura restringida a soporte; el widget anonimo pasa de
--     Realtime a polling via /api/support-chat/poll (service role)
--   - funciones del chatbot legacy: revocadas para anon/authenticated (si n8n
--     las necesitara, debe usar la service key)
--   - feedback_tickets y sus tablas satelite: eliminadas (modulo borrado, 0 filas)
--
-- NOTA: las funciones dashboard_update_trigger_function / dashboard_manage_trigger
-- / dashboard_get_triggers se eliminaron de urgencia en la migracion previa
-- drop_dashboard_ddl_functions: la primera ejecutaba SQL arbitrario como
-- SECURITY DEFINER y era invocable por anon.

-- ============================================================
-- A) Modulo feedback muerto (0 filas, sin referencias en codigo)
-- ============================================================
DROP TABLE IF EXISTS public.ticket_comments;
DROP TABLE IF EXISTS public.ticket_assignments;
-- CASCADE: elimina el FK que support_conversations tenia hacia feedback_tickets
DROP TABLE IF EXISTS public.feedback_tickets CASCADE;

-- ============================================================
-- B) session_logs: telemetria con PII (email, telefono, IP, fingerprint)
--    era legible por cualquiera. Lectura solo soporte; inserts intactos.
-- ============================================================
DROP POLICY IF EXISTS "Allow public read" ON public.session_logs;
CREATE POLICY session_logs_support_read
  ON public.session_logs FOR SELECT TO authenticated
  USING (public.is_support_user());

-- Vistas de analytics construidas sobre session_logs: pasar a security_invoker
-- para que apliquen las politicas de la tabla base (el backoffice lee como
-- superadmin, que es support user).
ALTER VIEW public.analytics_devices SET (security_invoker = true);
ALTER VIEW public.analytics_user_sessions SET (security_invoker = true);

-- ============================================================
-- C) Vistas de estudio: SECURITY DEFINER sin filtro por dueno y legibles por
--    anon = metricas de negocio de todos los estudios expuestas. Se corta el
--    acceso anon; la conversion a security_invoker queda para cuando se
--    retome el area de estudios (requiere validar las politicas de cada
--    tabla subyacente).
-- ============================================================
REVOKE SELECT ON public.studio_dashboard_metrics_view FROM anon;
REVOKE SELECT ON public.studio_artist_performance_view FROM anon;
REVOKE SELECT ON public.studio_inventory_health_view FROM anon;

-- ============================================================
-- D) Catalogos y configuracion: escritura solo soporte/superadmin
--    (el backoffice corre como superadmin, presente en support_users_db)
-- ============================================================
DROP POLICY IF EXISTS "Public write access" ON public.tattoo_styles;
CREATE POLICY tattoo_styles_support_write
  ON public.tattoo_styles FOR ALL TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());

DROP POLICY IF EXISTS "Allow authenticated insert" ON public.app_settings;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.app_settings;
CREATE POLICY app_settings_support_write
  ON public.app_settings FOR ALL TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());
-- "Allow public read for public settings" (is_public = true) se conserva.

DROP POLICY IF EXISTS "Allow public insert" ON public.tools_site_config;
DROP POLICY IF EXISTS "Allow public update" ON public.tools_site_config;
CREATE POLICY tools_site_config_support_write
  ON public.tools_site_config FOR ALL TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());
-- "Allow public read" se conserva (la landing la lee sin login).

-- ============================================================
-- E) Historial y encuestas de cotizacion
-- ============================================================
-- Historial: visible solo para las partes de la cotizacion y soporte
DROP POLICY IF EXISTS "Allow public read on status history" ON public.quotation_status_history;
CREATE POLICY status_history_visible_parent
  ON public.quotation_status_history FOR SELECT TO authenticated
  USING (
    public.is_support_user()
    OR EXISTS (
      SELECT 1 FROM public.quotations_db q
      WHERE q.quote_id = quotation_status_history.quote_id
        AND (q.client_user_id = auth.uid() OR q.artist_id = auth.uid())
    )
  );
-- Los INSERT anon/authenticated se conservan (el wizard registra transiciones).

-- Encuestas: contienen email y comentarios; lectura solo soporte
DROP POLICY IF EXISTS "Allow public read on quotation_surveys" ON public.quotation_surveys;
CREATE POLICY quotation_surveys_support_read
  ON public.quotation_surveys FOR SELECT TO authenticated
  USING (public.is_support_user());
-- Los INSERT se conservan (encuesta post-cotizacion desde link de email).

-- ============================================================
-- F) Tablas internas de soporte/verificacion: fuera del alcance anon
-- ============================================================
DROP POLICY IF EXISTS "Allow anon read on verification_history" ON public.verification_history;
DROP POLICY IF EXISTS "Allow anon insert on verification_history" ON public.verification_history;
-- Las politicas authenticated de lectura/escritura se conservan.

DROP POLICY IF EXISTS "Allow anon read" ON public.service_health_logs;
-- anon insert (health checks del frontend) y lectura authenticated se conservan.

DROP POLICY IF EXISTS "Allow support user check" ON public.support_users_db;
CREATE POLICY support_users_self_or_support
  ON public.support_users_db FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_support_user());

-- ============================================================
-- G) Chat de soporte: los 289 chats eran legibles/escribibles por cualquiera.
--    Todo el trafico del widget pasa por el servidor (service role); el
--    dashboard de soporte lee directo como support user. El widget anonimo
--    recibe respuestas via GET /api/support-chat/poll (sustituye a Realtime).
-- ============================================================
DROP POLICY IF EXISTS "Allow public read on support conversations for support" ON public.support_conversations;
DROP POLICY IF EXISTS "Allow anon insert support conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Allow authenticated insert support conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Allow authenticated update support conversations" ON public.support_conversations;
CREATE POLICY support_conversations_support_read
  ON public.support_conversations FOR SELECT TO authenticated
  USING (public.is_support_user());
CREATE POLICY support_conversations_support_update
  ON public.support_conversations FOR UPDATE TO authenticated
  USING (public.is_support_user())
  WITH CHECK (public.is_support_user());

DROP POLICY IF EXISTS "Allow public read on support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Allow anon insert support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Allow authenticated insert support messages" ON public.support_messages;
CREATE POLICY support_messages_support_read
  ON public.support_messages FOR SELECT TO authenticated
  USING (public.is_support_user());

-- ============================================================
-- H) Funciones SECURITY DEFINER: recortar la superficie RPC publica.
--    Se conservan publicas: check_email_registered (registro) e
--    is_support_user (evaluacion de politicas).
-- ============================================================
-- Chatbot legacy (sin referencias en el codigo; n8n debe usar service key)
REVOKE EXECUTE ON FUNCTION public.upsert_web_chat_quotation(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_web_chat_quote_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_old_job_board_requests() FROM PUBLIC, anon, authenticated;
-- Funciones de trigger (no son invocables como RPC, pero se revoca por higiene)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_artist_to_auth() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_email_confirmed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_artist_on_auth_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_auth_on_artist_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_auth_user() FROM PUBLIC, anon, authenticated;
