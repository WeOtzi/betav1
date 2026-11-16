'use strict';
// Frente cot-form · servidor del cotizador web: intake, referencias en
// Storage, destino obligatorio, Job Board, config pública sin secretos y
// rate limit propio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://demo.supabase.test';
const SUPA = process.env.SUPABASE_URL;

const intake = require('../services/quotation-intake');
const cotForm = require('../lib/cot-form');
const routes = require('../lib/routes/cot-form');

const KEY = '315fdf41-68c3-451c-8dc2-931c3cc035da';
const QID = intake.deriveQuoteId(KEY);
const ARTIST = { user_id: 'a1', username: 'real.wo', name: 'Real', email: 'artist@example.test', registration_status: 'pendiente de validacion' };
const base = (extra = {}) => ({
    submission_key: KEY, mode: 'submit',
    quotation: { client_full_name: 'QA', client_email: 'qa@example.test', tattoo_idea_description: 'Idea', tattoo_style: { style_name: 'Fine Line' }, tattoo_body_part: 'Brazo', tattoo_size: 'Mediano', ...extra }
});

// ---------------------------------------------------------------------------
// normalizeIntake
// ---------------------------------------------------------------------------
test('envío sin artista: 409 needs_destination (nunca queda una cotización huérfana)', () => {
    assert.throws(() => intake.normalizeIntake(base(), null, null), (e) => e.status === 409 && e.extra.needs_destination === true);
    // El borrador sin artista sí se guarda.
    const { q } = intake.normalizeIntake({ ...base(), mode: 'draft' }, null, null);
    assert.equal(q.quote_status, 'in_progress');
    assert.equal(q.artist_id, null);
});

test('pre-cotizador no viola quotations_db_source_check: web_chat + quotation_medium prequote', () => {
    const { q } = intake.normalizeIntake(base({ source: 'prequote' }), null, ARTIST);
    assert.equal(q.source, 'web_chat');
    assert.equal(q.quotation_medium, 'prequote');
    const plain = intake.normalizeIntake(base(), null, ARTIST).q;
    assert.equal(plain.source, 'web_chat');
    assert.equal(plain.quotation_medium, 'web');
});

test('artista sugerido: source recommendation solo si hay artista real', () => {
    assert.equal(intake.normalizeIntake(base({ source: 'recommendation' }), null, ARTIST).q.source, 'recommendation');
    assert.equal(intake.normalizeIntake({ ...base({ source: 'recommendation' }), mode: 'draft' }, null, null).q.source, 'web_chat');
});

test('referencias: solo paths del folder del propio borrador, máximo 4', () => {
    const good = [`${QID}/ref_1_1731600000000.jpg`, { path: `${QID}/ref_2_1731600000001.png` }];
    const { references } = intake.normalizeIntake({ ...base(), references: good }, null, ARTIST);
    assert.deepEqual(references.map((r) => r.mime_type), ['image/jpeg', 'image/png']);
    const other = 'QN' + 'f'.repeat(32);
    assert.throws(() => intake.normalizeIntake({ ...base(), references: [`${other}/ref_1_1731600000000.jpg`] }, null, ARTIST), /no pertenece/);
    assert.throws(() => intake.normalizeIntake({ ...base(), references: [`${QID}/../x.jpg`] }, null, ARTIST), /no pertenece/);
    assert.throws(() => intake.normalizeIntake({ ...base(), references: [`${QID}/ref_1_1731600000000.svg`] }, null, ARTIST));
    const five = [1, 2, 3, 4, 5].map((i) => `${QID}/ref_${i}_173160000000${i}.jpg`);
    assert.throws(() => intake.normalizeIntake({ ...base(), references: five }, null, ARTIST), /hasta 4/);
    // En borrador no se procesan referencias.
    assert.deepEqual(intake.normalizeIntake({ ...base(), mode: 'draft', references: five }, null, ARTIST).references, []);
});

test('edad calculada en el servidor a partir de la fecha de nacimiento', () => {
    const { q } = intake.normalizeIntake(base({ client_birth_date: '2000-01-01', client_age: '99' }), null, ARTIST);
    assert.ok(Number(q.client_age) >= 25 && Number(q.client_age) < 100);
    assert.equal(intake.normalizeIntake(base({ client_birth_date: 'ayer' }), null, ARTIST).q.client_birth_date, null);
    assert.equal(cotForm.ageFromBirthDate('2010-06-15', new Date('2026-06-14T00:00:00Z')), 15);
    assert.equal(cotForm.ageFromBirthDate('2010-06-15', new Date('2026-06-15T00:00:00Z')), 16);
    assert.equal(cotForm.ageFromBirthDate('2999-01-01'), null);
});

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------
test('URLs públicas de referencias y validación para el espejo a Drive', () => {
    const p = `${QID}/ref_1_1731600000000.jpg`;
    const url = cotForm.referencePublicUrl(SUPA, p);
    assert.equal(url, `${SUPA}/storage/v1/object/public/quotation-references/${p}`);
    assert.equal(cotForm.isOwnReferenceUrl(url, SUPA, QID), true);
    assert.equal(cotForm.isOwnReferenceUrl('http://169.254.169.254/latest', SUPA, QID), false);
    assert.equal(cotForm.isOwnReferenceUrl(url, SUPA, 'QN' + '0'.repeat(32)), false);
    const rows = cotForm.attachmentRows(QID, [{ path: p, file_name: 'ref_1_1731600000000.jpg', mime_type: 'image/jpeg' }], SUPA);
    // Ronda 2: cada fila lleva la nota de su imagen y la marca de IA.
    assert.deepEqual(rows[0], { quotation_id: QID, google_drive_url: url, file_name: 'ref_1_1731600000000.jpg', mime_type: 'image/jpeg', attachment_type: 'reference', status: 'confirmed', sort_order: 1, note: null, ai_generated: false });
});

test('cotización → job_board_requests: estilos como array, rango del tramo y ciudad/país', () => {
    const q = { tattoo_idea_description: 'Una golondrina', tattoo_style: { style_name: 'Tradicional', styles: [{ style_name: 'Tradicional' }, { style_name: 'Neo-Tradicional' }] },
        tattoo_body_part: 'Brazo', tattoo_size: 'Mediano', tattoo_color_type: 'Color', tattoo_is_first_tattoo: true,
        client_city_residence: 'Rosario, Santa Fe, Argentina', client_budget_amount: '300', client_budget_currency: 'USD',
        client_travel_willing: 'true', client_preferred_date: 'Este mes', client_flexible_dates: false };
    const row = cotForm.buildJobBoardRequest(q, { personalization_level: 'propuesta' }, 'user-1');
    assert.equal(row.client_user_id, 'user-1');
    assert.deepEqual(row.tattoo_style, ['Tradicional', 'Neo-Tradicional']);
    assert.equal(row.client_city, 'Rosario');
    assert.equal(row.client_country, 'Argentina');
    assert.equal(row.client_budget_min, 200);
    assert.equal(row.client_budget_max, 400);
    assert.equal(row.client_travel_willing, true);
    assert.match(row.tattoo_idea_description, /proponga algo/);
    assert.equal(row.status, 'open');
    assert.ok(!('is_featured' in row) && !('display_code' in row), 'no toca campos curados');
    assert.deepEqual(cotForm.budgetRange(600), { min: 600, max: null });
    assert.deepEqual(cotForm.budgetRange(1234), { min: null, max: 1234 });
});

test('config pública: nunca expone service account, keys de la IA de imágenes, PRESET_PASSWORD ni webhook de referencias', () => {
    const config = {
        supabase: { url: 'u', anonKey: 'anon' },
        googleDrive: { mainFolderId: 'f', serviceAccountJson: '{"private_key":"x"}' },
        gemini: { apiKey: 'AIza-secret', model: 'm' },
        registration: { presetPassword: 'hunter2' },
        n8n: { webhookUrl: 'https://n8n/secret', driveFolderId: 'abc', events: [{ id: 'e' }] }
    };
    const out = cotForm.sanitizePublicConfig(config, { OPENAI_API_KEY: 'sk-openai-secret', GEMINI_API_KEY: 'AIza-env-secret', GOOGLE_DRIVE_FOLDER_ID: 'f', GOOGLE_DRIVE_SERVICE_ACCOUNT: '{}' });
    const json = JSON.stringify(out);
    assert.doesNotMatch(json, /AIza-secret|AIza-env-secret|sk-openai-secret|hunter2|private_key|n8n\/secret|serviceAccountJson|presetPassword|"apiKey"/);
    assert.equal(out.gemini.enabled, true);
    assert.deepEqual(out.aiImages, { enabled: true, provider: 'openai' });
    assert.equal(out.googleDrive.enabled, true);
    assert.deepEqual(out.n8n.events, [{ id: 'e' }]);
    assert.equal(out.supabase.anonKey, 'anon');
    assert.equal(config.gemini.apiKey, 'AIza-secret', 'no muta el original');
});

test('config pública: gemini.enabled y aiImages reflejan la IA de imágenes configurada en el servidor', () => {
    const flags = (env, config = {}) => {
        const out = cotForm.sanitizePublicConfig(config, env);
        return { gemini: out.gemini.enabled, ai: out.aiImages };
    };
    // gemini.enabled conserva el nombre que lee el frontend: vale lo mismo que aiImages.enabled.
    assert.deepEqual(flags({ OPENAI_API_KEY: 'k' }), { gemini: true, ai: { enabled: true, provider: 'openai' } });
    assert.deepEqual(flags({ GEMINI_API_KEY: 'g' }), { gemini: true, ai: { enabled: true, provider: 'gemini' } }, 'Gemini queda como proveedor heredado');
    assert.deepEqual(flags({ OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'gemini' }), { gemini: true, ai: { enabled: true, provider: 'gemini' } });
    assert.deepEqual(flags({}), { gemini: false, ai: { enabled: false, provider: 'openai' } });
    assert.deepEqual(flags({ OPENAI_API_KEY: 'k', AI_IMAGE_PROVIDER: 'off' }), { gemini: false, ai: { enabled: false, provider: 'none' } });
    // Un "enabled" guardado en el archivo no enciende el botón si el servidor no tiene clave.
    assert.deepEqual(flags({}, { gemini: { enabled: true, apiKey: 'AIza-x' }, aiImages: { enabled: true, provider: 'x', apiKey: 'sk-x' } }),
        { gemini: false, ai: { enabled: false, provider: 'openai' } });
    const kept = cotForm.sanitizePublicConfig({ gemini: { defaultStyle: 'Line art' } }, { OPENAI_API_KEY: 'k' });
    assert.equal(kept.gemini.defaultStyle, 'Line art', 'el resto de la configuración de estilo se conserva');
});

test('server.js sirve app-config saneado y ya no copia secretos del .env', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const route = server.slice(server.indexOf("app.get('/shared/js/app-config.json'"), server.indexOf('JOB BOARD - ACCEPT APPLICATION ENDPOINT'));
    assert.match(route, /sanitizePublicConfig\(config, process\.env\)/);
    assert.doesNotMatch(route, /config\.gemini\.apiKey\s*=/);
    assert.doesNotMatch(route, /serviceAccountJson\s*=/);
    assert.doesNotMatch(route, /presetPassword\s*=/);
    assert.doesNotMatch(route, /config\.n8n\.webhookUrl\s*=/);
    const staticConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'shared', 'js', 'app-config.json'), 'utf8'));
    assert.equal(staticConfig.n8n.webhookUrl, undefined);
    assert.equal(staticConfig.n8n.driveFolderId, undefined);
});

test('Drive: el endpoint ya no acepta credenciales del navegador y exige admin', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = server.indexOf("app.post('/api/google-drive/create-quote-folder'");
    const handler = server.slice(start, server.indexOf('});', start));
    assert.match(handler, /verifyAdminCaller\(req\)/);
    assert.doesNotMatch(handler, /credentials/);
    assert.doesNotMatch(server, /\[DEBUG\] ====== CREATE QUOTE FOLDER/);
    const mirror = server.slice(server.indexOf('async function mirrorQuoteFilesToDrive'), start);
    assert.match(mirror, /process\.env\.GOOGLE_DRIVE_SERVICE_ACCOUNT/);
    assert.match(mirror, /isOwnReferenceUrl/);
});

test('server.js registra el módulo cot-form y el apiLimiter global lo saltea', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /require\('\.\/lib\/routes\/cot-form'\)\.register\(app, \{ driveMirror: mirrorQuoteFilesToDrive \}\)/);
    assert.match(server, /isOwnLimitedPath\(req\)/);
    assert.doesNotMatch(server, /app\.post\('\/api\/quotations\/intake', require/);
    // req con forma de Express montado en app.use('/api/'): baseUrl '/api', path sin query.
    for (const p of ['/quotations/intake', '/quotations/suggestions', '/quotations/intake/job-board', '/quotations/intake/', '/Quotations/Intake']) {
        assert.equal(routes.isOwnLimitedPath({ baseUrl: '/api', path: p }), true, p);
    }
    assert.equal(routes.isOwnLimitedPath({ baseUrl: '/api', path: '/quotations/intake-admin' }), false);
    assert.equal(routes.isOwnLimitedPath({ baseUrl: '/api', path: '/email/client_quotation_submitted' }), false);
    // Un query string con la ruta exceptuada no saltea el límite global (RUT-1).
    assert.equal(routes.isOwnLimitedPath({ baseUrl: '/api', path: '/gemini/generate-image', originalUrl: '/api/gemini/generate-image?x=/api/quotations/intake' }), false);
    assert.equal(routes.isOwnLimitedPath({ originalUrl: '/api/quotations/intake' }), false);
    assert.equal(routes.isOwnLimitedPath(undefined), false);
});

test('rate limit: por borrador (submission_key) y techo amplio por IP', () => {
    const made = [];
    const fake = { rateLimit: (opts) => { made.push(opts); return opts; }, ipKeyGenerator: (ip) => `ip(${ip})` };
    const limiters = routes.createLimiters(fake);
    assert.ok(limiters.intakeIp.max >= 1000, 'muchos testers detrás de la misma IP no se bloquean');
    assert.equal(limiters.intakeDraft.keyGenerator({ body: { submission_key: KEY.toUpperCase() }, ip: '1.1.1.1' }), `draft:${KEY}`);
    assert.equal(limiters.intakeDraft.keyGenerator({ body: { submission_key: 'x' }, ip: '1.1.1.1' }), 'ip:ip(1.1.1.1)');
    assert.equal(limiters.intakeIp.keyGenerator({ ip: '2.2.2.2' }), 'ip(2.2.2.2)');
    assert.match(limiters.intakeDraft.message.error, /Esperá un minuto/);
});

// ---------------------------------------------------------------------------
// Handlers con dependencias falsas
// ---------------------------------------------------------------------------
function fakeRes() {
    return {
        statusCode: 200, body: null, headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
    };
}

// pgrest falso: registra las operaciones y responde por tabla.
function fakePgrest(responses = {}) {
    const log = [];
    const builder = (table) => {
        const op = { table, filters: [] };
        const q = {
            select() { return q; }, eq(c, v) { op.filters.push([c, v]); return q; }, neq() { return q; }, limit() { return q; },
            single() { op.single = true; return q; }, is() { return q; },
            async execute() { log.push({ ...op, kind: 'select' }); const r = responses[table]; return typeof r === 'function' ? r(op) : r; },
            async insert(values) { log.push({ ...op, kind: 'insert', values }); return [{ id: 'jb-1', request_code: 'JB-12345', ...values }]; },
            async patch(values) { log.push({ ...op, kind: 'patch', values }); return []; },
            async delete() { log.push({ ...op, kind: 'delete' }); return []; }
        };
        return q;
    };
    builder.log = log;
    return builder;
}

test('sugerencias: 400 sin criterios y respuesta sin PII', async () => {
    const handler = routes.createSuggestionsHandler({
        loadArtists: async () => [{ user_id: 'a1', username: 'ana', name: 'Ana', styles_array: ['Fine Line'], city: 'Buenos Aires',
            email: 'secreto@example.test', latitude: -34.6, longitude: -58.4, registration_status: 'pendiente de validacion' }]
    });
    const empty = fakeRes();
    await handler({ body: {} }, empty);
    assert.equal(empty.statusCode, 400);
    const res = fakeRes();
    await handler({ body: { criteria: { styles: 'fine line', city_residence: 'Buenos Aires, Argentina' } } }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.suggestions[0].user_id, 'a1');
    assert.doesNotMatch(JSON.stringify(res.body), /secreto@|latitude|-34\.6/);
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('Job Board: sin sesión 401 needs_account; cuenta de artista 403', async () => {
    const noUser = routes.createJobBoardHandler({ resolveUser: async () => null, pgrest: fakePgrest() });
    const r1 = fakeRes();
    await noUser({ body: { submission_key: KEY } }, r1);
    assert.equal(r1.statusCode, 401);
    assert.equal(r1.body.needs_account, true);
    const artistUser = routes.createJobBoardHandler({ resolveUser: async () => ({ id: 'u-artist' }), pgrest: fakePgrest({ clients_db: null }) });
    const r2 = fakeRes();
    await artistUser({ body: { submission_key: KEY } }, r2);
    assert.equal(r2.statusCode, 403);
    assert.equal(r2.body.needs_account, true);
});

test('Job Board: crea la solicitud desde la cotización, adjunta referencias y deja rastro en el borrador', async () => {
    const db = fakePgrest({
        clients_db: { user_id: 'u1', email: 'qa@example.test', full_name: 'QA' },
        quotations_db: { id: 7, quote_status: 'in_progress', job_board_request_id: null }
    });
    const notified = [];
    const handler = routes.createJobBoardHandler({
        resolveUser: async () => ({ id: 'u1', email: 'qa@example.test' }),
        pgrest: db,
        saveQuotation: async (body, user, opts) => {
            assert.equal(opts.forceNoArtist, true);
            assert.equal(body.mode, 'draft');
            return intake.normalizeIntake({ ...body, quotation: { ...body.quotation, artist_id: null } }, user, null);
        },
        notifyJobBoard: async (req, request) => notified.push(request.id)
    });
    const res = fakeRes();
    await handler({ body: { ...base(), references: [`${QID}/ref_1_1731600000000.jpg`] } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.request_id, 'jb-1');
    assert.equal(res.body.url, '/client/requests?id=jb-1');
    const insertReq = db.log.find((o) => o.kind === 'insert' && o.table === 'job_board_requests');
    assert.equal(insertReq.values.client_user_id, 'u1');
    const insertAtt = db.log.find((o) => o.kind === 'insert' && o.table === 'job_board_attachments');
    assert.match(insertAtt.values[0].file_url, /quotation-references/);
    const patch = db.log.find((o) => o.kind === 'patch' && o.table === 'quotations_db');
    assert.equal(patch.values.job_board_request_id, 'jb-1');
    assert.equal(patch.values.source, 'job_board');
    assert.ok(patch.filters.some(([c, v]) => c === 'quote_status' && v === 'in_progress'));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(notified, ['jb-1']);
});

test('Job Board: reintento devuelve la misma solicitud sin crear otra', async () => {
    const db = fakePgrest({
        clients_db: { user_id: 'u1' },
        quotations_db: { id: 7, quote_status: 'in_progress', job_board_request_id: 'jb-9' },
        job_board_requests: { id: 'jb-9', request_code: 'JB-00009' }
    });
    const handler = routes.createJobBoardHandler({
        resolveUser: async () => ({ id: 'u1', email: 'qa@example.test' }), pgrest: db,
        saveQuotation: async (body, user) => intake.normalizeIntake({ ...body, quotation: { ...body.quotation, artist_id: null } }, user, null),
        notifyJobBoard: async () => { throw new Error('no debería avisar dos veces'); }
    });
    const res = fakeRes();
    await handler({ body: { ...base() } }, res);
    assert.equal(res.body.request_id, 'jb-9');
    assert.ok(!db.log.some((o) => o.kind === 'insert'));
});

test('después del envío: confirmación al cliente con la llave del quote y aviso al artista elegido (respetando preferencias)', async () => {
    const sent = [];
    const quote = { quote_id: QID, quote_status: 'pending', source: 'recommendation', client_email: 'qa@example.test', client_full_name: 'Quinn Alvarez',
        tattoo_idea_description: 'Golondrina', tattoo_style: { style_name: 'Tradicional' }, tattoo_body_part: 'Brazo', client_health_conditions: 'Ninguna' };
    const deps = {
        pgrest: fakePgrest({ quotations_db: quote }),
        emailService: { sendEmail: async (id, payload, opts) => { sent.push({ id, payload, opts }); return { ok: true }; } },
        emailContext: { applicationBase: () => 'https://beta.example.test', withLinks: (p) => ({ ...p, dashboard_url: 'x' }) },
        notificationPrefs: { shouldNotify: async () => true }
    };
    await routes.createAfterSubmit(deps)({ req: {}, quoteId: QID, artist: { ...ARTIST, user_id: 'a1' }, references: [] });
    const client = sent.find((s) => s.id === 'client_quotation_submitted');
    assert.equal(client.opts.idempotencyKey, QID, 'misma llave que /api/email/:eventId: no sale dos veces');
    assert.equal(client.payload.tattoo_style, 'Tradicional');
    assert.equal(client.payload.has_medical_conditions, false);
    const artistMail = sent.find((s) => s.id === 'quotation_artist_selected');
    assert.equal(artistMail.payload.artist_email, ARTIST.email);
    assert.equal(artistMail.payload.client_first_name, 'Quinn');
    assert.doesNotMatch(JSON.stringify(artistMail.payload), /qa@example\.test|Alvarez/, 'el aviso al artista no lleva PII del cliente');
    assert.equal(artistMail.payload.quotation_url, `https://beta.example.test/my-quotations/detail?quote=${QID}`);

    sent.length = 0;
    deps.notificationPrefs = { shouldNotify: async () => false };
    await routes.createAfterSubmit(deps)({ req: {}, quoteId: QID, artist: ARTIST, references: [] });
    assert.ok(!sent.some((s) => s.id === 'quotation_artist_selected'), 'si el artista apagó el aviso, no sale');

    sent.length = 0;
    deps.pgrest = fakePgrest({ quotations_db: { ...quote, source: 'web_chat' } });
    deps.notificationPrefs = { shouldNotify: async () => true };
    await routes.createAfterSubmit(deps)({ req: {}, quoteId: QID, artist: ARTIST, references: [] });
    assert.deepEqual(sent.map((s) => s.id), ['client_quotation_submitted'], 'deep link: el aviso al artista no es de este frente');
});

test('después del envío: copia a Drive opcional y guarda el link de la carpeta', async () => {
    const db = fakePgrest({ quotations_db: { quote_id: QID, quote_status: 'pending', source: 'web_chat', client_email: '' } });
    const calls = [];
    await routes.createAfterSubmit({
        pgrest: db,
        emailService: { sendEmail: async () => ({ ok: true }) },
        emailContext: { applicationBase: () => 'x', withLinks: (p) => p },
        notificationPrefs: { shouldNotify: async () => true },
        driveMirror: async (quoteId, files) => { calls.push({ quoteId, files }); return { success: true, quoteFolderLink: 'https://drive.google.com/folder/1' }; }
    })({ req: {}, quoteId: QID, artist: null, references: [{ path: `${QID}/ref_1_1731600000000.jpg`, file_name: 'ref_1_1731600000000.jpg', mime_type: 'image/jpeg' }] });
    assert.equal(calls[0].quoteId, QID);
    assert.match(calls[0].files[0].url, /quotation-references/);
    const patch = db.log.find((o) => o.kind === 'patch');
    assert.equal(patch.values.drive_folder_url, 'https://drive.google.com/folder/1');
});

test('evento de email del frente: server-only con render según el contrato del frente emails', () => {
    const events = require('../services/email-events/cot-form');
    const ev = events.quotation_artist_selected;
    assert.equal(ev.serverOnly, true);
    assert.equal(ev.recipient({ artist_email: 'a@x.test' }), 'a@x.test');
    assert.equal(ev.render.audience, 'artist');
    assert.equal(ev.render.category, 'quotations');
    const d = ev.attribs({ client_first_name: 'Ana', quote_id: QID, quotation_url: 'https://x/y' });
    assert.match(ev.render.subject(d), /Ana/);
    assert.ok(Array.isArray(ev.render.rows(d)));
    assert.deepEqual(ev.render.cta(d), { label: 'Ver la solicitud', url: 'https://x/y' });
});
