'use strict';
// Huellas de imágenes (puro): pHash/dHash/espejo sobre imágenes sintéticas en
// escala de grises, Hamming, confianza, reglas de lib/image-sources.js y el
// decodificador sin sharp. No depende de sharp.
const test = require('node:test');
const assert = require('node:assert/strict');

const FP = require('../lib/image-fingerprint');
const Sources = require('../lib/image-sources');
const Decoder = require('../lib/image-decode');

const { resizeArea, flipHorizontal } = FP._internal;

// ---- imágenes sintéticas -------------------------------------------------------

function image(w, h, fn) {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(fn(x / w, y / h))));
    }
    return { data, width: w, height: h };
}

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

// Figuras sobre un degradado (asimétrica: sirve para el espejo).
const shapes = (x, y) => {
    let v = 40 + 120 * x;
    const dx = x - 0.3;
    const dy = y - 0.35;
    if (dx * dx + dy * dy < 0.04) v = 230;
    if (x > 0.55 && x < 0.85 && y > 0.5 && y < 0.8) v = 20;
    if (y > 0.85) v = 180;
    return v;
};
const rings = (x, y) => 128 + 120 * Math.sin(20 * Math.hypot(x - 0.5, y - 0.5));
const checker = (x, y) => ((Math.floor(x * 8) + Math.floor(y * 8)) % 2 ? 220 : 30);
const stripes = (x, y) => 128 + 110 * Math.sin(14 * x + 3 * y) * Math.cos(5 * y);

function toU8(values, w, h) {
    const data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = Math.round(values[i]);
    return { data, width: w, height: h };
}
const resize = (g, w, h) => toU8(resizeArea(g, w, h), w, h);
const noise = (g, amp, seed) => {
    const r = rng(seed);
    return { ...g, data: Uint8Array.from(g.data, (v) => Math.max(0, Math.min(255, v + Math.round((r() * 2 - 1) * amp)))) };
};
const blur = (g) => {
    const { width: w, height: h, data } = g;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let s = 0;
            let n = 0;
            for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                    const xx = x + i;
                    const yy = y + j;
                    if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += data[yy * w + xx]; n += 1; }
                }
            }
            out[y * w + x] = Math.round(s / n);
        }
    }
    return { ...g, data: out };
};
// Recorte del 5 % (2,5 % por lado).
const crop = (g, f) => {
    const { width: w, height: h, data } = g;
    const cx = Math.round(w * f);
    const cy = Math.round(h * f);
    const nw = w - 2 * cx;
    const nh = h - 2 * cy;
    const out = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = data[(y + cy) * w + x + cx];
    return { data: out, width: nw, height: nh };
};
// Cuantización: parecida a la pérdida de una recompresión.
const quantize = (g, q) => ({ ...g, data: Uint8Array.from(g.data, (v) => Math.round(v / q) * q) });

const BASE_SHAPES = image(256, 256, shapes);
const BASE_RINGS = image(256, 256, rings);

// ---- pHash ------------------------------------------------------------------------

test('phash/dhash/phashMirror devuelven 16 hex y son deterministas', () => {
    for (const fn of [FP.phash, FP.dhash, FP.phashMirror]) {
        const a = fn(BASE_SHAPES);
        assert.match(a, /^[0-9a-f]{16}$/);
        assert.equal(fn(BASE_SHAPES), a);
    }
});

test('pHash estable ante cambio de tamaño, desenfoque, ruido y recompresión (≤ MATCH_THRESHOLD)', () => {
    for (const base of [BASE_SHAPES, BASE_RINGS]) {
        const p = FP.phash(base);
        const variants = {
            resize97: resize(base, 97, 97),
            resize64: resize(base, 64, 64),
            upscale: resize(resize(base, 64, 64), 200, 200),
            blur: blur(blur(base)),
            noise: noise(base, 10, 7),
            quantize: quantize(base, 24)
        };
        for (const [name, img] of Object.entries(variants)) {
            const d = FP.hamming(p, FP.phash(img));
            assert.ok(d <= FP.MATCH_THRESHOLD, `${name}: distancia ${d}`);
        }
    }
});

test('pHash tolera un recorte del 5 %', () => {
    for (const base of [BASE_SHAPES, BASE_RINGS]) {
        const d = FP.hamming(FP.phash(base), FP.phash(crop(base, 0.025)));
        assert.ok(d <= FP.MATCH_THRESHOLD, `distancia ${d}`);
    }
});

test('imágenes distintas quedan lejos (> SEARCH_THRESHOLD)', () => {
    const hashes = [shapes, rings, checker, stripes].map((fn) => FP.phash(image(256, 256, fn)));
    for (let i = 0; i < hashes.length; i++) {
        for (let j = i + 1; j < hashes.length; j++) {
            const d = FP.hamming(hashes[i], hashes[j]);
            assert.ok(d > FP.SEARCH_THRESHOLD, `${i}-${j}: distancia ${d}`);
        }
    }
});

test('espejo: la imagen espejada no coincide por pHash pero sí por phashMirror', () => {
    const flipped = flipHorizontal(BASE_SHAPES);
    assert.ok(FP.hamming(FP.phash(BASE_SHAPES), FP.phash(flipped)) > FP.MATCH_THRESHOLD);
    assert.equal(FP.hamming(FP.phashMirror(BASE_SHAPES), FP.phash(flipped)), 0);
    // Espejada y con ruido / otro tamaño: sigue cerca del espejo.
    const tweaked = noise(resize(flipped, 120, 120), 8, 3);
    assert.ok(FP.hamming(FP.phashMirror(BASE_SHAPES), FP.phash(tweaked)) <= FP.MATCH_THRESHOLD);
});

test('dHash estable ante cambio de tamaño', () => {
    const d = FP.hamming(FP.dhash(BASE_RINGS), FP.dhash(resize(BASE_RINGS, 97, 97)));
    assert.ok(d <= FP.MATCH_THRESHOLD, `distancia ${d}`);
});

test('entradas inválidas fallan claro', () => {
    assert.throws(() => FP.phash(null), TypeError);
    assert.throws(() => FP.phash({ data: new Uint8Array(3), width: 2, height: 2 }), TypeError);
    assert.throws(() => FP.dhash({ data: new Uint8Array(4), width: 0, height: 2 }), TypeError);
});

// ---- Hamming, sha256, confianza ------------------------------------------------------

test('hamming cuenta bits distintos sobre hex de 64 bits', () => {
    assert.equal(FP.hamming('0000000000000000', '0000000000000000'), 0);
    assert.equal(FP.hamming('0000000000000000', 'ffffffffffffffff'), 64);
    assert.equal(FP.hamming('0f0f0f0f0f0f0f0f', '0f0f0f0f0f0f0f0e'), 1);
    assert.equal(FP.hamming('8000000000000001', '0000000000000000'), 2);
    assert.equal(FP.hamming('ABCDEF0123456789', 'abcdef0123456789'), 0);
    assert.throws(() => FP.hamming('xyz', '0000000000000000'), TypeError);
    assert.throws(() => FP.hamming('000', '0000000000000000'), TypeError);
});

test('sha256 en hex', () => {
    assert.equal(FP.sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('confidenceFor: casi segura ≤ 2 o sha igual; posible 3–8; null arriba', () => {
    assert.equal(FP.confidenceFor(0, false), 'casi_segura');
    assert.equal(FP.confidenceFor(2, false), 'casi_segura');
    assert.equal(FP.confidenceFor(3, false), 'posible');
    assert.equal(FP.confidenceFor(8, false), 'posible');
    assert.equal(FP.confidenceFor(9, false), null);
    assert.equal(FP.confidenceFor(30, true), 'casi_segura');
    assert.equal(FP.confidenceFor(NaN, false), null);
    assert.equal(FP.confidenceFor(-1, false), null);
    assert.equal(FP.MATCH_THRESHOLD, 8);
    assert.equal(FP.SEARCH_THRESHOLD, 12);
});

test('literal bit(64) y vuelta', () => {
    assert.equal(FP.hexToBitLiteral('0F0F0F0F0F0F0F0F'), 'x0f0f0f0f0f0f0f0f');
    assert.equal(FP.bitStringToHex('0000111100001111000011110000111100001111000011110000111100001111'), '0f0f0f0f0f0f0f0f');
    assert.equal(FP.bitStringToHex('nope'), null);
    assert.throws(() => FP.hexToBitLiteral('zz'), TypeError);
});

// ---- fuentes ---------------------------------------------------------------------------

const SB = 'https://proj.supabase.co';
const ARTIST = '11111111-1111-4111-8111-111111111111';
const STUDIO = '22222222-2222-4222-8222-222222222222';
const STUDIO_OWNER = '33333333-3333-4333-8333-333333333333';
const pub = (bucket, path) => `${SB}/storage/v1/object/public/${bucket}/${path}`;

function artistRow(items, extra = {}) {
    return { user_id: ARTIST, gallery_feed_items: items, registration_status: 'completo', sanction_state: 'none', instagram_verified_at: null, instagram_verified_handle: null, ...extra };
}

test('artistSources: claves, flashes, videos, externos y fechas declaradas', () => {
    const list = Sources.artistSources(artistRow([
        { url: `${pub('artist-gallery', `${ARTIST}/1_a.jpg`)}?v=3`, kind: 'image', category: 'realizados', created_at: '2026-01-02T00:00:00Z' },
        { url: pub('artist-gallery', `${ARTIST}/1_a.jpg`), kind: 'image', category: 'realizados' }, // duplicada
        { id: 'fl_abc', url: pub('artist-gallery', `${ARTIST}/2_f.png`), kind: 'image', category: 'flash' },
        { url: pub('artist-gallery', `${ARTIST}/3_v.mp4`), kind: 'video', category: 'realizados' },
        { url: pub('artist-gallery', `${ARTIST}/4.jpg`), kind: 'image', category: 'instagram-reel' },
        { url: '/shared/assets/demo.jpg', kind: 'image', category: 'realizados' },
        { url: 'https://images.unsplash.com/photo-1?w=800#x', kind: 'image', category: 'realizados' },
        { url: 'https://evil.example/storage/v1/object/public/artist-gallery/x.jpg', kind: 'image' },
        { url: '', kind: 'image' },
        null
    ]), { supabaseUrl: SB });
    assert.equal(list.length, 5);
    const [gallery, flash, relative, external, evil] = list;

    assert.equal(gallery.source_kind, 'artist_gallery');
    assert.equal(gallery.item_key, `artist:${ARTIST}|artist-gallery/${ARTIST}/1_a.jpg`);
    assert.equal(gallery.storage_bucket, 'artist-gallery');
    assert.equal(gallery.storage_path, `${ARTIST}/1_a.jpg`);
    assert.equal(gallery.url, pub('artist-gallery', `${ARTIST}/1_a.jpg`));
    assert.equal(gallery.claimed_at, '2026-01-02T00:00:00.000Z');
    assert.equal(gallery.skip_reason, null);
    assert.equal(gallery.is_public, true);
    assert.equal(gallery.artist_id, ARTIST);
    assert.equal(gallery.owner_user_id, ARTIST);
    assert.equal(gallery.owner_kind, 'artist');

    assert.equal(flash.source_kind, 'flash');
    assert.equal(flash.item_key, `artist:${ARTIST}|id:fl_abc`);
    assert.equal(flash.storage_path, `${ARTIST}/2_f.png`);

    assert.equal(relative.skip_reason, 'skipped_external');
    assert.equal(relative.item_key, `artist:${ARTIST}|url:/shared/assets/demo.jpg`);
    assert.equal(external.skip_reason, 'skipped_external');
    assert.equal(external.item_key, `artist:${ARTIST}|url:https://images.unsplash.com/photo-1?w=800`);
    assert.equal(evil.skip_reason, 'skipped_external');
    assert.equal(evil.storage_bucket, null);
});

test('artistSources: misma URL en dos artistas → claves distintas (atadas al dueño)', () => {
    const url = pub('artist-gallery', `${ARTIST}/1_a.jpg`);
    const a = Sources.artistSources(artistRow([{ url, kind: 'image' }]), { supabaseUrl: SB })[0];
    const b = Sources.artistSources(artistRow([{ url, kind: 'image' }], { user_id: STUDIO_OWNER }), { supabaseUrl: SB })[0];
    assert.notEqual(a.item_key, b.item_key);
});

test('artistSources: is_public sigue la regla de la galería y el estado del perfil', () => {
    const ig = { url: pub('artist-gallery', `${ARTIST}/instagram-import/1.jpg`), kind: 'image', category: 'instagram', source: 'instagram', ig_handle: 'tattoo.ana' };
    const own = { url: pub('artist-gallery', `${ARTIST}/2.jpg`), kind: 'image', category: 'realizados' };
    let [igSrc, ownSrc] = Sources.artistSources(artistRow([ig, own]), { supabaseUrl: SB });
    assert.equal(igSrc.is_public, false, 'Instagram sin validar: oculto');
    assert.equal(ownSrc.is_public, true);
    [igSrc] = Sources.artistSources(artistRow([ig], { instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: '@Tattoo.Ana' }), { supabaseUrl: SB });
    assert.equal(igSrc.is_public, true, 'Instagram validado con el mismo usuario');
    [igSrc] = Sources.artistSources(artistRow([ig], { instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: 'otra' }), { supabaseUrl: SB });
    assert.equal(igSrc.is_public, false);
    [ownSrc] = Sources.artistSources(artistRow([own], { registration_status: 'incompleto' }), { supabaseUrl: SB });
    assert.equal(ownSrc.is_public, false, 'alta incompleta');
    [ownSrc] = Sources.artistSources(artistRow([own], { sanction_state: 'suspended' }), { supabaseUrl: SB });
    assert.equal(ownSrc.is_public, false, 'sancionado');
});

test('studioSources: estudio activo, externos marcados, video omitido', () => {
    const list = Sources.studioSources({
        id: STUDIO, user_id: STUDIO_OWNER, is_active: true, sanction_state: 'none',
        photo_feed_items: [
            { url: pub('studio-photos', `${STUDIO}/a.webp`), kind: 'image', category: 'studio', created_at: 'nope' },
            { url: 'https://images.unsplash.com/photo-2', kind: 'image', category: 'studio' },
            { url: pub('studio-photos', `${STUDIO}/b.mp4`), kind: 'video' }
        ]
    }, { supabaseUrl: SB });
    assert.equal(list.length, 2);
    assert.equal(list[0].source_kind, 'studio_feed');
    assert.equal(list[0].item_key, `studio:${STUDIO}|studio-photos/${STUDIO}/a.webp`);
    assert.equal(list[0].studio_id, STUDIO);
    assert.equal(list[0].artist_id, null);
    assert.equal(list[0].owner_user_id, STUDIO_OWNER);
    assert.equal(list[0].is_public, true);
    assert.equal(list[0].claimed_at, null);
    assert.equal(list[1].skip_reason, 'skipped_external');
    const inactive = Sources.studioSources({ id: STUDIO, user_id: STUDIO_OWNER, is_active: false, photo_feed_items: [{ url: pub('studio-photos', 'x.jpg') }] }, { supabaseUrl: SB });
    assert.equal(inactive[0].is_public, false);
});

test('storeSources: vistas previas públicas si el producto está activo; diseños privados', () => {
    const P1 = '44444444-4444-4444-8444-444444444444';
    const P2 = '55555555-5555-4555-8555-555555555555';
    const list = Sources.storeSources({
        sellerType: 'studio', sellerId: STUDIO, ownerUserId: STUDIO_OWNER,
        products: [
            { id: P1, seller_id: STUDIO, status: 'active', images: [{ path: `${STUDIO}/${P1}/1.webp` }] },
            { id: P2, seller_id: STUDIO, status: 'draft', images: [{ path: `${STUDIO}/${P2}/1.webp` }, { path: '../x.webp' }] },
            { id: 'otro', seller_id: ARTIST, status: 'active', images: [{ path: 'ajeno.webp' }] }
        ],
        assets: [
            { id: 'a1', product_id: P1, storage_path: `${STUDIO}/${P1}/original/d.png`, mime_type: 'image/png' },
            { id: 'a2', product_id: P1, storage_path: `${STUDIO}/${P1}/original/d.pdf`, mime_type: 'application/pdf' },
            { id: 'a3', product_id: 'otro', storage_path: 'x.png', mime_type: 'image/png' }
        ]
    }, { supabaseUrl: SB });
    assert.equal(list.length, 3);
    const [active, draft, design] = list;
    assert.equal(active.source_kind, 'store_preview');
    assert.equal(active.is_public, true);
    assert.equal(active.url, pub('store-previews', `${STUDIO}/${P1}/1.webp`));
    assert.equal(active.owner_user_id, STUDIO_OWNER);
    assert.equal(draft.is_public, false);
    assert.equal(design.source_kind, 'store_design');
    assert.equal(design.storage_bucket, 'store-design-files');
    assert.equal(design.url, null);
    assert.equal(design.is_public, false);
    assert.equal(design.item_key, `studio:${STUDIO}|store-design-files/${STUDIO}/${P1}/original/d.png`);
});

test('isAllowedFetchUrl: solo buckets públicos de imágenes del proyecto o firmadas de diseño', () => {
    assert.equal(Sources.isAllowedFetchUrl(pub('artist-gallery', 'u/1.jpg'), SB), true);
    assert.equal(Sources.isAllowedFetchUrl(pub('studio-photos', 'u/1.jpg'), SB), true);
    assert.equal(Sources.isAllowedFetchUrl(pub('store-previews', 'u/1.webp'), SB), true);
    assert.equal(Sources.isAllowedFetchUrl(pub('support-attachments', 'u/1.jpg'), SB), false);
    assert.equal(Sources.isAllowedFetchUrl(pub('avatars', 'u/1.jpg'), SB), false);
    assert.equal(Sources.isAllowedFetchUrl(`${SB}/storage/v1/object/sign/store-design-files/u/d.png?token=t`, SB), true);
    assert.equal(Sources.isAllowedFetchUrl(`${SB}/storage/v1/object/sign/support-attachments/u/d.png?token=t`, SB), false);
    assert.equal(Sources.isAllowedFetchUrl('https://evil.example/storage/v1/object/public/artist-gallery/u/1.jpg', SB), false);
    assert.equal(Sources.isAllowedFetchUrl('https://proj.supabase.co.evil.example/storage/v1/object/public/artist-gallery/1.jpg', SB), false);
    assert.equal(Sources.isAllowedFetchUrl('http://proj.supabase.co/storage/v1/object/public/artist-gallery/1.jpg', SB), false);
    assert.equal(Sources.isAllowedFetchUrl(`${SB}/storage/v1/object/public/artist-gallery/%2e%2e/secret`, SB), false);
    assert.equal(Sources.isAllowedFetchUrl(`${SB}/rest/v1/artists_db`, SB), false);
    assert.equal(Sources.isAllowedFetchUrl('/shared/assets/x.jpg', SB), false);
    assert.equal(Sources.isAllowedFetchUrl(pub('artist-gallery', 'u/1.jpg'), ''), false);
});

// ---- decodificador sin sharp ------------------------------------------------------------

test('image-decode sin sharp: isAvailable false y 503 claro, sin romper', async () => {
    Decoder._setSharpForTests(null);
    try {
        assert.equal(Decoder.isAvailable(), false);
        await assert.rejects(() => Decoder.fingerprintBuffer(Buffer.from([1, 2, 3])), (err) => {
            assert.equal(err.code, 'DECODER_UNAVAILABLE');
            assert.equal(err.status, 503);
            assert.match(err.message, /no está disponible/);
            return true;
        });
    } finally {
        Decoder._resetForTests();
    }
});

test('image-decode con un sharp falso: tamaño máximo, pipeline y huellas', async () => {
    const gray = resize(BASE_SHAPES, 64, 64);
    const calls = [];
    const fakeSharp = (buf, opts) => {
        calls.push(opts);
        const chain = {
            metadata: async () => ({ width: 300, height: 200, orientation: 6 }),
            rotate: () => chain,
            flatten: () => chain,
            greyscale: () => chain,
            resize: (w, h, o) => { calls.push({ resize: [w, h, o.fit] }); return chain; },
            raw: () => chain,
            toBuffer: async () => ({ data: Buffer.from(gray.data), info: { width: 64, height: 64, channels: 1 } })
        };
        return chain;
    };
    Decoder._setSharpForTests(fakeSharp);
    try {
        assert.equal(Decoder.isAvailable(), true);
        await assert.rejects(() => Decoder.fingerprintBuffer(Buffer.alloc(Decoder.MAX_BYTES + 1)), { code: 'IMAGE_TOO_LARGE', status: 413 });
        await assert.rejects(() => Decoder.fingerprintBuffer(Buffer.alloc(0)), { code: 'INVALID_IMAGE' });
        const out = await Decoder.fingerprintBuffer(Buffer.from('fake-bytes'));
        assert.equal(out.phash, FP.phash(gray));
        assert.equal(out.phash_mirror, FP.phashMirror(gray));
        assert.equal(out.dhash, FP.dhash(gray));
        assert.equal(out.sha256, FP.sha256(Buffer.from('fake-bytes')));
        assert.deepEqual([out.width, out.height], [200, 300], 'orientación EXIF 6 intercambia ancho y alto');
        assert.equal(calls[0].failOn, 'error');
        assert.equal(calls[0].limitInputPixels, 40e6);
        assert.equal(calls[0].sequentialRead, true);
        assert.equal(calls[0].animated, false);
        assert.equal(calls[0].pages, 1);
        assert.ok(calls.some((c) => c.resize && c.resize[0] === 64 && c.resize[2] === 'fill'));
    } finally {
        Decoder._resetForTests();
    }
});

test('image-decode: endurece sharp al cargarlo (auditoría §5): cache, concurrency, block y timeout', async () => {
    const gray = resize(BASE_SHAPES, 64, 64);
    const global = [];
    const timeouts = [];
    const fakeSharp = () => {
        const chain = {
            metadata: async () => ({ width: 64, height: 64 }),
            timeout: (o) => { timeouts.push(o); return chain; },
            rotate: () => chain,
            flatten: () => chain,
            greyscale: () => chain,
            resize: () => chain,
            raw: () => chain,
            toBuffer: async () => ({ data: Buffer.from(gray.data), info: { width: 64, height: 64, channels: 1 } })
        };
        return chain;
    };
    fakeSharp.cache = (v) => global.push(['cache', v]);
    fakeSharp.concurrency = (v) => global.push(['concurrency', v]);
    fakeSharp.block = (v) => global.push(['block', v.operation]);
    fakeSharp.unblock = (v) => global.push(['unblock', v.operation]);
    Decoder._setSharpForTests(fakeSharp);
    try {
        assert.deepEqual(global, [
            ['cache', false],
            ['concurrency', 1],
            ['block', ['VipsForeignLoad']],
            ['unblock', ['VipsForeignLoadJpeg', 'VipsForeignLoadPng', 'VipsForeignLoadWebp']]
        ]);
        await Decoder.fingerprintBuffer(Buffer.from('fake-bytes'));
        assert.deepEqual(timeouts, [{ seconds: 15 }], 'el pipeline usa el timeout propio de sharp');
    } finally {
        Decoder._resetForTests();
    }
});

test('image-decode con sharp real (si está instalado): JPEG/PNG/WebP sí; GIF, TIFF y SVG no', async (t) => {
    let realSharp;
    try { realSharp = require('sharp'); } catch (_) { realSharp = null; }
    if (typeof realSharp !== 'function') { t.skip('sharp no está instalado'); return; }
    // Muestras creadas antes de bloquear los cargadores (crear no usa cargadores).
    const base = () => realSharp({ create: { width: 16, height: 16, channels: 3, background: '#c33' } });
    const samples = {};
    for (const f of ['jpeg', 'png', 'webp', 'gif', 'tiff']) samples[f] = await base()[f]().toBuffer();
    samples.svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>');
    Decoder._resetForTests();
    try {
        assert.equal(Decoder.isAvailable(), true);
        for (const f of ['jpeg', 'png', 'webp']) {
            const out = await Decoder.fingerprintBuffer(samples[f]);
            assert.match(out.phash, /^[0-9a-f]{16}$/, `${f} se decodifica`);
        }
        for (const f of ['gif', 'tiff', 'svg']) {
            await assert.rejects(() => Decoder.fingerprintBuffer(samples[f]), { code: 'DECODE_FAILED', status: 422 }, `${f} queda bloqueado`);
        }
    } finally {
        Decoder._resetForTests();
    }
});

test('image-decode: un archivo ilegible da DECODE_FAILED (422)', async () => {
    Decoder._setSharpForTests(() => ({ metadata: async () => { throw new Error('Input buffer contains unsupported image format'); } }));
    try {
        await assert.rejects(() => Decoder.fingerprintBuffer(Buffer.from('not an image')), { code: 'DECODE_FAILED', status: 422 });
    } finally {
        Decoder._resetForTests();
    }
});

// ---- revisión: claves e image_url dentro de los CHECK de la tabla ---------------------

test('image-sources: claves ≤ 1200 e image_url ≤ 2048 aunque la URL o la ruta sean enormes', () => {
    const ext1500 = `https://cdn.example.test/${'a'.repeat(1500)}.jpg`;
    const ext2500 = `https://cdn.example.test/${'b'.repeat(2500)}.jpg`;
    const accents = `${SB}/storage/v1/object/public/artist-gallery/${ARTIST}/${encodeURIComponent('ñ'.repeat(600))}.jpg`;
    const list = Sources.artistSources(artistRow([
        { url: ext1500, kind: 'image' },
        { url: ext2500, kind: 'image' },
        { url: accents, kind: 'image' },
        { id: 'fl_x', url: ext2500, kind: 'image', category: 'flash' }
    ]), { supabaseUrl: SB });
    assert.equal(list.length, 4);
    for (const s of list) {
        assert.ok(s.item_key.length <= Sources.MAX_KEY, s.item_key.slice(0, 40));
        assert.ok(!s.image_url || s.image_url.length <= Sources.MAX_URL);
    }
    const [a, b, c, flash] = list;
    assert.match(a.item_key, new RegExp(`^artist:${ARTIST}\\|sha256:[0-9a-f]{64}$`));
    assert.equal(a.image_url, ext1500);
    assert.notEqual(a.item_key, b.item_key, 'URLs distintas → claves distintas');
    assert.equal(b.image_url, null);
    assert.equal(b.skip_reason, 'skipped_external');
    // Ruta de Storage válida (≤ 1024 decodificada) pero URL codificada > 2048:
    // se descarga igual (url) y no se guarda la URL (image_url null).
    assert.equal(c.skip_reason, null);
    assert.equal(c.storage_path, `${ARTIST}/${'ñ'.repeat(600)}.jpg`);
    assert.ok(c.url.length > Sources.MAX_URL);
    assert.equal(c.image_url, null);
    assert.equal(c.item_key, `artist:${ARTIST}|artist-gallery/${ARTIST}/${'ñ'.repeat(600)}.jpg`);
    assert.equal(flash.item_key, `artist:${ARTIST}|id:fl_x`);
    // Estable entre corridas.
    const again = Sources.artistSources(artistRow([{ url: ext1500, kind: 'image' }]), { supabaseUrl: SB })[0];
    assert.equal(again.item_key, a.item_key);
    assert.equal(Sources.ownerKey('artist:x|', 'url:corta'), 'artist:x|url:corta');
});

test('repo de huellas: bit(64) de PostgREST pasa a hex y la espera del reintento crece con tope', () => {
    const { _internal } = require('../lib/repos/image-fingerprints');
    const bits = '0000111100001111000011110000111100001111000011110000111100001111';
    const row = _internal.normalizeFp({ id: 'x', phash: bits, phash_mirror: null, status: 'ok' });
    assert.equal(row.phash, '0f0f0f0f0f0f0f0f');
    assert.equal(row.phash_mirror, null);
    assert.deepEqual(_internal.normalizeFp({ id: 'y' }), { id: 'y' });
    const now = new Date('2026-11-18T12:00:00Z');
    const minutes = (iso) => (Date.parse(iso) - now.getTime()) / 60000;
    assert.equal(minutes(_internal.backoffIso(1, now)), 2);
    assert.equal(minutes(_internal.backoffIso(3, now)), 8);
    assert.equal(minutes(_internal.backoffIso(9, now)), 30);
});
