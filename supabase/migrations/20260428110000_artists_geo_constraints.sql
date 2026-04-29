-- Defense-in-depth: enforce coordinate ranges at the schema layer.
-- Backend validation in /api/artists/geocode is the primary guard, but
-- schema CHECK constraints protect against direct writes from admin panels,
-- n8n workflows or one-off psql sessions, matching the patterns used in
-- quotation_surveys (rating_stars BETWEEN 1 AND 5) and currencies
-- (units_per_usd > 0).

BEGIN;

ALTER TABLE public.artists_db
    ADD CONSTRAINT artists_db_latitude_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT artists_db_longitude_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

NOTIFY pgrst, 'reload schema';

COMMIT;
