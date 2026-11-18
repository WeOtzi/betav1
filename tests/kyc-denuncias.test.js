'use strict';
// 2.7.0 · Plan de identidad, suplantación y plagio · fase 1 · T1 «Denuncias abiertas».
// Cubre: cualquier persona con sesión denuncia perfiles (cliente, artista, estudio),
// autodenuncia bloqueada, catálogo de motivos con pistas alineado, tope de 5 en
// 24 h contra el SQL, reclamo del titular (prioridad, confirmación de soporte y
// bumpClaimantReports), imagen del portafolio (dueño verificado y duplicado que
// suma la imagen), correo del resultado al resolver y botón para visitantes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-test-key';

const D = require('../lib/denuncias');
const routes = require('../lib/routes/denuncias');
const repoModule = require('../lib/repos/denuncias');
const WoReport = require('../public/shared/js/wo-report.js');
const Panel = require('../public/shared/js/support-dashboard-reports.js');
const StudioProfile = require('../public/shared/js/studio-profile.js');
const R = WoReport._internal;
const P = Panel._internal;

const MIGRATION = 'supabase/migrations/20261118110000_denuncias_abiertas.sql';
const ROLLBACK = 'supabase/rollbacks/20261118110000_denuncias_abiertas.down.sql';

const ARTIST = '11111111-1111-4111-8111-111111111111';
const OTHER_ARTIST = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const AGENT = '66666666-6666-4666-8666-666666666666';
const STUDIO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDIO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TICKET = '99999999-9999-4999-8999-999999999999';
const REPORT_ID = '88888888-8888-4888-8888-888888888888';
const DESCRIPTION = 'Publica como propias las fotos de mis trabajos de los últimos meses.';
const SARA_WORK = 'https://cdn.example.com/artist-gallery/sara/koi.jpg';

function mockRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; }
    };
}

function fakeRepo(overrides = {}) {
    const artists = {
        [ARTIST]: {
            id: 'a1111111-1111-4111-8111-111111111111', user_id: ARTIST, name: 'Mateo Rivas', username: 'mateo.ink',
            instagram: '@mateo.ink', instagram_verified_at: '2026-11-10T00:00:00Z', instagram_verified_handle: 'mateo.ink'
        },
        [OTHER_ARTIST]: { id: 'a2222222-2222-4222-8222-222222222222', user_id: OTHER_ARTIST, name: 'Sara Luna', username: 'sara.luna', studio_id: STUDIO_A }
    };
    const studios = {
        [STUDIO_A]: { id: STUDIO_A, user_id: OWNER, name: 'Estudio Norte', slug: 'estudio-norte', instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: 'estudionorte' },
        [STUDIO_B]: { id: STUDIO_B, user_id: OTHER_ARTIST, name: 'Tinta Sur', slug: 'tinta-sur' }
    };
    const calls = { createReport: [], updates: [], notes: [], dossiers: [], portfolio: [] };
    return {
        ATTACHMENTS_BUCKET: 'support-attachments',
        CHAT_BUCKET: 'chat-attachments',
        calls,
        async getAuthUserContact(id) {
            const emails = { [ARTIST]: 'mateo@auth.example', [CLIENT]: 'lucia@auth.example', [OWNER]: 'owner@auth.example', [OTHER_ARTIST]: 'sara@auth.example' };
            return emails[id] ? { id, email: emails[id], email_confirmed_at: '2026-01-01T00:00:00Z', full_name: 'Nombre Auth' } : null;
        },
        async getActiveSupportUser(id) { return id === AGENT ? { user_id: AGENT, email: 'agente@weotzi.com', full_name: 'Ana Soporte' } : null; },
        async activeSupportEmails() { return ['agente@weotzi.com']; },
        async supportNamesByIds() { return new Map(); },
        async getArtistByUserId(id) { return artists[id] || null; },
        async findArtist(ref) {
            return Object.values(artists).find((a) => (ref.by === 'uuid' ? (a.user_id === ref.value || a.id === ref.value) : a.username === ref.value)) || null;
        },
        async getClientByUserId(id) { return id === CLIENT ? { user_id: CLIENT, full_name: 'Lucía Fernández', city_residence: 'Lima' } : null; },
        async findStudio(ref) { return Object.values(studios).find((s) => (ref.by === 'id' ? s.id === ref.value : s.slug === ref.value)) || null; },
        async listAdministeredStudios(id) {
            if (id === OWNER) return [{ studio: studios[STUDIO_A], role: 'studio_owner' }];
            if (id === OTHER_ARTIST) return [{ studio: studios[STUDIO_B], role: 'studio_owner' }];
            return [];
        },
        async getPortfolioSources(kind, id) {
            calls.portfolio.push({ kind, id });
            if (kind === 'artist' && id === OTHER_ARTIST) {
                return [
                    { source: 'gallery_feed_items', items: [{ id: 'koi-1', url: SARA_WORK, category: 'flash' }, { url: 'https://cdn.example.com/x/otra.png' }] },
                    { source: 'gallery_images', items: JSON.stringify(['https://cdn.example.com/legacy/vieja.jpg']) }
                ];
            }
            if (kind === 'studio' && id === STUDIO_B) return [{ source: 'photo_feed_items', items: [{ url: 'https://cdn.example.com/studio/sala.jpg' }] }];
            return [];
        },
        async findQuotation() { return null; },
        async listQuotationMessages() { return { messages: [], total: 0 }; },
        async listQuotationAttachments() { return []; },
        async createReport(report) {
            calls.createReport.push(report);
            return { duplicate: false, ticket_id: TICKET, ticket_number: 42, report_id: REPORT_ID, status: 'open', created_at: '2026-11-18T14:00:00Z' };
        },
        async getReportByTicket() { return null; },
        async listTicketMessages() { return []; },
        async updateReportTicket(id, patch) { calls.updates.push({ id, patch }); return { id, ticket_number: 42, status: patch.status || 'open', priority: patch.priority || 'high' }; },
        // Una clave del expediente por escritura (RPC patch_support_report_dossier).
        async patchReportDossierKey(id, key, value, opts = {}) {
            calls.dossiers.push({ id, key, value, opts });
            return value == null ? {} : { [key]: value };
        },
        async addTicketMessage(row) { calls.notes.push(row); return { id: 'n1', author_role: row.authorRole, body: row.body, is_internal: row.isInternal, created_at: '2026-11-18T15:00:00Z' }; },
        async signObject() { return null; },
        ...overrides
    };
}

async function run(handler, { userId, body, query, params, repo = fakeRepo(), superadmin = false } = {}) {
    const emails = [];
    const restore = routes._internal.setDeps({
        repo,
        resolveBearerUser: async () => (userId ? { id: userId, email: 'token@example.com' } : null),
        isSuperadminEmail: () => superadmin,
        sendEmail: async (eventId, payload, options) => { emails.push({ eventId, payload, options }); return { ok: true }; },
        applicationBase: () => 'https://beta.weotzi.com',
        now: () => new Date('2026-11-18T14:00:00Z')
    });
    const res = mockRes();
    try {
        await handler({ headers: {}, body: body || {}, query: query || {}, params: params || {} }, res);
    } finally {
        restore();
    }
    return { res, repo, emails };
}

const artistBody = (extra = {}) => ({ kind: 'artist', target_id: 'sara.luna', reason: 'suplantacion_identidad', description: DESCRIPTION, ...extra });
const studioBody = (extra = {}) => ({ kind: 'studio', target_id: 'tinta-sur', reason: 'estafa', description: DESCRIPTION, ...extra });

// ---------------------------------------------------------------- migración

test('migración 20261118110000: rol client, motivos nuevos, claimed_instagram y RPC desde la definición viva', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);
    assert.match(sql, /md5\(def\) <> '22bed5f7b623ed500e8b7c303a759e20'/, 'falla si la función viva no es la conocida');
    assert.match(sql, /reporter_role = any \(array\['artist'::text, 'studio_owner'::text, 'studio_manager'::text, 'client'::text\]\)/);
    for (const r of D.REASONS.artist) assert.ok(sql.includes(`'${r.code}'::text`), r.code);
    assert.match(sql, /add column if not exists claimed_instagram text/);
    assert.match(sql, /create index if not exists support_ticket_reports_claimed_instagram_idx[\s\S]*where claimed_instagram is not null/);
    assert.match(sql, /claimed_instagram \^\~|claimed_instagram ~ '\^\[a-z0-9\._\]\{1,30\}\$'/);
    assert.match(sql, /quotation_id, quote_id, evidence_links, dossier, claimed_instagram/);
    assert.match(sql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
    assert.match(sql, /r\.reason = v_reason/, 'sigue deduplicando por denunciante + objetivo + motivo');
    assert.match(sql, /revoke all on function public\.create_support_report\(jsonb\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.create_support_report\(jsonb\) to service_role;/);
    const insert = sql.slice(sql.indexOf('insert into public.support_tickets'), sql.indexOf('returning * into v_ticket'));
    assert.doesNotMatch(insert, /counterpart_user_id/, 'el denunciado nunca es contraparte del ticket');
});

test('tope diario: D.DAILY_LIMIT = 5 es la constante del SQL (y la reversa vuelve a 10)', () => {
    assert.equal(D.DAILY_LIMIT, 5);
    const limit = /v_daily_limit constant integer := (\d+);/.exec(read(MIGRATION));
    assert.ok(limit, 'falta v_daily_limit en la migración');
    assert.equal(Number(limit[1]), D.DAILY_LIMIT);
    const rollback = read(ROLLBACK);
    assert.equal(Number(/v_daily_limit constant integer := (\d+);/.exec(rollback)[1]), 10);
    assert.match(rollback, /drop column if exists claimed_instagram/);
    assert.match(rollback, /reporter_role = any \(array\['artist'::text, 'studio_owner'::text, 'studio_manager'::text\]\)\) not valid/);
    assert.match(rollback, /validate constraint support_ticket_reports_reason_check/);
    assert.doesNotMatch(rollback, /delete from public\.support_ticket_reports/, 'la reversa no borra denuncias');
});

// ---------------------------------------------------------------- catálogo

test('catálogo de motivos de perfil: mismo orden, etiquetas cortas y pistas en servidor y modal', () => {
    assert.deepEqual(D.REASONS.artist.map((r) => r.code), ['suplantacion_identidad', 'plagio_diseno', 'robo_propiedad_intelectual', 'difamacion', 'estafa']);
    assert.deepEqual(R.REASONS, D.REASONS);
    assert.deepEqual(R.reasonsFor('artist'), D.reasonsFor('artist'));
    assert.deepEqual(R.CLAIM_REASONS, D.CLAIM_REASONS);
    const hints = Object.fromEntries(D.REASONS.artist.map((r) => [r.code, r.hint]));
    assert.equal(hints.suplantacion_identidad, 'Se hace pasar por otra persona o estudio');
    assert.equal(hints.plagio_diseno, 'Publica diseños o fotos de otro artista como propios');
    assert.equal(hints.robo_propiedad_intelectual, 'Usa la marca, el logo o el nombre de otro');
    assert.equal(hints.estafa, 'Cobró y no cumplió, o pidió pagos fuera de la plataforma');
    for (const r of D.REASONS.artist) assert.ok(r.label.length <= 30 && r.hint, r.code);
    assert.equal(D.REASONS.quotation.some((r) => 'hint' in r), false);
    assert.equal(D.REPORTER_ROLE_LABELS.client, 'Cliente');
    assert.deepEqual(D.REPORTER_ROLES, ['artist', 'studio_owner', 'studio_manager', 'client']);
});

// ---------------------------------------------------------------- quién denuncia

test('un cliente denuncia a un artista y a un estudio; el acuse va a su panel de cliente', async () => {
    const artist = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody() });
    assert.equal(artist.res.statusCode, 201);
    const report = artist.repo.calls.createReport[0];
    assert.equal(report.reporter_role, 'client');
    assert.equal(report.requester_role, 'client');
    assert.equal(report.reporter_studio_id, null);
    assert.equal(report.target_key, `artist:${OTHER_ARTIST}`);
    assert.equal(report.dossier.reporter.role_label, 'Cliente');
    assert.equal(report.dossier.reporter.name, 'Lucía Fernández', 'nombre de clients_db');
    assert.equal(report.dossier.reporter.client.name, 'Lucía Fernández');
    assert.equal(report.dossier.reporter.profile_path, '');
    assert.equal(report.dossier.reporter.email, 'lucia@auth.example');
    const receipt = artist.emails.find((e) => e.eventId === 'report_ticket_received');
    assert.equal(receipt.payload.recipient_role, 'client');

    const studio = await run(routes._internal.submitHandler, { userId: CLIENT, body: studioBody() });
    assert.equal(studio.res.statusCode, 201);
    const sr = studio.repo.calls.createReport[0];
    assert.equal(sr.reporter_role, 'client');
    assert.equal(sr.reported_studio_id, STUDIO_B);
    assert.equal(sr.priority, 'urgent', 'estafa entra como urgente');

    const { renderEmail } = require('../lib/email-render');
    assert.equal(renderEmail('report_ticket_received', { ...receipt.payload }).cta.url, 'https://beta.weotzi.com/client/dashboard');
});

test('un dueño de estudio puede denunciar a un artista de su propio roster; nadie se denuncia a sí mismo', async () => {
    const roster = await run(routes._internal.submitHandler, { userId: OWNER, body: artistBody({ reason: 'difamacion' }) });
    assert.equal(roster.res.statusCode, 201);
    assert.equal(roster.repo.calls.createReport[0].reporter_role, 'studio_owner');
    assert.equal(roster.repo.calls.createReport[0].reporter_studio_id, STUDIO_A);
    assert.equal(roster.repo.calls.createReport[0].dossier.reporter.name, 'Estudio Norte');
    assert.equal(roster.emails.find((e) => e.eventId === 'report_ticket_received').payload.recipient_role, 'studio');

    const selfArtist = await run(routes._internal.submitHandler, { userId: OTHER_ARTIST, body: artistBody() });
    assert.equal(selfArtist.res.statusCode, 409);
    assert.equal(selfArtist.res.body.code, 'SELF_REPORT');
    const selfStudio = await run(routes._internal.submitHandler, { userId: OWNER, body: studioBody({ target_id: 'estudio-norte' }) });
    assert.equal(selfStudio.res.statusCode, 409);
    const ownerOfB = await run(routes._internal.submitHandler, { userId: OTHER_ARTIST, body: studioBody() });
    assert.equal(ownerOfB.res.statusCode, 409, 'el dueño no denuncia su estudio');
    for (const out of [selfArtist, selfStudio, ownerOfB]) assert.equal(out.repo.calls.createReport.length, 0);

    const anon = await run(routes._internal.submitHandler, { body: artistBody() });
    assert.equal(anon.res.statusCode, 401);
    const quote = await run(routes._internal.submitHandler, { userId: CLIENT, body: { kind: 'quotation', target_id: '55', reason: 'spam', description: DESCRIPTION } });
    assert.equal(quote.res.statusCode, 403, 'las cotizaciones las sigue denunciando solo el artista');
});

// ---------------------------------------------------------------- reclamo del titular

test('reclamo del titular: Instagram ya validado → urgente; sin validar → alta; se guarda claimed_instagram', async () => {
    const validated = await run(routes._internal.submitHandler, {
        userId: ARTIST,
        body: artistBody({ claim: { is_victim: true, instagram: 'https://www.instagram.com/Mateo.Ink/', proof_link: 'https://instagram.com/p/abc' } })
    });
    assert.equal(validated.res.statusCode, 201);
    const r1 = validated.repo.calls.createReport[0];
    assert.equal(r1.priority, 'urgent');
    assert.equal(r1.claimed_instagram, 'mateo.ink');
    assert.deepEqual(r1.dossier.claim, {
        is_victim: true, instagram: 'mateo.ink', proof_link: 'https://instagram.com/p/abc', instagram_validated: true, validated_via: 'artist_instagram'
    });
    assert.equal(validated.emails.find((e) => e.eventId === 'report_ticket_created_support').payload.priority_label, 'Urgente');

    // El estudio que administra validó su Instagram.
    const studioClaim = await run(routes._internal.submitHandler, {
        userId: OWNER, body: artistBody({ reason: 'plagio_diseno', claim: { is_victim: true, instagram: '@EstudioNorte' } })
    });
    assert.equal(studioClaim.repo.calls.createReport[0].dossier.claim.validated_via, 'studio_instagram');
    assert.equal(studioClaim.repo.calls.createReport[0].priority, 'urgent');

    const pending = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody({ claim: { is_victim: true, instagram: '@lucia.tattoo' } }) });
    const r2 = pending.repo.calls.createReport[0];
    assert.equal(r2.priority, 'high');
    assert.equal(r2.claimed_instagram, 'lucia.tattoo');
    assert.equal(r2.dossier.claim.instagram_validated, false);

    const missing = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody({ claim: { is_victim: true, instagram: 'no válido!' } }) });
    assert.equal(missing.res.statusCode, 400);
    assert.equal(missing.res.body.field, 'claim_instagram');
    const badProof = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody({ claim: { is_victim: true, instagram: 'lucia', proof_link: 'javascript:alert(1)' } }) });
    assert.equal(badProof.res.body.field, 'claim_proof');

    // Otro motivo o is_victim false: el reclamo se ignora.
    const other = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody({ reason: 'difamacion', claim: { is_victim: true, instagram: 'lucia' } }) });
    assert.equal(other.repo.calls.createReport[0].claimed_instagram, null);
    assert.equal(other.repo.calls.createReport[0].dossier.claim, null);
    assert.equal(D.parseClaim({ is_victim: false, instagram: 'x' }, { kind: 'artist', reason: 'plagio_diseno' }).claim, null);
});

test('soporte confirma al titular: urgente, reclamo validado por soporte y nota interna', async () => {
    const stored = () => ({
        id: REPORT_ID, ticket_id: TICKET, reporter_user_id: CLIENT, reporter_role: 'client', target_kind: 'artist', reason: 'suplantacion_identidad',
        dossier: { claim: { is_victim: true, instagram: 'lucia.tattoo', proof_link: null, instagram_validated: false, validated_via: null }, reporter: { name: 'Lucía' } },
        ticket: { id: TICKET, ticket_number: 42, status: 'open', priority: 'high', assigned_support_user_id: null }
    });
    const repo = fakeRepo({ async getReportByTicket(id) { return id === TICKET ? stored() : null; } });
    const denied = await run(routes._internal.claimHandler, { userId: CLIENT, repo, params: { ticketId: TICKET } });
    assert.equal(denied.res.statusCode, 403);
    const ok = await run(routes._internal.claimHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { note: 'Me escribió desde @lucia.tattoo.' } });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.ticket.priority, 'urgent');
    assert.deepEqual(repo.calls.updates[0], { id: TICKET, patch: { priority: 'urgent', assigned_support_user_id: AGENT } });
    const write = repo.calls.dossiers[0];
    assert.equal(write.id, REPORT_ID);
    assert.equal(write.key, 'claim', 'solo cambia el reclamo, no el expediente entero');
    assert.deepEqual(write.opts.expect, stored().dossier.claim, 'compare-and-set sobre el reclamo leído');
    const claim = write.value;
    assert.equal(claim.instagram_validated, true);
    assert.equal(claim.validated_via, 'support');
    assert.equal(claim.confirmed_by, AGENT);
    assert.match(repo.calls.notes[0].body, /titular de @lucia\.tattoo/);
    assert.match(repo.calls.notes[0].body, /Me escribió desde/);

    const noClaimRepo = fakeRepo({ async getReportByTicket() { return { ...stored(), dossier: {} }; } });
    const noClaim = await run(routes._internal.claimHandler, { userId: AGENT, repo: noClaimRepo, params: { ticketId: TICKET } });
    assert.equal(noClaim.res.statusCode, 409);
    assert.equal(noClaim.res.body.code, 'NO_CLAIM');
    const missing = await run(routes._internal.claimHandler, { userId: AGENT, repo: fakeRepo(), params: { ticketId: TICKET } });
    assert.equal(missing.res.statusCode, 404);
});

test('bumpClaimantReports (contrato con T4): sube a urgente las denuncias abiertas con ese Instagram y deja nota', async () => {
    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
        const method = init.method || 'GET';
        requests.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
        let rows = [];
        if (method === 'GET' && String(url).includes('/support_ticket_reports?')) {
            rows = [
                { id: '20000000-0000-4000-8000-000000000001', ticket_id: '10000000-0000-4000-8000-000000000001', dossier: { claim: { is_victim: true, instagram: 'lucia.tattoo' }, reporter: { name: 'Lucía' } }, support_tickets: { id: 't1', status: 'open', priority: 'high' } },
                { id: '20000000-0000-4000-8000-000000000002', ticket_id: '10000000-0000-4000-8000-000000000002', dossier: { claim: { is_victim: true, instagram: 'lucia.tattoo', instagram_validated: true } }, support_tickets: { id: 't2', status: 'open', priority: 'urgent' } }
            ];
        } else if (method !== 'GET') {
            rows = [{ id: 'x' }];
        }
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(rows) };
    };
    let out;
    try {
        out = await repoModule.bumpClaimantReports(CLIENT, '@Lucia.Tattoo');
    } finally {
        global.fetch = originalFetch;
    }
    assert.deepEqual(out, { bumped: 1 }, 'la que ya estaba validada y urgente no se toca');
    const select = requests[0];
    assert.match(select.url, /reporter_user_id=eq\.33333333-3333-4333-8333-333333333333/);
    assert.match(select.url, /claimed_instagram=eq\.lucia\.tattoo/);
    assert.match(decodeURIComponent(select.url), /support_tickets\.status=in\.\("open","in_progress","waiting_user"\)/);
    const ticketPatch = requests.find((r) => r.method === 'PATCH' && r.url.includes('/support_tickets?'));
    assert.deepEqual(ticketPatch.body, { priority: 'urgent' });
    assert.match(ticketPatch.url, /kind=eq\.denuncia/);
    assert.equal(requests.some((r) => r.method === 'PATCH' && r.url.includes('/support_ticket_reports?')), false, 'no reescribe el expediente entero');
    const dossierPatch = requests.find((r) => r.method === 'POST' && r.url.includes('/rpc/patch_support_report_dossier'));
    assert.equal(dossierPatch.body.p_report_id, '20000000-0000-4000-8000-000000000001');
    assert.equal(dossierPatch.body.p_key, 'claim');
    assert.equal(dossierPatch.body.p_value.instagram_validated, true);
    assert.equal(dossierPatch.body.p_value.validated_via, 'instagram_code');
    assert.equal(dossierPatch.body.p_check, true);
    assert.deepEqual(dossierPatch.body.p_expect, { is_victim: true, instagram: 'lucia.tattoo' }, 'solo si el reclamo sigue como se leyó');
    const note = requests.find((r) => r.method === 'POST' && r.url.includes('/support_ticket_messages'));
    assert.equal(note.body.author_role, 'system');
    assert.equal(note.body.is_internal, true);
    assert.match(note.body.body, /El denunciante validó @lucia\.tattoo/);
    assert.equal(requests.filter((r) => r.method !== 'GET').length, 3);

    assert.deepEqual(await repoModule.bumpClaimantReports('no-uuid', 'lucia'), { bumped: 0 });
    assert.deepEqual(await repoModule.bumpClaimantReports(CLIENT, 'no válido!'), { bumped: 0 });
    assert.equal(typeof repoModule.DenunciasRepo.bumpClaimantReports, 'function');
});

// ---------------------------------------------------------------- imagen del portafolio

test('imagen denunciada: tiene que estar en el portafolio del denunciado y queda como referencia', async () => {
    const ok = await run(routes._internal.submitHandler, {
        userId: CLIENT, body: artistBody({ reason: 'plagio_diseno', item: { key: 'koi-1', image_url: `${SARA_WORK}?width=600` } })
    });
    assert.equal(ok.res.statusCode, 201);
    assert.deepEqual(ok.repo.calls.portfolio, [{ kind: 'artist', id: OTHER_ARTIST }]);
    const ref = ok.repo.calls.createReport[0].dossier.evidence.reference_item;
    assert.equal(ref.image_url, SARA_WORK, 'se guarda la URL del perfil, no la del navegador');
    assert.equal(ref.key, 'koi-1');
    assert.equal(ref.category, 'flash');
    assert.equal(ref.verified_owner, true);
    assert.deepEqual(ok.repo.calls.createReport[0].dossier.evidence.reference_items, [ref]);
    assert.deepEqual(ok.repo.calls.createReport[0].attachments, [], 'la imagen ajena no va a los adjuntos de Storage');

    const legacy = await run(routes._internal.submitHandler, { userId: CLIENT, body: artistBody({ reason: 'plagio_diseno', item: { key: 'vieja.jpg' } }) });
    assert.equal(legacy.res.statusCode, 201, 'por clave (nombre de archivo) en gallery_images');
    assert.equal(legacy.repo.calls.createReport[0].dossier.evidence.reference_item.source, 'gallery_images');

    const foreign = await run(routes._internal.submitHandler, {
        userId: CLIENT, body: artistBody({ reason: 'plagio_diseno', item: { key: 'mia', image_url: 'https://evil.example/mia.jpg' } })
    });
    assert.equal(foreign.res.statusCode, 400);
    assert.equal(foreign.res.body.field, 'item');
    assert.equal(foreign.repo.calls.createReport.length, 0);

    const studio = await run(routes._internal.submitHandler, {
        userId: CLIENT, body: studioBody({ reason: 'plagio_diseno', item: { key: 'sala.jpg', image_url: 'https://cdn.example.com/studio/sala.jpg' } })
    });
    assert.equal(studio.res.statusCode, 201);
    assert.equal(studio.repo.calls.createReport[0].dossier.evidence.reference_item.source, 'photo_feed_items');

    const onQuote = D.parseReportInput({ kind: 'quotation', target_id: '55', reason: 'spam', description: DESCRIPTION, item: { key: 'x', image_url: SARA_WORK } }, { userId: ARTIST });
    assert.equal(onQuote.ok, false);
    assert.equal(onQuote.field, 'item');
});

test('denuncia repetida desde otra foto: suma la imagen al expediente abierto con una nota', async () => {
    const existing = {
        id: REPORT_ID, ticket_id: TICKET, reporter_user_id: CLIENT,
        dossier: { evidence: { links: [], attachments: [], reference_item: { key: 'otra.png', image_url: 'https://cdn.example.com/x/otra.png' } }, reporter: { name: 'Lucía' } },
        ticket: { id: TICKET, ticket_number: 42, status: 'open' }
    };
    const repo = fakeRepo({
        async createReport(report) { repo.calls.createReport.push(report); return { duplicate: true, ticket_id: TICKET, ticket_number: 42, report_id: REPORT_ID, status: 'open' }; },
        async getReportByTicket(id) { return id === TICKET ? existing : null; }
    });
    const out = await run(routes._internal.submitHandler, {
        userId: CLIENT, repo, body: artistBody({ reason: 'plagio_diseno', item: { key: 'koi-1', image_url: SARA_WORK } })
    });
    assert.equal(out.res.statusCode, 200);
    assert.equal(out.res.body.duplicate, true);
    assert.equal(out.res.body.item_added, true);
    assert.match(out.res.body.message, /Sumamos esta imagen a tu denuncia abierta \(WO-00042\)/);
    const saved = repo.calls.dossiers[0];
    assert.equal(saved.id, REPORT_ID);
    assert.equal(saved.key, 'evidence', 'solo cambia la evidencia, no el expediente entero');
    assert.deepEqual(saved.opts.expect, existing.dossier.evidence, 'compare-and-set sobre la evidencia leída');
    assert.deepEqual(saved.value.reference_items.map((r) => r.image_url), ['https://cdn.example.com/x/otra.png', SARA_WORK]);
    assert.equal(saved.value.reference_item.key, 'otra.png', 'la primera referencia no cambia');
    assert.equal(repo.calls.notes[0].isInternal, true);
    assert.equal(repo.calls.notes[0].authorRole, 'system');
    assert.match(repo.calls.notes[0].body, /sumó otra imagen/);
    assert.equal(out.emails.length, 0, 'no se reenvían correos');

    // La misma imagen otra vez: nada que sumar.
    const again = D.appendReferenceItem({ ...existing.dossier, evidence: saved.value }, { key: 'koi-1', image_url: SARA_WORK });
    assert.equal(again, null);
    // Sin imagen, el duplicado responde como siempre.
    const plain = await run(routes._internal.submitHandler, { userId: CLIENT, repo, body: artistBody({ reason: 'plagio_diseno' }) });
    assert.equal(plain.res.body.item_added, false);
    assert.match(plain.res.body.message, /Ya tienes una denuncia abierta/);
});

test('el detalle de soporte trae las imágenes denunciadas y el reclamo sin rutas de Storage', async () => {
    const row = {
        id: REPORT_ID, ticket_id: TICKET, target_kind: 'artist', reason: 'plagio_diseno', reporter_user_id: CLIENT, reporter_role: 'client',
        reported_user_id: OTHER_ARTIST, reported_role: 'artist', claimed_instagram: 'lucia.tattoo', evidence_links: [],
        dossier: {
            evidence: { links: [], attachments: [{ path: `${CLIENT}/denuncias/a.png` }], reference_item: { key: 'koi-1', image_url: SARA_WORK, verified_owner: true } },
            claim: { is_victim: true, instagram: 'lucia.tattoo', instagram_validated: false }
        },
        ticket: { id: TICKET, ticket_number: 42, status: 'open', priority: 'high', attachments: [] }
    };
    const repo = fakeRepo({ async getReportByTicket() { return row; } });
    const { res } = await run(routes._internal.detailHandler, { userId: AGENT, repo, params: { ticketId: TICKET } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.report.claimed_instagram, 'lucia.tattoo');
    assert.equal(res.body.report.dossier.evidence.reference_items[0].image_url, SARA_WORK);
    assert.equal(res.body.report.dossier.claim.instagram, 'lucia.tattoo');
    assert.doesNotMatch(JSON.stringify(res.body), /"path":/);
});

// ---------------------------------------------------------------- correo del resultado

test('al resolver, el denunciante recibe report_outcome_notice (solo el ticket, sin datos del otro)', async () => {
    const stored = (status = 'in_progress') => ({
        id: REPORT_ID, ticket_id: TICKET, reporter_user_id: CLIENT, reporter_role: 'client', target_kind: 'artist', reason: 'estafa',
        dossier: { reporter: { contact_name: 'Lucía Fernández' }, reported: { name: 'Sara Luna', email: 'sara@auth.example' } },
        ticket: { id: TICKET, ticket_number: 42, status, assigned_support_user_id: AGENT }
    });
    const repo = fakeRepo({ async getReportByTicket() { return stored(); } });
    const resolved = await run(routes._internal.statusHandler, {
        userId: AGENT, repo, params: { ticketId: TICKET }, body: { status: 'resolved', outcome: 'resuelto', resolution: 'Se suspendió la cuenta denunciada.' }
    });
    assert.equal(resolved.res.statusCode, 200);
    assert.equal(resolved.res.body.outcome_notice_sent, true);
    assert.equal(resolved.emails.length, 1);
    const mail = resolved.emails[0];
    assert.equal(mail.eventId, 'report_outcome_notice');
    assert.equal(mail.options.idempotencyKey, `report_outcome_notice:${TICKET}`);
    assert.equal(mail.payload.recipient_email, 'lucia@auth.example', 'email de auth.users');
    assert.equal(mail.payload.recipient_role, 'client');
    assert.equal(mail.payload.ticket_code, 'WO-00042');
    assert.equal(mail.payload.outcome, 'resuelto');
    assert.doesNotMatch(JSON.stringify(mail.payload), /Sara|sara@|suspendió/, 'nada del denunciado ni de la resolución');

    const { renderEmail } = require('../lib/email-render');
    const took = renderEmail('report_outcome_notice', mail.payload);
    assert.equal(took.subject, 'Tu denuncia WO-00042: se tomó acción');
    assert.equal(took.cta.url, 'https://beta.weotzi.com/client/dashboard');
    assert.match(took.text, /Resultado: Se tomó acción/);
    const none = renderEmail('report_outcome_notice', { ...mail.payload, outcome: 'sin_accion', recipient_role: 'studio' });
    assert.equal(none.subject, 'Tu denuncia WO-00042: cerrada sin acción');
    assert.equal(none.cta.url, 'https://beta.weotzi.com/studio/dashboard');
    for (const out of [took, none]) assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110, out.preheader);
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    assert.ok(SERVER_ONLY_EVENTS.has('report_outcome_notice'));
    const { fixtureFor } = require('../lib/email-render/fixtures');
    assert.equal(fixtureFor('report_outcome_notice').ticket_code, 'WO-00042');

    // Otros cambios de estado no mandan el aviso.
    const progress = await run(routes._internal.statusHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { status: 'waiting_user' } });
    assert.equal(progress.emails.length, 0);
    const already = await run(routes._internal.statusHandler, {
        userId: AGENT, repo: fakeRepo({ async getReportByTicket() { return stored('resolved'); } }), params: { ticketId: TICKET },
        body: { status: 'resolved', outcome: 'sin_accion', resolution: 'Se corrige la resolución.' }
    });
    assert.equal(already.emails.length, 0, 'una denuncia ya resuelta no repite el aviso');
});

// ---------------------------------------------------------------- navegador

test('wo-report: visitantes ven el botón en perfiles y el modal los invita a entrar o crear cuenta de cliente', () => {
    assert.equal(R.buttonVisible('artist', { eligible: false, code: 'AUTH_REQUIRED' }), true);
    assert.equal(R.buttonVisible('studio', { eligible: false, code: 'AUTH_REQUIRED' }), true);
    assert.equal(R.buttonVisible('quotation', { eligible: false, code: 'AUTH_REQUIRED' }), false);
    assert.equal(R.buttonVisible('artist', { eligible: false, code: 'SELF_REPORT' }), false, 'el dueño no lo ve');
    const html = R.bodyHtml({ step: 'blocked', kind: 'artist', code: 'AUTH_REQUIRED', returnTo: '/artist/profile?artist=sara.luna', base: '/beta' });
    assert.match(html, />Inicia sesión<\/a>/);
    assert.match(html, />Crea tu cuenta de cliente<\/a>/);
    assert.ok(html.includes('href="/beta/client/login?returnTo=%2Fartist%2Fprofile%3Fartist%3Dsara.luna"'));
    assert.ok(html.includes('href="/beta/client/register?returnTo=%2Fartist%2Fprofile%3Fartist%3Dsara.luna"'));
    const quote = R.bodyHtml({ step: 'blocked', kind: 'quotation', code: 'AUTH_REQUIRED', message: 'Inicia sesión para enviar una denuncia.' });
    assert.doesNotMatch(quote, /Crea tu cuenta/);
    assert.doesNotMatch(R.guestHtml('"><script>alert(1)</script>'), /<script>/);
});

test('wo-report: open() acepta motivo, imagen, archivo y contexto; el borrador es por foto', () => {
    const src = read('public/shared/js/wo-report.js');
    assert.match(src, /options: \{ kind, id, label, opener, reason, item: \{ key, image \}, file, context \}/);
    assert.match(src, /const key = draftKey\(kind, id, item && item\.key\);/);
    assert.match(src, /if \(opts\.file\) preloadFile\(current\.draft, opts\.file\);/);
    assert.match(src, /page_context: pageContext\(loc\.pathname, loc\.search, current\.context\)/);
    assert.equal(R.draftKey('artist', 'u1', ''), 'artist:u1');
    assert.equal(R.draftKey('artist', 'u1', 'koi-1'), 'artist:u1:koi-1');
    assert.equal(R.pageContext('/buscar-diseno', '', 'Coincidencia <b>1</b> de 12'), '/buscar-diseno · Coincidencia b 1 /b de 12');
    assert.deepEqual(R.normalizeItem({ key: 'k', image: 'javascript:alert(1)' }), { key: 'k', image: '' });
    assert.equal(R.normalizeItem({}), null);
    // El reclamo del modal es el mismo que valida el servidor.
    const draft = { ...R.newDraft(), reason: 'plagio_diseno', claimVictim: true, claimInstagram: 'https://instagram.com/Lucia.Tattoo', claimProof: 'https://instagram.com/p/1' };
    const built = R.buildClaim(draft, 'artist');
    assert.deepEqual(built.claim, D.parseClaim(built.claim, { kind: 'artist', reason: 'plagio_diseno' }).claim);
    assert.equal(R.buildClaim({ ...draft, claimInstagram: '' }, 'artist').field, 'claim_instagram');
    assert.equal(R.buildClaim({ ...draft, reason: 'difamacion' }, 'artist').claim, null);
    assert.equal(R.validateStep({ ...draft, description: DESCRIPTION, claimInstagram: '' }, 'reason', R.reasonsFor('artist'), 'artist').field, 'claim_instagram');
    const reasonStep = R.bodyHtml({ step: 'reason', kind: 'artist', draft, reasons: R.reasonsFor('artist'), item: { key: 'koi-1', image: SARA_WORK } });
    assert.match(reasonStep, /¿Eres la persona o el estudio suplantado\?/);
    assert.match(reasonStep, /<label class="wor-label" for="wor-claim-instagram">Tu Instagram/);
    assert.match(reasonStep, /Imagen denunciada/);
    assert.doesNotMatch(R.bodyHtml({ step: 'reason', kind: 'quotation', draft: { ...draft, reason: 'spam' }, reasons: R.reasonsFor('quotation') }), /suplantado/);
});

test('perfiles: botón por foto con plagio_diseno, insignia con WoVerifiedBadge y scripts versionados', () => {
    const studio = { id: STUDIO_B, name: 'Tinta "Sur"', photo_feed_items: [{ id: 'p1', url: 'https://cdn.example.com/studio/sala.jpg?x=1' }] };
    const gallery = StudioProfile.galleryHtml(studio);
    assert.match(gallery, /<figure class="sp-photo">/);
    assert.match(gallery, /<button type="button" class="sp-photo-report" hidden data-wo-report data-kind="studio" data-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-label="Tinta &quot;Sur&quot;" data-reason="plagio_diseno" data-item-key="p1" data-item-image="https:\/\/cdn\.example\.com\/studio\/sala\.jpg\?x=1" aria-label="Denunciar la foto 1"><\/button>/);
    assert.equal(StudioProfile.photoKey({}, 'https://cdn.example.com/studio/sala.jpg?x=1'), D.portfolioItemKey(null, 'https://cdn.example.com/studio/sala.jpg?x=1'));
    assert.match(StudioProfile.STUDIO_PUBLIC_COLUMNS, /,instagram_badge_ok$/);

    const previous = global.WoVerifiedBadge;
    try {
        delete global.WoVerifiedBadge;
        assert.equal(StudioProfile.studioSealVisible({ is_verified: true }), true, 'sin el módulo, la regla anterior');
        global.WoVerifiedBadge = require('../public/shared/js/verified-badge.js');
        assert.equal(StudioProfile.studioSealVisible({ is_verified: true, instagram_badge_ok: false }), false, 'Instagram cambiado: sin sello');
        assert.equal(StudioProfile.studioSealVisible({ is_verified: true, instagram_badge_ok: true }), true);
    } finally {
        if (previous === undefined) delete global.WoVerifiedBadge; else global.WoVerifiedBadge = previous;
    }

    const artistJs = read('public/shared/js/artist-profile.js');
    assert.match(artistJs, /badge\.isBadgeVisible\(\{ \.\.\.artistData, verification_state: verified \? 'Yes' : artistData\.verification_state \}\)/);
    assert.match(artistJs, /const ARTIST_PUBLIC_FIELDS_KYC = `\$\{ARTIST_PUBLIC_FIELDS\},instagram_badge_ok`;/);
    for (const [file, module] of [['public/artist/profile/index.html', 'artist-profile.js'], ['public/studio/profile/index.html', 'studio-profile.js']]) {
        const html = read(file);
        const badgeAt = html.indexOf('<script src="/shared/js/verified-badge.js?v=20261118-kyc"></script>');
        assert.ok(badgeAt > 0, `${file}: falta verified-badge.js`);
        assert.ok(badgeAt < html.indexOf(`<script src="/shared/js/${module}`), `${file}: verified-badge.js antes del módulo`);
        assert.match(html, /\/shared\/js\/wo-report\.js\?v=20261118-kyc/);
    }
    assert.match(read('public/my-quotations/detail/index.html'), /\/shared\/js\/wo-report\.js\?v=20261118-kyc/);
});

// artist-profile.js lee el artista por WeotziData.Artists, que filtra el select
// con PUBLIC_COLUMNS: sin instagram_badge_ok en esa lista la columna se descarta
// y el sello queda oculto para todos. artists-repo.js no es de T1 (lo corrige la
// integración junto con tests/r3c-pii.test.js); este test queda como aviso.
test('perfil de artista: la lista blanca de artists-repo deja pasar instagram_badge_ok', () => {
    const src = read('public/shared/js/data/artists-repo.js');
    const block = /const PUBLIC_COLUMNS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(src);
    assert.ok(block, 'artists-repo define PUBLIC_COLUMNS');
    assert.match(block[1], /'instagram_badge_ok'/);
});

test('panel de soporte: reclamo del titular, imagen denunciada, prioridad alta y «Proponer sanción»', () => {
    const report = {
        ticket_id: TICKET, code: 'WO-00042', status: 'open', priority: 'high', target_kind: 'artist', reason: 'plagio_diseno', reason_label: 'Plagio de diseños',
        dossier: {
            evidence: { links: [], attachments: [], reference_items: [{ key: 'koi-1', image_url: SARA_WORK, category: 'flash' }, { key: 'x', image_url: 'javascript:alert(1)' }] },
            claim: { is_victim: true, instagram: 'lucia.tattoo', proof_link: 'https://instagram.com/p/1', instagram_validated: false },
            reporter: { name: 'Lucía', role_label: 'Cliente' },
            reported: { user_id: OTHER_ARTIST, name: 'Sara Luna', role_label: 'Artista' }
        }
    };
    const html = P.detailHtml(report, { base: '', sanctions: true });
    assert.ok(html.includes('<p class="rpq-section-title">Reclamo del titular</p>'));
    assert.ok(html.includes('<p class="rpq-section-title">Imagen denunciada</p>'));
    assert.match(html, /href="https:\/\/www\.instagram\.com\/lucia\.tattoo\/"/);
    assert.match(html, /<dt>Validado<\/dt><dd>No<\/dd>/);
    assert.match(html, /data-rpq-claim>CONFIRMAR TITULAR<\/button>/);
    assert.match(html, /<img src="https:\/\/cdn\.example\.com\/artist-gallery\/sara\/koi\.jpg"/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /data-rpq-propose-sanction>PROPONER SANCIÓN<\/button>/);
    assert.match(html, /rpq-badge--high/);
    assert.doesNotMatch(P.detailHtml(report, { base: '' }), /data-rpq-propose-sanction/, 'sin SupportSanctionsQueue no hay botón');
    const validated = P.detailHtml({ ...report, dossier: { ...report.dossier, claim: { ...report.dossier.claim, instagram_validated: true, validated_via: 'support' } } }, {});
    assert.match(validated, /<dt>Validado<\/dt><dd>Sí \(confirmado por soporte\)<\/dd>/);
    assert.doesNotMatch(validated, /data-rpq-claim/);
    assert.deepEqual(P.sanctionPayload(report), {
        user_id: OTHER_ARTIST, ticket_id: TICKET, reason_code: 'plagio_diseno', summary: 'Denuncia WO-00042: Plagio de diseños · Sara Luna · Artista'
    });
    assert.equal(P.priorityTag('normal'), '');
    assert.match(P.priorityTag('urgent'), /rpq-badge--urgent/);

    const src = read('public/shared/js/support-dashboard-reports.js');
    assert.match(src, /root\.SupportSanctionsQueue\.propose\(payload\)/);
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//);
    const repo = read('public/shared/js/data/support-reports-repo.js');
    assert.ok(repo.includes("ticketPath(ticketId, '/claim')"));
});

// Integración (T7 → T1): el buscador y el perfil pueden codificar distinto la
// misma URL; findPortfolioItem compara ambos lados decodificados.
test('imagen denunciada: diferencias de codificación en la URL o la clave no bloquean la denuncia', () => {
    const base = 'https://proj.supabase.co/storage/v1/object/public/artist-gallery/u1';
    const stored = `${base}/foto%2Cuno%3Dv2%20final.jpg`;
    const sources = [{ source: 'gallery_feed_items', items: [{ url: stored, category: 'realizados' }, { url: `${base}/otra.jpg` }] }];

    const byUrl = D.findPortfolioItem(sources, { image_url: `${base}/foto,uno=v2 final.jpg?t=1` });
    assert.ok(byUrl, 'misma imagen con , = y espacio sin codificar');
    assert.equal(byUrl.image_url, stored, 'se guarda la URL del perfil, no la del navegador');
    assert.equal(byUrl.category, 'realizados');

    const reverse = D.findPortfolioItem([{ source: 'gallery_feed_items', items: [`${base}/a,b.jpg`] }], { image_url: `${base}/a%2Cb.jpg` });
    assert.ok(reverse, 'también al revés: el perfil sin codificar y la denuncia codificada');

    const byKey = D.findPortfolioItem(sources, { image_url: 'https://cdn.example.test/otra-ruta.jpg', key: 'foto,uno=v2 final.jpg' });
    assert.ok(byKey, 'la clave también se compara decodificada');
    assert.equal(byKey.image_url, stored);

    // Un % suelto no rompe y no inventa coincidencias.
    assert.equal(D.findPortfolioItem(sources, { image_url: `${base}/roto%E0%A4%A.jpg`, key: '100%' }), null);
    assert.equal(D.findPortfolioItem(sources, { image_url: `${base}/no-esta.jpg` }), null);
});

// ---------------------------------------------------------------- aviso al denunciado (F3)

const NOTIFY_DESCRIPTION = 'Esta persona copia mis diseños y los vende como propios desde agosto.';
const EVIDENCE_LINK = 'https://evidencia.example/post/123';

function reportRow({ kind = 'artist', status = 'in_progress', notice = null } = {}) {
    const reported = kind === 'studio'
        ? { user_id: OTHER_ARTIST, role: 'studio', name: 'Tinta Sur', email: 'perfil@tintasur.example' }
        : { user_id: OTHER_ARTIST, role: 'artist', name: 'Sara Luna', email: 'perfil@sara.example' };
    return {
        id: REPORT_ID, ticket_id: TICKET, target_kind: kind, reason: kind === 'quotation' ? 'spam' : 'plagio_diseno',
        reporter_user_id: CLIENT, reporter_role: 'client',
        reported_user_id: kind === 'quotation' ? CLIENT : OTHER_ARTIST, reported_role: kind === 'quotation' ? 'client' : kind,
        reported_studio_id: kind === 'studio' ? STUDIO_B : null,
        evidence_links: [EVIDENCE_LINK],
        dossier: {
            description: NOTIFY_DESCRIPTION,
            evidence: { links: [EVIDENCE_LINK], attachments: [{ path: `${CLIENT}/denuncias/prueba.png` }] },
            claim: { is_victim: true, instagram: 'lucia.tattoo' },
            reporter: { name: 'Lucía Fernández', contact_name: 'Lucía Fernández', email: 'lucia@auth.example', role: 'client' },
            reported,
            ...(notice ? { reported_notice: notice } : {})
        },
        ticket: { id: TICKET, ticket_number: 42, status, priority: 'high', assigned_support_user_id: null }
    };
}

function noticeRepo(row, overrides = {}) {
    const repo = fakeRepo({
        async getReportByTicket() { return row; },
        async claimReportedNotice(id, notice) {
            repo.calls.claims = (repo.calls.claims || []).concat({ id, notice });
            return { reported_notice: notice };
        },
        ...overrides
    });
    return repo;
}

// Como run(), con el envío de correo que devuelva `result`.
async function runNotify(repo, result) {
    const res = mockRes();
    const restore = routes._internal.setDeps({
        repo,
        resolveBearerUser: async () => ({ id: AGENT, email: 'agente@weotzi.com' }),
        isSuperadminEmail: () => false,
        sendEmail: async () => result,
        applicationBase: () => 'https://beta.weotzi.com',
        now: () => new Date('2026-11-18T14:00:00Z')
    });
    try {
        await routes._internal.notifyReportedHandler({ headers: {}, body: {}, query: {}, params: { ticketId: TICKET } }, res);
    } finally {
        restore();
    }
    return res;
}

test('aviso al denunciado: el plazo suma 5 días hábiles (sin sábados ni domingos) en la hora de Buenos Aires', () => {
    assert.equal(D.RESPONSE_BUSINESS_DAYS, 5);
    assert.equal(D.addBusinessDays('2026-11-18'), '2026-11-25', 'miércoles → miércoles siguiente');
    assert.equal(D.addBusinessDays('2026-11-20'), '2026-11-27', 'viernes → viernes siguiente');
    assert.equal(D.addBusinessDays('2026-11-21'), '2026-11-27', 'sábado: cuenta desde el lunes');
    assert.equal(D.addBusinessDays('2026-11-22'), '2026-11-27', 'domingo: cuenta desde el lunes');
    assert.equal(D.addBusinessDays('2026-11-23'), '2026-11-30', 'lunes → lunes siguiente');
    assert.equal(D.addBusinessDays('2026-12-30', 3), '2027-01-04', 'cruza el año');
    for (const day of ['2026-11-18', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']) {
        const weekday = new Date(`${D.addBusinessDays(day)}T12:00:00Z`).getUTCDay();
        assert.ok(weekday >= 1 && weekday <= 5, `${day}: el plazo nunca cae en fin de semana`);
    }
    // Domingo 22 a las 22:00 en Buenos Aires (lunes 23 en UTC): cuenta el domingo local.
    assert.equal(D.responseDeadline(new Date('2026-11-23T01:00:00Z')), '2026-11-27');
    assert.equal(D.responseDeadline(new Date('2026-11-18T14:00:00Z')), '2026-11-25');
    assert.equal(D.formatDeadline('2026-11-25'), 'miércoles, 25 de noviembre de 2026');
    assert.equal(D.parseNotifyReportedInput({ note: 'x'.repeat(1001) }).field, 'note');
    assert.deepEqual(D.parseNotifyReportedInput({}).value, { note: null });
    assert.equal(D.parseNotifyReportedInput({ note: 'x'.repeat(1000) }).value.note.length, 1000);
});

test('aviso al denunciado: solo soporte o superadmin, solo denuncias de perfiles y con la denuncia abierta', async () => {
    const anonymous = await run(routes._internal.notifyReportedHandler, { repo: noticeRepo(reportRow()), params: { ticketId: TICKET } });
    assert.equal(anonymous.res.statusCode, 401);
    const client = await run(routes._internal.notifyReportedHandler, { userId: CLIENT, repo: noticeRepo(reportRow()), params: { ticketId: TICKET } });
    assert.equal(client.res.statusCode, 403);
    assert.equal(client.emails.length, 0);
    const reported = await run(routes._internal.notifyReportedHandler, { userId: OTHER_ARTIST, repo: noticeRepo(reportRow()), params: { ticketId: TICKET } });
    assert.equal(reported.res.statusCode, 403, 'el denunciado no puede dispararlo');

    const quotation = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: noticeRepo(reportRow({ kind: 'quotation' })), params: { ticketId: TICKET } });
    assert.equal(quotation.res.statusCode, 409);
    assert.equal(quotation.res.body.code, 'NOT_PROFILE_REPORT');
    assert.equal(quotation.emails.length, 0);

    const closed = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: noticeRepo(reportRow({ status: 'resolved' })), params: { ticketId: TICKET } });
    assert.equal(closed.res.statusCode, 409);
    assert.equal(closed.res.body.code, 'REPORT_CLOSED');

    const badId = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: noticeRepo(reportRow()), params: { ticketId: 'nope' } });
    assert.equal(badId.res.statusCode, 400);
    const longNote = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: noticeRepo(reportRow()), params: { ticketId: TICKET }, body: { note: 'x'.repeat(1001) } });
    assert.equal(longNote.res.statusCode, 400);
    assert.equal(longNote.res.body.field, 'note');

    const admin = await run(routes._internal.notifyReportedHandler, { userId: OWNER, superadmin: true, repo: noticeRepo(reportRow()), params: { ticketId: TICKET } });
    assert.equal(admin.res.statusCode, 200, 'el superadmin del backoffice también');
});

test('aviso al denunciado (artista): correo al email de auth con motivo, ticket y plazo, sin nada del denunciante', async () => {
    const repo = noticeRepo(reportRow());
    const { res, emails } = await run(routes._internal.notifyReportedHandler, {
        userId: AGENT, repo, params: { ticketId: TICKET }, body: { note: 'Envíanos los archivos originales del diseño.' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already_sent, false);
    assert.equal(res.body.email_sent, true);
    assert.deepEqual(res.body.notice, {
        sent_at: '2026-11-18T14:00:00.000Z', deadline: '2026-11-25', business_days: 5, email_status: 'sent',
        note: 'Envíanos los archivos originales del diseño.'
    });

    assert.equal(emails.length, 1);
    const mail = emails[0];
    assert.equal(mail.eventId, 'report_response_requested');
    assert.equal(mail.options.idempotencyKey, `report_response_requested:${TICKET}`);
    assert.equal(mail.payload.recipient_email, 'sara@auth.example', 'email de auth.users, no el del perfil');
    assert.equal(mail.payload.recipient_role, 'artist');
    assert.equal(mail.payload.ticket_code, 'WO-00042');
    assert.equal(mail.payload.reason_label, 'Plagio de diseños');
    assert.equal(mail.payload.response_deadline_date, '2026-11-25');
    assert.equal(mail.payload.support_note, 'Envíanos los archivos originales del diseño.');
    const leaks = /Lucía|lucia|Fernández|copia mis diseños|evidencia\.example|prueba\.png|denuncias\//;
    assert.doesNotMatch(JSON.stringify(mail.payload), leaks, 'ni denunciante, ni descripción, ni evidencia');
    assert.ok(!Object.keys(mail.payload).some((k) => /reporter|evidence|description|claim/.test(k)));

    // Se reserva el aviso (sending) y después queda enviado; nota interna y agente asignado.
    assert.equal(repo.calls.claims.length, 1);
    assert.equal(repo.calls.claims[0].notice.email_status, 'sending');
    assert.equal(repo.calls.claims[0].notice.deadline, '2026-11-25');
    const saved = repo.calls.dossiers.at(-1);
    assert.equal(saved.key, 'reported_notice', 'solo cambia el aviso, no el expediente entero');
    assert.equal(saved.opts.expect.email_status, 'sending', 'solo si la reserva sigue siendo la nuestra');
    assert.equal(saved.value.email_status, 'sent');
    assert.equal(saved.value.sent_at, '2026-11-18T14:00:00.000Z');
    assert.equal(saved.value.sent_by, AGENT);
    assert.equal(repo.calls.notes.length, 1);
    assert.equal(repo.calls.notes[0].isInternal, true);
    assert.match(repo.calls.notes[0].body, /^Se avisó al denunciado; plazo hasta miércoles, 25 de noviembre de 2026 \(5 días hábiles\)\./);
    assert.match(repo.calls.notes[0].body, /Qué se le pidió: Envíanos los archivos originales/);
    assert.deepEqual(repo.calls.updates, [{ id: TICKET, patch: { assigned_support_user_id: AGENT } }]);

    // El correo: motivo, plazo, cómo responder (hilo de Soporte de la bandeja) y nada del denunciante.
    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail('report_response_requested', mail.payload);
    assert.equal(out.subject, 'Recibimos una denuncia sobre tu perfil (WO-00042)');
    assert.equal(out.cta.url, 'https://beta.weotzi.com/artist/inbox?filter=support');
    assert.match(out.text, /Plazo para responder: Miércoles, 25 de noviembre de 2026/);
    assert.match(out.text, /no cuentan sábados ni domingos/);
    assert.match(out.text, /Motivo: Plagio de diseños/);
    assert.match(out.text, /número de ticket WO-00042/);
    assert.match(out.text, /Envíanos los archivos originales del diseño\./);
    assert.match(out.text, /no compartimos quién hizo la denuncia/);
    assert.doesNotMatch(out.html + out.text, leaks);
    assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110, out.preheader);
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    assert.ok(SERVER_ONLY_EVENTS.has('report_response_requested'));
    const { fixtureFor } = require('../lib/email-render/fixtures');
    assert.equal(fixtureFor('report_response_requested').response_deadline_date, '2026-11-25');
});

test('aviso al denunciado (estudio): va al email de auth del dueño y el botón lleva al panel del estudio', async () => {
    const repo = noticeRepo(reportRow({ kind: 'studio' }));
    const { res, emails } = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo, params: { ticketId: TICKET } });
    assert.equal(res.statusCode, 200);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].payload.recipient_email, 'sara@auth.example', 'Tinta Sur es de OTHER_ARTIST (studios.user_id)');
    assert.equal(emails[0].payload.recipient_role, 'studio');
    assert.equal(emails[0].payload.profile_name, 'Tinta Sur');
    assert.equal(emails[0].payload.support_note, '');
    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail('report_response_requested', emails[0].payload);
    assert.equal(out.cta.url, 'https://beta.weotzi.com/studio/dashboard');
    assert.match(out.text, /el perfil de tu estudio/);
    assert.doesNotMatch(out.text, /Lo que te pide soporte/, 'sin mensaje de soporte no hay cita');

    // Sin email en auth ni en el perfil: no se reserva nada.
    const nobody = noticeRepo(reportRow({ kind: 'studio' }), {
        async getAuthUserContact() { return null; },
        async findStudio() { return { id: STUDIO_B, user_id: OTHER_ARTIST, name: 'Tinta Sur' }; }
    });
    const none = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: nobody, params: { ticketId: TICKET } });
    assert.equal(none.res.statusCode, 409);
    assert.equal(none.res.body.code, 'NO_RECIPIENT');
    assert.equal(none.emails.length, 0);
    assert.equal(nobody.calls.claims, undefined);
});

test('aviso al denunciado: una sola vez por ticket (repetir o dos clics a la vez no mandan otro correo)', async () => {
    const notice = { sent_at: '2026-11-16T15:00:00.000Z', deadline: '2026-11-23', business_days: 5, sent_by: AGENT, note: null, email_status: 'sent' };
    const again = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: noticeRepo(reportRow({ notice })), params: { ticketId: TICKET } });
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.already_sent, true);
    assert.equal(again.res.body.notice.deadline, '2026-11-23');
    assert.equal(again.res.body.notice.sent_by, undefined, 'el panel no recibe el id del agente');
    assert.equal(again.emails.length, 0);
    assert.equal(again.repo.calls.notes.length, 0);
    assert.equal(again.repo.calls.claims, undefined);

    // Otro agente ganó la reserva entre la lectura y la escritura.
    let reads = 0;
    const race = noticeRepo(reportRow(), {
        async getReportByTicket() { reads += 1; return reads === 1 ? reportRow() : reportRow({ notice }); },
        async claimReportedNotice() { return null; }
    });
    const lost = await run(routes._internal.notifyReportedHandler, { userId: AGENT, repo: race, params: { ticketId: TICKET } });
    assert.equal(lost.res.statusCode, 200);
    assert.equal(lost.res.body.already_sent, true);
    assert.equal(lost.emails.length, 0);

    // La reserva es una sola sentencia (RPC) con la condición «sin aviso previo».
    const requests = [];
    const originalFetch = global.fetch;
    let reply = { description: NOTIFY_DESCRIPTION, reported_notice: notice };
    global.fetch = async (url, init) => {
        requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
        return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const saved = await repoModule.DenunciasRepo.claimReportedNotice(REPORT_ID, notice);
        assert.equal(saved.reported_notice.deadline, '2026-11-23');
        assert.equal(await repoModule.DenunciasRepo.claimReportedNotice(REPORT_ID, null), null, 'sin aviso no escribe');
        reply = null; // la RPC no escribió: ya había un aviso
        assert.equal(await repoModule.DenunciasRepo.claimReportedNotice(REPORT_ID, notice), null);
        assert.equal(await repoModule.DenunciasRepo.patchReportDossierKey(REPORT_ID, 'ticket', {}), null, 'la clave ticket no se toca');
        assert.equal(await repoModule.DenunciasRepo.patchReportDossierKey('no-uuid', 'claim', {}), null);
        reply = { claim: { ok: true } };
        await repoModule.DenunciasRepo.patchReportDossierKey(REPORT_ID, 'claim', { ok: true });
    } finally {
        global.fetch = originalFetch;
    }
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[2].body, { p_report_id: REPORT_ID, p_key: 'claim', p_value: { ok: true }, p_check: false, p_expect: null },
        'sin expect no hay compare-and-set');
    assert.equal(requests[0].method, 'POST');
    assert.match(requests[0].url, /\/rest\/v1\/rpc\/patch_support_report_dossier$/);
    assert.deepEqual(requests[0].body, {
        p_report_id: REPORT_ID, p_key: 'reported_notice', p_value: notice, p_check: true, p_expect: null
    }, 'una sola sentencia: solo esa clave y solo si no había aviso');
});

test('aviso al denunciado: si el correo falla se libera la reserva; si queda en duda, se registra sin reenviar', async () => {
    const failing = noticeRepo(reportRow());
    const failed = await runNotify(failing, { ok: false, error: 'relay caído' });
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.code, 'EMAIL_FAILED');
    const released = failing.calls.dossiers.at(-1);
    assert.equal(released.key, 'reported_notice');
    assert.equal(released.value, null, 'se quita la reserva: se puede reintentar');
    assert.equal(released.opts.expect.email_status, 'sending', 'solo si la reserva sigue siendo la nuestra');
    assert.equal(failing.calls.notes.length, 0);

    const doubtful = noticeRepo(reportRow());
    const unsure = await runNotify(doubtful, { ok: false, uncertain: true });
    assert.equal(unsure.statusCode, 200);
    assert.equal(unsure.body.email_sent, false);
    assert.equal(unsure.body.notice.email_status, 'uncertain');
    assert.match(doubtful.calls.notes[0].body, /No pudimos confirmar la entrega del correo/);
});

// Expediente con la semántica de patch_support_report_dossier: una clave por
// escritura y compare-and-set opcional (igualdad de JSON, null = no está).
function dossierDb(row) {
    const { isDeepStrictEqual } = require('node:util');
    const state = { dossier: JSON.parse(JSON.stringify(row.dossier)), ticket: { ...row.ticket } };
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const repo = fakeRepo({
        async getReportByTicket() { return { ...row, dossier: clone(state.dossier), ticket: { ...state.ticket } }; },
        async patchReportDossierKey(id, key, value, opts = {}) {
            repo.calls.dossiers.push({ id, key, value, opts });
            if ('expect' in opts) {
                const current = state.dossier[key] === undefined ? null : state.dossier[key];
                const expected = opts.expect === undefined ? null : opts.expect;
                if (!isDeepStrictEqual(JSON.parse(JSON.stringify(current)), JSON.parse(JSON.stringify(expected)))) return null;
            }
            if (value == null) delete state.dossier[key];
            else state.dossier[key] = clone(value);
            if (repo.afterPatch) await repo.afterPatch(key);
            return clone(state.dossier);
        },
        async claimReportedNotice(id, notice) { return repo.patchReportDossierKey(id, 'reported_notice', notice, { expect: null }); },
        async updateReportTicket(id, patch) { Object.assign(state.ticket, patch); return { id, ...state.ticket }; }
    });
    return { repo, state };
}

test('aviso al denunciado: lo que entra al expediente mientras sale el correo no se pierde (y no borra el aviso)', async () => {
    const extra = { key: 'otra.png', image_url: 'https://cdn.example.com/x/otra.png' };
    const withConcurrentWrites = async (result) => {
        const { repo, state } = dossierDb(reportRow());
        const res = mockRes();
        const restore = routes._internal.setDeps({
            repo,
            resolveBearerUser: async () => ({ id: AGENT, email: 'agente@weotzi.com' }),
            isSuperadminEmail: () => false,
            // Mientras el correo está en vuelo: otro agente confirma al titular y el
            // denunciante suma una imagen. Los dos leen el expediente con la reserva puesta.
            sendEmail: async () => {
                assert.equal(state.dossier.reported_notice.email_status, 'sending');
                await routes._internal.claimHandler({ headers: {}, body: {}, query: {}, params: { ticketId: TICKET } }, mockRes());
                assert.equal(await routes._internal.appendItemToOpenReport(TICKET, CLIENT, extra), true);
                return result;
            },
            applicationBase: () => 'https://beta.weotzi.com',
            now: () => new Date('2026-11-18T14:00:00Z')
        });
        try {
            await routes._internal.notifyReportedHandler({ headers: {}, body: {}, query: {}, params: { ticketId: TICKET } }, res);
        } finally {
            restore();
        }
        return { res, repo, state };
    };

    // Enviado: el estado final del aviso conserva el reclamo confirmado y la imagen.
    const ok = await withConcurrentWrites({ ok: true });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.state.dossier.reported_notice.email_status, 'sent');
    assert.equal(ok.state.dossier.claim.instagram_validated, true, 'el reclamo confirmado sigue ahí');
    assert.equal(ok.state.dossier.claim.validated_via, 'support');
    assert.deepEqual(ok.state.dossier.evidence.reference_items.map((r) => r.image_url), [extra.image_url], 'la imagen sumada sigue ahí');
    assert.equal(ok.state.dossier.description, NOTIFY_DESCRIPTION);
    assert.ok(ok.repo.calls.dossiers.every((w) => typeof w.key === 'string'), 'ninguna escritura reemplaza el expediente entero');

    // Falló seguro: se quita solo la reserva; lo demás queda.
    const failed = await withConcurrentWrites({ ok: false, error: 'relay caído' });
    assert.equal(failed.res.statusCode, 502);
    assert.equal(failed.state.dossier.reported_notice, undefined, 'se puede reintentar');
    assert.equal(failed.state.dossier.claim.instagram_validated, true);
    assert.equal(failed.state.dossier.evidence.reference_items.length, 1);

    // Al revés: escrituras después de la reserva no borran el aviso (el panel no vuelve a mostrar el botón).
    const notice = { sent_at: '2026-11-16T15:00:00.000Z', deadline: '2026-11-23', business_days: 5, sent_by: AGENT, note: null, email_status: 'sent' };
    const { repo: later, state: laterState } = dossierDb(reportRow({ notice }));
    const restore = routes._internal.setDeps({
        repo: later,
        resolveBearerUser: async () => ({ id: AGENT, email: 'agente@weotzi.com' }),
        isSuperadminEmail: () => false,
        now: () => new Date('2026-11-18T14:00:00Z')
    });
    try {
        await routes._internal.claimHandler({ headers: {}, body: {}, query: {}, params: { ticketId: TICKET } }, mockRes());
        assert.equal(await routes._internal.appendItemToOpenReport(TICKET, CLIENT, extra), true);
    } finally {
        restore();
    }
    assert.deepEqual(laterState.dossier.reported_notice, notice);
    assert.equal(laterState.dossier.claim.instagram_validated, true);
});

test('expediente: si la evidencia cambió entre la lectura y la escritura, se relee y se reintenta (no se pierde ninguna imagen)', async () => {
    const first = { key: 'a.png', image_url: 'https://cdn.example.com/x/a.png' };
    const second = { key: 'b.png', image_url: 'https://cdn.example.com/x/b.png' };
    const { repo, state } = dossierDb({ ...reportRow(), dossier: { evidence: { links: [] } } });
    // La primera lectura queda vieja: otra imagen entra justo antes de la escritura.
    const read = repo.getReportByTicket;
    let reads = 0;
    repo.getReportByTicket = async () => {
        const row = await read();
        reads += 1;
        if (reads === 1) state.dossier.evidence = D.appendReferenceItem(state.dossier, second).evidence;
        return row;
    };
    const restore = routes._internal.setDeps({ repo });
    try {
        assert.equal(await routes._internal.appendItemToOpenReport(TICKET, CLIENT, first), true);
    } finally {
        restore();
    }
    assert.equal(reads, 2, 'un reintento');
    assert.deepEqual(state.dossier.evidence.reference_items.map((r) => r.key).sort(), ['a.png', 'b.png']);
    assert.equal(repo.calls.dossiers.length, 2);
    assert.equal(repo.calls.notes.length, 1);

    // Si cambia todas las veces, se rinde sin pisar nada.
    const { repo: busy, state: busyState } = dossierDb({ ...reportRow(), dossier: { evidence: { links: [] } } });
    const busyRead = busy.getReportByTicket;
    let n = 0;
    busy.getReportByTicket = async () => {
        const row = await busyRead();
        n += 1;
        busyState.dossier.evidence = { links: [], reference_items: [], tick: n };
        return row;
    };
    const restoreBusy = routes._internal.setDeps({ repo: busy });
    try {
        assert.equal(await routes._internal.appendItemToOpenReport(TICKET, CLIENT, first), false);
    } finally {
        restoreBusy();
    }
    assert.equal(n, 3);
    assert.equal(busyState.dossier.evidence.tick, 3, 'no se pisó la última escritura ajena');
    assert.equal(busy.calls.notes.length, 0);
});

test('panel: «Avisar al denunciado» en el expediente de perfiles y, después, la fecha del aviso y el plazo', () => {
    const base = { ticket_id: TICKET, code: 'WO-00042', status: 'in_progress', priority: 'high', reason: 'plagio_diseno', reason_label: 'Plagio de diseños' };
    const pending = P.detailHtml({ ...base, target_kind: 'artist', dossier: { reported: { user_id: OTHER_ARTIST, name: 'Sara Luna' } } }, {});
    assert.match(pending, /<p class="rpq-section-title">Aviso al denunciado<\/p>/);
    assert.match(pending, /<button type="button" class="action-btn rpq-btn" data-rpq-notify-reported>AVISAR AL DENUNCIADO<\/button>/);
    assert.match(pending, /<label for="rpq-notice-note">Qué tiene que responder \(opcional\)<\/label>/);
    assert.match(pending, /<textarea id="rpq-notice-note" class="rpq-input" rows="3" maxlength="1000"/);
    assert.match(pending, /id="rpq-notice-feedback"/);
    assert.ok(pending.indexOf('data-rpq-notice') > pending.indexOf('rpq-section--reported'), 'debajo de la ficha del denunciado');

    const sent = P.detailHtml({
        ...base, target_kind: 'studio',
        dossier: { reported_notice: { sent_at: '2026-11-18T14:00:00.000Z', deadline: '2026-11-25', business_days: 5, email_status: 'sent', note: 'Manda <b>pruebas</b>' } }
    }, {});
    assert.doesNotMatch(sent, /data-rpq-notify-reported/, 'una sola vez: sin botón');
    assert.match(sent, /<dt>Avisado<\/dt><dd>/);
    assert.match(sent, /<dt>Plazo para responder<\/dt><dd>miércoles, 25 de noviembre de 2026 \(5 días hábiles\)<\/dd>/);
    assert.match(sent, /<dt>Lo que se le pidió<\/dt><dd>Manda &lt;b&gt;pruebas&lt;\/b&gt;<\/dd>/);
    assert.doesNotMatch(sent, /No pudimos confirmar la entrega/);
    assert.match(P.reportedNoticeHtml({ ...base, target_kind: 'artist', dossier: { reported_notice: { sent_at: '2026-11-18T14:00:00Z', deadline: '2026-11-25', email_status: 'uncertain' } } }),
        /No pudimos confirmar la entrega del correo/);

    assert.equal(P.reportedNoticeHtml({ ...base, target_kind: 'quotation' }), '', 'las denuncias de cotización no avisan al cliente');
    assert.doesNotMatch(P.detailHtml({ ...base, target_kind: 'quotation', dossier: {} }, {}), /Aviso al denunciado/);
    const closed = P.reportedNoticeHtml({ ...base, status: 'closed', target_kind: 'artist', dossier: {} });
    assert.doesNotMatch(closed, /data-rpq-notify-reported/);
    assert.match(closed, /La denuncia está cerrada/);

    assert.equal(P.fmtDeadline('2026-11-25'), 'miércoles, 25 de noviembre de 2026');
    assert.equal(P.fmtDeadline('25/11/2026'), '');
    assert.deepEqual(P.buildNoticePayload('  '), { payload: {} });
    assert.deepEqual(P.buildNoticePayload(' Envía pruebas '), { payload: { note: 'Envía pruebas' } });
    assert.ok(P.buildNoticePayload('x'.repeat(1001)).error);
    assert.equal(P.NOTICE_NOTE_MAX, D.NOTICE_NOTE_MAX);
    assert.deepEqual(P.NOTICE_KINDS, D.NOTICE_KINDS);

    // Cableado: el clic llama a la ruta por el repo, y el panel carga las versiones nuevas.
    const src = read('public/shared/js/support-dashboard-reports.js');
    assert.match(src, /if \(e\.target\.closest\('\[data-rpq-notify-reported\]'\)\) \{ e\.preventDefault\(\); notifyReported\(\); return; \}/);
    assert.match(src, /await R\.notifyReported\(d\.ticketId, built\.payload\.note\)/);
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//);
    const repoSrc = read('public/shared/js/data/support-reports-repo.js');
    assert.ok(repoSrc.includes("ticketPath(ticketId, '/notify-reported')"));
    const html = read('public/support/dashboard/index.html');
    assert.match(html, /\/shared\/js\/data\/support-reports-repo\.js\?v=20261118-kyc3/);
    assert.match(html, /\/shared\/js\/support-dashboard-reports\.js\?v=20261118-kyc3/);
    assert.match(read('lib/routes/denuncias.js'), /app\.post\('\/api\/support\/reports\/:ticketId\/notify-reported', notifyReportedHandler\)/);
});
