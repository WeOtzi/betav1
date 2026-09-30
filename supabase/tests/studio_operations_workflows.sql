-- Run after the migration as postgres. Existing identities are only read;
-- all operational rows and every temporary state change are rolled back.
BEGIN;
DO $$
DECLARE owner_id uuid := gen_random_uuid(); artist_id uuid := gen_random_uuid(); sid uuid; mid uuid; foreign_sid uuid;
BEGIN
  INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES(owner_id, 'authenticated', 'authenticated', 'qa-ops-owner-' || owner_id || '@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
        (artist_id, 'authenticated', 'authenticated', 'qa-ops-artist-' || artist_id || '@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  INSERT INTO public.studios(user_id, name, normalized_name, slug) VALUES(owner_id, 'QA ROLLBACK studio', 'qa-' || owner_id, 'qa-' || owner_id) RETURNING id INTO sid;
  INSERT INTO public.artists_db(user_id, name) VALUES(artist_id, 'QA ROLLBACK artist') ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO public.studio_artist_memberships(studio_id, artist_user_id, status, role) VALUES(sid, artist_id, 'active', 'resident') RETURNING id INTO mid;
  INSERT INTO public.studios(user_id, name, normalized_name, slug) VALUES(artist_id, 'QA ROLLBACK foreign studio', 'qa-foreign-' || artist_id, 'qa-foreign-' || artist_id) RETURNING id INTO foreign_sid;
  INSERT INTO public.studio_jobs_log(studio_id, artist_user_id, performed_at, gross_amount) VALUES(foreign_sid, artist_id, now(), 999);
  INSERT INTO public.studio_inventory_items(studio_id, name, quantity_on_hand, cost_per_unit) VALUES(foreign_sid, 'QA ROLLBACK foreign inventory', 999, 5);
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('test.studio_id', sid::text, true);
  PERFORM set_config('test.artist_id', artist_id::text, true);
  PERFORM set_config('test.membership_id', mid::text, true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  sid uuid := current_setting('test.studio_id')::uuid;
  aid uuid := current_setting('test.artist_id')::uuid;
  iid uuid; second_item uuid; booking public.studio_bookings; invoice public.studio_invoices;
  header jsonb; before_total numeric; job_id uuid; denied boolean; foreign_sid uuid; view_name text; own_count integer; foreign_count integer;
BEGIN
  header := jsonb_build_object('studio_id', sid, 'invoice_number', 'QA-ROLLBACK-' || gen_random_uuid(), 'currency', 'ARS', 'tax_amount', 10, 'issue_date', current_date);
  invoice := public.save_studio_invoice(NULL, header, '[{"description":"Session","quantity":2,"unit_price":100}]'::jsonb);
  IF invoice.total_amount <> 210 THEN RAISE EXCEPTION 'Invoice total mismatch: %', invoice.total_amount; END IF;
  before_total := invoice.total_amount;
  denied := false;
  BEGIN
    PERFORM public.save_studio_invoice(invoice.id, header || '{"tax_amount":999}'::jsonb, '[{"description":"Broken","quantity":-1,"unit_price":100}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Invalid invoice accepted'; END IF;
  IF (SELECT total_amount FROM public.studio_invoices WHERE id = invoice.id) <> before_total OR (SELECT count(*) FROM public.studio_invoice_items WHERE invoice_id = invoice.id) <> 1 THEN RAISE EXCEPTION 'Atomic invoice rollback failed'; END IF;

  INSERT INTO public.studio_inventory_items(studio_id, name, quantity_on_hand) VALUES(sid, 'QA ROLLBACK stock', 5) RETURNING id INTO iid;
  INSERT INTO public.studio_inventory_items(studio_id, name) VALUES(sid, 'QA ROLLBACK second no SKU') RETURNING id INTO second_item;
  INSERT INTO public.studio_inventory_movements(studio_id,item_id,kind,quantity) VALUES(sid,iid,'consumption',2);
  IF (SELECT quantity_on_hand FROM public.studio_inventory_items WHERE id = iid) <> 3 THEN RAISE EXCEPTION 'Consumption did not update stock'; END IF;
  denied := false;
  BEGIN INSERT INTO public.studio_inventory_movements(studio_id,item_id,kind,quantity) VALUES(sid,iid,'consumption',99); EXCEPTION WHEN check_violation THEN denied := true; END;
  IF NOT denied OR (SELECT quantity_on_hand FROM public.studio_inventory_items WHERE id = iid) <> 3 THEN RAISE EXCEPTION 'Negative stock was not rolled back'; END IF;
  denied := false;
  BEGIN UPDATE public.studio_inventory_movements SET quantity = 100 WHERE item_id = iid; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Movement history can be rewritten'; END IF;

  INSERT INTO public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, amount, currency)
  VALUES(sid, aid, 'QA ROLLBACK booking', now() - interval '5000 days', now() - interval '5000 days' + interval '1 hour', 250, 'ARS') RETURNING * INTO booking;
  denied := false;
  BEGIN INSERT INTO public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at) VALUES(sid,aid,'QA overlap',booking.starts_at,booking.ends_at); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Overlapping booking accepted'; END IF;
  booking := public.complete_studio_booking(booking.id);
  job_id := booking.job_log_id;
  IF booking.status <> 'completed' OR job_id IS NULL OR (SELECT gross_amount FROM public.studio_jobs_log WHERE id = job_id) <> 250 THEN RAISE EXCEPTION 'Booking completion lost job or amount'; END IF;
  booking := public.complete_studio_booking(booking.id);
  IF booking.job_log_id <> job_id THEN RAISE EXCEPTION 'Booking completion is not idempotent'; END IF;
  denied := false;
  BEGIN UPDATE public.studio_bookings SET amount = 1 WHERE id = booking.id; EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Completed booking was edited'; END IF;

  INSERT INTO public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
  VALUES(sid, aid, 'QA departed member', now() + interval '5000 days', now() + interval '5000 days' + interval '1 hour') RETURNING * INTO booking;
  UPDATE public.studio_artist_memberships SET status = 'paused' WHERE id = current_setting('test.membership_id')::uuid;
  UPDATE public.studio_bookings SET status = 'cancelled' WHERE id = booking.id;
  IF (SELECT status FROM public.studio_bookings WHERE id = booking.id) <> 'cancelled' THEN RAISE EXCEPTION 'Cannot cancel booking after artist leaves'; END IF;

  SELECT id INTO foreign_sid FROM public.studios WHERE id <> sid AND user_id IS DISTINCT FROM auth.uid() LIMIT 1;
  IF foreign_sid IS NOT NULL THEN
    denied := false;
    BEGIN PERFORM public.save_studio_invoice(NULL, header || jsonb_build_object('studio_id', foreign_sid), '[{"description":"Forbidden","quantity":1,"unit_price":1}]'::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Invoice owner isolation failed'; END IF;
    IF EXISTS (SELECT 1 FROM public.studio_bookings WHERE studio_id = foreign_sid) THEN RAISE EXCEPTION 'Booking RLS leaked rows'; END IF;
  END IF;
  FOREACH view_name IN ARRAY ARRAY['studio_dashboard_metrics_view', 'studio_artist_performance_view', 'studio_inventory_health_view', 'studio_inventory_health_by_currency'] LOOP
    EXECUTE format('select count(*) from public.%I where studio_id = $1', view_name) INTO own_count USING sid;
    EXECUTE format('select count(*) from public.%I where studio_id <> $1', view_name) INTO foreign_count USING sid;
    IF own_count = 0 OR foreign_count <> 0 THEN RAISE EXCEPTION 'View % failed owner isolation (own %, foreign %)', view_name, own_count, foreign_count; END IF;
    IF has_table_privilege('anon', 'public.' || view_name, 'SELECT') THEN RAISE EXCEPTION 'View % grants anonymous SELECT', view_name; END IF;
  END LOOP;
END $$;
SELECT 'PASS: invoice transaction, inventory ledger, booking overlap/completion/history, owner RLS and four analytics views' AS result;
ROLLBACK;
