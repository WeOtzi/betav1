const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260609000000_verified_reviews.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

test('verified reviews are tied to completed review contexts', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.verified_reviews/);
    assert.match(migration, /CHECK \(context_type IN \('quotation', 'studio_job', 'studio_membership', 'studio_spot_application'\)\)/);
    assert.match(migration, /verified_reviews_one_context/);
    assert.match(migration, /Reviews require a completed quotation without open disputes/);
    assert.match(migration, /q\.quote_status <> 'completed'/);
    assert.match(migration, /COALESCE\(q\.dispute_status, 'none'\) <> 'none'/);
});

test('verified reviews default to support moderation before public read', () => {
    assert.match(migration, /moderation_status TEXT NOT NULL DEFAULT 'pending'/);
    assert.match(migration, /ALTER TABLE public\.verified_reviews ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /verified_reviews_public_read_approved/);
    assert.match(migration, /TO anon, authenticated/);
    assert.match(migration, /USING \(moderation_status = 'approved' AND is_public = true\)/);
    assert.match(migration, /verified_reviews_support_update_all/);
});

test('verified reviews enforce rating bounds and duplicate prevention', () => {
    assert.match(migration, /rating SMALLINT NOT NULL CHECK \(rating BETWEEN 1 AND 5\)/);
    assert.match(migration, /idx_verified_reviews_unique_context_pair/);
    assert.match(migration, /reviewer_type, reviewer_user_id, reviewee_type, reviewee_user_id/);
});

test('client public profile fields are available without exposing private fields', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS public_username TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS country TEXT/);
    assert.match(migration, /public_profile_enabled BOOLEAN NOT NULL DEFAULT true/);
    assert.match(migration, /CREATE OR REPLACE VIEW public\.client_public_profiles/);
    assert.doesNotMatch(
        migration.match(/CREATE OR REPLACE VIEW public\.client_public_profiles[\s\S]*?\$view\$/)?.[0] || '',
        /email|whatsapp|birth_date|health_conditions|allergies/,
        'public client profile view must not expose private contact or health fields'
    );
});

test('public review aggregate views use invoker security', () => {
    assert.match(migration, /CREATE OR REPLACE VIEW public\.public_review_summary\s+WITH \(security_invoker = on\)/);
    assert.match(migration, /CREATE OR REPLACE VIEW public\.public_review_tag_counts\s+WITH \(security_invoker = on\)/);
});

test('reviewee responses are pending moderation and support studio owners', () => {
    assert.match(migration, /verified_reviews_author_response_pending/);
    assert.match(migration, /response_status IN \('pending', 'approved', 'hidden'\)/);
    assert.match(migration, /s\.id = verified_reviews\.reviewee_user_id/);
    assert.match(migration, /s\.user_id = \(SELECT auth\.uid\(\)\)/);
});
