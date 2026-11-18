'use strict';
// Ronda 2 · frente "denuncias" (P33): denuncias → tickets de soporte.
// Cubre: migración y reversa (contrato), lógica pura (lib/denuncias.js),
// rutas (autorización de quién denuncia qué, expediente, deduplicación, tope,
// emails) y panel de soporte (listado, detalle firmado, estado y notas).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-test-key';

const D = require('../lib/denuncias');
const routes = require('../lib/routes/denuncias');

const MIGRATION = 'supabase/migrations/20261116210000_support_ticket_reports.sql';
const ROLLBACK = 'supabase/rollbacks/20261116210000_support_ticket_reports.down.sql';

const ARTIST = '11111111-1111-4111-8111-111111111111';
const OTHER_ARTIST = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const MANAGER = '55555555-5555-4555-8555-555555555555';
const AGENT = '66666666-6666-4666-8666-666666666666';
const STUDIO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDIO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TICKET = '99999999-9999-4999-8999-999999999999';
const DESCRIPTION = 'El cliente me escribió insultos y amenazas en el chat de la cotización.';

function mockRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; }
    };
}

// Repo en memoria con los datos mínimos de cada escenario.
function fakeRepo(overrides = {}) {
    const artists = {
        [ARTIST]: { id: 'a1111111-1111-4111-8111-111111111111', user_id: ARTIST, name: 'Mateo Rivas', username: 'mateo.ink', email: 'perfil-editable@example.com', city: 'Bogotá' },
        [OTHER_ARTIST]: { id: 'a2222222-2222-4222-8222-222222222222', user_id: OTHER_ARTIST, name: 'Sara Luna', username: 'sara.luna', email: 'sara@example.com' }
    };
    const studios = {
        [STUDIO_A]: { id: STUDIO_A, user_id: OWNER, name: 'Estudio Norte', slug: 'estudio-norte', email: 'norte@example.com' },
        [STUDIO_B]: { id: STUDIO_B, user_id: OTHER_ARTIST, name: 'Tinta Sur', slug: 'tinta-sur', email: 'sur-publico@example.com', contact_phone: '+57 300 000 0000' }
    };
    const quotation = {
        id: 55, quote_id: 'WO-2026-0142', quote_status: 'pending', artist_id: ARTIST, artist_name: 'Mateo Rivas',
        client_user_id: CLIENT, client_full_name: 'Lucía Fernández', client_email: 'lucia@example.com',
        tattoo_idea_description: 'Una golondrina', reference_images: ['https://cdn.example.com/ref-1.jpg', 'javascript:alert(1)'],
        client_health_conditions: 'SECRETO-SALUD', client_allergies: 'SECRETO-ALERGIA', client_birth_date: '1990-01-01'
    };
    const calls = { createReport: [], updates: [], notes: [], signed: [] };
    const repo = {
        ATTACHMENTS_BUCKET: 'support-attachments',
        CHAT_BUCKET: 'chat-attachments',
        calls,
        async getAuthUserContact(id) {
            const emails = { [ARTIST]: 'mateo@auth.example', [CLIENT]: 'lucia@auth.example', [OWNER]: 'owner@auth.example', [MANAGER]: 'manager@auth.example', [OTHER_ARTIST]: 'sara@auth.example' };
            return emails[id] ? { id, email: emails[id], email_confirmed_at: '2026-01-01T00:00:00Z', full_name: 'Nombre Auth' } : null;
        },
        async getActiveSupportUser(id) { return id === AGENT ? { user_id: AGENT, email: 'agente@weotzi.com', full_name: 'Ana Soporte' } : null; },
        async activeSupportEmails() { return ['agente@weotzi.com']; },
        async supportNamesByIds() { return new Map([[AGENT, 'Ana Soporte']]); },
        async getArtistByUserId(id) { return artists[id] || null; },
        async findArtist(ref) {
            return Object.values(artists).find((a) => (ref.by === 'uuid' ? (a.user_id === ref.value || a.id === ref.value) : a.username === ref.value)) || null;
        },
        async getClientByUserId(id) { return id === CLIENT ? { user_id: CLIENT, full_name: 'Lucía Fernández', email: 'lucia@example.com', city_residence: 'Lima' } : null; },
        async findStudio(ref) { return Object.values(studios).find((s) => (ref.by === 'id' ? s.id === ref.value : s.slug === ref.value)) || null; },
        async listAdministeredStudios(id) {
            if (id === OWNER) return [{ studio: studios[STUDIO_A], role: 'studio_owner' }];
            if (id === MANAGER) return [{ studio: studios[STUDIO_A], role: 'studio_manager' }];
            if (id === OTHER_ARTIST) return [{ studio: studios[STUDIO_B], role: 'studio_owner' }];
            return [];
        },
        async findQuotation(ref) {
            if (ref.by === 'id') return ref.value === 55 ? quotation : null;
            return ref.value === 'WO-2026-0142' ? quotation : null;
        },
        async listQuotationMessages() {
            return {
                total: 2,
                messages: [
                    { id: 'm1', sender_type: 'client', sender_id: CLIENT, message: 'Mensaje abusivo', created_at: '2026-11-16T10:00:00Z', attachment_path: 'WO-2026-0142/foto.jpg', attachment_name: 'foto.jpg' },
                    { id: 'm2', sender_type: 'artist', sender_id: ARTIST, message: 'Por favor, respeto.', created_at: '2026-11-16T10:05:00Z' }
                ]
            };
        },
        async listQuotationAttachments() { return [{ id: 'f1', file_name: 'ref.png', mime_type: 'image/png', google_drive_url: 'https://drive.example.com/f1' }]; },
        async createReport(report) {
            calls.createReport.push(report);
            return { duplicate: false, ticket_id: TICKET, ticket_number: 42, report_id: 'r1', status: 'open', created_at: '2026-11-16T14:00:00Z' };
        },
        async listReports() { return []; },
        async countActiveReports() { return 0; },
        async getReportByTicket() { return null; },
        async listTicketMessages() { return []; },
        async updateReportTicket(id, patch) { calls.updates.push({ id, patch }); return { id, ticket_number: 42, status: patch.status, resolution: patch.resolution || null, resolution_outcome: patch.resolution_outcome || null, assigned_support_user_id: patch.assigned_support_user_id || null }; },
        async addTicketMessage(row) { calls.notes.push(row); return { id: 'n1', author_role: row.authorRole, body: row.body, is_internal: row.isInternal, created_at: '2026-11-16T15:00:00Z' }; },
        async signObject(bucket, objectPath) { calls.signed.push(`${bucket}:${objectPath}`); return `https://signed.example.com/${bucket}/${objectPath}?token=x`; },
        ...overrides
    };
    return repo;
}

// Ejecuta un handler con dependencias falsas y devuelve { res, repo, emails }.
async function run(handler, { userId, email, body, query, params, repo = fakeRepo(), superadmin = false } = {}) {
    const emails = [];
    const restore = routes._internal.setDeps({
        repo,
        resolveBearerUser: async () => (userId ? { id: userId, email: email || 'token@example.com' } : null),
        isSuperadminEmail: () => superadmin,
        sendEmail: async (eventId, payload, options) => { emails.push({ eventId, payload, options }); return { ok: true }; },
        applicationBase: () => 'https://beta.weotzi.com',
        now: () => new Date('2026-11-16T14:00:00Z')
    });
    const res = mockRes();
    try {
        await handler({ headers: {}, body: body || {}, query: query || {}, params: params || {} }, res);
    } finally {
        restore();
    }
    return { res, repo, emails };
}

const quotationBody = (extra = {}) => ({ kind: 'quotation', target_id: 'WO-2026-0142', reason: 'comentarios_abusivos', description: DESCRIPTION, ...extra });

// ---------------------------------------------------------------- migración

test('migración: rango, kind denuncia, expediente solo soporte y RPC solo service_role', () => {
    assert.ok(exists(MIGRATION), 'falta la migración');
    assert.ok(exists(ROLLBACK), 'falta la reversa');
    const ts = Number(path.basename(MIGRATION).slice(0, 14));
    assert.ok(ts >= 20261116210000 && ts <= 20261116210999, 'timestamp fuera del rango del frente');
    const sql = read(MIGRATION);
    assert.match(sql, /drop constraint if exists support_tickets_kind_check/);
    assert.match(sql, /kind = any \(array\['consulta'::text, 'disputa'::text, 'denuncia'::text\]\)/);
    assert.match(sql, /create table if not exists public\.support_ticket_reports/);
    assert.match(sql, /ticket_id uuid not null references public\.support_tickets\(id\) on delete cascade/);
    assert.match(sql, /constraint support_ticket_reports_ticket_key unique \(ticket_id\)/);
    // 2.7.0: los motivos nuevos (plagio_diseno, estafa) los suma 20261118110000_denuncias_abiertas.sql.
    const widened = sql + read('supabase/migrations/20261118110000_denuncias_abiertas.sql');
    for (const reason of D.REASONS.quotation.concat(D.REASONS.artist)) assert.ok(widened.includes(`'${reason.code}'::text`), reason.code);
    assert.match(sql, /alter table public\.support_ticket_reports enable row level security/);
    assert.match(sql, /drop policy if exists support_ticket_reports_support_read on public\.support_ticket_reports/);
    assert.match(sql, /for select to authenticated\s+using \(\(select public\.is_support_user\(\)\)\)/);
    assert.match(sql, /revoke all on table public\.support_ticket_reports from public, anon, authenticated/);
    assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*support_ticket_reports to (anon|authenticated)/);
    assert.match(sql, /create or replace function public\.create_support_report\(p_report jsonb\)/);
    assert.match(sql, /security definer\s+set search_path to ''/);
    assert.match(sql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /t\.status in \('open', 'in_progress', 'waiting_user'\)/, 'deduplica solo contra tickets abiertos');
    assert.match(sql, /errcode = 'WR429'/, 'tope diario con código propio');
    assert.match(sql, /storage\.objects o\s+where o\.bucket_id = 'support-attachments' and o\.name = v_path/);
    assert.match(sql, /revoke all on function public\.create_support_report\(jsonb\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.create_support_report\(jsonb\) to service_role;/);
    // El denunciado nunca queda como contraparte del ticket (le daría lectura por RLS).
    const insert = sql.slice(sql.indexOf('insert into public.support_tickets'), sql.indexOf('returning * into v_ticket'));
    assert.doesNotMatch(insert, /counterpart_user_id/);
    assert.match(insert, /'denuncia', 'reporte', 'open'/);
});

test('reversa: conserva los tickets como consulta y restaura el CHECK original', () => {
    const sql = read(ROLLBACK);
    assert.match(sql, /drop function if exists public\.create_support_report\(jsonb\)/);
    assert.match(sql, /drop table if exists public\.support_ticket_reports/);
    assert.match(sql, /update public\.support_tickets set kind = 'consulta' where kind = 'denuncia'/);
    assert.match(sql, /kind = any \(array\['consulta'::text, 'disputa'::text\]\)/);
    assert.ok(sql.indexOf("set kind = 'consulta'") < sql.lastIndexOf('add constraint support_tickets_kind_check'), 'primero migra las filas, después restaura el CHECK');
});

// ---------------------------------------------------------------- lógica pura

test('motivos por tipo: los del pedido del dueño, sin cruzarse', () => {
    assert.deepEqual(D.REASONS.quotation.map((r) => r.label), ['Comentarios abusivos', 'Fotos inapropiadas', 'Violencia', 'Spam']);
    // 2.7.0 (denuncias abiertas): etiquetas cortas; la pista va aparte.
    assert.deepEqual(D.REASONS.artist.map((r) => r.label),
        ['Suplantación de identidad', 'Plagio de diseños', 'Uso de marca o nombre ajeno', 'Difamación', 'Estafa']);
    assert.deepEqual(D.REASONS.studio, D.REASONS.artist);
    assert.equal(D.isValidReason('quotation', 'spam'), true);
    assert.equal(D.isValidReason('artist', 'spam'), false);
    assert.equal(D.isValidReason('quotation', 'difamacion'), false);
    assert.equal(D.isValidReason('quotation', 'estafa'), false);
    assert.equal(D.priorityFor('violencia'), 'urgent');
    assert.equal(D.priorityFor('estafa'), 'urgent');
    assert.equal(D.priorityFor('spam'), 'high');
    assert.equal(D.ticketCode(42), 'WO-00042');
    assert.equal(D.ticketCode(null), '');
    assert.equal(D.targetKey('studio', STUDIO_B), `studio:${STUDIO_B}`);
    const subject = D.buildSubject({ kind: 'artist', reason: 'difamacion', targetLabel: 'x'.repeat(300) });
    assert.ok(subject.length <= 160 && subject.startsWith('Denuncia de artista · Difamación'));
});

test('parseTargetRef acepta los ids que cada pantalla tiene a mano', () => {
    assert.deepEqual(D.parseTargetRef('quotation', '55'), { by: 'id', value: 55 });
    assert.deepEqual(D.parseTargetRef('quotation', 'WO-2026-0142'), { by: 'quote_id', value: 'WO-2026-0142' });
    assert.deepEqual(D.parseTargetRef('artist', ARTIST.toUpperCase()), { by: 'uuid', value: ARTIST });
    assert.deepEqual(D.parseTargetRef('artist', '@mateo.ink'), { by: 'username', value: 'mateo.ink' });
    assert.deepEqual(D.parseTargetRef('studio', 'estudio-norte'), { by: 'slug', value: 'estudio-norte' });
    assert.deepEqual(D.parseTargetRef('studio', STUDIO_A), { by: 'id', value: STUDIO_A });
    for (const bad of ['', '   ', 'a b', 'x,or(id.eq.1)', '../etc', 'x'.repeat(101)]) {
        assert.equal(D.parseTargetRef('quotation', bad), null, `quotation: ${bad}`);
        assert.equal(D.parseTargetRef('studio', bad), null, `studio: ${bad}`);
    }
    assert.equal(D.parseTargetRef('client', ARTIST), null);
});

test('parseReportInput valida motivo, descripción, enlaces e imágenes propias', () => {
    const ok = D.parseReportInput({
        kind: 'quotation', target_id: 55, reason: 'spam', description: `  ${DESCRIPTION}\r\n\r\n\r\n\r\nFin.  `,
        links: ['https://instagram.com/p/abc', 'https://instagram.com/p/abc', ' '],
        attachments: [{ path: `${ARTIST}/denuncias/1-ab-captura.png`, name: 'captura.png', size: 1200, type: 'image/png' }],
        page_context: '/my-quotations/detail?quote=WO-2026-0142'
    }, { userId: ARTIST });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.description, `${DESCRIPTION}\n\nFin.`);
    assert.deepEqual(ok.value.links, ['https://instagram.com/p/abc']);
    assert.equal(ok.value.attachments.length, 1);
    assert.equal(ok.value.pageContext, '/my-quotations/detail?quote=WO-2026-0142');

    const base = { kind: 'quotation', target_id: 55, reason: 'spam', description: DESCRIPTION };
    const bad = (patch, field) => {
        const out = D.parseReportInput({ ...base, ...patch }, { userId: ARTIST });
        assert.equal(out.ok, false, JSON.stringify(patch));
        assert.equal(out.status, 400);
        assert.equal(out.field, field);
        assert.doesNotMatch(out.error, /\b(querés|contanos|elegí|revisá|escribí)\b/i);
    };
    bad({ kind: 'client' }, 'kind');
    bad({ target_id: '' }, 'target_id');
    bad({ reason: 'difamacion' }, 'reason');
    bad({ description: 'muy corta' }, 'description');
    bad({ description: 'x'.repeat(D.DESCRIPTION_MAX + 1) }, 'description');
    bad({ links: ['javascript:alert(1)'] }, 'links');
    bad({ links: ['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://a.com/4', 'https://a.com/5', 'https://a.com/6'] }, 'links');
    bad({ links: ['https://user:pass@evil.example/x'] }, 'links');
    bad({ attachments: [{ path: `${CLIENT}/denuncias/x.png`, type: 'image/png' }] }, 'attachments');
    bad({ attachments: [{ path: `${ARTIST}/denuncias/../../${CLIENT}/x.png`, type: 'image/png' }] }, 'attachments');
    bad({ attachments: [{ path: `${ARTIST}/otra-carpeta/x.png`, type: 'image/png' }] }, 'attachments');
    bad({ attachments: [{ path: `${ARTIST}/denuncias/x.pdf`, type: 'application/pdf' }] }, 'attachments');
    bad({ attachments: [{ path: `${ARTIST}/denuncias/x.png`, type: 'image/png', size: D.MAX_IMAGE_BYTES + 1 }] }, 'attachments');
    bad({ attachments: Array.from({ length: 4 }, (_, i) => ({ path: `${ARTIST}/denuncias/${i}.png`, type: 'image/png' })) }, 'attachments');
    bad({ attachments: 'x' }, 'attachments');
});

test('fichas del expediente: listas blancas, sin salud ni fecha de nacimiento', () => {
    const q = D.pickQuotation({
        id: 55, quote_id: 'WO-1', client_full_name: 'Lucía', client_health_conditions: 'SECRETO', client_allergies: 'SECRETO', client_birth_date: '1990-01-01',
        reference_images: ['https://cdn.example.com/a.jpg', 'javascript:alert(1)', { url: 'https://cdn.example.com/b.jpg' }, 'data:text/html,x']
    }, {
        messages: Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, sender_type: 'client', message: `m${i}`, attachment_path: i === 119 ? '../secreto' : '' })),
        attachments: [{ id: 'f', file_name: 'ref.png', google_drive_url: 'javascript:alert(1)' }],
        messagesTotal: 120
    });
    const flat = JSON.stringify(q);
    assert.doesNotMatch(flat, /SECRETO|1990-01-01|health|allerg|birth/);
    assert.deepEqual(q.reference_images, ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
    assert.equal(q.messages.length, D.DOSSIER_MESSAGES_MAX);
    assert.equal(q.messages[q.messages.length - 1].id, 'm119', 'conserva los más recientes');
    assert.equal(q.messages[q.messages.length - 1].attachment_path, '', 'ruta con .. descartada');
    assert.equal(q.messages_total, 120);
    assert.equal(q.attachments[0].url, '');

    const artist = D.pickArtist({ id: 'a', user_id: ARTIST, name: '<b>Mateo</b>', username: 'mateo.ink', birth_date: '1990-01-01' });
    assert.equal(artist.name, 'b Mateo /b');
    assert.equal(artist.profile_path, '/artist/profile?artist=mateo.ink');
    assert.equal(JSON.stringify(artist).includes('1990'), false);
    const client = D.pickClient({ user_id: CLIENT, full_name: 'Lucía', health_conditions: 'SECRETO', allergies: 'SECRETO', birth_date: '1990-01-01', age: 36 });
    assert.doesNotMatch(JSON.stringify(client), /SECRETO|1990|"age"/);
    assert.equal(D.pickStudio({ id: STUDIO_B, slug: 'tinta-sur', name: 'Tinta Sur' }).profile_path, '/studio/profile?studio=tinta-sur');
});

test('panel: filtros, estado, resolución y notas', () => {
    assert.deepEqual(D.parseListQuery({}).value, { status: 'active', kind: 'all', statuses: ['open', 'in_progress', 'waiting_user'] });
    assert.equal(D.parseListQuery({ status: 'all' }).value.statuses, null);
    assert.deepEqual(D.parseListQuery({ status: 'resolved', kind: 'studio' }).value.statuses, ['resolved']);
    assert.equal(D.parseListQuery({ status: 'x' }).ok, false);
    assert.equal(D.parseListQuery({ kind: 'client' }).ok, false);

    assert.deepEqual(D.parseStatusInput({ status: 'in_progress', resolution: 'no aplica', outcome: 'resuelto' }).value, { status: 'in_progress', resolution: null, outcome: null });
    assert.equal(D.parseStatusInput({ status: 'resolved' }).field, 'outcome');
    assert.equal(D.parseStatusInput({ status: 'resolved', outcome: 'resuelto', resolution: 'ok' }).field, 'resolution');
    assert.equal(D.parseStatusInput({ status: 'resolved', outcome: 'a_favor_cliente', resolution: 'Se suspendió la cuenta.' }).field, 'outcome');
    assert.deepEqual(D.parseStatusInput({ status: 'resolved', outcome: 'sin_accion', resolution: 'No hay evidencia suficiente.' }).value,
        { status: 'resolved', resolution: 'No hay evidencia suficiente.', outcome: 'sin_accion' });
    assert.equal(D.parseStatusInput({ status: 'closed' }).ok, true);
    assert.equal(D.parseStatusInput({ status: 'borrado' }).ok, false);

    assert.equal(D.parseNoteInput({ note: '   ' }).ok, false);
    assert.equal(D.parseNoteInput({ note: 'x'.repeat(D.NOTE_MAX + 1) }).ok, false);
    assert.equal(D.parseNoteInput({ note: ' Llamé al estudio. ' }).value.note, 'Llamé al estudio.');

    const summary = D.summarizeReport({
        id: 'r1', ticket_id: TICKET, target_kind: 'studio', reason: 'difamacion', reporter_user_id: OWNER, reporter_role: 'studio_owner',
        reported_user_id: null, reported_role: 'studio', created_at: '2026-11-16T14:00:00Z',
        dossier: { reporter: { name: 'Estudio Norte', email: 'owner@auth.example', profile_path: '/studio/profile?studio=estudio-norte' }, reported: { name: 'Tinta Sur', profile_path: '//evil.example' } },
        ticket: { id: TICKET, ticket_number: 7, status: 'in_progress', priority: 'high', subject: 'Denuncia' }
    });
    assert.equal(summary.code, 'WO-00007');
    assert.equal(summary.reason_label, 'Difamación');
    assert.equal(summary.reporter.role_label, 'Dueño de estudio');
    assert.equal(summary.reported.role_label, 'Estudio');
    assert.equal(summary.status_label, 'En revisión');
});

// ---------------------------------------------------------------- rutas: denunciante

test('POST /api/reports: sin sesión 401 y cuerpo inválido 400', async () => {
    const anon = await run(routes._internal.submitHandler, { body: quotationBody() });
    assert.equal(anon.res.statusCode, 401);
    assert.equal(anon.res.body.code, 'AUTH_REQUIRED');
    const invalid = await run(routes._internal.submitHandler, { userId: ARTIST, body: quotationBody({ description: 'corta' }) });
    assert.equal(invalid.res.statusCode, 400);
    assert.equal(invalid.res.body.field, 'description');
    assert.equal(invalid.repo.calls.createReport.length, 0);
});

test('artista denuncia una cotización propia: ticket, expediente completo y emails', async () => {
    const previous = process.env.SUPPORT_EMAIL;
    process.env.SUPPORT_EMAIL = 'soporte@weotzi.com';
    let out;
    try {
        out = await run(routes._internal.submitHandler, {
            userId: ARTIST,
            body: quotationBody({
                links: ['https://instagram.com/p/abc'],
                attachments: [{ path: `${ARTIST}/denuncias/1-ab-captura.png`, name: 'captura.png', size: 1200, type: 'image/png' }]
            })
        });
    } finally {
        if (previous === undefined) delete process.env.SUPPORT_EMAIL; else process.env.SUPPORT_EMAIL = previous;
    }
    const { res, repo, emails } = out;
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.ticket, { id: TICKET, number: 42, code: 'WO-00042', status: 'open', created_at: '2026-11-16T14:00:00Z' });
    assert.equal(res.headers['Cache-Control'], 'no-store');

    const report = repo.calls.createReport[0];
    assert.equal(report.reporter_user_id, ARTIST);
    assert.equal(report.requester_role, 'artist');
    assert.equal(report.reporter_role, 'artist');
    assert.equal(report.target_kind, 'quotation');
    assert.equal(report.target_key, 'quotation:55');
    assert.equal(report.reason, 'comentarios_abusivos');
    assert.equal(report.reported_user_id, CLIENT);
    assert.equal(report.reported_role, 'client');
    assert.equal(report.quotation_id, 55);
    assert.equal(report.quote_id, 'WO-2026-0142');
    assert.equal(report.priority, 'high');
    assert.match(report.subject, /^Denuncia de cotización · Comentarios abusivos · Cotización WO-2026-0142$/);
    assert.equal(report.attachments.length, 1);
    assert.deepEqual(report.evidence_links, ['https://instagram.com/p/abc']);
    assert.equal('counterpart_user_id' in report, false, 'el denunciado no es contraparte del ticket');

    const d = report.dossier;
    assert.equal(d.version, 1);
    assert.equal(d.reason.label, 'Comentarios abusivos');
    assert.equal(d.reporter.user_id, ARTIST);
    assert.equal(d.reporter.role, 'artist');
    assert.equal(d.reporter.email, 'mateo@auth.example', 'el email sale de auth.users, no del perfil editable');
    assert.equal(d.reporter.artist.username, 'mateo.ink');
    assert.equal(d.reporter.profile_path, '/artist/profile?artist=mateo.ink');
    assert.equal(d.reported.user_id, CLIENT);
    assert.equal(d.reported.role, 'client');
    assert.equal(d.reported.name, 'Lucía Fernández');
    assert.equal(d.reported.email, 'lucia@auth.example');
    assert.equal(d.quotation.quote_id, 'WO-2026-0142');
    assert.equal(d.quotation.messages.length, 2);
    assert.equal(d.quotation.messages_total, 2);
    assert.deepEqual(d.quotation.reference_images, ['https://cdn.example.com/ref-1.jpg']);
    assert.equal(d.quotation.attachments[0].name, 'ref.png');
    assert.doesNotMatch(JSON.stringify(d), /SECRETO-|1990-01-01/, 'sin salud, alergias ni fecha de nacimiento');

    assert.deepEqual(emails.map((e) => e.eventId).sort(), ['report_ticket_created_support', 'report_ticket_received']);
    const support = emails.find((e) => e.eventId === 'report_ticket_created_support');
    assert.equal(support.payload.support_email, 'soporte@weotzi.com');
    assert.equal(support.payload.ticket_code, 'WO-00042');
    assert.equal(support.payload.reporter_name, 'Mateo Rivas');
    assert.equal(support.payload.reported_name, 'Lucía Fernández');
    assert.equal(support.options.idempotencyKey, `report_ticket_created_support:${TICKET}`);
    assert.doesNotMatch(JSON.stringify(support.payload), /lucia@|insultos/, 'sin contacto del denunciado ni la descripción en el correo');
    const receipt = emails.find((e) => e.eventId === 'report_ticket_received');
    assert.equal(receipt.payload.recipient_email, 'mateo@auth.example');
    assert.equal(receipt.payload.recipient_role, 'artist');
    assert.equal(receipt.options.idempotencyKey, `report_ticket_received:${TICKET}`);
});

test('cotización: solo el artista que la recibió, y nunca una propia como cliente', async () => {
    const other = await run(routes._internal.submitHandler, { userId: OTHER_ARTIST, body: quotationBody() });
    assert.equal(other.res.statusCode, 404, 'la cotización de otro artista no se revela');
    assert.equal(other.res.body.code, 'NOT_FOUND');
    const client = await run(routes._internal.submitHandler, { userId: CLIENT, body: quotationBody() });
    assert.equal(client.res.statusCode, 403);
    assert.equal(client.res.body.code, 'NOT_ALLOWED');
    const missing = await run(routes._internal.submitHandler, { userId: ARTIST, body: quotationBody({ target_id: 'WO-NO-EXISTE' }) });
    assert.equal(missing.res.statusCode, 404);
    const selfRepo = fakeRepo({ async findQuotation() { return { id: 9, quote_id: 'WO-9', artist_id: ARTIST, client_user_id: ARTIST }; } });
    const self = await run(routes._internal.submitHandler, { userId: ARTIST, repo: selfRepo, body: quotationBody({ target_id: '9' }) });
    assert.equal(self.res.statusCode, 409);
    assert.equal(self.res.body.code, 'SELF_REPORT');
    for (const out of [other, client, missing, self]) {
        assert.equal(out.repo.calls.createReport.length, 0);
        assert.equal(out.emails.length, 0);
    }
});

test('cotización de un cliente sin cuenta: el expediente usa los datos de la cotización', async () => {
    const repo = fakeRepo({ async findQuotation() { return { id: 70, quote_id: 'WO-70', artist_id: ARTIST, client_user_id: null, client_full_name: 'Invitado', client_email: 'INVITADO@example.com' }; } });
    const { res } = await run(routes._internal.submitHandler, { userId: ARTIST, repo, body: quotationBody({ target_id: 70, reason: 'spam' }) });
    assert.equal(res.statusCode, 201);
    const report = repo.calls.createReport[0];
    assert.equal(report.reported_user_id, null);
    assert.equal(report.dossier.reported.name, 'Invitado');
    assert.equal(report.dossier.reported.email, 'invitado@example.com');
    assert.equal(report.dossier.reported.has_account, false);
});

test('artista o cliente denuncian a un artista; nadie se denuncia a sí mismo', async () => {
    const body = { kind: 'artist', target_id: 'sara.luna', reason: 'robo_propiedad_intelectual', description: DESCRIPTION };
    const ok = await run(routes._internal.submitHandler, { userId: ARTIST, body });
    assert.equal(ok.res.statusCode, 201);
    const report = ok.repo.calls.createReport[0];
    assert.equal(report.target_key, `artist:${OTHER_ARTIST}`);
    assert.equal(report.reported_user_id, OTHER_ARTIST);
    assert.equal(report.reported_role, 'artist');
    assert.equal(report.quotation_id, null);
    assert.equal(report.dossier.quotation, null);
    assert.equal(report.dossier.reported.email, 'sara@auth.example');
    assert.equal(report.dossier.reported.profile_path, '/artist/profile?artist=sara.luna');

    // Por user_id, por id de fila y por usuario: siempre es la misma persona.
    for (const target of [ARTIST, 'a1111111-1111-4111-8111-111111111111', 'mateo.ink']) {
        const self = await run(routes._internal.submitHandler, { userId: ARTIST, body: { ...body, target_id: target } });
        assert.equal(self.res.statusCode, 409, target);
        assert.equal(self.res.body.code, 'SELF_REPORT');
    }
    // 2.7.0: un cliente también puede denunciar el perfil de un artista.
    const client = await run(routes._internal.submitHandler, { userId: CLIENT, body });
    assert.equal(client.res.statusCode, 201);
    assert.equal(client.repo.calls.createReport[0].reporter_role, 'client');
    assert.equal(client.repo.calls.createReport[0].requester_role, 'client');
    const missing = await run(routes._internal.submitHandler, { userId: ARTIST, body: { ...body, target_id: 'no.existe' } });
    assert.equal(missing.res.statusCode, 404);
    const wrongReason = await run(routes._internal.submitHandler, { userId: ARTIST, body: { ...body, reason: 'spam' } });
    assert.equal(wrongReason.res.statusCode, 400);
});

test('dueño o manager de estudio denuncia a OTRO estudio (y un artista sin estudio también)', async () => {
    const body = { kind: 'studio', target_id: 'tinta-sur', reason: 'suplantacion_identidad', description: DESCRIPTION };
    const owner = await run(routes._internal.submitHandler, { userId: OWNER, body });
    assert.equal(owner.res.statusCode, 201);
    const report = owner.repo.calls.createReport[0];
    assert.equal(report.reporter_role, 'studio_owner');
    assert.equal(report.requester_role, 'client', 'support_tickets.requester_role solo admite artist | client');
    assert.equal(report.reporter_studio_id, STUDIO_A);
    assert.equal(report.reported_studio_id, STUDIO_B);
    assert.equal(report.target_key, `studio:${STUDIO_B}`);
    assert.equal(report.reported_role, 'studio');
    assert.equal(report.reported_user_id, OTHER_ARTIST);
    assert.equal(report.dossier.reporter.name, 'Estudio Norte');
    assert.equal(report.dossier.reporter.studio.id, STUDIO_A);
    assert.equal(report.dossier.reported.studio.slug, 'tinta-sur');
    assert.equal(report.dossier.reported.email, 'sara@auth.example', 'email del dueño en auth.users');
    assert.equal(owner.emails.find((e) => e.eventId === 'report_ticket_received').payload.recipient_role, 'studio');

    const manager = await run(routes._internal.submitHandler, { userId: MANAGER, body });
    assert.equal(manager.res.statusCode, 201);
    assert.equal(manager.repo.calls.createReport[0].reporter_role, 'studio_manager');

    const ownStudio = await run(routes._internal.submitHandler, { userId: OWNER, body: { ...body, target_id: STUDIO_A } });
    assert.equal(ownStudio.res.statusCode, 409);
    const managedStudio = await run(routes._internal.submitHandler, { userId: MANAGER, body: { ...body, target_id: 'estudio-norte' } });
    assert.equal(managedStudio.res.statusCode, 409);
    assert.equal(managedStudio.res.body.code, 'SELF_REPORT');
    // 2.7.0: cualquier persona con sesión denuncia estudios.
    const artistOnly = await run(routes._internal.submitHandler, { userId: ARTIST, body });
    assert.equal(artistOnly.res.statusCode, 201, 'un artista sin estudio también denuncia estudios');
    assert.equal(artistOnly.repo.calls.createReport[0].reporter_role, 'artist');
    assert.equal(artistOnly.repo.calls.createReport[0].reporter_studio_id, null);
    const missing = await run(routes._internal.submitHandler, { userId: OWNER, body: { ...body, target_id: 'no-existe' } });
    assert.equal(missing.res.statusCode, 404);
});

test('duplicado: devuelve el ticket abierto y no reenvía correos', async () => {
    const repo = fakeRepo({ async createReport() { return { duplicate: true, ticket_id: TICKET, ticket_number: 42, status: 'in_progress' }; } });
    const { res, emails } = await run(routes._internal.submitHandler, { userId: ARTIST, repo, body: quotationBody() });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
    assert.equal(res.body.ticket.code, 'WO-00042');
    assert.match(res.body.message, /Ya tienes una denuncia abierta/);
    assert.equal(emails.length, 0);
});

test('errores de la RPC: tope diario 429, adjunto inválido 400, migración pendiente 503, resto 500 genérico', async () => {
    const failing = (message) => fakeRepo({ async createReport() { throw new Error(message); } });
    const limit = await run(routes._internal.submitHandler, {
        userId: ARTIST, body: quotationBody(),
        repo: failing('PostgREST POST rpc/create_support_report failed (400): {"code":"WR429","details":null,"hint":null,"message":"Llegaste al máximo de denuncias por hoy. Si es urgente, escríbenos por el chat de soporte."}')
    });
    assert.equal(limit.res.statusCode, 429);
    assert.equal(limit.res.body.code, 'REPORT_DAILY_LIMIT');
    assert.match(limit.res.body.error, /máximo de denuncias por hoy/);

    const attachment = await run(routes._internal.submitHandler, {
        userId: ARTIST, body: quotationBody(),
        repo: failing('PostgREST POST rpc/create_support_report failed (400): {"code":"22023","message":"No encontramos una de las imágenes. Vuelve a subirla."}')
    });
    assert.equal(attachment.res.statusCode, 400);
    assert.equal(attachment.res.body.field, 'attachments');

    const pending = await run(routes._internal.submitHandler, {
        userId: ARTIST, body: quotationBody(),
        repo: failing('PostgREST POST rpc/create_support_report failed (404): {"code":"PGRST202","message":"Could not find the function"}')
    });
    assert.equal(pending.res.statusCode, 503);
    assert.equal(pending.res.body.code, 'MIGRATION_PENDING');

    const boom = await run(routes._internal.submitHandler, {
        userId: ARTIST, body: quotationBody(),
        repo: failing('PostgREST POST rpc/create_support_report failed (500): {"code":"XX000","message":"detalle interno de la base"}')
    });
    assert.equal(boom.res.statusCode, 500);
    assert.doesNotMatch(boom.res.body.error, /detalle interno/);
    for (const out of [limit, attachment, pending, boom]) assert.equal(out.emails.length, 0);
});

test('un fallo de email no rompe la denuncia ya creada', async () => {
    const repo = fakeRepo();
    const restore = routes._internal.setDeps({
        repo,
        resolveBearerUser: async () => ({ id: ARTIST, email: 'token@example.com' }),
        isSuperadminEmail: () => false,
        sendEmail: async () => { throw new Error('relay caído'); },
        applicationBase: () => 'https://beta.weotzi.com',
        now: () => new Date('2026-11-16T14:00:00Z')
    });
    const res = mockRes();
    const warn = console.warn;
    console.warn = () => {};
    try { await routes._internal.submitHandler({ headers: {}, body: quotationBody(), query: {}, params: {} }, res); } finally { console.warn = warn; restore(); }
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.receipt_sent, false);
});

test('expediente gigante: se recorta el chat para respetar el tope de la tabla', () => {
    const dossier = { quotation: { messages: Array.from({ length: 80 }, (_, i) => ({ id: i, message: 'x'.repeat(20000) })) } };
    const fitted = routes._internal.fitDossier(dossier);
    assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= 480 * 1024);
    assert.equal(fitted.quotation.messages_truncated, true);
    assert.equal(fitted.quotation.messages[fitted.quotation.messages.length - 1].id, 79, 'conserva los más recientes');
});

test('GET /api/reports/eligibility: motivos del tipo o el porqué del no', async () => {
    const anon = await run(routes._internal.eligibilityHandler, { query: { kind: 'studio', id: 'tinta-sur' } });
    assert.equal(anon.res.statusCode, 401);
    const bad = await run(routes._internal.eligibilityHandler, { userId: OWNER, query: { kind: 'cliente', id: 'x' } });
    assert.equal(bad.res.statusCode, 400);
    const yes = await run(routes._internal.eligibilityHandler, { userId: OWNER, query: { kind: 'studio', id: 'tinta-sur' } });
    assert.equal(yes.res.statusCode, 200);
    assert.equal(yes.res.body.eligible, true);
    assert.equal(yes.res.body.target_label, 'Tinta Sur');
    assert.deepEqual(yes.res.body.reasons, D.REASONS.studio);
    assert.equal(yes.res.body.limits.images, 3);
    assert.equal(yes.res.body.limits.daily, D.DAILY_LIMIT);
    const own = await run(routes._internal.eligibilityHandler, { userId: OWNER, query: { kind: 'studio', id: STUDIO_A } });
    assert.equal(own.res.body.eligible, false);
    assert.equal(own.res.body.code, 'SELF_REPORT');
    // 2.7.0: el cliente puede denunciar perfiles; las cotizaciones siguen siendo del artista.
    const client = await run(routes._internal.eligibilityHandler, { userId: CLIENT, query: { kind: 'artist', id: 'sara.luna' } });
    assert.equal(client.res.statusCode, 200);
    assert.equal(client.res.body.eligible, true);
    assert.equal(client.res.body.reporter_role, 'client');
    assert.deepEqual(client.res.body.reasons, D.REASONS.artist);
    const clientQuote = await run(routes._internal.eligibilityHandler, { userId: CLIENT, query: { kind: 'quotation', id: '55' } });
    assert.equal(clientQuote.res.body.eligible, false);
    assert.equal(clientQuote.res.body.code, 'NOT_ALLOWED');
    assert.deepEqual(clientQuote.res.body.reasons, []);
    const quote = await run(routes._internal.eligibilityHandler, { userId: ARTIST, query: { kind: 'quotation', id: '55' } });
    assert.equal(quote.res.body.eligible, true);
    assert.deepEqual(quote.res.body.reasons.map((r) => r.code), ['comentarios_abusivos', 'fotos_inapropiadas', 'violencia', 'spam']);
});

// ---------------------------------------------------------------- rutas: soporte

const storedReport = () => ({
    id: 'r1', ticket_id: TICKET, target_kind: 'quotation', target_key: 'quotation:55', reason: 'violencia',
    reporter_user_id: ARTIST, reporter_role: 'artist', reported_user_id: CLIENT, reported_role: 'client', quote_id: 'WO-2026-0142',
    evidence_links: ['https://instagram.com/p/abc'], created_at: '2026-11-16T14:00:00Z',
    dossier: {
        version: 1,
        reporter: { name: 'Mateo Rivas', email: 'mateo@auth.example', profile_path: '/artist/profile?artist=mateo.ink' },
        reported: { name: 'Lucía Fernández', email: 'lucia@auth.example' },
        evidence: { links: [], attachments: [{ path: `${ARTIST}/denuncias/1-ab-captura.png`, name: 'captura.png' }] },
        quotation: {
            quote_id: 'WO-2026-0142',
            messages: [
                { id: 'm1', sender_type: 'client', message: 'Mensaje', attachment_path: 'WO-2026-0142/foto.jpg', attachment_name: 'foto.jpg' },
                { id: 'm2', sender_type: 'client', message: 'Otro', attachment_path: 'WO-OTRA/ajena.jpg', attachment_name: 'ajena.jpg' }
            ]
        }
    },
    ticket: {
        id: TICKET, ticket_number: 42, status: 'open', priority: 'urgent', subject: 'Denuncia de cotización · Violencia', description: DESCRIPTION,
        attachments: [
            { path: `${ARTIST}/denuncias/1-ab-captura.png`, name: 'captura.png', size: 1200, type: 'image/png' },
            { path: `${CLIENT}/otra/ajena.png`, name: 'ajena.png' }
        ],
        assigned_support_user_id: null, created_at: '2026-11-16T14:00:00Z'
    }
});

test('soporte: solo agentes activos o el superadmin ven la cola', async () => {
    const anon = await run(routes._internal.listHandler, {});
    assert.equal(anon.res.statusCode, 401);
    const artist = await run(routes._internal.listHandler, { userId: ARTIST });
    assert.equal(artist.res.statusCode, 403);
    for (const handler of ['detailHandler', 'statusHandler', 'noteHandler']) {
        const out = await run(routes._internal[handler], { userId: ARTIST, params: { ticketId: TICKET }, body: { status: 'closed', note: 'x' } });
        assert.equal(out.res.statusCode, 403, handler);
    }
    const repo = fakeRepo({ async listReports(filters) { repo.filters = filters; return [storedReport()]; }, async countActiveReports() { return 3; } });
    const agent = await run(routes._internal.listHandler, { userId: AGENT, repo, query: { status: 'open', kind: 'quotation' } });
    assert.equal(agent.res.statusCode, 200);
    assert.deepEqual(repo.filters, { statuses: ['open'], kind: 'quotation' });
    assert.equal(agent.res.body.active_count, 3);
    assert.equal(agent.res.body.reports[0].code, 'WO-00042');
    assert.equal(agent.res.body.reports[0].reason_label, 'Violencia');
    assert.equal(agent.res.body.reports[0].reporter.name, 'Mateo Rivas');
    assert.equal('dossier' in agent.res.body.reports[0], false, 'la cola no trae el expediente completo');
    const admin = await run(routes._internal.listHandler, { userId: OWNER, superadmin: true });
    assert.equal(admin.res.statusCode, 200);
    assert.equal(admin.res.body.reviewer.role, 'superadmin');
    const badFilter = await run(routes._internal.listHandler, { userId: AGENT, query: { status: 'x' } });
    assert.equal(badFilter.res.statusCode, 400);
    const pendingRepo = fakeRepo({ async listReports() { throw new Error('PostgREST GET support_ticket_reports failed (404): {"code":"PGRST205","message":"no table"}'); } });
    const pending = await run(routes._internal.listHandler, { userId: AGENT, repo: pendingRepo });
    assert.equal(pending.res.statusCode, 200);
    assert.equal(pending.res.body.migration_pending, true);
});

test('soporte: el detalle firma la evidencia propia del denunciante y no expone rutas de Storage', async () => {
    const repo = fakeRepo({
        async getReportByTicket(id) { return id === TICKET ? storedReport() : null; },
        async listTicketMessages() { return [{ id: 'n1', author_user_id: AGENT, author_role: 'support', body: 'Revisando', is_internal: true, created_at: '2026-11-16T15:00:00Z' }]; }
    });
    const { res } = await run(routes._internal.detailHandler, { userId: AGENT, repo, params: { ticketId: TICKET } });
    assert.equal(res.statusCode, 200);
    const report = res.body.report;
    assert.equal(report.code, 'WO-00042');
    assert.equal(report.description, DESCRIPTION);
    assert.equal(report.priority, 'urgent');
    assert.deepEqual(report.dossier.evidence.links, ['https://instagram.com/p/abc']);
    assert.equal(report.dossier.evidence.attachments.length, 1, 'un adjunto fuera de la carpeta del denunciante no se firma');
    assert.match(report.dossier.evidence.attachments[0].url, /^https:\/\/signed\.example\.com\/support-attachments\//);
    const [own, foreign] = report.dossier.quotation.messages;
    assert.match(own.attachment_url, /chat-attachments\/WO-2026-0142\/foto\.jpg/);
    assert.equal(foreign.attachment_url, null, 'solo se firman adjuntos del chat de esa cotización');
    assert.equal(foreign.has_attachment, true);
    assert.doesNotMatch(JSON.stringify(res.body), /"(path|attachment_path)":/, 'las rutas de Storage se quedan en el servidor');
    assert.deepEqual(repo.calls.signed.sort(), [`chat-attachments:WO-2026-0142/foto.jpg`, `support-attachments:${ARTIST}/denuncias/1-ab-captura.png`]);
    assert.equal(report.messages[0].author_name, 'Ana Soporte');
    assert.equal(report.messages[0].mine, true);

    const missing = await run(routes._internal.detailHandler, { userId: AGENT, repo, params: { ticketId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(missing.res.statusCode, 404);
    const invalid = await run(routes._internal.detailHandler, { userId: AGENT, repo, params: { ticketId: 'x' } });
    assert.equal(invalid.res.statusCode, 400);
});

test('soporte: cambio de estado con resolución, asignación y nota de auditoría', async () => {
    const repo = fakeRepo({ async getReportByTicket() { return storedReport(); } });
    const invalid = await run(routes._internal.statusHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { status: 'resolved' } });
    assert.equal(invalid.res.statusCode, 400);
    assert.equal(repo.calls.updates.length, 0);

    const progress = await run(routes._internal.statusHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { status: 'in_progress' } });
    assert.equal(progress.res.statusCode, 200);
    assert.deepEqual(repo.calls.updates[0], { id: TICKET, patch: { status: 'in_progress', assigned_support_user_id: AGENT } });
    assert.equal(repo.calls.notes[0].isInternal, true);
    assert.equal(repo.calls.notes[0].authorRole, 'support');
    assert.equal(repo.calls.notes[0].authorUserId, AGENT);
    assert.match(repo.calls.notes[0].body, /Estado: Abierta → En revisión\./);

    const resolved = await run(routes._internal.statusHandler, {
        userId: AGENT, repo, params: { ticketId: TICKET },
        body: { status: 'resolved', outcome: 'resuelto', resolution: 'Se suspendió la cuenta del cliente.' }
    });
    assert.equal(resolved.res.statusCode, 200);
    assert.equal(repo.calls.updates[1].patch.resolution_outcome, 'resuelto');
    assert.equal(repo.calls.updates[1].patch.resolution, 'Se suspendió la cuenta del cliente.');
    assert.match(repo.calls.notes[1].body, /Resolución \(Se tomó acción\): Se suspendió la cuenta del cliente\./);
    assert.equal(resolved.res.body.ticket.status_label, 'Resuelta');

    const gone = await run(routes._internal.statusHandler, { userId: AGENT, repo: fakeRepo(), params: { ticketId: TICKET }, body: { status: 'closed' } });
    assert.equal(gone.res.statusCode, 404);
});

test('soporte: nota interna (nunca visible para el denunciante ni el denunciado)', async () => {
    const repo = fakeRepo({ async getReportByTicket() { return storedReport(); } });
    const empty = await run(routes._internal.noteHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { note: '  ' } });
    assert.equal(empty.res.statusCode, 400);
    const ok = await run(routes._internal.noteHandler, { userId: AGENT, repo, params: { ticketId: TICKET }, body: { note: 'Hablé con el artista por teléfono.' } });
    assert.equal(ok.res.statusCode, 201);
    assert.deepEqual(repo.calls.notes[0], { ticketId: TICKET, authorUserId: AGENT, authorRole: 'support', body: 'Hablé con el artista por teléfono.', isInternal: true });
    assert.equal(ok.res.body.message.is_internal, true);
});

test('repo: tablas y columnas del esquema vivo, embed por FK y tickets filtrados por kind', () => {
    const src = read('lib/repos/denuncias.js');
    assert.match(src, /require\('\.\.\/postgrest'\)/);
    assert.doesNotMatch(src, /rest\/v1\//, 'sin fetch ad-hoc a PostgREST');
    assert.match(src, /rpc\/create_support_report/);
    assert.match(src, /support_tickets!inner\(/);
    assert.match(src, /\.in\('support_tickets\.status', statuses\)/);
    assert.match(src, /\.eq\('id', ticketId\)\.eq\('kind', 'denuncia'\)\.patch\(patch\)/, 'nunca toca consultas ni disputas');
    assert.match(src, /\.eq\('artist_user_id', userId\)\.eq\('role', 'manager'\)\.eq\('status', 'active'\)/, 'manager activo, como private.studio_inbox_access');
    assert.doesNotMatch(src, /health|allerg|birth_date/, 'el expediente no lee salud, alergias ni fecha de nacimiento');
});

test('server.js registra las rutas con una línea, antes de los redirects legacy y del estático', () => {
    const server = read('server.js');
    const line = "require('./lib/routes/denuncias').register(app);";
    assert.equal(server.split(line).length - 1, 1);
    assert.ok(server.indexOf(line) < server.indexOf('legacyRedirectFor(req.path'));
    assert.ok(server.indexOf(line) < server.indexOf("app.use(express.static(path.join(__dirname, 'public')))"));
    const registered = [];
    const app = { get: (p) => registered.push(`GET ${p}`), post: (p) => registered.push(`POST ${p}`) };
    routes.register(app);
    assert.deepEqual(registered, [
        'GET /api/reports/eligibility', 'POST /api/reports', 'GET /api/support/reports', 'GET /api/support/reports/:ticketId',
        'POST /api/support/reports/:ticketId/status', 'POST /api/support/reports/:ticketId/notes',
        'POST /api/support/reports/:ticketId/claim', 'POST /api/support/reports/:ticketId/notify-reported'
    ]);
});
