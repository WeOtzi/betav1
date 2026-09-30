-- Run after the 20260921 studio identity migrations. All fixtures roll back.
BEGIN;
CREATE TEMP TABLE studio_identity_test_ids (owner_id uuid, other_id uuid, artist_id uuid, studio_id uuid, application_id uuid);
INSERT INTO studio_identity_test_ids VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), NULL, NULL);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, aud, role)
SELECT owner_id, 'studio-test-' || owner_id || '@example.test', now(), '{"user_type":"studio"}'::jsonb, 'authenticated', 'authenticated' FROM studio_identity_test_ids
UNION ALL
SELECT other_id, 'studio-test-' || other_id || '@example.test', now(), '{"user_type":"studio"}'::jsonb, 'authenticated', 'authenticated' FROM studio_identity_test_ids
UNION ALL
SELECT artist_id, 'artist-test-' || artist_id || '@example.test', now(), '{"user_type":"artist"}'::jsonb, 'authenticated', 'authenticated' FROM studio_identity_test_ids;
GRANT ALL ON studio_identity_test_ids TO authenticated;

SET LOCAL ROLE authenticated;
DO $$
DECLARE ids studio_identity_test_ids; first_studio public.studios; retried public.studios;
  second_location public.studio_locations; third_location public.studio_locations;
  first_primary uuid; n integer; caught boolean; v_spot_id uuid;
BEGIN
  SELECT * INTO ids FROM studio_identity_test_ids;
  PERFORM set_config('request.jwt.claim.sub', ids.owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  -- Atomic onboarding + primary mirror + idempotent retry.
  first_studio := public.complete_studio_registration(
    jsonb_build_object('name', 'QA studio ' || ids.owner_id, 'languages', jsonb_build_array('Español')),
    '[{"label":"Principal","formatted_address":"Calle 123","city":"Buenos Aires","country":"Argentina","is_primary":true}]');
  ASSERT first_studio.user_id = ids.owner_id, 'ownership mismatch';
  ASSERT first_studio.profile_complete AND first_studio.primary_location_id IS NOT NULL, 'incomplete registration';
  first_primary := first_studio.primary_location_id;
  retried := public.complete_studio_registration('{"name":"Ignored retry"}', '[{"formatted_address":"Ignored"}]');
  ASSERT retried.id = first_studio.id, 'retry duplicated studio';
  ASSERT (SELECT count(*) FROM public.studio_locations WHERE studio_id = first_studio.id) = 1, 'retry duplicated locations';
  UPDATE studio_identity_test_ids SET studio_id = first_studio.id;

  second_location := public.save_studio_location(first_studio.id, NULL,
    '{"label":"Segunda","formatted_address":"Calle 456","city":"Rosario","country":"Argentina","is_primary":false}');
  ASSERT NOT second_location.is_primary, 'secondary location unexpectedly became primary';
  second_location := public.save_studio_location(first_studio.id, second_location.id,
    to_jsonb(second_location) || '{"is_primary":true}');
  ASSERT (SELECT primary_location_id FROM public.studios WHERE id = first_studio.id) = second_location.id, 'primary pointer mismatch';
  ASSERT (SELECT city FROM public.studios WHERE id = first_studio.id) = 'Rosario', 'legacy location not synchronized';
  ASSERT (SELECT count(*) FROM public.studio_locations WHERE studio_id = first_studio.id AND is_primary) = 1, 'multiple primary locations';

  caught := false;
  BEGIN
    PERFORM public.save_studio_location(first_studio.id, first_primary,
      '{"formatted_address":"Invalid","latitude":1000,"longitude":0,"is_primary":true}');
  EXCEPTION WHEN check_violation THEN caught := true; END;
  ASSERT caught, 'invalid geo accepted';
  ASSERT (SELECT primary_location_id FROM public.studios WHERE id = first_studio.id) = second_location.id, 'failed write lost primary pointer';
  ASSERT (SELECT is_primary FROM public.studio_locations WHERE id = second_location.id), 'failed write demoted primary';

  PERFORM public.remove_studio_location(first_studio.id, second_location.id);
  ASSERT (SELECT primary_location_id FROM public.studios WHERE id = first_studio.id) = first_primary, 'delete did not promote remaining location';
  caught := false;
  BEGIN PERFORM public.remove_studio_location(first_studio.id, first_primary);
  EXCEPTION WHEN raise_exception THEN caught := true; END;
  ASSERT caught, 'last active location removed';

  -- Cross-owner writes must fail even though studios are publicly readable.
  PERFORM set_config('request.jwt.claim.sub', ids.other_id::text, true);
  caught := false;
  BEGIN PERFORM public.save_studio_location(first_studio.id, NULL, '{"formatted_address":"Forbidden"}');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  ASSERT caught, 'cross-owner location write accepted';
  caught := false;
  BEGIN INSERT INTO public.studios(name, normalized_name, user_id) VALUES ('Forbidden', 'FORBIDDEN-' || gen_random_uuid(), ids.owner_id);
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  ASSERT caught, 'legacy unconditional studio policy still permits foreign ownership';
  INSERT INTO public.studios(name, normalized_name)
    VALUES ('QA unclaimed catalog', 'QA-CATALOG-' || ids.other_id);
  ASSERT EXISTS (SELECT 1 FROM public.studios WHERE normalized_name = 'QA-CATALOG-' || ids.other_id AND user_id IS NULL),
    'artist catalog contribution is blocked';

  -- A failing second location rolls the complete studio registration back.
  caught := false;
  BEGIN
    PERFORM public.complete_studio_registration(jsonb_build_object('name','Rollback studio ' || ids.other_id),
      '[{"formatted_address":"Valid"},{"formatted_address":""}]');
  EXCEPTION WHEN raise_exception THEN caught := true; END;
  ASSERT caught, 'invalid onboarding accepted';
  ASSERT NOT EXISTS (SELECT 1 FROM public.studios WHERE user_id = ids.other_id), 'failed onboarding left orphan studio';

  PERFORM set_config('request.jwt.claim.sub', ids.owner_id::text, true);
  INSERT INTO public.studio_spots(studio_id, location_id, title, kind, status, revenue_split_pct)
    VALUES(first_studio.id, first_primary, 'QA spot', 'resident', 'open', 65) RETURNING id INTO v_spot_id;
  PERFORM set_config('request.jwt.claim.sub', ids.artist_id::text, true);
  INSERT INTO public.studio_spot_applications(spot_id, artist_user_id)
    VALUES(v_spot_id, ids.artist_id) RETURNING id INTO ids.application_id;
  UPDATE studio_identity_test_ids SET application_id = ids.application_id;
  caught := false;
  BEGIN PERFORM public.decide_studio_spot_application(ids.application_id, 'accepted');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  ASSERT caught, 'artist can accept own application';

  PERFORM set_config('request.jwt.claim.sub', ids.owner_id::text, true);
  PERFORM public.decide_studio_spot_application(ids.application_id, 'accepted');
  PERFORM public.decide_studio_spot_application(ids.application_id, 'accepted');
  ASSERT (SELECT count(*) FROM public.studio_artist_memberships WHERE studio_id = first_studio.id AND artist_user_id = ids.artist_id AND status='active') = 1,
    'accept retry duplicated roster';
  ASSERT (SELECT studio_id FROM public.artists_db WHERE user_id = ids.artist_id) = first_studio.id, 'artist primary studio not synchronized';
  ASSERT (SELECT revenue_split_pct FROM public.studio_artist_memberships WHERE studio_id = first_studio.id AND artist_user_id = ids.artist_id AND status='active') = 65,
    'spot terms not copied to membership';
  caught := false;
  BEGIN PERFORM public.decide_studio_spot_application(ids.application_id, 'rejected');
  EXCEPTION WHEN raise_exception THEN caught := true; END;
  ASSERT caught, 'terminal application decision changed';
END; $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: onboarding, idempotency, RLS, primary rollback, deletion, spot acceptance and artist projection; fixtures rolled back' AS result;
