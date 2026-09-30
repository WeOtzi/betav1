-- A studio decision and its roster membership must commit together.
BEGIN;
-- Only the membership trigger can update this legacy projection. Studio users
-- cannot update other users' artist rows under the artist table's RLS.
CREATE OR REPLACE FUNCTION private.sync_artist_primary_studio_from_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_artist_id uuid;
BEGIN
  v_artist_id := coalesce(NEW.artist_user_id, OLD.artist_user_id);
  UPDATE public.artists_db SET studio_id = (
    SELECT studio_id FROM public.studio_artist_memberships
    WHERE artist_user_id = v_artist_id AND status = 'active' AND role = 'resident'
    ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1
  ) WHERE user_id = v_artist_id;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION private.sync_artist_primary_studio_from_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trigger_sync_artists_studio_id ON public.studio_artist_memberships;
CREATE TRIGGER trigger_sync_artists_studio_id AFTER INSERT OR UPDATE OR DELETE
ON public.studio_artist_memberships FOR EACH ROW
EXECUTE FUNCTION private.sync_artist_primary_studio_from_membership();

CREATE OR REPLACE FUNCTION public.decide_studio_spot_application(p_application_id uuid, p_status text)
RETURNS public.studio_spot_applications
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_application public.studio_spot_applications; v_spot public.studio_spots; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Iniciá sesión.' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'Decisión inválida.'; END IF;
  SELECT * INTO v_application FROM public.studio_spot_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;
  SELECT * INTO v_spot FROM public.studio_spots WHERE id = v_application.spot_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.studios WHERE id = v_spot.studio_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para decidir esta postulación.' USING ERRCODE = '42501';
  END IF;
  IF v_application.status = p_status THEN RETURN v_application; END IF;
  IF v_application.status NOT IN ('pending', 'viewed', 'shortlisted') THEN
    RAISE EXCEPTION 'Esta postulación ya fue resuelta o retirada.';
  END IF;
  IF p_status = 'accepted' THEN
    IF v_spot.status NOT IN ('open', 'filled') THEN RAISE EXCEPTION 'Abrí el spot antes de aceptar postulaciones.'; END IF;
    v_role := CASE v_spot.kind WHEN 'resident' THEN 'resident' WHEN 'itinerant' THEN 'itinerant' ELSE 'guest' END;
    INSERT INTO public.studio_artist_memberships (studio_id, artist_user_id, location_id, role, status, revenue_split_pct, started_at)
    VALUES (v_spot.studio_id, v_application.artist_user_id, v_spot.location_id, v_role, 'active', v_spot.revenue_split_pct, now())
    ON CONFLICT (studio_id, artist_user_id, role, status) DO NOTHING;
  END IF;
  UPDATE public.studio_spot_applications SET status = p_status, decided_at = now(), decided_by_user_id = auth.uid()
    WHERE id = p_application_id RETURNING * INTO v_application;
  RETURN v_application;
END; $$;
REVOKE ALL ON FUNCTION public.decide_studio_spot_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_studio_spot_application(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
