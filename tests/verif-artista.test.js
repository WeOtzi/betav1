'use strict';
// Frente verif-artista (beta cerrada): verificación de artistas de punta a punta.
//   VER-A1 email + historial · VER-A2 cola por artista · VER-A3 isVerified = sello
//   VER-A4 herramienta del chat · VER-A5 solicitud validada en el servidor
//   VER-A7 RLS de verification_history · VER-A8 estados · VER-A9 texto de Spots
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const Verif = require('../lib/verificacion-artista.js');
const SDM = require('../public/shared/js/support-decision-model.js');
const SV = require('../public/shared/js/support-dashboard-verification.js')._internal;
const Prequote = require('../lib/prequote-estimator.js');
const events = require('../services/email-events/verif-artista.js');

const MIGRATION = 'supabase/migrations/20261115190000_artist_verification_decision.sql';
const ROLLBACK = 'supabase/rollbacks/20261115190000_artist_verification_decision.down.sql';
const ARTIST = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const HISTORY = '33333333-3333-4333-8333-333333333333';
const ARTIST_ROW_ID = '44444444-4444-4444-8444-444444444444';

function fnBody(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start >= 0, signature + ' existe');
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return src.slice(start);
}

/* ------------------------------ migración ------------------------------ */

test('migración: RPC con historial, solicitud solo service_role, cola por artista, RLS y guard', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^commit;\s*$/m);
    // VER-A1: decisión con nota → jsonb + verification_history (reviewed_by = agente).
    assert.match(sql, /create or replace function public\.support_set_artist_verification_state\(\s*p_artist_user_id uuid,\s*p_state text,\s*p_note text\s*\)\s*returns jsonb/);
    assert.match(sql, /insert into public\.verification_history \(artist_id, action, notes, reviewed_by\)\s*values \(v_artist_id, v_action, v_note, auth\.uid\(\)::text\)/);
    assert.match(sql, /when 'Yes' then 'approved'\s*when 'Denied' then 'rejected'\s*when 'Requested' then 'pending_review'\s*else 'revoked'/);
    assert.match(sql, /Escribí el motivo para denegar/);
    // La firma vieja sigue y pasa por la nueva (mismo historial).
    assert.match(sql, /p_state text\s*\)\s*returns text[\s\S]*support_set_artist_verification_state\(p_artist_user_id, p_state, null::text\) ->> 'state'/);
    // Las tres funciones de soporte chequean is_support_user().
    assert.equal((sql.match(/if not coalesce\(public\.is_support_user\(\), false\) then/g) || []).length, 2);
    // VER-A5: solicitud del artista solo por el servidor (service_role) y exige documentos.
    assert.match(sql, /revoke all on function public\.request_artist_verification\(uuid\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.request_artist_verification\(uuid\) to service_role;/);
    assert.match(sql, /'pending_review', 'Solicitud del artista'/);
    assert.match(sql, /d\.status <> 'rechazado'/);
    // VER-A2: cola por artista (también sin documentos).
    assert.match(sql, /create or replace function public\.support_list_verification_requests\(\s*p_status text default 'pending',\s*p_user_id uuid default null\s*\)/);
    assert.match(sql, /coalesce\(docs\.items, '\[\]'::jsonb\)/);
    // VER-A7: sin políticas abiertas; solo lectura para soporte y para el dueño.
    assert.match(sql, /drop policy if exists "Allow authenticated insert on verification_history"/);
    assert.match(sql, /drop policy if exists "Allow authenticated read on verification_history"/);
    assert.match(sql, /create policy verification_history_support_select[\s\S]*using \(public\.is_support_user\(\)\)/);
    assert.match(sql, /create policy verification_history_owner_select[\s\S]*a\.user_id = \(select auth\.uid\(\)\)/);
    assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on table public\.verification_history from authenticated;/);
    assert.match(sql, /revoke all on table public\.verification_history from anon;/);
    // VER-A5/A8: el guard exige documentos y deja re-pedir desde 'Canceled'.
    assert.match(sql, /in \('No', 'Denied', 'rejected', 'Canceled'\)/);
    assert.match(sql, /Para solicitar la verificación subí tu documento de identidad y tu comprobante de domicilio/);
    // Idempotente.
    assert.doesNotMatch(sql, /create policy (?!verification_history_)/);
    for (const fn of ['support_set_artist_verification_state', 'request_artist_verification', 'support_list_verification_requests']) {
        const block = sql.slice(sql.indexOf('function public.' + fn + '('));
        assert.match(block.slice(0, 900), /security definer\s+set search_path = public, pg_temp/, fn + ' fija search_path');
    }
});

test('migración: timestamp dentro del rango del frente y reversa completa', () => {
    const name = path.basename(MIGRATION).slice(0, 14);
    assert.ok(name >= '20261115190000' && name <= '20261115190999', 'rango 20261115190000–20261115190999');
    const down = read(ROLLBACK);
    assert.match(down, /drop function if exists public\.support_set_artist_verification_state\(uuid, text, text\);/);
    assert.match(down, /drop function if exists public\.request_artist_verification\(uuid\);/);
    assert.match(down, /drop function if exists public\.support_list_verification_requests\(text, uuid\);/);
    assert.match(down, /create policy "Allow authenticated read on verification_history"/);
    assert.match(down, /create or replace function public\.guard_artist_privileged_fields\(\)/);
    assert.match(down, /begin;[\s\S]*commit;\s*$/);
});

/* ------------------------------ solicitud del artista ------------------------------ */

const DOCS_OK = [{ doc_type: 'identidad', status: 'pendiente' }, { doc_type: 'domicilio', status: 'verificado' }];

test('requestEligibility: misma regla que la RPC (documentos obligatorios, estados)', () => {
    assert.equal(Verif.requestEligibility(null, []).status, 404);
    assert.equal(Verif.requestEligibility({ verification_state: 'Yes' }, DOCS_OK).status, 409);
    assert.deepEqual(Verif.requestEligibility({ verification_state: 'Requested' }, []), { ok: true, alreadyRequested: true, state: 'Requested' });
    const none = Verif.requestEligibility({ verification_state: 'No' }, []);
    assert.equal(none.ok, false);
    assert.equal(none.error, 'Antes de solicitarla, subí tu documento de identidad y tu comprobante de domicilio.');
    const rejected = Verif.requestEligibility({ verification_state: 'Denied' },
        [{ doc_type: 'identidad', status: 'rechazado' }, { doc_type: 'domicilio', status: 'pendiente' }]);
    assert.deepEqual(rejected.missing, ['tu documento de identidad']);
    assert.equal(Verif.requestEligibility({ verification_state: 'Canceled' }, DOCS_OK).ok, true);
    assert.equal(Verif.requestEligibility({ verification_state: null }, DOCS_OK).ok, true);
    assert.equal(Verif.requestEligibility({ verification_state: 'Raro' }, DOCS_OK).ok, false);
});

test('mapRpcError: el mensaje de la RPC llega al artista; sin migración → 503', () => {
    const err = new Error('PostgREST POST rpc/request_artist_verification failed (400): {"code":"22023","details":null,"hint":null,"message":"Antes de solicitarla, subí tu comprobante de domicilio."}');
    assert.deepEqual(Verif.mapRpcError(err), { status: 409, error: 'Antes de solicitarla, subí tu comprobante de domicilio.' });
    const missing = new Error('PostgREST POST rpc/request_artist_verification failed (404): {"code":"PGRST202","message":"Could not find the function public.request_artist_verification"}');
    assert.equal(Verif.mapRpcError(missing).status, 503);
    assert.equal(Verif.mapRpcError(new Error('boom')).status, 500);
});

function requestDeps(over = {}) {
    const calls = { rpc: 0, emails: [] };
    const deps = {
        artistByUserId: async () => ({ id: ARTIST_ROW_ID, user_id: ARTIST, name: 'Ana Tinta', username: 'ana.tinta', email: 'ana@example.test', verification_state: 'No' }),
        documents: async () => DOCS_OK,
        requestVerification: async () => { calls.rpc++; return { state: 'Requested', history_id: HISTORY, changed: true }; },
        supportEmail: '',
        supportEmails: async () => ['soporte@example.test'],
        sendEmail: async (eventId, payload, options) => { calls.emails.push({ eventId, payload, options }); return { ok: true, channel: 'n8n' }; },
        baseUrl: 'https://weotzi.com/beta/',
        ...over
    };
    return { deps, calls };
}

test('requestVerification: valida, llama a la RPC y avisa a soporte una sola vez', async () => {
    const { deps, calls } = requestDeps();
    const res = await Verif.requestVerification({ userId: ARTIST }, deps);
    assert.deepEqual(res, { ok: true, state: 'Requested', changed: true, historyId: HISTORY, supportNotified: true });
    assert.equal(calls.rpc, 1);
    assert.equal(calls.emails.length, 1);
    const mail = calls.emails[0];
    assert.equal(mail.eventId, 'artist_verification_requested');
    assert.equal(mail.options.idempotencyKey, 'artist_verification_requested:' + HISTORY);
    assert.deepEqual(mail.payload.support_emails, ['soporte@example.test']);
    assert.equal(mail.payload.queue_url, 'https://weotzi.com/beta/support/dashboard#verificacion');
    assert.equal(mail.payload.artist_username, '@ana.tinta');
    assert.match(mail.payload.documents_summary, /Documento de identidad: pendiente · Comprobante de domicilio: aprobado · Certificado de bioseguridad: sin cargar/);
    assert.deepEqual(events.artist_verification_requested.recipients(mail.payload), ['soporte@example.test']);
});

test('requestVerification: sin documentos no llama a la RPC; ya pedida no duplica; falla del email no frena', async () => {
    const noDocs = requestDeps({ documents: async () => [] });
    const r1 = await Verif.requestVerification({ userId: ARTIST }, noDocs.deps);
    assert.equal(r1.ok, false);
    assert.equal(r1.status, 409);
    assert.equal(noDocs.calls.rpc, 0);

    const already = requestDeps({ artistByUserId: async () => ({ user_id: ARTIST, verification_state: 'Requested' }) });
    const r2 = await Verif.requestVerification({ userId: ARTIST }, already.deps);
    assert.deepEqual(r2, { ok: true, state: 'Requested', changed: false, supportNotified: false });
    assert.equal(already.calls.rpc, 0);
    assert.equal(already.calls.emails.length, 0);

    const failingMail = requestDeps({ sendEmail: async () => { throw new Error('n8n caído'); }, log: { warn() {} } });
    const r3 = await Verif.requestVerification({ userId: ARTIST }, failingMail.deps);
    assert.equal(r3.ok, true);
    assert.equal(r3.supportNotified, false);

    const bad = await Verif.requestVerification({ userId: 'no-uuid' }, requestDeps().deps);
    assert.equal(bad.status, 401);
});

/* ------------------------------ aviso de la decisión ------------------------------ */

function notifyDeps(row, over = {}) {
    const sent = [];
    return {
        sent,
        deps: {
            historyRow: async () => row,
            artistById: async () => ({ id: ARTIST_ROW_ID, user_id: ARTIST, name: 'Ana Tinta', username: 'ana.tinta', email: 'ana@example.test' }),
            isActiveSupportAgent: async (id) => id === AGENT,
            sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true, channel: 'n8n' }; },
            baseUrl: 'https://weotzi.com/beta',
            now: new Date('2026-11-15T12:05:00Z'),
            ...over
        }
    };
}
const histRow = (action, notes) => ({ id: HISTORY, artist_id: ARTIST_ROW_ID, action, notes, reviewed_by: AGENT, created_at: '2026-11-15T12:00:00Z' });

test('notifyVerificationDecision: verificado → profile_verified con enlace al perfil', async () => {
    const { deps, sent } = notifyDeps(histRow('approved', null));
    const res = await Verif.notifyVerificationDecision({ history_id: HISTORY }, deps);
    assert.equal(res.ok, true);
    assert.equal(res.sent, true);
    assert.equal(sent[0].eventId, 'profile_verified');
    assert.equal(sent[0].payload.artist_email, 'ana@example.test');
    assert.equal(sent[0].payload.profile_url, 'https://weotzi.com/beta/artist/profile?artist=ana.tinta');
    assert.equal(sent[0].options.idempotencyKey, 'artist_state:' + HISTORY);
    assert.equal(sent[0].options.ignorePreferences, true);
});

test('notifyVerificationDecision: denegado lleva el motivo; revocado usa el aviso genérico', async () => {
    const denied = notifyDeps(histRow('rejected', 'La foto del DNI no se lee'));
    await Verif.notifyVerificationDecision({ history_id: HISTORY }, denied.deps);
    assert.equal(denied.sent[0].eventId, 'profile_verification_denied');
    assert.equal(denied.sent[0].payload.reason, 'La foto del DNI no se lee');
    assert.equal(denied.sent[0].payload.dashboard_url, 'https://weotzi.com/beta/artist/account#verificacion');

    const revoked = notifyDeps(histRow('revoked', 'Perfil duplicado'));
    await Verif.notifyVerificationDecision({ history_id: HISTORY }, revoked.deps);
    assert.equal(revoked.sent[0].eventId, 'artist_support_decision');
    assert.equal(revoked.sent[0].payload.decision_title, 'Tu perfil quedó sin verificar');
    assert.match(revoked.sent[0].payload.decision_detail, /Motivo: Perfil duplicado\./);
});

test('notifyVerificationDecision: no reenvía viejas, ni filas sin agente, ni solicitudes', async () => {
    const stale = notifyDeps(histRow('approved'), { now: new Date('2026-11-15T13:00:00Z') });
    assert.equal((await Verif.notifyVerificationDecision({ history_id: HISTORY }, stale.deps)).skipped, 'stale');
    assert.equal(stale.sent.length, 0);

    const forged = notifyDeps({ ...histRow('approved'), reviewed_by: ARTIST });
    assert.equal((await Verif.notifyVerificationDecision({ history_id: HISTORY }, forged.deps)).skipped, 'not_support');

    const request = notifyDeps({ ...histRow('pending_review'), reviewed_by: AGENT });
    assert.equal((await Verif.notifyVerificationDecision({ history_id: HISTORY }, request.deps)).skipped, 'no_decision');

    assert.equal((await Verif.notifyVerificationDecision({ history_id: 'x' }, notifyDeps(null).deps)).status, 400);
    assert.equal((await Verif.notifyVerificationDecision({ history_id: HISTORY }, notifyDeps(null).deps)).status, 404);
});

/* ------------------------------ aviso in-app (mismo modelo) ------------------------------ */

test('support-decision-model: verification_history → notificación del artista', () => {
    assert.ok(SDM.SUBJECTS.includes('verification'));
    const d = SDM.fromRow('verification', { id: HISTORY, action: 'rejected', notes: 'Falta domicilio', created_at: '2026-11-15T12:00:00Z', artists_db: { user_id: ARTIST } });
    assert.equal(d.artistUserId, ARTIST);
    assert.equal(d.outcome, 'rejected');
    assert.equal(SDM.href(d), '/artist/account#verificacion');
    assert.deepEqual(SDM.describe(d), { title: 'No pudimos verificar tu perfil', detail: 'Motivo: Falta domicilio. Revisá tus documentos y volvé a solicitarla desde Cuenta · Verificación.' });
    assert.equal(SDM.fromRow('verification', { id: HISTORY, action: 'pending_review', created_at: '2026-11-15T12:00:00Z' }), null);
    const items = SDM.feedItems({ verifications: [{ id: HISTORY, action: 'approved', created_at: '2026-11-15T12:00:00Z' }] }, { now: new Date('2026-11-16T00:00:00Z') });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Verificamos tu perfil');
    assert.equal(items[0].icon, 'check-circle');
    // Los otros sujetos no cambian.
    assert.equal(SDM.describe(SDM.fromRow('document', { id: 'd1', artist_user_id: ARTIST, doc_type: 'identidad', status: 'verificado', reviewed_at: '2026-11-15T12:00:00Z' })).title,
        'Aprobamos tu documento de identidad');
});

test('support-decisions-repo: el panel del artista lee verification_history por su user_id', () => {
    const src = read('public/shared/js/data/support-decisions-repo.js');
    assert.match(src, /from\('verification_history'\)/);
    assert.match(src, /artists_db!inner\(user_id\)/);
    assert.match(src, /\.eq\('artists_db\.user_id', artistUserId\)\.in\('action', \['approved', 'rejected', 'revoked'\]\)/);
    assert.match(src, /verifications: results\[3\]/);
});

/* ------------------------------ cola de soporte ------------------------------ */

test('cola de soporte: solicitudes por artista y decisión con motivo', () => {
    assert.equal(SV.KINDS[0], 'requests');
    assert.ok(SV.KINDS.includes('documents') && SV.KINDS.includes('withdrawals'));
    assert.equal(SV.buildStateDecision('Denied', 'no', 'Requested').field, 'note');
    assert.deepEqual(SV.buildStateDecision('Denied', '  Falta el domicilio ', 'Requested'), { state: 'Denied', note: 'Falta el domicilio' });
    assert.deepEqual(SV.buildStateDecision('Yes', '', 'Requested'), { state: 'Yes', note: null });
    assert.equal(SV.buildStateDecision('No', '', 'Yes').field, 'note', 'revocar exige motivo');
    assert.deepEqual(SV.buildStateDecision('No', '', 'Requested'), { state: 'No', note: null });
    assert.ok(SV.buildStateDecision('In Progress', '', 'No').error, 'estados legados fuera');
    assert.equal(SV.buildStateDecision('Yes', 'x'.repeat(501), 'No').field, 'note');
    assert.deepEqual(SV.stateActions('Yes').map((a) => a.state), ['No']);
    assert.deepEqual(SV.stateActions('Requested').map((a) => a.state), ['Yes', 'Denied']);
    assert.equal(SV.artistStateMeta('Requested').tone, 'pending');
    assert.equal(SV.artistStateMeta('Denied').label, 'Denegado');
    const items = SV.requestItems([{ user_id: ARTIST, verification_state: 'Requested', documents: [{ id: 'd1', doc_type: 'identidad', status: 'pendiente' }] }, { user_id: null }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, ARTIST);
    assert.equal(items[0].documents[0].artist_user_id, ARTIST);
    assert.equal(SV.docStatusOf(items[0].documents, 'identidad'), 'pending');
    assert.equal(SV.docStatusOf(items[0].documents, 'domicilio'), 'missing');
    // Un artista 'Requested' sin documentos también es una fila de la cola.
    assert.equal(SV.requestItems([{ user_id: ARTIST, verification_state: 'Requested', documents: [] }]).length, 1);
    assert.equal(SV.errorText(new Error('Could not find the function public.support_list_verification_requests(p_status)')), SV.MSG.rpcMissingVerif);
});

test('cola de soporte: el panel avisa al artista y la ficha de support-dashboard ya no hace PATCH', () => {
    const src = read('public/shared/js/support-dashboard-verification.js');
    assert.match(src, /appPath\('\/api\/support\/artist-verification\/notify'\)/);
    assert.match(src, /repo\(\)\.setArtistVerification\(userId, decision\.state, decision\.note\)/);
    assert.match(src, /notifyVerification\(result && result\.history_id\)/);
    assert.match(src, /<option value="requests">Solicitudes de artistas<\/option>/);
    assert.match(src, /openArtist,/);
    // Todo dato del artista pasa por esc() en la ficha.
    const detail = fnBody(src, 'function requestDetail(item, history)');
    assert.doesNotMatch(detail, /\$\{a\.(name|email|username|city)\}/);
    assert.doesNotMatch(detail, /\$\{h\.notes\}/);
    const repo = read('public/shared/js/data/support-verification-repo.js');
    assert.match(repo, /c\.rpc\('support_list_verification_requests'/);
    assert.match(repo, /p_note: note \|\| null/);
    assert.match(repo, /requests: req\.count \|\| 0/);
    const dash = read('public/shared/js/support-dashboard.js');
    assert.doesNotMatch(dash, /updateArtistField\('\$\{artist\.user_id\}', 'verification_state'/);
    assert.match(dash, /SupportVerificationQueue\.openArtist\(this\.dataset\.verifArtist\)/);
    const html = read('public/support/dashboard/index.html');
    assert.match(html, /support-dashboard-verification\.js\?v=20261115-verif/);
});

/* ------------------------------ cuenta del artista ------------------------------ */

test('cuenta: pide la verificación al servidor y muestra el estado intermedio', () => {
    const js = read('public/shared/js/artist-account.js');
    assert.match(fnBody(js, 'function isVerified()'), /return artist\?\.verification_state === 'Yes';/);
    const req = fnBody(js, 'async function requestVerification(btn)');
    assert.match(req, /D\.ArtistVerification\.request\(\)/);
    assert.match(req, /isDemo\(\)/);
    const render = fnBody(js, 'function renderVerification()');
    assert.match(render, /Documentos aprobados · falta la revisión final/);
    assert.match(render, /requiredDocsApproved\(\)/);
    assert.match(render, /\$\{esc\(detail\)\}/, 'el motivo de soporte se escapa');
    assert.match(js, /lastVerifDecision = await D\.ArtistVerification\.lastDecision\(user\.id\)/);
    const html = read('public/artist/account/index.html');
    const repoAt = html.indexOf('/shared/js/data/artist-verification-repo.js');
    assert.ok(repoAt > html.indexOf('/shared/js/data/postgrest-client.js') && repoAt < html.indexOf('/shared/js/artist-account.js'));
    const repo = read('public/shared/js/data/artist-verification-repo.js');
    assert.match(repo, /'\/api\/artist\/verification\/request'/);
    assert.doesNotMatch(repo, /rest\/v1/);
});

test('dashboard legado: el modal ya no escribe verification_state; lleva a Cuenta · Verificación', () => {
    const js = read('public/shared/js/dashboard.js');
    assert.doesNotMatch(js, /updateByUserId\(currentUser\.id, \{ verification_state: 'Requested' \}\)/);
    assert.match(fnBody(js, 'function submitVerificationRequest()'), /goToVerificationAccount\(\)/);
    assert.match(js, /const VERIFICATION_ACCOUNT_PATH = '\/artist\/account#verificacion';/);
});

/* ------------------------------ servidor ------------------------------ */

test('servidor: rutas en lib/routes/verif-artista.js registradas con una línea', () => {
    const server = read('server.js');
    assert.equal((server.match(/require\('\.\/lib\/routes\/verif-artista'\)\.register\(app,/g) || []).length, 1);
    const routes = [];
    const fakeApp = { post: (p) => routes.push(p) };
    require('../lib/routes/verif-artista.js').register(fakeApp, {
        resolveBearerUser: async () => null, getActiveSupportAgent: async () => ({ ok: false, status: 401 }),
        emailService: { sendEmail: async () => ({ ok: true }) }, applicationBase: () => ''
    });
    assert.deepEqual(routes, ['/api/artist/verification/request', '/api/support/artist-verification/notify']);
    assert.throws(() => require('../lib/routes/verif-artista.js').register(fakeApp, {}));
});

test('emails: evento nuevo server-only y resultados de verificación fuera de /api/send-email', async () => {
    const def = events.artist_verification_requested;
    assert.equal(def.serverOnly, true);
    for (const key of ['subject', 'preheader', 'headline', 'intro', 'rows', 'cta']) assert.equal(typeof def.render[key], 'function', key);
    assert.equal(def.render.audience, 'admin');
    assert.equal(def.render.category, 'account');
    assert.equal(def.render.cta({ queue_url: 'https://x.test/q' }).url, 'https://x.test/q');
    assert.ok(Array.isArray(def.render.rows({ artist_name: 'Ana' })));

    require('../lib/routes/verif-artista.js').ensureEmailEvents();
    const mapping = require('../services/email-event-mapping.js');
    const ctx = require('../services/email-request-context.js');
    assert.ok(mapping.getEvent('artist_verification_requested'));
    for (const id of ['artist_verification_requested', 'profile_verified', 'profile_verification_denied']) {
        assert.ok(ctx.SERVER_ONLY_EVENTS.has(id), id + ' server-only');
        const res = await ctx.resolveEmailContext({ headers: {}, get: () => '' }, id, {}, { resolveUser: async () => null });
        assert.equal(res.status, 403, id);
    }
    assert.doesNotMatch(read('services/email-request-context.js'), /ADMIN_EVENTS = new Set\(\['profile_verified'/);
});

test('chat de soporte: get_verification_status usa columnas reales y documentos', async () => {
    const server = read('server.js');
    const block = server.slice(server.indexOf("if (toolName === 'get_verification_status')"), server.indexOf("if (toolName === 'escalate_to_human')"));
    assert.doesNotMatch(block, /is_verified|profile_status|verification_notes/);
    assert.match(block, /verificationStatusForUser\(userId, ArtistVerificationRepo\)/);
    const res = await Verif.verificationStatusForUser(ARTIST, {
        artistByUserId: async () => ({ id: ARTIST_ROW_ID, name: 'Ana', verification_state: 'Denied', instagram_verified_at: null }),
        documents: async () => [{ doc_type: 'identidad', status: 'rechazado', reviewer_notes: 'Borrosa' }],
        lastDecision: async () => ({ action: 'rejected', notes: 'Falta domicilio', created_at: '2026-11-15T12:00:00Z' })
    });
    assert.equal(res.verificacion.estado, 'Denegada');
    assert.equal(res.verificacion.documentos[0].motivo_rechazo, 'Borrosa');
    assert.deepEqual(res.verificacion.faltan_obligatorios, ['tu documento de identidad', 'tu comprobante de domicilio']);
    assert.equal(res.verificacion.ultima_decision.motivo, 'Falta domicilio');
    assert.match(res.verificacion.siguiente_paso, /^Subir tu documento de identidad y tu comprobante de domicilio/);
    assert.deepEqual(await Verif.verificationStatusForUser(ARTIST, { artistByUserId: async () => null, documents: async () => [] }),
        { error: 'Este usuario no es un artista.' });
});

/* ------------------------------ estados y textos ------------------------------ */

test('estados: pre-cotización excluye denegados; Spots no promete "verificado"; backoffice sin legados', () => {
    assert.deepEqual(Prequote.EXCLUDED_VERIFICATION_STATES, ['Denied', 'rejected']);
    const base = { styles_array: ['Realismo'], session_price: '100 USD', city: 'Buenos Aires', country: 'Argentina' };
    const input = { client_city_residence: 'Buenos Aires, Argentina', tattoo_style: 'Realismo', tattoo_size: 'Mediano' };
    const withDenied = Prequote.estimatePreQuote(input, [{ ...base, user_id: 'a', verification_state: 'Denied' }]);
    const withOk = Prequote.estimatePreQuote(input, [{ ...base, user_id: 'a', verification_state: 'No' }]);
    assert.notDeepEqual(withDenied, withOk, 'el artista denegado no cuenta');

    const spots = read('public/shared/js/studio-spots-directory.js');
    assert.doesNotMatch(spots, /'Perfil verificado'/);
    assert.match(spots, /artist\.verification_state === 'Yes'\) parts\.push\('Verificado'\)/);
    assert.match(spots, /portafolio, verification_state'/);

    const bo = read('public/backoffice/index.html');
    const select = bo.slice(bo.indexOf('<select id="artist-verification-state"'), bo.indexOf('</select>', bo.indexOf('<select id="artist-verification-state"')));
    assert.doesNotMatch(select, /In Progress|In Analysis|Canceled/);
});
