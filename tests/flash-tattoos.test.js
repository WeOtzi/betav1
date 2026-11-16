'use strict';
// Flash Tattoos (17 nov 2026): flashes con precio fijo y reserva.
//   modelo puro (flash-model.js) · lógica del servidor (lib/flash.js)
//   ruta POST /api/flash/request con dependencias inyectadas y de punta a punta
//   con el intake real (fetch simulado) · migración 20261117130000 y su reversa
//   · normalizadores de la galería · perfil (botón) · diálogo de respuesta
//   · fixtures de la demo. Sin red ni base real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://demo.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
const SUPA = process.env.SUPABASE_URL.replace(/\/$/, '');

const F = require('../public/shared/js/flash-model.js');
const flash = require('../lib/flash');
const cotForm = require('../lib/cot-form');
const intake = require('../services/quotation-intake');
const { createRequestHandler } = require('../lib/routes/flash');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ARTIST_ID = '11111111-2222-4333-8444-555555555555';
const CLIENT_ID = '99999999-8888-4777-8666-555555555555';
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const IMAGE = `${SUPA}/storage/v1/object/public/artist-gallery/${ARTIST_ID}/flash-golondrina.png`;

function flashItem(over = {}) {
    return {
        id: 'fl_golondrina01', url: IMAGE, kind: 'image', category: 'flash', title: 'Golondrina', created_at: '2026-11-10T00:00:00Z',
        flash: { price: 120, currency: 'USD', size_h_cm: 10, size_w_cm: 8, zones: ['Antebrazo'], available: true, mode: 'unique' },
        ...over
    };
}
function artistRow(items) {
    return { user_id: ARTIST_ID, username: 'ana.wo', name: 'Ana', email: 'ana@example.test', registration_status: 'aprobado', gallery_feed_items: items || [flashItem()] };
}
function validBody(over = {}) {
    return {
        submission_key: KEY, artist: 'ana.wo', flash_id: 'fl_golondrina01',
        client_full_name: 'Lucía', client_email: 'Lucia@Example.test', client_whatsapp: '+54 11 5555 0101',
        tattoo_is_first_tattoo: false, tattoo_body_part: 'Antebrazo', client_birth_date: '1995-05-20',
        client_health_conditions: '', client_allergies: 'Látex',
        client_preferred_date: 'Lo antes posible', terms_accepted: true,
        ...over
    };
}
function res() {
    return { statusCode: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const NOW = new Date('2026-11-17T12:00:00Z');

// ------------------------------------------------------------ modelo puro

test('flash-model: sanea los datos de venta y arma la vista del flash', () => {
    const clean = F.sanitizeFlash({ price: '1.200', currency: 'ars', size_h_cm: '10,5', size_w_cm: 999, zones: 'Antebrazo, antebrazo, Pantorrilla', available: 'false', mode: 'x' });
    assert.deepEqual(clean, { price: 1200, currency: 'ARS', size_h_cm: 10.5, zones: ['Antebrazo', 'Pantorrilla'], available: false, mode: 'unique' });
    const view = F.flashOf(flashItem());
    assert.equal(view.title, 'Golondrina');
    assert.equal(view.priceLabel, 'US$ 120 USD');
    assert.equal(view.size, '10 × 8 cm');
    assert.equal(view.statusLabel, 'Disponible');
    assert.equal(F.flashOf({ ...flashItem(), category: 'realizados' }), null);
    assert.equal(F.flashOf(flashItem({ flash: { ...flashItem().flash, available: false } })).statusLabel, 'Reservado');
});

test('flash-model: "Reservar este flash" solo si está disponible, con precio, es imagen y no es el dueño', () => {
    const ok = F.flashOf(flashItem());
    assert.equal(F.canBook(ok, { owner: false }), true);
    assert.equal(F.canBook(ok, { owner: true }), false, 'el dueño no reserva su flash');
    assert.equal(F.canBook(F.flashOf(flashItem({ flash: { available: false, price: 120 } })), {}), false, 'reservado');
    assert.equal(F.canBook(F.flashOf(flashItem({ flash: { available: true } })), {}), false, 'sin precio');
    assert.equal(F.canBook(F.flashOf(flashItem({ kind: 'video' })), {}), false, 'video');
    assert.equal(F.canBook(F.flashOf(flashItem({ id: undefined })), {}), false, 'sin id estable');
    assert.equal(F.bookingUrl('@ana.wo', 'fl_golondrina01', '/beta'), '/beta/flash?artist=ana.wo&id=fl_golondrina01');
});

test('flash-model: el editor aplica el formulario conservando el id y el resto del ítem', () => {
    const base = { url: IMAGE, kind: 'image', category: 'realizados', caption: 'Pie', ig_handle: 'ana' };
    const next = F.applyForm(base, { is_flash: true, title: ' Golondrina ', price: '120', currency: 'USD', size_text: 'Palma', zones: ['Antebrazo'], available: true, mode: 'repeat' }, () => 0.5);
    assert.ok(F.validId(next.id));
    assert.equal(next.category, 'flash');
    assert.equal(next.title, 'Golondrina');
    assert.equal(next.caption, 'Pie');
    assert.equal(next.ig_handle, 'ana');
    assert.deepEqual(next.flash, { price: 120, currency: 'USD', size_text: 'Palma', zones: ['Antebrazo'], available: true, mode: 'repeat' });
    const again = F.applyForm(next, { is_flash: true, title: 'Golondrina', price: 130 });
    assert.equal(again.id, next.id, 'el id no cambia al editar');
    const off = F.applyForm(next, { is_flash: false });
    assert.equal(off.category, 'realizados');
    assert.equal(off.flash, undefined);
    assert.equal(off.id, next.id);
    assert.deepEqual(Object.keys(F.validateForm({ is_flash: true, title: '', price: '' })).sort(), ['price', 'title']);
    assert.deepEqual(F.validateForm({ is_flash: false }), {});
});

// --------------------------------------------------- lógica del servidor

test('lib/flash: valida el pedido como el cotizador (edad mínima, contacto, fecha y términos)', () => {
    const ok = flash.normalizeRequest(validBody(), NOW);
    assert.equal(ok.email, 'lucia@example.test');
    assert.equal(ok.firstTattoo, false);
    assert.equal(ok.chip, 'Lo antes posible');
    const field = (over) => {
        try { flash.normalizeRequest(validBody(over), NOW); } catch (e) { return [e.status, e.extra.field, e.extra.code]; }
        return null;
    };
    assert.deepEqual(field({ client_full_name: ' ' }), [400, 'client_full_name', undefined]);
    assert.deepEqual(field({ client_email: 'no-es-correo' }), [400, 'client_email', undefined]);
    assert.deepEqual(field({ client_whatsapp: '12' }), [400, 'client_whatsapp', undefined]);
    assert.deepEqual(field({ tattoo_is_first_tattoo: null }), [400, 'tattoo_is_first_tattoo', undefined]);
    assert.deepEqual(field({ tattoo_body_part: '' }), [400, 'tattoo_body_part', undefined]);
    assert.deepEqual(field({ client_birth_date: '' }), [400, 'client_birth_date', undefined]);
    assert.deepEqual(field({ client_birth_date: '2014-01-01' }), [400, 'client_birth_date', 'under_age']);
    assert.equal(field({ client_birth_date: '2010-01-01' }), null, '16 años: se puede (con aviso de menor)');
    assert.equal(flash.normalizeRequest(validBody({ client_birth_date: '2010-01-01' }), NOW).minor, true);
    assert.deepEqual(field({ client_preferred_date: null }), [400, 'when', undefined]);
    assert.deepEqual(field({ terms_accepted: 'true' }), [400, 'terms_accepted', undefined]);
    assert.deepEqual(field({ flash_id: 'x' }), [400, 'flash_id', undefined]);
    assert.deepEqual(field({ submission_key: 'no' }), [400, 'submission_key', undefined]);
    assert.deepEqual(field({ requested_slot: { start: 'mañana', minutes: 60 } }), [400, 'requested_slot', undefined]);
    const range = flash.normalizeRequest(validBody({ client_preferred_date: null, preferred_date_from: '2026-12-10', preferred_date_to: '2026-12-01' }), NOW);
    assert.deepEqual(range.range, { from: '2026-12-01', to: '2026-12-10' });
});

test('lib/flash: flash inexistente, reservado, sin precio o del propio cliente', () => {
    const err = (artist, user) => {
        try { flash.resolveFlash(artist, 'fl_golondrina01', { user }); } catch (e) { return [e.status, e.extra.code]; }
        return null;
    };
    assert.deepEqual(err(null), [404, 'artist_not_found']);
    assert.deepEqual(err({ ...artistRow(), registration_status: 'incompleto' }), [404, 'artist_not_found']);
    assert.deepEqual(err(artistRow([flashItem({ id: 'fl_otro0001' })])), [404, 'flash_not_found']);
    assert.deepEqual(err(artistRow([flashItem({ category: 'realizados' })])), [404, 'flash_not_found']);
    assert.deepEqual(err(artistRow([flashItem({ flash: { price: 120, available: false } })])), [409, 'flash_reserved']);
    assert.deepEqual(err(artistRow([flashItem({ flash: { available: true } })])), [409, 'flash_without_price']);
    assert.deepEqual(err(artistRow(), { id: ARTIST_ID }), [403, 'own_flash']);
    assert.equal(err(artistRow(), { id: CLIENT_ID }), null);
});

test('lib/flash: el body del intake toma precio, título y tamaño del servidor (nunca del navegador)', () => {
    const input = flash.normalizeRequest(validBody({ price: 1, client_budget_amount: 1, title: 'Gratis' }), NOW);
    const { view } = flash.resolveFlash(artistRow(), input.flashId);
    const ref = `${intake.deriveQuoteId(KEY)}/ref_1_1731600000000.png`;
    const body = flash.buildIntakeBody(input, view, artistRow(), [ref]);
    assert.equal(body.mode, 'submit');
    assert.equal(body.quotation.client_budget_amount, 120);
    assert.equal(body.quotation.client_budget_currency, 'USD');
    assert.equal(body.quotation.tattoo_size, '10 × 8 cm');
    assert.match(body.quotation.tattoo_idea_description, /^Flash «Golondrina» del artista/);
    assert.equal(body.quotation.client_health_conditions, 'Ninguna');
    assert.equal(body.quotation.client_allergies, 'Látex');
    assert.equal(body.extras.personalization_level, 'tal_cual');
    assert.deepEqual(body.references, [{ path: ref, note: 'Flash del artista' }]);
    assert.equal(body.requested_slot, undefined);
    const withSlot = flash.buildIntakeBody(flash.normalizeRequest(validBody({ requested_slot: { start: '2026-12-01T15:00:00Z', minutes: 120 } }), NOW), view, artistRow());
    assert.deepEqual(withSlot.requested_slot, { start: '2026-12-01T15:00:00.000Z', minutes: 120 });
    assert.equal(withSlot.quotation.preferred_date_from, '2026-12-01');
});

test('lib/flash: solo copia imágenes de la galería de este proyecto, con una ruta válida de referencia', () => {
    assert.deepEqual(flash.gallerySourceOf(IMAGE, SUPA), { bucket: 'artist-gallery', path: `${ARTIST_ID}/flash-golondrina.png`, ext: 'png' });
    assert.equal(flash.gallerySourceOf('https://otro.example/storage/v1/object/public/artist-gallery/a.png', SUPA), null);
    assert.equal(flash.gallerySourceOf(`${SUPA}/storage/v1/object/public/quotation-references/a.png`, SUPA), null);
    assert.equal(flash.gallerySourceOf(`${SUPA}/storage/v1/object/public/artist-gallery/../x.png`, SUPA), null);
    assert.equal(flash.gallerySourceOf(`${SUPA}/storage/v1/object/public/artist-gallery/a.mp4`, SUPA), null);
    const quoteId = intake.deriveQuoteId(KEY);
    const target = flash.referencePathFor(quoteId, 'png', 1731600000000);
    assert.match(target, cotForm.REFERENCE_PATH_RE);
    assert.deepEqual(cotForm.normalizeReferences([{ path: target, note: 'Flash del artista' }], quoteId)[0].note, 'Flash del artista');
});

test('intake: source "flash" solo lo fija el servidor', () => {
    const artist = { user_id: ARTIST_ID, username: 'ana.wo', registration_status: 'aprobado' };
    assert.deepEqual(intake.resolveSource({}, artist, { flash: true }), { source: 'flash', quotation_medium: 'web' });
    assert.deepEqual(intake.resolveSource({ source: 'flash' }, artist), { source: 'web_chat', quotation_medium: 'web' });
    const q = intake.normalizeIntake({ submission_key: KEY, mode: 'draft', quotation: { artist_id: ARTIST_ID, source: 'flash' } }, null, artist).q;
    assert.equal(q.source, 'web_chat', 'el navegador no puede marcar una cotización como flash');
});

// ----------------------------------------------- ruta (dependencias inyectadas)

function fakeRepo(over = {}) {
    const calls = { copies: [], snapshots: [], reservedChecks: [] };
    const repo = {
        getArtistByUsername: async (u) => (u === 'ana.wo' ? artistRow() : null),
        hasReservedRequest: async (artistId, id) => { calls.reservedChecks.push([artistId, id]); return false; },
        copyFlashImage: async (source, target) => { calls.copies.push([source, target]); return true; },
        saveSnapshot: async (quoteId, snapshot) => { calls.snapshots.push([quoteId, snapshot]); },
        ...over
    };
    return { repo, calls };
}

test('POST /api/flash/request: arma el envío con la instantánea y la imagen copiada como referencia', async () => {
    const { repo, calls } = fakeRepo();
    let submitted = null;
    const handler = createRequestHandler({
        repo, resolveUser: async () => ({ id: CLIENT_ID, email: 'lucia@example.test' }), now: () => NOW,
        submit: async (req, r, body, user, options) => { submitted = { body, user, options }; await options.afterSave({ quote_id: 'QN' + 'a'.repeat(32) }); return r.json({ success: true, quote_id: 'QN' + 'a'.repeat(32), short_code: 'ABC234', status: 'pending' }); }
    });
    const r = res();
    await handler({ headers: { authorization: 'Bearer x' }, body: validBody({ price: 1 }) }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.short_code, 'ABC234');
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(calls.copies.length, 1);
    assert.equal(calls.copies[0][0].bucket, 'artist-gallery');
    assert.match(calls.copies[0][1], cotForm.REFERENCE_PATH_RE);
    assert.ok(calls.copies[0][1].startsWith(intake.deriveQuoteId(KEY) + '/'));
    const snap = submitted.options.prepare.flash;
    assert.equal(snap.id, 'fl_golondrina01');
    assert.equal(snap.price, 120, 'precio del servidor');
    assert.equal(snap.reference_path, calls.copies[0][1]);
    assert.equal(submitted.body.quotation.client_budget_amount, 120);
    assert.deepEqual(calls.snapshots.map((s) => s[1].id), ['fl_golondrina01']);
    assert.deepEqual(calls.reservedChecks, [[ARTIST_ID, 'fl_golondrina01']]);
});

test('POST /api/flash/request: rechaza el flash único con otra solicitud aprobada y el flash propio', async () => {
    const reserved = createRequestHandler({ repo: fakeRepo({ hasReservedRequest: async () => true }).repo, resolveUser: async () => null, now: () => NOW,
        submit: async () => { throw new Error('no debería enviar'); } });
    const r1 = res();
    await reserved({ headers: {}, body: validBody() }, r1);
    assert.equal(r1.statusCode, 409);
    assert.equal(r1.body.code, 'flash_reserved');
    assert.match(r1.body.error, /ya está reservado/);

    // Un flash que se repite no se bloquea aunque haya otra solicitud aprobada.
    let sent = false;
    const repeat = createRequestHandler({
        repo: fakeRepo({ getArtistByUsername: async () => artistRow([flashItem({ flash: { price: 80, currency: 'USD', available: true, mode: 'repeat' } })]), hasReservedRequest: async () => true }).repo,
        resolveUser: async () => null, now: () => NOW, submit: async (req, r) => { sent = true; return r.json({ success: true }); }
    });
    await repeat({ headers: {}, body: validBody() }, res());
    assert.equal(sent, true);

    const own = createRequestHandler({ repo: fakeRepo().repo, resolveUser: async () => ({ id: ARTIST_ID }), now: () => NOW, submit: async () => { throw new Error('no'); } });
    const r2 = res();
    await own({ headers: { authorization: 'Bearer a' }, body: validBody() }, r2);
    assert.equal(r2.statusCode, 403);
    assert.equal(r2.body.code, 'own_flash');

    const bad = createRequestHandler({ repo: fakeRepo().repo, resolveUser: async () => null, now: () => NOW });
    const r3 = res();
    await bad({ headers: {}, body: validBody({ client_email: '' }) }, r3);
    assert.equal(r3.statusCode, 400);
    assert.equal(r3.body.field, 'client_email');

    const missing = createRequestHandler({ repo: fakeRepo({ getArtistByUsername: async () => null }).repo, resolveUser: async () => null, now: () => NOW });
    const r4 = res();
    await missing({ headers: {}, body: validBody() }, r4);
    assert.equal(r4.statusCode, 404);
});

test('POST /api/flash/request: sin imagen copiable sigue sin referencia (la instantánea guarda la imagen)', async () => {
    const external = flashItem({ url: 'https://cdn.example/flash.png' });
    const { repo, calls } = fakeRepo({ getArtistByUsername: async () => artistRow([external]) });
    let body = null;
    const handler = createRequestHandler({ repo, resolveUser: async () => null, now: () => NOW,
        submit: async (req, r, b, u, options) => { body = { b, options }; return r.json({ success: true }); } });
    await handler({ headers: {}, body: validBody() }, res());
    assert.equal(calls.copies.length, 0);
    assert.deepEqual(body.b.references, []);
    assert.equal(body.options.prepare.flash.image, 'https://cdn.example/flash.png');
});

// --------------------------------------- de punta a punta con el intake real

function json(status, body) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
        text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body };
}

test('de punta a punta: la cotización sale con source flash, presupuesto del flash, tal_cual, referencia y la instantánea', async () => {
    const QID = intake.deriveQuoteId(KEY);
    const calls = [];
    const previousFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        const method = opts.method || 'GET';
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: u, method, body });
        if (u.includes('/rest/v1/artists_db')) return json(200, [{ user_id: ARTIST_ID, username: 'ana.wo', name: 'Ana', email: 'ana@example.test', registration_status: 'aprobado' }]);
        if (u.includes('/rest/v1/rpc/save_web_quotation')) return json(200, { quote_id: QID, status: 'pending', short_code: 'FR4SH2' });
        if (u.includes('/rest/v1/quotations_db') && method === 'GET') return json(200, []);
        if (method === 'PATCH' || method === 'DELETE') return json(204);
        if (method === 'POST') return json(201);
        return json(404, {});
    };
    const previousHook = intake.hooks.afterSubmit;
    intake.hooks.afterSubmit = null;
    try {
        const { repo, calls: repoCalls } = fakeRepo();
        const realRepo = require('../lib/repos/flash').FlashRepo;
        repo.saveSnapshot = (quoteId, snapshot) => realRepo.saveSnapshot(quoteId, snapshot);
        const handler = createRequestHandler({ repo, resolveUser: async () => null, now: () => NOW });
        const r = res();
        await handler({ headers: {}, body: validBody() }, r);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.short_code, 'FR4SH2');
        const rpc = calls.find((c) => c.url.includes('rpc/save_web_quotation'));
        assert.equal(rpc.body.p_quote.source, 'flash');
        assert.equal(rpc.body.p_quote.quote_status, 'pending');
        assert.equal(rpc.body.p_quote.client_budget_amount, 120);
        assert.equal(rpc.body.p_quote.client_user_id, null, 'sin sesión no se vincula');
        assert.equal(rpc.body.p_quote.flash_snapshot.id, 'fl_golondrina01');
        assert.equal(rpc.body.p_extras.personalization_level, 'tal_cual');
        const snap = calls.find((c) => c.method === 'PATCH' && c.url.includes('quotations_db') && c.body && c.body.flash_snapshot);
        assert.ok(snap, 'guarda la instantánea');
        assert.match(snap.url, /flash_snapshot=is\.null/);
        const refs = calls.find((c) => c.method === 'PATCH' && c.body && c.body.reference_images);
        assert.equal(refs.body.reference_images.length, 1);
        assert.equal(refs.body.reference_images[0], `${SUPA}/storage/v1/object/public/quotation-references/${repoCalls.copies[0][1]}`);
        const attach = calls.find((c) => c.method === 'POST' && c.url.includes('quotations_attachments'));
        assert.equal(attach.body[0].note, 'Flash del artista');
    } finally {
        global.fetch = previousFetch;
        intake.hooks.afterSubmit = previousHook;
    }
});

test('de punta a punta: la cuenta solo se vincula con el correo verificado (como en 2.5.2)', () => {
    const artist = { user_id: ARTIST_ID, username: 'ana.wo', registration_status: 'aprobado' };
    const input = flash.normalizeRequest(validBody(), NOW);
    const { view } = flash.resolveFlash(artistRow(), input.flashId);
    const body = flash.buildIntakeBody(input, view, artistRow());
    const verified = { id: CLIENT_ID, email: 'lucia@example.test', raw: { email_confirmed_at: '2026-11-01T00:00:00Z' } };
    const unverified = { id: CLIENT_ID, email: 'lucia@example.test', raw: { email_confirmed_at: null } };
    assert.equal(intake.normalizeIntake(body, verified, artist, { flash: true }).q.client_user_id, CLIENT_ID);
    assert.equal(intake.normalizeIntake(body, unverified, artist, { flash: true }).q.client_user_id, null);
});

// ------------------------------------------------------------ migración

test('migración 20261117130000: source flash, columna protegida y trigger de disponibilidad', () => {
    const sql = read('supabase/migrations/20261117130000_flash_tattoos.sql');
    assert.match(sql, /add constraint quotations_db_source_check[\s\S]*'manual'::text, 'prequote'::text, 'flash'::text/);
    assert.match(sql, /add column if not exists flash_snapshot jsonb/);
    assert.match(sql, /quotations_db_flash_snapshot_check[\s\S]*jsonb_typeof\(flash_snapshot\) = 'object'/);
    // Guarda: usuario final no crea flashes ni cambia la instantánea.
    const guard = sql.slice(sql.indexOf('function public.fn_quotations_flash_guard'), sql.indexOf('comment on function public.fn_quotations_flash_guard'));
    assert.match(guard, /current_user not in \('anon', 'authenticated'\)/);
    assert.match(guard, /new\.flash_snapshot is not null or new\.source = 'flash'/);
    assert.match(guard, /new\.flash_snapshot is distinct from old\.flash_snapshot/);
    assert.match(sql, /create trigger trg_quotations_flash_guard\s+before insert or update on public\.quotations_db/);
    // Disponibilidad: solo el ítem por id, security definer, search_path fijo, sin ejecución pública.
    const setter = sql.slice(sql.indexOf('function public.fn_flash_set_available'), sql.indexOf("comment on function public.fn_flash_set_available"));
    assert.match(setter, /security definer\s+set search_path = public, pg_temp/);
    assert.match(setter, /feed\.item ->> 'id' = p_flash_id/);
    assert.match(setter, /jsonb_set\(\s*feed\.item,\s*'\{flash\}'/);
    assert.match(setter, /order by feed\.ord/);
    const trigger = sql.slice(sql.indexOf('function public.fn_quotations_flash_availability'), sql.indexOf('comment on function public.fn_quotations_flash_availability'));
    assert.match(trigger, /security definer\s+set search_path = public, pg_temp/);
    assert.match(trigger, /coalesce\(new\.flash_snapshot ->> 'mode', 'unique'\) <> 'unique'/);
    assert.match(trigger, /new\.quote_status = 'client_approved' and old\.quote_status is distinct from 'client_approved'[\s\S]*fn_flash_set_available\(new\.artist_id, v_flash_id, false\)/);
    assert.match(trigger, /new\.quote_status in \('cancelled', 'client_rejected', 'expired'\)\s+and old\.quote_status = any \(v_reserved\)/);
    assert.match(trigger, /not exists \([\s\S]*other\.id <> new\.id[\s\S]*fn_flash_set_available\(new\.artist_id, v_flash_id, true\)/);
    assert.match(sql, /after update of quote_status on public\.quotations_db\s+for each row\s+when \(old\.quote_status is distinct from new\.quote_status\)/);
    for (const fn of ['fn_quotations_flash_guard()', 'fn_flash_set_available(uuid, text, boolean)', 'fn_quotations_flash_availability()']) {
        assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    }
    // Mismos estados "tomados" en el servidor y en la base.
    for (const status of flash.RESERVED_STATUSES) assert.ok(trigger.includes(`'${status}'`), status);
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^commit;/m);
});

test('reversa de 20261117130000: quita triggers, funciones y columna y vuelve al CHECK sin flash', () => {
    const down = read('supabase/rollbacks/20261117130000_flash_tattoos.down.sql');
    for (const s of ['drop trigger if exists trg_quotations_flash_availability', 'drop trigger if exists trg_quotations_flash_guard',
        'drop function if exists public.fn_quotations_flash_availability()', 'drop function if exists public.fn_flash_set_available(uuid, text, boolean)',
        'drop function if exists public.fn_quotations_flash_guard()', 'drop column if exists flash_snapshot']) {
        assert.ok(down.includes(s), s);
    }
    const check = down.slice(down.indexOf('add constraint quotations_db_source_check'));
    assert.doesNotMatch(check, /'flash'/);
    assert.match(check, /'prequote'::text[\s\S]*not valid/);
});

test('el CHECK de la galería no valida claves extra: item.flash pasa sin tocar la galería', () => {
    const valid = read('supabase/migrations/20260504000002_gallery_categories_instagram.sql');
    assert.doesNotMatch(valid, /item->>'flash'|item \? 'flash'/);
    assert.match(valid, /item_category NOT IN \('realizados', 'flash', 'proyectos', 'instagram', 'instagram-reel'\)/);
});

// ---------------------------------------------- normalizadores de la galería

test('normalizadores: el dashboard, la cuenta y el perfil conservan los datos del flash', () => {
    const G = require('../public/shared/js/dashboard-gallery.js');
    const extras = G.pickExtras({ ...flashItem(), flash: { ...flashItem().flash, price: '130' } });
    assert.equal(extras.id, 'fl_golondrina01');
    assert.equal(extras.title, 'Golondrina');
    assert.equal(extras.flash.price, 130);
    assert.equal(extras.flash.mode, 'unique');
    assert.equal(G.pickExtras({ url: 'x', flash: 'texto' }).flash, undefined);
    assert.match(G.flashTag(flashItem()), /FLASH · US\$ 120 USD/);
    assert.match(G.flashTag(flashItem({ flash: { available: false, price: 1 } })), /RESERVADO/);
    assert.match(G.flashTag(flashItem({ flash: {} })), /SIN PRECIO/);
    assert.match(G.cellMarkup(flashItem(), 1, 3, new Date()), /data-gal-action="flash"/);

    const dash = read('public/shared/js/dashboard.js');
    assert.match(dash, /normalized\.push\(withFlashId\(\{\s*\.\.\.extras,/);
    assert.equal((dash.match(/uploaded\.map\(\(item\) => withFlashId\(\{/g) || []).length, 2, 'las subidas a Flash nacen con id');
    const account = read('public/shared/js/artist-account.js');
    const normalizeWorks = account.slice(account.indexOf('function normalizeWorks'), account.indexOf('function flashBadge'));
    assert.match(normalizeWorks, /\.\.\.raw,/, 'la cuenta conserva todas las claves del ítem');
    assert.match(account, /window\.WoFlash\.ensureId\(item\)/);
    for (const page of ['public/artist/dashboard/index.html', 'public/artist/account/index.html']) {
        const html = read(page);
        assert.ok(html.indexOf('/shared/js/flash-model.js') > -1 && html.indexOf('/shared/js/flash-model.js') < html.indexOf('/shared/js/flash-editor.js'), page);
    }
});

// ------------------------------------------------------------------ perfil

function profileCard() {
    const src = read('public/shared/js/artist-profile.js');
    const code = src.slice(src.indexOf('function flashBookingUrl'), src.indexOf('function renderGalleryGrid'));
    const sandbox = {
        window: { WoFlash: F, location: { origin: 'https://beta.weotzi.com' } },
        artistData: { username: 'ana.wo', user_id: ARTIST_ID },
        appBaseUrl: () => 'https://beta.weotzi.com/beta',
        escapeHtml: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    };
    vm.createContext(sandbox);
    vm.runInContext(code + '\nthis.flashCardHtml = flashCardHtml;', sandbox);
    return sandbox.flashCardHtml;
}

test('perfil: la tarjeta del flash muestra título, precio, tamaño y estado; el botón solo cuando corresponde', () => {
    const card = profileCard();
    const item = { flash: F.flashOf(flashItem()) };
    const visitor = card(item, false);
    assert.match(visitor, /Golondrina/);
    assert.match(visitor, /US\$ 120 USD/);
    assert.match(visitor, /10 × 8 cm/);
    assert.match(visitor, /Disponible/);
    assert.match(visitor, /href="\/beta\/flash\?artist=ana\.wo&amp;id=fl_golondrina01"[^>]*>Reservar este flash</);
    assert.doesNotMatch(card(item, true), /Reservar este flash/, 'oculto para el dueño');
    const reserved = card({ flash: F.flashOf(flashItem({ flash: { price: 120, available: false } })) }, false);
    assert.match(reserved, /Reservado/);
    assert.doesNotMatch(reserved, /Reservar este flash/);
    assert.doesNotMatch(card({ flash: F.flashOf(flashItem({ flash: { available: true } })) }, false), /Reservar este flash/, 'sin precio');
    assert.equal(card({ flash: null }, false), '');

    const src = read('public/shared/js/artist-profile.js');
    // Favoritos sigue en la celda y la ficha va también en el visor.
    assert.match(src, /\$\{favButton\}\s*\n\s*\$\{caption \?[^\n]*\n\s*\$\{flashCardHtml\(item, owner\)\}/);
    assert.match(src, /flashPanel\.innerHTML = item\.flash \? flashCardHtml\(item, isOwnerView\(\)\) : ''/);
    const html = read('public/artist/profile/index.html');
    assert.ok(html.indexOf('/shared/js/flash-model.js') > -1 && html.indexOf('/shared/js/flash-model.js') < html.indexOf('<script src="/shared/js/artist-profile.js"'));
});

// --------------------------------------------------- lado del artista

test('diálogo de respuesta: precarga el precio del flash y la duración del turno elegido', () => {
    const M = require('../public/shared/js/quote-respond-model.js');
    const quote = { source: 'flash', client_budget_currency: 'USD', flash_snapshot: { id: 'fl_golondrina01', title: 'Golondrina', price: 1200, currency: 'ARS', slot_minutes: 90 } };
    const v = M.initialValues(quote, null, null, { now: NOW });
    assert.equal(v.amount, '1.200');
    assert.equal(v.currency, 'ARS');
    assert.equal(v.minutes, 90);
    assert.equal(v.sessions, '1');
    const answered = M.initialValues({ ...quote, artist_budget_amount: 900, artist_budget_currency: 'USD', artist_session_minutes: 180 }, null, null, { now: NOW });
    assert.equal(answered.amount, '900', 'no pisa lo que el artista ya cargó');
    assert.equal(answered.currency, 'USD');
    assert.equal(answered.minutes, 180);
    assert.equal(M.initialValues(quote, null, { amount: '1.500' }, { now: NOW }).amount, '1.500', 'el prefill manda');
    const plain = M.initialValues({ client_budget_currency: 'USD' }, null, null, { now: NOW });
    assert.equal(plain.amount, '');
});

test('listado y detalle: insignia "Flash" y bloque del flash con imagen, título y precio', () => {
    const view = F.snapshotView({ source: 'flash', flash_snapshot: { id: 'fl_x01', title: 'Golondrina', price: 120, currency: 'USD', size: '10 × 8 cm', image: 'javascript:alert(1)' } });
    assert.equal(view.image, '', 'nunca una URL peligrosa');
    assert.equal(view.priceLabel, 'US$ 120 USD');
    assert.equal(F.snapshotView({ source: 'web_chat', flash_snapshot: { id: 'x' } }), null);
    assert.equal(F.isFlashQuote({ source: 'flash', flash_snapshot: { id: 'fl_x01' } }), true);
    const list = read('public/shared/js/quotations.js');
    assert.match(list, /<span class="wo-flash-badge">Flash<\/span>/);
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /\$\{flashBlockHtml\(q\)\}/);
    assert.match(detail, /<span class="qd-tag wo-flash-badge">Flash<\/span>/);
    assert.match(read('public/shared/js/quotation-detail-info.js'), /qdi-flag wo-flash-badge/);
    for (const page of ['public/my-quotations/index.html', 'public/my-quotations/new/index.html', 'public/my-quotations/detail/index.html']) {
        assert.match(read(page), /\/shared\/js\/flash-model\.js/, page);
    }
});

test('avisos al artista: "Nueva solicitud" dice que es un flash (con o sin turno)', () => {
    const notices = require('../lib/cot-artista-notices');
    const payload = notices.newQuotationPayload({ quote_id: 'QN' + 'b'.repeat(32), source: 'flash', client_full_name: 'Lucía', tattoo_style: 'Flash',
        flash_snapshot: { id: 'fl_x01', title: 'Golondrina', price: 120, currency: 'USD' } }, 'https://beta.weotzi.com');
    assert.equal(payload.is_flash, true);
    assert.equal(payload.flash_title, 'Golondrina');
    assert.equal(payload.flash_price, '120 USD');
    assert.equal(notices.newQuotationPayload({ quote_id: 'QN' + 'c'.repeat(32), source: 'web_chat' }, 'https://x').is_flash, false);
    const slot = require('../lib/turnos-notify').requestedPayload({ artist: { name: 'Ana' }, quote: { id: 7, quote_id: 'QN1', flash_title: 'Golondrina' },
        hold: { starts_at: '2026-12-01T15:00:00Z', ends_at: '2026-12-01T17:00:00Z', expires_at: '2026-12-04T15:00:00Z' }, tz: 'UTC', baseUrl: 'https://x' });
    assert.equal(slot.is_flash, true);
    assert.equal(slot.flash_title, 'Golondrina');
});

// -------------------------------------------------------- página y demo

test('/flash: página propia con los pasos, la edad mínima y el aviso de cobro', () => {
    const html = read('public/flash/index.html');
    for (const src of ['/shared/js/booking-slots-model.js', '/shared/js/data/booking-repo.js', '/shared/js/quotation-r2-model.js', '/shared/js/flash-model.js', '/shared/js/flash-booking.js']) {
        assert.ok(html.includes(src), src);
    }
    assert.match(html, /\/shared\/css\/ds\/tokens\.css/);
    const js = read('public/shared/js/flash-booking.js');
    assert.match(js, /Enviar la solicitud no genera un cobro\./);
    assert.match(js, /Términos y condiciones[\s\S]*Política de privacidad/);
    assert.match(js, /Solicitud enviada/);
    assert.match(js, /fetch\(appPath\('\/api\/flash\/request'\)/);
    assert.match(js, /R2\.birthStatus/);
    assert.match(js, /no garantiza disponibilidad/);
    assert.doesNotMatch(js, /\b(querés|elegí|contanos|tenés|podés)\b/i, 'tuteo');
    assert.match(read('server.js'), /require\('\.\/lib\/routes\/flash'\)\.register\(app\);/);
    assert.ok(require('../public/shared/js/artist-public-url.js').RESERVED.includes('flash'));
});

test('demo: Mara con flashes con precio, flashes en la galería propia y una solicitud de flash', () => {
    const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');
    assert.ok(Fixtures.EXTENSIONS.includes('flash'));
    const sandbox = { self: {} };
    vm.createContext(sandbox);
    vm.runInContext(read('public/shared/js/demo-fixtures/flash.js'), sandbox);
    const ext = sandbox.self.WoDemoFixtureExtensions.flash;
    const tables = { artists_db: [], quotations_db: [{ id: 1, artist_id: 'demo-artist', quote_id: 'DEMO-P01' }] };
    ext({ tables, identity: { userId: 'demo-artist' }, helpers: { DAY: 86400000 } });
    // El preview reemplaza artists_db después de las extensiones.
    tables.artists_db = [{ user_id: 'demo-artist', username: 'valentina-preview.wo', gallery_feed_items: [{ id: 'w1', url: '/a.svg', category: 'realizados' }] }];
    const own = tables.artists_db.find((a) => a.user_id === 'demo-artist');
    const mara = tables.artists_db.find((a) => a.username === 'mara-flash.wo');
    assert.ok(mara, 'Mara existe');
    const maraFlashes = mara.gallery_feed_items.map((it) => F.flashOf(it)).filter(Boolean);
    assert.ok(maraFlashes.filter((v) => F.canBook(v, { owner: false })).length >= 2);
    assert.ok(maraFlashes.some((v) => !v.available));
    assert.ok(own.gallery_feed_items.some((it) => F.flashOf(it) && F.flashOf(it).hasPrice));
    const quote = tables.quotations_db.find((q) => q.quote_id === 'DEMO-F01');
    assert.equal(quote.source, 'flash');
    assert.equal(F.snapshotView(quote).title, 'Rosa de línea fina');
    ext({ tables, identity: { userId: 'demo-artist' }, helpers: { DAY: 86400000 } });
    assert.equal(tables.quotations_db.filter((q) => q.quote_id === 'DEMO-F01').length, 1, 'idempotente');
});
