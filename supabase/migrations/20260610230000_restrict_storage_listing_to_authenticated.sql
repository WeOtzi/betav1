-- Hardening: bloquea la enumeracion anonima de archivos en los 6 buckets
-- publicos (advisor "public_bucket_allows_listing"). Las descargas via URL
-- publica (/storage/v1/object/public/...) NO pasan por RLS y siguen
-- funcionando; el SELECT sobre storage.objects solo gobierna list() y los
-- RETURNING de remove(). El frontend solo usa getPublicUrl + remove()
-- autenticado (artist-gallery en dashboard.js), asi que restringir SELECT a
-- usuarios autenticados no rompe ningun flujo.

DROP POLICY IF EXISTS "Anyone can view job board references" ON storage.objects;
CREATE POLICY "Authenticated can view job board references"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-board-references');

DROP POLICY IF EXISTS "Public Access for quotation-references" ON storage.objects;
CREATE POLICY "Authenticated can view quotation references"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quotation-references');

DROP POLICY IF EXISTS "Public can view profile pictures" ON storage.objects;
CREATE POLICY "Authenticated can view profile pictures"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-pictures');

DROP POLICY IF EXISTS artist_gallery_public_read ON storage.objects;
CREATE POLICY artist_gallery_authenticated_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'artist-gallery');

DROP POLICY IF EXISTS studio_photos_public_read ON storage.objects;
CREATE POLICY studio_photos_authenticated_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'studio-photos');

DROP POLICY IF EXISTS studio_spot_atts_public_read ON storage.objects;
CREATE POLICY studio_spot_atts_authenticated_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'studio-spot-attachments');
