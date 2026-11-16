'use strict';

// Ronda 2 · frente cot-detalle (servidor): regla de contacto [P20/P23], perfil
// del cliente [P6], enlace público y hoja exportable [P30]. Lógica pura, rutas
// con dobles (sin red) y contratos de migración / server.js por lectura.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const logic = require('../lib/cot-detalle');
const routes = require('../lib/routes/cot-detalle');
const repoModule = require('../lib/repos/cot-detalle');
const EVENTS = require('../services/email-events/cot-detalle');

const MIGRATION = 'supabase/migrations/20261116130000_quotation_share_links.sql';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const OTHER_ARTIST = '33333333-3333-4333-8333-333333333333';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-16T12:00:00Z');

function quoteRow(overrides = {}) {
    return {
        id: 77, quote_id: 'COT-AB12CD', quote_status: 'pending', source: 'web_chat', quotation_medium: 'web',
        created_at: '2026-11-10T10:00:00Z', artist_id: ARTIST, artist_name: 'Mateo Rivas', artist_username: 'mateoink.wo',
        artist_email: 'mateo@example.com', artist_studio_name: 'Estudio Norte', artist_current_city: 'Bogotá',
        client_user_id: null, client_full_name: 'Lucía Fernández', client_email: 'lucia@example.com',
        client_whatsapp: '+57 300 111 2233', client_instagram: '@lucia.f', client_contact_preference: 'Whatsapp, Email',
        client_city_residence: 'Medellín', client_health_conditions: 'SECRETO-SALUD', client_allergies: 'SECRETO-ALERGIA',
        client_birth_date: '1990-01-01', client_age: '36', notes: 'SECRETO-NOTA-PRIVADA', priority: 'high',
        tattoo_idea_description: 'Una golondrina tradicional.', tattoo_style: { style_name: 'Tradicional' },
        tattoo_body_part: 'Antebrazo', tattoo_body_side: 'Izquierdo', tattoo_size: '10-15 cm', tattoo_color_type: 'Color',
        tattoo_is_cover_up: false, tattoo_estimated_sessions: '2', artist_budget_amount: null, artist_budget_currency: null,
        client_budget_currency: 'USD', final_budget_amount: null, final_sessions: null, artist_session_minutes: null,
        artist_availability: null, artist_responded_at: null, artist_deposit_pct: null, artist_deposit_amount: null,
        quote_expires_at: null, quote_expiry_enabled: false, quote_expiry_days: null, project_description: null,
        ...overrides
    };
}

const MANUAL_DETAILS = {
    quote_id: 'COT-MAN001', status: 'sent',
    project: { title: 'Manga japonesa', description: 'Dragón y olas.', sessions: 3, session_hours: 4, location: 'Estudio Norte, Chapinero' },
    line_items: [
        { name: 'Diseño', description: 'Boceto a medida', qty: 1, price: 100, total: 100 },
        { name: 'Sesión', description: null, qty: 3, price: 300, total: 900 }
    ],
    currency: 'usd', discount_pct: 10, tax_pct: 0, deposit_pct: 30, subtotal: 1000, total: 900, deposit_amount: 270,
    validity_days: 14, cancellation_policy: 'no-reembolsable-48', client_notes: 'Trae ropa cómoda.', extra_terms: 'Retoque incluido.'
};

// ------------------------------------------------------------ migración

test('migración: rango del frente, idempotente, con reversa y solo service_role', () => {
    const name = path.basename(MIGRATION);
    const ts = Number(name.slice(0, 14));
    assert.ok(ts >= 20261116130000 && ts <= 20261116130999, 'timestamp fuera del rango del frente');
    const sql = read(MIGRATION);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);
    assert.match(sql, /create table if not exists public\.quotation_share_links/);
    assert.match(sql, /quotation_id integer not null references public\.quotations_db\(id\) on delete cascade/);
    assert.match(sql, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/, 'solo se guarda el SHA-256 del token');
    assert.doesNotMatch(sql, /\btoken text\b/, 'el token en claro no se guarda');
    assert.match(sql, /expires_at timestamptz not null/);
    assert.match(sql, /revoked_at timestamptz/);
    assert.match(sql, /create unique index if not exists quotation_share_links_token_hash_key/);
    assert.match(sql, /alter table public\.quotation_share_links enable row level security;/);
    assert.match(sql, /revoke all on table public\.quotation_share_links from public, anon, authenticated;/);
    assert.doesNotMatch(sql, /create policy/i, 'sin políticas: anon y authenticated no leen');
    assert.match(sql, /revoke all on function public\.touch_quotation_share_link\(text\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.touch_quotation_share_link\(text\) to service_role;/);

    const down = read('supabase/rollbacks/20261116130000_quotation_share_links.down.sql');
    assert.match(down, /drop function if exists public\.touch_quotation_share_link\(text\);/);
    assert.match(down, /drop table if exists public\.quotation_share_links;/);
});

// ------------------------------------------------------------ contacto [P20/P23]

test('contacto: visible solo con artista verificado y cotización no rechazada; manual siempre', () => {
    const verified = { verification_state: 'Yes' };
    const unverified = { verification_state: 'No' };
    const q = quoteRow();
    assert.deepEqual(logic.contactAccess({ quote: q, artist: verified }), { visible: true, reason: 'verified' });
    assert.deepEqual(logic.contactAccess({ quote: q, artist: unverified }), { visible: false, reason: 'not_verified' });
    assert.deepEqual(logic.contactAccess({ quote: q, artist: { verification_state: 'Requested' } }), { visible: false, reason: 'not_verified' });
    assert.deepEqual(logic.contactAccess({ quote: q, artist: null }), { visible: false, reason: 'not_verified' });
    // Rechazada por el cliente: ni el verificado lo ve.
    const rejected = quoteRow({ quote_status: 'client_rejected' });
    assert.deepEqual(logic.contactAccess({ quote: rejected, artist: verified }), { visible: false, reason: 'client_rejected' });
    // Manual: el contacto lo cargó el artista, se ve aunque no esté verificado o esté rechazada.
    const manual = quoteRow({ source: 'manual', quotation_medium: 'manual', quote_status: 'client_rejected' });
    assert.deepEqual(logic.contactAccess({ quote: manual, artist: unverified }), { visible: true, reason: 'manual' });
    assert.deepEqual(logic.contactAccess({ quote: null, artist: verified }), { visible: false, reason: 'not_found' });
    // Otros estados no esconden el contacto al verificado.
    for (const status of ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'cancelled', 'expired']) {
        assert.equal(logic.contactAccess({ quote: quoteRow({ quote_status: status }), artist: verified }).visible, true, status);
    }
});

// SEG-01: el buscador de clientes de la cotización manual leía en el navegador el email,
// WhatsApp e Instagram de TODAS las cotizaciones del artista (rechazadas incluidas).
const CONTACT_ROWS = [
    { quote_status: 'client_rejected', source: 'web_chat', quotation_medium: 'web', client_full_name: 'Rita Rechazo', client_email: 'rita@example.com', client_whatsapp: '+54 11 5555 0001', client_instagram: '@rita', client_city_residence: 'Rosario', created_at: '2026-11-12T10:00:00Z' },
    { quote_status: 'pending', source: 'web_chat', quotation_medium: 'web', client_full_name: 'Lucía Fernández', client_email: 'lucia@example.com', client_whatsapp: '+57 300 111 2233', client_instagram: '@lucia.f', client_city_residence: 'Medellín', created_at: '2026-11-10T10:00:00Z' },
    { quote_status: 'responded', source: 'manual', quotation_medium: 'manual', client_full_name: 'Marina Ibáñez', client_email: 'marina@example.com', client_whatsapp: '+54 9 11 4444 0002', client_instagram: null, client_city_residence: 'Buenos Aires', created_at: '2026-11-08T10:00:00Z' },
    { quote_status: 'client_approved', source: 'web_chat', quotation_medium: 'web', client_full_name: 'marina ibáñez', client_email: 'marina@example.com', client_whatsapp: null, client_instagram: null, client_city_residence: 'Buenos Aires', created_at: '2026-11-05T10:00:00Z' },
    { quote_status: 'pending', source: 'web_chat', quotation_medium: 'web', client_full_name: '   ', client_email: 'sin-nombre@example.com', created_at: '2026-11-01T10:00:00Z' }
];

test('buscador de clientes: el contacto viaja solo donde la regla lo permite (P20/P23)', () => {
    const names = (list) => list.map((c) => c.client_full_name);
    // Artista sin verificar: nombres y ciudad; contacto solo de sus cotizaciones manuales.
    const unverified = logic.clientContacts({ rows: CONTACT_ROWS, artist: { verification_state: 'No' } });
    assert.deepEqual(names(unverified), ['Rita Rechazo', 'Lucía Fernández', 'Marina Ibáñez']);
    assert.deepEqual(unverified.map((c) => c.contact_visible), [false, false, true]);
    assert.deepEqual(unverified[1], {
        client_full_name: 'Lucía Fernández', client_city_residence: 'Medellín', created_at: '2026-11-10T10:00:00Z',
        client_email: null, client_whatsapp: null, client_instagram: null, contact_visible: false
    });
    assert.equal(unverified[2].client_email, 'marina@example.com', 'manual: el contacto lo cargó el propio artista');
    assert.doesNotMatch(JSON.stringify(unverified), /rita@example\.com|5555 0001|@rita|lucia@example\.com|300 111|@lucia|sin-nombre/);
    // La misma clienta en una cotización recibida no se repite como fila sin contacto.
    assert.equal(unverified.filter((c) => c.client_full_name.toLowerCase() === 'marina ibáñez').length, 1);

    // Verificado: contacto de las recibidas, salvo la rechazada por el cliente.
    const verified = logic.clientContacts({ rows: CONTACT_ROWS, artist: { verification_state: 'Yes' } });
    assert.deepEqual(verified.map((c) => [c.client_full_name, c.contact_visible, c.client_email]), [
        ['Rita Rechazo', false, null],
        ['Lucía Fernández', true, 'lucia@example.com'],
        ['Marina Ibáñez', true, 'marina@example.com'],
        ['marina ibáñez', true, 'marina@example.com']
    ]);
    assert.doesNotMatch(JSON.stringify(verified), /rita@example\.com|5555 0001|@rita/, 'rechazada: ni el verificado');
    assert.deepEqual(logic.clientContacts({ rows: null, artist: null }), []);
    assert.deepEqual(logic.clientContacts(), []);
});

test('GET client-contacts: exige sesión y entrega el contacto según el artista que llama', async () => {
    const closed = harness({ users: USERS, contacts: CONTACT_ROWS });
    const anon = await call(closed.handlers.clientContacts, {});
    assert.equal(anon.statusCode, 401);
    assert.deepEqual(closed.db.contactReads, [], 'sin sesión no se lee nada');

    const hidden = await call(closed.handlers.clientContacts, { headers: ARTIST_AUTH });
    assert.equal(hidden.statusCode, 200);
    assert.equal(hidden.headers['Cache-Control'], 'no-store');
    assert.equal(hidden.body.verification_state, 'No');
    assert.deepEqual(closed.db.contactReads, [ARTIST], 'siempre las cotizaciones del que llama');
    assert.deepEqual(hidden.body.contacts.map((c) => [c.client_full_name, c.client_city_residence, c.contact_visible]), [
        ['Rita Rechazo', 'Rosario', false], ['Lucía Fernández', 'Medellín', false], ['Marina Ibáñez', 'Buenos Aires', true]
    ]);
    assert.doesNotMatch(JSON.stringify(hidden.body), /rita@example\.com|lucia@example\.com|300 111|5555 0001|quote_status|quotation_medium/);

    const verified = harness({ users: USERS, contacts: CONTACT_ROWS, artist: { user_id: ARTIST, verification_state: 'Yes' } });
    const shown = await call(verified.handlers.clientContacts, { headers: ARTIST_AUTH });
    assert.equal(shown.body.verification_state, 'Yes');
    assert.equal(shown.body.contacts.find((c) => c.client_full_name === 'Lucía Fernández').client_whatsapp, '+57 300 111 2233');
    assert.equal(shown.body.contacts.find((c) => c.client_full_name === 'Rita Rechazo').client_email, null);

    // Otro artista solo ve lo suyo (acá, nada).
    const other = await call(verified.handlers.clientContacts, { headers: { authorization: 'Bearer otro' } });
    assert.deepEqual(other.body.contacts, []);
    // Un fallo de la base no devuelve el error crudo.
    const broken = harness({ users: USERS });
    broken.repo.listContactsForArtist = async () => { throw new Error('PGRST500 detalle interno'); };
    const failed = await call(broken.handlers.clientContacts, { headers: ARTIST_AUTH });
    assert.equal(failed.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(failed.body), /PGRST|interno/);
});

test('contacto: la respuesta no lleva datos cuando no corresponde', () => {
    const hidden = logic.contactResponse({ quote: quoteRow(), artist: { verification_state: 'No' } });
    assert.deepEqual(hidden, { visible: false, reason: 'not_verified', verification_state: 'No', email: null, whatsapp: null, instagram: null, preference: null });
    assert.doesNotMatch(JSON.stringify(hidden), /lucia|300 111/);
    const shown = logic.contactResponse({ quote: quoteRow(), artist: { verification_state: 'Yes' } });
    assert.deepEqual(shown, {
        visible: true, reason: 'verified', verification_state: 'Yes',
        email: 'lucia@example.com', whatsapp: '+57 300 111 2233', instagram: '@lucia.f', preference: 'Whatsapp, Email'
    });
});

// ------------------------------------------------------------ perfil del cliente [P6]

test('perfil del cliente: historial con este artista y reseñas, sin contacto ni salud', () => {
    const profile = logic.clientProfile({
        client: { full_name: 'Lucía Fernández', profile_picture: 'https://cdn.example/l.jpg', city_residence: 'Medellín', country: 'Colombia', created_at: '2026-03-02T00:00:00Z', public_username: 'luciaf' },
        profile: { first_name: 'Lu', photo_url: 'javascript:alert(1)' },
        quote: quoteRow(),
        quotes: [
            { id: 1, quote_status: 'completed', created_at: '2026-04-01T00:00:00Z', artist_responded_at: '2026-04-02T00:00:00Z' },
            { id: 2, quote_status: 'pending', created_at: '2026-10-01T00:00:00Z' },
            { id: 3, quote_status: 'in_progress', created_at: '2026-11-01T00:00:00Z' } // borrador del cotizador: no cuenta
        ],
        sessions: [
            { quotation_id: 1, status: 'completed' }, { quotation_id: 1, status: 'completed' },
            { quotation_id: 2, status: 'scheduled' }, { quotation_id: 2, status: 'cancelled' },
            { quotation_id: 99, status: 'completed' } // de otra cotización
        ],
        reviews: [{ rating: 5, comment: 'Excelente', reviewee_type: 'artist', reviewee_display_name: 'Mateo Rivas', created_at: '2026-05-01T00:00:00Z' }],
        reviewsCount: 4
    });
    assert.equal(profile.name, 'Lucía Fernández');
    assert.equal(profile.photo_url, 'https://cdn.example/l.jpg');
    assert.equal(profile.city, 'Medellín');
    assert.equal(profile.member_since, '2026-03-02T00:00:00Z');
    assert.deepEqual(profile.with_artist, { quotations: 2, completed: 1, sessions_done: 2, sessions_scheduled: 1, first_quote_at: '2026-04-01T00:00:00.000Z' });
    assert.equal(profile.reviews.length, 1);
    assert.deepEqual(profile.reviews[0], { rating: 5, comment: 'Excelente', about: 'Mateo Rivas', about_type: 'artist', created_at: '2026-05-01T00:00:00Z' });
    assert.equal(profile.reviews_count, 4);
    const text = JSON.stringify(profile);
    assert.doesNotMatch(text, /@example\.com|300 111|SECRETO|lucia\.f/, 'el perfil no trae contacto ni salud');
    // Foto con esquema raro → se descarta; nombre de respaldo desde la cotización.
    const fallback = logic.clientProfile({ client: null, profile: { photo_url: 'javascript:alert(1)' }, quote: quoteRow() });
    assert.equal(fallback.photo_url, null);
    assert.equal(fallback.name, 'Lucía Fernández');
    assert.equal(fallback.with_artist.quotations, 0);
});

// ------------------------------------------------------------ token y enlaces [P30]

test('token: 256 bits aleatorios en base64url; en la base solo su SHA-256', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => logic.newShareToken()));
    assert.equal(tokens.size, 200, 'tokens únicos');
    for (const token of tokens) {
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        assert.ok(logic.isValidToken(token));
        assert.equal(Buffer.from(token, 'base64url').length, 32);
    }
    const hash = logic.hashToken('abc');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const bad of ['', 'corto', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '!', null, undefined, 42, '../etc/passwd']) {
        assert.equal(logic.isValidToken(bad), false, String(bad));
    }
});

test('enlaces: vencimiento acotado, estado y resumen sin secretos', () => {
    assert.equal(logic.normalizeShareDays(7), 7);
    assert.equal(logic.normalizeShareDays('90'), 90);
    for (const bad of [undefined, null, 0, -1, 365, 'x', 31]) assert.equal(logic.normalizeShareDays(bad), 30, String(bad));
    assert.equal(logic.shareExpiry(7, NOW), '2026-11-23T12:00:00.000Z');
    assert.equal(logic.shareExpiry(undefined, NOW), '2026-12-16T12:00:00.000Z');
    assert.equal(logic.shareUrl('https://beta.weotzi.com/', 'TOKEN'), 'https://beta.weotzi.com/cotizacion/TOKEN');

    const live = { id: 'l1', expires_at: '2026-11-20T00:00:00Z', revoked_at: null, view_count: 3, created_at: '2026-11-15T00:00:00Z', token_hash: 'x'.repeat(64) };
    assert.equal(logic.linkState(live, NOW), 'active');
    assert.equal(logic.linkState({ ...live, expires_at: '2026-11-16T11:59:59Z' }, NOW), 'expired');
    assert.equal(logic.linkState({ ...live, revoked_at: '2026-11-15T10:00:00Z' }, NOW), 'revoked');
    assert.equal(logic.linkState({ ...live, expires_at: 'no-es-fecha' }, NOW), 'expired');
    assert.equal(logic.linkState(null, NOW), 'revoked');
    const summary = logic.linkSummary(live, NOW);
    assert.deepEqual(Object.keys(summary).sort(), ['claimed', 'created_at', 'expires_at', 'id', 'last_viewed_at', 'state', 'view_count']);
    assert.doesNotMatch(JSON.stringify(summary), /token|xxxx/);
    assert.equal(logic.activeLinks([live, { ...live, id: 'l2', revoked_at: 'x' }], NOW).length, 1);
});

test('compartir: solo el artista dueño y nunca un borrador del cotizador', () => {
    const user = { id: ARTIST };
    assert.equal(logic.shareVerdict({ user, quote: quoteRow() }).ok, true);
    assert.equal(logic.shareVerdict({ user: null, quote: quoteRow() }).status, 401);
    assert.equal(logic.shareVerdict({ user: { id: OTHER_ARTIST }, quote: quoteRow() }).status, 404);
    assert.equal(logic.shareVerdict({ user, quote: null }).status, 404);
    const draft = quoteRow({ quote_status: 'in_progress' });
    assert.equal(logic.shareVerdict({ user, quote: draft }).code, 'draft');
    // in_progress con propuesta ya es trabajo en curso: se comparte.
    assert.equal(logic.shareVerdict({ user, quote: quoteRow({ quote_status: 'in_progress', final_budget_amount: '500' }) }).ok, true);
});

// ------------------------------------------------------------ hoja pública

test('hoja: lista blanca; nunca salud, contacto, notas privadas ni correos', () => {
    const quote = quoteRow({
        quote_status: 'responded', artist_budget_amount: '410.000', artist_budget_currency: 'COP', artist_session_minutes: 150,
        artist_deposit_pct: 30, artist_deposit_amount: 123000, artist_availability: 'Fines de semana',
        artist_responded_at: '2026-11-12T09:00:00Z', quote_expiry_enabled: true, quote_expires_at: '2026-11-26T09:00:00Z', quote_expiry_days: 14
    });
    const sheet = logic.buildSheet({
        quote,
        artist: { name: 'Mateo Rivas', username: 'mateoink.wo', email: 'SECRETO-EMAIL-ARTISTA@example.com', verification_state: 'Yes', profile_picture: 'https://cdn.example/m.jpg', city: 'Bogotá' },
        sessions: [
            { session_number: 2, session_date: '2026-12-10T15:00:00Z', status: 'scheduled' },
            { session_number: 1, session_date: '2026-12-01T15:00:00Z', status: 'completed' },
            { session_number: 3, session_date: '2026-12-20T15:00:00Z', status: 'cancelled' }
        ],
        link: { expires_at: '2026-12-16T12:00:00Z', token_hash: 'SECRETO-HASH' },
        base: 'https://beta.weotzi.com', now: NOW
    });
    const text = JSON.stringify(sheet);
    for (const secret of ['SECRETO', 'lucia@example.com', '300 111', 'lucia.f', 'Whatsapp, Email', '1990-01-01', 'mateo@example.com']) {
        assert.ok(!text.includes(secret), `la hoja filtra ${secret}`);
    }
    for (const column of logic.PRIVATE_COLUMNS) assert.ok(!(column in sheet), `columna privada ${column} en la hoja`);
    assert.equal(sheet.quote_id, 'COT-AB12CD');
    assert.equal(sheet.status, 'responded');
    assert.equal(sheet.status_label, 'Propuesta enviada');
    assert.equal(sheet.client_name, 'Lucía Fernández');
    assert.deepEqual(sheet.facts, { style: 'Tradicional', body_part: 'Antebrazo · Izquierdo', size: '10-15 cm', color: 'Color', cover_up: false });
    assert.deepEqual(sheet.proposal, {
        has_proposal: true, agreed: false, amount: 410000, currency: 'COP', sessions: 2, session_minutes: 150,
        deposit_pct: 30, deposit_amount: 123000, balance: 287000, availability: 'Fines de semana', location: 'Estudio Norte'
    });
    assert.equal(sheet.valid_until, '2026-11-26T09:00:00Z');
    assert.equal(sheet.breakdown, null);
    assert.equal(sheet.terms, null);
    assert.deepEqual(sheet.sessions.map((s) => [s.number, s.done]), [[1, true], [2, false]]);
    assert.deepEqual(sheet.artist, {
        name: 'Mateo Rivas', username: 'mateoink.wo', profile_url: 'https://beta.weotzi.com/mateoink',
        city: 'Bogotá', studio: 'Estudio Norte', photo_url: 'https://cdn.example/m.jpg', verified: true
    });
    assert.deepEqual(sheet.link, { expires_at: '2026-12-16T12:00:00Z' });
    assert.deepEqual(sheet.claim, { linked: false });
});

test('hoja: cotización manual con desglose, términos y seña; sin propuesta queda "a definir"', () => {
    const manualQuote = quoteRow({
        quote_id: 'COT-MAN001', source: 'manual', quotation_medium: 'manual', quote_status: 'responded',
        project_description: 'Manga japonesa', artist_budget_amount: '900', artist_budget_currency: 'USD', tattoo_estimated_sessions: '3'
    });
    const sheet = logic.buildSheet({ quote: manualQuote, manual: MANUAL_DETAILS, artist: { name: 'Mateo Rivas' }, base: '', now: NOW });
    assert.equal(sheet.is_manual, true);
    assert.equal(sheet.title, 'Manga japonesa');
    assert.equal(sheet.breakdown.items.length, 2);
    assert.deepEqual(sheet.breakdown.items[1], { name: 'Sesión', description: null, qty: 3, price: 300, total: 900 });
    assert.equal(sheet.breakdown.subtotal, 1000);
    assert.equal(sheet.breakdown.discount_amount, 100);
    assert.equal(sheet.breakdown.total, 900);
    assert.equal(sheet.breakdown.currency, 'USD');
    assert.equal(sheet.proposal.amount, 900);
    assert.equal(sheet.proposal.deposit_pct, 30);
    assert.equal(sheet.proposal.deposit_amount, 270);
    assert.equal(sheet.proposal.balance, 630);
    assert.equal(sheet.proposal.session_minutes, 240);
    assert.equal(sheet.proposal.location, 'Estudio Norte, Chapinero');
    assert.deepEqual(sheet.terms, { validity_days: null, policy: 'no-reembolsable-48', client_notes: 'Trae ropa cómoda.', extra_terms: 'Retoque incluido.' });
    // Política "sin seña": no se inventa una seña.
    const noDeposit = logic.buildSheet({ quote: manualQuote, manual: { ...MANUAL_DETAILS, cancellation_policy: 'sin-sena' }, now: NOW });
    assert.equal(noDeposit.proposal.deposit_pct, null);
    assert.equal(noDeposit.proposal.deposit_amount, null);
    // Solicitud sin responder.
    const pending = logic.buildSheet({ quote: quoteRow(), now: NOW });
    assert.equal(pending.proposal.has_proposal, false);
    assert.equal(pending.proposal.amount, null);
    assert.equal(pending.status_label, 'Solicitud recibida');
    // Acuerdo final: manda el presupuesto final.
    const agreed = logic.buildSheet({ quote: quoteRow({ quote_status: 'client_approved', artist_budget_amount: '500', artist_budget_currency: 'USD', final_budget_amount: '450', final_budget_currency: 'EUR', final_sessions: '4' }), now: NOW });
    assert.deepEqual([agreed.proposal.amount, agreed.proposal.currency, agreed.proposal.agreed, agreed.proposal.sessions], [450, 'EUR', true, 4]);
});

// ------------------------------------------------------------ vínculo desde el enlace

test('vínculo: manual alcanza con el enlace; recibida exige el email verificado de la solicitud', () => {
    const link = { id: 'l1', quotation_id: 77, artist_id: ARTIST, expires_at: '2026-12-01T00:00:00Z', revoked_at: null };
    const verifiedUser = { id: CLIENT, email: 'Lucia@Example.com', raw: { email_confirmed_at: '2026-11-01T00:00:00Z' } };
    const manual = quoteRow({ source: 'manual', quotation_medium: 'manual', client_email: null });
    const args = (extra) => ({ user: verifiedUser, quote: quoteRow(), link, isClientAccount: true, now: NOW, ...extra });

    assert.deepEqual(logic.claimVerdict(args()), { ok: true, claim: true, setEmail: false });
    assert.deepEqual(logic.claimVerdict(args({ quote: manual })), { ok: true, claim: true, setEmail: true });
    // Manual con email cargado por el artista: no se pisa.
    assert.equal(logic.claimVerdict(args({ quote: { ...manual, client_email: 'otro@example.com' } })).setEmail, false);
    // Manual + cuenta sin email confirmado: se vincula igual, sin copiar el email.
    assert.deepEqual(logic.claimVerdict(args({ quote: manual, user: { id: CLIENT, email: 'x@example.com', raw: {} } })), { ok: true, claim: true, setEmail: false });

    assert.equal(logic.claimVerdict(args({ user: null })).status, 401);
    assert.equal(logic.claimVerdict(args({ user: { id: CLIENT, email: 'otra@example.com', raw: { email_confirmed_at: 'x' } } })).code, 'email_mismatch');
    assert.equal(logic.claimVerdict(args({ user: { id: CLIENT, email: 'lucia@example.com', raw: {} } })).code, 'email_unverified');
    assert.equal(logic.claimVerdict(args({ user: { id: CLIENT, email: 'lucia@example.com', raw: { email_confirmed_at: 'x', app_metadata: { qa_unverified_email: true } } } })).code, 'email_unverified');
    assert.equal(logic.claimVerdict(args({ isClientAccount: false })).code, 'not_client');
    assert.equal(logic.claimVerdict(args({ user: { id: ARTIST, email: 'mateo@example.com', raw: {} } })).code, 'own');
    assert.deepEqual(logic.claimVerdict(args({ quote: quoteRow({ client_user_id: CLIENT }) })), { ok: true, already: true });
    assert.equal(logic.claimVerdict(args({ quote: quoteRow({ client_user_id: OTHER_ARTIST }) })).code, 'claimed');
    // Enlace vencido, revocado o de otra cotización / artista.
    assert.equal(logic.claimVerdict(args({ link: { ...link, expires_at: '2026-11-01T00:00:00Z' } })).status, 410);
    assert.equal(logic.claimVerdict(args({ link: { ...link, revoked_at: '2026-11-15T00:00:00Z' } })).status, 410);
    assert.equal(logic.claimVerdict(args({ link: { ...link, quotation_id: 78 } })).status, 410);
    assert.equal(logic.claimVerdict(args({ link: { ...link, artist_id: OTHER_ARTIST } })).status, 410);
});

// ------------------------------------------------------------ rutas con dobles

function fakeRes() {
    return {
        statusCode: 200, headers: {}, body: undefined, file: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        sendFile(file) { this.file = file; return this; }
    };
}

function harness({ quote = quoteRow(), artist = { user_id: ARTIST, name: 'Mateo Rivas', username: 'mateoink.wo', verification_state: 'No' }, users = {}, clients = [CLIENT], manual = null, contacts = [] } = {}) {
    const db = { quote: { ...quote }, links: [], touched: [], emails: [], claimedLinks: [], contactReads: [] };
    const repo = {
        listContactsForArtist: async (artistId) => { db.contactReads.push(artistId); return artistId === ARTIST ? contacts.map((row) => ({ ...row })) : []; },
        getQuote: async (quoteId) => (db.quote && db.quote.quote_id === quoteId ? { ...db.quote } : null),
        getQuoteById: async (id) => (db.quote && db.quote.id === id ? { ...db.quote } : null),
        getArtist: async (userId) => (artist && artist.user_id === userId ? { ...artist } : null),
        getManualQuote: async () => manual,
        listSessions: async () => [],
        getClient: async () => ({ user_id: CLIENT, full_name: 'Lucía Fernández', created_at: '2026-03-02T00:00:00Z' }),
        getClientProfile: async () => null,
        isClientAccount: async (userId) => clients.includes(userId),
        listQuotesBetween: async () => [{ id: 77, quote_status: 'pending', created_at: '2026-11-10T10:00:00Z' }],
        listSessionsForQuotations: async () => [],
        listClientReviews: async () => ({ rows: [], count: 0 }),
        listLinks: async (quotationId) => db.links.filter((l) => l.quotation_id === quotationId).map((l) => ({ ...l })),
        findLinkByHash: async (hash) => { const l = db.links.find((row) => row.token_hash === hash); return l ? { ...l } : null; },
        insertLink: async (row) => { const saved = { id: `link-${db.links.length + 1}`, revoked_at: null, view_count: 0, last_viewed_at: null, claimed_at: null, ...row }; db.links.push(saved); return { ...saved }; },
        revokeLinks: async (quotationId, { id, at }) => {
            const hit = db.links.filter((l) => l.quotation_id === quotationId && !l.revoked_at && (!id || l.id === id));
            hit.forEach((l) => { l.revoked_at = at; });
            return hit.map((l) => ({ id: l.id }));
        },
        touchLink: async (hash) => { db.touched.push(hash); },
        markLinkClaimed: async (id, userId) => { db.claimedLinks.push([id, userId]); },
        claimQuote: async (id, userId, extra) => {
            if (!db.quote || db.quote.id !== id || db.quote.client_user_id) return null;
            Object.assign(db.quote, extra, { client_user_id: userId });
            return { id, quote_id: db.quote.quote_id, client_user_id: userId };
        }
    };
    const handlers = routes.createHandlers({
        repo,
        resolveBearerUser: async (req) => users[(req.headers && req.headers.authorization) || ''] || null,
        emailService: { sendEmail: async (eventId, payload, options) => { db.emails.push({ eventId, payload, options }); return { ok: true }; } },
        applicationBase: () => 'https://beta.weotzi.com',
        reservedHandles: () => new Set(),
        logger: { log() {}, warn() {}, error() {} },
        now: () => NOW,
        publicDir: path.join(ROOT, 'public')
    });
    return { db, repo, handlers };
}

const ARTIST_AUTH = { authorization: 'Bearer artista' };
const USERS = {
    'Bearer artista': { id: ARTIST, email: 'mateo@example.com', raw: { email_confirmed_at: '2026-01-01T00:00:00Z' } },
    'Bearer otro': { id: OTHER_ARTIST, email: 'otro@example.com', raw: { email_confirmed_at: '2026-01-01T00:00:00Z' } },
    'Bearer cliente': { id: CLIENT, email: 'lucia@example.com', raw: { email_confirmed_at: '2026-01-01T00:00:00Z' } },
    'Bearer cliente-otro-mail': { id: CLIENT, email: 'otra@example.com', raw: { email_confirmed_at: '2026-01-01T00:00:00Z' } }
};

async function call(handler, req) {
    const res = fakeRes();
    await handler({ headers: {}, params: {}, query: {}, body: {}, ...req }, res);
    return res;
}

test('GET info: exige sesión y que la cotización sea del artista; el contacto sigue la regla', async () => {
    const { handlers } = harness({ users: USERS });
    const params = { quoteId: 'COT-AB12CD' };
    assert.equal((await call(handlers.info, { params })).statusCode, 401);
    assert.equal((await call(handlers.info, { params, headers: { authorization: 'Bearer otro' } })).statusCode, 404, 'otro artista no la ve');
    assert.equal((await call(handlers.info, { params: { quoteId: '../x' }, headers: ARTIST_AUTH })).statusCode, 400);
    assert.equal((await call(handlers.info, { params: { quoteId: 'COT-NOEXISTE' }, headers: ARTIST_AUTH })).statusCode, 404);

    const hidden = await call(handlers.info, { params, headers: ARTIST_AUTH });
    assert.equal(hidden.statusCode, 200);
    assert.equal(hidden.headers['Cache-Control'], 'no-store');
    assert.equal(hidden.body.contact.visible, false);
    assert.equal(hidden.body.contact.reason, 'not_verified');
    assert.doesNotMatch(JSON.stringify(hidden.body), /lucia@example\.com|300 111|SECRETO/, 'sin verificar no viaja el contacto (ni la salud)');
    assert.deepEqual(hidden.body.client, { registered: false });
    assert.deepEqual(hidden.body.share.links, []);

    const verified = harness({ users: USERS, artist: { user_id: ARTIST, verification_state: 'Yes' } });
    const shown = await call(verified.handlers.info, { params, headers: ARTIST_AUTH });
    assert.equal(shown.body.contact.visible, true);
    assert.equal(shown.body.contact.email, 'lucia@example.com');
    assert.equal(shown.body.contact.whatsapp, '+57 300 111 2233');

    const rejected = harness({ users: USERS, artist: { user_id: ARTIST, verification_state: 'Yes' }, quote: quoteRow({ quote_status: 'client_rejected' }) });
    const gone = await call(rejected.handlers.info, { params, headers: ARTIST_AUTH });
    assert.equal(gone.body.contact.visible, false);
    assert.equal(gone.body.contact.reason, 'client_rejected');
    assert.equal(gone.body.contact.email, null);

    const manual = harness({ users: USERS, quote: quoteRow({ source: 'manual', quotation_medium: 'manual' }) });
    const own = await call(manual.handlers.info, { params, headers: ARTIST_AUTH });
    assert.equal(own.body.contact.visible, true);
    assert.equal(own.body.contact.reason, 'manual');
    assert.equal(own.body.manual, true);
});

test('GET client-profile: solo el artista de la cotización y solo si el cliente tiene cuenta', async () => {
    const guest = harness({ users: USERS });
    const params = { quoteId: 'COT-AB12CD' };
    const none = await call(guest.handlers.clientProfile, { params, headers: ARTIST_AUTH });
    assert.equal(none.statusCode, 404);
    assert.equal(none.body.code, 'not_registered');

    const registered = harness({ users: USERS, quote: quoteRow({ client_user_id: CLIENT }) });
    assert.equal((await call(registered.handlers.clientProfile, { params })).statusCode, 401);
    assert.equal((await call(registered.handlers.clientProfile, { params, headers: { authorization: 'Bearer otro' } })).statusCode, 404);
    const ok = await call(registered.handlers.clientProfile, { params, headers: ARTIST_AUTH });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.profile.name, 'Lucía Fernández');
    assert.equal(ok.body.profile.with_artist.quotations, 1);
    assert.doesNotMatch(JSON.stringify(ok.body), /@example\.com|300 111|SECRETO/);
});

test('POST share: crea el enlace, devuelve el token una sola vez y guarda solo el hash', async () => {
    const { handlers, db } = harness({ users: USERS });
    const params = { quoteId: 'COT-AB12CD' };
    assert.equal((await call(handlers.createShare, { params })).statusCode, 401);
    assert.equal((await call(handlers.createShare, { params, headers: { authorization: 'Bearer otro' } })).statusCode, 404);

    const created = await call(handlers.createShare, { params, headers: ARTIST_AUTH, body: { days: 7 } });
    assert.equal(created.statusCode, 201);
    const match = /^https:\/\/beta\.weotzi\.com\/cotizacion\/([A-Za-z0-9_-]{43})$/.exec(created.body.url);
    assert.ok(match, 'URL pública con el token');
    assert.equal(db.links.length, 1);
    assert.equal(db.links[0].token_hash, logic.hashToken(match[1]));
    assert.ok(!JSON.stringify(db.links[0]).includes(match[1]), 'el token en claro no se guarda');
    assert.equal(db.links[0].expires_at, '2026-11-23T12:00:00.000Z');
    assert.equal(db.links[0].artist_id, ARTIST);
    assert.ok(!('token_hash' in created.body.link), 'el hash no sale al navegador');
    assert.equal(created.body.link.state, 'active');

    // info lista el enlace sin token.
    const info = await call(handlers.info, { params, headers: ARTIST_AUTH });
    assert.equal(info.body.share.links.length, 1);
    assert.ok(!JSON.stringify(info.body).includes(match[1]));

    // Tope de enlaces activos.
    for (let i = 1; i < logic.MAX_ACTIVE_LINKS; i += 1) {
        assert.equal((await call(handlers.createShare, { params, headers: ARTIST_AUTH })).statusCode, 201);
    }
    const tooMany = await call(handlers.createShare, { params, headers: ARTIST_AUTH });
    assert.equal(tooMany.statusCode, 409);
    assert.equal(tooMany.body.code, 'too_many');

    // Revocar: uno por id (validado) y después todos.
    assert.equal((await call(handlers.revokeShare, { params, headers: ARTIST_AUTH, query: { id: 'no-es-uuid' } })).statusCode, 400);
    assert.equal((await call(handlers.revokeShare, { params, headers: { authorization: 'Bearer otro' } })).statusCode, 404);
    const revoked = await call(handlers.revokeShare, { params, headers: ARTIST_AUTH });
    assert.equal(revoked.body.revoked, logic.MAX_ACTIVE_LINKS);
    assert.ok(db.links.every((l) => l.revoked_at));
    const gone = await call(handlers.publicSheet, { params: { token: match[1] } });
    assert.equal(gone.statusCode, 410);
    assert.equal(gone.body.code, 'revoked');
});

test('POST share: un borrador del cotizador no se comparte', async () => {
    const { handlers, db } = harness({ users: USERS, quote: quoteRow({ quote_status: 'in_progress' }) });
    const res = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'draft');
    assert.equal(db.links.length, 0);
    assert.equal((await call(handlers.sheet, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH })).statusCode, 409);
});

test('GET público: token inválido 404, vencido 410, vigente devuelve la hoja sin datos privados', async () => {
    const { handlers, db } = harness({ users: USERS, quote: quoteRow({ quote_status: 'responded', artist_budget_amount: '300', artist_budget_currency: 'USD' }) });
    assert.equal((await call(handlers.publicSheet, { params: { token: 'corto' } })).statusCode, 404);
    assert.equal((await call(handlers.publicSheet, { params: { token: logic.newShareToken() } })).statusCode, 404, 'token desconocido');

    const created = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const token = created.body.url.split('/').pop();
    const open = await call(handlers.publicSheet, { params: { token } });
    assert.equal(open.statusCode, 200);
    assert.equal(open.headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.equal(open.headers['Cache-Control'], 'no-store');
    assert.equal(open.body.sheet.quote_id, 'COT-AB12CD');
    assert.equal(open.body.sheet.proposal.amount, 300);
    assert.deepEqual(open.body.viewer, { signed_in: false });
    assert.doesNotMatch(JSON.stringify(open.body), /SECRETO|lucia@example\.com|300 111|lucia\.f|mateo@example\.com/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(db.touched, [logic.hashToken(token)], 'cuenta la vista');

    // Con sesión: el visor sabe si puede vincular.
    const asClient = await call(handlers.publicSheet, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.deepEqual(asClient.body.viewer, { signed_in: true, linked: false, can_claim: true, reason: null, message: null });
    const asArtist = await call(handlers.publicSheet, { params: { token }, headers: ARTIST_AUTH });
    assert.equal(asArtist.body.viewer.reason, 'own');

    // Vencido.
    db.links[0].expires_at = '2026-11-16T11:00:00.000Z';
    const expired = await call(handlers.publicSheet, { params: { token } });
    assert.equal(expired.statusCode, 410);
    assert.equal(expired.body.code, 'expired');
    assert.equal(expired.body.sheet, undefined);
    // Si la cotización cambia de artista, el enlace muere.
    db.links[0].expires_at = '2026-12-16T11:00:00.000Z';
    db.quote.artist_id = OTHER_ARTIST;
    assert.equal((await call(handlers.publicSheet, { params: { token } })).statusCode, 404);
});

test('POST claim: vincula la cotización a la cuenta del cliente y avisa al artista', async () => {
    const manual = quoteRow({ source: 'manual', quotation_medium: 'manual', quote_status: 'responded', client_email: null, artist_budget_amount: '900', artist_budget_currency: 'USD' });
    const { handlers, db } = harness({ users: USERS, quote: manual, manual: MANUAL_DETAILS });
    const created = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const token = created.body.url.split('/').pop();

    assert.equal((await call(handlers.claim, { params: { token } })).statusCode, 401);
    const own = await call(handlers.claim, { params: { token }, headers: ARTIST_AUTH });
    assert.equal(own.statusCode, 409);
    assert.equal(own.body.code, 'own');
    assert.equal(db.quote.client_user_id, null);

    const ok = await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body, { success: true, already: false, quote_id: 'COT-AB12CD', dashboard_path: '/client/dashboard?quote=COT-AB12CD' });
    assert.equal(db.quote.client_user_id, CLIENT);
    assert.equal(db.quote.client_email, 'lucia@example.com', 'manual sin email: se completa con el de la cuenta verificada');
    assert.deepEqual(db.claimedLinks, [['link-1', CLIENT]]);
    assert.equal(db.emails.length, 1);
    assert.equal(db.emails[0].eventId, 'shared_quotation_linked');
    assert.equal(db.emails[0].payload.artist_email, 'mateo@example.com');
    assert.equal(db.emails[0].payload.quotation_url, 'https://beta.weotzi.com/my-quotations/detail?quote=COT-AB12CD');
    assert.equal(db.emails[0].payload.quote_code, 'COT-AB12CD', 'sin código corto se muestra el quote_id');
    assert.equal(db.emails[0].options.idempotencyKey, `cot-detalle:linked:COT-AB12CD:${CLIENT}`);
    assert.doesNotMatch(JSON.stringify(db.emails[0].payload), /SECRETO|300 111|lucia@example\.com/, 'el aviso no lleva contacto ni salud');

    // Idempotente: repetir no duplica ni vuelve a avisar.
    const again = await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.equal(again.body.already, true);
    assert.equal(db.emails.length, 1);
    // La hoja pública ahora dice que ya tiene cuenta.
    const sheet = await call(handlers.publicSheet, { params: { token } });
    assert.equal(sheet.body.sheet.claim.linked, true);
});

test('CF-03: la hoja pública y el aviso de vínculo llevan el código corto de la cotización', async () => {
    const manual = quoteRow({ source: 'manual', quotation_medium: 'manual', quote_status: 'responded', client_email: null, artist_budget_amount: '900', artist_budget_currency: 'USD' });
    const { handlers, db, repo } = harness({ users: USERS, quote: manual, manual: MANUAL_DETAILS });
    const asked = [];
    repo.getShortCode = async (id) => { asked.push(id); return 'AB23CD'; };
    const created = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const token = created.body.url.split('/').pop();
    const open = await call(handlers.publicSheet, { params: { token } });
    assert.equal(open.body.sheet.short_code, 'AB23CD');
    assert.equal(open.body.sheet.quote_id, 'COT-AB12CD');
    assert.ok(asked.length >= 1 && asked.every((id) => id === manual.id), 'se pide por el id de la cotización');
    await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.equal(db.emails[0].payload.quote_code, 'AB23CD');
    assert.equal(db.emails[0].payload.quote_id, 'COT-AB12CD');

    // Base sin la columna (la lectura falla): la hoja sale igual, con el quote_id como referencia.
    const legacy = harness({ users: USERS, quote: manual, manual: MANUAL_DETAILS });
    legacy.repo.getShortCode = async () => { throw new Error('42703 column short_code does not exist'); };
    const made = await call(legacy.handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const plain = await call(legacy.handlers.publicSheet, { params: { token: made.body.url.split('/').pop() } });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.body.sheet.short_code, null);

    // El repositorio real lo lee aparte y nunca lanza.
    const stub = (result) => () => {
        const q = { select: () => q, eq: () => q, limit: () => q, single: () => q, execute: async () => { if (result instanceof Error) throw result; return result; } };
        return q;
    };
    assert.equal(await repoModule.createRepo({ query: stub(new Error('42703')) }).getShortCode(77), null);
    assert.equal(await repoModule.createRepo({ query: stub({ short_code: 'AB23CD' }) }).getShortCode(77), 'AB23CD');
});

test('POST claim: una cotización recibida no se vincula a una cuenta con otro correo', async () => {
    const { handlers, db } = harness({ users: USERS, quote: quoteRow({ quote_status: 'responded', artist_budget_amount: '300' }) });
    const created = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const token = created.body.url.split('/').pop();
    const mismatch = await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente-otro-mail' } });
    assert.equal(mismatch.statusCode, 403);
    assert.equal(mismatch.body.code, 'email_mismatch');
    assert.equal(db.quote.client_user_id, null);
    assert.equal(db.emails.length, 0);
    // Con el correo de la solicitud sí.
    const ok = await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(db.quote.client_user_id, CLIENT);
    assert.equal(db.quote.client_email, 'lucia@example.com');
});

test('POST claim: carrera perdida contra otra cuenta → 409', async () => {
    const manual = quoteRow({ source: 'manual', quotation_medium: 'manual', quote_status: 'responded' });
    const { handlers, db, repo } = harness({ users: USERS, quote: manual });
    const created = await call(handlers.createShare, { params: { quoteId: 'COT-AB12CD' }, headers: ARTIST_AUTH });
    const token = created.body.url.split('/').pop();
    repo.claimQuote = async () => { db.quote.client_user_id = OTHER_ARTIST; return null; };
    const lost = await call(handlers.claim, { params: { token }, headers: { authorization: 'Bearer cliente' } });
    assert.equal(lost.statusCode, 409);
    assert.equal(lost.body.code, 'claimed');
    assert.equal(db.emails.length, 0);
});

test('GET /cotizacion/:token: sirve la página sin caché, sin indexar y sin referrer', async () => {
    const { handlers } = harness();
    const ok = await call(handlers.page, { params: { token: logic.newShareToken() } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.file, path.join(ROOT, 'public', 'cotizacion', 'index.html'));
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.equal(ok.headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.equal(ok.headers['Referrer-Policy'], 'no-referrer');
    assert.equal((await call(handlers.page, { params: { token: 'abc' } })).statusCode, 404);
    assert.ok(fs.existsSync(ok.file));
});

test('register: rutas del frente, límites propios y una línea en server.js antes de la URL corta', () => {
    const seen = [];
    const add = (method) => (route, ...fns) => { seen.push(`${method} ${route}`); assert.ok(fns.every((fn) => typeof fn === 'function'), route); };
    const app = { get: add('GET'), post: add('POST'), delete: add('DELETE') };
    const limiter = (req, res, next) => next();
    routes.register(app, { repo: {}, resolveBearerUser: async () => null, emailService: {}, applicationBase: () => '', reservedHandles: () => new Set(), logger: console, publicLimiter: limiter, shareLimiter: limiter });
    assert.deepEqual(seen, [
        'GET /api/cot-detalle/client-contacts',
        'GET /api/cot-detalle/quotations/:quoteId/info',
        'GET /api/cot-detalle/quotations/:quoteId/client-profile',
        'GET /api/cot-detalle/quotations/:quoteId/sheet',
        'POST /api/cot-detalle/quotations/:quoteId/share',
        'DELETE /api/cot-detalle/quotations/:quoteId/share',
        'GET /api/cot-detalle/public/:token',
        'POST /api/cot-detalle/public/:token/claim',
        'GET /cotizacion/:token'
    ]);

    const server = read('server.js');
    const lines = server.split('\n').filter((line) => line.includes("require('./lib/routes/cot-detalle')"));
    assert.equal(lines.length, 1, 'una sola línea en server.js');
    assert.match(lines[0], /^require\('\.\/lib\/routes\/cot-detalle'\)\.register\(app, \{ publicDir: path\.join\(__dirname, 'public'\) \}\);/);
    const at = server.indexOf("require('./lib/routes/cot-detalle')");
    assert.ok(at < server.indexOf("require('./lib/routes/perfil').register("), 'antes de la URL corta /<handle>');
    assert.ok(at < server.indexOf('app.use(express.static('), 'antes del estático');
    assert.ok(at < server.indexOf('legacyRedirectFor(req.path'), 'antes de las redirecciones legacy');

    // /cotizacion no puede ser el handle de un artista.
    const PublicUrl = require('../public/shared/js/artist-public-url.js');
    assert.ok(PublicUrl.RESERVED.includes('cotizacion'));
    assert.equal(PublicUrl.parsePathHandle('cotizacion'), null);
});

test('repositorio: columnas explícitas y enlaces sin exponer el hash', () => {
    assert.doesNotMatch(repoModule.LINK_SELECT, /token/);
    for (const column of ['client_health_conditions', 'client_allergies', 'client_birth_date', 'client_age', 'notes']) {
        assert.ok(!repoModule.QUOTE_SELECT.split(',').includes(column), `${column} no hace falta en este frente`);
    }
    const calls = [];
    const fakeQuery = (table) => {
        const q = {
            table, ops: [],
            select(cols) { q.ops.push(['select', cols]); return q; },
            eq(c, v) { q.ops.push(['eq', c, v]); return q; },
            is(c, v) { q.ops.push(['is', c, v]); return q; },
            limit() { return q; }, single() { return q; }, order() { return q; },
            execute: async () => null,
            insert: async (row) => { calls.push({ table, op: 'insert', row, ops: q.ops }); return [{ id: 'x', ...row }]; },
            patch: async (body) => { calls.push({ table, op: 'patch', body, ops: q.ops }); return [{ id: 1 }]; }
        };
        return q;
    };
    fakeQuery.raw = async (rpcPath, opts) => { calls.push({ rpcPath, opts }); return null; };
    const repo = repoModule.createRepo({ query: fakeQuery });
    // Buscador de clientes: lo mínimo para aplicar la regla de contacto, sin salud ni notas.
    assert.deepEqual(repoModule.CONTACTS_SELECT.split(','), ['quote_status', 'source', 'quotation_medium', 'client_full_name',
        'client_email', 'client_whatsapp', 'client_instagram', 'client_city_residence', 'created_at']);
    const listed = [];
    const contactsRepo = repoModule.createRepo({ query: (table) => {
        const q = { select(cols) { listed.push(['select', table, cols]); return q; }, eq(c, v) { listed.push(['eq', c, v]); return q; },
            order(c, o) { listed.push(['order', c, o]); return q; }, limit(n) { listed.push(['limit', n]); return q; }, execute: async () => [] };
        return q;
    } });
    return (async () => {
        await contactsRepo.listContactsForArtist(ARTIST);
        assert.deepEqual(listed, [['select', 'quotations_db', repoModule.CONTACTS_SELECT], ['eq', 'artist_id', ARTIST],
            ['order', 'created_at', { ascending: false }], ['limit', 300]]);
        assert.deepEqual(await contactsRepo.listContactsForArtist(null), [], 'sin artista no consulta');
        await repo.claimQuote(77, CLIENT, { client_email: 'a@b.co' });
        const claim = calls.find((c) => c.table === 'quotations_db' && c.op === 'patch');
        assert.deepEqual(claim.body, { client_email: 'a@b.co', client_user_id: CLIENT });
        assert.ok(claim.ops.some((op) => op[0] === 'is' && op[1] === 'client_user_id' && op[2] === null), 'solo si sigue sin dueño');
        await repo.revokeLinks(77, { at: '2026-11-16T12:00:00Z' });
        const revoke = calls.find((c) => c.table === 'quotation_share_links' && c.op === 'patch');
        assert.ok(revoke.ops.some((op) => op[0] === 'is' && op[1] === 'revoked_at'));
        await repo.touchLink('h'.repeat(64));
        assert.deepEqual(calls[calls.length - 1], { rpcPath: 'rpc/touch_quotation_share_link', opts: { method: 'POST', body: { p_token_hash: 'h'.repeat(64) } } });
    })();
});

// ------------------------------------------------------------ email

test('email shared_quotation_linked: solo servidor, al artista, sin datos privados', () => {
    const { loadEmailEvents, validateEvent } = require('../services/email-events');
    const def = EVENTS.shared_quotation_linked;
    assert.equal(validateEvent('shared_quotation_linked', def, 'cot-detalle.js'), null);
    assert.equal(def.serverOnly, true);
    assert.equal(def.render.audience, 'artist');
    assert.equal(def.recipient({ artist_email: 'mateo@example.com', client_email: 'lucia@example.com' }), 'mateo@example.com');
    assert.ok(loadEmailEvents().events.shared_quotation_linked, 'lo carga el mapeo automáticamente');
    assert.equal(routes.LINKED_EVENT, 'shared_quotation_linked');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    assert.ok(SERVER_ONLY_EVENTS.has('shared_quotation_linked'), 'el navegador no puede dispararlo por /api/email/:eventId');

    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail('shared_quotation_linked', {
        quote_id: 'COT-AB12CD', artist_name: 'Mateo', artist_email: 'mateo@example.com', client_name: '<b>Lucía</b>',
        client_health_conditions: 'SECRETO-SALUD', client_whatsapp: '+57 300 111 2233'
    }, { role: 'artist' });
    assert.match(out.subject, /vinculó la cotización COT-AB12CD/);
    assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110);
    assert.equal(out.cta.url, 'https://beta.weotzi.com/my-quotations/detail?quote=COT-AB12CD');
    assert.doesNotMatch(out.html, /<b>Lucía<\/b>/, 'escapa el nombre');
    assert.doesNotMatch(out.html + out.text, /SECRETO|300 111/);
    const attribs = def.attribs({ quote_id: 'COT-1', client_whatsapp: 'x', client_health_conditions: 'y' });
    assert.deepEqual(Object.keys(attribs).sort(), ['artist_name', 'chat_url', 'client_name', 'quotation_url', 'quote_code', 'quote_id']);
    // CF-03: con código corto, el asunto y la fila lo muestran; el enlace sigue por quote_id.
    const coded = renderEmail('shared_quotation_linked', { quote_id: 'COT-AB12CD', quote_code: 'AB23CD', artist_email: 'mateo@example.com', client_name: 'Lucía' }, { role: 'artist' });
    assert.match(coded.subject, /vinculó la cotización AB23CD a su cuenta$/);
    assert.equal(coded.cta.url, 'https://beta.weotzi.com/my-quotations/detail?quote=COT-AB12CD');
});
