'use strict';
// Feedback de la beta cerrada: botón "Comentarios" + encuestas cortas.
// Lógica pura (lib/feedback.js), rutas con dependencias inyectadas
// (lib/routes/feedback.js), migración y reversa, cargador del botón en
// config-manager.js, módulo del navegador (wo-feedback.js), pestaña de soporte
// y los puntos de éxito que piden cada encuesta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const F = require('../lib/feedback');
const { createHandlers, register } = require('../lib/routes/feedback');
const WF = require('../public/shared/js/wo-feedback.js')._internal;
const WR = require('../public/shared/js/wo-report.js')._internal;
const SD = require('../public/shared/js/support-dashboard-feedback.js')._internal;

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-11-17T12:00:00Z');

const shot = (over = {}) => ({ path: `${UID}/feedback/1731840000000-abc123-pantalla.png`, name: 'pantalla.png', size: 2048, type: 'image/png', ...over });

// ---------------------------------------------------------------- lógica pura

test('validación: tipo, largo del mensaje y calificación opcional', () => {
    const ok = F.parseFeedbackInput({ kind: 'bug', message: '  El botón de guardar no responde.  ', rating: 2, mode: 'artist' }, { userId: UID });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.message, 'El botón de guardar no responde.');
    assert.equal(ok.value.rating, 2);
    assert.equal(ok.value.mode, 'artist');
    assert.equal(F.parseFeedbackInput({ kind: 'queja', message: 'x'.repeat(20) }, { userId: UID }).field, 'kind');
    assert.equal(F.parseFeedbackInput({ kind: 'idea', message: 'corto' }, { userId: UID }).field, 'message');
    assert.equal(F.parseFeedbackInput({ kind: 'idea', message: 'x'.repeat(2001) }, { userId: UID }).field, 'message');
    assert.equal(F.parseFeedbackInput({ kind: 'idea', message: 'x'.repeat(2000) }, { userId: UID }).ok, true);
    assert.equal(F.parseFeedbackInput({ kind: 'comment', message: 'x'.repeat(20), rating: 6 }, { userId: UID }).field, 'rating');
    assert.equal(F.parseFeedbackInput({ kind: 'comment', message: 'x'.repeat(20), rating: '' }, { userId: UID }).value.rating, null);
    // Un modo que no es un rol se ignora.
    assert.equal(F.parseFeedbackInput({ kind: 'comment', message: 'x'.repeat(20), mode: 'admin' }, { userId: UID }).value.mode, null);
});

test('encuesta: clave del catálogo, calificación obligatoria y comentario opcional', () => {
    const ok = F.parseFeedbackInput({ kind: 'survey', survey_key: 'registro_cliente', rating: 5 }, { userId: UID });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.message, null);
    assert.deepEqual(ok.value.attachments, []);
    assert.equal(F.parseFeedbackInput({ kind: 'survey', survey_key: 'registro_cliente' }, { userId: UID }).field, 'rating');
    assert.equal(F.parseFeedbackInput({ kind: 'survey', survey_key: 'inventada', rating: 3 }, { userId: UID }).field, 'survey_key');
    assert.equal(F.parseFeedbackInput({ kind: 'survey', survey_key: 'constructor', rating: 3 }, { userId: UID }).field, 'survey_key');
    // El comentario de la encuesta puede ser corto.
    assert.equal(F.parseFeedbackInput({ kind: 'survey', survey_key: 'propuesta_enviada', rating: 4, message: 'ok' }, { userId: UID }).value.message, 'ok');
});

test('contexto: solo ruta sin query, título, idioma, pantalla y navegador', () => {
    const v = F.parseFeedbackInput({
        kind: 'comment', message: 'Todo bien por ahora.',
        page_path: '/quotation/?token=secreto#paso-3', page_title: 'Cotizador\n',
        context: { lang: 'es-AR', viewport: { w: 390, h: 844 }, email: 'no@debe.guardarse', ua: 'del cuerpo' }
    }, { userId: UID, userAgent: 'Mozilla/5.0 (cabecera)' }).value;
    assert.equal(v.page_path, '/quotation/');
    assert.equal(v.page_title, 'Cotizador');
    assert.deepEqual(v.context, { lang: 'es-AR', viewport: { w: 390, h: 844 }, ua: 'Mozilla/5.0 (cabecera)' });
    assert.equal(F.cleanPagePath('https://evil.example/x'), null);
    assert.equal(F.cleanPagePath('//evil.example/x'), null);
    assert.deepEqual(F.parseContext({ lang: '<script>', viewport: { w: -1, h: 9 } }, ''), {});
});

test('adjuntos: solo en la carpeta feedback de la persona, imágenes de hasta 10 MB y máximo 2', () => {
    const ok = F.parseAttachments([shot(), shot()], UID);
    assert.equal(ok.ok, true);
    assert.equal(ok.value.length, 1, 'sin duplicados');
    const foreign = F.parseAttachments([shot({ path: `${OTHER}/feedback/1-a-x.png` })], UID);
    assert.equal(foreign.ok, false);
    assert.equal(foreign.status, 403);
    assert.equal(F.parseAttachments([shot({ path: `${UID}/denuncias/1-a-x.png` })], UID).status, 403, 'otra carpeta del mismo usuario');
    assert.equal(F.parseAttachments([shot({ path: `${UID}/feedback/../../${OTHER}/x.png` })], UID).status, 403);
    assert.equal(F.parseAttachments([shot({ path: `${UID}/feedback/sub/x.png` })], UID).status, 403);
    assert.equal(F.parseAttachments([shot({ type: 'application/pdf' })], UID).field, 'attachments');
    assert.equal(F.parseAttachments([shot({ size: 10 * 1024 * 1024 + 1 })], UID).field, 'attachments');
    assert.equal(F.parseAttachments([shot({ path: `${UID}/feedback/1-a.png` }), shot({ path: `${UID}/feedback/2-b.png` }), shot({ path: `${UID}/feedback/3-c.png` })], UID).field, 'attachments');
    assert.equal(F.parseAttachments('nope', UID).ok, false);
    // En la entrada completa del botón, una captura ajena corta el envío.
    assert.equal(F.parseFeedbackInput({ kind: 'bug', message: 'Falla al subir fotos.', attachments: [shot({ path: `${OTHER}/feedback/1-a-x.png` })] }, { userId: UID }).status, 403);
});

test('rol: se detecta en el servidor; el modo del front solo elige entre los propios', () => {
    assert.equal(F.pickRole({ artist: false, client: false, studio: false }, 'artist'), null);
    assert.equal(F.pickRole({ client: true }, 'artist'), 'client', 'un modo ajeno no cuenta');
    assert.equal(F.pickRole({ artist: true, client: true }, 'client'), 'client');
    assert.equal(F.pickRole({ artist: true, client: true, studio: true }, null), 'artist');
    assert.equal(F.pickRole({ client: true, studio: true }, null), 'studio');
    assert.deepEqual(F.ownRoles({ client: true, studio: true }), ['studio', 'client']);
});

test('límite diario: 20 envíos en 24 h', () => {
    assert.equal(F.DAILY_LIMIT, 20);
    assert.equal(F.overDailyLimit(19), false);
    assert.equal(F.overDailyLimit(20), true);
    assert.equal(F.dailyWindowStart(NOW), '2026-11-16T12:00:00.000Z');
});

test('soporte: filtros de la lista, cambio de estado y búsqueda segura', () => {
    const q = F.parseListQuery({ role: 'client', kind: 'survey', status: 'new', survey_key: 'registro_cliente', q: 'foto*,(x)', from: '2026-11-01', to: '2026-11-17', page: '2', page_size: '500' });
    assert.equal(q.ok, true);
    assert.equal(q.value.page_size, 100);
    assert.equal(q.value.offset, 100);
    assert.equal(q.value.q, 'foto x');
    assert.equal(q.value.include_dismissed, false);
    assert.equal(F.parseListQuery({ role: 'admin' }).ok, false);
    assert.equal(F.parseListQuery({ from: '17/11/2026' }).field, 'from');
    assert.equal(F.parseListQuery({ from: '2026-11-10', to: '2026-11-01' }).field, 'from');
    assert.equal(F.parseListQuery({ role: 'all' }).value.role, null);
    assert.deepEqual(F.parseStatusInput({ status: 'done', support_note: ' Pasó al tablero ' }).value, { status: 'done', support_note: 'Pasó al tablero' });
    assert.equal(F.parseStatusInput({ status: 'cerrado' }).ok, false);
    assert.equal(F.parseStatusInput({}).ok, false);
    assert.equal(F.parseStatusInput({ support_note: 'x'.repeat(4001) }).field, 'support_note');
});

test('resumen: conteos por rol, tipo y estado; promedio y descartes por encuesta', () => {
    const s = F.buildSummary([
        { role: 'artist', kind: 'bug', status: 'new', rating: 2 },
        { role: 'client', kind: 'idea', status: 'done', rating: 4 },
        { role: 'client', kind: 'survey', status: 'new', survey_key: 'registro_cliente', rating: 5 },
        { role: 'client', kind: 'survey', status: 'new', survey_key: 'registro_cliente', rating: 4 },
        { role: 'studio', kind: 'survey', status: 'new', survey_key: 'registro_estudio', rating: null, dismissed: true }
    ]);
    assert.equal(s.total, 4, 'los descartes no cuentan como feedback');
    assert.deepEqual(s.by_role, { artist: 1, client: 3, studio: 0 });
    assert.equal(s.by_kind.survey, 2);
    assert.equal(s.by_status.new, 3);
    assert.deepEqual(s.ease, { count: 2, average: 3 });
    const reg = s.surveys.find((x) => x.key === 'registro_cliente');
    assert.equal(reg.answered, 2);
    assert.equal(reg.average, 4.5);
    assert.deepEqual(reg.distribution, [0, 0, 0, 1, 1]);
    assert.equal(s.surveys.find((x) => x.key === 'registro_estudio').dismissed, 1);
    assert.equal(s.surveys.length, Object.keys(F.SURVEYS).length);
});

test('CSV: BOM, comillas, guardia contra fórmulas y sin correos', () => {
    const names = new Map([[UID, { client: 'Ana "La" Pérez' }]]);
    const csv = F.toCsv([{
        id: ROW_ID, user_id: UID, role: 'client', kind: 'comment', rating: null, message: '=HYPERLINK("x")\nsegunda línea',
        page_path: '/client/dashboard', status: 'new', context: { lang: 'es', viewport: { w: 1280, h: 800 } }, attachments: [{}]
    }], names);
    assert.ok(csv.startsWith('﻿id,fecha,tipo_de_cuenta'));
    assert.match(csv, /"'=HYPERLINK\(""x""\)\nsegunda línea"/);
    assert.match(csv, /"Ana ""La"" Pérez"/);
    assert.match(csv, /1280x800/);
    assert.doesNotMatch(csv, /correo|email|@/i);
});

// ---------------------------------------------------------------- rutas

function fakeRes() {
    return {
        statusCode: 200, body: undefined, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; },
        set(key, value) { this.headers[String(key).toLowerCase()] = value; return this; }
    };
}

function fakeReq({ body, params, query, user } = {}) {
    return { body: body || {}, params: params || {}, query: query || {}, user, get: (h) => (String(h).toLowerCase() === 'user-agent' ? 'TestAgent/1.0' : '') };
}

function memoryRepo(opts = {}) {
    const rows = (opts.rows || []).slice();
    const roles = opts.roles || { [UID]: { artist: true, client: true, studio: false } };
    const repo = {
        rows,
        inserted: [],
        updates: [],
        signed: [],
        resolveRoles: async (id) => roles[id] || { artist: false, client: false, studio: false },
        findSurvey: async (id, key) => rows.find((r) => r.user_id === id && r.kind === 'survey' && r.survey_key === key) || null,
        countSince: async (id, since) => rows.filter((r) => r.user_id === id && !r.dismissed && r.created_at >= since).length,
        listSurveyKeys: async (id) => rows.filter((r) => r.user_id === id && r.kind === 'survey').map((r) => ({ survey_key: r.survey_key, dismissed: !!r.dismissed })),
        insert: async (row) => {
            if (opts.failInsert) throw opts.failInsert;
            const saved = { id: ROW_ID, status: 'new', created_at: new Date(NOW).toISOString(), ...row };
            rows.push(saved); repo.inserted.push(saved);
            return saved;
        },
        getActiveSupportUser: async (id) => (id === AGENT ? { user_id: AGENT, email: 'agente@weotzi.com' } : null),
        getAuthUserContact: async () => ({ email: 'Ana@Example.com' }),
        list: async (f) => ({ rows: rows.slice(f.offset, f.offset + f.page_size), total: rows.length }),
        listForExport: async () => rows.slice(),
        summaryRows: async () => rows.slice(),
        getById: async (id) => rows.find((r) => r.id === id) || null,
        update: async (id, patch) => { repo.updates.push({ id, patch }); const r = rows.find((x) => x.id === id); return r ? Object.assign(r, patch) : null; },
        namesFor: async (ids) => new Map(ids.map((id) => [id, { client: 'Ana', artist: 'Ana Tattoo' }])),
        signObject: async (p) => { repo.signed.push(p); return 'https://storage.example/firmada/' + p.split('/').pop(); }
    };
    return repo;
}

function handlersWith(repo, extra = {}) {
    return createHandlers({
        repo,
        resolveBearerUser: async (req) => req.user || null,
        isSuperadminEmail: (email) => email === 'super@weotzi.com',
        isMissingSchemaError: (err) => /42P01/.test(String(err && err.message)),
        pgErrorCode: (err) => (err && err.code) || null,
        logger: { log() {}, warn() {}, error() {} },
        now: () => NOW,
        ...extra
    });
}

const person = { id: UID, email: 'ana@example.com' };

test('POST /api/feedback: sesión, rol detectado en el servidor y guardado', async () => {
    const repo = memoryRepo();
    const h = handlersWith(repo);
    let res = fakeRes();
    await h.submit(fakeReq({ body: { kind: 'bug', message: 'No carga la galería.' } }), res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await h.submit(fakeReq({ user: person, body: { kind: 'bug', message: 'No carga la galería.', mode: 'client', page_path: '/client/dashboard?x=1', attachments: [shot()] } }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.role, 'client');
    const row = repo.inserted[0];
    assert.equal(row.user_id, UID);
    assert.equal(row.role, 'client');
    assert.equal(row.page_path, '/client/dashboard');
    assert.equal(row.context.ua, 'TestAgent/1.0');
    assert.equal(row.attachments.length, 1);
    assert.equal(row.status, 'new', 'nace en new (default de la tabla)');
    assert.equal(res.headers['cache-control'], 'no-store');

    // Mode que no es suyo: queda el primero de los suyos.
    res = fakeRes();
    await h.submit(fakeReq({ user: person, body: { kind: 'idea', message: 'Un modo oscuro estaría bueno.', mode: 'studio' } }), res);
    assert.equal(res.body.role, 'artist');
});

test('POST /api/feedback: sin cuenta de tatuador, cliente ni estudio → 403', async () => {
    const h = handlersWith(memoryRepo({ roles: {} }));
    const res = fakeRes();
    await h.submit(fakeReq({ user: person, body: { kind: 'comment', message: 'Hola, soy de soporte.' } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'NO_ROLE');
});

test('POST /api/feedback: captura fuera de la carpeta → 403 y no guarda', async () => {
    const repo = memoryRepo();
    const res = fakeRes();
    await handlersWith(repo).submit(fakeReq({ user: person, body: { kind: 'bug', message: 'Adjunto la captura.', attachments: [shot({ path: `${OTHER}/feedback/1-a-x.png` })] } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.field, 'attachments');
    assert.equal(repo.inserted.length, 0);
});

test('POST /api/feedback: tope de 20 por día', async () => {
    const recent = new Date(NOW - 60 * 1000).toISOString();
    const old = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i, user_id: UID, kind: 'comment', created_at: recent }));
    let repo = memoryRepo({ rows });
    let res = fakeRes();
    await handlersWith(repo).submit(fakeReq({ user: person, body: { kind: 'comment', message: 'Uno más, el número 21.' } }), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, 'FEEDBACK_DAILY_LIMIT');
    // Los de hace dos días y los descartes no cuentan.
    repo = memoryRepo({ rows: rows.map((r, i) => ({ ...r, created_at: i < 10 ? old : recent, dismissed: i === 19 })) });
    res = fakeRes();
    await handlersWith(repo).submit(fakeReq({ user: person, body: { kind: 'comment', message: 'Este sí entra hoy.' } }), res);
    assert.equal(res.statusCode, 201);
});

test('encuesta: respuesta idempotente (misma clave dos veces y carrera de pestañas)', async () => {
    const repo = memoryRepo();
    const h = handlersWith(repo);
    const body = { kind: 'survey', survey_key: 'registro_cliente', rating: 4, message: 'Fácil' };
    let res = fakeRes();
    await h.submit(fakeReq({ user: person, body }), res);
    assert.equal(res.statusCode, 201);
    res = fakeRes();
    await h.submit(fakeReq({ user: person, body: { ...body, rating: 1 } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
    assert.equal(repo.inserted.length, 1);

    // Dos pestañas: la segunda choca con el único parcial (23505).
    const race = memoryRepo({ failInsert: Object.assign(new Error('duplicate key value violates unique constraint "beta_feedback_user_survey_uniq"'), { code: '23505' }) });
    res = fakeRes();
    await handlersWith(race).submit(fakeReq({ user: person, body }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
});

test('GET /api/feedback/surveys y "Ahora no": no se vuelve a preguntar', async () => {
    const repo = memoryRepo({ rows: [{ id: 'a', user_id: UID, kind: 'survey', survey_key: 'registro_tatuador', rating: 5, created_at: '2026-11-16T00:00:00Z' }] });
    const h = handlersWith(repo);
    let res = fakeRes();
    await h.surveys(fakeReq({ user: person }), res);
    assert.deepEqual(res.body.roles, ['artist', 'client']);
    assert.deepEqual(res.body.keys, ['registro_tatuador']);

    res = fakeRes();
    await h.dismiss(fakeReq({ user: person, params: { key: 'propuesta_enviada' }, body: { mode: 'artist', page_path: '/my-quotations/?q=1' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already, false);
    const row = repo.inserted[0];
    assert.equal(row.dismissed, true);
    assert.equal(row.rating, null);
    assert.equal(row.message, null);
    assert.equal(row.page_path, '/my-quotations/');

    res = fakeRes();
    await h.dismiss(fakeReq({ user: person, params: { key: 'propuesta_enviada' } }), res);
    assert.equal(res.body.already, true);
    assert.equal(repo.inserted.length, 1);

    res = fakeRes();
    await h.surveys(fakeReq({ user: person }), res);
    assert.deepEqual(res.body.answered, ['registro_tatuador']);
    assert.deepEqual(res.body.dismissed, ['propuesta_enviada']);

    res = fakeRes();
    await h.dismiss(fakeReq({ user: person, params: { key: 'otra_cosa' } }), res);
    assert.equal(res.statusCode, 400);
});

test('migración pendiente: el botón responde 503 y las encuestas no rompen', async () => {
    const missing = new Error('PostgREST GET beta_feedback failed (404): {"code":"42P01"}');
    const repo = memoryRepo();
    repo.findSurvey = async () => { throw missing; };
    repo.countSince = async () => { throw missing; };
    repo.listSurveyKeys = async () => { throw missing; };
    const h = handlersWith(repo);
    let res = fakeRes();
    await h.submit(fakeReq({ user: person, body: { kind: 'comment', message: 'Probando el botón.' } }), res);
    assert.equal(res.statusCode, 503);
    res = fakeRes();
    await h.surveys(fakeReq({ user: person }), res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.migration_pending, true);
});

test('soporte: mismo control que /api/support/reports (agente activo o superadmin)', async () => {
    const h = handlersWith(memoryRepo());
    let res = fakeRes();
    await h.supportList(fakeReq({}), res);
    assert.equal(res.statusCode, 401);
    res = fakeRes();
    await h.supportList(fakeReq({ user: person }), res);
    assert.equal(res.statusCode, 403);
    res = fakeRes();
    await h.supportSummary(fakeReq({ user: { id: OTHER, email: 'super@weotzi.com' } }), res);
    assert.equal(res.statusCode, 200);
    res = fakeRes();
    await h.supportExport(fakeReq({ user: person }), res);
    assert.equal(res.statusCode, 403);
    res = fakeRes();
    await h.supportUpdate(fakeReq({ user: person, params: { id: ROW_ID }, body: { status: 'done' } }), res);
    assert.equal(res.statusCode, 403);
});

test('soporte: lista sin correos, detalle con correo y capturas firmadas, estado y nota', async () => {
    const row = {
        id: ROW_ID, user_id: UID, role: 'client', kind: 'bug', rating: 2, message: 'No puedo subir fotos.', page_path: '/client/dashboard',
        page_title: 'Mi panel', status: 'new', created_at: '2026-11-17T10:00:00Z', context: { lang: 'es', viewport: { w: 390, h: 844 }, ua: 'UA' },
        attachments: [shot(), { path: `${OTHER}/feedback/1-a-x.png`, name: 'ajena.png' }]
    };
    const repo = memoryRepo({ rows: [row] });
    const h = handlersWith(repo);
    const agent = { user: { id: AGENT, email: 'agente@weotzi.com' } };

    let res = fakeRes();
    await h.supportList(fakeReq({ ...agent, query: { role: 'client' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].user.name, 'Ana');
    assert.equal(res.body.items[0].attachments_count, 2);
    assert.doesNotMatch(JSON.stringify(res.body), /@|feedback\/1731840000000/, 'sin correos ni rutas de Storage en la lista');

    res = fakeRes();
    await h.supportList(fakeReq({ ...agent, query: { status: 'cualquiera' } }), res);
    assert.equal(res.statusCode, 400);

    res = fakeRes();
    await h.supportDetail(fakeReq({ ...agent, params: { id: ROW_ID } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.user.email, 'ana@example.com');
    assert.equal(res.body.item.attachments.length, 1, 'la captura fuera de la carpeta no se firma');
    assert.match(res.body.item.attachments[0].url, /^https:\/\/storage\.example\/firmada\//);
    assert.deepEqual(repo.signed, [shot().path]);
    assert.equal(res.body.item.context.lang, 'es');
    assert.doesNotMatch(JSON.stringify(res.body.item.attachments), /"path"/);

    res = fakeRes();
    await h.supportDetail(fakeReq({ ...agent, params: { id: 'no-es-uuid' } }), res);
    assert.equal(res.statusCode, 400);

    res = fakeRes();
    await h.supportUpdate(fakeReq({ ...agent, params: { id: ROW_ID }, body: { status: 'in_progress', support_note: 'Lo revisa producto.' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, 'in_progress');
    assert.deepEqual(repo.updates[0].patch, { status: 'in_progress', support_note: 'Lo revisa producto.', handled_by: AGENT });

    res = fakeRes();
    await h.supportUpdate(fakeReq({ ...agent, params: { id: ROW_ID }, body: { status: 'cerrado' } }), res);
    assert.equal(res.statusCode, 400);

    res = fakeRes();
    await h.supportSummary(fakeReq(agent), res);
    assert.equal(res.body.summary.by_status.in_progress, 1);

    res = fakeRes();
    await h.supportExport(fakeReq({ ...agent, query: { kind: 'bug' } }), res);
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.match(res.headers['content-disposition'], /attachment; filename="feedback-beta-2026-11-17\.csv"/);
    assert.match(res.body, /No puedo subir fotos\./);
    assert.doesNotMatch(res.body, /@/);
});

test('register: una línea en server.js y las rutas fijas antes de /:id', () => {
    const routes = [];
    const app = { get: (p) => routes.push('GET ' + p), post: (p) => routes.push('POST ' + p) };
    register(app, { repo: memoryRepo(), limiter: false });
    assert.deepEqual(routes, [
        'POST /api/feedback',
        'GET /api/feedback/surveys',
        'POST /api/feedback/surveys/:key/dismiss',
        'GET /api/support/feedback',
        'GET /api/support/feedback/summary',
        'GET /api/support/feedback/export.csv',
        'GET /api/support/feedback/:id',
        'POST /api/support/feedback/:id'
    ]);
    const server = read('server.js');
    assert.equal((server.match(/require\('\.\/lib\/routes\/feedback'\)\.register\(app\);/g) || []).length, 1);
    // Datos por la capa PostgREST, sin fetch a /rest/v1 en las rutas.
    assert.doesNotMatch(read('lib/routes/feedback.js'), /\/rest\/v1|fetch\(/);
    assert.match(read('lib/repos/feedback.js'), /require\('\.\.\/postgrest'\)/);
    assert.match(read('lib/repos/feedback.js'), /require\('\.\.\/storage-sign'\)/);
});

// ---------------------------------------------------------------- migración

test('migración: tabla con RLS, checks, único parcial, índices y sin depender de support_tickets', () => {
    const sql = read('supabase/migrations/20261117120000_beta_feedback.sql');
    const code = sql.replace(/--[^\n]*/g, '');
    assert.match(code, /^\s*begin;/m);
    assert.match(code, /^\s*commit;\s*$/m);
    assert.match(code, /create table if not exists public\.beta_feedback/);
    assert.match(code, /user_id uuid not null references auth\.users \(id\)/);
    assert.match(code, /check \(role in \('artist', 'client', 'studio'\)\)/);
    assert.match(code, /check \(kind in \('bug', 'idea', 'comment', 'survey'\)\)/);
    assert.match(code, /check \(status in \('new', 'seen', 'in_progress', 'done', 'wontfix'\)\)/);
    assert.match(code, /status text not null default 'new'/);
    assert.match(code, /rating is null or rating between 1 and 5/);
    assert.match(code, /char_length\(message\) between 1 and 2000/);
    assert.match(code, /char_length\(btrim\(message\)\) >= 10/);
    assert.match(code, /jsonb_array_length\(attachments\) <= 2/);
    assert.match(code, /create unique index if not exists beta_feedback_user_survey_uniq\s+on public\.beta_feedback \(user_id, survey_key\)\s+where kind = 'survey'/);
    for (const idx of ['created_at', 'status', 'role']) assert.match(code, new RegExp(`create index if not exists beta_feedback_${idx}_idx`));
    assert.match(code, /alter table public\.beta_feedback enable row level security;/);
    assert.match(code, /revoke all on table public\.beta_feedback from anon;/);
    assert.match(code, /for select\s+to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
    assert.match(code, /for insert\s+to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\)\)/);
    assert.doesNotMatch(code, /for (update|delete|all)\b/, 'sin update ni delete para la persona');
    assert.doesNotMatch(code, /grant (update|delete)[^;]*to authenticated/);
    assert.doesNotMatch(code, /to anon/);
    // La nota interna no se le muestra a la persona.
    const selectGrant = /grant select \(([^)]*)\)\s+on table public\.beta_feedback to authenticated/.exec(code);
    assert.ok(selectGrant);
    assert.doesNotMatch(selectGrant[1], /support_note|handled_by|status/);
    assert.doesNotMatch(code, /support_tickets/);
    assert.match(code, /drop policy if exists beta_feedback_select_own/);
    assert.match(code, /drop trigger if exists beta_feedback_touch_updated_at/);
});

test('reversa: borra la tabla y la función, envuelta en transacción', () => {
    const down = read('supabase/rollbacks/20261117120000_beta_feedback.down.sql').replace(/--[^\n]*/g, '');
    assert.match(down, /begin;/);
    assert.match(down, /drop table if exists public\.beta_feedback cascade;/);
    assert.match(down, /drop function if exists public\.beta_feedback_touch_updated_at\(\);/);
    assert.match(down, /commit;/);
});

// ---------------------------------------------------------------- cargador del botón

const LOADER_MARK = '// Feedback de la beta: botón "Comentarios"';

function runLoader({ pathname, src = 'https://beta.weotzi.com/shared/js/config-manager.js', storage = {}, off = false, preview = false, preset } = {}) {
    const cm = read('public/shared/js/config-manager.js');
    const start = cm.indexOf(LOADER_MARK);
    assert.ok(start > 0, 'config-manager.js tiene el cargador');
    const end = cm.indexOf('// DS · Controles propios', start);
    assert.ok(end > start, 'el cargador va ANTES del bloque de controles del DS');
    const block = cm.slice(start, end);
    const appended = [];
    const keys = Object.keys(storage);
    const window = {
        location: { pathname },
        WEOTZI_PREVIEW: preview || undefined,
        localStorage: { get length() { return keys.length; }, key: (i) => keys[i], getItem: (k) => (k in storage ? storage[k] : null) },
        ...(preset ? { WoFeedback: preset } : {})
    };
    const document = {
        currentScript: { src },
        head: { appendChild: (n) => appended.push(n) },
        documentElement: { getAttribute: (name) => (name === 'data-wo-feedback' && off ? 'off' : null) },
        createElement: (tag) => ({ tag, setAttribute() {} })
    };
    vm.runInNewContext(block, { window, document });
    return { window, appended };
}

const SESSION = { 'sb-flbgmlvfiejfttlawnfu-auth-token': '{"access_token":"x","user":{"id":"u"}}' };

test('cargador: sin sesión no descarga nada (páginas públicas), con sesión carga una vez', () => {
    const anon = runLoader({ pathname: '/explore' });
    assert.equal(anon.appended.length, 0);
    assert.equal(typeof anon.window.WoFeedback.survey, 'function', 'stub para las encuestas');
    // Una encuesta pedida sin el módulo queda en cola y lo pide.
    anon.window.WoFeedback.survey('registro_cliente', { delay: 10 });
    assert.equal(anon.appended.length, 1);
    assert.equal(anon.window.WoFeedback.__queue.length, 1);
    anon.window.WoFeedback.survey('registro_cliente');
    assert.equal(anon.appended.length, 1, 'no duplica el script');

    const withSession = runLoader({ pathname: '/artist/dashboard', storage: SESSION });
    assert.deepEqual(withSession.appended.map((n) => n.src), ['https://beta.weotzi.com/shared/js/wo-feedback.js']);
    assert.equal(withSession.appended[0].defer, true);
    assert.equal(withSession.window.__woFeedbackLoader, true);

    // Token vacío o clave ajena: no es sesión.
    assert.equal(runLoader({ pathname: '/client/dashboard', storage: { 'sb-x-auth-token': 'null', 'otra': 'access_token' } }).appended.length, 0);
    // Encuesta pendiente de la página anterior (registro → panel): carga.
    assert.equal(runLoader({ pathname: '/artist/dashboard', storage: { wo_fb_pending: '[{"key":"registro_tatuador"}]' } }).appended.length, 1);
    // Preview local: sesión ficticia.
    assert.equal(runLoader({ pathname: '/preview/preview-local-safe/artist/dashboard/', src: 'http://localhost:4647/preview/preview-local-safe/shared/js/config-manager.js', preview: true }).appended.length, 1);
});

test('cargador: nunca en /support ni /backoffice (con o sin prefijo de despliegue)', () => {
    for (const [pathname, src] of [
        ['/support/dashboard', undefined],
        ['/support/login/', undefined],
        ['/backoffice', undefined],
        ['/beta/support/dashboard', 'https://beta.weotzi.com/beta/shared/js/config-manager.js'],
        ['/preview/preview-local-safe/backoffice/', 'http://localhost:4647/preview/preview-local-safe/shared/js/config-manager.js']
    ]) {
        const r = runLoader({ pathname, src, storage: SESSION, preview: true });
        assert.equal(r.appended.length, 0, pathname);
        assert.equal(r.window.WoFeedback, undefined, pathname + ' sin stub');
        assert.equal(r.window.__woFeedbackLoader, undefined, pathname);
    }
    // /supportes no es /support.
    assert.equal(runLoader({ pathname: '/supported', storage: SESSION }).appended.length, 1);
});

test('cargador: respeta <html data-wo-feedback="off"> y un stub previo', () => {
    const off = runLoader({ pathname: '/client/dashboard', storage: SESSION, off: true });
    assert.equal(off.appended.length, 0, 'sin botón');
    assert.equal(typeof off.window.WoFeedback.survey, 'function', 'las encuestas siguen pudiendo cargarlo');
    const preset = { real: true };
    const r = runLoader({ pathname: '/client/dashboard', storage: SESSION, preset });
    assert.equal(r.window.WoFeedback, preset, 'no pisa un WoFeedback que ya existe');
});

test('cargador: wo-feedback.js tampoco monta el botón en soporte ni con off', () => {
    assert.equal(WF.buttonAllowed('/artist/dashboard', null), true);
    assert.equal(WF.buttonAllowed('/support/dashboard', null), false);
    assert.equal(WF.buttonAllowed('/Backoffice/', null), false);
    assert.equal(WF.buttonAllowed('/client/dashboard', 'off'), false);
    assert.equal(WF.appPath('/beta/client/dashboard', '/beta'), '/client/dashboard');
    assert.equal(WF.appPath('/preview/preview-local-safe/artist/', '/preview/preview-local-safe'), '/artist/');
});

// ---------------------------------------------------------------- módulo del navegador

test('wo-feedback.js: catálogo y límites iguales a los del servidor', () => {
    assert.deepEqual(WF.SURVEYS, F.SURVEYS);
    assert.deepEqual(WF.KINDS, F.KINDS);
    assert.deepEqual(WF.ROLES, F.ROLES);
    assert.equal(WF.MESSAGE_MIN, F.MESSAGE_MIN);
    assert.equal(WF.MESSAGE_MAX, F.MESSAGE_MAX);
    assert.equal(WF.MAX_IMAGES, F.MAX_ATTACHMENTS);
    assert.equal(WF.MAX_IMAGE_BYTES, F.MAX_ATTACHMENT_BYTES);
    assert.deepEqual(WF.IMAGE_TYPES, F.IMAGE_TYPES);
    assert.equal(WF.BUCKET, F.ATTACHMENTS_BUCKET);
    assert.equal(WF.FOLDER, F.ATTACHMENTS_FOLDER);
});

test('wo-feedback.js: capturas con el mismo patrón que wo-report.js y aceptadas por el servidor', () => {
    for (const name of ['Captura de pantalla 2026-11-17 a la(s) 10.png', 'ñandú..png', '../../etc/passwd', '']) {
        const a = WF.safeName(name);
        const b = WR.safeName(name);
        assert.equal(a.replace(/^captura$/, 'imagen'), b, name);
    }
    const p = WF.storagePath(UID, 'Mi captura.png', 1731840000000, 'abc123');
    assert.equal(p, `${UID}/feedback/1731840000000-abc123-Mi-captura.png`);
    assert.equal(F.parseAttachments([{ path: p, name: 'Mi captura.png', size: 10, type: 'image/png' }], UID).ok, true);
    assert.equal(WF.validateFile({ name: 'x.pdf', type: 'application/pdf', size: 1 }), WF.MSG.fileType);
    assert.equal(WF.validateFile({ name: 'x.heic', type: '', size: 1 }), null);
    assert.equal(WF.validateFile({ name: 'x.png', type: 'image/png', size: 11 * 1024 * 1024 }), WF.MSG.fileSize);
});

test('wo-feedback.js: validación del borrador, modo activo y contexto mínimo', () => {
    assert.equal(WF.validateDraft({ kind: 'bug', message: 'corto', files: [] }).field, 'message');
    assert.equal(WF.validateDraft({ kind: 'nada', message: 'x'.repeat(20), files: [] }).field, 'kind');
    assert.equal(WF.validateDraft({ kind: 'idea', message: 'x'.repeat(20), files: [{}, {}, {}] }).field, 'attachments');
    assert.equal(WF.validateDraft({ kind: 'idea', message: 'x'.repeat(20), files: [], rating: 3 }), null);
    assert.equal(WF.modeFromPath('/studio/dashboard', 'artist'), 'studio');
    assert.equal(WF.modeFromPath('/client/requests', ''), 'client');
    assert.equal(WF.modeFromPath('/my-quotations/new', ''), 'artist');
    assert.equal(WF.modeFromPath('/explore', 'client'), 'client');
    assert.equal(WF.modeFromPath('/explore', 'admin'), '');
    const ctx = WF.pageContext({
        location: { pathname: '/beta/client/dashboard', search: '?token=x', hash: '#a' },
        document: { title: 'Panel', documentElement: { lang: 'es' } },
        navigator: { userAgent: 'UA', language: 'es-AR' },
        innerWidth: 390.4, innerHeight: 844
    }, '/beta');
    assert.deepEqual(ctx, { page_path: '/client/dashboard', page_title: 'Panel', context: { lang: 'es', viewport: { w: 390, h: 844 }, ua: 'UA' } });
});

test('wo-feedback.js: encuestas pendientes sin duplicar y con vencimiento', () => {
    let list = WF.addPending([], 'registro_tatuador', '', NOW);
    list = WF.addPending(list, 'registro_tatuador', 'otra', NOW + 1);
    assert.equal(list.length, 1);
    list = WF.addPending(list, 'cotizacion_enviada', '', NOW);
    assert.equal(list.length, 2);
    assert.equal(WF.prunePending(list, NOW + WF.PENDING_TTL_MS + 1).length, 0);
    assert.equal(WF.prunePending([{ key: 'inventada', at: NOW }], NOW).length, 0);
    assert.equal(WF.questionFor('registro_estudio', ''), F.SURVEYS.registro_estudio);
    assert.equal(WF.questionFor('registro_estudio', '¿Qué tal?'), '¿Qué tal?');
});

test('wo-feedback.js: modal y tarjeta accesibles, con todo escapado', () => {
    const form = WF.formHtml({ kind: 'bug', rating: 3, message: '<img src=x onerror=alert(1)>', files: [] });
    assert.doesNotMatch(form, /<img src=x/);
    assert.match(form, /<legend class="wofb-label">¿Qué nos quieres contar\?<\/legend>/);
    assert.match(form, /<label class="wofb-label" for="wofb-message">/);
    assert.match(form, /value="bug" checked/);
    assert.match(form, /value="3" id="wofb-ease-3" checked/);
    assert.match(form, /aria-label="1, muy difícil"/);
    assert.match(form, /maxlength="2000"/);
    const card = WF.surveyHtml({ question: '¿Cómo fue <b>?', rating: null });
    assert.match(card, /&lt;b&gt;/);
    assert.match(card, /Ahora no/);
    assert.match(card, /type="submit" class="wofb-btn wofb-btn--s" disabled/, 'Enviar espera la calificación');
    assert.match(card, /class="wofb-field wofb-sv-comment" hidden/);
    assert.match(WF.surveyHtml({ question: 'x', rating: 4 }), /value="4" id="wofb-sv-rate-4" checked/);
    const src = read('public/shared/js/wo-feedback.js');
    assert.match(src, /showModal\(\)/, 'modal nativo');
    assert.match(src, /e\.key === 'Escape'/);
    assert.match(src, /e\.key !== 'Tab'/, 'foco atrapado');
    assert.match(src, /'\/api\/feedback\/surveys\/' \+ encodeURIComponent\(s\.key\) \+ '\/dismiss'/);
    assert.doesNotMatch(src, /\/rest\/v1|\.from\('beta_feedback'\)/, 'sin CRUD directo a la tabla');
    const css = read('public/shared/css/wo-feedback.css');
    assert.match(css, /\.wofb-fab\{position:fixed;left:var\(--wofb-gap\)/, 'esquina izquierda: el chat de soporte está a la derecha');
    assert.match(css, /--wofb-lift/);
    assert.match(css, /@media \(max-width:600px\)\{[\s\S]*?\.wofb-fab\{width:40px;height:40px/, 'compacto en celular');
});

// ---------------------------------------------------------------- puntos de éxito

test('cada punto de éxito pide su encuesta de forma defensiva', () => {
    const points = [
        ['public/shared/js/register.js', 'registro_tatuador', 3],
        ['public/client/register/index.html', 'registro_cliente', 1],
        ['public/shared/js/studio-register.js', 'registro_estudio', 1],
        ['public/shared/js/script.js', 'cotizacion_enviada', 1],
        ['public/shared/js/quote-respond-dialog.js', 'propuesta_enviada', 1],
        ['public/shared/js/quotation-detail-figma.js', 'propuesta_enviada', 1],
        ['public/shared/js/quotation-detail-figma.js', 'primera_sesion_agendada', 2],
        ['public/shared/js/calendar.js', 'primera_sesion_agendada', 1],
        ['public/shared/js/studio-dashboard-team.js', 'primer_tatuador_equipo', 1]
    ];
    const used = new Set();
    for (const [file, key, count] of points) {
        const src = read(file);
        const re = new RegExp(`window\\.WoFeedback && typeof window\\.WoFeedback\\.survey === 'function'\\) window\\.WoFeedback\\.survey\\('${key}', \\{ delay: \\d{3,4} \\}\\)`, 'g');
        assert.equal((src.match(re) || []).length, count, `${file} → ${key}`);
        used.add(key);
    }
    assert.deepEqual([...used].sort(), Object.keys(F.SURVEYS).sort(), 'todas las claves del catálogo tienen su punto de éxito');

    // Contexto de cada llamada: después del éxito real.
    const reg = read('public/shared/js/register.js');
    for (const m of reg.matchAll(/goToStep\('success'\);\n\s*\/\/ Feedback de la beta/g)) assert.ok(m.index > 0);
    assert.equal((reg.match(/goToStep\('success'\);\n\s*\/\/ Feedback de la beta/g) || []).length, 3);
    assert.match(read('public/client/register/index.html'), /function showSuccess\(\) \{[\s\S]*?survey\('registro_cliente'/);
    assert.match(read('public/shared/js/studio-register.js'), /if \(!pending && window\.WoFeedback/);
    assert.match(read('public/shared/js/script.js'), /renderSubmittedSuccess\(\{ warnings \}\);\n\s*\/\/ Feedback[^\n]*\n\s*if \(_authenticatedUserId && window\.WoFeedback/);
    assert.match(read('public/shared/js/quote-respond-dialog.js'), /Propuesta enviada al cliente\.'\);\n\s*\}\n\s*\}\n\s*\/\/ Feedback[^\n]*\n\s*if \(window\.WoFeedback[^\n]*propuesta_enviada/);
    const team = read('public/shared/js/studio-dashboard-team.js');
    assert.match(team, /if \(decision === 'accept'\) askFirstArtistSurvey\(\);/);
    assert.match(team, /if \(previous === '0' && active > 0\) askFirstArtistSurvey\(\);/);
});

// ---------------------------------------------------------------- soporte

test('soporte: pestaña Feedback con repo, data-tab, #feedback y estilos', () => {
    const html = read('public/support/dashboard/index.html');
    assert.equal((html.match(/data-tab="feedback"/g) || []).length, 2, 'menú lateral y pestañas');
    assert.match(html, /<script src="\/shared\/js\/data\/support-feedback-repo\.js\?v=[^"]+"><\/script>\s*<script src="\/shared\/js\/support-dashboard-feedback\.js\?v=[^"]+"><\/script>/);
    assert.match(html, /support-dashboard-feedback\.css/);
    const repo = read('public/shared/js/data/support-feedback-repo.js');
    assert.match(repo, /D\.SupportFeedback = \{/);
    assert.match(repo, /\/api\/support\/feedback\/export\.csv/);
    const mod = read('public/shared/js/support-dashboard-feedback.js');
    assert.match(mod, /const TAB = 'feedback';/);
    assert.match(mod, /'#' \+ TAB/);
    assert.deepEqual(Object.keys(SD.SURVEY_LABELS).sort(), Object.keys(F.SURVEYS).sort());
    assert.deepEqual(SD.STATUSES, F.STATUSES);
});

test('soporte: filtros, paginado, resumen y detalle escapados', () => {
    assert.deepEqual(SD.cleanFilters({ role: 'artist', kind: 'x', status: 'done', survey_key: 'registro_cliente', q: '  foto ', from: '2026-11-01', to: 'mañana', page: '3' }),
        { role: 'artist', status: 'done', survey_key: 'registro_cliente', q: 'foto', from: '2026-11-01', page: 3, page_size: SD.PAGE_SIZE });
    assert.deepEqual(SD.pageInfo(51, 3, 25), { total: 51, pages: 3, page: 3, hasPrev: true, hasNext: false });
    assert.deepEqual(SD.pageInfo(0, 5, 25), { total: 0, pages: 1, page: 1, hasPrev: false, hasNext: false });
    const summary = SD.summaryHtml(F.buildSummary([{ role: 'client', kind: 'survey', survey_key: 'registro_cliente', rating: 5, status: 'new' }]));
    assert.match(summary, /Registro de cliente/);
    assert.match(summary, /<td>5<\/td>/);
    const row = SD.rowHtml({ id: ROW_ID, kind: 'bug', status: 'new', message: '<script>alert(1)</script>', user: { name: '<b>Ana</b>' }, role: 'client' });
    assert.doesNotMatch(row, /<script>|<b>Ana/);
    const detail = SD.detailHtml({ id: ROW_ID, kind: 'bug', status: 'seen', message: 'x', user: { name: 'Ana', email: 'ana@example.com' }, attachments: [{ name: 'a.png', url: 'javascript:alert(1)' }, { name: 'b.png', url: 'https://s.example/b.png' }] });
    assert.doesNotMatch(detail, /javascript:/);
    assert.match(detail, /a\.png · no disponible/);
    assert.match(detail, /mailto:ana@example\.com/);
    assert.match(detail, /value="seen" selected/);
    assert.equal(SD.buildUpdate('done', 'x'.repeat(4001)).error, SD.MSG.noteLong);
    assert.deepEqual(SD.buildUpdate('done', ' ok ').payload, { status: 'done', support_note: 'ok' });
});

test('docs: guía corta del feedback y endpoints en TECHNICAL.md', () => {
    const doc = read('docs/FEEDBACK_BETA.md');
    for (const key of Object.keys(F.SURVEYS)) assert.ok(doc.includes(key), key);
    assert.match(doc, /POST \/api\/feedback/);
    assert.match(doc, /\/support\/dashboard#feedback/);
    assert.match(read('docs/TECHNICAL.md'), /FEEDBACK_BETA\.md/);
});
