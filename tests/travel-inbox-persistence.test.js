const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripSqlComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '');

function sqlFunction(source, name) {
    const lower = source.toLowerCase();
    const start = lower.indexOf(`create or replace function public.${name}(`);
    assert.notEqual(start, -1, `missing SQL function ${name}`);
    const end = source.indexOf('$$;', start);
    assert.notEqual(end, -1, `unterminated SQL function ${name}`);
    return source.slice(start, end + 3);
}

const travelMigration = () => stripSqlComments(read('supabase/migrations/20260829153000_harden_travel_studio_links.sql'));
const inboxMigration = () => stripSqlComments(read('supabase/migrations/20260829153500_unified_artist_inbox.sql'));

test('artist cannot confirm or reject their own Travel studio link', () => {
    const migration = travelMigration();
    const guard = sqlFunction(migration, 'guard_trip_studio_link_transition');
    const tripGuard = sqlFunction(migration, 'guard_artist_trip_confirmation');
    const resolve = sqlFunction(migration, 'resolve_trip_studio_link');
    const artistJs = read('public/shared/js/artist-travel.js');
    const repo = read('public/shared/js/data/travel-repo.js');

    assert.doesNotMatch(migration, /current_user\s+in/i);
    for (const body of [guard, tripGuard]) {
        assert.match(body, /auth\.role\(\)[\s\S]*service_role/i);
        assert.match(body, /auth\.role\(\) is null[\s\S]*session_user in \('postgres', 'service_role', 'supabase_admin'\)/i);
    }
    assert.match(guard, /only the studio owner or support can resolve this link/i);
    assert.match(resolve, /auth\.uid\(\) is distinct from v_studio_owner_id and not public\.is_support_user\(\)/i);
    assert.match(resolve, /p_action not in \('confirm', 'reject'\)/i);
    assert.doesNotMatch(artistJs, /link-confirm|link-reject|Marcar confirmada|Marcar rechazada/);
    assert.doesNotMatch(repo, /updateStudioLinkStatus|deleteStudioLink|\.from\('trip_studio_links'\)\.(?:insert|update|delete)/);
    assert.match(repo, /rpc\('request_trip_studio_link'/);
    assert.match(read('public/shared/js/studio-travel-links.js'), /resolveStudioLink\(linkId, action\)/);
});

test('Travel privilege bypass is JWT-aware and audit source values satisfy their check', () => {
    const migration = travelMigration();
    const audit = sqlFunction(migration, 'audit_trip_studio_link_transition');

    assert.doesNotMatch(migration, /current_user/i);
    assert.match(audit, /coalesce\(auth\.role\(\), ''\) = 'service_role' then 'seed'/i);
    assert.match(audit, /auth\.role\(\) is null[\s\S]*session_user in \('postgres', 'service_role', 'supabase_admin'\) then 'seed'/i);
    assert.match(migration, /check \(source in \('ui', 'spot_application', 'studio_invitation', 'support', 'seed'\)\)/i);
    assert.doesNotMatch(audit, /then 'service_role'/i);
});

test('Travel and Inbox trigger output values satisfy every affected CHECK domain', () => {
    const travel = travelMigration();
    const travelBase = stripSqlComments(read('supabase/migrations/20260825100000_artist_travel.sql'));
    const inbox = inboxMigration();

    assert.match(travel, /artist_trips_source_type_check[\s\S]*'manual', 'spot_application', 'studio_invitation', 'demo'/i);
    assert.match(travel, /trip_studio_links_source_type_check[\s\S]*'manual', 'spot_application', 'studio_invitation', 'demo'/i);
    assert.match(travelBase, /trip_type in \('guest_spot', 'convencion', 'estudio_invitado'\)/i);
    assert.match(travelBase, /status in \('planificado', 'pendiente', 'confirmado', 'finalizado', 'cancelado'\)/i);
    assert.match(travelBase, /origin in \('manual', 'automatico'\)/i);
    assert.match(travelBase, /status in \('esperando_confirmacion', 'confirmada', 'rechazada', 'cancelada'\)/i);
    assert.match(travelBase, /event_type in \('creado', 'estudio_confirmado', 'pasajes_agregados', 'inicio', 'fin', 'cancelado', 'nota'\)/i);

    assert.match(inbox, /category in \([\s\S]*'clients'[\s\S]*'quotations'[\s\S]*'support'[\s\S]*'invitations'[\s\S]*'spots'[\s\S]*'job_board'[\s\S]*'studios'[\s\S]*'trips'/i);
    assert.match(inbox, /participant_role in \([\s\S]*'artist', 'client', 'studio', 'support'/i);
    assert.match(inbox, /sender_role in \([\s\S]*'artist', 'client', 'studio', 'support', 'system'/i);
    assert.match(inbox, /message_kind in \('text', 'image', 'file', 'system'\)/i);
    assert.match(inbox, /event_type in \([\s\S]*'created', 'message_sent', 'read', 'favorited', 'unfavorited'[\s\S]*'archived', 'unarchived', 'closed', 'reopened'/i);
});

test('Travel uses audited RPCs, automatic confirmed-domain flows and a limited public projection', () => {
    const migration = travelMigration();
    const request = sqlFunction(migration, 'request_trip_studio_link');

    assert.match(migration, /revoke insert, update, delete on table public\.trip_studio_links from authenticated/i);
    assert.match(request, /artist_user_id = auth\.uid\(\)/i);
    assert.match(request, /v_studio\.user_id is null/i);
    assert.match(migration, /create trigger trg_create_trip_from_accepted_spot[\s\S]*after insert or update on public\.studio_spot_applications/i);
    assert.match(migration, /create trigger trg_create_trip_from_accepted_invitation[\s\S]*after insert or update on public\.studio_artist_memberships/i);
    assert.match(migration, /create or replace view public\.artist_public_travel_presences/i);
    assert.match(migration, /l\.status = 'confirmada'/i);
    assert.match(migration, /t\.status in \('confirmado', 'finalizado'\)/i);
    assert.match(migration, /t\.cancelled_at is null/i);
    assert.doesNotMatch(migration.match(/create or replace view public\.artist_public_travel_presences[\s\S]*?;/i)[0], /personal_notes|agreed_conditions|storage_path|checklist/i);
});

test('public Travel projection is RLS-invoker and requires explicit artist sharing', () => {
    const hardening = read('supabase/migrations/20260829161000_harden_public_travel_projection.sql');

    assert.match(hardening, /security_invoker\s*=\s*true/i);
    assert.match(hardening, /t\.share_enabled\s*=\s*true/i);
    assert.match(hardening, /for select to anon, authenticated/i);
    assert.match(hardening, /grant select \(trip_id, studio_id, studio_name, studio_city, status\)/i);
    assert.doesNotMatch(hardening, /personal_notes|agreed_conditions|storage_path|requested_by_user_id|resolved_by_user_id/i);
});

test('Inbox participant helper cannot probe arbitrary users and immutable fields stay guarded', () => {
    const migration = inboxMigration();
    const participant = sqlFunction(migration, 'is_inbox_thread_participant');
    const guard = sqlFunction(migration, 'guard_inbox_participant_update');

    assert.match(migration, /function public\.is_inbox_thread_participant\(p_thread_id uuid\)/i);
    assert.doesNotMatch(participant, /p_user_id/i);
    assert.match(participant, /p\.user_id = auth\.uid\(\)/i);
    assert.match(migration, /grant execute on function public\.is_inbox_thread_participant\(uuid\) to authenticated, service_role/i);
    assert.doesNotMatch(migration, /is_inbox_thread_participant\(uuid, uuid\)/i);
    assert.doesNotMatch(guard, /current_user/i);
    assert.match(guard, /auth\.role\(\) is null[\s\S]*session_user in \('postgres', 'service_role', 'supabase_admin'\)/i);
    assert.match(guard, /new\.thread_id is distinct from old\.thread_id[\s\S]*new\.participant_role is distinct from old\.participant_role[\s\S]*new\.joined_at is distinct from old\.joined_at/i);
});

test('Inbox persists categories, messages, read, favorite, archive, attachments and realtime under RLS', () => {
    const migration = inboxMigration();
    const repo = read('public/shared/js/data/inbox-repo.js');
    const page = read('public/artist/inbox/index.html');

    for (const category of ['clients', 'quotations', 'support', 'invitations', 'spots', 'job_board', 'studios', 'trips']) {
        assert.match(migration, new RegExp(`'${category}'`));
        assert.match(page, new RegExp(`data-filter="${category}"`));
    }
    assert.match(migration, /alter table public\.inbox_threads enable row level security/i);
    assert.match(migration, /alter table public\.inbox_messages enable row level security/i);
    assert.match(migration, /create or replace function public\.send_inbox_message/i);
    assert.match(migration, /create or replace function public\.mark_inbox_thread_read/i);
    assert.match(migration, /create or replace function public\.set_inbox_thread_flags/i);
    assert.match(migration, /'inbox-attachments', 'inbox-attachments', false, 15728640/i);
    assert.match(migration, /alter publication supabase_realtime add table public\.inbox_messages/i);
    assert.match(repo, /uploadAttachment/);
    assert.match(repo, /subscribeThread/);
    assert.match(repo, /subscribeList/);
    assert.doesNotMatch(page, /disabled[^>]*>[^<]*(Spots|Invitaciones|Viajes|Job Board)|Próximamente/i);
});

test('Inbox domain triggers and Figma demo cover all requested real sources', () => {
    const migration = inboxMigration();
    const seed = read('supabase/seeds/20260829_travel_inbox_figma_demo.sql');

    for (const trigger of [
        'trg_inbox_from_trip_studio_link',
        'trg_inbox_from_spot_application',
        'trg_inbox_from_studio_invitation',
        'trg_inbox_from_job_board_application',
    ]) assert.match(migration, new RegExp(`create trigger ${trigger}`, 'i'));

    for (const name of [
        'Camila R.', 'Rodrigo A.', 'Valentina Cruz', 'Bruno T.', 'Sofía L.',
        'Fierro Negro Tattoo', 'Costa Ink Collective', 'Aurora Ink Collective',
        'Estudio Cactus', 'Marta Vidal — Costa Ink',
    ]) assert.match(seed, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(seed, /isainazartattoo\.wo/i);
    assert.match(seed, /\[PRUEBA\]\[INBOX-FIGMA\]/);
});
