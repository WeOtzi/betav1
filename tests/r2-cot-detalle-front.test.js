'use strict';

// Ronda 2 · frente cot-detalle (front): ficha del cliente [N10], contacto
// según verificación [P20/P23], referencias con comentario [P13], perfil del
// cliente [P6], hoja compartible / PDF / imagen y página pública [P30], y el
// hook de denuncias. Modelos puros por require, módulos de navegador en un
// contexto vm con un DOM mínimo y contratos de HTML/CSS por lectura.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const DM = require('../public/shared/js/quotation-detail-model.js');
const SM = require('../public/shared/js/quote-share-model.js');
const logic = require('../lib/cot-detalle');

const TOKEN = 'A'.repeat(43);
const STORAGE = 'https://demo.supabase.test/storage/v1/object/public/quotation-references/COT-1/';

// ------------------------------------------------------------ ficha del cliente [N10]

test('ficha del cliente: edad, menor de edad, cover up, primer tatuaje, salud y alergias', () => {
    const now = new Date('2026-11-16T12:00:00');
    assert.equal(DM.ageFromBirthDate('2000-11-16', now), 26);
    assert.equal(DM.ageFromBirthDate('2000-11-17', now), 25, 'todavía no cumplió');
    assert.equal(DM.ageFromBirthDate('no-fecha', now), null);
    assert.equal(DM.ageFromBirthDate('2090-01-01', now), null);
    assert.deepEqual(DM.clientAge({ client_birth_date: '2010-05-01', client_age: '40' }, now), { years: 16, minor: true }, 'manda la fecha de nacimiento');
    assert.deepEqual(DM.clientAge({ client_age: '17' }, now), { years: 17, minor: true });
    assert.deepEqual(DM.clientAge({ client_age: '18' }, now), { years: 18, minor: false });
    assert.deepEqual(DM.clientAge({}, now), { years: null, minor: false });

    const facts = DM.clientFacts({
        client_birth_date: '2010-05-01', tattoo_is_cover_up: true, tattoo_is_first_tattoo: false,
        client_health_conditions: '  Diabetes tipo 1 ', client_allergies: 'Ninguna'
    }, now);
    const by = Object.fromEntries(facts.map((f) => [f.key, f]));
    assert.deepEqual(Object.keys(by), ['age', 'cover_up', 'first_tattoo', 'health', 'allergies']);
    assert.equal(by.age.value, '16 años');
    assert.equal(by.age.alert, true);
    assert.equal(by.age.tag, 'Menor de edad');
    assert.equal(by.cover_up.value, 'Sí');
    assert.equal(by.cover_up.alert, false);
    assert.equal(by.cover_up.highlight, true, 'el cover up se destaca sin ser una alerta');
    assert.equal(by.first_tattoo.value, 'No');
    assert.equal(by.health.value, 'Diabetes tipo 1');
    assert.equal(by.health.alert, true);
    assert.equal(by.allergies.value, 'Ninguna');
    assert.equal(by.allergies.alert, false, '"ninguna" no es una alerta');

    const empty = Object.fromEntries(DM.clientFacts({}, now).map((f) => [f.key, f.value]));
    assert.deepEqual(empty, { age: 'Sin indicar', cover_up: 'Sin indicar', first_tattoo: 'Sin indicar', health: 'Sin indicar', allergies: 'Sin indicar' });
    assert.equal(DM.isManualQuote({ source: 'manual' }), true);
    assert.equal(DM.isManualQuote({ quotation_medium: 'manual' }), true);
    assert.equal(DM.isManualQuote({ source: 'web_chat' }), false);
});

test('contacto: filas con enlace seguro y preferencia en cualquiera de sus formatos', () => {
    assert.equal(DM.contactPreferenceLabel('Whatsapp, Instagram, Email, Cualquiera'), 'WhatsApp · Instagram · Email · Cualquiera');
    assert.equal(DM.contactPreferenceLabel('["WhatsApp","Email"]'), 'WhatsApp · Email');
    assert.equal(DM.contactPreferenceLabel(['email', 'Email']), 'Email');
    assert.equal(DM.contactPreferenceLabel(null), '');
    const rows = DM.contactRows({ email: 'lucia@example.com', whatsapp: '+57 300 111 2233', instagram: 'https://instagram.com/lucia.f/', preference: 'Whatsapp' });
    assert.deepEqual(rows, [
        { key: 'email', label: 'Email', value: 'lucia@example.com', href: 'mailto:lucia@example.com' },
        { key: 'whatsapp', label: 'WhatsApp', value: '+57 300 111 2233', href: 'https://wa.me/573001112233' },
        { key: 'instagram', label: 'Instagram', value: '@lucia.f', href: 'https://www.instagram.com/lucia.f/' },
        { key: 'preference', label: 'Prefiere que le escriban por', value: 'WhatsApp', href: '' }
    ]);
    // Datos raros: se muestran como texto, sin enlace.
    const odd = DM.contactRows({ email: 'javascript:alert(1)', whatsapp: 'llamar', instagram: 'mi perfil <b>' });
    assert.ok(odd.every((row) => row.href === ''));
    assert.deepEqual(DM.contactRows({}), []);
});

// ------------------------------------------------------------ referencias [P13]

test('referencias: cada imagen con SU comentario (notas por posición, formato de hoy)', () => {
    const quote = { reference_images: [STORAGE + 'ref_1_1731600000000.jpg', STORAGE + 'ref_2_1731600000001.png'] };
    // Adjuntos desordenados y duplicando las URLs de reference_images.
    const attachments = [
        { google_drive_url: STORAGE + 'ref_2_1731600000001.png', file_name: 'ref_2_1731600000001.png', sort_order: 2, attachment_type: 'reference' },
        { google_drive_url: STORAGE + 'ref_1_1731600000000.jpg', file_name: 'ref_1_1731600000000.jpg', sort_order: 1, attachment_type: 'reference' }
    ];
    const items = DM.referenceItems(quote, attachments, { reference_notes: ['Me gusta el trazo', ''] });
    assert.deepEqual(items, [
        { url: STORAGE + 'ref_1_1731600000000.jpg', name: 'Referencia 1', note: 'Me gusta el trazo', ai: false, index: 0 },
        { url: STORAGE + 'ref_2_1731600000001.png', name: 'Referencia 2', note: '', ai: false, index: 1 }
    ]);
    // Solo reference_images (sin adjuntos) y sin extras.
    assert.deepEqual(DM.referenceItems(quote, [], null).map((r) => [r.name, r.note]), [['Referencia 1', ''], ['Referencia 2', '']]);
    assert.deepEqual(DM.referenceItems({}, null, null), []);
});

test('referencias: notas como objetos (por archivo o posición) y marca de IA', () => {
    const quote = { reference_images: [STORAGE + 'ref_1_1731600000000.jpg', STORAGE + 'ref_2_1731600000001.png', STORAGE + 'ref_3_1731600000002.webp'] };
    const extras = { reference_notes: [
        { path: 'COT-1/ref_2_1731600000001.png', comment: 'La generé para mostrar la idea', ai: true },
        { index: 0, note: 'Foto mía' },
        { file_name: 'ref_3_1731600000002.webp', text: 'Colores así', source: 'upload' }
    ] };
    const items = DM.referenceItems(quote, [], extras);
    assert.deepEqual(items.map((r) => [r.note, r.ai]), [['Foto mía', false], ['La generé para mostrar la idea', true], ['Colores así', false]]);

    // La marca también puede venir en el adjunto o en la propia imagen.
    const mixed = DM.referenceItems(
        { reference_images: [{ url: 'https://cdn.example/a.jpg', note: 'nota propia', origin: 'ai_generated' }] },
        [
            { google_drive_url: 'https://drive.google.com/file/d/AAA/view', file_name: 'boceto.jpg' },
            { google_drive_url: 'https://drive.google.com/file/d/BBB/view', file_name: 'idea.jpg', attachment_type: 'ai_reference', caption: 'solo para orientar' }
        ], null);
    assert.deepEqual(mixed.map((r) => [r.name, r.note, r.ai]), [
        ['boceto.jpg', '', false],
        ['idea.jpg', 'solo para orientar', true],
        ['Referencia 3', 'nota propia', true]
    ], 'dos enlaces de Drive distintos no se confunden entre sí');
    for (const yes of [{ ai: true }, { is_ai: 'true' }, { ai_generated: 1 }, { source: 'IA' }, { kind: 'generated' }, { origin: 'gemini' }, { attachment_type: 'reference_ai' }]) {
        assert.equal(DM.isAiReference(yes), true, JSON.stringify(yes));
    }
    for (const no of [null, {}, { source: 'upload' }, { attachment_type: 'reference' }, { type: 'image/jpeg' }, { kind: 'detail' }, { ai: false }]) {
        assert.equal(DM.isAiReference(no), false, JSON.stringify(no));
    }
});

// ------------------------------------------------------------ hoja compartible [P30]

function sampleSheet(overrides = {}) {
    const quote = {
        id: 7, quote_id: 'COT-MAN001', quote_status: 'responded', source: 'manual', quotation_medium: 'manual',
        created_at: '2026-11-10T10:00:00Z', artist_responded_at: '2026-11-12T15:00:00', artist_id: 'a', artist_name: 'Mateo Rivas',
        artist_username: 'mateoink.wo', client_full_name: 'Lucía Fernández', project_description: 'Manga japonesa',
        tattoo_idea_description: 'Dragón y olas.\nCon mucho negro.', tattoo_style: { style_name: 'Japonés' }, tattoo_body_part: 'Brazo',
        tattoo_size: '30 cm', tattoo_is_cover_up: true, tattoo_estimated_sessions: '3', artist_budget_amount: '900', artist_budget_currency: 'USD',
        quote_expiry_enabled: true, quote_expires_at: '2026-11-26T12:00:00', quote_expiry_days: 14,
        client_health_conditions: 'SECRETO', client_email: 'secreto@example.com'
    };
    const manual = {
        project: { session_hours: 4, location: 'Estudio Norte' },
        line_items: [{ name: 'Diseño', description: 'Boceto', qty: 1, price: 100, total: 100 }, { name: 'Sesión', qty: 3, price: 300, total: 900 }],
        currency: 'USD', discount_pct: 10, tax_pct: 0, deposit_pct: 30, subtotal: 1000, total: 900, deposit_amount: 270,
        validity_days: 14, cancellation_policy: 'reembolsable-72', client_notes: 'Trae ropa cómoda.', extra_terms: 'Retoque incluido.'
    };
    return logic.buildSheet({ quote: { ...quote, ...overrides }, manual, artist: { name: 'Mateo Rivas', username: 'mateoink.wo', verification_state: 'Yes', city: 'Bogotá' }, sessions: [], base: 'https://beta.weotzi.com', now: Date.parse('2026-11-16T12:00:00Z') });
}

test('hoja: formatos en español neutro (montos, fechas, duración, políticas)', () => {
    assert.equal(SM.money(410000, 'cop'), '410.000 COP');
    assert.equal(SM.money(1240.5, 'EUR'), '1.240,50 EUR');
    assert.equal(SM.money(0, 'USD'), '0 USD');
    assert.equal(SM.money(null, 'USD'), 'A definir');
    assert.equal(SM.money('abc', 'USD'), 'A definir');
    assert.equal(SM.dateLong('2026-11-26T12:00:00'), '26 de noviembre de 2026');
    assert.equal(SM.dateLong('nope'), '');
    assert.equal(SM.durationText(150), '2 h 30 min');
    assert.equal(SM.durationText(45), '45 min');
    assert.equal(SM.durationText(0), '');
    assert.equal(SM.sessionsText(1), '1 sesión');
    assert.equal(SM.sessionsText(3), '3 sesiones');
    assert.equal(SM.percent(12.5), '12,5 %');
    for (const sentence of Object.values(SM.POLICY_TEXT)) {
        assert.doesNotMatch(sentence, /cancelás|podés|querés/i, 'sin voseo');
    }
    assert.equal(SM.policyText('sin-sena'), 'No se pide anticipo. Puedes cancelar sin costo.');
    assert.equal(SM.policyText('desconocida'), '');
    assert.equal(SM.fileName({ quote_id: 'COT-AB12' }, 'png'), 'cotizacion-COT-AB12.png');
    assert.equal(SM.fileName({ quote_id: '../../x y' }, 'pdf'), 'cotizacion-x-y.pdf');
    assert.equal(SM.fileName(null, 'png'), 'cotizacion-weotzi.png');
});

test('hoja: la vista arma propuesta, desglose, términos y artista en texto plano', () => {
    const view = SM.view(sampleSheet(), { url: 'https://beta.weotzi.com/cotizacion/' + TOKEN });
    assert.equal(view.ref, 'COT-MAN001');
    assert.equal(view.statusLabel, 'Propuesta enviada');
    assert.equal(view.statusTone, 'open');
    assert.equal(view.byline, 'Cotización de Mateo Rivas · We Ötzi');
    assert.equal(view.title, 'Manga japonesa');
    assert.equal(view.clientLine, 'Para Lucía Fernández');
    assert.equal(view.dateLine, 'Emitida el 12 de noviembre de 2026');
    assert.equal(view.idea, 'Dragón y olas.\nCon mucho negro.');
    assert.deepEqual(view.chips, ['Japonés', 'Brazo', '30 cm', 'Cover up']);
    assert.equal(view.totalLabel, 'Presupuesto');
    assert.equal(view.total, '900 USD');
    assert.deepEqual(view.proposalRows, [
        ['Sesiones', '3 sesiones'], ['Duración por sesión', '4 h'], ['Anticipo para reservar', '270 USD · 30 %'],
        ['Saldo', '630 USD'], ['Lugar', 'Estudio Norte']
    ]);
    assert.deepEqual(view.items, [
        { name: 'Diseño', description: 'Boceto', qtyLine: '1 × 100 USD', total: '100 USD' },
        { name: 'Sesión', description: '', qtyLine: '3 × 300 USD', total: '900 USD' }
    ]);
    assert.deepEqual(view.totals, [['Subtotal', '1.000 USD'], ['Descuento 10 %', '- 100 USD'], ['Total', '900 USD']]);
    assert.deepEqual(view.terms, ['Propuesta válida hasta el 26 de noviembre de 2026.', 'El anticipo se devuelve si cancelas con 72 h de aviso.']);
    assert.equal(view.extraTerms, 'Retoque incluido.');
    assert.equal(view.clientNotes, 'Trae ropa cómoda.');
    assert.deepEqual(view.artist, { name: 'Mateo Rivas', line: 'Bogotá', verified: true, profileUrl: 'https://beta.weotzi.com/mateoink', photoUrl: '', handle: '@mateoink.wo' });
    assert.equal(view.urlText, 'beta.weotzi.com/cotizacion/' + TOKEN);
    assert.doesNotMatch(JSON.stringify(view), /SECRETO|secreto@example\.com/);

    // Sin propuesta todavía.
    const pending = SM.view(logic.buildSheet({ quote: { quote_id: 'COT-1', quote_status: 'pending', client_full_name: 'Ana' } }), {});
    assert.equal(pending.total, 'A definir');
    assert.equal(pending.pendingCopy, 'El artista todavía no envió su propuesta.');
    assert.deepEqual(pending.proposalRows, []);
    assert.equal(pending.url, '');
    // Con propuesta y sin anticipo se dice explícitamente.
    const noDeposit = SM.view(logic.buildSheet({ quote: { quote_id: 'COT-2', quote_status: 'responded', artist_budget_amount: '500', artist_budget_currency: 'USD' } }), {});
    assert.deepEqual(noDeposit.proposalRows, [['Anticipo para reservar', 'Sin anticipo']]);
    // Estado cerrado.
    assert.equal(SM.view(logic.buildSheet({ quote: { quote_id: 'COT-3', quote_status: 'expired' } }), {}).statusTone, 'closed');
    assert.equal(SM.view({}, {}).title, 'Cotización de tatuaje');
});

test('hoja: token de la ruta (con y sin /beta) y ajuste de texto para el canvas', () => {
    assert.equal(SM.tokenFromPath('/cotizacion/' + TOKEN), TOKEN);
    assert.equal(SM.tokenFromPath('/beta/cotizacion/' + TOKEN + '/'), TOKEN);
    assert.equal(SM.tokenFromPath('/cotizacion/corto'), '');
    assert.equal(SM.tokenFromPath('/cotizacion/'), '');
    assert.equal(SM.tokenFromPath('/otra/' + TOKEN), '');
    assert.equal(SM.sharePath(TOKEN), '/cotizacion/' + TOKEN);
    assert.equal(SM.isValidToken(logic.newShareToken()), true, 'mismo formato que el servidor');
    assert.equal(logic.SHARE_PATH, SM.SHARE_PATH);

    const measure = (text) => text.length * 10;
    assert.deepEqual(SM.wrapText(measure, 'uno dos tres cuatro', 80), ['uno dos', 'tres', 'cuatro']);
    assert.deepEqual(SM.wrapText(measure, 'a\n\nb', 100), ['a', '', 'b']);
    assert.deepEqual(SM.wrapText(measure, 'abcdefghijkl', 50), ['abcde', 'fghij', 'kl'], 'corta palabras larguísimas');
    const clamped = SM.wrapText(measure, 'uno dos tres cuatro cinco seis', 80, 2);
    assert.equal(clamped.length, 2);
    assert.match(clamped[1], /…$/);
    assert.ok(clamped.every((line) => measure(line) <= 80));
    assert.deepEqual(SM.wrapText(measure, '', 80), []);
    assert.deepEqual(SM.wrapText(measure, null, 80), []);
});

// ------------------------------------------------------------ módulos de navegador (vm)

function loadSheetModule({ withQr = false } = {}) {
    const window = { location: { origin: 'https://beta.weotzi.com', pathname: '/cotizacion/' + TOKEN }, WoQuoteShareModel: SM };
    const context = { window, document: {}, URL, console };
    if (withQr) {
        vm.runInNewContext(read('public/shared/js/qrcode-generator.js') + '\n;window.qrcode = qrcode;', context);
    }
    vm.runInNewContext(read('public/shared/js/quote-share-sheet.js'), context);
    return window.WoQuoteSheet;
}

test('hoja HTML: escapa todo dato y solo enlaza URLs http(s)', () => {
    const Sheet = loadSheetModule();
    const sheet = sampleSheet({ client_full_name: '<img src=x onerror=alert(1)>', project_description: '"><script>alert(2)</script>', tattoo_idea_description: '<b>hola</b>' });
    sheet.artist.name = '<svg onload=alert(3)>';
    sheet.artist.profile_url = 'javascript:alert(4)';
    sheet.artist.photo_url = 'data:text/html,x';
    sheet.breakdown.items[0].name = '<i>concepto</i>';
    const html = Sheet.html(SM.view(sheet, { url: 'javascript:alert(5)' }));
    assert.doesNotMatch(html, /<img src=x|<script>|<b>hola|<svg onload|<i>concepto/);
    assert.doesNotMatch(html, /javascript:|data:text/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /class="wqs-sheet"/);
    assert.match(html, /Desglose/);
    assert.match(html, /Términos/);
    assert.match(html, /Notas del artista/);
    assert.doesNotMatch(html, /class="wqs-link"/, 'sin URL válida no hay bloque de enlace');
    assert.doesNotMatch(html, /Ver perfil del artista/);

    const ok = Sheet.html(SM.view(sampleSheet(), { url: 'https://beta.weotzi.com/cotizacion/' + TOKEN }));
    assert.match(ok, new RegExp('<a href="https://beta\\.weotzi\\.com/cotizacion/' + TOKEN + '">beta\\.weotzi\\.com/cotizacion/' + TOKEN + '</a>'));
    assert.match(ok, /<a href="https:\/\/beta\.weotzi\.com\/mateoink">Ver perfil del artista<\/a>/);
    assert.match(ok, /Perfil verificado/);
    assert.equal(Sheet.qrSvg('https://beta.weotzi.com/x'), '', 'sin generador de QR no rompe');
    // Sin enlace, sin perfil y sin foto: no se inventan enlaces al propio sitio.
    const bare = sampleSheet();
    bare.artist.profile_url = '';
    bare.artist.photo_url = null;
    const plain = Sheet.html(SM.view(bare, { url: '' }));
    assert.doesNotMatch(plain, /class="wqs-link"|Ver perfil del artista|<img /);
    assert.match(plain, /wqs-artist-photo--initials/);
    assert.equal(Sheet.safeUrl(''), '');
    assert.equal(Sheet.safeUrl('   '), '');
});

test('hoja HTML: con qrcode-generator.js incluye el código QR del enlace', () => {
    const Sheet = loadSheetModule({ withQr: true });
    const url = 'https://beta.weotzi.com/cotizacion/' + TOKEN;
    const matrix = Sheet.qrMatrix(url);
    assert.ok(Array.isArray(matrix) && matrix.length >= 21 && matrix.every((row) => row.length === matrix.length));
    const html = Sheet.html(SM.view(sampleSheet(), { url }));
    assert.match(html, /<svg class="wqs-qr-code"[^>]*role="img" aria-label="Código QR del enlace de la cotización"/);
    assert.equal(Sheet.qrMatrix(''), null);
});

test('imagen PNG: el canvas se dibuja completo (1080 px), con total, artista, enlace y QR', async () => {
    const drawn = { text: [], rects: 0, maxY: 0 };
    function fakeContext() {
        return {
            font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
            measureText(text) { const size = Number((/(\d+)px/.exec(this.font) || [0, 20])[1]); return { width: String(text).length * size * 0.55 }; },
            fillText(text, x, y) { drawn.text.push(String(text)); drawn.maxY = Math.max(drawn.maxY, y); },
            fillRect(x, y, w, h) { drawn.rects += 1; drawn.maxY = Math.max(drawn.maxY, y + h); },
            beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, closePath() {}
        };
    }
    const canvases = [];
    const window = {
        location: { origin: 'https://beta.weotzi.com', pathname: '/cotizacion/' + TOKEN },
        WoQuoteShareModel: SM,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        setTimeout, clearTimeout
    };
    const document = {
        documentElement: {},
        createElement: (tag) => {
            assert.equal(tag, 'canvas');
            const canvas = { width: 0, height: 0, getContext: () => fakeContext() };
            canvases.push(canvas);
            return canvas;
        }
    };
    const context = { window, document, URL, console };
    vm.runInNewContext(read('public/shared/js/qrcode-generator.js') + '\n;window.qrcode = qrcode;', context);
    vm.runInNewContext(read('public/shared/js/quote-share-sheet.js'), context);

    const url = 'https://beta.weotzi.com/cotizacion/' + TOKEN;
    const long = sampleSheet({ tattoo_idea_description: 'Una idea muy larga que ocupa varias líneas. '.repeat(40), project_description: 'Título larguísimo '.repeat(12) });
    const canvas = await window.WoQuoteSheet.renderCanvas(SM.view(long, { url }));
    assert.equal(canvas.width, 1080);
    assert.ok(canvas.height > 1200 && canvas.height < 16000, `alto ${canvas.height}`);
    assert.ok(drawn.maxY <= canvas.height, 'nada se dibuja fuera del lienzo');
    const text = drawn.text.join('\n');
    for (const piece of ['WE ÖTZI', 'COT-MAN001', '900 USD', 'Mateo Rivas', 'PERFIL VERIFICADO', 'LA IDEA', 'DESGLOSE', 'TÉRMINOS', 'NOTAS DEL ARTISTA']) {
        assert.ok(text.includes(piece), piece);
    }
    assert.ok(text.replace(/\n/g, '').includes('beta.weotzi.com/cotizacion/'), 'incluye el enlace');
    assert.ok(drawn.rects > 400, 'dibuja los módulos del QR');
    assert.doesNotMatch(text, /SECRETO|secreto@example\.com|undefined|null|NaN/);
    assert.ok(drawn.text.filter((line) => line.startsWith('Una idea muy larga')).length <= 7, 'la idea se recorta a 7 líneas');

    // Sin enlace ni propuesta también se dibuja.
    const bare = await window.WoQuoteSheet.renderCanvas(SM.view(logic.buildSheet({ quote: { quote_id: 'COT-9', quote_status: 'pending' } }), {}));
    assert.ok(bare.height > 500);
});

test('PDF: imprime solo la hoja y limpia al terminar', async () => {
    const state = { classes: new Set(), printed: 0, listeners: {}, host: null, title: 'WE ÖTZI | Detalle' };
    const window = {
        location: { origin: 'https://beta.weotzi.com', pathname: '/my-quotations/detail' },
        WoQuoteShareModel: SM,
        addEventListener(type, fn) { state.listeners[type] = fn; },
        removeEventListener(type) { delete state.listeners[type]; },
        setTimeout: () => 0, clearTimeout() {},
        print() {
            state.printed += 1;
            state.duringPrint = { hasClass: state.classes.has('wo-quote-printing'), html: state.host.innerHTML, title: document.title };
            if (state.listeners.afterprint) state.listeners.afterprint();
        }
    };
    const document = {
        get title() { return state.title; },
        set title(value) { state.title = value; },
        documentElement: { classList: { add: (c) => state.classes.add(c), remove: (c) => state.classes.delete(c) } },
        getElementById: (id) => (state.host && state.host.id === id ? state.host : null),
        createElement: () => ({ id: '', innerHTML: '', setAttribute() {}, querySelectorAll: () => [] }),
        body: { appendChild(node) { state.host = node; } }
    };
    vm.runInNewContext(read('public/shared/js/quote-share-sheet.js'), { window, document, URL, console });
    await window.WoQuoteSheet.print(SM.view(sampleSheet(), {}));
    assert.equal(state.printed, 1);
    assert.equal(state.host.id, 'wo-quote-print');
    assert.equal(state.duringPrint.hasClass, true);
    assert.match(state.duringPrint.html, /class="wqs-sheet"/);
    assert.equal(state.duringPrint.title, 'cotizacion-COT-MAN001', 'nombre sugerido del PDF');
    assert.equal(state.classes.has('wo-quote-printing'), false, 'se limpia al terminar');
    assert.equal(state.host.innerHTML, '');
    assert.equal(state.title, 'WE ÖTZI | Detalle');
});

function fakeElement() {
    return { innerHTML: '', hidden: true, textContent: '', classList: { toggle() {} } };
}

function loadInfoModule({ info, infoError, preview = false, shareModule = true, sameContact, sameContactError } = {}) {
    const listeners = {};
    const elements = { 'qd-identity-actions': fakeElement(), 'qd-client-info-slot': fakeElement(), 'qd-toast': fakeElement() };
    const calls = { info: 0, sameContact: [] };
    const window = {
        QuotationDetailModel: DM,
        WoQuoteShareModel: SM,
        location: { pathname: '/my-quotations/detail', origin: 'https://beta.weotzi.com' },
        setTimeout: () => 0, clearTimeout() {},
        WeotziData: { QuotationInfo: { info: async () => { calls.info += 1; if (infoError) throw infoError; return info; } } }
    };
    if (sameContact !== undefined || sameContactError) {
        window.WeotziData.Quotations = { listSameContact: async (quoteId) => { calls.sameContact.push(quoteId); if (sameContactError) throw sameContactError; return sameContact; } };
    }
    if (preview) window.WEOTZI_PREVIEW = true;
    if (shareModule) window.WoQuoteShare = { linksStatus: (links) => (links && links.length ? `${links.length} enlace(s)` : 'Todavía no hay un enlace activo.') };
    const document = {
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        getElementById: (id) => elements[id] || null,
        querySelector: () => null
    };
    vm.runInNewContext(read('public/shared/js/quotation-detail-info.js'), { window, document, URL, console });
    async function fire(detail) {
        listeners['wo:quotation-detail-rendered'].forEach((fn) => fn({ detail }));
        for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
        return elements;
    }
    return { fire, elements, calls, window };
}

const ROW = {
    id: 77, quote_id: 'COT-AB12CD', quote_status: 'pending', source: 'web_chat', client_user_id: null,
    client_full_name: 'Lucía <script>alert(1)</script>', client_email: 'fila@example.com', client_whatsapp: '+57 300 999 0000',
    client_instagram: '@fila.ig', client_contact_preference: 'Email', client_birth_date: '2010-05-01',
    client_health_conditions: '<img src=x onerror=alert(2)>', client_allergies: 'Látex', tattoo_is_cover_up: true
};

test('detalle: sin verificación el contacto NO sale de la fila; aviso y CTA a verificarse', async () => {
    const info = { contact: { visible: false, reason: 'not_verified', verification_state: 'No', email: null, whatsapp: null, instagram: null, preference: null }, client: { registered: false }, share: { available: true, shareable: true, links: [] } };
    const mod = loadInfoModule({ info });
    const els = await mod.fire({ quote: ROW, stage: 'pending', readOnly: false, user: { id: 'a' } });
    const html = els['qd-client-info-slot'].innerHTML;
    assert.equal(mod.calls.info, 1, 'pide el contacto al servidor');
    assert.match(html, /Verifica tu perfil para ver el contacto/);
    assert.match(html, /href="\/artist\/account#verificacion"[^>]*>Verificar mi perfil</);
    assert.doesNotMatch(html, /fila@example\.com|300 999 0000|fila\.ig/, 'no se lee el contacto de la fila');
    // Salud, edad, cover up y "menor de edad": siempre visibles para el artista.
    assert.match(html, /Datos del cliente/);
    assert.match(html, /16 años/);
    assert.match(html, /Menor de edad/);
    assert.match(html, /autorización de su madre, padre o tutor/);
    assert.match(html, /Cover up/);
    assert.match(html, /Látex/);
    // Escape de datos del usuario.
    assert.doesNotMatch(html, /<img src=x|<script>alert/);
    assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
    // Acciones de compartir/exportar y hook de denuncias.
    assert.match(html, /data-qdi="copy"[^>]*>Copiar enlace</);
    assert.match(html, /data-qdi="pdf"[^>]*>Descargar PDF</);
    assert.match(html, /data-qdi="image"[^>]*>Descargar imagen</);
    const report = /<button class="[^"]*qdi-report[^"]*" type="button" data-wo-report data-kind="quotation" data-id="COT-AB12CD" data-label="([^"]*)">Denunciar<\/button>/.exec(html);
    assert.ok(report, 'botón de denuncia con el contrato del frente denuncias');
    assert.doesNotMatch(report[1], /<script>/);
    // CF-09: con wo-report.js en la página el botón nace oculto (el módulo lo muestra cuando el
    // servidor confirma); sin el módulo queda a la vista para poder cargarlo al tocarlo.
    const withModule = loadInfoModule({ info });
    withModule.window.WoReport = {};
    const htmlWithModule = (await withModule.fire({ quote: ROW, stage: 'pending', readOnly: false, user: { id: 'a' } }))['qd-client-info-slot'].innerHTML;
    assert.match(htmlWithModule, /class="[^"]*qdi-report[^"]*" type="button" data-wo-report data-kind="quotation" data-id="COT-AB12CD" data-label="[^"]*" hidden>Denunciar</);
    assert.match(read('public/my-quotations/detail/index.html'), /<script src="\/shared\/js\/wo-report\.js\?v=[^"]+" defer><\/script>/, 'la página del expediente carga el módulo');
    assert.match(els['qd-identity-actions'].innerHTML, /Cliente sin cuenta/);

    // En revisión: otro mensaje.
    const requested = loadInfoModule({ info: { ...info, contact: { ...info.contact, verification_state: 'Requested' } } });
    const html2 = (await requested.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.match(html2, /Tu verificación está en revisión/);

    // REQ-11: el cliente de ROW no tiene cuenta, así que no hay chat al que mandarlo.
    const GUEST = /Este cliente todavía no tiene cuenta: tu propuesta le llega por correo y el chat se habilita cuando la cree\./;
    const CHAT = /Mientras tanto, escríbele por el chat de la cotización\./;
    for (const guestHtml of [html, html2]) {
        assert.match(guestHtml, GUEST);
        assert.doesNotMatch(guestHtml, CHAT, 'sin cuenta no se lo manda a un chat que no existe');
    }
    // Con cuenta el chat existe: queda el texto de siempre, en las dos variantes.
    for (const state of ['No', 'Requested']) {
        const withAccount = loadInfoModule({ info: { ...info, contact: { ...info.contact, verification_state: state }, client: { registered: true } } });
        const accountHtml = (await withAccount.fire({ quote: { ...ROW, client_user_id: 'c-1' }, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
        assert.match(accountHtml, CHAT, state);
        assert.doesNotMatch(accountHtml, GUEST, state);
    }
    // Una respuesta sin el dato (servidor anterior) conserva el texto de siempre.
    const legacy = loadInfoModule({ info: { ...info, client: undefined } });
    assert.match((await legacy.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML, CHAT);
    assert.match(read('public/my-quotations/detail/index.html'), /\/shared\/js\/quotation-detail-info\.js\?v=20261116-r2b"/);
    assert.match(html2, /Ver estado de la verificación/);
});

test('detalle: contacto visible (verificado o manual) con enlaces; rechazada lo oculta', async () => {
    const contact = { visible: true, reason: 'verified', verification_state: 'Yes', email: 'lucia@example.com', whatsapp: '+57 300 111 2233', instagram: '@lucia.f', preference: 'Whatsapp, Email' };
    const share = { available: true, shareable: true, links: [{ id: 'l1', expires_at: '2026-12-01T00:00:00Z', view_count: 2 }] };
    const mod = loadInfoModule({ info: { contact, client: { registered: true }, share } });
    const els = await mod.fire({ quote: { ...ROW, client_user_id: 'c1' }, stage: 'responded', readOnly: false });
    const html = els['qd-client-info-slot'].innerHTML;
    assert.match(html, /<a href="mailto:lucia@example\.com">lucia@example\.com<\/a>/);
    assert.match(html, /<a href="https:\/\/wa\.me\/573001112233" target="_blank" rel="noopener noreferrer">\+57 300 111 2233<\/a>/);
    assert.match(html, /<a href="https:\/\/www\.instagram\.com\/lucia\.f\/" target="_blank" rel="noopener noreferrer">@lucia\.f<\/a>/);
    assert.match(html, /Prefiere que le escriban por/);
    assert.match(html, /WhatsApp · Email/);
    assert.match(html, /1 enlace\(s\)/);
    assert.match(html, /Gestionar enlace/);
    assert.match(els['qd-identity-actions'].innerHTML, /data-qdi="client-profile"[^>]*>Ver perfil del cliente</);
    // Re-render con la misma cotización: no vuelve a pedir.
    await mod.fire({ quote: { ...ROW, client_user_id: 'c1' }, stage: 'responded', readOnly: false });
    assert.equal(mod.calls.info, 1);
    // Cambió el estado → se vuelve a pedir (la regla depende del estado).
    await mod.fire({ quote: { ...ROW, client_user_id: 'c1', quote_status: 'client_rejected' }, stage: 'rejected', readOnly: false });
    assert.equal(mod.calls.info, 2);

    const rejected = loadInfoModule({ info: { contact: { visible: false, reason: 'client_rejected', verification_state: 'Yes', email: null, whatsapp: null, instagram: null, preference: null }, client: { registered: true }, share } });
    const gone = (await rejected.fire({ quote: { ...ROW, quote_status: 'client_rejected' }, stage: 'rejected', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.match(gone, /El cliente rechazó esta cotización: sus datos de contacto ya no se muestran\./);
    assert.doesNotMatch(gone, /fila@example\.com|Verificar mi perfil/);

    const manual = loadInfoModule({ info: { contact: { ...contact, reason: 'manual' }, client: { registered: false }, share } });
    const own = (await manual.fire({ quote: { ...ROW, source: 'manual' }, stage: 'responded', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.match(own, /Contacto que ingresaste al crear la cotización\./);
});

test('detalle: error del servidor ofrece reintentar; la vista de demostración no llama al servidor', async () => {
    const failing = loadInfoModule({ infoError: new Error('boom') });
    const html = (await failing.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.match(html, /No pudimos cargar el contacto\./);
    assert.match(html, /data-qdi="retry"/);
    assert.doesNotMatch(html, /fila@example\.com/);

    const demo = loadInfoModule({ preview: true });
    const demoHtml = (await demo.fire({ quote: ROW, stage: 'pending', readOnly: true }))['qd-client-info-slot'].innerHTML;
    assert.equal(demo.calls.info, 0);
    assert.match(demoHtml, /fila@example\.com/, 'datos de ejemplo del modo demo');
    assert.match(demoHtml, /data-qdi="copy" disabled/);
});

test('perfil del cliente: el modal muestra historial y hasta 3 reseñas, todo escapado', () => {
    const mod = loadInfoModule({ info: {} });
    const html = mod.window.WoQuotationDetailInfo.profileHtml(logic.clientProfile({
        client: { full_name: 'Lucía <b>F</b>', profile_picture: 'https://cdn.example/l.jpg', city_residence: 'Medellín', country: 'Colombia', created_at: '2026-03-02T12:00:00', public_username: 'luciaf' },
        quotes: [{ id: 1, quote_status: 'completed', created_at: '2026-04-01T12:00:00' }, { id: 2, quote_status: 'responded', created_at: '2026-10-01T12:00:00', artist_responded_at: '2026-10-02T12:00:00' }],
        sessions: [{ quotation_id: 1, status: 'completed' }, { quotation_id: 2, status: 'scheduled' }],
        reviews: [1, 2, 3, 4].map((n) => ({ rating: 6 - n, comment: `Reseña ${n} <script>x</script>`, reviewee_type: n === 2 ? 'studio' : 'artist', reviewee_display_name: `Artista ${n}`, created_at: '2026-05-01T12:00:00' })),
        reviewsCount: 4
    }));
    assert.match(html, /<img class="qdi-profile-photo" src="https:\/\/cdn\.example\/l\.jpg" alt=""/);
    assert.match(html, /Lucía &lt;b&gt;F&lt;\/b&gt;/);
    assert.match(html, /@luciaf · Medellín, Colombia · Miembro desde marzo de 2026/);
    for (const [label, value] of [['Cotizaciones contigo', 2], ['Completadas', 1], ['Sesiones realizadas', 1], ['Sesiones agendadas', 1]]) {
        assert.ok(html.includes(`<dt class="qd-label">${label}</dt><dd>${value}</dd>`), label);
    }
    assert.match(html, /Primera cotización contigo: 1 de abril de 2026\./);
    assert.match(html, /Reseñas que dejó · 4/);
    assert.equal((html.match(/<li>/g) || []).length, 3, 'hasta 3 reseñas en el modal');
    assert.match(html, /Mostramos las 3 más recientes\./);
    assert.match(html, /aria-label="5 de 5 estrellas"/);
    assert.match(html, /Sobre el estudio Artista 2/);
    assert.doesNotMatch(html, /<script>|<b>F/);
    assert.doesNotMatch(html, /@example\.com|wa\.me|mailto:/, 'el perfil no trae contacto');

    const empty = mod.window.WoQuotationDetailInfo.profileHtml(logic.clientProfile({ quote: { client_full_name: 'Ana' } }));
    assert.match(empty, /qdi-profile-photo--initials/);
    assert.match(empty, /Todavía no dejó reseñas públicas\./);
    assert.match(empty, /Cliente de We Ötzi/);
});

// ------------------------------------------------------------ diálogo de compartir (vm)

function loadShareActions({ clipboard = true } = {}) {
    const db = { links: [], cache: {}, created: [], revoked: 0, printed: [], images: [], copied: [] };
    const repo = {
        info: async () => ({ share: { links: db.links.filter((l) => !l.revoked).map((l) => ({ id: l.id, expires_at: l.expires_at, view_count: 0 })) } }),
        sheet: async () => ({ sheet: sampleSheet() }),
        createShareLink: async (quoteId, days) => {
            const link = { id: `l${db.links.length + 1}`, expires_at: '2026-12-16T12:00:00.000Z' };
            db.links.push(link);
            db.created.push([quoteId, days]);
            const url = `https://beta.weotzi.com/cotizacion/${String(db.links.length).repeat(43).slice(0, 43)}`;
            db.cache[quoteId] = { id: link.id, url, expires_at: link.expires_at };
            return { url, link };
        },
        revokeShareLinks: async (quoteId) => { db.links.forEach((l) => { l.revoked = true; }); db.revoked += 1; delete db.cache[quoteId]; return { revoked: 1 }; },
        cachedLink: (quoteId, active) => {
            const cached = db.cache[quoteId] || null;
            if (cached && Array.isArray(active) && !active.some((l) => l.id === cached.id)) { delete db.cache[quoteId]; return null; }
            return cached;
        }
    };
    const nodes = {};
    const node = (key) => (nodes[key] = nodes[key] || {
        key, value: '', textContent: '', hidden: false, disabled: false, attrs: {},
        focus() { nodes.focused = key; }, select() {},
        setAttribute(name, value) { this.attrs[name] = value; },
        getAttribute(name) { return this.attrs[name]; }
    });
    const overlay = {
        className: '', innerHTML: '', listeners: {}, removed: false,
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { this.removed = true; },
        querySelector(selector) {
            if (/-url$/.test(selector)) return node('input');
            if (selector === '.wqa-status') return node('status');
            if (selector === '.wqa-error') return node('error');
            if (selector === '.wqa-days') { const days = node('days'); if (!days.value) days.value = '30'; return days; }
            const match = /\[data-wqa="(\w+)"\]/.exec(selector);
            return node(match ? `btn-${match[1]}` : selector);
        },
        querySelectorAll: () => []
    };
    const docListeners = {};
    const document = {
        activeElement: null,
        createElement: () => overlay,
        body: { appendChild() {} },
        addEventListener(type, fn) { docListeners[type] = fn; },
        removeEventListener(type) { delete docListeners[type]; }
    };
    const window = {
        WoQuoteShareModel: SM,
        WeotziData: { QuotationInfo: repo },
        WoQuoteSheet: { print: async (view) => { db.printed.push(view); }, downloadPng: async (view) => { db.images.push(view); } },
        isSecureContext: true,
        setTimeout: () => 0, clearTimeout() {}
    };
    const navigator = clipboard ? { clipboard: { writeText: async (text) => { db.copied.push(text); } } } : {};
    vm.runInNewContext(read('public/shared/js/quote-share-actions.js'), { window, document, navigator, console, Blob });
    async function click(action) {
        const button = node(`btn-${action}`);
        button.attrs['data-wqa'] = action;
        overlay.listeners.click({ target: { closest: (sel) => (sel === '[data-wqa]' ? button : null) } });
        for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
    }
    return { db, repo, overlay, nodes, node, click, docListeners, share: window.WoQuoteShare };
}

test('compartir: el diálogo crea el enlace una sola vez, lo copia, exporta y lo revoca', async () => {
    const h = loadShareActions();
    const dialog = h.share.openDialog({ quoteId: 'COT-MAN001', clientName: '<b>Lucía</b>', created: true });
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.match(h.overlay.innerHTML, /Cotización creada\. Compártela/);
    assert.match(h.overlay.innerHTML, /a &lt;b&gt;Lucía&lt;\/b&gt; aunque no tenga cuenta/);
    assert.doesNotMatch(h.overlay.innerHTML, /<b>Lucía/);
    assert.equal(h.node('status').textContent, 'Todavía no hay un enlace activo.');
    assert.equal(h.node('btn-revoke').hidden, true);

    await h.click('copy');
    assert.deepEqual(h.db.created, [['COT-MAN001', 30]]);
    assert.equal(h.db.copied.length, 1);
    assert.match(h.db.copied[0], /^https:\/\/beta\.weotzi\.com\/cotizacion\/1{43}$/);
    assert.equal(h.node('input').value, h.db.copied[0]);
    assert.match(h.node('status').textContent, /^Enlace copiado\. 1 enlace activo · vence el 16 de diciembre de 2026 · 0 vistas$/);
    assert.equal(h.node('btn-revoke').hidden, false);

    await h.click('copy');
    assert.equal(h.db.created.length, 1, 'reutiliza el enlace vigente de este navegador');
    assert.equal(h.db.copied.length, 2);

    await h.click('pdf');
    await h.click('image');
    assert.equal(h.db.printed.length, 1);
    assert.equal(h.db.images.length, 1);
    assert.equal(h.db.printed[0].url, h.db.copied[0], 'el PDF incluye el enlace ya creado');
    assert.equal(h.db.images[0].total, '900 USD');

    await h.click('revoke');
    assert.equal(h.db.revoked, 0, 'desactivar pide confirmación');
    assert.equal(h.node('btn-revoke').textContent, 'Sí, desactivar');
    assert.match(h.node('status').textContent, /dejarán de abrir/);
    await h.click('revoke');
    assert.equal(h.db.revoked, 1);
    assert.equal(h.node('btn-revoke').textContent, 'Desactivar enlaces');
    assert.equal(h.node('status').textContent, 'Enlaces desactivados: los que compartiste ya no abren.');
    assert.equal(h.node('input').value, '');
    await h.click('pdf');
    assert.equal(h.db.printed[1].url, '', 'sin enlace vigente el PDF no lo menciona');

    h.docListeners.keydown({ key: 'Escape' });
    assert.equal(h.overlay.removed, true);
    assert.equal(typeof dialog.close, 'function');
});

test('compartir: sin permiso de portapapeles deja el enlace seleccionado; los errores se muestran', async () => {
    const h = loadShareActions({ clipboard: false });
    h.share.openDialog({ quoteId: 'COT-MAN001' });
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.match(h.overlay.innerHTML, /Compartir cotización/);
    await h.click('copy');
    assert.match(h.node('status').textContent, /^Copia el enlace del campo\./);
    assert.match(h.node('input').value, /\/cotizacion\//);

    h.repo.createShareLink = async () => { throw new Error('Ya tienes 5 enlaces activos para esta cotización.'); };
    h.repo.cachedLink = () => null;
    await h.click('copy');
    assert.equal(h.node('error').textContent, 'Ya tienes 5 enlaces activos para esta cotización.');
    assert.equal(h.node('error').hidden, false);
    assert.equal(h.node('btn-copy').disabled, false, 'el botón vuelve a quedar disponible');

    assert.equal(h.share.linksStatus([]), 'Todavía no hay un enlace activo.');
    assert.equal(h.share.linksStatus([{ expires_at: '2026-12-01T12:00:00', view_count: 1 }, { expires_at: '2026-11-20T12:00:00', view_count: 2 }]), '2 enlaces activos · vence el 20 de noviembre de 2026 · 3 vistas');
});

// ------------------------------------------------------------ página pública (vm)

async function loadPublicPage({ pathname = '/cotizacion/' + TOKEN, response, error, claimError, intent = false, basePath = '' } = {}) {
    const listeners = {};
    const rootEl = { innerHTML: '', className: '' };
    const loginLink = { textContent: '', href: '' };
    const feedbackEl = { textContent: '', className: '', hidden: true };
    const store = intent ? { 'wo:quote-share:claim': JSON.stringify({ token: intent === 'other' ? 'B'.repeat(43) : TOKEN, at: intent === 'old' ? Date.now() - 25 * 60 * 60 * 1000 : Date.now() }) } : {};
    const calls = { publicSheet: 0, claim: 0 };
    const repo = {
        basePath: () => basePath,
        publicSheet: async (token) => { calls.publicSheet += 1; calls.token = token; if (error) throw error; return response; },
        claimShared: async () => { calls.claim += 1; if (claimError) throw claimError; return { success: true }; }
    };
    const window = {
        location: { origin: 'https://beta.weotzi.com', pathname },
        WoQuoteShareModel: SM,
        WeotziData: { QuotationInfo: repo },
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        setTimeout: () => 0, clearTimeout() {}
    };
    if (basePath) window.WEOTZI_BASE_PATH = basePath;
    const document = {
        readyState: 'complete', title: '',
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        getElementById: (id) => ({ 'wqp-root': rootEl, 'wqp-login-link': loginLink, 'wqp-feedback': feedbackEl }[id] || null),
        querySelector: () => null
    };
    const context = { window, document, URL, console, Date, JSON };
    vm.runInNewContext(read('public/shared/js/quote-share-sheet.js'), context);
    vm.runInNewContext(read('public/shared/js/quote-share-page.js'), context);
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return { rootEl, loginLink, feedbackEl, calls, store, document, listeners };
}

test('página pública: muestra la hoja e invita a registrarse con returnTo al enlace', async () => {
    const sheet = sampleSheet({ client_full_name: '<script>alert(1)</script>' });
    const page = await loadPublicPage({ response: { sheet, viewer: { signed_in: false } } });
    assert.equal(page.calls.token, TOKEN);
    const html = page.rootEl.innerHTML;
    assert.equal(page.rootEl.className, 'wqp-main');
    assert.match(html, /class="wqs-sheet"/);
    assert.match(html, /900 USD/);
    assert.doesNotMatch(html, /<script>alert/);
    const returnTo = encodeURIComponent('/cotizacion/' + TOKEN);
    assert.ok(html.includes(`href="/client/register?returnTo=${returnTo}" data-wqp="auth">Crear mi cuenta</a>`));
    assert.ok(html.includes(`href="/client/login?returnTo=${returnTo}" data-wqp="auth">Ya tengo cuenta</a>`));
    assert.match(html, /Chatea con Mateo Rivas sin salir de We Ötzi\./);
    assert.match(html, /soporte de We Ötzi/);
    assert.match(html, /data-wqp="pdf"[^>]*>Descargar PDF</);
    assert.match(html, /data-wqp="image"[^>]*>Descargar imagen</);
    assert.doesNotMatch(html, /class="wqs-link"/, 'en pantalla no repite su propio enlace');
    assert.equal(page.loginLink.textContent, 'Iniciar sesión');
    assert.match(page.document.title, /Manga japonesa · COT-MAN001/);
    assert.equal(page.calls.claim, 0);

    // Con base path /beta los enlaces lo respetan y el token se lee igual.
    const beta = await loadPublicPage({ pathname: '/beta/cotizacion/' + TOKEN, basePath: '/beta', response: { sheet, viewer: { signed_in: false } } });
    assert.equal(beta.calls.token, TOKEN);
    assert.ok(beta.rootEl.innerHTML.includes(`href="/beta/client/register?returnTo=${returnTo}"`));
});

test('página pública: con sesión ofrece vincular; al volver del registro vincula sola', async () => {
    const sheet = sampleSheet();
    const manualClick = await loadPublicPage({ response: { sheet, viewer: { signed_in: true, linked: false, can_claim: true } } });
    assert.match(manualClick.rootEl.innerHTML, /data-wqp="claim">Vincular a mi cuenta</);
    assert.equal(manualClick.calls.claim, 0, 'sin intención previa no vincula sola');
    assert.equal(manualClick.loginLink.textContent, 'Mi panel');

    const returning = await loadPublicPage({ intent: true, response: { sheet, viewer: { signed_in: true, linked: false, can_claim: true } } });
    assert.equal(returning.calls.claim, 1);
    assert.ok(!('wo:quote-share:claim' in returning.store), 'la intención se consume');
    const stale = await loadPublicPage({ intent: 'old', response: { sheet, viewer: { signed_in: true, linked: false, can_claim: true } } });
    assert.equal(stale.calls.claim, 0, 'una intención de hace más de 24 h no vincula sola');
    const foreign = await loadPublicPage({ intent: 'other', response: { sheet, viewer: { signed_in: true, linked: false, can_claim: true } } });
    assert.equal(foreign.calls.claim, 0, 'ni la de otro enlace');
    assert.match(returning.rootEl.innerHTML, /Esta cotización ya está en tu cuenta/);
    assert.ok(returning.rootEl.innerHTML.includes('href="/client/dashboard?quote=COT-MAN001">Abrir en mi panel</a>'));
    assert.ok(returning.rootEl.innerHTML.includes('href="/client/chats?quote=COT-MAN001">Chatear con el artista</a>'));

    const failed = await loadPublicPage({ intent: true, claimError: Object.assign(new Error('Esta cotización ya está vinculada a otra cuenta.'), { status: 409 }), response: { sheet, viewer: { signed_in: true, can_claim: true } } });
    assert.equal(failed.feedbackEl.textContent, 'Esta cotización ya está vinculada a otra cuenta.');
    assert.equal(failed.feedbackEl.className, 'wqp-feedback is-error');

    const linked = await loadPublicPage({ response: { sheet, viewer: { signed_in: true, linked: true } } });
    assert.match(linked.rootEl.innerHTML, /Abrir en mi panel/);
    const owner = await loadPublicPage({ response: { sheet, viewer: { signed_in: true, reason: 'own' } } });
    assert.match(owner.rootEl.innerHTML, /Así ve tu cliente la cotización/);
    assert.ok(owner.rootEl.innerHTML.includes('href="/my-quotations/detail?quote=COT-MAN001"'));
    const notClient = await loadPublicPage({ response: { sheet, viewer: { signed_in: true, reason: 'not_client' } } });
    assert.match(notClient.rootEl.innerHTML, /Crear cuenta de cliente/);
    const mismatch = await loadPublicPage({ response: { sheet, viewer: { signed_in: true, reason: 'email_mismatch', message: 'Esta cotización se pidió con <otro> correo.' } } });
    assert.match(mismatch.rootEl.innerHTML, /Esta cotización se pidió con &lt;otro&gt; correo\./);
    const taken = await loadPublicPage({ response: { sheet: { ...sheet, claim: { linked: true } }, viewer: { signed_in: false } } });
    assert.match(taken.rootEl.innerHTML, /Inicia sesión para responder/);
    assert.doesNotMatch(taken.rootEl.innerHTML, /Crear mi cuenta/);
});

test('página pública: enlace inválido, vencido, revocado o con error muestra un estado claro', async () => {
    const invalid = await loadPublicPage({ pathname: '/cotizacion/corto' });
    assert.equal(invalid.calls.publicSheet, 0, 'sin token válido no consulta');
    assert.match(invalid.rootEl.innerHTML, /Este enlace no es válido/);
    assert.equal(invalid.rootEl.className, 'wqp-main is-message');
    const cases = [
        [{ status: 410, code: 'expired' }, /Este enlace venció/],
        [{ status: 410, code: 'revoked' }, /Tu artista desactivó este enlace/],
        [{ status: 404, code: 'not_found' }, /No encontramos esta cotización/],
        [{ status: 429 }, /Demasiados intentos/],
        [{ status: 500 }, /No pudimos cargar la cotización/]
    ];
    for (const [fields, expected] of cases) {
        const page = await loadPublicPage({ error: Object.assign(new Error('x'), fields) });
        assert.match(page.rootEl.innerHTML, expected);
        assert.doesNotMatch(page.rootEl.innerHTML, /wqs-sheet/);
    }
    const retry = await loadPublicPage({ error: Object.assign(new Error('x'), { status: 500 }) });
    assert.match(retry.rootEl.innerHTML, /data-wqp="retry">Reintentar</);
});

// ------------------------------------------------------------ contratos de archivos

test('expediente: huecos, referencias con comentario e IA, y carga de extras por la capa de datos', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /<div class="qd-identity-actions" id="qd-identity-actions"><\/div>/);
    assert.match(js, /'<div id="qd-client-info-slot"><\/div>',/);
    assert.ok(js.indexOf("'<div id=\"qd-client-info-slot\"></div>'") > js.indexOf('dossierHtml(v),'), 'debajo del dossier');
    assert.match(js, /M\.referenceItems\(q, state\.attachments, state\.extras\)/);
    assert.match(js, /Generada con IA · solo referencial/);
    assert.match(js, /Comentario del cliente/);
    assert.match(js, /\$\{esc\(ref\.note\)\}/, 'el comentario del cliente se escapa');
    assert.match(js, /data\.IntakeExtras\.getByQuoteId\(quote\.quote_id\)\.catch\(\(\) => null\)/);
    assert.doesNotMatch(js, /fetch\(['"`]\/rest\/v1/, 'sin CRUD ad-hoc');
    // El expediente no pinta el contacto del cliente desde la fila.
    assert.doesNotMatch(js, /client_whatsapp|client_instagram|client_contact_preference/);

    const info = read('public/shared/js/quotation-detail-info.js');
    assert.match(info, /R\.info\(last\.quote\.quote_id\)/);
    assert.doesNotMatch(info, /\.from\(|\/rest\/v1/);
    const rowReads = info.split('\n').filter((line) => /last\.quote\.client_(email|whatsapp|instagram|contact_preference)/.test(line));
    assert.ok(rowReads.length > 0 && rowReads.length <= 2, 'la fila solo se usa en la vista de demostración');
    assert.ok(info.indexOf('if (isPreview() || last.readOnly) {') < info.indexOf('last.quote.client_email'), 'y solo dentro de la rama de demostración');
});

// DB-06 (P17): la RPC quotation_same_contact existía y nadie la llamaba.
test('detalle: "Mismo contacto" lista las otras cotizaciones del mismo correo o teléfono', async () => {
    const info = { contact: { visible: false, reason: 'not_verified', verification_state: 'No', email: null, whatsapp: null, instagram: null, preference: null }, client: { registered: false }, share: { available: true, shareable: true, links: [] } };
    const rows = [
        { quote_id: 'QN0aa"><script>x</script>', short_code: 'K7M2QP', quote_status: 'responded', created_at: '2026-11-03T15:00:00Z', tattoo_idea_description: 'Un colibrí', same_email: true, same_phone: true },
        { quote_id: 'QN0bb', short_code: null, quote_status: 'client_rejected', created_at: '2026-10-20T15:00:00Z', same_email: false, same_phone: true },
        { quote_id: 'QN0cc', short_code: 'ZZ9XX1', quote_status: 'otro_estado', created_at: null, same_email: false, same_phone: false },
        { quote_id: '', short_code: 'SINID' }
    ];
    const mod = loadInfoModule({ info, sameContact: rows });
    const html = (await mod.fire({ quote: ROW, stage: 'pending', readOnly: false, user: { id: 'a' } }))['qd-client-info-slot'].innerHTML;
    assert.deepEqual(mod.calls.sameContact, ['COT-AB12CD'], 'una consulta, con el quote_id del expediente');
    const block = html.slice(html.indexOf('id="qd-mismo-contacto"'), html.indexOf('</ul>', html.indexOf('id="qd-mismo-contacto"')));
    assert.match(block, /<h3 class="qd-label">Mismo contacto · 3 cotizaciones<\/h3>/);
    assert.match(block, /Esta persona te pidió otras cotizaciones con el mismo correo o teléfono\./);
    // Código corto (o el quote_id si no hay), estado, fecha y qué dato coincide; enlace al expediente.
    assert.match(block, /<a href="\/my-quotations\/detail\?id=QN0aa%22%3E%3Cscript%3Ex%3C%2Fscript%3E">K7M2QP<\/a><span>Respondida · 3 de noviembre de 2026 · Mismo correo y teléfono<\/span>/);
    assert.match(block, /<a href="\/my-quotations\/detail\?id=QN0bb">QN0bb<\/a><span>Rechazada por el cliente · 20 de octubre de 2026 · Mismo teléfono<\/span>/);
    assert.match(block, /<a href="\/my-quotations\/detail\?id=QN0cc">ZZ9XX1<\/a><\/li>/, 'sin datos extra no inventa nada');
    assert.doesNotMatch(block, /SINID|<script>|Un colibrí/);
    assert.equal((block.match(/<li>/g) || []).length, 3);
    // Va dentro del panel de contacto, después del candado.
    assert.ok(html.indexOf('id="qd-contacto"') < html.indexOf('qdi-locked') && html.indexOf('qdi-locked') < html.indexOf('id="qd-mismo-contacto"'));

    const one = loadInfoModule({ info, sameContact: [rows[1]] });
    const single = (await one.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.match(single, /Mismo contacto · 1 cotización</);
    assert.match(single, /Esta persona te pidió otra cotización con el mismo correo o teléfono\./);

    // Lista vacía, RPC caída, respuesta rara o repo sin el método: el bloque no aparece y el resto sigue.
    for (const options of [{ sameContact: [] }, { sameContactError: new Error('boom') }, { sameContact: null }, {}]) {
        const quiet = loadInfoModule(Object.assign({ info }, options));
        const out = (await quiet.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
        assert.doesNotMatch(out, /qd-mismo-contacto|Mismo contacto/);
        assert.match(out, /Verifica tu perfil para ver el contacto/);
    }
    // Vista de demostración: no consulta.
    const demo = loadInfoModule({ info, preview: true, sameContact: rows });
    const demoHtml = (await demo.fire({ quote: ROW, stage: 'pending', readOnly: false }))['qd-client-info-slot'].innerHTML;
    assert.deepEqual(demo.calls.sameContact, []);
    assert.doesNotMatch(demoHtml, /qd-mismo-contacto/);
});

test('capa de datos: listSameContact llama a la RPC y tolera que la migración no esté', async () => {
    const calls = [];
    let result = { data: [{ quote_id: 'QN1' }], error: null };
    const client = { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve(result); }, from: () => ({}) };
    const window = { WeotziData: { run: async (label, builder) => {
        const res = await builder(client);
        if (res.error) throw Object.assign(new Error(`[${label}] ${res.error.message}`), { code: res.error.code, cause: res.error });
        return { data: res.data || null, count: null };
    } } };
    vm.runInNewContext(read('public/shared/js/data/quotations-repo.js'), { window, console });
    const Q = window.WeotziData.Quotations;
    assert.deepEqual(JSON.parse(JSON.stringify(await Q.listSameContact('QN9'))), [{ quote_id: 'QN1' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['quotation_same_contact', { p_quote_id: 'QN9' }]]);
    assert.equal((await Q.listSameContact('')).length, 0, 'sin id no consulta');
    assert.equal(calls.length, 1);
    for (const code of ['PGRST202', '42883']) {
        result = { data: null, error: { code, message: 'Could not find the function public.quotation_same_contact' } };
        assert.equal((await Q.listSameContact('QN9')).length, 0, code);
    }
    result = { data: null, error: { code: '42501', message: 'permission denied' } };
    await assert.rejects(() => Q.listSameContact('QN9'), /permission denied/);
    result = { data: null, error: null };
    assert.equal((await Q.listSameContact('QN9')).length, 0);
    // La función existe en la migración del frente cot-form y la ejecuta el artista con su sesión.
    const sql = read('supabase/migrations/20261116110200_cot_form_r2_vinculo_contacto.sql');
    assert.match(sql, /create or replace function public\.quotation_same_contact\(p_quote_id text\)/);
    assert.match(sql, /grant execute on function public\.quotation_same_contact\(text\) to authenticated, service_role;/);
    assert.match(read('public/shared/css/quotation-detail-info.css'), /\.qdi-same-list a \{/);
    assert.match(read('public/my-quotations/detail/index.html'), /\/shared\/css\/quotation-detail-info\.css\?v=20261116-r2b"/);
});

test('páginas: el detalle, el listado y la hoja manual cargan los módulos en orden', () => {
    const detail = read('public/my-quotations/detail/index.html');
    const order = (html, a, b) => html.indexOf(a) !== -1 && html.indexOf(b) !== -1 && html.indexOf(a) < html.indexOf(b);
    for (const file of ['quotation-detail-info.css', 'quote-share.css']) assert.ok(detail.includes(`/shared/css/${file}`), file);
    assert.ok(order(detail, 'quotation-detail-figma.css', 'quotation-detail-info.css'), 'el CSS nuevo va después del del expediente');
    assert.ok(order(detail, 'postgrest-client.js', 'data/quotation-info-repo.js'));
    for (const script of ['qrcode-generator.js', 'quote-share-model.js', 'quote-share-sheet.js', 'quote-share-actions.js', 'quotation-detail-info.js']) {
        assert.ok(order(detail, script, 'quotation-detail-figma.js'), `${script} antes del expediente`);
    }
    assert.ok(order(detail, 'quotation-detail-model.js', 'quotation-detail-info.js'));
    assert.ok(order(detail, 'quote-share-model.js', 'quote-share-sheet.js'));
    assert.ok(order(detail, 'quote-share-sheet.js', 'quote-share-actions.js'));

    for (const rel of ['public/my-quotations/index.html', 'public/my-quotations/new/index.html']) {
        const html = read(rel);
        assert.ok(html.includes('/shared/css/quote-share.css'), rel);
        for (const script of ['data/quotation-info-repo.js', 'quote-share-model.js', 'quote-share-sheet.js', 'quote-share-actions.js']) {
            assert.ok(order(html, script, 'quotation-new.js'), `${rel}: ${script} antes de quotation-new.js`);
        }
        assert.ok(order(html, 'postgrest-client.js', 'data/quotation-info-repo.js'), rel);
    }
    const created = read('public/shared/js/quotation-new.js');
    // SEG-01: el buscador de clientes ya no lee el contacto desde el navegador.
    assert.doesNotMatch(created, /listClientContactsForArtist/);
    assert.match(created, /const info = D\(\)\.QuotationInfo;\s+if \(info && typeof info\.clientContacts === 'function'\) \{\s+try \{ return await info\.clientContacts\(\); \}/);
    assert.match(created, /return D\(\)\.Quotations\.listClientNamesForArtist\(userId\);/, 'respaldo: solo nombres');
    const quotationsRepo = read('public/shared/js/data/quotations-repo.js');
    assert.doesNotMatch(quotationsRepo, /listClientContactsForArtist/);
    const namesOnly = /async listClientNamesForArtist\(artistUserId, limit = 300\) \{[\s\S]*?\.select\('([^']+)'\)/.exec(quotationsRepo);
    assert.ok(namesOnly, 'método de respaldo');
    assert.equal(namesOnly[1], 'client_full_name, client_city_residence, created_at', 'sin email, WhatsApp ni Instagram');
    const infoRepo = read('public/shared/js/data/quotation-info-repo.js');
    assert.match(infoRepo, /clientContacts: async function \(\) \{\s+var body = await call\('GET', '\/api\/cot-detalle\/client-contacts'\);\s+return Array\.isArray\(body\.contacts\) \? body\.contacts : \[\];/);
    assert.match(created, /window\.WoQuoteShare\.openDialog\(\{ quoteId, clientName: quotePayload\.client_full_name \|\| '', created: true \}\)/);
    assert.ok(created.indexOf('window.WoQuoteShare.openDialog') > created.indexOf('D().Quotations.createManual(quotePayload, details)'), 'después de crearla');
});

test('compartir (artista): tres acciones, enlace revocable con vigencia y nada de token en el servidor', () => {
    const actions = read('public/shared/js/quote-share-actions.js');
    for (const label of ['Copiar enlace', 'Descargar PDF', 'Descargar imagen', 'Desactivar enlaces', 'Vigencia de un enlace nuevo']) {
        assert.ok(actions.includes(label), label);
    }
    assert.match(actions, /role="dialog" aria-modal="true"/);
    assert.match(actions, /event\.key === 'Escape'/);
    assert.match(actions, /navigator\.clipboard/);
    assert.match(actions, /document\.execCommand\('copy'\)/, 'respaldo sin API de portapapeles');
    assert.deepEqual(vmDayOptions(actions), logic.SHARE_DAYS.slice(), 'mismas vigencias que acepta el servidor');

    const repo = read('public/shared/js/data/quotation-info-repo.js');
    for (const endpoint of ['/info', '/client-profile', '/sheet', '/share', '/api/cot-detalle/public/', '/claim']) assert.ok(repo.includes(endpoint), endpoint);
    assert.match(repo, /'\/api\/cot-detalle\/quotations\/' \+ encodeURIComponent\(quoteId\)/);
    assert.match(repo, /Authorization = 'Bearer ' \+ token/);
    assert.doesNotMatch(repo, /\/rest\/v1/);
    // Cada endpoint del repositorio existe en el servidor.
    const server = read('lib/routes/cot-detalle.js');
    for (const route of ["app.get('/api/cot-detalle/quotations/:quoteId/info'", "app.get('/api/cot-detalle/quotations/:quoteId/client-profile'",
        "app.get('/api/cot-detalle/quotations/:quoteId/sheet'", "app.post('/api/cot-detalle/quotations/:quoteId/share'",
        "app.delete('/api/cot-detalle/quotations/:quoteId/share'", "app.get('/api/cot-detalle/public/:token'", "app.post('/api/cot-detalle/public/:token/claim'"]) {
        assert.ok(server.includes(route), route);
    }

    const sheet = read('public/shared/js/quote-share-sheet.js');
    assert.match(sheet, /window\.print\(\)/);
    assert.match(sheet, /canvas\.toBlob\(/);
    assert.match(sheet, /'image\/png'/);
    assert.doesNotMatch(sheet, /html2canvas|jspdf|cdn\./i, 'sin dependencias nuevas');
});

function vmDayOptions(source) {
    const match = /var DAY_OPTIONS = \[([^\]]+)\];/.exec(source);
    return match ? match[1].split(',').map((n) => Number(n.trim())) : [];
}

test('página pública: sin indexar, CTA a registrarse / iniciar sesión con returnTo y vínculo a la cuenta', () => {
    const html = read('public/cotizacion/index.html');
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /id="wqp-root" aria-live="polite"/);
    const order = (a, b) => html.indexOf(a) !== -1 && html.indexOf(a) < html.indexOf(b);
    assert.ok(order('config-manager.js', 'data/quotation-info-repo.js'));
    assert.ok(order('quote-share-model.js', 'quote-share-sheet.js'));
    assert.ok(order('quote-share-sheet.js', 'quote-share-page.js'));
    assert.ok(html.includes('/shared/css/quote-share.css'));
    assert.doesNotMatch(html, /src="(?!https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase|\/)/, 'scripts propios o el SDK de Supabase');

    const page = read('public/shared/js/quote-share-page.js');
    for (const copy of ['Crear mi cuenta', 'Ya tengo cuenta', 'Vincular a mi cuenta', 'Descargar PDF', 'Descargar imagen', 'Este enlace venció', 'Tu artista desactivó este enlace']) {
        assert.ok(page.includes(copy), copy);
    }
    assert.match(page, /'\/client\/' \+ page \+ '\?returnTo=' \+ encodeURIComponent\(SM\.sharePath\(state\.token\)\)/);
    assert.match(page, /repo\(\)\.claimShared\(state\.token\)/);
    assert.match(page, /status === 410/);
    assert.match(page, /status === 404/);
    assert.doesNotMatch(page, /innerHTML = [^;]*\+ (state\.sheet|sheet)\.[a-z_]+ *[+;]/, 'nada de datos sin escapar en innerHTML');

    // returnTo: el login y el registro del cliente aceptan volver al enlace.
    const window = { location: { pathname: '/client/login', search: '', hash: '', origin: 'https://beta.weotzi.com' } };
    const context = {
        window, console, URLSearchParams,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { addEventListener() {} },
        supabase: { createClient: () => ({ auth: {} }) }
    };
    vm.runInNewContext(read('public/shared/js/client-auth.js'), context);
    const n = context.normalizeReturnTo;
    assert.equal(n('/cotizacion/' + TOKEN), '/cotizacion/' + TOKEN);
    assert.equal(n('/cotizacion/' + logic.newShareToken()) !== null, true);
    for (const bad of ['/cotizacion/', '/cotizacion/corto', '/cotizacion/' + TOKEN + '/extra', '/cotizacion/' + TOKEN + 'x', '/cotizacion/../client/dashboard', '//evil.example/cotizacion/' + TOKEN, '/cotizaciones/' + TOKEN]) {
        assert.equal(n(bad), null, bad);
    }
});

test('estilos: tokens del DS, responsive sin desborde y vista imprimible', () => {
    const info = read('public/shared/css/quotation-detail-info.css');
    const share = read('public/shared/css/quote-share.css');
    for (const [name, css] of [['quotation-detail-info.css', info], ['quote-share.css', share]]) {
        assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${name}: sin hex sueltos (solo tokens)`);
        assert.match(css, /var\(--ink\)/, name);
        assert.match(css, /minmax\(0, 1fr\)/, `${name}: columnas que no desbordan`);
        assert.match(css, /:focus-visible/, `${name}: foco visible`);
    }
    assert.match(info, /@media \(max-width: 1100px\)/);
    assert.match(info, /@media \(max-width: 768px\)[\s\S]*\.qdi \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    assert.match(info, /@media \(max-width: 480px\)/);
    assert.match(info, /overflow-wrap: anywhere/);
    assert.match(share, /@media \(max-width: 900px\)[\s\S]*\.wqp-main \{ grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(share, /@media \(max-width: 680px\)[\s\S]*\.wqs-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    assert.match(share, /\.wqp-body \{[^}]*overflow-x: clip/);
    // FE-03: el expediente carga también quotation-payments.css, que usa .wqp-body
    // para el cuerpo del diálogo "Registrar pago". La regla de la página pública
    // va atada al <body> y las dos hojas no comparten ninguna otra clase.
    assert.match(share, /(^|\n)body\.wqp-body \{[^}]*min-height: 100vh/);
    const rules = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/body\.wqp-body/g, '');
    assert.doesNotMatch(rules(share), /\.wqp-body\b/);
    assert.match(read('public/cotizacion/index.html'), /<body class="[^"]*\bwqp-body\b[^"]*">/);
    const pay = read('public/shared/css/quotation-payments.css');
    assert.match(pay, /\.wqp-body \{[^}]*display: flex/, 'el diálogo de pagos sigue usando .wqp-body');
    const classes = (css) => new Set(rules(css).match(/\.wqp-[\w-]+/g) || []);
    assert.ok(classes(share).size > 5 && classes(pay).size > 5, 'las dos hojas tienen clases .wqp-*');
    assert.deepEqual([...classes(share)].filter((c) => classes(pay).has(c)), [], 'quote-share.css no comparte clases con el diálogo de pagos');
    const detailHtml = read('public/my-quotations/detail/index.html');
    assert.ok(detailHtml.includes('/shared/css/quote-share.css') && detailHtml.includes('/shared/css/quotation-payments.css'), 'el expediente carga las dos hojas');
    // PDF: @media print muestra solo la hoja.
    assert.match(share, /@media print \{[\s\S]*html\.wo-quote-printing body > \*:not\(#wo-quote-print\) \{ display: none !important; \}/);
    assert.match(share, /@media print \{[\s\S]*html\.wo-quote-printing #wo-quote-print \{ display: block !important; \}/);
    assert.match(share, /@page \{ size: A4; margin: 12mm; \}/);
    assert.match(share, /print-color-adjust: exact/);
    assert.match(share, /prefers-reduced-motion: reduce/);
    assert.match(read('public/shared/js/quote-share-sheet.js'), /PRINT_CLASS = 'wo-quote-printing'/);
});

test('idioma: los textos nuevos van en español neutro con tuteo (sin voseo)', () => {
    const VOSEO = /\b(querés|podés|tenés|sabés|hacé|elegí|contanos|contale|mirá|revisá|probá|ingresá|iniciá|creá|pedile|pedí|escribile|mandale|enviale|descargá|copiá|vinculá|verificá|activá|abrí|volvé|esperá|guardá|compartí|confirmá|entrá|cancelás|aceptás|vos)\b/i;
    const files = [
        'public/shared/js/quotation-detail-info.js', 'public/shared/js/quote-share-page.js', 'public/shared/js/quote-share-actions.js',
        'public/shared/js/quote-share-sheet.js', 'public/shared/js/quote-share-model.js', 'public/shared/js/data/quotation-info-repo.js',
        'public/cotizacion/index.html', 'lib/cot-detalle.js', 'lib/routes/cot-detalle.js', 'services/email-events/cot-detalle.js'
    ];
    for (const rel of files) {
        const hit = read(rel).split('\n').find((line) => VOSEO.test(line));
        assert.equal(hit, undefined, `${rel}: ${hit}`);
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/plans/ronda2-assets/cot-detalle.json')));
    assert.deepEqual(JSON.parse(read('docs/plans/ronda2-assets/cot-detalle.json')), [], 'este frente no necesita imágenes generadas');
});
