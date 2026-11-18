'use strict';
// Visibilidad pública del artista (lib/artist-visibility.js) y su uso en los
// caminos que eligen un artista para algo nuevo: sugerencias e intake del
// cotizador, sedes, flash, turnos; más la etiqueta de cierre por soporte.
const test = require('node:test');
const assert = require('node:assert/strict');

const visibility = require('../lib/artist-visibility');
const { isPublicArtist, applyPublicFilter, PUBLISHED_OR, withSanctionColumn } = visibility;

// Doble de pgrest: registra la cadena de llamadas y devuelve `rows`.
function fakeQuery(rows) {
    const calls = [];
    const q = {
        calls,
        select(c) { calls.push(['select', c]); return q; },
        eq(c, v) { calls.push(['eq', c, v]); return q; },
        or(c) { calls.push(['or', c]); return q; },
        limit(n) { calls.push(['limit', n]); return q; },
        single() { calls.push(['single']); return q; },
        async execute() { return rows; }
    };
    return q;
}

test('isPublicArtist: alta publicada y sin sanción', () => {
    assert.equal(isPublicArtist({ registration_status: 'pendiente de validacion', sanction_state: 'none' }), true);
    assert.equal(isPublicArtist({ registration_status: null, sanction_state: 'none' }), true);
    assert.equal(isPublicArtist({ registration_status: 'pendiente de validacion' }), true, 'sin columna cuenta como none');
    assert.equal(isPublicArtist({ registration_status: 'incompleto', sanction_state: 'none' }), false);
    assert.equal(isPublicArtist({ registration_status: 'pendiente de validacion', sanction_state: 'suspended' }), false);
    assert.equal(isPublicArtist({ registration_status: 'pendiente de validacion', sanction_state: 'banned' }), false);
    assert.equal(isPublicArtist(null), false);
    assert.equal(isPublicArtist(undefined), false);
});

test('PUBLISHED_OR es el or() de pgrest (incluye los null) y no se puede mutar', () => {
    assert.deepEqual(PUBLISHED_OR.map((c) => ({ ...c })), [
        { col: 'registration_status', op: 'is', val: null },
        { col: 'registration_status', op: 'neq', val: 'incompleto' }
    ]);
    assert.ok(Object.isFrozen(PUBLISHED_OR));
    assert.ok(Object.isFrozen(PUBLISHED_OR[0]));
});

test('applyPublicFilter agrega el or() de alta y sanction_state = none', () => {
    const q = fakeQuery([]);
    const out = applyPublicFilter(q);
    assert.equal(out, q, 'encadena');
    assert.deepEqual(q.calls, [['or', PUBLISHED_OR], ['eq', 'sanction_state', 'none']]);
});

test('applyPublicFilter arma el query string real de lib/postgrest.js', () => {
    const { pgrest } = require('../lib/postgrest');
    const qs = applyPublicFilter(pgrest('artists_db').select('user_id'))._queryString();
    assert.match(qs, /sanction_state=eq\.none/);
    assert.match(qs, /or=\(registration_status\.is\.null,registration_status\.neq\.incompleto\)/);
});

test('withSanctionColumn suma la columna sin duplicar', () => {
    assert.equal(withSanctionColumn('user_id,username'), 'user_id,username,sanction_state');
    assert.equal(withSanctionColumn('user_id,sanction_state'), 'user_id,sanction_state');
    assert.deepEqual(withSanctionColumn(['a']), ['a', 'sanction_state']);
});

// ---------------------------------------------------------------------------
// Cotizador: pool de sugerencias y guarda del intake
// ---------------------------------------------------------------------------
test('sugerencias: el pool filtra por sanción en la consulta y en memoria, con caché invalidable', async () => {
    const routes = require('../lib/routes/cot-form');
    const rows = [
        { user_id: 'a1', username: 'ana', registration_status: 'pendiente de validacion', sanction_state: 'none' },
        { user_id: 'a2', username: 'beto', registration_status: 'pendiente de validacion', sanction_state: 'banned' },
        { user_id: 'a3', username: 'caro', registration_status: 'incompleto', sanction_state: 'none' }
    ];
    const queries = [];
    const pg = (table) => { const q = fakeQuery(rows); q.table = table; queries.push(q); return q; };
    const load = routes.createArtistSource({ pgrest: pg });
    const out = await load();
    assert.deepEqual(out.map((r) => r.user_id), ['a1']);
    const q = queries[0];
    assert.equal(q.table, 'artists_db');
    const select = q.calls.find((c) => c[0] === 'select')[1];
    assert.match(select, /\bsanction_state\b/);
    assert.match(select, /\bregistration_status\b/);
    assert.ok(q.calls.some((c) => c[0] === 'eq' && c[1] === 'sanction_state' && c[2] === 'none'));
    const or = q.calls.find((c) => c[0] === 'or');
    assert.deepEqual(or[1], PUBLISHED_OR.map((c) => ({ ...c })), 'mismo or() que applyPublicFilter');
    await load();
    assert.equal(queries.length, 1, 'segunda llamada desde la caché');
    load.invalidate();
    await load();
    assert.equal(queries.length, 2, 'invalidate() fuerza otra lectura');
});

function fakeRes() {
    return {
        statusCode: 200, body: null, headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
    };
}

test('intake: rechaza un artista sancionado y deja pasar el resto', async () => {
    const routes = require('../lib/routes/cot-form');
    const ID = '11111111-1111-4111-8111-111111111111';
    const byState = { none: 'none', banned: 'banned', suspended: 'suspended' };
    for (const [state, expectBlocked] of [['none', false], ['banned', true], ['suspended', true]]) {
        const guard = routes.createIntakeArtistGuard({
            repo: { artistVisibility: async () => ({ user_id: ID, username: 'x', registration_status: 'pendiente de validacion', sanction_state: byState[state] }) }
        });
        const res = fakeRes();
        let nextCalled = false;
        await guard({ body: { quotation: { artist_id: ID } } }, res, () => { nextCalled = true; });
        assert.equal(nextCalled, !expectBlocked, state);
        if (expectBlocked) {
            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, 'artist_unavailable');
            assert.match(res.body.error, /Elige otro artista/);
        }
    }
});

test('intake: sin artista, artista inexistente o base caída → sigue', async () => {
    const routes = require('../lib/routes/cot-form');
    const ID = '11111111-1111-4111-8111-111111111111';
    const cases = [
        [{ body: {} }, async () => { throw new Error('no debería consultar'); }],
        [{ body: { quotation: { artist_id: '' } } }, async () => { throw new Error('no debería consultar'); }],
        [{ body: { quotation: { artist_id: ID } } }, async () => null],
        [{ body: { quotation: { artist_id: ID } } }, async () => { throw new Error('PostgREST 500'); }]
    ];
    const warn = console.warn;
    console.warn = () => {};
    try {
        for (const [req, artistVisibility] of cases) {
            const guard = routes.createIntakeArtistGuard({ repo: { artistVisibility } });
            let nextCalled = false;
            await guard(req, fakeRes(), () => { nextCalled = true; });
            assert.equal(nextCalled, true);
        }
    } finally { console.warn = warn; }
});

test('intake: id que no es uuid → 400 «Artista no válido.» sin consultar', async () => {
    const routes = require('../lib/routes/cot-form');
    for (const bad of ['no-uuid', '1111', 'g1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-1111111111111']) {
        const guard = routes.createIntakeArtistGuard({ repo: { artistVisibility: async () => { throw new Error('no debería consultar'); } } });
        const res = fakeRes();
        let nextCalled = false;
        await guard({ body: { quotation: { artist_id: bad } } }, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false, bad);
        assert.equal(res.statusCode, 400, bad);
        assert.equal(res.body.error, 'Artista no válido.');
    }
});

test('intake: una variante del uuid (guiones movidos, mayúsculas, llaves) no esquiva la guarda', async () => {
    const routes = require('../lib/routes/cot-form');
    const CANON = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const variants = ['a0ee-bc99-9c0b-4ef8bb6d-6bb9bd380a11', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}', 'a0eebc999c0b4ef8bb6d6bb9bd380a11'];
    for (const v of variants) {
        let asked = null;
        const guard = routes.createIntakeArtistGuard({
            repo: { artistVisibility: async (id) => { asked = id; return { user_id: CANON, username: 'x', registration_status: 'pendiente de validacion', sanction_state: 'banned' }; } }
        });
        const req = { body: { quotation: { artist_id: v } } };
        const res = fakeRes();
        let nextCalled = false;
        await guard(req, res, () => { nextCalled = true; });
        assert.equal(asked, CANON, v);
        assert.equal(nextCalled, false, v);
        assert.equal(res.statusCode, 409, v);
    }
    // Un artista visible sigue, y el intake recibe la forma canónica.
    const guard = routes.createIntakeArtistGuard({ repo: { artistVisibility: async () => ({ user_id: CANON, username: 'x', registration_status: null, sanction_state: 'none' }) } });
    const req = { body: { quotation: { artist_id: variants[0] } } };
    let nextCalled = false;
    await guard(req, fakeRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.body.quotation.artist_id, CANON);
});

test('canonicalUuid: normaliza lo que Postgres acepta y rechaza lo demás', () => {
    const { canonicalUuid } = require('../lib/artist-visibility');
    assert.equal(canonicalUuid('a0ee-bc99-9c0b-4ef8bb6d-6bb9bd380a11'), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    assert.equal(canonicalUuid(' A0EEBC999C0B4EF8BB6D6BB9BD380A11 '), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    assert.equal(canonicalUuid('{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}'), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    for (const bad of [null, undefined, '', 'no-uuid', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11x', "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' or 1=1"]) {
        assert.equal(canonicalUuid(bad), null, String(bad));
    }
});

test('la ruta del intake corre la guarda antes del handler', () => {
    const routes = require('../lib/routes/cot-form');
    const intake = require('../services/quotation-intake');
    const registered = [];
    const app = { post: (p, ...h) => registered.push([p, h]), get: (p, ...h) => registered.push([p, h]) };
    const hook = intake.hooks.afterSubmit;
    try {
        routes.register(app, { rateLimit: { rateLimit: () => (req, res, next) => next(), ipKeyGenerator: (ip) => ip } });
    } finally { intake.hooks.afterSubmit = hook; }
    const [, handlers] = registered.find((r) => r[0] === '/api/quotations/intake');
    assert.equal(handlers[handlers.length - 1], intake.handleIntake);
    assert.equal(handlers[handlers.length - 2].name, 'intakeArtistGuard');
});

// ---------------------------------------------------------------------------
// Repos: código fuente (las lecturas reales piden la columna nueva)
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('repos de flash, turnos y cotizador leen sanction_state y usan el predicado', () => {
    const flashRepo = src('lib/repos/flash.js');
    assert.match(flashRepo, /ARTIST_SELECT = '[^']*\bsanction_state\b/);
    assert.match(flashRepo, /applyPublicFilter\(/);
    const booking = src('lib/repos/booking.js');
    assert.match(booking, /registration_status,sanction_state'\)\s*\n\s*\.or\(candidates/);
    assert.match(booking, /!isPublicArtist\(row\)/);
    const cotRepo = src('lib/repos/cot-form.js');
    assert.match(cotRepo, /ARTIST_LOCATION_SELECT = '[^']*\bsanction_state\b/);
    assert.match(cotRepo, /!visibility\.isPublicArtist\(artist\)/);
    assert.match(cotRepo, /async artistVisibility\(/);
});

test('flash: resolveFlash rechaza a un artista sancionado como inexistente', () => {
    const { resolveFlash } = require('../lib/flash');
    const artist = { user_id: 'u1', username: 'ana', registration_status: 'pendiente de validacion', sanction_state: 'banned', gallery_feed_items: [] };
    assert.throws(() => resolveFlash(artist, 'f1'), /No encontramos a ese artista/);
    const ok = { ...artist, sanction_state: 'none' };
    // Sin sanción pasa la guarda del artista y falla recién por el flash.
    assert.throws(() => resolveFlash(ok, 'f1'), /ya no está en la galería/);
});

test('turnos: getPublicArtistByUsername devuelve null si el artista está sancionado', async () => {
    const postgrest = require('../lib/postgrest');
    const original = postgrest.pgrest;
    // El repo toma pgrest al cargarse: se prueba con un módulo fresco.
    const repoPath = require.resolve('../lib/repos/booking');
    delete require.cache[repoPath];
    let rows = [];
    postgrest.pgrest = () => fakeQuery(rows);
    try {
        const { BookingRepo } = require('../lib/repos/booking');
        rows = [{ user_id: 'u1', username: 'ana', registration_status: 'pendiente de validacion', sanction_state: 'suspended' }];
        assert.equal(await BookingRepo.getPublicArtistByUsername('ana'), null);
        rows = [{ user_id: 'u1', username: 'ana', registration_status: 'pendiente de validacion', sanction_state: 'none' }];
        assert.equal((await BookingRepo.getPublicArtistByUsername('ana')).user_id, 'u1');
    } finally {
        postgrest.pgrest = original;
        delete require.cache[repoPath];
    }
});

test('sedes del artista: locationSources devuelve null si está sancionado', async () => {
    const postgrest = require('../lib/postgrest');
    const original = postgrest.pgrest;
    const repoPath = require.resolve('../lib/repos/cot-form');
    delete require.cache[repoPath];
    postgrest.pgrest = () => fakeQuery({ user_id: 'u1', username: 'ana', registration_status: 'pendiente de validacion', sanction_state: 'banned' });
    try {
        const { CotFormRepo } = require('../lib/repos/cot-form');
        assert.equal(await CotFormRepo.locationSources('11111111-1111-4111-8111-111111111111'), null);
        const row = await CotFormRepo.artistVisibility('11111111-1111-4111-8111-111111111111');
        assert.equal(row.sanction_state, 'banned');
        assert.equal(await CotFormRepo.artistVisibility('no-uuid'), null);
    } finally {
        postgrest.pgrest = original;
        delete require.cache[repoPath];
    }
});

// ---------------------------------------------------------------------------
// Negociación: cancelada por soporte
// ---------------------------------------------------------------------------
test('negociación: «Cancelada por soporte» cuando hay support_closed_reason', () => {
    const neg = require('../lib/negociacion');
    assert.equal(neg.cancelledLabel({ quote_status: 'cancelled' }), 'Cancelada por el artista');
    assert.equal(neg.cancelledLabel({ quote_status: 'cancelled', support_closed_reason: 'El perfil fue dado de baja por soporte.' }), 'Cancelada por soporte');
    assert.equal(neg.cancelledBy({ support_closed_reason: '   ' }), 'artist');
    assert.equal(neg.cancelledBy(null), 'artist');
});

test('negociación: el bloqueo de una cancelada por soporte no culpa al artista', () => {
    const neg = require('../lib/negociacion');
    const CLIENT = '22222222-2222-4222-8222-222222222222';
    const ARTIST = '33333333-3333-4333-8333-333333333333';
    const base = { quote_id: 'Q1', quote_status: 'cancelled', client_user_id: CLIENT, artist_id: ARTIST };
    const user = { id: CLIENT };
    const byArtist = neg.evaluatePropose({ user, quotation: base, kind: 'counter', changes: {}, hint: 'client' });
    assert.equal(byArtist.ok, false);
    assert.match(byArtist.error, /El artista canceló/);
    const bySupport = neg.evaluatePropose({ user, quotation: { ...base, support_closed_reason: 'Baja por soporte' }, kind: 'counter', changes: {}, hint: 'client' });
    assert.equal(bySupport.ok, false);
    assert.match(bySupport.error, /Soporte de We Ötzi canceló/);
    const state = neg.stateFor({ user, quotation: { ...base, support_closed_reason: 'Baja por soporte' }, proposals: [], hint: 'client' });
    assert.equal(state.ok, true);
    assert.equal(state.state.cancelled_label, 'Cancelada por soporte');
    const open = neg.stateFor({ user, quotation: { ...base, quote_status: 'responded' }, proposals: [], hint: 'client' });
    assert.equal(open.state.cancelled_label, null);
    // Cancelada por el artista (columna leída, vacía) y lectura sin la columna.
    const artistClosed = neg.stateFor({ user, quotation: { ...base, support_closed_reason: null }, proposals: [], hint: 'client' });
    assert.equal(artistClosed.state.cancelled_label, 'Cancelada por el artista');
    const unknown = neg.stateFor({ user, quotation: base, proposals: [], hint: 'client' });
    assert.equal(unknown.state.cancelled_label, null);
});

// lib/repos/negotiation.js no es de este equipo: hasta que integración sume la
// columna (después de aplicar 20261118130000), el camino «Cancelada por
// soporte» de la negociación no corre en producción.
test('la lectura de la negociación trae support_closed_reason', () => {
    const { QUOTE_SELECT } = require('../lib/repos/negotiation');
    assert.ok(QUOTE_SELECT.split(',').includes('support_closed_reason'));
});
