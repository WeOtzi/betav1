BEGIN;

-- Save the header and its lines as one transaction. RLS applies to every write.
CREATE OR REPLACE FUNCTION public.save_studio_invoice(p_invoice_id uuid, p_header jsonb, p_items jsonb)
RETURNS public.studio_invoices LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE inv public.studio_invoices; line jsonb; position integer := 0; sid uuid := (p_header->>'studio_id')::uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.studios WHERE id = sid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a este estudio' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_header->>'invoice_number'), '') IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Indicá un número y al menos un concepto';
  END IF;
  IF coalesce((p_header->>'tax_amount')::numeric, 0) < 0 OR coalesce(p_header->>'currency', '') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Revisá el impuesto y la moneda';
  END IF;
  IF (p_header->>'due_date')::date < (p_header->>'issue_date')::date THEN RAISE EXCEPTION 'El vencimiento no puede ser anterior a la emisión'; END IF;
  IF p_invoice_id IS NULL THEN
    INSERT INTO public.studio_invoices (studio_id, invoice_number) VALUES (sid, btrim(p_header->>'invoice_number')) RETURNING * INTO inv;
  ELSE
    SELECT * INTO inv FROM public.studio_invoices WHERE id = p_invoice_id AND studio_id = sid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
    IF inv.status IN ('paid', 'void') THEN RAISE EXCEPTION 'Una factura pagada o anulada no se puede editar'; END IF;
  END IF;
  UPDATE public.studio_invoices SET invoice_number = btrim(p_header->>'invoice_number'),
    billed_to_name = nullif(btrim(p_header->>'billed_to_name'), ''), billed_to_email = nullif(btrim(p_header->>'billed_to_email'), ''),
    billed_to_tax_id = nullif(btrim(p_header->>'billed_to_tax_id'), ''), issue_date = (p_header->>'issue_date')::date,
    due_date = (p_header->>'due_date')::date, currency = p_header->>'currency', tax_amount = coalesce((p_header->>'tax_amount')::numeric, 0)
  WHERE id = inv.id;
  DELETE FROM public.studio_invoice_items WHERE invoice_id = inv.id;
  FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF nullif(btrim(line->>'description'), '') IS NULL OR coalesce((line->>'quantity')::numeric, 0) <= 0 OR coalesce((line->>'unit_price')::numeric, -1) < 0 THEN
      RAISE EXCEPTION 'Cada concepto necesita descripción, cantidad positiva y precio no negativo';
    END IF;
    INSERT INTO public.studio_invoice_items (invoice_id, description, quantity, unit_price, sort_order)
    VALUES (inv.id, btrim(line->>'description'), (line->>'quantity')::numeric, (line->>'unit_price')::numeric, position);
    position := position + 1;
  END LOOP;
  SELECT * INTO inv FROM public.studio_invoices WHERE id = inv.id;
  RETURN inv;
END; $$;
REVOKE ALL ON FUNCTION public.save_studio_invoice(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_studio_invoice(uuid, jsonb, jsonb) TO authenticated;

CREATE TABLE public.studio_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.studio_locations(id) ON DELETE SET NULL,
  artist_user_id uuid NOT NULL REFERENCES public.artists_db(user_id),
  client_name text NOT NULL CHECK (length(btrim(client_name)) > 0),
  client_email text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled')),
  notes text,
  job_log_id uuid UNIQUE REFERENCES public.studio_jobs_log(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_bookings_studio_start ON public.studio_bookings(studio_id, starts_at);
CREATE INDEX studio_bookings_artist_start ON public.studio_bookings(artist_user_id, starts_at) WHERE status = 'confirmed';
CREATE INDEX studio_bookings_location ON public.studio_bookings(location_id);
ALTER TABLE public.studio_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY studio_bookings_owner ON public.studio_bookings FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = (SELECT auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.studio_bookings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.studio_bookings TO authenticated;
REVOKE DELETE ON public.studio_bookings FROM authenticated;

CREATE OR REPLACE FUNCTION public.validate_studio_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE generated_job_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'La reserva ya está completada'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.studio_id <> OLD.studio_id THEN RAISE EXCEPTION 'No se puede transferir una reserva'; END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.studio_locations WHERE id = NEW.location_id AND studio_id = NEW.studio_id) THEN RAISE EXCEPTION 'Sede inválida'; END IF;
  IF (TG_OP = 'INSERT' OR NEW.artist_user_id IS DISTINCT FROM OLD.artist_user_id) AND NOT EXISTS (SELECT 1 FROM public.studio_artist_memberships WHERE studio_id = NEW.studio_id AND artist_user_id = NEW.artist_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'El artista debe estar activo en el roster';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.studio_id::text || NEW.artist_user_id::text, 0));
  IF NEW.status = 'confirmed' AND EXISTS (SELECT 1 FROM public.studio_bookings b WHERE b.studio_id = NEW.studio_id AND b.artist_user_id = NEW.artist_user_id AND b.id <> NEW.id AND b.status = 'confirmed' AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at) THEN
    RAISE EXCEPTION 'El artista ya tiene una reserva en ese horario';
  END IF;
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'confirmed' THEN RAISE EXCEPTION 'Primero confirmá la reserva'; END IF;
    IF NEW.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
    INSERT INTO public.studio_jobs_log (studio_id, location_id, artist_user_id, client_display_name, client_email, performed_at, duration_hours, gross_amount, gross_currency, notes)
    VALUES (NEW.studio_id, NEW.location_id, NEW.artist_user_id, NEW.client_name, NEW.client_email, NEW.starts_at, extract(epoch FROM (NEW.ends_at - NEW.starts_at))/3600, NEW.amount, NEW.currency, NEW.notes)
    RETURNING id INTO generated_job_id;
    NEW.job_log_id := generated_job_id;
  ELSIF NEW.job_log_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.job_log_id IS DISTINCT FROM OLD.job_log_id) THEN
    RAISE EXCEPTION 'El trabajo se registra al completar la reserva';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER studio_bookings_validate BEFORE INSERT OR UPDATE ON public.studio_bookings FOR EACH ROW EXECUTE FUNCTION public.validate_studio_booking();
REVOKE ALL ON FUNCTION public.validate_studio_booking() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_studio_booking(p_booking_id uuid) RETURNS public.studio_bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE booking public.studio_bookings;
BEGIN
  SELECT * INTO booking FROM public.studio_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada'; END IF;
  IF booking.status = 'completed' THEN RETURN booking; END IF;
  IF booking.status <> 'confirmed' THEN RAISE EXCEPTION 'La reserva está cancelada'; END IF;
  IF booking.starts_at > now() THEN RAISE EXCEPTION 'La reserva todavía no comenzó'; END IF;
  UPDATE public.studio_bookings SET status = 'completed' WHERE id = booking.id RETURNING * INTO booking;
  RETURN booking;
END; $$;
REVOKE ALL ON FUNCTION public.complete_studio_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_studio_booking(uuid) TO authenticated;

-- Optional SKUs must permit multiple unnumbered items. Existing non-null values stay unique.
ALTER TABLE public.studio_inventory_items DROP CONSTRAINT IF EXISTS studio_inventory_items_unique_sku;
CREATE UNIQUE INDEX IF NOT EXISTS studio_inventory_items_sku_unique ON public.studio_inventory_items(studio_id, sku) WHERE sku IS NOT NULL;
ALTER TABLE public.studio_inventory_items ADD CONSTRAINT studio_inventory_stock_nonnegative CHECK (quantity_on_hand >= 0) NOT VALID;
ALTER TABLE public.studio_inventory_movements ADD CONSTRAINT studio_inventory_movement_quantity CHECK (quantity <> 0 AND (kind = 'adjustment' OR quantity > 0)) NOT VALID;
-- Movement edits previously bypassed stock recalculation; corrections are new adjustment entries.
REVOKE UPDATE, DELETE ON public.studio_inventory_movements FROM authenticated;

CREATE OR REPLACE FUNCTION public.replace_studio_sponsor_artists(p_sponsor_id uuid, p_artist_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE sid uuid;
BEGIN
  SELECT studio_id INTO sid FROM public.studio_sponsors WHERE id = p_sponsor_id FOR UPDATE;
  IF sid IS NULL THEN RAISE EXCEPTION 'Sponsor no encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_artist_ids) artist_id WHERE NOT EXISTS (SELECT 1 FROM public.studio_artist_memberships m WHERE m.studio_id = sid AND m.artist_user_id = artist_id AND m.status = 'active')) THEN RAISE EXCEPTION 'Solo podés asignar artistas activos del roster'; END IF;
  DELETE FROM public.studio_sponsor_artists WHERE sponsor_id = p_sponsor_id;
  INSERT INTO public.studio_sponsor_artists(sponsor_id, artist_user_id) SELECT p_sponsor_id, artist_id FROM (SELECT DISTINCT unnest(p_artist_ids) artist_id) artists;
END; $$;
REVOKE ALL ON FUNCTION public.replace_studio_sponsor_artists(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_studio_sponsor_artists(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_studio_document_attachment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE sid uuid; valid_target boolean := false;
BEGIN
  SELECT studio_id INTO sid FROM public.studio_documents WHERE id = NEW.document_id;
  CASE NEW.attached_to_kind
    WHEN 'invoice' THEN SELECT EXISTS (SELECT 1 FROM public.studio_invoices WHERE id = NEW.attached_to_id AND studio_id = sid) INTO valid_target;
    WHEN 'membership' THEN SELECT EXISTS (SELECT 1 FROM public.studio_artist_memberships WHERE id = NEW.attached_to_id AND studio_id = sid) INTO valid_target;
    WHEN 'job_log' THEN SELECT EXISTS (SELECT 1 FROM public.studio_jobs_log WHERE id = NEW.attached_to_id AND studio_id = sid) INTO valid_target;
    WHEN 'spot_application' THEN SELECT EXISTS (SELECT 1 FROM public.studio_spot_applications a JOIN public.studio_spots s ON s.id = a.spot_id WHERE a.id = NEW.attached_to_id AND s.studio_id = sid) INTO valid_target;
    WHEN 'quotation' THEN SELECT EXISTS (SELECT 1 FROM public.studio_jobs_log WHERE quotation_id::text = NEW.attached_to_id::text AND studio_id = sid) INTO valid_target;
    ELSE valid_target := false;
  END CASE;
  IF NOT valid_target THEN RAISE EXCEPTION 'El registro debe pertenecer al mismo estudio'; END IF;
  IF NEW.signed_at IS NOT NULL AND (nullif(btrim(NEW.signer_name), '') IS NULL OR NEW.signed_at > now()) THEN RAISE EXCEPTION 'Revisá el nombre y la fecha de la firma recibida'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER studio_document_attachment_validate BEFORE INSERT OR UPDATE ON public.studio_document_attachments FOR EACH ROW EXECUTE FUNCTION public.validate_studio_document_attachment();
REVOKE ALL ON FUNCTION public.validate_studio_document_attachment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.studio_monthly_metrics_by_currency WITH (security_invoker = true) AS
SELECT studio_id, date_trunc('month', performed_at)::date AS month, upper(gross_currency) AS currency,
count(*)::integer jobs_count, count(DISTINCT coalesce(client_user_id::text, lower(client_email), lower(client_display_name)))::integer unique_clients,
sum(gross_amount) gross_amount, sum(coalesce(studio_split_amount, gross_amount - coalesce(artist_split_amount, 0) - coalesce(supplies_cost, 0))) studio_net,
sum(coalesce(artist_split_amount, 0)) paid_to_artists, avg(gross_amount) avg_ticket
FROM public.studio_jobs_log WHERE status = 'completed' GROUP BY studio_id, date_trunc('month', performed_at)::date, upper(gross_currency);
CREATE OR REPLACE VIEW public.studio_artist_metrics_by_currency WITH (security_invoker = true) AS
SELECT j.studio_id, j.artist_user_id, a.name, a.username, upper(j.gross_currency) currency,
count(*)::integer jobs_count, sum(j.gross_amount) gross_billed, avg(j.gross_amount) avg_ticket, sum(coalesce(j.supplies_cost, 0)) supplies_consumed_cost,
extract(day FROM now() - max(j.performed_at))::integer days_since_last_job
FROM public.studio_jobs_log j JOIN public.artists_db a ON a.user_id = j.artist_user_id
WHERE j.status = 'completed' AND j.performed_at >= date_trunc('month', now()) - interval '11 months'
GROUP BY j.studio_id, j.artist_user_id, a.name, a.username, upper(j.gross_currency);
GRANT SELECT ON public.studio_monthly_metrics_by_currency, public.studio_artist_metrics_by_currency TO authenticated;

-- Only the owning studio receives the minimal trip projection, including resolved requests.
CREATE OR REPLACE FUNCTION private.list_studio_travel_links(p_studio_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.studios WHERE id = p_studio_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a este estudio' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'requested_at', l.requested_at,
    'artist_trips', jsonb_build_object('id', t.id, 'artist_user_id', t.artist_user_id, 'city', t.city, 'country', t.country, 'start_date', t.start_date, 'end_date', t.end_date, 'trip_type', t.trip_type, 'status', t.status))
    ORDER BY l.requested_at DESC) FROM public.trip_studio_links l JOIN public.artist_trips t ON t.id = l.trip_id WHERE l.studio_id = p_studio_id), '[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.list_studio_travel_links(p_studio_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT private.list_studio_travel_links(p_studio_id); $$;
REVOKE ALL ON FUNCTION private.list_studio_travel_links(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_studio_travel_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_studio_travel_links(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
