-- Final studio support objects: storage buckets/policies, public sponsor view,
-- analytics views, inventory health view, and inventory movement integrity.

BEGIN;

-- ============================================================
-- Storage helper and buckets
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_manage_studio_storage_path(object_bucket_id text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND object_bucket_id IN ('studio-photos', 'studio-documents', 'studio-spot-attachments')
    AND split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (
      SELECT 1
      FROM public.studios s
      WHERE s.id = split_part(object_name, '/', 1)::uuid
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.support_users_db su
            WHERE su.user_id = auth.uid() AND su.is_active = true
          )
        )
    );
$function$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('studio-photos', 'studio-photos', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']),
  ('studio-spot-attachments', 'studio-spot-attachments', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']),
  ('studio-documents', 'studio-documents', false, 20971520, ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "studio_photos_public_read" ON storage.objects;
CREATE POLICY "studio_photos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'studio-photos');

DROP POLICY IF EXISTS "studio_spot_attachments_public_read" ON storage.objects;
CREATE POLICY "studio_spot_attachments_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'studio-spot-attachments');

DROP POLICY IF EXISTS "studio_documents_owner_read" ON storage.objects;
CREATE POLICY "studio_documents_owner_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'studio-documents' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_photos_owner_insert" ON storage.objects;
CREATE POLICY "studio_photos_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'studio-photos' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_photos_owner_update" ON storage.objects;
CREATE POLICY "studio_photos_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'studio-photos' AND public.can_manage_studio_storage_path(bucket_id, name))
  WITH CHECK (bucket_id = 'studio-photos' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_photos_owner_delete" ON storage.objects;
CREATE POLICY "studio_photos_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'studio-photos' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_spot_attachments_owner_insert" ON storage.objects;
CREATE POLICY "studio_spot_attachments_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'studio-spot-attachments' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_spot_attachments_owner_update" ON storage.objects;
CREATE POLICY "studio_spot_attachments_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'studio-spot-attachments' AND public.can_manage_studio_storage_path(bucket_id, name))
  WITH CHECK (bucket_id = 'studio-spot-attachments' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_spot_attachments_owner_delete" ON storage.objects;
CREATE POLICY "studio_spot_attachments_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'studio-spot-attachments' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_documents_owner_insert" ON storage.objects;
CREATE POLICY "studio_documents_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'studio-documents' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_documents_owner_update" ON storage.objects;
CREATE POLICY "studio_documents_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'studio-documents' AND public.can_manage_studio_storage_path(bucket_id, name))
  WITH CHECK (bucket_id = 'studio-documents' AND public.can_manage_studio_storage_path(bucket_id, name));

DROP POLICY IF EXISTS "studio_documents_owner_delete" ON storage.objects;
CREATE POLICY "studio_documents_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'studio-documents' AND public.can_manage_studio_storage_path(bucket_id, name));

-- ============================================================
-- Public limited sponsor surface
-- ============================================================
DROP POLICY IF EXISTS "sponsors_public_select" ON public.studio_sponsors;

CREATE OR REPLACE VIEW public.studio_public_sponsors_view AS
SELECT
  id,
  studio_id,
  name,
  tier,
  logo_url,
  website,
  ends_on
FROM public.studio_sponsors
WHERE is_public = true;

GRANT SELECT ON public.studio_public_sponsors_view TO anon, authenticated;

-- ============================================================
-- Analytics views
-- ============================================================
CREATE OR REPLACE VIEW public.studio_dashboard_metrics_view
WITH (security_invoker = true) AS
SELECT
  studio_id,
  date_trunc('month', performed_at)::date AS month,
  COUNT(*) FILTER (WHERE status = 'completed')::integer AS jobs_count,
  COUNT(DISTINCT COALESCE(client_user_id::text, lower(client_email), lower(client_display_name)))::integer AS unique_clients,
  COALESCE(SUM(gross_amount) FILTER (WHERE status = 'completed'), 0)::numeric(12,2) AS gross_amount,
  COALESCE(SUM(COALESCE(studio_split_amount, gross_amount - COALESCE(artist_split_amount, 0) - COALESCE(supplies_cost, 0))) FILTER (WHERE status = 'completed'), 0)::numeric(12,2) AS studio_net,
  COALESCE(SUM(COALESCE(artist_split_amount, 0)) FILTER (WHERE status = 'completed'), 0)::numeric(12,2) AS paid_to_artists,
  COALESCE(AVG(gross_amount) FILTER (WHERE status = 'completed'), 0)::numeric(12,2) AS avg_ticket
FROM public.studio_jobs_log
GROUP BY studio_id, date_trunc('month', performed_at)::date;

CREATE OR REPLACE VIEW public.studio_artist_performance_view
WITH (security_invoker = true) AS
SELECT
  j.studio_id,
  j.artist_user_id,
  a.name,
  a.username,
  COALESCE(m.role, 'artist') AS role,
  COUNT(*) FILTER (WHERE j.status = 'completed')::integer AS jobs_count,
  COALESCE(SUM(j.gross_amount) FILTER (WHERE j.status = 'completed'), 0)::numeric(12,2) AS gross_billed,
  COALESCE(AVG(j.gross_amount) FILTER (WHERE j.status = 'completed'), 0)::numeric(12,2) AS avg_ticket,
  COALESCE(SUM(COALESCE(j.supplies_cost, 0)) FILTER (WHERE j.status = 'completed'), 0)::numeric(12,2) AS supplies_consumed_cost,
  EXTRACT(day FROM (timezone('utc', now()) - MAX(j.performed_at)))::integer AS days_since_last_job
FROM public.studio_jobs_log j
JOIN public.artists_db a ON a.user_id = j.artist_user_id
LEFT JOIN public.studio_artist_memberships m
  ON m.studio_id = j.studio_id
 AND m.artist_user_id = j.artist_user_id
 AND m.status IN ('active', 'paused')
GROUP BY j.studio_id, j.artist_user_id, a.name, a.username, COALESCE(m.role, 'artist');

CREATE OR REPLACE VIEW public.studio_inventory_health_view
WITH (security_invoker = true) AS
SELECT
  i.id,
  i.studio_id,
  i.supplier_id,
  i.name,
  i.sku,
  i.category,
  i.unit,
  i.quantity_on_hand,
  i.reorder_level,
  i.cost_per_unit,
  i.currency,
  (i.reorder_level IS NOT NULL AND i.quantity_on_hand <= i.reorder_level) AS needs_reorder,
  (COALESCE(i.quantity_on_hand, 0) * COALESCE(i.cost_per_unit, 0))::numeric(12,2) AS stock_value
FROM public.studio_inventory_items i
WHERE i.is_active = true;

GRANT SELECT ON public.studio_dashboard_metrics_view TO authenticated;
GRANT SELECT ON public.studio_artist_performance_view TO authenticated;
GRANT SELECT ON public.studio_inventory_health_view TO authenticated;

-- ============================================================
-- Inventory integrity: movement item must belong to same studio.
-- Enforced for new rows; NOT VALID avoids breaking existing beta data.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_items_id_studio
  ON public.studio_inventory_items (id, studio_id);

ALTER TABLE public.studio_inventory_movements
  DROP CONSTRAINT IF EXISTS studio_inventory_movements_item_studio_fk;

ALTER TABLE public.studio_inventory_movements
  ADD CONSTRAINT studio_inventory_movements_item_studio_fk
  FOREIGN KEY (item_id, studio_id)
  REFERENCES public.studio_inventory_items (id, studio_id)
  ON DELETE CASCADE
  NOT VALID;

NOTIFY pgrst, 'reload schema';

COMMIT;
