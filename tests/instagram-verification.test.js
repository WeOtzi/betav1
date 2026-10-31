const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const svc = require('../services/instagram-verification');
const visibility = require('../public/shared/js/gallery-visibility.js');

const { generateCode, normalizeCode, hashCode, extractCode, extractCodes, maskEmail, normalizeHandle, safeEqual, buildState, setDeps, TABLE } = svc._internal;

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const ROW_ID = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// PostgREST en memoria: implementa el subconjunto del builder de lib/postgrest
// que usa el servicio y simula la migración ausente (404 PGRST205 / 42703).
// ---------------------------------------------------------------------------
function createFakeDb(seed = {}, { missingTables = [], missingColumns = {} } = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
    const log = [];
    const fail = (status, code, message) => {
        const error = new Error(`PostgREST failed (${status}): {"code":"${code}","message":"${message}"}`);
        error.status = status;
        return error;
    };
    function pgrest(table) {
        const filters = [];
        let columns = null;
        let orderBy = null;
        let limitN = null;
        let single = false;
        const ensure = (cols) => {
            if (missingTables.includes(table)) throw fail(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
            const missing = (missingColumns[table] || []).find((c) => cols.includes(c));
            if (missing) throw fail(400, '42703', `column ${table}.${missing} does not exist`);
        };
        const rowsOf = () => (tables[table] = tables[table] || []);
        const matching = () => rowsOf().filter((row) => filters.every((f) => f(row)));
        const project = (row) => {
            if (!columns || columns === '*') return { ...row };
            const out = {};
            for (const c of columns.split(',')) out[c.trim()] = row[c.trim()] === undefined ? null : row[c.trim()];
            return out;
        };
        const q = {
            select(cols) { columns = cols; return q; },
            eq(c, v) { filters.push((r) => r[c] === v || String(r[c]) === String(v)); return q; },
            neq(c, v) { filters.push((r) => String(r[c]) !== String(v)); return q; },
            lt(c, v) { filters.push((r) => r[c] != null && Date.parse(r[c]) < Date.parse(v)); return q; },
            gt(c, v) { filters.push((r) => r[c] != null && Date.parse(r[c]) > Date.parse(v)); return q; },
            in(c, arr) { filters.push((r) => arr.map(String).includes(String(r[c]))); return q; },
            order(c, { ascending = true } = {}) { orderBy = { c, ascending }; return q; },
            limit(n) { limitN = n; return q; },
            single() { single = true; return q; },
            async execute() {
                ensure(columns ? columns.split(',') : []);
                let rows = matching();
                if (orderBy) {
                    const dir = orderBy.ascending ? 1 : -1;
                    rows = rows.slice().sort((a, b) => (String(a[orderBy.c]) > String(b[orderBy.c]) ? dir : -dir));
                }
                if (limitN != null) rows = rows.slice(0, limitN);
                log.push({ table, op: 'select', columns });
                const out = rows.map(project);
                return single ? out[0] || null : out;
            },
            async insert(values) {
                ensure(Object.keys(values));
                const row = { id: crypto.randomUUID(), created_at: iso(NOW), status: 'pending', attempts: 0, email_sent: false, ...values };
                rowsOf().push(row);
                log.push({ table, op: 'insert', values });
                return [{ ...row }];
            },
            async patch(values) {
                ensure(Object.keys(values));
                const rows = matching();
                rows.forEach((r) => Object.assign(r, values));
                log.push({ table, op: 'patch', values, count: rows.length });
                return rows.map((r) => ({ ...r }));
            }
        };
        return q;
    }
    return { pgrest, tables, log };
}

function fakeReq({ headers = {}, body = {}, query = {}, params = {} } = {}) {
    return { headers, body, query, params };
}

function fakeRes() {
    return {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; }
    };
}

function artistRow(overrides = {}) {
    return {
        user_id: ARTIST_ID,
        name: 'Laura',
        username: 'laura.wo',
        email: 'perfil@weotzi.test',
        instagram: '@Laura.Tattoo',
        gallery_feed_items: [],
        instagram_verified_at: null,
        instagram_verified_handle: null,
        ...overrides
    };
}

function withDeps(t, overrides) {
    const restore = setDeps({ now: () => NOW, ...overrides });
    t.after(restore);
}

async function call(handler, req) {
    const res = fakeRes();
    await handler(req, res);
    return res;
}

// --- Código -------------------------------------------------------------------

test('generateCode returns WO- plus 6 characters from the unambiguous alphabet', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
        const code = generateCode();
        assert.match(code, /^WO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
        for (const ch of code.slice(3)) assert.ok(svc.CODE_ALPHABET.includes(ch), `${ch} must be in the alphabet`);
        seen.add(code);
    }
    assert.ok(seen.size > 490, 'codes must be random');
    assert.equal(svc.CODE_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    assert.doesNotMatch(svc.CODE_ALPHABET, /[IL01O]/);
});

test('code normalisation makes every spelling hash the same', () => {
    const expected = crypto.createHash('sha256').update('WO-4F7K2Q').digest('hex');
    for (const spelling of ['WO-4F7K2Q', 'WO4F7K2Q', 'wo-4f7k2q', ' wo 4f7k2q ', 'WO—4F7K2Q', '4F7K2Q']) {
        assert.equal(normalizeCode(spelling), 'WO-4F7K2Q', spelling);
        assert.equal(hashCode(spelling), expected, spelling);
    }
    for (const bad of ['', null, 'WO-4F7K2', 'WO-4F7K2QQ', 'WO-4F7K2O', 'WO-IIIIII', 'WO-L4F7K2', 'WO-0F7K2Q', 'XX-4F7K2Q']) {
        assert.equal(normalizeCode(bad), null, String(bad));
        assert.equal(hashCode(bad), null, String(bad));
    }
});

test('extractCode finds the code inside messy DM text', () => {
    assert.equal(extractCode('Hola!! mi código es wo-4f7k2q gracias 🙌'), 'WO-4F7K2Q');
    assert.equal(extractCode('WO 4F7K2Q'), 'WO-4F7K2Q');
    assert.equal(extractCode('te paso el código: WO—4F7K2Q.'), 'WO-4F7K2Q');
    assert.equal(extractCode('WO4F7K2Q'), 'WO-4F7K2Q');
    assert.equal(extractCode('ＷＯ－４Ｆ７Ｋ２Ｑ'), 'WO-4F7K2Q');
    assert.equal(extractCode('hola, quiero validar mi cuenta'), null);
    assert.equal(extractCode(null), null);
    // Los códigos con guion van primero aunque el texto tenga palabras parecidas antes.
    assert.deepEqual(extractCodes('two hundred thanks WO-4F7K2Q').slice(0, 1), ['WO-4F7K2Q']);
    assert.deepEqual(extractCodes('WO-4F7K2Q y de nuevo wo-4f7k2q'), ['WO-4F7K2Q']);
});

test('maskEmail hides the local part and keeps the domain', () => {
    assert.equal(maskEmail('Laura@Gmail.com'), 'la•••a@gmail.com');
    assert.equal(maskEmail('ana@weotzi.com'), 'a•••a@weotzi.com');
    assert.equal(maskEmail('jo@x.com'), 'j•••@x.com');
    assert.equal(maskEmail('sin-arroba'), null);
    assert.equal(maskEmail(''), null);
    assert.equal(maskEmail(null), null);
});

test('normalizeHandle strips @ and profile URLs and validates the Instagram format', () => {
    assert.equal(normalizeHandle('@Laura.Tattoo'), 'laura.tattoo');
    assert.equal(normalizeHandle('  laura_ink '), 'laura_ink');
    assert.equal(normalizeHandle('https://www.instagram.com/Laura.Tattoo/?hl=es'), 'laura.tattoo');
    assert.equal(normalizeHandle('instagram.com/laura.tattoo'), 'laura.tattoo');
    assert.equal(normalizeHandle('laura tattoo'), null);
    assert.equal(normalizeHandle('laura!'), null);
    assert.equal(normalizeHandle('a'.repeat(31)), null);
    assert.equal(normalizeHandle(''), null);
    assert.equal(normalizeHandle(null), null);
});

test('safeEqual compares secrets in constant time and rejects empty values', () => {
    assert.equal(safeEqual('s3cret-token', 's3cret-token'), true);
    assert.equal(safeEqual('s3cret-token', 's3cret-tokem'), false);
    assert.equal(safeEqual('short', 'a-much-longer-secret'), false);
    assert.equal(safeEqual('', ''), false);
    assert.equal(safeEqual(undefined, 'x'), false);
    const source = read('services/instagram-verification.js');
    assert.match(source, /crypto\.timingSafeEqual\(a, b\)/);
});

// --- Estado -------------------------------------------------------------------

const FEED = [
    { url: 'https://cdn.test/manual.jpg', category: 'realizados', kind: 'image', created_at: '2026-01-01' },
    { url: 'https://cdn.test/instagram-import/u/a.jpg', category: 'instagram', kind: 'image', created_at: '2026-01-02', source: 'instagram', ig_handle: 'laura.tattoo' },
    { url: 'https://cdn.test/old.jpg', category: 'realizados', kind: 'image', created_at: '2026-01-03', permalink: 'https://instagram.com/p/old/', ig_legacy: true },
    { url: 'https://cdn.test/instagram-import/u/b.jpg', category: 'instagram', kind: 'image', created_at: '2026-01-04', source: 'instagram', ig_handle: 'otra.cuenta' },
    { url: 'https://cdn.test/c.jpg', category: 'instagram-reel', kind: 'video', created_at: '2026-01-05' }
];

test('buildState counts pending and legacy Instagram items with the gallery rule', () => {
    const unverified = buildState({ artist: artistRow({ gallery_feed_items: FEED }), verifications: [], available: true, now: NOW });
    assert.equal(unverified.available, true);
    assert.equal(unverified.status, 'none');
    assert.equal(unverified.handle, 'laura.tattoo');
    assert.equal(unverified.pending_items, 3);
    assert.equal(unverified.legacy_items, 1);

    const verified = buildState({
        artist: artistRow({ gallery_feed_items: FEED, instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'laura.tattoo' }),
        verifications: [], available: true, now: NOW
    });
    assert.equal(verified.status, 'verified');
    assert.equal(verified.verified_handle, 'laura.tattoo');
    assert.equal(verified.pending_items, 1, 'only the item imported from another account stays hidden');
    assert.equal(verified.legacy_items, 1);

    // El objeto se puede pasar tal cual a WoGalleryVisibility.stateFrom().
    assert.deepEqual(visibility.stateFrom(verified), { enforced: true, verified: true, handle: 'laura.tattoo' });

    const unavailable = buildState({ artist: artistRow({ gallery_feed_items: FEED }), available: false, now: NOW });
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.pending_items, 0);
    assert.equal(unavailable.legacy_items, 1);
    assert.equal(visibility.stateFrom(unavailable).enforced, false);
});

test('buildState reports pending and expired codes', () => {
    const artist = artistRow();
    const pending = buildState({
        artist, available: true, now: NOW, authEmail: 'laura@gmail.com',
        verifications: [{ id: 'a', ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR), email_sent_to: 'laura@gmail.com' }]
    });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.expires_at, iso(NOW + 71 * HOUR));
    assert.equal(pending.email_masked, 'la•••a@gmail.com');

    const expired = buildState({
        artist, available: true, now: NOW,
        verifications: [{ id: 'b', ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW - 80 * HOUR), expires_at: iso(NOW - 8 * HOUR) }]
    });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.email_masked, null);

    // Validó otra cuenta y cambió el usuario del perfil: tiene que validar la nueva.
    const changed = buildState({
        artist: artistRow({ instagram: 'nueva.cuenta', instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'laura.tattoo' }),
        verifications: [{ id: 'c', status: 'verified', created_at: iso(NOW - 2 * HOUR), expires_at: iso(NOW + 70 * HOUR) }],
        available: true, now: NOW
    });
    assert.equal(changed.status, 'none');
    assert.equal(changed.verified, true);
});

test('buildState only reports a code as pending for the handle that is in the profile now', () => {
    const live = (ig_handle, extra = {}) => ({
        id: 'p', ig_handle, status: 'pending', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR), email_sent_to: 'laura@gmail.com', ...extra
    });

    // Pidió el código con un error de tipeo y después corrigió Mi perfil.
    const typo = buildState({ artist: artistRow({ instagram: '@laura.tattoo' }), verifications: [live('laura.tatoo')], available: true, now: NOW });
    assert.equal(typo.status, 'none', 'the card offers a new code for the corrected handle');
    assert.equal(typo.handle, 'laura.tattoo');
    assert.equal(typo.expires_at, null);
    assert.equal(typo.email_masked, null);

    // Tampoco se reporta 'expired' por un código vencido de la cuenta anterior.
    const oldExpired = buildState({
        artist: artistRow({ instagram: 'laura.tattoo' }),
        verifications: [live('laura.tatoo', { expires_at: iso(NOW - HOUR) })],
        available: true, now: NOW
    });
    assert.equal(oldExpired.status, 'none');

    // Mayúsculas, @ o URL del perfil no cuentan como cambio de cuenta.
    for (const instagram of ['@Laura.Tattoo', 'https://www.instagram.com/laura.tattoo/']) {
        const same = buildState({ artist: artistRow({ instagram }), verifications: [live('Laura.Tattoo')], available: true, now: NOW });
        assert.equal(same.status, 'pending', instagram);
    }

    // Sin usuario en el perfil (lo borró) el código vigente sigue contando.
    const noProfile = buildState({ artist: artistRow({ instagram: null }), verifications: [live('laura.tattoo')], available: true, now: NOW });
    assert.equal(noProfile.status, 'pending');
    assert.equal(noProfile.handle, null);

    // Un código nuevo para la cuenta corregida vuelve a estar pendiente.
    const fixed = buildState({
        artist: artistRow({ instagram: 'laura.tattoo' }),
        verifications: [live('laura.tatoo', { status: 'cancelled', created_at: iso(NOW - 2 * HOUR) }), live('laura.tattoo')],
        available: true, now: NOW
    });
    assert.equal(fixed.status, 'pending');
    assert.equal(fixed.expires_at, iso(NOW + 71 * HOUR));
});

test('getStateForArtist reads the rows, expires stale codes and degrades without the migration', async (t) => {
    const db = createFakeDb({
        artists_db: [artistRow({ gallery_feed_items: FEED })],
        [TABLE]: [{ id: ROW_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW - 80 * HOUR), expires_at: iso(NOW - 8 * HOUR) }]
    });
    withDeps(t, { pgrest: db.pgrest });
    const state = await svc.getStateForArtist({ userId: ARTIST_ID, authUser: { email: 'laura@gmail.com' } });
    assert.equal(state.available, true);
    assert.equal(state.status, 'expired');
    assert.equal(state.pending_items, 3);
    assert.equal(db.tables[TABLE][0].status, 'expired', 'stale pending rows are expired lazily');

    const missing = createFakeDb({ artists_db: [artistRow()] }, { missingTables: [TABLE], missingColumns: { artists_db: ['instagram_verified_at'] } });
    setDeps({ pgrest: missing.pgrest });
    const degraded = await svc.getStateForArtist({ userId: ARTIST_ID, artist: { user_id: ARTIST_ID, instagram: 'laura' } });
    assert.equal(degraded.available, false);
    assert.equal(degraded.status, 'none');

    const broken = createFakeDb({ artists_db: [artistRow()] }, { missingTables: [TABLE] });
    setDeps({ pgrest: broken.pgrest });
    assert.equal((await svc.getStateForArtist({ userId: ARTIST_ID })).available, false);
});

// --- Endpoints del artista ---------------------------------------------------------

test('artist endpoints require a session and an artist profile', async (t) => {
    const db = createFakeDb({ artists_db: [] });
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => null });
    assert.equal((await call(svc.getArtistVerification, fakeReq())).statusCode, 401);
    assert.equal((await call(svc.requestArtistVerification, fakeReq())).statusCode, 401);

    setDeps({ resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }) });
    const res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Artist profile required');
});

test('artist endpoints answer 503 IG_VERIFICATION_UNAVAILABLE while the migration is missing', async (t) => {
    const noColumns = createFakeDb({ artists_db: [artistRow()] }, { missingColumns: { artists_db: ['instagram_verified_at'] } });
    withDeps(t, { pgrest: noColumns.pgrest, resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }) });
    const expected = { success: false, code: 'IG_VERIFICATION_UNAVAILABLE', error: 'La validación de Instagram se habilita pronto.' };
    for (const handler of [svc.getArtistVerification, svc.requestArtistVerification]) {
        const res = await call(handler, fakeReq());
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, expected);
    }

    const noTable = createFakeDb({ artists_db: [artistRow()] }, { missingTables: [TABLE] });
    setDeps({ pgrest: noTable.pgrest });
    const res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, expected);
    assert.equal((await call(svc.getArtistVerification, fakeReq())).statusCode, 503);
});

test('POST validates the handle and refuses an already validated account', async (t) => {
    const db = createFakeDb({ artists_db: [artistRow({ instagram: null })], [TABLE]: [] });
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }) });
    let res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Cargá tu usuario de Instagram en Mi perfil antes de validar.');

    res = await call(svc.requestArtistVerification, fakeReq({ body: { handle: 'no vale!' } }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'IG_HANDLE_INVALID');

    db.tables.artists_db[0] = artistRow({ instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'laura.tattoo' });
    res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'IG_ALREADY_VERIFIED');
    assert.equal(db.tables[TABLE].length, 0);
});

test('POST stores only the hash, cancels previous codes and emails the code without echoing it', async (t) => {
    const db = createFakeDb({
        artists_db: [artistRow()],
        [TABLE]: [{ id: ROW_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR) }]
    });
    const sent = [];
    withDeps(t, {
        pgrest: db.pgrest,
        resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }),
        sendEmail: async (...args) => { sent.push(args); return { ok: true, channel: 'n8n' }; }
    });
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    t.after(() => { console.error = originalError; });

    const res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        success: true,
        status: 'pending',
        handle: 'laura.tattoo',
        expires_at: iso(NOW + 72 * HOUR),
        email_masked: 'la•••a@gmail.com',
        email_sent: true
    });

    assert.equal(sent.length, 1);
    const [eventId, payload, options] = sent[0];
    assert.equal(eventId, 'instagram_verification_code');
    assert.match(payload.verification_code, /^WO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.deepEqual({ ...payload, verification_code: 'x' }, {
        artist_email: 'laura@gmail.com',
        artist_name: 'Laura',
        verification_code: 'x',
        instagram_handle: '@laura.tattoo',
        expires_label: '72 horas',
        weotzi_instagram: '@weotzi',
        dm_url: 'https://ig.me/m/weotzi'
    });

    const rows = db.tables[TABLE];
    const created = rows.find((r) => r.id !== ROW_ID);
    assert.equal(options.idempotencyKey, `ig-verify:${ARTIST_ID}:${created.id}`);
    assert.equal(created.code_hash, hashCode(payload.verification_code));
    assert.equal(created.status, 'pending');
    assert.equal(created.email_sent, true);
    assert.equal(created.email_sent_to, 'laura@gmail.com');
    assert.ok(!Object.values(created).includes(payload.verification_code), 'the plain code is never stored');
    assert.equal(rows.find((r) => r.id === ROW_ID).status, 'cancelled');

    const code = payload.verification_code;
    assert.ok(!JSON.stringify(res.body).includes(code), 'the code is never echoed');
    assert.ok(!logs.join('\n').includes(code), 'the code is never logged');
});

test('POST cancels only older pending codes, never the newer one of an overlapping request', async (t) => {
    const OLDER_ID = '44444444-4444-4444-8444-444444444444';
    const NEWER_ID = '55555555-5555-4555-8555-555555555555';
    const db = createFakeDb({
        artists_db: [artistRow()],
        [TABLE]: [
            { id: OLDER_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR) },
            // La otra pestaña insertó su fila justo después que esta request.
            { id: NEWER_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', status: 'pending', created_at: iso(NOW + 1000), expires_at: iso(NOW + 72 * HOUR) }
        ]
    });
    withDeps(t, {
        pgrest: db.pgrest,
        resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }),
        sendEmail: async () => ({ ok: true, channel: 'n8n' })
    });
    const res = await call(svc.requestArtistVerification, fakeReq());
    assert.equal(res.statusCode, 200);
    const byId = (id) => db.tables[TABLE].find((r) => r.id === id);
    const created = db.tables[TABLE].find((r) => r.id !== OLDER_ID && r.id !== NEWER_ID);
    assert.equal(byId(OLDER_ID).status, 'cancelled');
    assert.equal(byId(OLDER_ID).note, 'Reemplazado por un código nuevo.');
    assert.equal(byId(NEWER_ID).status, 'pending', 'the newer overlapping code stays live');
    assert.equal(created.status, 'pending', 'its own row is never cancelled by its own request');
});

test('POST keeps the row and answers email_sent:false when the email fails', async (t) => {
    const db = createFakeDb({ artists_db: [artistRow()], [TABLE]: [] });
    withDeps(t, {
        pgrest: db.pgrest,
        resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }),
        sendEmail: async () => ({ ok: false, channel: 'none', error: 'Unknown eventId: instagram_verification_code' })
    });
    const res = await call(svc.requestArtistVerification, fakeReq({ body: { handle: '@Laura.Ink' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.email_sent, false);
    assert.equal(res.body.handle, 'laura.ink');
    assert.equal(db.tables[TABLE].length, 1);
    assert.equal(db.tables[TABLE][0].status, 'pending');
    assert.equal(db.tables[TABLE][0].email_sent, false);
});

test('GET returns the instagram state plus the DM instructions', async (t) => {
    const db = createFakeDb({
        artists_db: [artistRow({ gallery_feed_items: FEED })],
        [TABLE]: [{ id: ROW_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', status: 'pending', email_sent_to: 'laura@gmail.com', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR), code_hash: hashCode('WO-4F7K2Q') }]
    });
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }) });
    const res = await call(svc.getArtistVerification, fakeReq());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.pending_items, 3);
    assert.deepEqual(res.body.instructions, { account: 'weotzi', follow_url: 'https://www.instagram.com/weotzi/', dm_url: 'https://ig.me/m/weotzi' });
    for (const key of ['available', 'status', 'handle', 'verified_handle', 'verified_at', 'expires_at', 'email_masked', 'pending_items', 'legacy_items']) {
        assert.ok(key in res.body, `${key} must be in the response`);
    }
    assert.ok(!JSON.stringify(res.body).includes(hashCode('WO-4F7K2Q')), 'the hash is never exposed');
});

// --- Webhook ------------------------------------------------------------------------

function inboundDb(rowOverrides = {}) {
    return createFakeDb({
        artists_db: [artistRow({ gallery_feed_items: FEED })],
        [TABLE]: [{
            id: ROW_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', code_hash: hashCode('WO-4F7K2Q'),
            status: 'pending', attempts: 0, created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR), ...rowOverrides
        }]
    });
}

function inboundReq(body, token = 'hook-secret') {
    return fakeReq({ headers: { 'x-weotzi-webhook-token': token }, body });
}

test('webhook answers 503 without a configured secret and 401 with a wrong token', async (t) => {
    const db = inboundDb();
    const previous = process.env.IG_VERIFY_WEBHOOK_SECRET;
    delete process.env.IG_VERIFY_WEBHOOK_SECRET;
    t.after(() => { if (previous === undefined) delete process.env.IG_VERIFY_WEBHOOK_SECRET; else process.env.IG_VERIFY_WEBHOOK_SECRET = previous; });
    withDeps(t, { pgrest: db.pgrest, getSetting: async () => null });

    let res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' }));
    assert.equal(res.statusCode, 503);

    setDeps({ getSetting: async (key, opts) => (key === 'n8n_webhook_secret' && opts.envFallback === 'N8N_WEBHOOK_SECRET' ? 'hook-secret' : null) });
    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' }, 'wrong'));
    assert.equal(res.statusCode, 401);
    res = await call(svc.handleInbound, fakeReq({ body: { sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' } }));
    assert.equal(res.statusCode, 401);
    assert.equal(db.log.length, 0, 'nothing is read before the token is checked');
    assert.equal(db.tables[TABLE][0].status, 'pending');

    process.env.IG_VERIFY_WEBHOOK_SECRET = 'own-secret';
    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' }, 'hook-secret'));
    assert.equal(res.statusCode, 401, 'IG_VERIFY_WEBHOOK_SECRET wins over the n8n fallback');
});

test('webhook validates the account, patches only the verification columns and records the DM sender', async (t) => {
    const db = inboundDb();
    process.env.IG_VERIFY_WEBHOOK_SECRET = 'hook-secret';
    t.after(() => { delete process.env.IG_VERIFY_WEBHOOK_SECRET; });
    withDeps(t, { pgrest: db.pgrest });

    const res = await call(svc.handleInbound, inboundReq({ sender_username: '@Laura.Tattoo', message_text: 'hola!! mi código es wo-4f7k2q', follows_business: true }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, verified: true, reason: 'verified' });

    const row = db.tables[TABLE][0];
    assert.equal(row.status, 'verified');
    assert.equal(row.verified_via, 'dm_webhook');
    assert.equal(row.verified_at, iso(NOW));
    assert.equal(row.dm_sender_handle, 'laura.tattoo');

    const artistPatches = db.log.filter((entry) => entry.table === 'artists_db' && entry.op === 'patch');
    assert.equal(artistPatches.length, 1, 'artists_db must be patched once');
    // Solo las dos columnas: el trigger de la migración se dispara con ellas.
    // Reenviar gallery_feed_items desde una lectura previa podría pisar una
    // edición de la galería hecha en el medio.
    assert.deepEqual(artistPatches[0].values, { instagram_verified_at: iso(NOW), instagram_verified_handle: 'laura.tattoo' });
    assert.equal(db.log.filter((entry) => entry.table === 'artists_db' && entry.op === 'select').length, 0, 'the feed is not read to validate');
    assert.deepEqual(db.tables.artists_db[0].gallery_feed_items, FEED);
    const source = read('services/instagram-verification.js');
    const markVerified = source.slice(source.indexOf('async function markVerified'), source.indexOf('async function registerMismatch'));
    assert.doesNotMatch(markVerified, /gallery_feed_items\s*=|gallery_feed_items:/, 'markVerified never writes the feed');

    // El mismo DM repetido no valida dos veces.
    const again = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' }));
    assert.deepEqual(again.body, { success: true, verified: false, reason: 'code_not_pending' });
});

test('webhook: a delivery that loses the claim answers the documented code_not_pending', async (t) => {
    const db = inboundDb();
    process.env.IG_VERIFY_WEBHOOK_SECRET = 'hook-secret';
    t.after(() => { delete process.env.IG_VERIFY_WEBHOOK_SECRET; });
    // Otra entrega del mismo DM valida la fila entre la búsqueda y el reclamo.
    const racing = (table) => {
        const q = db.pgrest(table);
        if (table !== TABLE) return q;
        const execute = q.execute;
        q.execute = async () => {
            const out = await execute();
            db.tables[TABLE][0].status = 'verified';
            return out;
        };
        return q;
    };
    withDeps(t, { pgrest: racing });
    const res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q', follows_business: true }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'code_not_pending' });
    assert.equal(db.log.filter((entry) => entry.table === 'artists_db').length, 0, 'the loser does not touch artists_db');
});

test('validating stores the handle lowercase and without @ whatever the row spelling', async (t) => {
    const db = supportDb();
    db.tables[TABLE][0].ig_handle = '@Laura.Tattoo';
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: AGENT_ID, email: 'soporte@weotzi.test' }) });
    const res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { force: true } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ig_handle, 'laura.tattoo');
    assert.equal(db.tables.artists_db[0].instagram_verified_handle, 'laura.tattoo');
    const patch = db.log.find((entry) => entry.table === 'artists_db' && entry.op === 'patch');
    assert.deepEqual(Object.keys(patch.values).sort(), ['instagram_verified_at', 'instagram_verified_handle']);
});

test('webhook rejects other senders, missing follows and expired codes', async (t) => {
    process.env.IG_VERIFY_WEBHOOK_SECRET = 'hook-secret';
    t.after(() => { delete process.env.IG_VERIFY_WEBHOOK_SECRET; });

    let db = inboundDb();
    withDeps(t, { pgrest: db.pgrest });
    let res = await call(svc.handleInbound, inboundReq({ sender_username: 'otra.cuenta', message_text: 'WO-4F7K2Q' }));
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'handle_mismatch' });
    assert.equal(db.tables[TABLE][0].status, 'pending');
    assert.equal(db.tables[TABLE][0].attempts, 1);
    assert.equal(db.tables[TABLE][0].dm_sender_handle, 'otra.cuenta');

    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q', follows_business: false }));
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'not_following' });
    assert.equal(db.tables[TABLE][0].status, 'pending');

    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'hola' }));
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'no_code' });
    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-ABCDEF' }));
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'code_not_found' });

    db = inboundDb({ expires_at: iso(NOW - HOUR) });
    setDeps({ pgrest: db.pgrest });
    res = await call(svc.handleInbound, inboundReq({ sender_username: 'laura.tattoo', message_text: 'WO-4F7K2Q' }));
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'code_expired' });
    assert.equal(db.tables[TABLE][0].status, 'expired');
    assert.equal(db.log.filter((e) => e.table === 'artists_db').length, 0);
});

// --- Soporte ------------------------------------------------------------------------

function supportDb(extra = {}) {
    return createFakeDb({
        support_users_db: [{ user_id: AGENT_ID, email: 'soporte@weotzi.test', full_name: 'Soporte', role: 'support', is_active: true }],
        artists_db: [artistRow({ gallery_feed_items: FEED })],
        [TABLE]: [{
            id: ROW_ID, artist_user_id: ARTIST_ID, ig_handle: 'laura.tattoo', code_hash: hashCode('WO-4F7K2Q'), status: 'pending',
            attempts: 0, email_sent: true, email_sent_to: 'laura@gmail.com', created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR)
        }],
        ...extra
    });
}

test('support endpoints require an active support agent', async (t) => {
    const db = supportDb();
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => null });
    assert.equal((await call(svc.listForSupport, fakeReq())).statusCode, 401);
    setDeps({ resolveBearerUser: async () => ({ id: ARTIST_ID, email: 'laura@gmail.com' }) });
    const res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { force: true } }));
    assert.equal(res.statusCode, 403);
    assert.equal(db.tables[TABLE][0].status, 'pending');
    const agent = await svc.resolveSupportAgent(fakeReq());
    assert.equal(agent.ok, false);
    setDeps({ resolveBearerUser: async () => ({ id: AGENT_ID, email: 'soporte@weotzi.test', raw: { id: AGENT_ID } }) });
    const ok = await svc.resolveSupportAgent(fakeReq());
    assert.equal(ok.ok, true);
    assert.equal(ok.supportUserId, AGENT_ID);
});

test('support list returns the queue with masked emails and pending photo counts', async (t) => {
    const db = supportDb();
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: AGENT_ID, email: 'soporte@weotzi.test' }) });
    const res = await call(svc.listForSupport, fakeReq({ query: { status: 'pending' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 1);
    const item = res.body.items[0];
    assert.equal(item.id, ROW_ID);
    assert.equal(item.artist_name, 'Laura');
    assert.equal(item.username, 'laura.wo');
    assert.equal(item.ig_handle, 'laura.tattoo');
    assert.equal(item.email_masked, 'la•••a@gmail.com');
    assert.equal(item.pending_items, 3);
    assert.ok(!('code_hash' in item));
    assert.equal((await call(svc.listForSupport, fakeReq({ query: { status: 'verified' } }))).body.items.length, 0);
    assert.equal((await call(svc.listForSupport, fakeReq({ query: { status: 'raro' } }))).statusCode, 400);
});

test('support confirm needs the right code or force and marks the artist as validated', async (t) => {
    const db = supportDb();
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: AGENT_ID, email: 'soporte@weotzi.test' }) });
    let res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: {} }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'IG_CODE_REQUIRED');
    res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { code: 'WO-ABCDEF' } }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'IG_CODE_MISMATCH');
    res = await call(svc.confirmForSupport, fakeReq({ params: { id: 'no-uuid' }, body: { force: true } }));
    assert.equal(res.statusCode, 400);

    res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { code: 'wo4f7k2q', note: 'Vimos el DM.' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'verified');
    const row = db.tables[TABLE][0];
    assert.equal(row.verified_via, 'support');
    assert.equal(row.verified_by, AGENT_ID);
    assert.equal(row.note, 'Vimos el DM.');
    assert.equal(db.tables.artists_db[0].instagram_verified_handle, 'laura.tattoo');
    assert.equal(db.tables.artists_db[0].instagram_verified_at, iso(NOW));

    res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { force: true } }));
    assert.equal(res.statusCode, 409);
});

test('support can force an expired code and reject pending ones', async (t) => {
    const db = supportDb();
    db.tables[TABLE][0].expires_at = iso(NOW - HOUR);
    withDeps(t, { pgrest: db.pgrest, resolveBearerUser: async () => ({ id: AGENT_ID, email: 'soporte@weotzi.test' }) });
    let res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { code: 'WO-4F7K2Q' } }));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'IG_CODE_EXPIRED');
    res = await call(svc.confirmForSupport, fakeReq({ params: { id: ROW_ID }, body: { force: true } }));
    assert.equal(res.statusCode, 200);
    assert.equal(db.tables[TABLE][0].status, 'verified');

    const other = supportDb();
    setDeps({ pgrest: other.pgrest });
    res = await call(svc.rejectForSupport, fakeReq({ params: { id: ROW_ID }, body: { note: 'El DM vino de otra cuenta.' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, id: ROW_ID, status: 'rejected' });
    assert.equal(other.tables[TABLE][0].status, 'rejected');
    assert.equal(other.tables[TABLE][0].note, 'El DM vino de otra cuenta.');
    res = await call(svc.rejectForSupport, fakeReq({ params: { id: ROW_ID }, body: {} }));
    assert.equal(res.statusCode, 409);
    res = await call(svc.rejectForSupport, fakeReq({ params: { id: '44444444-4444-4444-8444-444444444444' }, body: {} }));
    assert.equal(res.statusCode, 404);
});

// --- server.js ---------------------------------------------------------------------

test('server.js mounts the new routes before the legacy redirects and the SPA catch-all', () => {
    const server = read('server.js');
    const routes = [
        "app.get('/api/artist/onboarding', artistOnboarding.getOnboarding)",
        "app.post('/api/artist/onboarding', artistOnboarding.patchOnboarding)",
        "app.get('/api/artist/instagram-verification', igVerification.getArtistVerification)",
        "app.post('/api/artist/instagram-verification', igVerifyLimiter, igVerification.requestArtistVerification)",
        "app.post('/api/instagram-verification/inbound', igVerification.handleInbound)",
        "app.get('/api/support/instagram-verifications', igVerification.listForSupport)",
        "app.post('/api/support/instagram-verifications/:id/confirm', igVerification.confirmForSupport)",
        "app.post('/api/support/instagram-verifications/:id/reject', igVerification.rejectForSupport)"
    ];
    const commit = server.indexOf("app.post('/api/instagram/commit'");
    const emailRouting = server.indexOf('// EMAIL ROUTING (BillionMail');
    const legacy = server.indexOf('legacyRedirectFor(req.path');
    const spa = server.indexOf("app.get('*'");
    assert.ok(commit > -1 && emailRouting > commit && legacy > emailRouting && spa > legacy);
    for (const route of routes) {
        const at = server.indexOf(route);
        assert.ok(at > commit && at < emailRouting, `${route} must live between the IG commit route and EMAIL ROUTING`);
        assert.ok(at < legacy && at < spa, `${route} must be declared before the legacy redirects and app.get('*')`);
    }
    assert.match(server, /const igVerification = require\('\.\/services\/instagram-verification'\);/);
    assert.match(server, /const artistOnboarding = require\('\.\/services\/artist-onboarding'\);/);
    assert.match(server, /const igVerifyLimiter = rateLimit\(\{\s*windowMs: 60 \* 60 \* 1000,\s*max: 5,\s*standardHeaders: true,\s*legacyHeaders: false,/);
});

test('the inbound webhook checks the token before reading anything', () => {
    const source = read('services/instagram-verification.js');
    const start = source.indexOf('async function handleInboundHandler');
    const end = source.indexOf('// --- Cola de soporte', start);
    const handler = source.slice(start, end);
    assert.ok(start > -1 && end > start);
    assert.match(handler, /req\.headers\['x-weotzi-webhook-token'\]/);
    assert.ok(handler.indexOf('safeEqual(') > -1);
    assert.ok(handler.indexOf('safeEqual(') < handler.indexOf('extractCodes('));
    assert.ok(handler.indexOf('safeEqual(') < handler.indexOf('deps.pgrest('));
    assert.match(source, /process\.env\.IG_VERIFY_WEBHOOK_SECRET/);
    assert.match(source, /getSetting\('n8n_webhook_secret', \{ envFallback: 'N8N_WEBHOOK_SECRET' \}\)/);
    assert.match(read('.env.example'), /^IG_VERIFY_WEBHOOK_SECRET=\r?$/m);
});
