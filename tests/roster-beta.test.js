'use strict';

// Beta cerrada · frente roster: altas de tatuadores en estudios.
// ROSTER-01..14 + EM-10 (avisos del roster). Lógica pura con dobles en
// memoria y contratos de HTML/JS por lectura de archivos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const invite = require('../lib/studio-invite');
const roster = require('../lib/roster-service');
const rosterEvents = require('../services/email-events/roster');
const routes = require('../lib/routes/roster');
const artistRegistration = require('../lib/artist-registration');

const STUDIO = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ARTIST = '33333333-3333-4333-8333-333333333333';
const LOC = '44444444-4444-4444-8444-444444444444';

// ------------------------------------------------------------------ enlace

test('enlace: token de 256 bits en base64url y hash sha256 hex como Postgres', () => {
    const token = invite.generateInviteToken();
    assert.ok(invite.isWellFormedInviteToken(token));
    assert.equal(invite.hashInviteToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.match(invite.hashInviteToken(token), /^[0-9a-f]{64}$/);
    assert.equal(invite.isWellFormedInviteToken('corto'), false);
    assert.equal(invite.isWellFormedInviteToken('x'.repeat(40) + '/..'), false);
    assert.equal(invite.buildJoinPath('tok_en-1'), '/artist/join-studio?unirse=tok_en-1');
    assert.equal(invite.buildRegisterPath('tok'), '/registerclosedbeta?unirse=tok');
    assert.equal(invite.INVITE_QUERY_PARAM, 'unirse');
});

test('enlace: normaliza rol, sede, vencimiento (7/30/90), usos y aprobación por defecto', () => {
    const ok = invite.normalizeIssueInput({ role: 'guest', location_id: LOC, ttl_days: '90', max_uses: '5', label: '  Verano  ' });
    assert.deepEqual(ok, { ok: true, value: { role: 'guest', locationId: LOC, ttlDays: 90, maxUses: 5, requiresApproval: true, label: 'Verano' } });
    assert.equal(invite.normalizeIssueInput({ ttl_days: 45 }).value.ttlDays, 30);
    assert.equal(invite.normalizeIssueInput({ requires_approval: false }).value.requiresApproval, false);
    assert.equal(invite.normalizeIssueInput({ role: 'manager' }).ok, false, 'manager solo por invitación directa del dueño');
    assert.equal(invite.normalizeIssueInput({ location_id: 'x;drop' }).ok, false);
    assert.equal(invite.normalizeIssueInput({ max_uses: 0 }).ok, false);
});

test('enlace: estado del preview y códigos HTTP (404 inválido, 410 vencido/usado/revocado)', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    const studio = { id: STUDIO, user_id: OWNER, is_active: true };
    const link = { expires_at: '2026-12-01T00:00:00Z', uses_count: 0, max_uses: 2 };
    assert.equal(invite.inviteLinkStatus(null, studio, now), 'invalid');
    assert.equal(invite.inviteLinkStatus(link, studio, now), 'valid');
    assert.equal(invite.inviteLinkStatus({ ...link, revoked_at: '2026-11-10' }, studio, now), 'revoked');
    assert.equal(invite.inviteLinkStatus({ ...link, expires_at: '2026-11-14T00:00:00Z' }, studio, now), 'expired');
    assert.equal(invite.inviteLinkStatus({ ...link, uses_count: 2 }, studio, now), 'exhausted');
    assert.equal(invite.inviteLinkStatus(link, { ...studio, user_id: null }, now), 'unavailable');
    assert.equal(invite.previewHttpStatus('valid'), 200);
    assert.equal(invite.previewHttpStatus('invalid'), 404);
    assert.equal(invite.previewHttpStatus('expired'), 410);
    const row = invite.publicLinkRow({ id: 'l1', token_hash: 'f'.repeat(64), role: 'resident', uses_count: 1, max_uses: 1, expires_at: '2099-01-01' });
    assert.equal(row.status, 'exhausted');
    assert.equal('token_hash' in row, false, 'el panel nunca recibe el hash');
});

test('invitación por email: valida email y rol', () => {
    assert.equal(invite.normalizeEmailInviteInput({ email: 'no-es-email' }).ok, false);
    const ok = invite.normalizeEmailInviteInput({ email: ' Ana@Example.COM ', name: 'Ana', role: 'resident' });
    assert.equal(ok.value.email, 'ana@example.com');
    assert.equal(ok.value.name, 'Ana');
});

// ------------------------------------------------------------- registro

test('ROSTER-01: la membresía del registro es una SOLICITUD (requested, initiated_by artist), nunca active', () => {
    const req = roster.buildRegistrationRequest({ artistUserId: ARTIST, studioId: STUDIO, locationId: LOC, now: '2026-11-15T00:00:00Z' });
    assert.deepEqual(req, {
        artist_user_id: ARTIST, studio_id: STUDIO, location_id: LOC, role: 'resident',
        status: 'requested', initiated_by: 'artist', invited_at: '2026-11-15T00:00:00Z'
    });
    const legacy = artistRegistration.buildStudioMembershipPayload({ artistUserId: ARTIST, studioId: STUDIO, workType: 'studio' });
    assert.equal(legacy.status, 'requested');
    assert.equal(legacy.started_at, undefined);
    const details = roster.buildRegistrationRequestDetails({ membershipId: 'm1', formData: { portfolio_url: 'javascript:alert(1)', styles: ['Blackwork', ' '] } });
    assert.equal(details.portfolio_url, null);
    assert.deepEqual(details.styles, ['Blackwork']);
});

test('ROSTER-01: el payload del artista no fija studio_id cuando el servidor pasa studioId null', () => {
    const patch = artistRegistration.buildArtistRegistrationPayload({ studio_id: STUDIO, work_type: 'studio', studio_name: 'X' }, { studioId: null });
    assert.equal(patch.studio_id, null);
    const draft = artistRegistration.buildArtistRegistrationPayload({ studio_id: STUDIO, work_type: 'studio' }, {});
    assert.equal(draft.studio_id, STUDIO, 'el borrador conserva la elección del cliente');
});

function fakeRepo(overrides = {}) {
    const calls = [];
    const repo = {
        calls,
        getStudio: async (id) => (id === STUDIO ? { id: STUDIO, name: 'La Aguja', user_id: OWNER, is_active: true, email: null } : null),
        getLocation: async () => ({ id: LOC, studio_id: STUDIO, label: 'Palermo', city: 'Buenos Aires', is_active: true }),
        getArtist: async () => ({ user_id: ARTIST, work_type: 'independent', email: 'a@x.com' }),
        findArtistByEmail: async () => null,
        findOpenMembership: async () => null,
        getMembershipWithParties: async (id) => ({
            id, studio_id: STUDIO, artist_user_id: ARTIST, role: 'resident', status: 'requested', initiated_by: 'artist',
            studios: { id: STUDIO, name: 'La Aguja', user_id: OWNER, email: 'dueno@aguja.com' },
            artists_db: { user_id: ARTIST, name: 'Ana Ink', username: 'ana', email: 'ana@x.com' },
            location: { label: 'Palermo', city: 'Buenos Aires' }
        }),
        getActiveResidentMembership: async () => null,
        patchArtist: async (...args) => calls.push(['patchArtist', ...args]),
        upsertCurrentTattooLocation: async (row) => calls.push(['atl', row]),
        insertMembership: async (row) => { calls.push(['insertMembership', row]); return { id: 'm-new', ...row }; },
        upsertRequestDetails: async (row) => calls.push(['requestDetails', row]),
        upsertInvitationDetails: async (row) => calls.push(['invitationDetails', row]),
        issueInviteLink: async (params) => { calls.push(['issue', params]); return { id: 'link-1', expires_at: '2026-12-15T00:00:00Z', max_uses: params.maxUses }; },
        redeemInviteLink: async (hash, user) => { calls.push(['redeem', hash, user]); return { status: 'active', membership_id: 'm-link', studio_id: STUDIO }; },
        getInviteLinkByHash: async () => null,
        isActiveSupportUser: async () => false,
        ...overrides
    };
    return repo;
}

test('ROSTER-01: el studio_id del cliente se valida (existe, activo y uuid) antes de usarse', async () => {
    const svc = roster.createRosterService({ repo: fakeRepo() });
    assert.equal(await svc.validateRegistrationStudio('no-uuid'), null);
    assert.equal(await svc.validateRegistrationStudio('99999999-9999-4999-8999-999999999999'), null);
    assert.equal((await svc.validateRegistrationStudio(STUDIO)).id, STUDIO);
    const inactive = roster.createRosterService({ repo: fakeRepo({ getStudio: async () => ({ id: STUDIO, is_active: false }) }) });
    assert.equal(await inactive.validateRegistrationStudio(STUDIO), null);
});

test('ROSTER-01/03: registro sin enlace → solicitud + detalle; con enlace → canje; enlace caído → solicitud', async () => {
    const repo = fakeRepo();
    const svc = roster.createRosterService({ repo, log: { warn() {} } });
    const upserts = [];
    const upsertOpenStudioMembership = async (_rest, membership) => { upserts.push(membership); return { row: { id: 'm-req', status: 'requested' }, created: true }; };

    const plain = await svc.persistRegistrationMembership({ upsertOpenStudioMembership, artistUserId: ARTIST, studioId: STUDIO, locationId: LOC, formData: {} });
    assert.equal(plain.status, 'requested');
    assert.equal(upserts[0].status, 'requested');
    assert.ok(repo.calls.some(([k]) => k === 'requestDetails'));

    const token = invite.generateInviteToken();
    const viaLink = await svc.persistRegistrationMembership({
        upsertOpenStudioMembership, artistUserId: ARTIST, studioId: STUDIO, formData: {}, invite: { ok: true, token }
    });
    assert.deepEqual([viaLink.status, viaLink.viaInvite, viaLink.membershipId], ['active', true, 'm-link']);
    assert.equal(repo.calls.find(([k]) => k === 'redeem')[1], invite.hashInviteToken(token));

    const failing = roster.createRosterService({ repo: fakeRepo({ redeemInviteLink: async () => ({ status: 'expired' }) }), log: { warn() {} } });
    const fallback = await failing.persistRegistrationMembership({
        upsertOpenStudioMembership, artistUserId: ARTIST, studioId: STUDIO, formData: {}, invite: { ok: true, token }
    });
    assert.equal(fallback.status, 'requested');
    assert.equal(fallback.inviteFailed, true);
});

test('ROSTER-03: el enlace en el registro fuerza estudio y sede del enlace', () => {
    const svc = roster.createRosterService({ repo: fakeRepo() });
    const data = svc.applyInviteToFormData({ work_type: 'independent', studio_id: 'otro', studio_name: 'Otro' }, {
        ok: true, formPatch: { studio_id: STUDIO, studio_name: 'La Aguja', studio_location_id: LOC }
    });
    assert.deepEqual([data.work_type, data.studio_id, data.studio_name, data.studio_location_id], ['studio', STUDIO, 'La Aguja', LOC]);
    assert.equal(svc.applyInviteToFormData({ work_type: 'both' }, { ok: true, formPatch: {} }).work_type, 'both');
});

// --------------------------------------------------------- sync (ROSTER-10)

test('ROSTER-10: al quedar residente activo se alinean estudios, work_type y la ubicación actual', () => {
    const plan = roster.buildArtistStudioSync({
        artist: { work_type: 'independent' },
        membership: { status: 'active', role: 'resident', artist_user_id: ARTIST, studio_id: STUDIO,
            studios: { id: STUDIO, name: 'La Aguja', city: 'CABA' }, location: { city: 'Buenos Aires', country: 'Argentina' } }
    });
    assert.deepEqual(plan.artistPatch, { estudios: 'LA AGUJA', work_type: 'both' });
    assert.deepEqual(plan.tattooLocation, { artist_user_id: ARTIST, studio_id: STUDIO, studio_name: 'LA AGUJA', city: 'Buenos Aires', country: 'Argentina' });
    assert.equal(roster.buildArtistStudioSync({ artist: {}, membership: { status: 'active', role: 'guest' } }), null);
    assert.equal(roster.buildArtistStudioSync({ artist: {}, membership: { status: 'requested', role: 'resident' } }), null);
    assert.equal(roster.buildArtistStudioSync({ artist: { work_type: null }, membership: { status: 'active', role: 'resident', studios: { name: 'x' } } }).artistPatch.work_type, 'studio');
});

// ------------------------------------------------------ emails (EM-10)

test('EM-10: eventos del roster solo del servidor, con render completo y CTA absoluto', () => {
    const ids = Object.keys(rosterEvents);
    assert.deepEqual(ids.sort(), [
        'studio_artist_invite_email', 'studio_invitation_response', 'studio_invite_link_joined',
        'studio_membership_request_created', 'studio_membership_request_decision'
    ]);
    for (const id of ids) {
        const ev = rosterEvents[id];
        assert.equal(ev.serverOnly, true, id);
        assert.equal(typeof ev.recipient, 'function', id);
        assert.ok(['artist', 'studio'].includes(ev.render.audience), id);
        assert.equal(ev.render.category, 'studios', id);
        for (const key of ['subject', 'preheader', 'headline', 'intro', 'rows', 'cta']) assert.equal(typeof ev.render[key], 'function', `${id}.${key}`);
    }
});

test('EM-10: payloads con destinatario correcto, sin "undefined" y CTA de la app', () => {
    const base = 'https://beta.weotzi.com';
    const membership = { id: 'm1', role: 'resident', status: 'active', studio_id: STUDIO };
    const studio = { id: STUDIO, name: 'La Aguja' };
    const artist = { name: 'Ana Ink', username: 'ana', email: 'ana@x.com' };
    const owner = { email: 'dueno@aguja.com', name: 'La Aguja' };
    const created = roster.buildRosterEmailPayload('studio_membership_request_created', { membership: { ...membership, status: 'requested' }, studio, artist, owner, base, message: 'Hola' });
    assert.equal(created.to, 'dueno@aguja.com');
    assert.equal(created.cta_url, `${base}/studio/dashboard#roster`);
    const decision = roster.buildRosterEmailPayload('studio_membership_request_decision', { membership, studio, artist, base });
    assert.equal(decision.to, 'ana@x.com');
    assert.equal(decision.decision, 'accepted');
    const rejected = roster.buildRosterEmailPayload('studio_membership_request_decision', { membership: { ...membership, status: 'rejected' }, studio, artist, base });
    assert.equal(rejected.decision, 'rejected');
    const email = roster.buildRosterEmailPayload('studio_artist_invite_email', { membership, studio, base, url: `${base}/artist/join-studio?unirse=t`, inviteeEmail: 'nuevo@x.com' });
    assert.equal(email.to, 'nuevo@x.com');
    for (const payload of [created, decision, rejected, email]) {
        assert.doesNotMatch(JSON.stringify(payload), /undefined|null null/);
        assert.match(payload.cta_url, /^https:\/\/beta\.weotzi\.com\//);
        const ev = rosterEvents[Object.keys(rosterEvents).find((k) => payload === created ? k === 'studio_membership_request_created'
            : payload === email ? k === 'studio_artist_invite_email' : k === 'studio_membership_request_decision')];
        assert.equal(typeof ev.render.subject(payload), 'string');
        assert.ok(ev.render.cta(payload).url.startsWith('https://'));
    }
});

test('ROSTER-06: invitación por email responde igual con o sin cuenta (anti-enumeración)', async () => {
    const sent = [];
    const sendEmail = async (id, payload) => { sent.push([id, payload]); return { ok: true }; };
    const withAccount = fakeRepo({ findArtistByEmail: async () => ({ user_id: ARTIST, email: 'ana@x.com', name: 'Ana' }) });
    const r1 = await roster.createRosterService({ repo: withAccount, sendEmail }).inviteByEmail({
        studio: { id: STUDIO, name: 'La Aguja' }, createdBy: OWNER, appBase: 'https://b.w',
        input: { email: 'ana@x.com', role: 'guest', locationId: LOC, message: 'Ven' }
    });
    const inserted = withAccount.calls.find(([k]) => k === 'insertMembership')[1];
    assert.deepEqual([inserted.status, inserted.initiated_by, inserted.role], ['pending_acceptance', 'studio', 'guest']);
    assert.equal(sent[0][0], 'studio_roster_invite');

    const noAccount = fakeRepo();
    const r2 = await roster.createRosterService({ repo: noAccount, sendEmail }).inviteByEmail({
        studio: { id: STUDIO, name: 'La Aguja' }, createdBy: OWNER, appBase: 'https://b.w',
        input: { email: 'nuevo@x.com', role: 'resident' }
    });
    const issued = noAccount.calls.find(([k]) => k === 'issue')[1];
    assert.deepEqual([issued.inviteeEmail, issued.maxUses, issued.requiresApproval], ['nuevo@x.com', 1, false]);
    assert.equal(sent[1][0], 'studio_artist_invite_email');
    assert.match(sent[1][1].cta_url, /^https:\/\/b\.w\/artist\/join-studio\?unirse=/);
    assert.deepEqual(r1, r2);
});

// ----------------------------------------------------------------- rutas

function fakeApp() {
    const routesMap = {};
    const add = (method) => (route, ...handlers) => { routesMap[`${method} ${route}`] = handlers[handlers.length - 1]; };
    return { routes: routesMap, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}
function fakeRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(k, v) { this.headers[k] = v; return this; }
    };
}

test('rutas: solo el dueño (o soporte) genera enlaces; el preview no expone datos del dueño', async () => {
    const app = fakeApp();
    const service = {
        issueInviteLink: async () => ({ id: 'l', url: 'u', token: 't' }),
        previewInvite: async (token) => (token === 'ok' ? { status: 'valid', studio: { name: 'La Aguja' } } : { status: 'expired' })
    };
    let caller = { id: ARTIST };
    routes.register(app, {
        resolveBearerUser: async () => caller,
        applicationBase: () => 'https://b.w',
        service,
        repo: fakeRepo()
    });
    for (const key of ['POST /api/studio/invite-links', 'GET /api/studio/invite-links', 'DELETE /api/studio/invite-links/:id',
        'POST /api/studio/invite-email', 'POST /api/studio/roster-notify', 'GET /api/studio-invite/:token',
        'POST /api/studio-invite/:token/join', 'POST /api/artist/studio-notify', 'POST /api/artist/studio-sync']) {
        assert.equal(typeof app.routes[key], 'function', key);
    }
    let res = fakeRes();
    await app.routes['POST /api/studio/invite-links']({ body: { studio_id: STUDIO } }, res);
    assert.equal(res.statusCode, 403);
    caller = { id: OWNER };
    res = fakeRes();
    await app.routes['POST /api/studio/invite-links']({ body: { studio_id: STUDIO, role: 'resident' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');

    res = fakeRes();
    await app.routes['GET /api/studio-invite/:token']({ params: { token: 'viejo' } }, res);
    assert.equal(res.statusCode, 410);
    res = fakeRes();
    await app.routes['GET /api/studio-invite/:token']({ params: { token: 'ok' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.stringify(res.body).includes(OWNER), false);
});

test('rutas: el aviso del artista exige que la membresía sea suya y esté en el estado correcto', async () => {
    const app = fakeApp();
    const notified = [];
    routes.register(app, {
        resolveBearerUser: async () => ({ id: 'otro-usuario' }),
        applicationBase: () => 'https://b.w',
        service: { notify: async (...args) => { notified.push(args); return { ok: true }; }, syncArtistStudio: async () => ({}) },
        repo: fakeRepo()
    });
    const res = fakeRes();
    await app.routes['POST /api/artist/studio-notify']({ body: { kind: 'membership_request_created', membership_id: '55555555-5555-4555-8555-555555555555' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(notified.length, 0);
});

test('rpcErrorMessage solo muestra mensajes propios en español', () => {
    const own = new Error('PostgREST POST rpc failed (400): {"code":"22023","message":"La sede elegida no pertenece a tu estudio."}');
    assert.equal(routes.rpcErrorMessage(own, 'x'), 'La sede elegida no pertenece a tu estudio.');
    assert.equal(routes.rpcErrorMessage(new Error('{"message":"relation foo does not exist"}'), 'genérico'), 'genérico');
});

test('tope diario de invitaciones por email por estudio', () => {
    const id = 'studio-tope-test';
    for (let i = 0; i < routes.EMAIL_INVITES_PER_DAY; i += 1) assert.equal(routes.takeEmailInviteSlot(id), true);
    assert.equal(routes.takeEmailInviteSlot(id), false);
});

// ------------------------------------------------------------- servidor

test('server.js: rutas del roster registradas con una línea y finalize con solicitud validada', () => {
    const src = read('server.js');
    assert.match(src, /rosterRoutes\.register\(app, \{ resolveBearerUser, applicationBase \}\);/);
    assert.ok(src.indexOf('rosterRoutes.register(app') < src.indexOf('app.listen('));
    assert.doesNotMatch(src, /return \{ studioId: formData\.studio_id/, 'el studio_id del cliente ya no se usa sin validar');
    assert.match(src, /validateRegistrationStudio\(formData\.studio_id\)/);
    const start = src.indexOf("app.post('/api/register/artist-finalize'");
    const handler = src.slice(start, src.indexOf('Registration uniqueness check', start));
    assert.match(handler, /resolveRegistrationInvite\(formData\.studio_invite_token\)/);
    assert.match(handler, /studioId: null,/);
    assert.match(handler, /membership_pending: studioMembership\.membershipStatus === 'requested'/);
    // Un estudio con dueño no recibe sedes nuevas desde el registro.
    assert.match(src, /if \(studioHasOwner\) \{\s*if \(selectedLocation\) return \{ locationId: selectedLocation\.id \};/);
    // ROSTER-13: 'shortlisted' cuenta como aceptada para el email del spot.
    assert.match(src, /app\.status === 'shortlisted' \? 'accepted' : app\.status/);
});

test('migraciones del roster: rango de timestamps, RLS sin políticas, RPC solo service_role y rollback', () => {
    const dir = path.join(root, 'supabase', 'migrations');
    const mine = fs.readdirSync(dir).filter((f) => /^20261115230\d{3}_/.test(f));
    assert.deepEqual(mine.sort(), ['20261115230000_studio_invite_links.sql', '20261115230500_backfill_membership_initiated_by.sql']);
    for (const f of mine) assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollbacks', f.replace('.sql', '.down.sql'))), f);
    const sql = read('supabase', 'migrations', '20261115230000_studio_invite_links.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.studio_invite_links/);
    assert.match(sql, /ALTER TABLE public\.studio_invite_links ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.studio_invite_links FROM PUBLIC, anon, authenticated/);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.redeem_studio_invite_link\(text, uuid\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /PERFORM private\.lock_studio_artist_pair/);
    assert.match(sql, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.doesNotMatch(sql, /artist_user_id uuid NOT NULL REFERENCES public\.artists_db/, 'sin FK que bloquee la compensación');
    const backfill = read('supabase', 'migrations', '20261115230500_backfill_membership_initiated_by.sql');
    assert.match(backfill, /SET initiated_by = 'artist'[\s\S]*role = 'resident'[\s\S]*invited_at IS NULL[\s\S]*invited_by_user_id IS NULL/);
});

// -------------------------------------------------------------- frontend

test('repo: roster público por studio_public_roster y altas por RPC (accept/reject)', () => {
    const repo = read('public', 'shared', 'js', 'data', 'studios-repo.js');
    assert.match(repo, /from\('studio_public_roster'\)/);
    assert.match(repo, /rpc\('decide_studio_membership_request'/);
    assert.match(repo, /rpc\('request_studio_membership'/);
    assert.match(repo, /rpc\('withdraw_studio_membership_request'/);
    assert.match(repo, /current_contract_id/);
    assert.match(repo, /\.eq\('status', 'paused'\)/, 'reactivar solo desde pausado');
    const artists = read('public', 'shared', 'js', 'data', 'artists-repo.js');
    assert.match(artists, /replace\(\/\[,\(\)\*%\\\\:"'\]\/g, ' '\)/);
    assert.match(artists, /\.not\('user_id', 'is', null\)/);
});

test('ROSTER-08: el buscador sanea comas y paréntesis antes del filtro or=', async () => {
    let orArg = null;
    const builder = {
        select() { return this; },
        or(arg) { orArg = arg; return this; },
        not() { return this; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        in() { return this; }, eq() { return this; }, ilike() { return this; }, order() { return this; }
    };
    const sandbox = { window: { WeotziData: { from: () => builder, getClient: () => ({}) } }, console };
    sandbox.window.window = sandbox.window;
    vm.runInNewContext(read('public', 'shared', 'js', 'data', 'artists-repo.js'), sandbox);
    await sandbox.window.WeotziData.Artists.searchByUsernameOrName('ana,(x)*');
    assert.equal(orArg, 'username.ilike.%ana x%,name.ilike.%ana x%');
    const short = await sandbox.window.WeotziData.Artists.searchByUsernameOrName(',');
    assert.equal(JSON.stringify(short), JSON.stringify({ data: [], error: null }));
});

test('panel Equipo (E-TEAM-01..04): filtros, solicitudes, enlace, invitación con condiciones y escape', () => {
    const html = read('public', 'studio', 'dashboard', 'index.html');
    for (const id of ['team-filter-q', 'team-filter-role', 'team-filter-location', 'team-filter-status', 'team-requests',
        'team-invite', 'team-email-invite', 'team-links', 'team-link-form', 'link-approval', 'link-ttl', 'roster-content',
        'roster-change-requests', 'invite-provides', 'invite-contact-email']) {
        assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.match(html, /studio-dashboard-team\.js/);
    assert.ok(html.indexOf('studio-dashboard-team.js') < html.indexOf('/shared/js/studio-dashboard.js"'));
    const team = read('public', 'shared', 'js', 'studio-dashboard-team.js');
    assert.match(team, /Finalizar colaboración/);
    assert.match(team, /Vínculo con \$\{esc\(name\)\}/);
    assert.match(team, /\/api\/studio\/roster-notify/);
    assert.match(team, /\/api\/studio\/invite-links/);
    assert.match(team, /\/api\/studio\/invite-email/);
    assert.match(team, /saveInvitationDetails/);
    assert.match(team, /listFutureBookingsForArtist/);
    assert.match(team, /aria-modal="true"/);
    assert.match(team, /STATUS_LABELS = \{[\s\S]*Invitación pendiente[\s\S]*Solicitud pendiente/);
    // Todo dato de artista entra por esc().
    assert.doesNotMatch(team, /\$\{a\.name\}|\$\{a\.username\}|\$\{row\.message\}/);
    const dash = read('public', 'shared', 'js', 'studio-dashboard.js');
    assert.match(dash, /\.studio-invite-form, #roster-content, \.steam-toolbar, #team-email-invite, #team-requests, \.steam-roster, #team-links/);
    assert.match(dash, /WeOtziStudioTeam/);
    assert.match(dash, /inviteFromSpot\(spot\.id, artistUserId\)/);
    assert.doesNotMatch(dash, /Aceptado y sumado al roster/);
    const css = read('public', 'shared', 'css', 'studio-team-ds.css');
    assert.match(css, /@media \(max-width:640px\)/);
    assert.doesNotMatch(css, /border-radius:\s*(?!2px|999px)[1-9]/, 'radius 0 salvo píldora y avatar');
});

test('friendlyError del panel traduce 23505 y respeta mensajes del guard', () => {
    const sandbox = { window: {}, document: { body: { dataset: {} } }, console };
    sandbox.window.window = sandbox.window;
    vm.runInNewContext(read('public', 'shared', 'js', 'studio-dashboard-team.js'), sandbox);
    const fe = sandbox.window.WeOtziStudioTeam._friendlyError;
    assert.match(fe({ code: '23505', message: 'duplicate key' }), /vínculo abierto/);
    assert.equal(fe({ code: '23514', message: 'El rol y el reparto se editan con una nueva versión del contrato.' }), 'El rol y el reparto se editan con una nueva versión del contrato.');
    assert.equal(fe({ message: 'internal error xyz' }, 'fallback'), 'fallback');
});

test('artista: solicitudes enviadas con Retirar, "Quiero sumarme" y avisos al estudio', () => {
    const inv = read('public', 'shared', 'js', 'artist-invitations.js');
    assert.match(inv, /listRequestsForArtist/);
    assert.match(inv, /withdrawRequest\(membershipId\)/);
    assert.match(inv, /notifyStudio\('invitation_response', membershipId\)/);
    assert.match(inv, /\/api\/artist\/studio-notify/);
    const studio = read('public', 'shared', 'js', 'invitations-studio.js');
    assert.match(studio, /Quiero sumarme/);
    assert.match(studio, /requestMembership\(\{/);
    assert.match(studio, /notifyStudio\('membership_request_created', membershipId\)/);
    // Integración (perfil de verif-estudio, sin user_id en el select público):
    // el botón sale de linksHtml solo si Studios.hasOwner confirma un dueño.
    const profile = read('public', 'shared', 'js', 'studio-profile.js');
    const sp = require('../public/shared/js/studio-profile.js');
    assert.equal(sp.joinStudioUrl('a b'), '/artist/invitations?estudio=a%20b');
    const owned = sp.linksHtml({ id: '<x>' }, { hasOwner: true });
    assert.match(owned, /href="\/artist\/invitations\?estudio=%3Cx%3E"[^>]*>Soy artista: quiero sumarme<\/a>/);
    assert.doesNotMatch(sp.linksHtml({ id: 'x' }, {}), /quiero sumarme/);
    assert.match(profile, /hasOwner = !!\(owned && owned\.data\);/);
    assert.match(read('public', 'shared', 'js', 'data', 'studios-repo.js'), /hasOwner\(studioId\) \{\s*\n\s*return from\('studios'\)\.select\('id'\)\.eq\('id', studioId\)\.not\('user_id', 'is', null\)\.maybeSingle\(\);/);
    const account = read('public', 'shared', 'js', 'artist-account.js');
    assert.match(account, /requestMembership\(\{ studioId, role: 'resident' \}\)/);
    const legacyDash = read('public', 'shared', 'js', 'dashboard.js');
    assert.doesNotMatch(legacyDash, /studio_id: resolvedStudioId,\n\s*work_type: normalizedWorkType/);
});

test('enlace en el registro y página /artist/join-studio', () => {
    const reg = read('public', 'shared', 'js', 'register.js');
    assert.match(reg, /studio_invite_token: window\.WeOtziStudioInvite \? \(window\.WeOtziStudioInvite\.getToken\(\) \|\| null\) : null/);
    assert.match(reg, /window\.WeOtziStudioInvite\?\.afterFinalize\(finalizeData\)/);
    assert.match(reg, /if \(!finalizeData\.membership_pending\) \{/);
    const helper = read('public', 'shared', 'js', 'register-studio-invite.js');
    assert.match(helper, /'wo:studio-invite-token'/);
    assert.match(helper, /\/api\/studio-invite\//);
    for (const page of [['public', 'register-artist', 'index.html'], ['public', 'registerclosedbeta', 'index.html']]) {
        assert.match(read(...page), /register-studio-invite\.js/);
    }
    const join = read('public', 'artist', 'join-studio', 'index.html');
    assert.match(join, /studio-join\.js/);
    assert.match(join, /<meta name="robots" content="noindex">/);
    const js = read('public', 'shared', 'js', 'studio-join.js');
    assert.match(js, /\/join'/);
    assert.match(js, /\/registerclosedbeta\?unirse=/);
    assert.match(js, /\/artist\/login\?returnTo=/);
});
