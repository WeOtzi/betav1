'use strict';

// Ronda 3b · grupo "gcal": Google Calendar real para artistas.
// Todo con fetch de Google simulado y una base en memoria: ningún test sale a la red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const oauth = require('../lib/gcal-oauth');
const sync = require('../lib/gcal-sync');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const ENV = {
    GOOGLE_OAUTH_CLIENT_ID: 'cliente-demo.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-demo',
    GCAL_TOKEN_ENC_KEY: KEY_B64,
};
const USER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

function idToken(payload) {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'RS256' })}.${enc(payload)}.firma`;
}

/* --------------------------- doble de la base --------------------------- */
function memoryDb(seed = {}) {
    const state = {
        connections: new Map(),
        links: new Map(),
        busy: new Map(),
        manual: seed.manual || [],
        sessions: seed.sessions || [],
        trips: seed.trips || [],
        integration: [],
        sourceIds: [],
        artists: new Set(seed.artists || [USER]),
    };
    const db = {
        state,
        async isArtist(uid) { return state.artists.has(uid); },
        async getConnection(uid) { return state.connections.has(uid) ? { ...state.connections.get(uid) } : null; },
        async listActiveConnections() { return [...state.connections.values()].filter((c) => !c.needs_reauth).map((c) => ({ user_id: c.user_id })); },
        async saveConnection(row) { state.connections.set(row.user_id, { ...(state.connections.get(row.user_id) || {}), ...row }); },
        async updateConnection(uid, patch) { if (state.connections.has(uid)) state.connections.set(uid, { ...state.connections.get(uid), ...patch }); },
        async deleteConnection(uid) {
            state.connections.delete(uid);
            [...state.links.keys()].filter((k) => k.startsWith(`${uid}|`)).forEach((k) => state.links.delete(k));
            state.busy.delete(uid);
        },
        async listLinks(uid) { return [...state.links.entries()].filter(([k]) => k.startsWith(`${uid}|`)).map(([, v]) => ({ ...v })); },
        async upsertLink(row) { state.links.set(`${row.user_id}|${row.source_key}`, { ...row }); },
        async deleteLink(uid, key) { state.links.delete(`${uid}|${key}`); },
        async listManualEvents() { return state.manual; },
        async listSessions() { return state.sessions; },
        async listTrips() { return state.trips; },
        async setSourceGoogleId(source, id) { state.sourceIds.push([source.key, id]); },
        async replaceBusy(uid, blocks) { state.busy.set(uid, blocks); return blocks.length; },
        async getTimezone() { return 'America/Argentina/Buenos_Aires'; },
        async markIntegration(uid, status, email) { state.integration.push({ uid, status, email }); },
    };
    return db;
}

/* --------------------------- doble de Google ---------------------------- */
function fakeGoogle(opts = {}) {
    const calls = [];
    let n = 0;
    const g = {
        calls,
        events: new Map(),
        async exchangeCode(code, verifier) {
            calls.push(['exchange', code, verifier]);
            if (opts.exchangeError) throw new oauth.GcalError('invalid_grant', 'x', 400);
            return {
                access_token: 'ya29.ACCESO',
                refresh_token: opts.noRefresh ? undefined : '1//REFRESH-SECRETO',
                expires_in: 3599,
                scope: opts.scope || `openid https://www.googleapis.com/auth/userinfo.email ${oauth.CALENDAR_SCOPE}`,
                id_token: idToken({ iss: 'https://accounts.google.com', aud: ENV.GOOGLE_OAUTH_CLIENT_ID, email: opts.email || 'Artista@Gmail.com' }),
            };
        },
        async refreshAccessToken(rt) {
            calls.push(['refresh', rt]);
            if (opts.refreshError) throw new oauth.GcalError('invalid_grant', 'x', 400);
            return { access_token: 'ya29.NUEVO', expires_in: 3599 };
        },
        async revoke(token) { calls.push(['revoke', token]); return true; },
        async insertEvent(token, cal, body) {
            n += 1;
            const id = `g${n}`;
            g.events.set(id, body);
            calls.push(['insert', id, body.extendedProperties.private.weotzi_source]);
            return { id };
        },
        async updateEvent(token, cal, id, body) {
            calls.push(['update', id]);
            if (!g.events.has(id)) throw new oauth.GcalError('notFound', 'x', 404);
            g.events.set(id, body);
            return { id };
        },
        async deleteEvent(token, cal, id) { calls.push(['delete', id]); g.events.delete(id); },
        async listEvents() {
            calls.push(['list']);
            return {
                items: opts.items || [
                    { id: 'ajeno-1', status: 'confirmed', start: { dateTime: '2026-11-20T13:00:00Z' }, end: { dateTime: '2026-11-20T15:00:00Z' } },
                    { id: 'ajeno-2', status: 'confirmed', start: { date: '2026-11-22' }, end: { date: '2026-11-23' } },
                    { id: 'libre', status: 'confirmed', transparency: 'transparent', start: { dateTime: '2026-11-21T13:00:00Z' }, end: { dateTime: '2026-11-21T14:00:00Z' } },
                    { id: 'cancelado', status: 'cancelled', start: { dateTime: '2026-11-21T13:00:00Z' }, end: { dateTime: '2026-11-21T14:00:00Z' } },
                    { id: 'nuestro', status: 'confirmed', extendedProperties: { private: { weotzi: '1' } }, start: { dateTime: '2026-11-24T13:00:00Z' }, end: { dateTime: '2026-11-24T14:00:00Z' } },
                ],
            };
        },
    };
    return g;
}

const NOW = Date.parse('2026-11-13T12:00:00Z');
const silent = { warn() {}, error() {}, log() {} };

function service(db, google, env = ENV) {
    return sync.createGcalService({ cfg: oauth.gcalConfig(env), google, db, now: () => NOW, log: silent, baseUrl: 'https://beta.weotzi.com' });
}

/* -------------------------------- config -------------------------------- */

test('gcalConfig: sin variables no está configurado y no expone valores', () => {
    const cfg = oauth.gcalConfig({});
    assert.equal(cfg.configured, false);
    assert.deepEqual(cfg.missing.sort(), ['GCAL_TOKEN_ENC_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']);
    assert.equal(cfg.redirectUri, 'https://beta.weotzi.com/api/google-calendar/callback');
});

test('gcalConfig: la clave tiene que ser de 32 bytes en base64', () => {
    assert.equal(oauth.gcalConfig({ ...ENV, GCAL_TOKEN_ENC_KEY: Buffer.alloc(16).toString('base64') }).configured, false);
    const ok = oauth.gcalConfig(ENV);
    assert.equal(ok.configured, true);
    assert.equal(ok.key.length, 32);
    assert.notDeepEqual(ok.stateKey, ok.key, 'el state usa una subclave derivada');
});

test('accountReturnPath respeta la base de la URI de redirect', () => {
    assert.equal(oauth.accountReturnPath(oauth.gcalConfig(ENV), 'ok'), '/artist/account/#disponibilidad?gcal=ok');
    const beta = oauth.gcalConfig({ ...ENV, GOOGLE_OAUTH_REDIRECT_URI: 'https://weotzi.com/beta/api/google-calendar/callback' });
    assert.equal(oauth.accountReturnPath(beta, 'error', 'denied'), '/beta/artist/account/#disponibilidad?gcal=error&reason=denied');
});

/* ------------------------------- cifrado -------------------------------- */

test('encryptToken/decryptToken: AES-256-GCM ligado al usuario', () => {
    const key = oauth.gcalConfig(ENV).key;
    const blob = oauth.encryptToken('1//REFRESH-SECRETO', key, USER);
    assert.match(blob, /^v1:/);
    assert.ok(!blob.includes('REFRESH'));
    assert.equal(oauth.decryptToken(blob, key, USER), '1//REFRESH-SECRETO');
    assert.throws(() => oauth.decryptToken(blob, key, OTHER), /conexión guardada/);
    const parts = blob.split(':');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    assert.throws(() => oauth.decryptToken(parts.join(':'), key, USER));
    assert.notEqual(oauth.encryptToken('x', key, USER), oauth.encryptToken('x', key, USER), 'IV aleatorio');
});

/* ---------------------------- state + PKCE ------------------------------ */

test('state firmado: liga usuario, nonce de cookie, PKCE y vencimiento', () => {
    const cfg = oauth.gcalConfig(ENV);
    const { state, nonce, codeChallenge } = oauth.createState(cfg, USER, { now: NOW });
    const ok = oauth.verifyState(cfg, state, nonce, { now: NOW + 1000 });
    assert.equal(ok.userId, USER);
    const expected = crypto.createHash('sha256').update(ok.codeVerifier).digest('base64url');
    assert.equal(codeChallenge, expected);
    assert.throws(() => oauth.verifyState(cfg, state, 'otro-nonce', { now: NOW }), (e) => e.code === 'state');
    assert.throws(() => oauth.verifyState(cfg, state, null, { now: NOW }), (e) => e.code === 'state');
    assert.throws(() => oauth.verifyState(cfg, state, nonce, { now: NOW + oauth.STATE_TTL_MS + 1 }), (e) => e.code === 'state_expired');
    assert.throws(() => oauth.verifyState(cfg, `${state.slice(0, -3)}abc`, nonce, { now: NOW }), (e) => e.code === 'state');
    const otherCfg = oauth.gcalConfig({ ...ENV, GCAL_TOKEN_ENC_KEY: Buffer.alloc(32, 9).toString('base64') });
    assert.throws(() => oauth.verifyState(otherCfg, state, nonce, { now: NOW }), (e) => e.code === 'state');
});

test('buildAuthorizeUrl: scope mínimo, offline, consent y PKCE S256', () => {
    const cfg = oauth.gcalConfig(ENV);
    const url = new URL(oauth.buildAuthorizeUrl(cfg, { state: 'st', codeChallenge: 'ch' }));
    assert.equal(url.origin + url.pathname, oauth.AUTH_ENDPOINT);
    const p = url.searchParams;
    assert.equal(p.get('scope'), 'openid email https://www.googleapis.com/auth/calendar.events');
    assert.equal(p.get('access_type'), 'offline');
    assert.equal(p.get('prompt'), 'consent');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.equal(p.get('redirect_uri'), cfg.redirectUri);
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.has('client_secret'), false);
});

test('cookies: lectura y atributos httpOnly/SameSite/Secure', () => {
    assert.equal(oauth.readCookie('a=1; wo_gcal_oauth=abc%2D1; b=2', 'wo_gcal_oauth'), 'abc-1');
    assert.equal(oauth.readCookie('', 'wo_gcal_oauth'), null);
    const c = oauth.nonceCookie('n1', { secure: true });
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.match(oauth.nonceCookie('', { clear: true, secure: false }), /Max-Age=0/);
});

test('emailFromIdToken valida aud e iss', () => {
    const good = idToken({ iss: 'https://accounts.google.com', aud: 'cid', email: 'A@B.com' });
    assert.equal(oauth.emailFromIdToken(good, 'cid'), 'a@b.com');
    assert.equal(oauth.emailFromIdToken(good, 'otro'), null);
    assert.equal(oauth.emailFromIdToken(idToken({ iss: 'https://evil', aud: 'cid', email: 'x' }), 'cid'), null);
    assert.equal(oauth.emailFromIdToken('basura', 'cid'), null);
});

/* --------------------------- cliente HTTP ------------------------------- */

test('createGoogleClient: intercambio con code_verifier y errores sin tokens', async () => {
    const seen = [];
    const fetchMock = async (url, init) => {
        seen.push({ url, init });
        if (url === oauth.TOKEN_ENDPOINT) {
            const body = new URLSearchParams(init.body);
            if (body.get('grant_type') === 'refresh_token') {
                return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 });
            }
            return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: oauth.CALENDAR_SCOPE }), { status: 200 });
        }
        if (url.startsWith(oauth.REVOKE_ENDPOINT)) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 });
        if (init.method === 'DELETE') return new Response('', { status: 410 });
        if (init.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
        return new Response(JSON.stringify({ id: 'evt1' }), { status: 200 });
    };
    const g = oauth.createGoogleClient({ fetch: fetchMock, cfg: oauth.gcalConfig(ENV) });
    const tokens = await g.exchangeCode('CODIGO', 'VERIFICADOR');
    assert.equal(tokens.refresh_token, 'r');
    const sent = new URLSearchParams(seen[0].init.body);
    assert.equal(sent.get('code_verifier'), 'VERIFICADOR');
    assert.equal(sent.get('grant_type'), 'authorization_code');
    await assert.rejects(g.refreshAccessToken('1//SECRETO'), (err) => err.code === 'invalid_grant' && !err.message.includes('SECRETO'));
    assert.equal(await g.revoke('ya-revocado'), true, 'invalid_token al revocar cuenta como éxito');
    await g.deleteEvent('a', 'primary', 'gone'); // 410 no lanza
    assert.equal(typeof g.listEvents, 'undefined', 'solo de ida: el cliente no lee el calendario de Google');
});

/* ------------------------------ zonas ----------------------------------- */

test('zonedMidnightUtc / zonedDate en Buenos Aires', () => {
    assert.equal(sync.zonedMidnightUtc('2026-11-20', 'America/Argentina/Buenos_Aires'), '2026-11-20T03:00:00.000Z');
    assert.equal(sync.zonedDate('2026-11-20T02:30:00Z', 'America/Argentina/Buenos_Aires'), '2026-11-19');
    assert.equal(sync.zonedMidnightUtc('2026-03-29', 'Europe/Madrid'), '2026-03-28T23:00:00.000Z');
});

test('buildGoogleEvent: todo el día, horario con zona y repetición semanal', () => {
    const tz = 'America/Argentina/Buenos_Aires';
    const allDay = sync.normalizeManual({
        id: 'a1', event_type: 'blocked_day', title: 'Bloqueo', starts_at: '2026-11-20T03:00:00Z',
        ends_at: '2026-11-23T02:59:59.999Z', all_day: true, status: 'scheduled', recurrence_rule: 'none',
    });
    const body = sync.buildGoogleEvent(allDay, { tz, baseUrl: 'https://beta.weotzi.com' });
    assert.deepEqual(body.start, { date: '2026-11-20' });
    assert.deepEqual(body.end, { date: '2026-11-23' });
    assert.equal(body.extendedProperties.private.weotzi, '1');
    assert.equal(body.extendedProperties.private.weotzi_source, 'event:a1');

    const weekly = sync.normalizeManual({
        id: 'w1', event_type: 'personal', title: 'Gym', starts_at: '2026-11-17T21:00:00Z', ends_at: '2026-11-17T22:00:00Z',
        all_day: false, status: 'scheduled', recurrence_rule: 'weekly', recurrence_until: '2026-12-15',
    });
    const wb = sync.buildGoogleEvent(weekly, { tz });
    assert.equal(wb.start.timeZone, tz);
    assert.deepEqual(wb.recurrence, ['RRULE:FREQ=WEEKLY;UNTIL=20261216T025959Z']);

    assert.equal(sync.normalizeManual({ id: 'r', event_type: 'reminder', title: 'x', starts_at: '2026-11-17T21:00:00Z', ends_at: '2026-11-17T22:00:00Z' }), null);
    assert.equal(sync.normalizeManual({ id: 'c', event_type: 'personal', status: 'cancelled', title: 'x', starts_at: '2026-11-17T21:00:00Z', ends_at: '2026-11-17T22:00:00Z' }), null);
    assert.equal(sync.normalizeSession({ id: 5, status: 'cancelled', session_date: '2026-11-17T21:00:00Z' }, null), null);
    const s = sync.normalizeSession({ id: 5, quotation_id: 9, session_date: '2026-11-17T21:00:00Z', duration_hours: 3 }, { quote_id: 'WO-9', client_full_name: 'Lucía' }, 'https://beta.weotzi.com');
    assert.equal(s.key, 'session:5');
    assert.equal(s.endsAt, '2026-11-18T00:00:00.000Z');
    assert.match(s.description, /my-quotations\/detail\?id=9/);
});

test('planPush: crea, actualiza solo lo que cambió y borra lo que ya no está', () => {
    const plan = sync.planPush(
        [{ key: 'event:a', hash: 'h1' }, { key: 'event:b', hash: 'h2-nuevo' }, { key: 'session:1', hash: 'h3' }],
        [
            { source_key: 'event:b', google_event_id: 'gb', content_hash: 'h2' },
            { source_key: 'session:1', google_event_id: 'gs', content_hash: 'h3' },
            { source_key: 'event:viejo', google_event_id: 'gv', content_hash: 'hx' },
        ]
    );
    assert.deepEqual(plan.create.map((s) => s.key), ['event:a']);
    assert.deepEqual(plan.update.map((s) => [s.key, s.googleEventId]), [['event:b', 'gb']]);
    assert.deepEqual(plan.remove.map((l) => l.google_event_id), ['gv']);
});

test('solo de ida: no se importa nada de Google', () => {
    assert.equal(sync.googleItemToBusy, undefined);
    const src = read('lib/gcal-sync.js');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/listEvents|replaceBusy|artist_google_calendar_busy/.test(code), 'el servicio no lee Google');
});

/* ------------------------------ servicio -------------------------------- */

test('sin configurar: authorize/status/disconnect/sync responden 503', async () => {
    const svc = service(memoryDb(), fakeGoogle(), {});
    for (const call of [() => svc.authorize(USER), () => svc.status(USER), () => svc.disconnect(USER), () => svc.requestSync(USER), () => svc.runAll()]) {
        await assert.rejects(call(), (err) => err.status === 503 && err.message === 'Google Calendar no está configurado');
    }
    assert.deepEqual(await svc.callback({ code: 'c', state: 's' }, 'n'), { ok: false, reason: 'config' });
});

test('authorize: solo artistas; devuelve URL de Google y nonce', async () => {
    const svc = service(memoryDb(), fakeGoogle());
    const { url, nonce } = await svc.authorize(USER);
    assert.ok(url.startsWith(oauth.AUTH_ENDPOINT));
    assert.ok(nonce.length > 10);
    await assert.rejects(svc.authorize(OTHER), (err) => err.status === 403);
    await assert.rejects(svc.authorize(null), (err) => err.status === 401);
});

test('callback: guarda el refresh token cifrado y marca la integración', async () => {
    const db = memoryDb();
    const google = fakeGoogle();
    const svc = service(db, google);
    const { url, nonce } = await svc.authorize(USER);
    const state = new URL(url).searchParams.get('state');
    const res = await svc.callback({ code: 'CODIGO', state }, nonce);
    assert.equal(res.ok, true);
    assert.equal(res.email, 'artista@gmail.com');
    const conn = db.state.connections.get(USER);
    assert.ok(conn.refresh_token_enc.startsWith('v1:'));
    assert.ok(!JSON.stringify(conn).includes('REFRESH-SECRETO'), 'el token nunca queda en claro');
    assert.equal(oauth.decryptToken(conn.refresh_token_enc, oauth.gcalConfig(ENV).key, USER), '1//REFRESH-SECRETO');
    assert.equal(conn.calendar_id, 'primary');
    assert.deepEqual(db.state.integration.at(-1), { uid: USER, status: 'connected', email: 'artista@gmail.com' });
    const ex = google.calls.find((c) => c[0] === 'exchange');
    assert.ok(ex[2] && ex[2].length >= 43, 'manda el code_verifier PKCE');
    const st = await svc.status(USER);
    assert.equal(st.connected, true);
    assert.equal(st.google_email, 'artista@gmail.com');
    assert.equal('refresh_token_enc' in st, false);
});

test('callback: rechazos (denegado, state/cookie, scope destildado, sin refresh token)', async () => {
    const db = memoryDb();
    const svc = service(db, fakeGoogle());
    assert.equal((await svc.callback({ error: 'access_denied' }, null)).reason, 'denied');
    const { url, nonce } = await svc.authorize(USER);
    const state = new URL(url).searchParams.get('state');
    assert.equal((await svc.callback({ code: 'c', state }, 'otra-cookie')).reason, 'state');

    const scoped = fakeGoogle({ scope: 'openid email' });
    const svc2 = service(db, scoped);
    const a2 = await svc2.authorize(USER);
    const r2 = await svc2.callback({ code: 'c', state: new URL(a2.url).searchParams.get('state') }, a2.nonce);
    assert.equal(r2.reason, 'scope');
    assert.ok(scoped.calls.some((c) => c[0] === 'revoke'), 'revoca lo concedido si falta el calendario');

    const svc3 = service(db, fakeGoogle({ noRefresh: true }));
    const a3 = await svc3.authorize(USER);
    assert.equal((await svc3.callback({ code: 'c', state: new URL(a3.url).searchParams.get('state') }, a3.nonce)).reason, 'token');
    assert.equal(db.state.connections.size, 0);
});

async function connected(seed, googleOpts) {
    const db = memoryDb(seed);
    const google = fakeGoogle(googleOpts);
    const svc = service(db, google);
    const { url, nonce } = await svc.authorize(USER);
    await svc.callback({ code: 'c', state: new URL(url).searchParams.get('state') }, nonce);
    return { db, google, svc };
}

const MANUAL = [
    { id: 'aaaa-1', event_type: 'blocked_day', title: 'Bloqueo', starts_at: '2026-11-20T03:00:00Z', ends_at: '2026-11-21T03:00:00Z', all_day: true, status: 'scheduled', recurrence_rule: 'none' },
    { id: 'aaaa-2', event_type: 'personal', title: 'Dentista', starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z', all_day: false, status: 'scheduled', recurrence_rule: 'none' },
];
const SESSIONS = [{ session: { id: 7, quotation_id: 3, session_date: '2026-11-19T17:00:00Z', duration_hours: 2, status: 'scheduled' }, quote: { quote_id: 'WO-3', client_full_name: 'Lucía' } }];

test('syncUser: push crea/actualiza/borra con google_event_id sin leer el calendario de Google', async () => {
    const { db, google, svc } = await connected({ manual: MANUAL.map((r) => ({ ...r })), sessions: SESSIONS });
    const r1 = await svc.syncUser(USER);
    assert.deepEqual(r1.pushed, { created: 3, updated: 0, removed: 0, failed: 0, deferred: 0 });
    assert.equal(r1.pulled, undefined);
    assert.ok(!google.calls.some((c) => c[0] === 'list'), 'nunca lista eventos de Google');
    assert.equal(db.state.busy.size, 0);
    assert.equal(db.state.sourceIds.length, 3, 'escribe google_event_id en la fila de origen');
    assert.ok(db.state.connections.get(USER).last_sync_at);
    assert.equal(db.state.connections.get(USER).last_error, null);

    // Segunda corrida sin cambios: no escribe nada en Google.
    const before = google.calls.filter((c) => ['insert', 'update', 'delete'].includes(c[0])).length;
    const r2 = await svc.syncUser(USER);
    assert.deepEqual(r2.pushed, { created: 0, updated: 0, removed: 0, failed: 0, deferred: 0 });
    assert.equal(google.calls.filter((c) => ['insert', 'update', 'delete'].includes(c[0])).length, before);

    // Cambia un título y se borra un evento: 1 update + 1 delete.
    db.state.manual[1].title = 'Dentista (control)';
    db.state.manual.splice(0, 1);
    const r3 = await svc.syncUser(USER);
    assert.equal(r3.pushed.updated, 1);
    assert.equal(r3.pushed.removed, 1);
    assert.equal(db.state.links.size, 2);
});

test('syncUser: si borraron el evento en Google, lo vuelve a crear', async () => {
    const { db, google, svc } = await connected({ manual: [{ ...MANUAL[1] }] });
    await svc.syncUser(USER);
    google.events.clear();
    db.state.manual[0].title = 'Otro título';
    const r = await svc.syncUser(USER);
    assert.equal(r.pushed.updated, 1);
    assert.ok(google.calls.filter((c) => c[0] === 'insert').length === 2);
});

test('syncUser: invalid_grant marca needs_reauth y el job lo saltea', async () => {
    const { db, svc } = await connected({}, { refreshError: true });
    // El access token del callback sigue en caché: lo vencemos con un servicio nuevo.
    const svc2 = service(db, fakeGoogle({ refreshError: true }));
    const r = await svc2.syncUser(USER);
    assert.equal(r.error, 'invalid_grant');
    const conn = db.state.connections.get(USER);
    assert.equal(conn.needs_reauth, true);
    assert.match(conn.last_error, /Volvé a conectar/);
    assert.ok(!conn.last_error.includes('REFRESH'));
    assert.deepEqual(await svc2.runAll(), { users: 0, ok: 0, failed: 0 });
    assert.ok(svc);
});

test('requestSync: freno de 20 s por artista', async () => {
    const { svc } = await connected({});
    const first = await svc.requestSync(USER);
    assert.ok(first.pushed);
    assert.deepEqual(await svc.requestSync(USER), { throttled: true });
});

test('disconnect: revoca el token descifrado en Google y borra en cascada', async () => {
    const { db, google, svc } = await connected({ manual: [{ ...MANUAL[1] }] });
    await svc.syncUser(USER);
    const res = await svc.disconnect(USER);
    assert.deepEqual(res, { disconnected: true, revoked: true, hadConnection: true });
    assert.deepEqual(google.calls.filter((c) => c[0] === 'revoke').at(-1), ['revoke', '1//REFRESH-SECRETO']);
    assert.equal(db.state.connections.size, 0);
    assert.equal(db.state.links.size, 0);
    assert.equal(db.state.busy.has(USER), false);
    assert.equal(db.state.integration.at(-1).status, 'disconnected');
    assert.deepEqual(await svc.status(USER), { connected: false });
});

test('syncJobEnabled: GCAL_SYNC_JOB=off lo apaga', () => {
    assert.equal(sync.syncJobEnabled({}), true);
    assert.equal(sync.syncJobEnabled({ GCAL_SYNC_JOB: 'OFF' }), false);
});

/* --------------------------- contrato estático -------------------------- */

test('server.js: bloque gcal con las rutas, 503 y sin logs de tokens', () => {
    const src = read('server.js');
    const start = src.indexOf('// ── gcal ──');
    const end = src.indexOf('// ── fin gcal ──');
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    for (const route of ["app.get('/api/google-calendar/status'", "app.get('/api/google-calendar/authorize'", "app.get('/api/google-calendar/callback'", "app.post('/api/google-calendar/disconnect'", "app.post('/api/google-calendar/sync'"]) {
        assert.ok(block.includes(route), route);
    }
    assert.match(block, /status\(503\)/);
    assert.match(block, /require\.main === module && gcalCfg\.configured && gcalSync\.syncJobEnabled\(\)/);
    assert.ok(!/console\.\w+\([^)]*(refresh_token|access_token|tokens)/.test(block));
    assert.match(block, /Referrer-Policy/);
});

test('migración 20261113102000: tablas con RLS, tokens solo service_role y reversa', () => {
    const sql = read('supabase/migrations/20261113102000_google_calendar_sync.sql');
    assert.match(sql, /create table if not exists public\.artist_google_calendar_connections/);
    assert.match(sql, /revoke all on table public\.artist_google_calendar_connections from public, anon, authenticated/);
    assert.ok(!/create policy[^;]*artist_google_calendar_connections/.test(sql), 'sin policies: nadie salvo service_role lee tokens');
    assert.match(sql, /alter table public\.artist_google_calendar_connections enable row level security/);
    assert.match(sql, /alter table public\.artist_google_calendar_event_links enable row level security/);
    assert.match(sql, /alter table public\.artist_google_calendar_busy enable row level security/);
    assert.match(sql, /get_my_google_calendar_connection\(\)[\s\S]*security definer/);
    assert.ok(!/get_my_google_calendar_connection[\s\S]{0,400}refresh_token_enc/.test(sql.slice(sql.indexOf('create or replace function public.get_my_google_calendar_connection'))), 'la RPC no devuelve el token');
    assert.match(sql, /revoke all on function public\.gcal_replace_busy_blocks\(uuid, jsonb\) from public, anon, authenticated/);
    assert.match(sql, /add column if not exists google_event_id text/);
    assert.match(sql, /artist_google_calendar_busy b/);
    const down = read('supabase/rollbacks/20261113102000_google_calendar_sync.down.sql');
    assert.match(down, /drop table if exists public\.artist_google_calendar_connections/);
    assert.match(down, /drop column if exists google_event_id/);
    assert.ok(!down.includes('artist_google_calendar_busy b'), 'la reversa restaura los días ocupados sin Google');
});

test('UI: Cuenta usa el estado real y el calendario no muestra ocupados de Google', () => {
    const html = read('public/artist/account/index.html');
    assert.match(html, /google-calendar-repo\.js/);
    assert.match(html, /id="av-sync-detail"/);
    assert.match(html, /id="av-sync-error" role="alert"/);
    const js = read('public/shared/js/artist-account.js');
    assert.match(js, /D\.GoogleCalendar\.authorizeUrl\(\)/);
    assert.match(js, /D\.GoogleCalendar\.disconnect\(\)/);
    assert.ok(!js.includes('AccountIntegrations.save'), 'ya no graba el pedido pending');
    assert.match(js, /split\('\?'\)\[0\]/, '#disponibilidad?gcal=ok abre Disponibilidad');
    const repo = read('public/shared/js/data/calendar-repo.js');
    assert.ok(!/listGoogleBusyProjection|external: 'google'/.test(repo), 'sin bloques importados');
    assert.ok(!read('public/shared/js/data/google-calendar-repo.js').includes('listBusy'));
    assert.match(read('public/calendar/index.html'), /google-calendar-repo\.js/);
});

test('fixtures demo: gcal registrada con estado conectado y sin bloques importados', () => {
    const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');
    assert.ok(Fixtures.EXTENSIONS.includes('gcal'));
    global.self = global.self || global;
    require('../public/shared/js/demo-fixtures/gcal.js');
    const ctx = { tables: {}, rpcs: {}, TABLES: [], identity: { userId: USER } };
    global.self.WoDemoFixtureExtensions.gcal(ctx);
    assert.ok(!ctx.TABLES.includes('artist_google_calendar_busy'));
    assert.equal(ctx.tables.artist_google_calendar_busy, undefined);
    const st = ctx.rpcs.get_my_google_calendar_connection()[0];
    assert.equal(st.connected, true);
    assert.equal(JSON.stringify(st).includes('token'), false);
});

test('.env.example y DEPLOY.md documentan las variables', () => {
    const env = read('.env.example');
    for (const v of ['GOOGLE_OAUTH_CLIENT_ID=', 'GOOGLE_OAUTH_CLIENT_SECRET=', 'GOOGLE_OAUTH_REDIRECT_URI=', 'GCAL_TOKEN_ENC_KEY=', 'GCAL_SYNC_JOB=']) {
        assert.ok(env.includes(`\n${v}\n`), v);
    }
    const deploy = read('deployments/DEPLOY.md');
    assert.match(deploy, /GCAL_TOKEN_ENC_KEY/);
    assert.match(deploy, /https:\/\/beta\.weotzi\.com\/api\/google-calendar\/callback/);
});

test('migración 20261114100000: solo de ida, sin Google en días ocupados y con reversa', () => {
    const sql = read('supabase/migrations/20261114100000_gcal_solo_escritura.sql');
    assert.match(sql, /create or replace function public\.list_artist_public_busy_days/);
    assert.ok(!sql.includes('artist_google_calendar_busy b'), 'los días ocupados no leen Google');
    assert.match(sql, /t\.status = 'confirmado'/);
    assert.match(sql, /drop function if exists public\.gcal_replace_busy_blocks\(uuid, jsonb\)/);
    assert.match(sql, /revoke all on table public\.artist_google_calendar_busy from public, anon, authenticated/);
    assert.ok(!/drop table/i.test(sql), 'no borra datos: eso queda en supabase/pending');
    const down = read('supabase/rollbacks/20261114100000_gcal_solo_escritura.down.sql');
    assert.match(down, /create or replace function public\.gcal_replace_busy_blocks/);
    assert.match(down, /artist_google_calendar_busy b/);
    assert.match(down, /grant select on table public\.artist_google_calendar_busy to authenticated/);
    assert.match(read('supabase/pending/20261114100500_drop_gcal_busy.sql'), /drop table if exists public\.artist_google_calendar_busy/);
});

test('viajes de Travel (2.2.14): guest spot y convención como eventos de todo el día', () => {
    const tz = 'America/Argentina/Buenos_Aires';
    const conv = sync.normalizeTrip({ id: 't1', trip_type: 'convencion', status: 'planificado', city: 'Caracas', country: 'Venezuela', event_name: 'God of Ink', start_date: '2026-11-14', end_date: '2026-11-16' }, tz, 'https://beta.weotzi.com');
    assert.equal(conv.key, 'trip:t1');
    assert.equal(conv.title, 'God of Ink');
    const body = sync.buildGoogleEvent(conv, { tz });
    assert.deepEqual(body.start, { date: '2026-11-14' });
    assert.deepEqual(body.end, { date: '2026-11-17' }, 'fin exclusivo: incluye el 16');
    assert.equal(body.location, 'Caracas, Venezuela');
    assert.match(body.description, /Estado: Planificado/);
    const guest = sync.normalizeTrip({ id: 't2', trip_type: 'guest_spot', status: 'confirmado', city: 'Lima', studio_name_hint: 'Tinta Sur', start_date: '2026-12-01', end_date: '2026-12-01' }, tz);
    assert.equal(guest.title, 'Guest spot en Tinta Sur');
    assert.equal(sync.normalizeTrip({ id: 't3', status: 'cancelado', start_date: '2026-12-01', end_date: '2026-12-02' }, tz), null);
    assert.equal(sync.normalizeTrip({ id: 't4', status: 'confirmado', cancelled_at: '2026-11-01', start_date: '2026-12-01', end_date: '2026-12-02' }, tz), null);
    assert.equal(sync.normalizeTrip({ id: 't5', status: 'confirmado', start_date: '2026-12-03', end_date: '2026-12-01' }, tz), null);
});

test('syncUser publica los viajes y los borra de Google al cancelarlos', async () => {
    const trips = [{ id: 'trip-1', trip_type: 'convencion', status: 'planificado', city: 'Caracas', event_name: 'God of Ink', start_date: '2026-11-14', end_date: '2026-11-16' }];
    const { db, svc } = await connected({ trips });
    const r1 = await svc.syncUser(USER);
    assert.equal(r1.pushed.created, 1);
    assert.ok(db.state.links.has(`${USER}|trip:trip-1`));
    assert.ok(!db.state.sourceIds.some(([key]) => key === 'trip:trip-1'), 'artist_trips no tiene google_event_id');
    db.state.trips = [];
    const r2 = await svc.syncUser(USER);
    assert.equal(r2.pushed.removed, 1);
    assert.ok(!db.state.links.has(`${USER}|trip:trip-1`));
});

test('travel-repo pide sincronizar con Google tras escribir un viaje', () => {
    const repo = read('public/shared/js/data/travel-repo.js');
    assert.ok(repo.includes("['create', 'update', 'cancel', 'reactivate', 'updateDates']"));
    assert.ok(repo.includes('D.GoogleCalendar?.syncSoon?.()'));
    assert.ok(read('public/artist/travel/index.html').includes('google-calendar-repo.js'));
    assert.ok(read('lib/repos/google-calendar.js').includes('listTrips(userId, sinceDate)'));
});
