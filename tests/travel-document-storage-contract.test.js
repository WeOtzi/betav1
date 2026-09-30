const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Travel document bucket and browser validation enforce the same bounded file contract', () => {
    const migration = read('supabase/migrations/20260830062000_harden_travel_document_storage.sql');
    const page = read('public/artist/travel/index.html');
    const script = read('public/shared/js/artist-travel.js');

    assert.match(migration, /file_size_limit\s*=\s*10485760/i);
    for (const mime of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
        assert.match(migration, new RegExp(mime.replace('/', '\\/'), 'i'), mime);
        assert.match(page, new RegExp(mime.replace('/', '\\/'), 'i'), mime);
        assert.match(script, new RegExp(mime.replace('/', '\\/'), 'i'), mime);
    }
    assert.doesNotMatch(page, /accept="[^"]*image\/\*/i);
    assert.match(script, /file\.size\s*>\s*MAX_DOCUMENT_BYTES/i);
    assert.match(script, /ALLOWED_DOCUMENT_TYPES\.has\(file\.type\)/i);
});

test('Travel hardening prevents share-slug collisions and direct lifecycle mutation', () => {
    const migration = read('supabase/migrations/20260830062000_harden_travel_document_storage.sql');
    const activeSql = migration.replace(/^\s*--[^\r\n]*$/gm, '').trim();

    assert.match(activeSql, /^begin\s*;/i);
    assert.match(activeSql, /commit\s*;\s*$/i);
    assert.match(activeSql, /begin\s*;[\s\S]*lock\s+table\s+public\.artist_trips\s+in\s+share\s+row\s+exclusive\s+mode[\s\S]*do\s+\$\$/i);
    assert.match(migration, /group\s+by\s+lower\(share_slug\)[\s\S]*having\s+count\(\*\)\s*>\s*1/i);
    assert.match(migration, /create\s+unique\s+index[\s\S]*lower\(share_slug\)/i);
    assert.match(migration, /share_slug\s*=\s*lower\(btrim\(share_slug\)\)/i);
    assert.match(migration, /drop\s+policy\s+if\s+exists\s+artist_trips_owner_all/i);
    assert.match(migration, /create\s+policy\s+artist_trips_owner_select[\s\S]*for\s+select/i);
    assert.match(migration, /create\s+policy\s+artist_trips_owner_update[\s\S]*for\s+update/i);
    assert.doesNotMatch(migration, /create\s+policy\s+artist_trips_owner_delete/i);
    assert.match(migration, /revoke\s+all\s+privileges\s+on\s+table\s+public\.artist_trips\s+from\s+authenticated/i);

    const updateGrant = migration.match(/grant\s+update\s*\(([^)]+)\)\s+on\s+table\s+public\.artist_trips\s+to\s+authenticated/i);
    assert.ok(updateGrant, 'expected an explicit update-column allowlist');
    for (const restricted of ['artist_user_id', 'start_date', 'end_date', 'status', 'origin', 'cancelled_at', 'source_type', 'source_id']) {
        assert.doesNotMatch(updateGrant[1], new RegExp(`\\b${restricted}\\b`, 'i'), restricted);
    }
});

test('Travel satellite grants expose only the DML used by the authenticated workspace', () => {
    const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
        .filter((name) => name.endsWith('_lock_down_travel_satellite_privileges.sql'));
    assert.equal(migrations.length, 1, 'expected one satellite ACL migration');
    const sql = read(path.join('supabase', 'migrations', migrations[0]));
    const activeSql = sql.replace(/^\s*--[^\r\n]*$/gm, '').trim();

    assert.match(activeSql, /^begin\s*;/i);
    assert.match(activeSql, /commit\s*;\s*$/i);
    for (const table of ['trip_checklist_items', 'trip_documents', 'trip_events', 'trip_studio_links']) {
        assert.match(sql, new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table[\\s\\S]*public\\.${table}[\\s\\S]*from\\s+authenticated`, 'i'), table);
    }
    assert.match(sql, /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+public\.trip_checklist_items\s+to\s+authenticated/i);
    assert.match(sql, /grant\s+select,\s*insert,\s*delete\s+on\s+table\s+public\.trip_documents\s+to\s+authenticated/i);
    assert.match(sql, /grant\s+select,\s*insert\s+on\s+table\s+public\.trip_events\s+to\s+authenticated/i);
    assert.match(sql, /grant\s+select\s+on\s+table\s+public\.trip_studio_links\s+to\s+authenticated/i);
    assert.doesNotMatch(activeSql, /grant[^;]*(?:truncate|trigger|references)/i);
});

test('Travel keeps document deletion reachable and compensates a failed metadata insert', () => {
    const script = read('public/shared/js/artist-travel.js');
    const css = read('public/shared/css/artist-travel-ds.css');
    const deleteBranch = script.slice(
        script.indexOf("} else if (act === 'doc-del')"),
        script.indexOf("} else if (act === 'chk-add')"),
    );

    assert.match(script, /data-act="doc-open"/i);
    assert.match(script, /data-act="doc-del"[^>]*data-doc=/i);
    assert.match(css, /\.tvd-doc-del/i);
    assert.match(script, /let\s+uploadedPath\s*=\s*null/i);
    assert.match(script, /await\s+D\.Travel\.addDocument[\s\S]*catch\s*\([^)]*\)\s*\{[\s\S]*storage\.from\(BUCKET\)\.remove\(\[uploadedPath\]\)/i);
    assert.match(script, /try\s*\{[\s\S]*pasajes_agregados[\s\S]*catch\s*\(sideEffectError\)[\s\S]*documento guardado/i);
    assert.ok(
        deleteBranch.indexOf('D.Travel.deleteDocument') < deleteBranch.indexOf('storage.from(BUCKET).remove'),
        'metadata must be deleted before the private blob so a DB failure cannot leave a live broken reference',
    );
    assert.match(deleteBranch, /deleteDocument[\s\S]*try\s*\{[\s\S]*storage\.from\(BUCKET\)\.remove[\s\S]*catch\s*\([^)]*\)/i);

    const openBranch = script.slice(
        script.indexOf("} else if (act === 'doc-open')"),
        script.indexOf("} else if (act === 'doc-del')"),
    );
    assert.match(openBranch, /const\s+popup\s*=\s*window\.open\('',\s*'_blank'\);[\s\S]*await\s+_supabase\.storage\.from\(BUCKET\)\.createSignedUrl[\s\S]*popup\.location\.href/i);
    assert.match(openBranch, /catch\s*\([^)]*\)\s*\{[\s\S]*popup\?\.close\(\)[\s\S]*window\.alert/i);
});

test('Share dialog does not publish on open and supports explicit enable plus revocation', () => {
    const page = read('public/artist/travel/index.html');
    const script = read('public/shared/js/artist-travel.js');
    const openShare = script.slice(script.indexOf('async function openShare()'), script.indexOf('async function ensureShareEnabled()'));

    assert.doesNotMatch(openShare, /setShare\(/i);
    assert.match(script, /async function ensureShareEnabled\(/i);
    assert.match(script, /async function disableShare\(/i);
    assert.match(script, /pendingShareTripId\s*===\s*t\.id[\s\S]*pendingShareSlug[\s\S]*makeSlug\(t\)/i);
    assert.match(script, /urlInput\.disabled\s*=\s*!isEnabled/i);
    assert.match(script, /isEnabled\s*\?\s*url\s*:\s*'El enlace se activará al copiar'/i);
    assert.match(script, /\$\('tvs-email'\)\.href\s*=\s*isEnabled\s*\?/i);
    const copyHelper = script.slice(script.indexOf('async function copyEnabledShareUrl()'), script.indexOf('function wireShareModal()'));
    const shareWiring = script.slice(script.indexOf('function wireShareModal()'), script.indexOf('// ---------- Modal adjuntar archivo'));
    assert.match(script, /function copyShareUrlWithGesture\(url\)[\s\S]*navigator\.clipboard\.writeText\(url\)/i);
    assert.match(copyHelper, /if\s*\([^)]*!t\.share_enabled[\s\S]*await ensureShareEnabled\(\);[\s\S]*return false;/i);
    assert.match(copyHelper, /copyShareUrlWithGesture\(url\)/i);
    assert.doesNotMatch(copyHelper, /await ensureShareEnabled\(\)[\s\S]*navigator\.clipboard\.writeText/i);
    assert.match(shareWiring, /tvs-wa[\s\S]*const\s+popup\s*=\s*window\.open\([^;]+;[\s\S]*await ensureShareEnabled\(\);[\s\S]*popup\.location/i);
    assert.match(shareWiring, /catch\s*\([^)]*\)\s*\{[\s\S]*popup\?\.close\(\)/i);
    assert.match(script, /tvs-copy[\s\S]*copyEnabledShareUrl/i);
    assert.match(page, /id="tvs-disable"/i);
});

test('Travel demo ships three real synthetic PDF fixtures for the seeded metadata', () => {
    const fixtureDir = path.join(root, 'supabase', 'fixtures', 'travel-figma-20260830');
    const expected = [
        'Pasaje_ida_vuelta.pdf',
        'Reserva_hotel_barcelona.pdf',
        'Acuerdo_costa_ink.pdf',
    ];

    for (const filename of expected) {
        const bytes = fs.readFileSync(path.join(fixtureDir, filename));
        assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', filename);
        assert.ok(bytes.length > 1000, `${filename} should be a non-empty rendered fixture`);
    }
    assert.match(read('scripts/generate-travel-pdf-fixtures.py'), /DOCUMENTS\s*=\s*\(/i);
});
