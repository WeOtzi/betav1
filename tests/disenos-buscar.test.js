'use strict';

// Buscador «¿Dónde está este diseño?» y acciones de soporte sobre las alertas
// de imagen duplicada (lib/routes/disenos.js). Todo con dependencias falsas:
// no depende de `sharp` ni del motor de huellas (T6), que se inyectan.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const routes = require('../lib/routes/disenos');

const H = routes._internal;
const USER = '11111111-1111-4111-8111-111111111111';
const ARTIST_USER = '22222222-2222-4222-8222-222222222222';
const ARTIST_ROW = '33333333-3333-4333-8333-333333333333';
const STUDIO = '44444444-4444-4444-8444-444444444444';
const OTHER_USER = '55555555-5555-4555-8555-555555555555';
const SANCTIONED_USER = '66666666-6666-4666-8666-666666666666';
const DRAFT_USER = '77777777-7777-4777-8777-777777777777';
const CLOSED_STUDIO = '88888888-8888-4888-8888-888888888888';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOT = 'f0000000-0000-4000-8000-00000000000f';
const ALERT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDIO_ALERT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PREVIEW_ALERT = 'abababab-abab-4bab-8bab-abababababab';
const GONE_ALERT = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const BASE_SUPA = 'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const NOT_IMAGE = Buffer.from('esto no es una imagen, son solo letras sueltas');

function quiet() {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    return () => Object.assign(console, saved);
}

// ------------------------------------------------------------------ mundo falso

function makeWorld(opts = {}) {
    const calls = [];
    const emails = [];
    const searchCount = { value: opts.used || 0 };
    const fpRepo = {
        async countSearchesLast24h(userId) { calls.push(['count', userId]); return searchCount.value; },
        async searchSimilar(args) { calls.push(['search', args]); return opts.rows || []; },
        async logSearch(userId, n) { calls.push(['logSearch', userId, n]); searchCount.value += 1; },
        async markRemoved(kind, ownerId, key) { calls.push(['markRemoved', kind, ownerId, key]); }
    };
    // Registro con reserva: la fila cuenta para el tope ANTES de decodificar.
    const searchLog = {
        async reserve(userId) {
            calls.push(['reserve', userId]);
            if (opts.reserveFails) throw new Error('sin permisos');
            searchCount.value += 1;
            return SLOT;
        },
        async complete(id, n) { calls.push(['log', id, n]); }
    };
    const decoder = opts.decoder === undefined ? {
        isAvailable: () => true,
        async fingerprintBuffer(buf) {
            calls.push(['fingerprint', buf.length]);
            if (opts.decodeGate) await opts.decodeGate();
            if (opts.decodeFails) throw new Error('decode');
            return { sha256: 'f'.repeat(64), phash: 'a1b2c3d4e5f60718', phash_mirror: '8170f6e5d4c3b2a1', dhash: '0f0f0f0f0f0f0f0f', width: 800, height: 600 };
        }
    } : opts.decoder;

    const artists = [
        { id: ARTIST_ROW, user_id: ARTIST_USER, name: 'Mateo Rivas', username: 'mateo.ink', registration_status: 'completo', sanction_state: 'none' },
        { id: 'a0000000-0000-4000-8000-000000000001', user_id: SANCTIONED_USER, name: 'Cuenta suspendida', username: 'suspendida', registration_status: 'completo', sanction_state: 'suspended' },
        { id: 'a0000000-0000-4000-8000-000000000002', user_id: DRAFT_USER, name: 'Borrador', username: 'borrador', registration_status: 'incompleto', sanction_state: 'none' }
    ];
    const studios = [
        { id: STUDIO, user_id: OTHER_USER, name: 'Estudio Norte', slug: 'estudio-norte', is_active: true, sanction_state: 'none' },
        { id: CLOSED_STUDIO, user_id: OTHER_USER, name: 'Estudio cerrado', slug: 'cerrado', is_active: false, sanction_state: 'none' }
    ];
    const owners = {
        async artistsByIds(ids) { calls.push(['artistsByIds', ids]); return artists.filter((a) => ids.includes(a.id)); },
        async artistsByUserIds(ids) { calls.push(['artistsByUserIds', ids]); return artists.filter((a) => ids.includes(a.user_id)); },
        async studiosByIds(ids) { calls.push(['studiosByIds', ids]); return studios.filter((s) => ids.includes(s.id)); }
    };

    const KEEP_URL = `${BASE_SUPA}/artist-gallery/${ARTIST_USER}/1700000000000_keep.jpg`;
    const COPY_URL = `${BASE_SUPA}/artist-gallery/${ARTIST_USER}/1700000000001_copy.jpg`;
    const feed = {
        artist: [
            { url: KEEP_URL, kind: 'image', category: 'realizados' },
            { url: `${COPY_URL}?v=2`, kind: 'image', category: 'realizados' },
            { id: 'fl_abc', url: `${BASE_SUPA}/artist-gallery/${ARTIST_USER}/flash.jpg`, category: 'flash', title: 'Golondrina' }
        ],
        studio: [
            { url: `${BASE_SUPA}/studio-photos/${STUDIO}/a.jpg`, kind: 'image', category: 'studio', sort: 0 },
            { url: `${BASE_SUPA}/studio-photos/${STUDIO}/b.jpg`, kind: 'image', category: 'studio', sort: 1 }
        ]
    };
    const saved = [];
    const portfolio = {
        async getArtist(ownerId, fallback) {
            calls.push(['getArtist', ownerId, fallback]);
            if (ownerId === ARTIST_ROW || ownerId === ARTIST_USER || fallback === ARTIST_USER) {
                return { id: ARTIST_ROW, user_id: ARTIST_USER, name: 'Mateo Rivas', username: 'mateo.ink', gallery_feed_items: feed.artist };
            }
            return null;
        },
        async saveArtistFeed(rowId, items) {
            if (opts.saveFails) throw new Error('fallo de red');
            saved.push(['artist', rowId, items]); feed.artist = items;
        },
        async getStudio(id) { return id === STUDIO ? { id: STUDIO, user_id: OTHER_USER, name: 'Estudio Norte', slug: 'estudio-norte', photo_feed_items: feed.studio } : null; },
        async saveStudioFeed(id, items) { saved.push(['studio', id, items]); feed.studio = items; }
    };

    const alerts = new Map();
    alerts.set(ALERT, {
        id: ALERT, kind: 'image_duplicate', status: 'open', subject_user_id: ARTIST_USER, related_user_id: OTHER_USER,
        payload: {
            pair_key: 'p1', distance: 1, confidence: 'casi_segura',
            new: { fp_id: 'fp-new', source_kind: 'artist_gallery', item_key: `artist:${ARTIST_USER}|artist-gallery/${ARTIST_USER}/1700000000001_copy.jpg`, image_url: null, owner_kind: 'artist', owner_id: ARTIST_USER, first_seen_at: '2026-11-18T10:00:00Z' },
            existing: { fp_id: 'fp-old', source_kind: 'studio_feed', item_key: `studio-photos/${STUDIO}/a.jpg`, image_url: `${BASE_SUPA}/studio-photos/${STUDIO}/a.jpg`, owner_kind: 'studio', owner_id: STUDIO, first_seen_at: '2026-09-01T10:00:00Z' }
        },
        resolution: null, handled_by: null, handled_at: null, created_at: '2026-11-18T10:05:00Z'
    });
    alerts.set(STUDIO_ALERT, {
        id: STUDIO_ALERT, kind: 'image_duplicate', status: 'open', subject_user_id: OTHER_USER, related_user_id: ARTIST_USER,
        payload: {
            pair_key: 'p2', distance: 6, confidence: 'posible',
            new: { fp_id: 'fp-s', source_kind: 'studio_feed', item_key: `studio-photos/${STUDIO}/b.jpg`, image_url: `${BASE_SUPA}/studio-photos/${STUDIO}/b.jpg`, owner_kind: 'studio', owner_id: STUDIO, first_seen_at: '2026-11-18T10:00:00Z' },
            existing: { fp_id: 'fp-a', source_kind: 'artist_gallery', item_key: 'x', image_url: KEEP_URL, owner_kind: 'artist', owner_id: ARTIST_ROW, first_seen_at: '2026-08-01T10:00:00Z' }
        },
        created_at: '2026-11-18T10:05:00Z'
    });
    for (const [id, kind, extra] of [
        ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'reentry_blocked', {}],
        ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'image_duplicate', { payload: { distance: 0, confidence: 'casi_segura', new: { source_kind: 'store_design', item_key: 'k', owner_kind: 'artist', owner_id: ARTIST_ROW }, existing: {} } }],
        [PREVIEW_ALERT, 'image_duplicate', { payload: { distance: 0, confidence: 'casi_segura', new: { source_kind: 'store_preview', item_key: `artist:${ARTIST_USER}|store-previews/p/1.jpg`, image_url: `${BASE_SUPA}/store-previews/p/1.jpg`, owner_kind: 'artist', owner_id: ARTIST_USER }, existing: {} } }],
        [GONE_ALERT, 'image_duplicate', { payload: { distance: 2, confidence: 'casi_segura', new: { source_kind: 'artist_gallery', item_key: `artist:${ARTIST_USER}|artist-gallery/${ARTIST_USER}/ya-no-esta.jpg`, image_url: `${BASE_SUPA}/artist-gallery/${ARTIST_USER}/ya-no-esta.jpg`, owner_kind: 'artist', owner_id: ARTIST_USER }, existing: {} } }]
    ]) {
        alerts.set(id, { id, kind, status: 'open', subject_user_id: ARTIST_USER, related_user_id: OTHER_USER, payload: {}, created_at: '2026-11-18T10:05:00Z', ...extra });
    }
    const alertRepo = {
        async getActiveSupportUser(id) { return id === AGENT ? { user_id: AGENT, email: 'agente@weotzi.com', full_name: 'Ana' } : null; },
        async getAlert(id) {
            const a = alerts.get(id);
            if (!a) return null;
            const copy = JSON.parse(JSON.stringify(a));
            if (opts.staleGet) copy.status = 'open'; // otro agente la gestionó entre la lectura y la acción
            return copy;
        },
        async updateAlert(id, patch, { expectStatus } = {}) {
            calls.push(['updateAlert', id, patch]);
            const a = alerts.get(id);
            if (!a || (expectStatus && a.status !== expectStatus)) return null;
            Object.assign(a, patch);
            return JSON.parse(JSON.stringify(a));
        }
    };

    const tokens = { 'tok-user': { id: USER, email: 'lucia@example.com' }, 'tok-agent': { id: AGENT, email: 'agente@weotzi.com' }, 'tok-other': { id: OTHER_USER, email: 'otro@example.com' } };
    const restore = routes.setDeps({
        resolveBearerUser: async (req) => {
            const h = String((req.headers && req.headers.authorization) || '');
            return tokens[h.replace(/^Bearer\s+/i, '')] || null;
        },
        isSuperadminEmail: () => false,
        alerts: alertRepo,
        owners,
        portfolio,
        decoder,
        fingerprints: opts.noRepo ? null : fpRepo,
        searchLog,
        getAuthUser: async (id) => ({ id, email: id === ARTIST_USER ? 'mateo.artista@example.com' : 'hola@estudionorte.example', full_name: '' }),
        sendEmail: async (event, payload, options) => { emails.push({ event, payload, options }); return { ok: true }; },
        applicationBase: () => 'https://beta.weotzi.com',
        now: () => new Date('2026-11-19T15:00:00Z')
    });
    return { calls, emails, feed, saved, alerts, searchCount, restore, KEEP_URL, COPY_URL };
}

// Servidor real de Express (middlewares incluidos) en un puerto efímero.
async function withServer(world, fn) {
    const app = express();
    app.use(express.json());
    routes.register(app, { limiter: false });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const unquiet = quiet();
    try {
        return await fn(base);
    } finally {
        unquiet();
        await new Promise((resolve) => server.close(resolve));
        world.restore();
    }
}

async function post(base, path, { token, body, type = 'image/jpeg', json } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(json); } else if (type) headers['Content-Type'] = type;
    const res = await fetch(base + path, { method: 'POST', headers, body: payload });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function get(base, path, token) {
    const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const searchRows = () => [
    { id: 'r4', source_kind: 'artist_gallery', artist_id: ARTIST_ROW, owner_user_id: ARTIST_USER, item_key: 'k4', image_url: `${BASE_SUPA}/artist-gallery/x/4.jpg`, first_seen_at: '2026-10-01T00:00:00Z', distance: 13 },
    { id: 'r3', source_kind: 'studio_feed', studio_id: STUDIO, owner_user_id: OTHER_USER, item_key: 'k3', image_url: `${BASE_SUPA}/studio-photos/${STUDIO}/a.jpg`, first_seen_at: '2026-09-01T00:00:00Z', distance: 10 },
    { id: 'r1', source_kind: 'artist_gallery', artist_id: ARTIST_ROW, owner_user_id: ARTIST_USER, item_key: 'k1', image_url: `${BASE_SUPA}/artist-gallery/x/1.jpg`, first_seen_at: '2026-08-01T00:00:00Z', distance: 0 },
    { id: 'r2', source_kind: 'flash', artist_id: null, owner_user_id: ARTIST_USER, item_key: 'id:fl_1', image_url: 'http://inseguro.example/2.jpg', first_seen_at: '2026-08-02T00:00:00Z', distance: 5 }
];

// ------------------------------------------------------------------ puro

test('confianza del buscador: casi segura ≤ 2, posible 3–8, parecida 9–12, nada arriba de 12', () => {
    assert.equal(H.searchConfidence(0), 'casi_segura');
    assert.equal(H.searchConfidence(2), 'casi_segura');
    assert.equal(H.searchConfidence(3), 'posible');
    assert.equal(H.searchConfidence(8), 'posible');
    assert.equal(H.searchConfidence(9), 'parecida');
    assert.equal(H.searchConfidence(12), 'parecida');
    assert.equal(H.searchConfidence(13), null);
    assert.equal(H.searchConfidence(11, true), 'casi_segura', 'el mismo sha256 es casi segura');
    assert.equal(H.SEARCH_THRESHOLD, 12);
    assert.equal(H.SEARCH_MAX, 12);
    assert.equal(H.DAILY_LIMIT, 20);
});

test('tipo real por los primeros bytes: JPEG, PNG y WebP; lo demás no', () => {
    assert.equal(H.sniffImageType(JPEG), 'image/jpeg');
    assert.equal(H.sniffImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), 'image/png');
    assert.equal(H.sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])), 'image/webp');
    assert.equal(H.sniffImageType(NOT_IMAGE), null);
    assert.equal(H.sniffImageType(Buffer.alloc(3)), null);
});

test('itemMatches: clave de flash, clave bucket/path y URL sin query; nunca otra foto', () => {
    const url = `${BASE_SUPA}/artist-gallery/u1/170_a.jpg`;
    assert.equal(H.itemMatches({ url: `${url}?t=1` }, { itemKey: 'artist-gallery/u1/170_a.jpg' }), true);
    assert.equal(H.itemMatches({ id: 'fl_9', url: 'https://otro/flash.jpg' }, { itemKey: 'id:fl_9' }), true);
    assert.equal(H.itemMatches(url, { imageUrl: `${url}?v=3` }), true, 'string legado del feed');
    assert.equal(H.itemMatches({ url: `${BASE_SUPA}/artist-gallery/u1/170_ab.jpg` }, { itemKey: 'artist-gallery/u1/170_a.jpg', imageUrl: url }), false);
    assert.equal(H.itemMatches({ url: 'https://images.unsplash.com/x' }, { itemKey: 'url:https://images.unsplash.com/x' }), true);
    // Formato real del motor (lib/image-sources.js): la clave lleva el dueño adelante.
    assert.equal(H.itemMatches({ url: `${url}?t=1` }, { itemKey: `artist:${ARTIST_USER}|artist-gallery/u1/170_a.jpg` }), true);
    assert.equal(H.itemMatches({ id: 'fl_9', category: 'flash', url: 'https://x/f.jpg' }, { itemKey: `artist:${ARTIST_USER}|id:fl_9` }), true);
    assert.equal(H.itemMatches({ url: `${BASE_SUPA}/studio-photos/s/b.jpg` }, { itemKey: `studio:${STUDIO}|studio-photos/s/a.jpg` }), false);
    assert.equal(H.itemKeyBase(`studio:${STUDIO}|studio-photos/s/a.jpg`), 'studio-photos/s/a.jpg');
    const out = H.removeMatching(JSON.stringify([{ url }, { url: `${url}x` }]), { imageUrl: url });
    assert.equal(out.removed, 1);
    assert.equal(out.items.length, 1);
});

// ------------------------------------------------------------------ buscador

test('buscar: sin sesión → 401 y no lee la foto ni llama al motor', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { body: JPEG });
        assert.equal(res.status, 401);
        assert.equal(res.body.error, 'Inicia sesión para buscar un diseño.');
        assert.deepEqual(world.calls, []);
    });
});

test('buscar: sin decodificador (sharp ausente) o sin el motor → 503 «El buscador se habilita pronto.»', async () => {
    for (const opts of [{ decoder: { isAvailable: () => false, fingerprintBuffer: async () => ({}) } }, { decoder: null }, { noRepo: true }]) {
        const world = makeWorld(opts);
        await withServer(world, async (base) => {
            const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
            assert.equal(res.status, 503);
            assert.equal(res.body.error, 'El buscador se habilita pronto.');
            assert.ok(!world.calls.some((c) => c[0] === 'fingerprint' || c[0] === 'log' || c[0] === 'reserve'));
        });
    }
});

test('buscar: tope de 20 por usuario cada 24 h → 429; con 5 usadas quedan 14 después de buscar', async () => {
    const full = makeWorld({ used: 20 });
    await withServer(full, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 429);
        assert.equal(res.body.error, 'Llegaste al límite de 20 búsquedas por día. Prueba de nuevo mañana.');
        assert.equal(res.body.limits.remaining, 0);
        assert.ok(!full.calls.some((c) => c[0] === 'fingerprint'), 'no procesa la foto');
    });
    const some = makeWorld({ used: 5 });
    await withServer(some, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 200);
        assert.equal(res.body.limits.remaining, 14);
        assert.deepEqual(some.calls.find((c) => c[0] === 'count'), ['count', USER]);
    });
    const last = makeWorld({ used: 19 });
    await withServer(last, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 200);
        assert.equal(res.body.limits.remaining, 0);
        const again = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(again.status, 429, 'la búsqueda 21 se corta');
    });
});

test('buscar: imagen inválida → 400 (bytes que no son imagen, tipo no admitido o decodificación fallida)', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const bad = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: NOT_IMAGE });
        assert.equal(bad.status, 400);
        const text = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: NOT_IMAGE, type: 'text/plain' });
        assert.equal(text.status, 400);
        const empty = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: Buffer.alloc(0) });
        assert.equal(empty.status, 400);
        assert.ok(!world.calls.some((c) => c[0] === 'search' || c[0] === 'log' || c[0] === 'reserve'), 'lo que no es imagen no gasta búsqueda');
    });
    const broken = makeWorld({ decodeFails: true });
    await withServer(broken, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /No pudimos leer esa imagen/);
        assert.ok(!broken.calls.some((c) => c[0] === 'search'));
    });
});

test('buscar: más de 10 MB → 413 en JSON', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: big });
        assert.equal(res.status, 413);
        assert.equal(res.body.error, 'La imagen puede pesar hasta 10 MB.');
    });
});

test('buscar: resultados ordenados, ≤ 12 de distancia, etiquetas casi segura / posible / parecida y dueño público', async () => {
    const world = makeWorld({ rows: searchRows() });
    await withServer(world, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        const r = res.body.results;
        assert.deepEqual(r.map((x) => x.distance), [0, 5, 10], 'la distancia 13 queda afuera');
        assert.deepEqual(r.map((x) => x.confidence), ['casi_segura', 'posible', 'parecida']);
        assert.deepEqual(r.map((x) => x.confidence_label), ['Casi segura', 'Posible', 'Parecida']);
        assert.deepEqual(r[0].owner, { kind: 'artist', id: ARTIST_USER, name: 'Mateo Rivas', username: 'mateo.ink', profile_url: '/artist/profile?artist=mateo.ink' });
        assert.equal(r[0].first_seen_at, '2026-08-01T00:00:00Z');
        assert.equal(r[0].source_kind, 'artist_gallery');
        assert.equal(r[0].item_key, 'k1');
        assert.equal(r[0].report_key, '1.jpg');
        assert.equal(r[0].report_image_url, `${BASE_SUPA}/artist-gallery/x/1.jpg`);
        assert.equal(r[1].report_key, 'fl_1', 'flash: el id del ítem');
        assert.equal(r[1].owner.kind, 'artist', 'flash sin artist_id: se resuelve por owner_user_id');
        assert.equal(r[1].image_url, null, 'una URL no https no se devuelve');
        assert.deepEqual(r[2].owner, { kind: 'studio', id: STUDIO, name: 'Estudio Norte', slug: 'estudio-norte', profile_url: '/studio/profile?studio=estudio-norte' });
        const search = world.calls.find((c) => c[0] === 'search')[1];
        assert.deepEqual(search, { phash: 'a1b2c3d4e5f60718', phashMirror: '8170f6e5d4c3b2a1', max: 12, threshold: 12 });
        assert.deepEqual(world.calls.find((c) => c[0] === 'log'), ['log', SLOT, 3]);
        for (const x of r) assert.ok(!('email' in x.owner) && !('user_id' in x.owner), 'solo datos públicos');
    });
});

test('buscar: dueños sancionados, sin alta terminada o estudios inactivos no aparecen', async () => {
    const rows = [
        { id: 's1', source_kind: 'artist_gallery', owner_user_id: SANCTIONED_USER, item_key: 'a', image_url: `${BASE_SUPA}/artist-gallery/s/1.jpg`, first_seen_at: '2026-01-01T00:00:00Z', distance: 1 },
        { id: 's2', source_kind: 'artist_gallery', owner_user_id: DRAFT_USER, item_key: 'b', image_url: `${BASE_SUPA}/artist-gallery/d/1.jpg`, first_seen_at: '2026-01-01T00:00:00Z', distance: 2 },
        { id: 's3', source_kind: 'studio_feed', studio_id: CLOSED_STUDIO, item_key: 'c', image_url: `${BASE_SUPA}/studio-photos/c/1.jpg`, first_seen_at: '2026-01-01T00:00:00Z', distance: 3 },
        { id: 's4', source_kind: 'artist_gallery', owner_user_id: '99999999-9999-4999-8999-999999999999', item_key: 'd', image_url: `${BASE_SUPA}/artist-gallery/z/1.jpg`, first_seen_at: '2026-01-01T00:00:00Z', distance: 4 },
        { id: 's5', source_kind: 'artist_gallery', artist_id: ARTIST_ROW, item_key: 'e', image_url: `${BASE_SUPA}/artist-gallery/ok/1.jpg`, first_seen_at: '2026-01-01T00:00:00Z', distance: 7 }
    ];
    const world = makeWorld({ rows });
    await withServer(world, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.results.map((x) => x.owner.name), ['Mateo Rivas']);
        assert.deepEqual(world.calls.find((c) => c[0] === 'log'), ['log', SLOT, 1], 'el registro cuenta solo lo que se mostró');
    });
});

test('buscar: la foto nunca se guarda (sin Storage ni otra salida; solo la huella en memoria y logSearch)', async () => {
    const world = makeWorld({ rows: searchRows() });
    const outbound = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
        if (!String(url).startsWith('http://127.0.0.1:')) outbound.push(String(url));
        return realFetch(url, init);
    };
    try {
        await withServer(world, async (base) => {
            const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
            assert.equal(res.status, 200);
        });
    } finally {
        globalThis.fetch = realFetch;
    }
    assert.deepEqual(outbound, [], 'ninguna llamada de red fuera del servidor de prueba');
    const kinds = world.calls.map((c) => c[0]);
    assert.ok(!kinds.some((k) => /upload|storage|insert|save/i.test(k)), kinds.join(','));
    assert.deepEqual(world.calls.find((c) => c[0] === 'reserve'), ['reserve', USER], 'la reserva lleva solo el usuario');
    const log = world.calls.find((c) => c[0] === 'log');
    assert.deepEqual(log, ['log', SLOT, 3], 'el registro se completa solo con la cantidad');
    const search = world.calls.find((c) => c[0] === 'search')[1];
    assert.ok(!Object.values(search).some((v) => Buffer.isBuffer(v)), 'al motor solo llega la huella');
    assert.equal(world.saved.length, 0);
});

// ------------------------------------------------------------------ soporte

test('alertas de imagen: solo soporte (401 sin sesión, 403 sin ser agente)', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        assert.equal((await post(base, `/api/support/image-alerts/${ALERT}`, { json: { action: 'legitimo' } })).status, 401);
        assert.equal((await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-user', json: { action: 'legitimo' } })).status, 403);
        assert.equal((await get(base, `/api/support/image-alerts/${ALERT}`, 'tok-user')).status, 403);
        assert.ok(!world.calls.some((c) => c[0] === 'updateAlert'));
    });
});

test('alertas de imagen: detalle con los dos dueños (datos públicos)', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await get(base, `/api/support/image-alerts/${ALERT}`, 'tok-agent');
        assert.equal(res.status, 200);
        assert.equal(res.body.alert.kind, 'image_duplicate');
        assert.equal(res.body.owners.new.name, 'Mateo Rivas');
        assert.equal(res.body.owners.existing.name, 'Estudio Norte');
        assert.equal(res.body.owners.existing.profile_url, '/studio/profile?studio=estudio-norte');
    });
});

test('alertas de imagen: «legítimo» descarta la alerta con la resolución y no toca el portafolio', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'legitimo', note: 'Es la misma obra del artista y su estudio.' } });
        assert.equal(res.status, 200);
        assert.equal(res.body.alert.status, 'dismissed');
        assert.match(res.body.alert.resolution, /^Legítimo: Es la misma obra/);
        assert.equal(res.body.alert.handled_by, AGENT);
        assert.equal(world.saved.length, 0);
        assert.equal(world.emails.length, 0);
        const again = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'tarde' } });
        assert.equal(again.status, 409, 'una alerta ya gestionada no se vuelve a tocar');
        assert.equal(world.saved.length, 0);
    });
});

test('alertas de imagen: «retirar» exige nota, quita SOLO ese ítem, marca la huella y avisa una vez', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const noNote = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: ' a ' } });
        assert.equal(noNote.status, 400);
        assert.equal(noNote.body.field, 'note');
        assert.equal(world.saved.length, 0);

        const res = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Copia idéntica de un trabajo anterior.' } });
        assert.equal(res.status, 200);
        assert.equal(res.body.removed, 1);
        assert.equal(res.body.email_sent, true);
        assert.equal(res.body.alert.status, 'handled');
        assert.equal(res.body.alert.resolution, 'Retirada: Copia idéntica de un trabajo anterior.');

        assert.equal(world.saved.length, 1);
        const [kind, rowId, items] = world.saved[0];
        assert.equal(kind, 'artist');
        assert.equal(rowId, ARTIST_ROW);
        assert.equal(items.length, 2, 'quedan los otros dos ítems');
        assert.ok(items.some((i) => i.url === world.KEEP_URL));
        assert.ok(items.some((i) => i.id === 'fl_abc'));
        assert.ok(!items.some((i) => String(i.url).includes('_copy.jpg')));

        assert.deepEqual(world.calls.find((c) => c[0] === 'markRemoved'), ['markRemoved', 'artist_gallery', ARTIST_USER, `artist:${ARTIST_USER}|artist-gallery/${ARTIST_USER}/1700000000001_copy.jpg`]);
        assert.equal(world.emails.length, 1);
        const mail = world.emails[0];
        assert.equal(mail.event, 'portfolio_item_removed');
        assert.equal(mail.options.idempotencyKey, `portfolio_item_removed:${ALERT}`);
        assert.equal(mail.payload.recipient_email, 'mateo.artista@example.com');
        assert.equal(mail.payload.recipient_role, 'artist');
        assert.equal(mail.payload.reason_note, 'Copia idéntica de un trabajo anterior.');

        // Copia de lo retirado dentro de la alerta (para volver a publicarlo).
        const removal = world.alerts.get(ALERT).payload.removal;
        assert.equal(removal.by, AGENT);
        assert.equal(removal.source, 'artists_db.gallery_feed_items');
        assert.deepEqual(removal.items, [{ url: `${world.COPY_URL}?v=2`, kind: 'image', category: 'realizados' }]);
        assert.equal(res.body.alert.payload.removal.items.length, 1);
        assert.equal(world.alerts.get(ALERT).payload.pair_key, 'p1', 'el resto del payload queda igual');
        // Orden: primero se toma la alerta (condicional), después se edita el portafolio.
        const order = world.calls.filter((c) => c[0] === 'updateAlert' || c[0] === 'markRemoved').map((c) => c[0] === 'markRemoved' ? 'markRemoved' : c[2].status || 'final');
        assert.deepEqual(order, ['handled', 'markRemoved', 'final']);

        const again = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Otra vez.' } });
        assert.equal(again.status, 409);
        assert.equal(world.emails.length, 1, 'el correo sale una sola vez');
    });
});

test('alertas de imagen: «retirar» en un estudio quita la foto de photo_feed_items y avisa al estudio', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${STUDIO_ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Foto de otro artista.' } });
        assert.equal(res.status, 200);
        assert.equal(world.saved[0][0], 'studio');
        assert.deepEqual(world.saved[0][2].map((i) => i.url), [`${BASE_SUPA}/studio-photos/${STUDIO}/a.jpg`]);
        assert.equal(world.emails[0].payload.recipient_role, 'studio');
        assert.equal(world.emails[0].payload.recipient_email, 'hola@estudionorte.example');
    });
});

test('alertas de imagen: «abrir denuncia» cierra la alerta y devuelve el prefill de «Proponer sanción»', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'denuncia', note: 'Reincide.' } });
        assert.equal(res.status, 200);
        assert.equal(res.body.alert.status, 'handled');
        assert.equal(res.body.prefill.user_id, ARTIST_USER);
        assert.equal(res.body.prefill.reason_code, 'plagio_diseno');
        assert.ok(res.body.prefill.summary.length >= 10 && res.body.prefill.summary.length <= 2000);
        assert.match(res.body.prefill.summary, /Distancia 1 de 64/);
        assert.match(res.body.prefill.summary, /Reincide\./);
        assert.equal(world.saved.length, 0, 'abrir la denuncia no retira nada');
        assert.equal(world.emails.length, 0);
    });
});

test('alertas de imagen: acción inválida, otro tipo de alerta o imagen de la Store', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        assert.equal((await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'ocultar' } })).status, 400);
        assert.equal((await post(base, '/api/support/image-alerts/no-es-uuid', { token: 'tok-agent', json: { action: 'legitimo' } })).status, 400);
        assert.equal((await post(base, '/api/support/image-alerts/dddddddd-dddd-4ddd-8ddd-dddddddddddd', { token: 'tok-agent', json: { action: 'legitimo' } })).status, 409);
        const store = await post(base, '/api/support/image-alerts/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', { token: 'tok-agent', json: { action: 'retirar', note: 'Copia.' } });
        assert.equal(store.status, 409);
        assert.equal(store.body.code, 'STORE_ITEM');
        assert.equal(world.saved.length, 0);
        assert.ok(!world.calls.some((c) => c[0] === 'updateAlert'), 'la alerta no se toca');
    });
});

test('alertas de imagen: «retirar» una vista previa de la Store → 409 STORE_ITEM, sin huella, alerta ni correo', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${PREVIEW_ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Copia.' } });
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'STORE_ITEM');
        assert.equal(world.alerts.get(PREVIEW_ALERT).status, 'open');
        assert.ok(!world.calls.some((c) => ['updateAlert', 'markRemoved', 'getArtist'].includes(c[0])));
        assert.equal(world.saved.length, 0);
        assert.equal(world.emails.length, 0);
    });
    assert.equal(H.SOURCE_LABELS.store_preview, 'Vista previa de la Store');
    assert.equal(H.isStoreKind('store_algo_nuevo'), true);
    assert.equal(H.retirePlan({ payload: { new: { source_kind: 'artist_feed', item_key: 'k' } } }).code, 'UNSUPPORTED_SOURCE', 'fuera de la lista blanca no se retira');
});

test('alertas de imagen: «retirar» cuando la foto ya no está → 409 ITEM_NOT_FOUND y la alerta sigue abierta', async () => {
    const world = makeWorld();
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${GONE_ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Copia exacta.' } });
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'ITEM_NOT_FOUND');
        const alert = world.alerts.get(GONE_ALERT);
        assert.equal(alert.status, 'open', 'se devuelve a abierta');
        assert.equal(alert.resolution, null);
        assert.equal(alert.handled_by, null);
        assert.ok(!world.calls.some((c) => c[0] === 'markRemoved'));
        assert.equal(world.saved.length, 0);
        assert.equal(world.emails.length, 0, 'sin correo falso');
    });
});

test('alertas de imagen: si otro agente la gestionó al mismo tiempo, «retirar» no toca el portafolio', async () => {
    const world = makeWorld({ staleGet: true });
    world.alerts.get(ALERT).status = 'dismissed';
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Copia exacta.' } });
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'NOT_OPEN');
        assert.equal(world.saved.length, 0);
        assert.ok(!world.calls.some((c) => c[0] === 'getArtist' || c[0] === 'markRemoved'));
        assert.equal(world.emails.length, 0);
        assert.equal(world.alerts.get(ALERT).status, 'dismissed');
    });
});

test('alertas de imagen: si guardar el portafolio falla, la alerta vuelve a abierta y no sale correo', async () => {
    const world = makeWorld({ saveFails: true });
    await withServer(world, async (base) => {
        const res = await post(base, `/api/support/image-alerts/${ALERT}`, { token: 'tok-agent', json: { action: 'retirar', note: 'Copia exacta.' } });
        assert.equal(res.status, 500);
        assert.equal(world.alerts.get(ALERT).status, 'open');
        assert.ok(!world.calls.some((c) => c[0] === 'markRemoved'));
        assert.equal(world.emails.length, 0);
    });
});

// ------------------------------------------------------------------ tope sin carreras

test('buscar: dos búsquedas en paralelo del mismo usuario → la segunda 429 SEARCH_IN_PROGRESS', async () => {
    let release;
    let entered;
    const inside = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { release = r; });
    const world = makeWorld({ used: 19, decodeGate: () => { entered(); return gate; } });
    await withServer(world, async (base) => {
        const first = post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        await inside;
        const second = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(second.status, 429);
        assert.equal(second.body.code, 'SEARCH_IN_PROGRESS');
        release();
        assert.equal((await first).status, 200);
        assert.equal(world.calls.filter((c) => c[0] === 'reserve').length, 1);
        const third = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(third.status, 429, 'la reserva de la primera ya cuenta: 20 de 20');
        assert.equal(third.body.code, 'DAILY_LIMIT');
    });
});

test('buscar: si no se puede reservar la búsqueda, falla cerrado (503) sin decodificar', async () => {
    const world = makeWorld({ reserveFails: true });
    await withServer(world, async (base) => {
        const res = await post(base, '/api/disenos/buscar', { token: 'tok-user', body: JPEG });
        assert.equal(res.status, 503);
        assert.ok(!world.calls.some((c) => c[0] === 'fingerprint' || c[0] === 'search'));
    });
});

// ------------------------------------------------------------------ denuncia desde el buscador

test('report_key / report_image_url: clave y URL como las guarda el perfil (lib/denuncias.js)', () => {
    const U = ARTIST_USER;
    assert.equal(H.reportKeyOf(`artist:${U}|id:fl_1`, `${BASE_SUPA}/artist-gallery/${U}/f.jpg`), 'fl_1');
    assert.equal(H.reportKeyOf(`artist:${U}|artist-gallery/${U}/a,b=c.jpg`, `${BASE_SUPA}/artist-gallery/${U}/a%2Cb%3Dc.jpg`), 'a,b=c.jpg');
    assert.equal(H.reportKeyOf(`artist:${U}|artist-gallery/${U}/mi foto.jpg`, `${BASE_SUPA}/artist-gallery/${U}/mi%20foto.jpg`), 'mi%20foto.jpg');
    assert.equal(H.storageUrlLikeProfile(`${BASE_SUPA}/artist-gallery/${U}/a%2Cb%3Dc.jpg`), `${BASE_SUPA}/artist-gallery/${U}/a,b=c.jpg`);
    assert.equal(H.storageUrlLikeProfile(`${BASE_SUPA}/artist-gallery/${U}/mi%20foto.jpg`), `${BASE_SUPA}/artist-gallery/${U}/mi%20foto.jpg`);
    assert.equal(H.storageUrlLikeProfile('http://inseguro.example/x.jpg'), '');
    const denuncias = require('../lib/denuncias');
    const stored = `${BASE_SUPA}/artist-gallery/${U}/a,b=c.jpg`;
    const found = denuncias.findPortfolioItem([{ source: 'gallery_feed_items', items: [{ url: stored }] }], {
        key: H.reportKeyOf(`artist:${U}|artist-gallery/${U}/a,b=c.jpg`, `${BASE_SUPA}/artist-gallery/${U}/a%2Cb%3Dc.jpg`),
        image_url: H.storageUrlLikeProfile(`${BASE_SUPA}/artist-gallery/${U}/a%2Cb%3Dc.jpg`)
    });
    assert.ok(found, 'la denuncia encuentra la foto del perfil');
    const flash = denuncias.findPortfolioItem([{ source: 'gallery_feed_items', items: [{ id: 'fl_1', url: `${BASE_SUPA}/artist-gallery/${U}/otra.jpg?v=1` }] }], {
        key: H.reportKeyOf(`artist:${U}|id:fl_1`, null), image_url: `${BASE_SUPA}/artist-gallery/${U}/f.jpg`
    });
    assert.ok(flash, 'el flash se encuentra por su id');
});

test('register: sin el módulo del job no rompe; las rutas quedan registradas', () => {
    const paths = [];
    const fakeApp = { post: (p) => paths.push(['post', p]), get: (p) => paths.push(['get', p]) };
    const unquiet = quiet();
    try { routes.register(fakeApp, { startJob: false, limiter: false }); } finally { unquiet(); }
    assert.deepEqual(paths, [['post', '/api/disenos/buscar'], ['get', '/api/support/image-alerts/:id'], ['post', '/api/support/image-alerts/:id']]);
});
