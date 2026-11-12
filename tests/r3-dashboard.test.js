// Ronda 3 (12 nov 2026) · grupo "dashboard" · Figma 24:1425, 801:578/579, 2003:1191.
// P11 agenda con eventos propios · P12 etapa/fecha límite del diseño · P13 tarjeta
// clickeable · P14 actividad completa (+ punto de extensión) · P16 imágenes en
// notas de trabajo (Storage privado) · P17 consentimiento de importación de IG.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const LM = require('../public/shared/js/dashboard-live-model.js');
const QM = require('../public/shared/js/quotation-detail-model.js');
const consent = require('../lib/dashboard-ig-consent.js');

const NOW = new Date(2026, 10, 12, 9, 12, 0); // jue 12 nov 2026 09:12 local
const at = (h, m, dayOffset = 0) => new Date(2026, 10, 12 + dayOffset, h, m, 0).toISOString();
// Los objetos creados dentro de vm son de otro realm: se comparan como JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));
const styleOf = (v) => (Array.isArray(v) ? v[0] : v) || null;

/* ------------------------------ P11 · agenda ------------------------------ */
test('P11: la agenda del día une turnos y eventos propios, ordenados y con todo-el-día primero', () => {
    const sessions = [
        { id: 's1', session_date: at(10, 0), session_number: 1, status: 'scheduled', duration_hours: 3, quotations_db: { quote_id: 'Q1', client_full_name: 'Sofía Martínez', tattoo_style: ['Fine line'], tattoo_body_part: 'Brazo', final_sessions: 3 } },
        { id: 's2', session_date: at(16, 0), session_number: 2, status: 'rescheduled', quotations_db: { quote_id: 'Q2', client_full_name: 'Julia Ferrer' } },
        { id: 's3', session_date: at(11, 0), status: 'cancelled', quotations_db: { client_full_name: 'X' } },
        { id: 's4', session_date: at(10, 0, 2), status: 'scheduled', quotations_db: { client_full_name: 'Mañana' } }
    ];
    const events = [
        { id: 'e1', type: 'reservation', title: 'Tomás Vega — consulta · boceto nuevo', clientName: 'Tomás Vega', start: at(18, 30), end: at(19, 15), allDay: false, status: 'scheduled', location: 'Estudio propio' },
        { id: 'e2', type: 'personal', title: 'Pedido de insumos', start: at(12, 0), end: at(12, 30), allDay: false, status: 'scheduled' },
        { id: 'e3', type: 'availability', title: 'Disponible', start: at(8, 0), end: at(20, 0), allDay: false, status: 'scheduled' },
        { id: 'e4', type: 'guest_spot', title: 'Guest en Lima', start: at(0, 0, -1), end: at(0, 0, 2), allDay: true, status: 'scheduled' },
        { id: 'e5', type: 'personal', title: 'Cancelado', start: at(13, 0), end: at(14, 0), status: 'cancelled' }
    ];
    const out = LM.mergeAgenda(sessions, events, NOW, styleOf);
    assert.deepEqual(out.items.map((i) => i.who), ['Guest en Lima', 'Sofía Martínez', 'Pedido de insumos', 'Julia Ferrer', 'Tomás Vega']);
    assert.equal(out.todayCount, 3, 'el saludo cuenta turnos + reservas con cliente, no los eventos personales');
    assert.equal(out.fallback, false);
    const tomas = out.items[4];
    assert.equal(tomas.detail, 'Reserva · consulta · boceto nuevo · Estudio propio');
    assert.deepEqual(tomas.state, { cls: 'is-ok', txt: 'CONFIRMADO' });
    assert.equal(LM.durationLabel(tomas.durationHours), '45M');
    assert.equal(out.items[1].detail, 'Sesión 1/3 · Fine line · Brazo');
    assert.equal(out.items[1].href, '/my-quotations/detail?id=Q1');
    assert.equal(out.items[3].state.txt, 'POR CONFIRMAR');
    assert.deepEqual(out.items[2].state, { cls: 'is-own', txt: 'EVENTO PERSONAL' });
    assert.deepEqual(LM.agendaTime(out.items[0], NOW), { hour: 'DÍA', day: 'COMPLETO' });
    assert.deepEqual(LM.agendaTime(out.items[1], NOW), { hour: '10:00', day: '' });
});

test('P11: sin nada hoy, la agenda orienta con el próximo turno', () => {
    const out = LM.mergeAgenda([{ id: 's9', session_date: at(15, 0, 3), status: 'scheduled', quotations_db: { client_full_name: 'Mateo Ruiz' } }], [], NOW, styleOf);
    assert.equal(out.todayCount, 0);
    assert.equal(out.fallback, true);
    assert.equal(out.items.length, 1);
    assert.equal(LM.agendaTime(out.items[0], NOW).day, 'DOM 15');
    assert.deepEqual(LM.mergeAgenda([], [], NOW).items, []);
});

test('P11: calendar-repo expone listManualRange (solo eventos propios, recurrencias expandidas)', async () => {
    const calls = [];
    const builder = {
        select() { calls.push('select'); return this; },
        eq(c, v) { calls.push(['eq', c, v]); return this; },
        neq(c, v) { calls.push(['neq', c, v]); return this; },
        lt(c, v) { calls.push(['lt', c, v]); return this; },
        order() { return Promise.resolve({ data: rows, error: null }); }
    };
    const rows = [
        { id: 'w', event_type: 'personal', title: 'Semanal', starts_at: new Date(2026, 9, 29, 12, 0).toISOString(), ends_at: new Date(2026, 9, 29, 12, 30).toISOString(), status: 'scheduled', recurrence_rule: 'weekly', recurrence_until: null },
        { id: 'o', event_type: 'personal', title: 'Otro día', starts_at: new Date(2026, 10, 10, 9, 0).toISOString(), ends_at: new Date(2026, 10, 10, 10, 0).toISOString(), status: 'scheduled', recurrence_rule: 'none' }
    ];
    const window = { WeotziData: { run: async (label, fn) => fn({ from: () => builder }) } };
    vm.runInNewContext(read('public/shared/js/data/calendar-repo.js'), { window, console });
    const start = new Date(2026, 10, 12);
    const end = new Date(2026, 10, 13);
    const events = await window.WeotziData.Calendar.listManualRange('artist-1', start, end);
    assert.deepEqual(plain(events.map((e) => [e.baseId, new Date(e.start).getDate()])), [['w', 12]]);
    assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'lt' && c[1] === 'starts_at'));
    assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'neq' && c[2] === 'cancelled'));
});

/* -------------------------- P12 / P13 · diseños -------------------------- */
test('P12: la etapa sale de design_stage (no de current_step) y la fecha de design_due_date', () => {
    assert.deepEqual(LM.designStageInfo({ design_stage: 'Entintado', quote_status: 'client_approved' }),
        { key: 'entintado', label: 'ENTINTADO', cls: ' is-entintado', editable: true });
    const fallback = LM.designStageInfo({ current_step: 'step-3', quote_status: 'client_approved' });
    assert.equal(fallback.label, 'CONFIRMADA');
    assert.equal(fallback.key, null);
    assert.equal(fallback.editable, true);
    assert.equal(LM.designStageInfo({ quote_status: 'artist_completed' }).cls, ' is-final');
    assert.equal(LM.designStageInfo({ quote_status: 'pending' }).editable, false);

    const limit = LM.designDeadline({ design_due_date: '2026-11-20', client_preferred_date: '2026-12-01' }, [], NOW);
    assert.equal(limit.label, 'LÍMITE');
    assert.equal(limit.date.getDate(), 20);
    assert.equal(limit.overdue, false);
    assert.equal(LM.designDeadline({ design_due_date: '2026-11-01' }, [], NOW).overdue, true);
    const next = LM.designDeadline({ client_preferred_date: '2026-12-01' }, [{ session_date: at(10, 0, 3), status: 'scheduled' }, { session_date: at(10, 0, 1), status: 'cancelled' }], NOW);
    assert.equal(next.label, 'PRÓXIMA', 'sin límite cargado usa la próxima sesión, no la fecha preferida del cliente');
    assert.equal(next.date.getDate(), 15);
    assert.equal(LM.designDeadline({}, [], NOW), null);
});

test('P12: validación del editor de etapa', () => {
    assert.deepEqual(LM.validateDesignStage({ stage: 'boceto', due: '2026-12-01' }, NOW), { ok: true, stage: 'boceto', due: '2026-12-01' });
    assert.deepEqual(LM.validateDesignStage({ stage: null, due: '' }, NOW), { ok: true, stage: null, due: null });
    assert.equal(LM.validateDesignStage({ stage: 'pintado' }, NOW).ok, false);
    assert.equal(LM.validateDesignStage({ stage: 'final', due: '12/01/2026' }, NOW).ok, false);
    assert.equal(LM.validateDesignStage({ stage: 'final', due: '2040-01-01' }, NOW).ok, false);
});

test('P12/P13: la tarjeta lleva al detalle y abre el editor sin anidar el botón en el link', () => {
    const redesign = read('public/shared/js/dashboard-redesign.js');
    assert.match(redesign, /class="wo-dash-design-link" href="/);
    assert.match(redesign, /\/my-quotations\/detail\?id=' \+ encodeURIComponent\(q\.quote_id\)/);
    assert.match(redesign, /data-design-stage="/);
    assert.match(redesign, /window\.DesignStageEditor\.open\(/);
    assert.doesNotMatch(redesign, /String\(q\.current_step\)/, 'current_step es del wizard del cliente');
    const css = read('public/shared/css/dashboard-live.css');
    assert.match(css, /\.wo-dash-design-link::after \{ content: ''; position: absolute; inset: 0;/);
    assert.match(css, /\.wo-dash-design-stage \{[^}]*position: relative;[^}]*z-index: 1;/);
    assert.match(css, /prefers-reduced-motion/);
    const editor = read('public/shared/js/design-stage-editor.js');
    assert.match(editor, /role="radiogroup"/);
    assert.match(editor, /WeotziData\.DesignStage\.set\(/);
    for (const copy of ['ETAPA DEL DISEÑO', 'FECHA LÍMITE', 'GUARDAR ETAPA', 'QUITAR ETAPA', 'CANCELAR']) assert.ok(editor.includes(copy), copy);
});

test('P12: DesignStage.set llama a la RPC con los parámetros de la migración', async () => {
    let rpc = null;
    const window = { WeotziData: { run: async (label, fn) => fn({ rpc: (name, args) => { rpc = { name, args }; return Promise.resolve({ data: [{ id: 7, design_stage: 'final', design_due_date: null }], error: null }); } }) } };
    vm.runInNewContext(read('public/shared/js/data/dashboard-repo.js'), { window, console, document: { dispatchEvent() {} }, CustomEvent: function () {} });
    const row = await window.WeotziData.DesignStage.set('7', { stage: 'final', due: null });
    assert.deepEqual(plain(rpc), { name: 'set_quotation_design_stage', args: { p_quotation_id: 7, p_stage: 'final', p_due_date: null } });
    assert.equal(row.design_stage, 'final');
});

/* ----------------------------- P14 · actividad ----------------------------- */
test('P14: actividad con turnos, reseñas y fuentes externas; dedupe y orden', () => {
    const since = new Date(2026, 10, 1).toISOString();
    const quotes = { 5: { id: 5, quote_id: 'Q5', client_full_name: 'Sofía Martínez' } };
    const confirmed = LM.sessionActivity({ quotation_id: 5, status: 'confirmed', created_at: at(8, 0, -3), updated_at: at(9, 0) }, quotes, since);
    assert.equal(confirmed.txt, 'Sofía confirmó su turno');
    assert.equal(confirmed.href, '/my-quotations/detail?id=Q5');
    const scheduled = LM.sessionActivity({ quotation_id: 5, status: 'scheduled', session_date: at(10, 0, 4), created_at: at(8, 0), updated_at: at(8, 0) }, quotes, since);
    assert.equal(scheduled.txt, 'Turno agendado con Sofía · 16/11');
    assert.equal(LM.sessionActivity({ quotation_id: 5, status: 'completed', session_number: 2, updated_at: at(7, 0) }, quotes, since).txt, 'Completaste la sesión 2 con Sofía');
    assert.equal(LM.sessionActivity({ quotation_id: 5, status: 'scheduled', created_at: at(8, 0, -30) }, quotes, since), null, 'fuera de la ventana');

    const review = LM.reviewActivity({ rating: 5, reviewer_display_name: 'Julia Ferrer', created_at: at(6, 0) }, '/artist/profile?artist=x#artist-reviews-panel');
    assert.equal(review.txt, 'Reseña 5★ de Julia Ferrer');
    assert.equal(review.icon, 'star');

    const payment = LM.externalActivity({ type: 'payment', text: 'Pago recibido · Mateo · $180', created_at: at(8, 30) });
    assert.equal(payment.icon, 'dollar-sign');

    const merged = LM.mergeActivity([[confirmed, scheduled], [review], [payment, Object.assign({}, payment)]], 4);
    assert.deepEqual(merged.map((e) => e.txt), ['Sofía confirmó su turno', 'Pago recibido · Mateo · $180', 'Turno agendado con Sofía · 16/11', 'Reseña 5★ de Julia Ferrer']);
    assert.equal(LM.quoteActivity({ quote_status: 'pending', client_full_name: 'Camila Soto', created_at: at(7, 0), quote_id: 'P1' }).txt, 'Nueva cotización de Camila Soto');
});

test('P14: punto de extensión registerSource (grupo pagos) y fuentes que fallan no tumban al resto', async () => {
    const events = [];
    const window = { WeotziData: { run: async () => ({ data: [] }) } };
    const document = { dispatchEvent: (e) => events.push(e) };
    function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
    window.WoDashboardActivitySources = [{ name: 'temprana', loader: async () => [{ type: 'payment', text: 'Seña', created_at: 'x' }] }];
    vm.runInNewContext(read('public/shared/js/data/dashboard-repo.js'), { window, console: { error() {}, warn() {} }, document, CustomEvent });
    const A = window.WeotziData.DashboardActivity;
    A.registerSource('payments', async (ctx) => [{ type: 'payment', text: 'Pago recibido · ' + ctx.artistId }]);
    A.registerSource('rota', async () => { throw new Error('boom'); });
    assert.equal(events[0].type, 'weotzi:dashboard-activity-refresh');
    const items = await A.loadSources({ artistId: 'a1' });
    assert.deepEqual(plain(items.map((i) => i.text).sort()), ['Pago recibido · a1', 'Seña']);

    const redesign = read('public/shared/js/dashboard-redesign.js');
    assert.match(redesign, /weotzi:dashboard-activity-refresh/);
    assert.match(redesign, /A\.listRecentReviews\(user\.id, since\)/);
    assert.match(redesign, /dashboard_demo_marker && supplementalActivity\.length/);
});

/* --------------------------- P16 · notas con imagen --------------------------- */
test('P16: el bloque imagen guarda la ruta de Storage (no la URL firmada) y la lista va a images', () => {
    const blocks = [QM.block('image', 'Boceto', { path: 'u1/42/1-a-boceto.png' }), QM.block('image', 'Ref', { url: 'https://x/y.png' }), QM.block('text', 'hola')];
    const content = QM.contentFromBlocks(blocks, [], null);
    assert.deepEqual(content.blocks[0].data.file, { url: '', path: 'u1/42/1-a-boceto.png' });
    assert.deepEqual(content.blocks[1].data.file, { url: 'https://x/y.png' });
    const back = QM.blocksFromContent(content);
    assert.equal(back[0].path, 'u1/42/1-a-boceto.png');
    assert.equal(back[1].url, 'https://x/y.png');
    assert.deepEqual(QM.notePaths(content), ['u1/42/1-a-boceto.png']);
    assert.deepEqual(QM.notePaths(blocks.concat([QM.block('image', '', { path: 'u1/42/1-a-boceto.png' })])), ['u1/42/1-a-boceto.png']);
    assert.equal(QM.isEmptyNote([QM.block('image', '', { path: 'u1/42/x.png' })], [], 'Nueva nota'), false);
    assert.match(QM.noteToMarkdown({ title: 'N', note_date: NOW, content }), /!\[Boceto\]\(imagen privada en We Ötzi\)/);
});

test('P16: NoteFiles sube a <artist>/<cotización>/ del bucket privado y valida tipo y peso', async () => {
    const uploads = [];
    const bucket = {
        upload: async (p, file, opts) => { uploads.push({ p, opts }); return { error: null }; },
        createSignedUrl: async (p, ttl) => ({ data: { signedUrl: 'https://signed/' + p + '?ttl=' + ttl }, error: null }),
        remove: async (list) => { uploads.push({ removed: list }); return { error: null }; }
    };
    const window = { WeotziData: { getClient: () => ({ storage: { from: (b) => { assert.equal(b, 'quotation-note-files'); return bucket; } } }) } };
    vm.runInNewContext(read('public/shared/js/data/note-files-repo.js'), { window, console, URL, Date, Math });
    const F = window.WeotziData.NoteFiles;
    assert.equal(F.validate({ name: 'a.pdf', type: 'application/pdf', size: 10 }), 'Formato no admitido. Subí JPG, PNG, WEBP, GIF o HEIC.');
    assert.equal(F.validate({ name: 'a.png', type: 'image/png', size: 11 * 1024 * 1024 }), 'La imagen pesa más de 10 MB.');
    const p = await F.upload({ name: 'Boceto Final ñ.png', type: 'image/png', size: 100 }, { artistId: 'u1', quotationId: 42 });
    assert.match(p, /^u1\/42\/\d+-[a-z0-9]+-Boceto-Final-n\.png$/);
    assert.equal(uploads[0].opts.upsert, false);
    assert.equal(await F.signedUrl(p), 'https://signed/' + p + '?ttl=3600');
    await F.remove([p]);
    assert.deepEqual(uploads[1].removed, [p]);
    await assert.rejects(F.upload({ name: 'a.png', type: 'image/png', size: 1 }, { artistId: null, quotationId: 1 }));
});

test('P16: el panel de notas sube la imagen vía WeotziData (sin CRUD ad-hoc) y conserva la opción de URL', () => {
    const notes = read('public/shared/js/work-notes-drawer.js');
    assert.doesNotMatch(notes, /\.from\('quotation|\/rest\/v1\/|_supabase\.from\(/);
    assert.match(notes, /data-image-upload/);
    assert.match(notes, /data-field="url" type="url"/);
    assert.match(notes, /F\.upload\(file, \{ artistId, quotationId: quote\.id \}\)/);
    assert.match(notes, /images, updated_at: now/);
    assert.match(notes, /purgeRemovedFiles\(images\)/);
    const html = read('public/my-quotations/detail/index.html');
    assert.ok(html.indexOf('note-files-repo.js') > html.indexOf('postgrest-client.js'));
    assert.ok(html.indexOf('note-files-repo.js') < html.indexOf('work-notes-drawer.js'));
    const css = read('public/shared/css/work-notes-drawer.css');
    assert.match(css, /\.wn-upload:focus-within \{ box-shadow: var\(--shadow-focus\); \}/);
});

/* ------------------------- P17 · consentimiento IG ------------------------- */
test('P17: el consentimiento se normaliza con hora del servidor y se registra en audit e ítems', () => {
    const when = new Date('2026-11-12T12:00:00.000Z');
    assert.equal(consent.normalizeImportConsent(undefined, { now: when }), null);
    assert.equal(consent.normalizeImportConsent({ accepted: 'yes' }, { now: when }), null);
    const rec = consent.normalizeImportConsent({ accepted: true, version: 'ig-import-2026-11', accepted_at: '1999-01-01' }, { now: when });
    assert.deepEqual(rec, { accepted: true, version: 'ig-import-2026-11', text: consent.IG_CONSENT_TEXT, accepted_at: '2026-11-12T12:00:00.000Z', handle: null });
    assert.equal(consent.normalizeImportConsent(true, { now: when }).version, consent.IG_CONSENT_VERSION);
    assert.equal(consent.withHandle(rec, '@Ink_Test').handle, 'ink_test');
    assert.equal(consent.withHandle(null, 'x'), null);

    const lib = read('lib/instagram-import.js');
    assert.match(lib, /const consentRecord = igConsent\.withHandle\(consent, payload\.username\);/);
    assert.match(lib, /item\.consent_at = consentRecord\.accepted_at/);
    assert.match(lib, /consent: consentRecord\n/);
    const server = read('server.js');
    assert.match(server, /consent: igConsent\.normalizeImportConsent\(body\.consent\)/);
    const client = read('public/shared/js/instagram-import.js');
    assert.match(client, /if \(this\.confirmed\) body\.consent = \{ accepted: true, version: 'ig-import-2026-11' \};/);
    assert.ok(client.includes(consent.IG_CONSENT_TEXT), 'el texto registrado es el del paso 01');
});

/* ------------------------------ migración y carga ------------------------------ */
test('migración 20261112180000: columnas, RPC security definer, bucket privado y reversa', () => {
    const sql = read('supabase/migrations/20261112180000_dashboard_design_stage_note_files.sql');
    const down = read('supabase/rollbacks/20261112180000_dashboard_design_stage_note_files.down.sql');
    assert.match(sql, /add column if not exists design_stage text/);
    assert.match(sql, /add column if not exists design_due_date date/);
    assert.match(sql, /check \(design_stage is null or design_stage in \('boceto', 'entintado', 'final'\)\)/);
    assert.match(sql, /function public\.set_quotation_design_stage\([\s\S]*security definer[\s\S]*set search_path = public, pg_temp/);
    assert.match(sql, /is_support_user\(\)/);
    assert.match(sql, /revoke all on function public\.set_quotation_design_stage\(integer, text, date\) from anon;/);
    assert.match(sql, /'quotation-note-files',\s*'quotation-note-files',\s*false,/);
    assert.match(sql, /q\.id::text = \(storage\.foldername\(name\)\)\[2\]/);
    assert.doesNotMatch(sql, /set current_step/);
    assert.match(down, /drop function if exists public\.set_quotation_design_stage/);
    assert.match(down, /set local storage\.allow_delete_query = 'true';/);
    assert.match(down, /not exists \(select 1 from storage\.objects o where o\.bucket_id = 'quotation-note-files'\)/);
});

test('el dashboard carga calendar-repo, dashboard-repo, el modelo y el editor antes de la capa viva', () => {
    const html = read('public/artist/dashboard/index.html');
    const order = ['data/postgrest-client.js', 'data/calendar-repo.js', 'data/dashboard-repo.js', 'dashboard-live-model.js', 'dashboard.js?', 'design-stage-editor.js', 'dashboard-redesign.js']
        .map((name) => html.indexOf('/shared/js/' + name));
    order.forEach((idx, i) => {
        assert.ok(idx > -1, 'script ' + i);
        if (i) assert.ok(idx > order[i - 1], 'orden ' + i);
    });
    assert.match(html, /\/shared\/css\/dashboard-live\.css/);
    const fixtures = read('public/shared/js/demo-fixtures/dashboard.js');
    assert.match(fixtures, /ctx\.rpcs\.set_quotation_design_stage/);
    assert.match(fixtures, /event_type: 'personal', title: 'Bloque de dibujo'/);
});
