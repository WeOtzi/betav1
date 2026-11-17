'use strict';

// Ronda 2 · CF-03 · código corto de la cotización (quotations_db.short_code)
//   El cliente ve un código de 6 caracteres en la pantalla de éxito y en su
//   panel. El mismo código tiene que leerse en los correos nuevos, en la hoja
//   compartida (página, PDF e imagen), en /client/chats y en el listado del
//   artista. El quote_id interno ("QN" + 32 hex) queda solo para los enlaces.
//   La columna llega con la migración 20261116110000: todo lo que la lee tiene
//   que seguir andando si la base todavía no la tiene.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const QuoteCode = require('../lib/quote-code');
const { readShortCode, withShortCode } = require('../lib/repos/quote-code');
const { renderEmail } = require('../lib/email-render');
const Sesiones = require('../lib/sesiones');
const Negociacion = require('../lib/negociacion');

const QUOTE_ID = 'QN0123456789abcdef0123456789abcdef';
const CODE = 'AB23CD';
const BASE = 'https://beta.weotzi.com';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const CLIENT = '11111111-1111-4111-8111-111111111111';

// Texto que lee la persona: sin las URL (ahí el quote_id sí viaja, es la llave).
const visibleText = (out) => `${out.subject}\n${out.text.replace(/https?:\/\/\S+/g, '')}`;

function quote(extra = {}) {
    return Object.assign({
        id: 2787, quote_id: QUOTE_ID, quote_status: 'responded',
        client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía Fernández',
        artist_id: ARTIST, artist_email: 'mateo@example.com', artist_name: 'Mateo Rivas',
        artist_budget_amount: '2000', artist_budget_currency: 'USD',
    }, extra);
}

// ---------------------------------------------------------------- modelo
test('código visible: el corto si la cotización lo tiene; si no, el quote_id', () => {
    // Un solo formato en todo el servidor y en la base.
    assert.equal(QuoteCode.SHORT_CODE_RE.source, require('../lib/cot-form').SHORT_CODE_RE.source);
    assert.ok(read('supabase/migrations/20261116110000_cot_form_r2_columnas.sql').includes(`short_code ~ '${QuoteCode.SHORT_CODE_RE.source}'`));

    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID, short_code: CODE }), CODE);
    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID }), QUOTE_ID, 'base sin la migración');
    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID, short_code: null }), QUOTE_ID);
    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID, short_code: 'no-es-un-codigo' }), QUOTE_ID, 'un valor con otro formato no se muestra');
    // Payload de correo: quote_code ya resuelto por el servidor.
    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID, quote_code: CODE }), CODE);
    assert.equal(QuoteCode.visibleCode({ quote_id: QUOTE_ID, quote_code: 'ABCDEF' }), 'ABCDEF');
    assert.equal(QuoteCode.visibleCode({ quote_id: ` ${QUOTE_ID} ` }), QUOTE_ID);
    assert.equal(QuoteCode.visibleCode(null), '');
    assert.equal(QuoteCode.isShortCode('AB23CD'), true);
    for (const bad of ['ab23cd', 'AB23C', 'AB23CDE', 'AB10CD', 'ABICDE', 'ABOCDE', '', null, undefined]) assert.equal(QuoteCode.isShortCode(bad), false, String(bad));
});

test('lectura del código corto: aparte de la principal y sin romper si la columna no existe', async () => {
    const seen = [];
    const fake = (result) => (table) => {
        const q = {
            select(cols) { seen.push(['select', table, cols]); return q; },
            eq(column, value) { seen.push(['eq', column, value]); return q; },
            limit() { return q; }, single() { return q; },
            execute: async () => { if (result instanceof Error) throw result; return result; },
        };
        return q;
    };
    assert.equal(await readShortCode({ id: 2787 }, { query: fake({ short_code: CODE }) }), CODE);
    assert.deepEqual(seen, [['select', 'quotations_db', 'short_code'], ['eq', 'id', 2787]]);
    seen.length = 0;
    assert.equal(await readShortCode({ quote_id: QUOTE_ID }, { query: fake({ short_code: CODE }) }), CODE);
    assert.deepEqual(seen[1], ['eq', 'quote_id', QUOTE_ID]);

    // Ya viene en la fila: no se consulta.
    seen.length = 0;
    assert.equal(await readShortCode({ id: 1, short_code: CODE }, { query: fake(null) }), CODE);
    assert.equal(seen.length, 0);
    // Sin cotización no hay consulta.
    assert.equal(await readShortCode({}, { query: fake({ short_code: CODE }) }), null);
    assert.equal(await readShortCode(null, { query: fake({ short_code: CODE }) }), null);
    assert.equal(seen.length, 0);

    // Migración sin aplicar, fila inexistente o valor con otro formato → null, nunca un error.
    const missing = new Error('PostgREST GET quotations_db failed (400): 42703 column quotations_db.short_code does not exist');
    assert.equal(await readShortCode({ id: 2787 }, { query: fake(missing) }), null);
    assert.equal(await readShortCode({ id: 2787 }, { query: fake(null) }), null);
    assert.equal(await readShortCode({ id: 2787 }, { query: fake({ short_code: 'otro' }) }), null);

    const original = quote();
    const coded = await withShortCode(original, { query: fake({ short_code: CODE }) });
    assert.equal(coded.short_code, CODE);
    assert.equal('short_code' in original, false, 'no modifica la fila que recibió');
    assert.equal(await withShortCode(original, { query: fake(missing) }), original);
    assert.equal(await withShortCode(null, { query: fake(null) }), null);
});

test('repos del servidor: solo negociación lleva short_code en la lectura principal', () => {
    // Negociación ya depende de columnas posteriores (agreement_*): suma short_code sin riesgo.
    assert.ok(require('../lib/repos/negotiation').QUOTE_SELECT.split(',').includes('short_code'));
    // El resto lo pide aparte: sus lecturas principales siguen andando sin la migración.
    assert.ok(!require('../lib/repos/sesiones').QUOTE_COLUMNS.split(',').includes('short_code'));
    assert.ok(!require('../lib/repos/cot-detalle').QUOTE_SELECT.split(',').includes('short_code'));
    assert.doesNotMatch(read('lib/repos/cot-respuesta.js'), /const QUOTE_SELECT = \[[^\]]*'short_code'/);
    for (const repo of ['lib/repos/sesiones.js', 'lib/repos/cot-respuesta.js', 'lib/repos/cot-detalle.js']) {
        assert.match(read(repo), /getShortCode\((?:id|quotationId)\) \{\s*return readShortCode\(/, repo);
    }
});

// ---------------------------------------------------------------- payloads
test('payloads de los correos: quote_code es lo que se muestra; quote_id sigue armando los enlaces', () => {
    const session = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session_number: 1, session_date: '2026-12-01T15:00:00Z', duration_hours: 3, location: 'Estudio Norte - Oroño 500, Rosario' };
    const withCode = Sesiones.emailPayload(quote({ short_code: CODE }), null, session);
    assert.deepEqual([withCode.quote_id, withCode.quote_code], [QUOTE_ID, CODE]);
    assert.equal(Sesiones.emailPayload(quote(), null, session).quote_code, QUOTE_ID, 'sin short_code cae al quote_id');

    const proposal = {
        id: '99999999-9999-4999-8999-999999999999', kind: 'counter', proposed_by: 'client', status: 'pending',
        changes: { artist_budget_amount: { from: '2000', to: '1800' } }, note: '',
    };
    const mail = (row) => Negociacion.emailFor({ step: 'proposed', proposal, quotation: row, artist: null, base: BASE });
    const coded = mail(quote({ short_code: CODE })).payload;
    assert.equal(coded.quote_code, CODE);
    assert.equal(coded.quote_id, QUOTE_ID);
    assert.equal(coded.quotation_url, `${BASE}/my-quotations/detail?quote=${QUOTE_ID}`);
    assert.equal(mail(quote()).payload.quote_code, QUOTE_ID);
});

// ---------------------------------------------------------------- correos
const NEGOTIATION_EVENTS = Object.keys(require('../services/email-events/negociacion'));
const SESSION_EVENTS = Object.keys(require('../services/email-events/sesiones'));

function emailSamples() {
    const session = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session_number: 2, session_date: '2026-12-01T15:00:00Z', duration_hours: 3, location: 'Estudio Norte - Oroño 500, Rosario' };
    const sessionExtra = {
        app_base_url: BASE, requested_by_role: 'client', proposed_date: '2026-12-03T15:00:00Z', change_note: 'Viajo esa semana',
        decision: 'accepted', author_role: 'artist', opened_by_role: 'client', dispute_reason_label: 'Otro motivo', ticket_number: 12,
        queue_url: `${BASE}/support/dashboard`,
    };
    const negotiation = (row) => Object.assign({}, Negociacion.emailFor({
        step: 'proposed', base: BASE, artist: null,
        proposal: { id: '99999999-9999-4999-8999-999999999999', kind: 'counter', proposed_by: 'client', status: 'pending', changes: { artist_budget_amount: { from: '2000', to: '1800' } } },
        quotation: row,
    }).payload, { actor_role: 'client' });
    const list = [];
    for (const id of NEGOTIATION_EVENTS) list.push({ id, payload: negotiation });
    for (const id of SESSION_EVENTS) list.push({ id, payload: (row) => Sesiones.emailPayload(row, null, session, sessionExtra) });
    list.push({
        id: 'artist_updated_quotation_proposal',
        payload: (row) => ({
            quote_id: row.quote_id, quote_code: QuoteCode.visibleCode(row), client_email: row.client_email, client_name: 'Lucía', artist_name: 'Mateo Rivas',
            budget_text: '2.000 USD', sessions_text: '2 sesiones', quotation_url: `${BASE}/client/dashboard?quote=${row.quote_id}`,
        }),
    });
    list.push({
        id: 'shared_quotation_linked',
        payload: (row) => ({ quote_id: row.quote_id, quote_code: QuoteCode.visibleCode(row), artist_email: row.artist_email, artist_name: 'Mateo', client_name: 'Lucía' }),
    });
    return list;
}

test('correos nuevos: muestran el código corto y ninguno deja el quote_id a la vista', () => {
    const samples = emailSamples();
    assert.equal(samples.length, NEGOTIATION_EVENTS.length + SESSION_EVENTS.length + 2);
    for (const { id, payload } of samples) {
        for (const role of ['client', 'artist']) {
            const out = renderEmail(id, payload(quote({ short_code: CODE })), { role });
            const shown = visibleText(out);
            assert.ok(shown.includes(CODE), `${id}/${role}: falta el código corto`);
            // Soporte necesita ubicar la cotización: es el único correo que suma la referencia interna.
            if (id !== 'session_dispute_support') assert.ok(!shown.includes(QUOTE_ID), `${id}/${role}: muestra el quote_id interno`);
            assert.ok(!out.subject.includes(QUOTE_ID), `${id}/${role}: quote_id en el asunto`);
            // El enlace sigue llevando a la cotización por su llave.
            if (/quote=/.test(out.cta.url)) assert.ok(out.cta.url.includes(`quote=${QUOTE_ID}`), `${id}/${role}: ${out.cta.url}`);
        }
    }
});

test('correos nuevos: sin short_code (base sin la migración) siguen mostrando el quote_id', () => {
    for (const { id, payload } of emailSamples()) {
        const out = renderEmail(id, payload(quote()), { role: 'client' });
        assert.ok(visibleText(out).includes(QUOTE_ID), `${id}: sin código tiene que quedar el quote_id`);
    }
    // Payload con la fila de la cotización entera (services/email-request-context.js lee select *).
    const spread = renderEmail('session_confirmation_requested', { ...quote({ short_code: CODE }), session_date: '2026-12-01T15:00:00Z', session_id: 'x' }, { role: 'client' });
    assert.ok(visibleText(spread).includes(CODE));
    assert.ok(!visibleText(spread).includes(QUOTE_ID));
});

test('correos: asuntos con el código y aviso a soporte con la referencia interna', () => {
    const coded = quote({ short_code: CODE });
    const negotiation = emailSamples().find((s) => s.id === 'negotiation_counter_proposed').payload(coded);
    assert.equal(renderEmail('negotiation_counter_proposed', negotiation, { role: 'artist' }).subject, `Lucía propone cambios en la cotización ${CODE}`);
    assert.match(renderEmail('negotiation_counter_accepted', negotiation, { role: 'client' }).subject, new RegExp(` · ${CODE}$`));
    const linked = renderEmail('shared_quotation_linked', { quote_id: QUOTE_ID, quote_code: CODE, artist_email: 'mateo@example.com', client_name: 'Lucía' }, { role: 'artist' });
    assert.equal(linked.subject, `Lucía vinculó la cotización ${CODE} a su cuenta`);
    assert.equal(linked.cta.url, `${BASE}/my-quotations/detail?quote=${QUOTE_ID}`);

    const dispute = Sesiones.emailPayload(coded, null, { id: 's1', session_date: '2026-12-01T15:00:00Z' }, { opened_by_role: 'client', ticket_number: 12, dispute_reason_label: 'Otro motivo' });
    const support = renderEmail('session_dispute_support', dispute, { role: 'admin' });
    assert.match(support.subject, new RegExp(`ticket N\\.º 12 · ${CODE}$`));
    assert.match(support.text, new RegExp(`Referencia interna[\\s\\S]{0,12}${QUOTE_ID}`));
    const plain = renderEmail('session_dispute_support', Sesiones.emailPayload(quote(), null, { id: 's1' }, { opened_by_role: 'client', ticket_number: 12 }), { role: 'admin' });
    assert.doesNotMatch(plain.text, /Referencia interna/, 'sin código corto no se repite el mismo dato');

    // Plantillas externas: reciben los dos datos.
    for (const file of ['negociacion', 'sesiones', 'cot-respuesta', 'cot-detalle']) {
        const events = require(`../services/email-events/${file}`);
        for (const [id, def] of Object.entries(events)) {
            const attribs = def.attribs({ quote_id: QUOTE_ID, short_code: CODE });
            assert.deepEqual([attribs.quote_id, attribs.quote_code], [QUOTE_ID, CODE], `${file}/${id}`);
        }
    }
});

// ---------------------------------------------------------------- hoja compartida
test('hoja compartida: la referencia de la página, el PDF y la imagen es el código corto', () => {
    const logic = require('../lib/cot-detalle');
    const SM = require('../public/shared/js/quote-share-model.js');
    const row = { quote_id: QUOTE_ID, quote_status: 'responded', artist_budget_amount: '500', artist_budget_currency: 'USD' };
    const sheet = logic.buildSheet({ quote: { ...row, short_code: CODE } });
    assert.equal(sheet.short_code, CODE);
    assert.equal(sheet.quote_id, QUOTE_ID, 'el quote_id sigue en la hoja para los enlaces');
    assert.equal(SM.view(sheet, {}).ref, CODE);
    assert.equal(SM.fileName({ quote_id: SM.view(sheet, {}).ref }, 'pdf').includes(CODE), true, 'el archivo se llama como el código que conoce el cliente');

    const legacy = logic.buildSheet({ quote: row });
    assert.equal(legacy.short_code, null);
    assert.equal(SM.view(legacy, {}).ref, QUOTE_ID);
    assert.equal(logic.buildSheet({ quote: { ...row, short_code: '<b>x</b>' } }).short_code, null, 'solo un código con el formato de la base');

    // La ruta lo pide aparte (tolerante) para la hoja y para el aviso de vínculo.
    const routes = read('lib/routes/cot-detalle.js');
    assert.match(routes, /async function withCode\(quote\) \{[\s\S]*?repo\.getShortCode\(quote\.id\)\)\.catch\(\(\) => null\)/);
    assert.match(routes, /logic\.buildSheet\(\{ quote: coded,/);
    assert.match(routes, /quote_code: logic\.visibleCode\(await withCode\(quote\)\)/);
});

// ---------------------------------------------------------------- listado del artista
test('listado del artista: muestra el código corto y lo encuentra el buscador', () => {
    const VM = require('../public/shared/js/quotations-view-model.js');
    assert.equal(VM.shortRef({ id: 7, quote_id: QUOTE_ID, short_code: CODE }), CODE);
    assert.equal(VM.shortRef({ id: 7, quote_id: QUOTE_ID }), QUOTE_ID);
    assert.equal(VM.shortRef({ id: 7, quote_id: QUOTE_ID, short_code: '  ' }), QUOTE_ID);
    assert.equal(VM.shortRef({ id: 123456 }), 'COT-3456');

    const js = read('public/shared/js/quotations.js');
    const search = js.slice(js.indexOf('const searchStr = ['), js.indexOf('const matchesSearch'));
    assert.match(search, /q\.quote_id \|\| q\.id,\s*q\.short_code,/);
    assert.match(search, /\.join\(' '\)\.toLowerCase\(\)/, 'el código se busca sin distinguir mayúsculas');
});

// ---------------------------------------------------------------- /client/chats
function loadQuotationsRepo(run) {
    const window = { location: { pathname: '/client/chats' }, WeotziData: { run, orValue: (v) => `"${v}"` } };
    vm.runInContext(read('public/shared/js/data/quotations-repo.js'), vm.createContext({ window, console, fetch: async () => ({}) }));
    return window.WeotziData.Quotations;
}

// Cliente PostgREST mínimo: registra el select y resuelve como supabase-js.
function chain(log) {
    const q = {
        from() { return q; },
        select(cols) { log.push(cols); return q; },
        or() { return q; }, is() { return q; }, eq() { return q; }, order() { return q; }, maybeSingle() { return q; },
    };
    return q;
}

test('/client/chats: las cotizaciones del chat traen short_code (buscador y encabezado)', async () => {
    const selects = [];
    const Quotations = loadQuotationsRepo(async (label, build) => { build(chain(selects)); return { data: [{ quote_id: QUOTE_ID, short_code: CODE }] }; });
    assert.ok(Quotations.CHAT_COLUMNS.split(',').map((c) => c.trim()).includes('short_code'));
    for (const banned of ['client_health_conditions', 'client_allergies', 'client_email', 'client_whatsapp']) assert.ok(!Quotations.CHAT_COLUMNS.includes(banned), banned);

    const rows = await Quotations.listForClient(CLIENT, 'lucia@example.com', Quotations.CHAT_COLUMNS);
    assert.equal(rows[0].short_code, CODE);
    assert.equal(selects.length, 1, 'con la columna en la base hay una sola lectura');
    assert.match(selects[0], /\bshort_code\b/);

    const chats = read('public/shared/js/client-chats.js');
    assert.match(chats, /D\.Quotations\.listForClient\(uid, userEmail, statusColumns\(D\.Quotations\.CHAT_COLUMNS\)\)/);
    assert.match(chats, /P\.hasShortCode\(t\)\) meta\.push\('Código ' \+ P\.shortCode\(t\)\)/);
    const P = require('../public/shared/js/client-panel-model.js');
    assert.equal(P.hasShortCode({ quote_id: QUOTE_ID, short_code: CODE }), true);
});

test('/client/chats: sin la columna en la base, la lectura se repite sin short_code y la lista no se pierde', async () => {
    const selects = [];
    const missing = () => Object.assign(new Error('[quotations.listForClient] column quotations_db.short_code does not exist'), { code: '42703' });
    const Quotations = loadQuotationsRepo(async (label, build) => {
        build(chain(selects));
        if (/\bshort_code\b/.test(selects[selects.length - 1])) throw missing();
        return { data: /listForClient/.test(label) ? [{ quote_id: QUOTE_ID }] : { quote_id: QUOTE_ID } };
    });
    const rows = await Quotations.listForClient(CLIENT, 'lucia@example.com', `${Quotations.CHAT_COLUMNS}, quote_expires_at, dispute_status`);
    assert.deepEqual(rows, [{ quote_id: QUOTE_ID }]);
    assert.equal(selects.length, 2);
    assert.doesNotMatch(selects[1], /short_code/);
    assert.match(selects[1], /^id, quote_id, artist_id,[\s\S]*quote_expires_at, dispute_status$/, 'el resto de las columnas no cambia');

    // Los enlaces profundos (?quote=) de los dos paneles usan la misma tolerancia.
    selects.length = 0;
    assert.deepEqual(await Quotations.getForClientByQuoteId(QUOTE_ID), { quote_id: QUOTE_ID });
    assert.deepEqual(await Quotations.getForArtistByQuoteId(QUOTE_ID), { quote_id: QUOTE_ID });
    assert.equal(selects.length, 4);

    // Otro error (o un select que no pide el código) no se reintenta ni se tapa.
    const other = loadQuotationsRepo(async () => { throw Object.assign(new Error('permission denied for table quotations_db'), { code: '42501' }); });
    await assert.rejects(() => other.listForClient(CLIENT, 'lucia@example.com', other.CHAT_COLUMNS), /permission denied/);
    let attempts = 0;
    const star = loadQuotationsRepo(async () => { attempts += 1; throw missing(); });
    await assert.rejects(() => star.listForClient(CLIENT, 'lucia@example.com'), /short_code/);
    assert.equal(attempts, 1, "con select '*' no hay nada que quitar");
});

// ---------------------------------------------------------------- caché
test('las páginas piden la versión nueva de los scripts que cambiaron', () => {
    const pages = {
        'public/cotizacion/index.html': ['quote-share-model.js'],
        'public/my-quotations/detail/index.html': ['quote-share-model.js', 'quotations-view-model.js'],
        'public/my-quotations/index.html': ['quote-share-model.js', 'quotations-view-model.js', 'quotations.js'],
        'public/my-quotations/new/index.html': ['quote-share-model.js', 'quotations-view-model.js', 'quotations.js'],
    };
    // Flash Tattoos (17 nov 2026): quotations.js cambió otra vez (insignia "Flash").
    const versionOf = (script) => (script === 'quotations.js' ? '20261117-flash' : '20261116-r2b');
    for (const [page, scripts] of Object.entries(pages)) {
        const html = read(page);
        for (const script of scripts) assert.ok(html.includes(`/shared/js/${script}?v=${versionOf(script)}"`), `${page}: ${script}`);
    }
});
