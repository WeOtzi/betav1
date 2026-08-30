const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripSqlComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '');
const readSql = (file) => stripSqlComments(read(file));

function sqlFunction(source, name) {
    const startNeedle = `create or replace function public.${name}(`;
    const start = source.toLowerCase().indexOf(startNeedle);
    assert.notEqual(start, -1, `missing SQL function ${name}`);
    const bodyEnd = source.indexOf('$$;', start);
    assert.notEqual(bodyEnd, -1, `unterminated SQL function ${name}`);
    return source.slice(start, bodyEnd + 3);
}

test('Spots keep featured and editorial placement in persistent columns', () => {
    const featured = readSql('supabase/migrations/20260829060811_add_studio_spot_featured_fields.sql');
    const directory = readSql('supabase/migrations/20260829062349_studio_spot_directory_rank.sql');
    const seed = readSql('supabase/seeds/20260829_opportunities_figma_demo.sql');

    assert.match(featured, /add column if not exists is_featured boolean not null default false/i);
    assert.match(featured, /add column if not exists featured_rank smallint/i);
    assert.match(directory, /add column if not exists directory_rank smallint/i);
    assert.match(seed, /is_featured,featured_rank,directory_rank/);
    assert.match(seed, /true,1,1,array\[/);
    assert.match(seed, /true,2,6,array\[/);
});

test('sponsored placement cannot be self-assigned by opportunity owners', () => {
    const migration = readSql('supabase/migrations/20260829064000_protect_curated_opportunity_fields.sql');

    assert.match(migration, /create trigger studio_spots_protect_curated_fields[\s\S]*before insert or update on public\.studio_spots/i);
    assert.match(migration, /Featured Spot placement is managed by We Otzi support/);
    assert.match(migration, /create trigger job_board_requests_protect_curated_fields[\s\S]*before insert or update on public\.job_board_requests/i);
    assert.match(migration, /Sponsored Job Board placement is managed by We Otzi support/);
    assert.match(migration, /revoke all on function public\.enforce_studio_spot_curated_fields\(\) from public, anon, authenticated/i);
    assert.match(migration, /revoke all on function public\.enforce_job_request_curated_fields\(\) from public, anon, authenticated/i);
});

test('Job Board public codes and feed ranks are persistent protected fields', () => {
    const migration = readSql('supabase/migrations/20260829070500_add_job_board_feed_ranking.sql');
    const guard = sqlFunction(migration, 'enforce_job_request_curated_fields');

    assert.match(migration, /add column if not exists display_code text/i);
    assert.match(migration, /add column if not exists feed_rank smallint/i);
    assert.match(migration, /check \(display_code is null or display_code ~ '\^JB-\[0-9\]\{5\}\$'\)/i);
    assert.match(migration, /check \(feed_rank is null or feed_rank > 0\)/i);
    assert.match(
        migration,
        /create unique index if not exists idx_job_board_open_public_feed_rank[\s\S]*where status = 'open' and is_public = true and is_featured = false[\s\S]*feed_rank is not null/i
    );
    assert.match(guard, /nullif\(btrim\(new\.display_code\), ''\) is not null/i);
    assert.match(guard, /new\.feed_rank is not null/i);
    assert.match(guard, /new\.display_code,[\s\S]*new\.feed_rank[\s\S]*old\.display_code,[\s\S]*old\.feed_rank/i);
    assert.match(
        migration,
        /revoke all on function public\.enforce_job_request_curated_fields\(\)\s+from public, anon, authenticated/i
    );
});

test('Job Board Figma feed seed owns a complete guarded rank sequence', () => {
    const seed = readSql('supabase/seeds/20260829_opportunities_figma_demo.sql');
    const feedStart = seed.indexOf('with seed(\n  request_code,display_code,feed_rank');
    assert.notEqual(feedStart, -1, 'missing dedicated Job Board feed seed');
    const feedInsert = seed.indexOf('insert into public.job_board_requests', feedStart);
    assert.notEqual(feedInsert, -1, 'missing dedicated Job Board feed insert');
    const feedRows = seed.slice(feedStart, feedInsert);
    const tuples = [...feedRows.matchAll(/\('JB-FIGMA-FEED-(\d{5})','(JB-\d{5})',(\d+),/g)]
        .map((match) => ({ internal: match[1], display: match[2], rank: Number(match[3]) }));

    assert.equal(tuples.length, 13, 'the Figma feed needs every one of its 13 cards');
    assert.deepEqual(tuples.map((row) => row.rank), Array.from({ length: 13 }, (_, index) => index + 1));
    assert.deepEqual(
        tuples.map((row) => row.display),
        [
            'JB-59407', 'JB-76217', 'JB-33005', 'JB-34654', 'JB-28471',
            'JB-51027', 'JB-24872', 'JB-45210', 'JB-30991', 'JB-41432',
            'JB-19832', 'JB-38820', 'JB-27654'
        ]
    );
    for (const row of tuples) {
        assert.equal(row.display, `JB-${row.internal}`);
    }

    const freshRows = [...feedRows.matchAll(
        /^\s*\('JB-FIGMA-FEED-(\d{5})'[^\r\n]*now\(\)-interval '(\d) days?'\),?$/gmi
    )].map((match) => [match[1], Number(match[2])]);
    assert.deepEqual(freshRows, [['59407', 1], ['76217', 2], ['24872', 3]]);

    const preflight = seed.slice(0, feedStart);
    const collisionList = preflight.match(
        /from public\.job_board_requests r\s+where r\.request_code in \(([\s\S]*?)\)\s+and r\.client_user_id is distinct from v_demo_owner;/i
    );
    assert.ok(collisionList, 'feed fixtures need an owner collision preflight');
    const guardedCodes = [...collisionList[1].matchAll(/'JB-FIGMA-FEED-(\d{5})'/g)]
        .map((match) => match[1]).sort();
    assert.deepEqual(guardedCodes, tuples.map((row) => row.internal).sort());
    assert.match(preflight, /raise exception 'Opportunity demo seed aborted: owned Job Board request collision\(s\): %'/i);
    assert.match(preflight, /lower\(c\.email\) = 'demo-client1@weotzi\.test'/i);
    assert.match(preflight, /demo Job Board owner is missing/i);

    const feedUpsertEnd = seed.indexOf('with target as (', feedInsert);
    assert.notEqual(feedUpsertEnd, -1, 'missing boundary after dedicated feed upsert');
    const feedUpsert = seed.slice(feedInsert, feedUpsertEnd);
    assert.match(feedRows, /demo_owner as \([\s\S]*lower\(c\.email\) = 'demo-client1@weotzi\.test'/i);
    assert.match(feedUpsert, /select\s+v\.request_code,o\.user_id,v\.display_code,v\.feed_rank/i);
    assert.match(feedUpsert, /from seed v cross join demo_owner o/i);
    assert.match(feedUpsert, /on conflict \(request_code\) do update set[\s\S]*where public\.job_board_requests\.client_user_id = excluded\.client_user_id;/i);
});

test('saved requests use insert-only idempotency compatible with table grants', () => {
    const repo = read('public/shared/js/data/jobboard-repo.js');
    const savedStart = repo.indexOf('const SavedRequests =');
    const savedEnd = repo.indexOf('const JobBoardRealtime', savedStart);
    assert.notEqual(savedStart, -1);
    assert.notEqual(savedEnd, -1);
    const saved = repo.slice(savedStart, savedEnd);

    assert.match(saved, /from\('artist_saved_job_requests'\)\.insert\(\{/);
    assert.doesNotMatch(saved, /\.upsert\(/);
    assert.match(saved, /error\?\.code !== '23505'/);
    assert.match(saved, /error\?\.cause\?\.code !== '23505'/);
    assert.match(saved, /from\('artist_saved_job_requests'\)[\s\S]*\.delete\(\)/);
});

test('opportunity demo seed aborts on owned slugs and resolves only ownerless studios', () => {
    const seed = readSql('supabase/seeds/20260829_opportunities_figma_demo.sql');

    assert.match(seed, /where s\.slug in \([\s\S]*?\)\s+and s\.user_id is not null;[\s\S]*?raise exception 'Opportunity demo seed aborted:/i);
    assert.match(seed, /update public\.studios s[\s\S]*?where s\.user_id is null\s+and s\.slug in \(/i);
    assert.match(seed, /from seed v join public\.studios s using \(slug\)\s+where s\.user_id is null/i);
    assert.match(seed, /from seed v join public\.studios s using\(slug\)\s+where s\.user_id is null/i);
    assert.match(seed, /join public\.studios s on s\.slug=v\.slug and s\.user_id is null/);
    assert.match(seed, /where s\.slug='costa-ink-collective'\s+and s\.user_id is null/i);

    const studioRows = seed.slice(
        seed.indexOf('with seed(name, normalized_name, slug,'),
        seed.indexOf('insert into public.studios')
    );
    const declaredSlugs = [...studioRows.matchAll(/\('[^']*','[^']*','([^']+)'/g)]
        .map((match) => match[1]).sort();
    const collisionList = seed.match(/where s\.slug in \(([\s\S]*?)\)\s+and s\.user_id is not null;/i);
    assert.ok(collisionList, 'owned-slug preflight must expose its complete slug list');
    const guardedSlugs = [...collisionList[1].matchAll(/'([^']+)'/g)]
        .map((match) => match[1]).sort();
    assert.deepEqual(guardedSlugs, declaredSlugs, 'every declared demo studio slug must be guarded');

    for (const match of seed.matchAll(/join public\.studios s\b/gi)) {
        const resolver = seed.slice(match.index, match.index + 260);
        assert.match(resolver, /s\.user_id is null/i, `unguarded studio resolver near offset ${match.index}`);
    }

    const ownerlessExactJoins = seed.match(/join public\.studios s on s\.slug=v\.slug and s\.user_id is null/g) || [];
    assert.ok(ownerlessExactJoins.length >= 3, 'applications and both membership resolvers must be ownerless');
});

test('invitation detail seed resolves the exact membership role', () => {
    const seed = readSql('supabase/seeds/20260829_opportunities_figma_demo.sql');

    assert.match(seed, /with seed\(\s*slug,role,status,is_featured,styles,response_due/i);
    assert.match(seed, /m\.studio_id=s\.id and m\.status=v\.status and m\.role=v\.role/i);
    assert.match(seed, /\('fierro-negro-tattoo','resident','pending_acceptance'/);
    assert.match(seed, /\('casa-aguja','guest','pending_acceptance'/);
});

test('invitation RPCs close pending change requests and only active memberships can end', () => {
    const migration = readSql('supabase/migrations/20260829065500_harden_opportunity_state_transitions.sql');
    const respond = sqlFunction(migration, 'respond_to_studio_invitation');
    const end = sqlFunction(migration, 'end_studio_membership');

    for (const body of [respond, end]) {
        assert.match(body, /update public\.studio_invitation_change_requests\s+set status = 'superseded', resolved_at = v_now\s+where membership_id = p_membership_id\s+and status = 'pending'/i);
    }
    assert.match(respond, /v_membership\.status not in \('pending_invite', 'pending_acceptance'\)/i);
    assert.match(end, /v_membership\.status <> 'active'/i);
    assert.doesNotMatch(end, /pending_invite|pending_acceptance|paused/i);
});

test('Spot counteroffers are limited to negotiable application states', () => {
    const migration = readSql('supabase/migrations/20260829065500_harden_opportunity_state_transitions.sql');
    const createOffer = sqlFunction(migration, 'create_studio_spot_counter_offer');

    assert.match(createOffer, /v_application\.status not in \('pending', 'viewed', 'shortlisted'\)/i);
    assert.doesNotMatch(createOffer, /status in \('rejected', 'withdrawn'\)/i);
    assert.match(createOffer, /security definer/i);
    assert.match(createOffer, /set search_path = public, pg_temp/i);
});

test('private opportunity data stays behind RLS and guarded RPC grants', () => {
    const invitations = readSql('supabase/migrations/20260829061028_studio_invitation_details_and_responses.sql');
    const saved = readSql('supabase/migrations/20260829061428_job_board_featured_and_saved.sql');
    const spotOffers = readSql('supabase/migrations/20260829061412_studio_spot_counter_offers.sql');
    const hardening = readSql('supabase/migrations/20260829065500_harden_opportunity_state_transitions.sql');
    const studioRepo = read('public/shared/js/data/studios-repo.js');

    assert.match(invitations, /studio_membership_invitation_details enable row level security/i);
    assert.match(saved, /artist_saved_job_requests enable row level security/i);
    assert.match(saved, /grant select, insert, delete on public\.artist_saved_job_requests to authenticated/i);
    assert.doesNotMatch(saved, /grant[^;]*update[^;]*artist_saved_job_requests/i);
    assert.match(spotOffers, /studio_spot_counter_offers enable row level security/i);
    assert.match(hardening, /revoke all on function public\.respond_to_studio_invitation\(uuid, text\) from public, anon/i);
    assert.match(hardening, /grant execute on function public\.create_studio_spot_counter_offer\(uuid, text, numeric, date, date, text\) to authenticated/i);
    assert.match(studioRepo, /rpc\('respond_to_studio_invitation'/);
    assert.match(studioRepo, /rpc\('request_studio_invitation_changes'/);
    assert.match(studioRepo, /rpc\('respond_to_studio_spot_counter_offer'/);
});
