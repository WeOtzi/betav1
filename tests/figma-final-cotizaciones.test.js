'use strict';
/**
 * Figma final del flujo de artista (oct 2026) · área "cotizaciones".
 *   801:555 Listado y prioridades        → /my-quotations
 *   801:564 Resumen lateral de solicitud → /my-quotations?resumen=<quote_id>
 *   801:556 Nueva cotización manual      → /my-quotations/new (?origen=cliente|cita, ?borrador=)
 *   801:557 Vista previa para el cliente → /my-quotations/new?step=preview
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const VM = require('../public/shared/js/quotations-view-model.js');
const M = require('../public/shared/js/quotation-new-model.js');

const listing = read('public', 'my-quotations', 'index.html');
const newPage = read('public', 'my-quotations', 'new', 'index.html');
const migration = read('supabase', 'migrations', '20261028120000_quotation_manual_quotes.sql');
const rollback = read('supabase', 'rollbacks', '20261028120000_quotation_manual_quotes.down.sql');

/* ------------------------------ modelo del listado ------------------------------ */
test('money is formatted like the Figma ($185.000) and compacted for the summary tiles ($185K)', () => {
    assert.equal(VM.formatMoney(185000, 'ARS'), '$185.000');
    assert.equal(VM.formatMoney(350, 'USD'), 'US$350');
    assert.equal(VM.formatMoney('', 'ARS'), '—');
    assert.equal(VM.formatCompactMoney(185000, 'ARS'), '$185K');
    assert.equal(VM.formatCompactMoney(1240, 'USD'), 'US$1,2K');
    assert.equal(VM.formatCompactMoney(2500000, 'ARS'), '$2,5M');
});

test('tattoo_style is readable in every stored shape and initials skip separators', () => {
    assert.equal(VM.styleName(['Realismo']), 'Realismo');
    assert.equal(VM.styleName({ style_name: 'Fine Line' }), 'Fine Line');
    assert.equal(VM.styleName({ style_name: 'Japonés', substyle_name: 'Irezumi' }), 'Japonés · Irezumi');
    assert.equal(VM.styleName('["Blackwork","Dotwork"]'), 'Blackwork · Dotwork');
    assert.equal(VM.styleName('TBD'), '');
    assert.equal(VM.initials('Marina Ibáñez'), 'MI');
    assert.equal(VM.initials('Valentina · Preview'), 'VP');
});

test('scope select replaces /archive and the URL keeps it as ?alcance=', () => {
    assert.equal(VM.scopeFromParam('archivadas'), 'archived');
    assert.equal(VM.scopeFromParam('borradores'), 'drafts');
    assert.equal(VM.scopeFromParam('nada'), 'all');
    assert.equal(VM.paramForScope('archived'), 'archivadas');
    assert.ok(VM.matchesScope({ quote_status: 'pending' }, 'open'));
    assert.ok(!VM.matchesScope({ quote_status: 'cancelled' }, 'open'));
    assert.ok(VM.matchesScope({ quote_status: 'expired' }, 'closed'));
});

test('hero copy, count label and detail links follow the Figma and the canonical route', () => {
    assert.deepEqual(VM.heroCopy(4), { highlight: '4 cotizaciones', rest: 'esperan tu respuesta esta semana.' });
    assert.deepEqual(VM.heroCopy(1), { highlight: '1 cotización', rest: 'espera tu respuesta esta semana.' });
    assert.equal(VM.countLabel(8, 8), 'Mostrando 8 de 8 cotizaciones');
    assert.equal(VM.detailUrl({ quote_id: 'COT-058', id: 7 }), '/my-quotations/detail?id=COT-058');
});

test('in_progress from the client wizard is hidden but started work stays listed', () => {
    assert.ok(VM.isClientWizardDraft({ quote_status: 'in_progress' }));
    assert.ok(!VM.isClientWizardDraft({ quote_status: 'in_progress', artist_responded_at: '2026-10-01T00:00:00Z' }));
    assert.ok(!VM.isClientWizardDraft({ quote_status: 'pending' }));
});

test('summary timeline maps statuses to NUEVA → REVISANDO → ACEPTADA → AGENDADA', () => {
    const states = (q, s) => VM.timelineSteps(q, s).map((x) => x.state);
    assert.deepEqual(states({ quote_status: 'pending' }), ['current', 'future', 'future', 'future']);
    assert.deepEqual(states({ quote_status: 'responded' }), ['done', 'current', 'future', 'future']);
    assert.deepEqual(states({ quote_status: 'client_approved' }), ['done', 'done', 'current', 'future']);
    assert.deepEqual(states({ quote_status: 'client_approved' }, [{ status: 'scheduled' }]), ['done', 'done', 'done', 'current']);
    assert.deepEqual(states({ quote_status: 'client_rejected' }), ['done', 'stopped', 'future', 'future']);
    assert.deepEqual(VM.stageBadge({ quote_status: 'pending' }), { label: 'Nueva', tone: 'new' });
    assert.equal(VM.stageBadge({ quote_status: 'cancelled' }).label, 'Rechazada');
});

test('summary actions mirror the detail page (accept → responded / in_progress, reject → cancelled / client_rejected)', () => {
    assert.deepEqual(VM.summaryActions({ quote_status: 'pending' }).accept.patch, { quote_status: 'responded' });
    assert.deepEqual(VM.summaryActions({ quote_status: 'pending' }).reject.patch, { quote_status: 'cancelled' });
    assert.deepEqual(VM.summaryActions({ quote_status: 'responded' }).reject.patch, { quote_status: 'client_rejected' });
    assert.equal(VM.summaryActions({ quote_status: 'responded' }).accept, null);
    assert.equal(VM.summaryActions({ quote_status: 'client_approved' }).accept.label, 'Iniciar trabajo');
    assert.ok(VM.summaryActions({ quote_status: 'completed', is_archived: true }).archived);
    assert.deepEqual(VM.statusOptions('pending').map((o) => o.value), ['pending', 'responded', 'cancelled', 'expired']);
    assert.deepEqual(VM.statusOptions('completed').map((o) => o.value), ['completed']);
});

/* --------------------------- modelo de la cotización manual --------------------------- */
test('totals apply discount, then taxes, then the deposit percentage', () => {
    const s = M.createInitialState({ currency: 'ars', ref: 'COT-ABC123' });
    assert.equal(s.currency, 'ARS');
    s.items = [M.newItem({ name: 'Sesión', qty: 2, price: '100.000' }), M.newItem({ name: 'Diseño', qty: 1, price: 50000 })];
    s.discountPct = 10;
    s.taxPct = 21;
    s.depositPct = 30;
    assert.deepEqual(M.computeTotals(s), { subtotal: 250000, discount: 25000, tax: 47250, total: 272250, deposit: 81675, balance: 190575 });
});

test('missing-requirements hint matches the Figma copy and shrinks as the form fills', () => {
    const s = M.createInitialState({ ref: 'COT-ABC123' });
    assert.equal(M.missingMessage(M.missingRequirements(s)), 'Falta cliente, título y un concepto con precio');
    s.title = 'Jaguar';
    assert.equal(M.missingMessage(M.missingRequirements(s)), 'Falta cliente y un concepto con precio');
    s.client = { name: 'Marina Ibáñez' };
    s.items[0].name = 'Sesión';
    assert.equal(M.missingMessage(M.missingRequirements(s)), 'Falta un concepto con precio');
    s.items[0].price = 185000;
    assert.ok(M.isReady(s));
    assert.equal(M.missingMessage(M.missingRequirements(s)), '');
});

test('references are COT- refs that the migration accepts', () => {
    for (let i = 0; i < 20; i++) assert.match(M.generateRef(), /^COT-[A-Z0-9]{6}$/);
    assert.ok(M.isValidRef('COT-DEMO01'));
    assert.ok(!M.isValidRef('cot-1'));
    assert.match(migration, /quote_ref ~ '\^COT-\[A-Z0-9\]\{4,12\}\$'/);
});

test('payloads for create_manual_quotation carry the quote row and the economic detail', () => {
    const s = M.createInitialState({ ref: 'COT-ABC123', origin: 'cita', currency: 'ARS' });
    s.client = { id: 'c-1', name: 'Marina Ibáñez', email: 'Marina@Ejemplo.com', city: 'Palermo, CABA' };
    s.title = 'Jaguar en blackwork';
    s.description = 'Cubriendo antebrazo';
    s.style = { id: 4, slug: 'blackwork', name: 'Blackwork' };
    s.bodyPart = 'Antebrazo';
    s.date = '2026-11-20';
    s.priority = 'high';
    s.items[0] = M.newItem({ name: 'Sesión de tatuaje', qty: 1, price: 185000 });
    const quote = M.buildQuotePayload(s);
    assert.equal(quote.quote_id, 'COT-ABC123');
    assert.equal(quote.client_email, 'marina@ejemplo.com');
    assert.equal(quote.project_description, 'Jaguar en blackwork');
    assert.deepEqual(quote.tattoo_style, { style_id: '4', style_slug: 'blackwork', style_name: 'Blackwork', substyle_name: null });
    assert.equal(quote.artist_budget_amount, 185000);
    assert.equal(quote.priority, 'high');
    assert.ok(!('artist_id' in quote), 'el servidor fuerza artist_id');
    const details = M.buildDetailsPayload(s);
    assert.equal(details.origin, 'cita');
    assert.equal(details.schedule_session, true);
    assert.equal(details.artist_client_id, 'c-1');
    assert.deepEqual(details.line_items, [{ name: 'Sesión de tatuaje', description: null, qty: 1, price: 185000, total: 185000 }]);
    assert.equal(details.deposit_amount, 55500);
    assert.equal(details.cancellation_policy, 'no-reembolsable-48');
});

test('drafts round-trip through artist_manual_quotes', () => {
    const s = M.createInitialState({ ref: 'COT-DRAFT1', currency: 'USD' });
    s.client = { id: null, name: 'Tomás Reyes', email: 'tomas@x.com', whatsapp: '', instagram: '', city: 'Córdoba' };
    s.title = 'Retrato';
    s.coverUp = true;
    s.items = [M.newItem({ name: 'Diseño personalizado', qty: 1, price: 40000 })];
    const record = M.buildDraftRecord(s, { artistId: 'artist-1' });
    assert.equal(record.status, 'draft');
    assert.equal(record.artist_id, 'artist-1');
    const back = M.stateFromDraft(record);
    assert.equal(back.ref, 'COT-DRAFT1');
    assert.equal(back.client.name, 'Tomás Reyes');
    assert.equal(back.title, 'Retrato');
    assert.equal(back.coverUp, true);
    assert.equal(back.items[0].name, 'Diseño personalizado');
    assert.equal(M.computeTotals(back).total, 40000);
});

test('client preview reproduces the empty Figma state (801:557)', () => {
    const s = M.createInitialState({ ref: 'COT-0059', currency: 'ARS' });
    const p = M.previewModel(s, { artistName: 'Laura Martínez' });
    assert.equal(p.header, 'Vista del cliente · COT-0059');
    assert.equal(p.byline, 'Cotización de Laura Martínez · We Ötzi');
    assert.equal(p.title, 'Cotización sin título');
    assert.equal(p.clientLine, 'Para cliente sin asignar');
    assert.equal(p.description, 'Sin descripción de la idea todavía.');
    assert.deepEqual(p.chips, ['Estilo a definir', 'Zona a definir', '1 sesión(es) · 3 h']);
    assert.deepEqual(p.items.map((i) => [i.qtyLine, i.total]), [['1 × $0', '$0']]);
    assert.equal(p.total, '$0');
    assert.equal(p.depositLine, 'Seña $0 · Saldo $0');
    assert.equal(p.conditions, 'Vigencia: 14 días. La seña no es reembolsable. Reprogramaciones con 48 h de aviso.');
});

test('client search covers name, email and phone; new clients are validated', () => {
    const list = M.mergeClients(
        [{ id: 'a', full_name: 'Marina Ibáñez', email: 'marina@x.com', whatsapp: '+54 9 11 5555-0101', city: 'Buenos Aires' }],
        M.clientsFromQuotes([{ client_full_name: 'Marina Ibáñez', client_email: 'MARINA@x.com' }, { client_full_name: 'Tomás Reyes', client_email: 't@x.com' }])
    );
    assert.equal(list.length, 2, 'dedupe por correo');
    assert.equal(M.searchClients(list, 'ibanez')[0].id, 'a');
    assert.equal(M.searchClients(list, 't@x')[0].name, 'Tomás Reyes');
    assert.equal(M.searchClients(list, '5555')[0].name, 'Marina Ibáñez');
    assert.equal(M.validateNewClient({ name: 'A' }), 'Ingresá el nombre del cliente.');
    assert.equal(M.validateNewClient({ name: 'Ana', email: 'no-mail' }), 'El correo no parece válido.');
    assert.equal(M.validateNewClient({ name: 'Ana', email: '' }), '');
});

/* ---------------------------------- páginas ---------------------------------- */
test('the listing shows the Figma blocks and drops what the Figma does not have', () => {
    for (const copy of ['Cotización manual', 'Exportar', 'Mostrar en', 'Cotizaciones totales', 'Pendientes de respuesta',
        'Tasa de respuesta', 'Ingresos confirmados', 'De alta prioridad', 'Buscar por cliente, ciudad o ID...', 'Alta prioridad',
        'Confirmadas', 'Más recientes', 'Cargar cotizaciones anteriores']) {
        assert.ok(listing.includes(copy), copy);
    }
    assert.match(listing, /<option value="archived">Archivadas<\/option>/);
    assert.match(listing, /<option value="drafts">Borradores<\/option>/);
    assert.doesNotMatch(listing, /Configurar cotizador/);
    assert.doesNotMatch(listing, /Ver archivadas/);
    assert.doesNotMatch(listing, /applications-view|archive-extra/);
    assert.doesNotMatch(listing, /editorjs|html2pdf|shared-drawer\.js/);
    assert.match(listing, /id="quote-summary"[^>]*role="dialog"/);
});

test('/my-quotations/new reuses the exact listing markup and auto-opens the sheet', () => {
    const main = (html) => html.slice(html.indexOf('<main class='), html.indexOf('</main>'));
    assert.equal(main(newPage), main(listing));
    assert.match(newPage, /<body class="wo-app q-page" data-quotation-new-autostart>/);
    for (const html of [listing, newPage]) {
        const order = ['/shared/js/wo-demo.js', '/shared/js/config-manager.js', '/shared/js/data/postgrest-client.js',
            '/shared/js/data/quotations-repo.js', '/shared/js/data/quotation-new-repo.js', '/shared/js/quotations-view-model.js',
            '/shared/js/quotation-new-model.js', '/shared/js/quotations.js', '/shared/js/quotations-summary.js', '/shared/js/quotation-new.js'];
        let last = -1;
        for (const src of order) {
            const at = html.indexOf(src);
            assert.ok(at > last, `${src} en orden`);
            last = at;
        }
        assert.match(html, /\/shared\/css\/quotation-new\.css/);
        assert.match(html, /<weotzi-product-nav[^>]*active="quotations"/);
    }
});

test('the data layer adds named methods instead of ad-hoc CRUD', () => {
    const repo = read('public', 'shared', 'js', 'data', 'quotations-repo.js');
    assert.match(repo, /async createManual\(quote, details\)[\s\S]*c\.rpc\('create_manual_quotation', \{ p_quote: quote, p_details: details \}\)/);
    assert.match(repo, /async listClientContactsForArtist\(artistUserId/);
    const newRepo = read('public', 'shared', 'js', 'data', 'quotation-new-repo.js');
    assert.match(newRepo, /D\.ManualQuotes = ManualQuotes/);
    assert.match(newRepo, /D\.ArtistClients = ArtistClients/);
    for (const file of ['quotations.js', 'quotations-summary.js', 'quotation-new.js']) {
        const js = read('public', 'shared', 'js', file);
        assert.doesNotMatch(js, /\/rest\/v1\//, file);
        assert.doesNotMatch(js, /_supabase\.from\(/, file);
    }
});

test('missing schema is detected so the sheet can degrade to a local draft', () => {
    const sandbox = { console, window: { WeotziData: { run: async () => ({}) } } };
    vm.runInNewContext(read('public', 'shared', 'js', 'data', 'quotation-new-repo.js'), sandbox);
    const isMissing = sandbox.window.WeotziData.isMissingSchema;
    assert.ok(isMissing({ code: 'PGRST205', message: 'Could not find the table' }));
    assert.ok(isMissing({ code: 'PGRST202' }));
    assert.ok(isMissing({ message: 'No simulado en preview: Supabase artist_clients' }));
    assert.ok(!isMissing({ code: '23505', message: 'duplicate key' }));
});

/* ------------------------------ migración ------------------------------ */
test('manual-quote migration is additive, owner-scoped, server-validated and reversible', () => {
    assert.match(migration, /create table if not exists public\.artist_clients/);
    assert.match(migration, /create table if not exists public\.artist_manual_quotes/);
    assert.match(migration, /alter table public\.artist_clients enable row level security/);
    assert.match(migration, /alter table public\.artist_manual_quotes enable row level security/);
    assert.match(migration, /create or replace function public\.create_manual_quotation\(p_quote jsonb, p_details jsonb\)[\s\S]*security definer/);
    assert.match(migration, /q\.artist_id := v_uid;/);
    assert.match(migration, /q\.source := 'manual';/);
    assert.match(migration, /revoke all on function public\.create_manual_quotation\(jsonb, jsonb\) from public, anon/);
    assert.doesNotMatch(migration, /drop table|drop column/i);
    assert.match(rollback, /drop function if exists public\.create_manual_quotation\(jsonb, jsonb\)/);
    assert.match(rollback, /drop table if exists public\.artist_manual_quotes/);
    assert.match(rollback, /drop table if exists public\.artist_clients/);
});

/* ------------------------------ fixtures ------------------------------ */
test('preview fixtures add archived/expired quotes, a client book, a draft and the creation RPC', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public', 'shared', 'js', 'demo-fixtures', 'cotizaciones.js'), sandbox);
    const ctx = {
        tables: { quotations_db: [{ id: 990001, quote_id: 'DEMO-P01', quote_status: 'pending', client_full_name: 'Camila Soto' }], quotation_notes: [] },
        TABLES: ['quotations_db'],
        rpcs: {},
        identity: { userId: 'artist-1' },
        helpers: { DAY: 86400000 },
    };
    sandbox.WoDemoFixtureExtensions.cotizaciones(ctx);
    sandbox.WoDemoFixtureExtensions.cotizaciones(ctx);
    const refs = ctx.tables.quotations_db.map((q) => q.quote_id);
    assert.deepEqual(refs, ['DEMO-P01', 'DEMO-V01', 'DEMO-A01', 'DEMO-A02'], 'idempotente');
    assert.equal(ctx.tables.quotations_db.filter((q) => q.is_archived).length, 2);
    assert.ok(ctx.TABLES.includes('artist_manual_quotes') && ctx.TABLES.includes('artist_clients'));
    assert.equal(ctx.tables.artist_manual_quotes[0].status, 'draft');
    assert.ok(ctx.tables.artist_clients.every((c) => c.artist_id === 'artist-1'));
    assert.equal(ctx.tables.quotation_notes.length, 1);

    // El RPC del preview inserta la cotización y el detalle como el SQL.
    const rows = { quotations_db: [], artist_manual_quotes: [], artists_db: [{ user_id: 'artist-1', name: 'Laura' }], quotation_sessions: [] };
    let seq = 1;
    const store = {
        rows: (n) => rows[n] || (rows[n] = []),
        insert: (n, list) => list.map((r) => { const row = Object.assign({ id: seq++ }, r); store.rows(n).push(row); return row; }),
    };
    const s = M.createInitialState({ ref: 'COT-NEW001', origin: 'cita' });
    s.client = { name: 'Marina' };
    s.title = 'Jaguar';
    s.date = '2026-11-20';
    s.items[0] = M.newItem({ name: 'Sesión', qty: 1, price: 1000 });
    const out = ctx.rpcs.create_manual_quotation({ p_quote: M.buildQuotePayload(s), p_details: M.buildDetailsPayload(s) }, store, { userId: 'artist-1' });
    assert.equal(out.quote_id, 'COT-NEW001');
    assert.equal(rows.quotations_db[0].quote_status, 'responded');
    assert.equal(rows.quotations_db[0].source, 'manual');
    assert.equal(rows.artist_manual_quotes[0].status, 'sent');
    assert.equal(rows.quotation_sessions.length, 1, 'nueva cita agenda la primera sesión');
    assert.equal(ctx.rpcs.create_manual_quotation({ p_quote: {}, p_details: {} }, store, {}).error, 'Faltan datos obligatorios.');
});

/* ------------------------------ ronda 1 de correcciones ------------------------------ */
test('budget sort keeps a single ordered list instead of out-of-order period groups', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const q = (id, created, amount, status = 'responded') => ({ id, quote_id: id, quote_status: status, created_at: created, artist_budget_amount: amount, artist_budget_currency: 'USD' });
    const list = [
        q('A', '2026-10-27T10:00:00Z', 350), q('B', '2026-10-20T10:00:00Z', 450),
        q('C', '2026-10-03T10:00:00Z', 1600), q('D', '2026-09-30T10:00:00Z', 1000),
        q('E', '2026-10-26T10:00:00Z', null),
    ];
    const desc = VM.sortQuotes(list, { field: 'budget', direction: 'desc' });
    assert.deepEqual(desc.map((x) => x.id), ['C', 'D', 'B', 'A', 'E'], 'sin importe al final');
    const asc = VM.sortQuotes(list, { field: 'budget', direction: 'asc' });
    assert.deepEqual(asc.map((x) => x.id), ['A', 'B', 'D', 'C', 'E']);
    const groups = VM.groupForList(desc, { field: 'budget', direction: 'desc' }, now);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, 'De mayor a menor presupuesto');
    assert.deepEqual(groups[0].quotes.map((x) => x.id), ['C', 'D', 'B', 'A', 'E']);
    // Por fecha siguen los grupos del Figma, en orden cronológico.
    const byDate = VM.groupForList(VM.sortQuotes(list, { field: 'created_at', direction: 'desc' }), { field: 'created_at', direction: 'desc' }, now);
    assert.deepEqual(byDate.map((g) => g.label), ['Esta semana', 'Semana pasada', 'Octubre 2026', 'Septiembre 2026']);
    // El importe comparable puede venir convertido (moneda de "Mostrar en").
    const converted = VM.sortQuotes([q('ARS', '2026-10-01', 130000), q('USD', '2026-10-02', 200)], { field: 'budget', direction: 'desc' },
        (x) => ({ amount: x.id === 'ARS' ? 100 : 200, currency: 'USD' }));
    assert.deepEqual(converted.map((x) => x.id), ['USD', 'ARS']);
    // Sin tipo de cambio no se comparan $90.000 (ARS) con US$1.600: la moneda principal va primero.
    const ars = Object.assign(q('P', '2026-10-05', 90000), { artist_budget_currency: 'ARS' });
    const mixed = VM.sortQuotes([ars, ...list], { field: 'budget', direction: 'desc' });
    assert.deepEqual(mixed.map((x) => x.id), ['C', 'D', 'B', 'A', 'P', 'E']);
    assert.deepEqual(VM.groupForList([], { field: 'budget', direction: 'asc' }), []);
});

test('listing badges use the five Figma legend families and keep the fine state as detail', () => {
    assert.deepEqual(VM.statusBadge('completed'), { label: 'Confirmada', detail: 'Completada', tone: 'confirmed' });
    assert.deepEqual(VM.statusBadge('in_progress'), { label: 'Confirmada', detail: 'En progreso', tone: 'confirmed' });
    assert.deepEqual(VM.statusBadge('artist_completed'), { label: 'Confirmada', detail: 'Lista para cliente', tone: 'confirmed' });
    assert.equal(VM.statusBadge('cancelled').label, 'Rechazada');
    assert.equal(VM.statusBadge('pending').label, 'Pendiente');
    assert.equal(VM.statusBadge('draft').label, 'Borrador');
    // El indicador "Ingresos confirmados" usa el mismo criterio que el chip CONFIRMADAS.
    const js = read('public', 'shared', 'js', 'quotations.js');
    assert.match(js, /VM\.CONFIRMED_STATUSES\.includes\(q\.quote_status\)\)\s*\.map\(VM\.amountEntry\)/);
});

test('"Mostrar en" has no extra "Moneda original" option and defaults to the artist currency', () => {
    for (const html of [listing, newPage]) {
        assert.doesNotMatch(html, /Moneda original/);
        assert.match(html, /<option value="ARS">Pesos \(ARS\)<\/option>/);
    }
    const js = read('public', 'shared', 'js', 'quotations.js');
    assert.doesNotMatch(js, /Moneda original/);
    assert.match(js, /session_price_currency/);
});

test('manual quote accepts ?fecha= and only internal ?volver= paths', () => {
    assert.equal(M.normalizeDateParam('2026-11-03'), '2026-11-03');
    assert.equal(M.normalizeDateParam('2026-02-30'), '');
    assert.equal(M.normalizeDateParam('03/11/2026'), '');
    assert.equal(M.createInitialState({ origin: 'cita', date: '2026-11-03' }).date, '2026-11-03');
    assert.equal(M.createInitialState({ date: 'mañana' }).date, '');
    assert.equal(M.safeReturnPath('/calendar/?view=week&date=2026-11-03'), '/calendar/?view=week&date=2026-11-03');
    assert.equal(M.safeReturnPath('//evil.example'), null);
    assert.equal(M.safeReturnPath('/\\evil.example'), null);
    assert.equal(M.safeReturnPath('https://evil.example'), null);
    assert.equal(M.safeReturnPath('javascript:alert(1)'), null);
    assert.equal(M.safeReturnPath(''), null);
    const js = read('public', 'shared', 'js', 'quotation-new.js');
    assert.match(js, /params\.get\('fecha'\)/);
    assert.match(js, /params\.get\('volver'\)/);
    // El Atrás del navegador respeta los cambios sin guardar.
    assert.match(js, /addEventListener\('popstate'[\s\S]*?isDirty\(\)[\s\S]*?window\.confirm/);
    assert.match(js, /addEventListener\('beforeunload'/);
});

test('form layout follows the Figma (chips under AGREGAR CONCEPTO, no native chrome at rest)', () => {
    const css = read('public', 'shared', 'css', 'quotation-new.css');
    assert.match(css, /\.qn-items-add \{[^}]*flex-direction: column/);
    assert.doesNotMatch(css, /\.qn-quick \{[^}]*flex: 1 1 320px/);
    assert.match(css, /::-webkit-calendar-picker-indicator \{[^}]*opacity: 0/);
    assert.match(css, /\.qn-textarea \{[^}]*resize: none/);
    const listCss = read('public', 'shared', 'css', 'quotations.css');
    assert.match(listCss, /@media \(max-width: 900px\) \{[\s\S]*?\.q-listado \.q-hero-main \{ flex: 0 0 auto; width: 100%; \}/);
    assert.match(listCss, /\.qs-step:not\(:last-child\)::after \{[^}]*left: 74px;[^}]*right: 0;/);
});

test('ronda 2: timeline de 345.2px y alturas verticales de los bloques 03/04 según el Figma', () => {
    const listCss = read('public', 'shared', 'css', 'quotations.css');
    // Figma 99:828: el timeline (y las secciones siguientes al resumen del tatuaje) mide 345.2px → tramos de 86.3px y guion de 12.3px.
    assert.match(listCss, /\.qs-body > \.qs-section \+ \.qs-section \{ width: min\(100%, 345\.2px\); \}/);
    assert.match(listCss, /@media \(max-width: 640px\) \{[\s\S]*?\.qs-body > \.qs-section \+ \.qs-section \{ width: auto; \}/);
    const css = read('public', 'shared', 'css', 'quotation-new.css');
    // Figma 547:1647: caja de referencias de 61.6px (sin aire inferior, texto de 16px).
    assert.match(css, /\.qn-refs \{[^}]*padding: var\(--space-1\) 1px 0;/);
    assert.match(css, /\.qn-refs-empty \{[^}]*line-height: 16px;/);
    // Figma 547:1712: totales de 463px (filas 36.4 · 54.4 · 54.4 · 60 · 59.4 · 29.6 · 29.6 + nota de 50px).
    assert.match(css, /\.qn-totals \{[^}]*padding: 0\.6px;/);
    assert.match(css, /\.qn-trow \{[^}]*line-height: 17\.6px;/);
    assert.match(css, /\.qn-trow--rule \{ padding: 9px 0 8\.8px;/);
    assert.match(css, /\.qn-trow--total \{ padding: 14px 0;/);
    assert.match(css, /\.qn-trow--top \{ padding: 13\.8px 0 9px;/);
    assert.match(css, /\.qn-tbig \{[^}]*line-height: 32px;/);
    assert.match(css, /\.qn-pct input \{[^}]*width: 83\.6px;[^}]*height: 35\.6px;/);
    assert.match(css, /\.qn-totals-note \{[^}]*padding: 13\.4px 0 0\.6px;[^}]*line-height: 18px;/);
    assert.match(css, /\.qn-totals-currency select \{[^}]*padding: 0 22\.8px 0 10\.8px;/);
    // Figma 547:1776 / 547:1781: 18.6px hasta "Notas para el cliente", 22px hasta "Términos adicionales".
    assert.match(css, /\.qn-form > \.qn-cond \+ \.qn-field \{ margin-top: calc\(var\(--space-4\) \+ 2\.6px\); \}/);
    assert.match(css, /\.qn-form > \.qn-cond \+ \.qn-field \+ \.qn-field \{ margin-top: calc\(var\(--space-5\) \+ 2px\); \}/);
});
