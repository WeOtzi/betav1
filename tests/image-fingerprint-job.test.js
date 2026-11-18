'use strict';
// Trabajo de huellas (lib/image-fingerprint-job.js) con dependencias falsas:
// cola, reconciliación, alertas por par, excepción artista-estudio, espejo,
// decodificador ausente, lista blanca de descargas y arranque.
const test = require('node:test');
const assert = require('node:assert/strict');

const Job = require('../lib/image-fingerprint-job');
const FP = require('../lib/image-fingerprint');

const SB = 'https://proj.supabase.co';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const S_OWNER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const P1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const pub = (bucket, path) => `${SB}/storage/v1/object/public/${bucket}/${path}`;

// Huellas falsas por contenido del archivo.
const HASHES = {
    rose: { phash: '0f0f0f0f0f0f0f0f', phash_mirror: 'f0f0f0f0f0f0f0f0', dhash: '1111111111111111' },
    rose_tweaked: { phash: '0f0f0f0f0f0f0f0e', phash_mirror: 'f0f0f0f0f0f0f0f1', dhash: '1111111111111110' },
    rose_mirrored: { phash: 'f0f0f0f0f0f0f0f0', phash_mirror: '0f0f0f0f0f0f0f0f', dhash: '2222222222222222' },
    skull: { phash: '123456789abcdef0', phash_mirror: '0fedcba987654321', dhash: '3333333333333333' }
};

function makeEnv({ decoderAvailable = true, allowed = [] } = {}) {
    const state = {
        artists: new Map(),
        studios: new Map(),
        store: new Map(),
        queue: [],
        fps: [],
        alerts: [],
        emails: [],
        fetched: [],
        signed: [],
        clock: Date.parse('2026-11-18T12:00:00Z'),
        objects: new Map(),
        allowed: new Set(allowed),
        rejectKeys: new Set(),
        failFetch: 0
    };
    let seq = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    const tick = () => {
        state.clock += 60000;
        return new Date(state.clock).toISOString();
    };

    // Simula los CHECK de image_fingerprints: PostgREST responde 400 con la fila.
    const checkRow = (r) => {
        const bad = r.item_key.length > 1200 || (r.image_url && r.image_url.length > 2048) || state.rejectKeys.has(r.item_key);
        if (bad) {
            throw Object.assign(new Error(`PostgREST POST image_fingerprints failed (400): {"code":"23514","message":"Failing row contains (${r.item_key}, ${r.image_url})"}`), { status: 400 });
        }
    };

    const repo = {
        async claimDirty(limit, now) {
            const at = now ? now.getTime() : state.clock;
            return state.queue.filter((e) => e.attempts < 5 && Date.parse(e.dirty_at) <= at).slice(0, limit).map((e) => ({ ...e }));
        },
        async ackDirty(entry) {
            state.queue = state.queue.filter((e) => !(e.source_table === entry.source_table && e.owner_id === entry.owner_id && e.dirty_at === entry.dirty_at));
        },
        async failDirty(entry, message, now) {
            const e = state.queue.find((q) => q.source_table === entry.source_table && q.owner_id === entry.owner_id && q.dirty_at === entry.dirty_at);
            if (!e) return;
            e.attempts += 1;
            e.last_error = message;
            e.dirty_at = new Date((now ? now.getTime() : state.clock) + Math.min(30, 2 ** e.attempts) * 60000).toISOString();
        },
        async loadArtist(id) { return state.artists.get(id) || null; },
        async loadStudio(id) { return state.studios.get(id) || null; },
        async loadStoreSeller(id) { return state.store.get(id) || null; },
        async isAllowedArtistStudio(artist, studio) { return state.allowed.has(`${artist}:${studio}`); },
        async activeSupportEmails() { return ['agente@example.test']; },
        async listByOwner(ownerId, kinds) {
            return state.fps.filter((f) => (f.artist_id === ownerId || f.studio_id === ownerId) && kinds.includes(f.source_kind)).map((f) => ({ ...f }));
        },
        async upsertFingerprints(rows) {
            for (const r of rows) checkRow(r);
            return rows.map((r) => {
                let row = state.fps.find((f) => f.source_kind === r.source_kind && f.item_key === r.item_key);
                if (!row) {
                    row = { id: nextId() };
                    state.fps.push(row);
                }
                Object.assign(row, r);
                return { ...row };
            });
        },
        async patchFingerprint(id, patch) {
            const row = state.fps.find((f) => f.id === id);
            Object.assign(row, patch);
            return { ...row };
        },
        async markRemovedIds(ids, at) {
            for (const f of state.fps) if (ids.includes(f.id) && !f.removed_at) f.removed_at = at;
            return ids.length;
        },
        async storageObjects(bucket, paths) {
            const map = new Map();
            for (const p of paths) {
                const o = state.objects.get(`${bucket}/${p}`);
                if (o) map.set(p, { created_at: o.created_at, updated_at: o.updated_at, version: `${o.id}|v${o.rev}|etag${o.rev}` });
            }
            return map;
        },
        async markMatchChecked(ids, at) {
            for (const f of state.fps) if (ids.includes(f.id)) f.match_checked_at = at;
            return ids.length;
        },
        async findCandidates({ phash, phashMirror, threshold, excludeOwner }) {
            return state.fps
                .filter((f) => f.status === 'ok')
                .filter((f) => !excludeOwner || (f.owner_user_id !== excludeOwner && f.artist_id !== excludeOwner && f.studio_id !== excludeOwner))
                .map((f) => ({
                    ...f,
                    distance: Math.min(FP.hamming(f.phash, phash), FP.hamming(f.phash_mirror, phash), FP.hamming(f.phash, phashMirror))
                }))
                .filter((f) => f.distance <= threshold)
                .sort((x, y) => x.distance - y.distance);
        },
        async findRemovalAlerts(ids) {
            return state.alerts
                .filter((a) => a.kind === 'image_duplicate' && a.status === 'handled' && a.payload.removal && ids.includes(a.payload.new.fp_id))
                .map((a) => ({ ...a, payload: { ...a.payload } }));
        },
        async reopenRemovalAlert(id, payload) {
            const a = state.alerts.find((x) => x.id === id && x.status === 'handled');
            if (!a) return null;
            Object.assign(a, { status: 'open', payload, handled_by: null, handled_at: null });
            return { ...a };
        },
        async recordAlert({ subject_user_id, related_user_id, payload }) {
            if (state.alerts.some((a) => a.payload.pair_key === payload.pair_key)) return null;
            const alert = { id: nextId(), kind: 'image_duplicate', status: 'open', subject_user_id, related_user_id, payload, created_at: new Date(state.clock).toISOString() };
            state.alerts.push(alert);
            return alert;
        }
    };

    const decoder = {
        isAvailable: () => decoderAvailable,
        async fingerprintBuffer(buf) {
            const name = buf.toString('utf8');
            if (!HASHES[name]) throw Object.assign(new Error('bad'), { code: 'DECODE_FAILED' });
            return { sha256: FP.sha256(buf), ...HASHES[name], width: 100, height: 80 };
        }
    };

    // Archivos "en Storage": URL → contenido.
    const files = new Map();
    const fetchImpl = async (url) => {
        state.fetched.push(url);
        if (state.failFetch > 0) {
            state.failFetch -= 1;
            return { ok: false, status: 503, headers: { get: () => null } };
        }
        const key = url.split('?')[0];
        if (!files.has(key)) return { ok: false, status: 404, headers: { get: () => null } };
        const body = Buffer.from(files.get(key));
        return { ok: true, status: 200, headers: { get: () => String(body.length) }, arrayBuffer: async () => body };
    };

    const log = { warns: [], log() {}, warn(...args) { this.warns.push(args.join(' ')); }, error() {} };

    const deps = {
        repo,
        decoder,
        fetchImpl,
        signUrl: async (bucket, path) => {
            state.signed.push(`${bucket}/${path}`);
            return `${SB}/storage/v1/object/sign/${bucket}/${path}?token=tok`;
        },
        sendEmail: async (eventId, payload, opts) => {
            state.emails.push({ eventId, payload, opts });
            return { ok: true };
        },
        supabaseUrl: SB,
        baseUrl: () => 'https://beta.example.test',
        env: () => ({ SUPPORT_EMAIL: 'soporte@example.test' }),
        now: () => new Date(state.clock),
        log
    };

    function enqueue(source_table, owner_id) {
        const dirty_at = tick();
        const existing = state.queue.find((e) => e.source_table === source_table && e.owner_id === owner_id);
        if (existing) { existing.dirty_at = dirty_at; existing.attempts = 0; } else state.queue.push({ source_table, owner_id, dirty_at, attempts: 0 });
    }

    function putArtist(userId, items, extra = {}) {
        state.artists.set(userId, { user_id: userId, gallery_feed_items: items, registration_status: 'completo', sanction_state: 'none', ...extra });
        enqueue('artists_db', userId);
    }

    // Sube a Storage. Si la ruta ya existe: 'overwrite' (mismo objeto, otra
    // versión, updated_at nuevo) o 'reupload' (borrado y subido de nuevo).
    let objSeq = 0;
    function upload(bucket, path, content, createdAt, mode = 'overwrite') {
        files.set(pub(bucket, path), content);
        const key = `${bucket}/${path}`;
        const nowIso = new Date(state.clock).toISOString();
        const prev = state.objects.get(key);
        if (prev && mode === 'overwrite') {
            prev.rev += 1;
            prev.updated_at = nowIso;
        } else {
            const at = createdAt || nowIso;
            state.objects.set(key, { id: `obj-${++objSeq}`, rev: 1, created_at: at, updated_at: at });
        }
        return pub(bucket, path);
    }

    return { state, deps, enqueue, putArtist, upload, files, log };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('un ítem nuevo se huellea, se fecha con Storage y la cola queda vacía', async () => {
    const env = makeEnv();
    const url = env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-05-01T10:00:00Z');
    env.putArtist(A, [{ url, kind: 'image', category: 'realizados', created_at: '2020-01-01T00:00:00Z' }]);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.owners, 1);
    assert.equal(r.fingerprinted, 1);
    assert.equal(env.state.queue.length, 0);
    const [fp] = env.state.fps;
    assert.equal(fp.status, 'ok');
    assert.equal(fp.phash, HASHES.rose.phash);
    assert.equal(fp.first_seen_at, '2026-05-01T10:00:00Z', 'fecha de Storage, no la del cliente');
    assert.equal(fp.claimed_at, '2020-01-01T00:00:00.000Z');
    assert.equal(fp.is_public, true);
    assert.equal(fp.artist_id, A);
    assert.equal(env.state.alerts.length, 0);
});

test('un ítem que desaparece queda con removed_at (prueba de antigüedad) y vuelve si reaparece', async () => {
    const env = makeEnv();
    const url = env.upload('artist-gallery', `${A}/1.jpg`, 'rose');
    const item = { url, kind: 'image', category: 'realizados' };
    env.putArtist(A, [item]);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(A, []);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.removed, 1);
    assert.equal(env.state.fps.length, 1, 'la fila se conserva');
    assert.ok(env.state.fps[0].removed_at);
    env.putArtist(A, [item]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.fps[0].removed_at, null);
    assert.equal(env.state.fetched.length, 1, 'no se vuelve a descargar');
});

test('copia de otro artista: UNA alerta y UN correo por par, aunque pasen dos ciclos', async () => {
    const env = makeEnv();
    const urlA = env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z');
    env.putArtist(A, [{ url: urlA, kind: 'image', category: 'realizados' }]);
    await Job.runFingerprintCycle(env.deps);

    const itemsB = [{ url: env.upload('artist-gallery', `${B}/copia.jpg`, 'rose_tweaked', '2026-10-01T00:00:00Z'), kind: 'image', category: 'realizados' }];
    env.putArtist(B, itemsB);
    const before = JSON.stringify(env.state.artists.get(B));
    const r1 = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r1.alerts, 1);
    assert.equal(env.state.alerts.length, 1);
    const alert = env.state.alerts[0];
    assert.equal(alert.subject_user_id, B, 'quien subió la nueva');
    assert.equal(alert.related_user_id, A, 'dueño de la anterior');
    assert.equal(alert.payload.distance, 1);
    assert.equal(alert.payload.confidence, 'casi_segura');
    assert.equal(alert.payload.new.owner_kind, 'artist');
    assert.equal(alert.payload.new.owner_id, B);
    assert.equal(alert.payload.existing.owner_id, A);
    assert.equal(alert.payload.existing.first_seen_at, '2026-03-01T00:00:00Z');
    const ids = [alert.payload.new.fp_id, alert.payload.existing.fp_id].sort();
    assert.equal(alert.payload.pair_key, ids.join(':'));
    for (const key of ['fp_id', 'source_kind', 'item_key', 'image_url', 'owner_kind', 'owner_id', 'first_seen_at']) {
        assert.ok(key in alert.payload.new && key in alert.payload.existing, key);
    }

    assert.equal(env.state.emails.length, 1);
    const mail = env.state.emails[0];
    assert.equal(mail.eventId, 'support_security_alert');
    assert.equal(mail.opts.idempotencyKey, `image_duplicate:${alert.payload.pair_key}`);
    assert.equal(mail.opts.ignorePreferences, true);
    assert.equal(mail.payload.alert_kind, 'image_duplicate');
    assert.equal(mail.payload.support_email, 'soporte@example.test');

    // Decisión del dueño: no se toca el ítem de nadie.
    assert.equal(JSON.stringify(env.state.artists.get(B)), before);
    assert.equal(env.state.fps.filter((f) => f.removed_at).length, 0);

    // Segundo ciclo: B agrega otra imagen; el par viejo no vuelve a avisar.
    itemsB.push({ url: env.upload('artist-gallery', `${B}/otra.jpg`, 'skull'), kind: 'image', category: 'realizados' });
    env.putArtist(B, itemsB);
    // Y A vuelve a guardar su galería (re-encola): tampoco duplica.
    env.enqueue('artists_db', A);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.emails.length, 1);
});

test('el par artista ↔ su estudio no genera alerta', async () => {
    const env = makeEnv({ allowed: [`${A}:${S}`] });
    const urlA = env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z');
    env.putArtist(A, [{ url: urlA, kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    const urlS = env.upload('studio-photos', `${S}/1.jpg`, 'rose');
    env.state.studios.set(S, { id: S, user_id: S_OWNER, is_active: true, sanction_state: 'none', photo_feed_items: [{ url: urlS, kind: 'image', category: 'studio' }] });
    env.enqueue('studios', S);
    const r = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r.allowed, 1);
    assert.equal(env.state.alerts.length, 0);
    assert.equal(env.state.emails.length, 0);
    const studioFp = env.state.fps.find((f) => f.source_kind === 'studio_feed');
    assert.equal(studioFp.studio_id, S);
    assert.equal(studioFp.owner_user_id, S_OWNER);
});

test('otro estudio con la misma foto sí genera alerta (owner_kind studio)', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    env.state.studios.set(S, { id: S, user_id: S_OWNER, is_active: true, photo_feed_items: [{ url: env.upload('studio-photos', `${S}/1.jpg`, 'rose') }] });
    env.enqueue('studios', S);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.alerts[0].payload.new.owner_kind, 'studio');
    assert.equal(env.state.alerts[0].payload.new.owner_id, S);
    assert.equal(env.state.alerts[0].subject_user_id, S_OWNER);
});

test('una copia espejada se detecta', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(C, [{ url: env.upload('artist-gallery', `${C}/1.jpg`, 'rose_mirrored'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.alerts[0].payload.distance, 0);
    assert.equal(env.state.alerts[0].subject_user_id, C);
});

test('imagen distinta y misma persona: sin alerta', async () => {
    const env = makeEnv();
    env.putArtist(A, [
        { url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose'), kind: 'image' },
        { url: env.upload('artist-gallery', `${A}/2.jpg`, 'rose_tweaked'), kind: 'image' }
    ]);
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/1.jpg`, 'skull'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 0);
});

test('carga inicial en cualquier orden: la más vieja según Storage es la «existente»', async () => {
    const env = makeEnv();
    // B (copia, más nueva) se procesa primero; A (original) después.
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/1.jpg`, 'rose', '2026-10-01T00:00:00Z'), kind: 'image' }]);
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 1);
    const alert = env.state.alerts[0];
    assert.equal(alert.subject_user_id, B);
    assert.equal(alert.related_user_id, A);
    assert.equal(alert.payload.existing.owner_id, A);
    assert.equal(alert.payload.confidence, 'casi_segura');
});

test('externos y relativos no se descargan (skipped_external); fallas quedan marcadas', async () => {
    const env = makeEnv();
    env.putArtist(A, [
        { url: 'https://images.unsplash.com/photo-1', kind: 'image' },
        { url: '/shared/assets/demo.jpg', kind: 'image' },
        { url: 'https://evil.example/storage/v1/object/public/artist-gallery/x.jpg', kind: 'image' },
        { url: pub('support-attachments', `${A}/privada.jpg`), kind: 'image' },
        { url: pub('artist-gallery', `${A}/no-existe.jpg`), kind: 'image' },
        { url: env.upload('artist-gallery', `${A}/rota.jpg`, 'garbage'), kind: 'image' }
    ]);
    const r = await Job.runFingerprintCycle(env.deps);
    const byStatus = {};
    for (const f of env.state.fps) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    assert.deepEqual(byStatus, { skipped_external: 4, fetch_failed: 1, decode_failed: 1 });
    assert.ok(env.state.fetched.every((u) => u.startsWith(`${SB}/storage/v1/object/public/artist-gallery/`)), 'solo Storage permitido');
    assert.equal(env.state.fetched.length, 2);
    assert.equal(r.failed_items, 2);
    // fetch_failed se reintenta en la próxima marca; los demás no.
    env.upload('artist-gallery', `${A}/no-existe.jpg`, 'skull');
    env.enqueue('artists_db', A);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.fetched.length, 3);
    assert.equal(env.state.fps.find((f) => f.item_key.endsWith('no-existe.jpg')).status, 'ok');
});

test('archivos de diseño de la tienda: se descargan con URL firmada', async () => {
    const env = makeEnv();
    const designPath = `${S}/${P1}/original/d.png`;
    env.files.set(`${SB}/storage/v1/object/sign/store-design-files/${designPath}`, 'skull');
    env.upload('store-previews', `${S}/${P1}/1.webp`, 'rose');
    env.state.store.set(S, {
        sellerType: 'studio', sellerId: S, ownerUserId: S_OWNER, sellerPublic: true,
        products: [{ id: P1, seller_id: S, status: 'active', images: [{ path: `${S}/${P1}/1.webp` }] }],
        assets: [{ id: 'x', product_id: P1, storage_path: designPath, mime_type: 'image/png' }]
    });
    env.enqueue('store_products', S);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.fingerprinted, 2);
    assert.deepEqual(env.state.signed, [`store-design-files/${designPath}`]);
    const design = env.state.fps.find((f) => f.source_kind === 'store_design');
    assert.equal(design.is_public, false);
    assert.equal(design.image_url, null);
    assert.equal(env.state.fps.find((f) => f.source_kind === 'store_preview').is_public, true);
});

test('un dueño que falla queda en la cola con el error y el ciclo sigue', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose'), kind: 'image' }]);
    env.enqueue('artists_db', B);
    env.deps.repo.loadArtist = async (id) => {
        if (id === B) throw new Error('PostgREST caído');
        return env.state.artists.get(id);
    };
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.failed_owners, 1);
    assert.equal(r.fingerprinted, 1);
    const left = env.state.queue.find((e) => e.owner_id === B);
    assert.equal(left.attempts, 1);
    assert.match(left.last_error, /postgrest/i);
});

test('sin decodificador: el ciclo no hace nada y el arranque avisa una vez y queda apagado', async () => {
    const env = makeEnv({ decoderAvailable: false });
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose'), kind: 'image' }]);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.skipped, 'decoder_unavailable');
    assert.equal(env.state.queue.length, 1, 'la cola se conserva para cuando haya decodificador');
    const timers = { setTimeout: () => assert.fail('no debe programar'), setInterval: () => assert.fail('no debe programar'), clearTimeout() {}, clearInterval() {} };
    const stop = Job.startImageFingerprintJob({ deps: env.deps, timers, env: {} });
    assert.equal(stop, null);
    assert.equal(env.log.warns.length, 1);
    assert.match(env.log.warns[0], /sharp/);
});

test('arranque: IMAGE_FP_JOB=off lo apaga; si no, programa con unref, guarda contra solapes y se detiene', async () => {
    const env = makeEnv();
    const never = { setTimeout: () => assert.fail('apagado'), setInterval: () => assert.fail('apagado'), clearTimeout() {}, clearInterval() {} };
    assert.equal(Job.startImageFingerprintJob({ deps: env.deps, timers: never, env: { IMAGE_FP_JOB: 'off' } }), null);
    assert.equal(Job.jobEnabled({ IMAGE_FP_JOB: 'OFF' }), false);
    assert.equal(Job.jobEnabled({}), true);

    const scheduled = [];
    const cleared = [];
    const handle = (kind, fn, ms) => {
        const h = { kind, fn, ms, unrefed: false, unref() { this.unrefed = true; } };
        scheduled.push(h);
        return h;
    };
    const timers = {
        setTimeout: (fn, ms) => handle('timeout', fn, ms),
        setInterval: (fn, ms) => handle('interval', fn, ms),
        clearTimeout: (h) => cleared.push(h),
        clearInterval: (h) => cleared.push(h)
    };
    let claims = 0;
    let release;
    env.deps.repo.claimDirty = () => {
        claims += 1;
        return new Promise((resolve) => { release = () => resolve([]); });
    };
    const stop = Job.startImageFingerprintJob({ deps: env.deps, timers, env: {} });
    assert.equal(typeof stop, 'function');
    assert.deepEqual(scheduled.map((h) => [h.kind, h.ms]), [['timeout', 90000], ['interval', 60000]]);
    assert.ok(scheduled.every((h) => h.unrefed));
    assert.equal(Job.startImageFingerprintJob({ deps: env.deps, timers, env: {} }), stop, 'una sola instancia');

    const first = scheduled[0].fn();
    scheduled[1].fn(); // mientras corre el primero: no se solapa
    assert.equal(claims, 1);
    release();
    await first;
    Job.stopImageFingerprintJob();
    assert.equal(cleared.length, 2);
    assert.equal(Job._internal.current(), null);
});

test('fetchImageBytes: lista blanca antes de pedir, sin redirecciones, tope de 10 MB', async () => {
    const calls = [];
    const okFetch = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true, status: 200, headers: { get: () => '3' }, arrayBuffer: async () => Buffer.from('abc') };
    };
    await assert.rejects(() => Job.fetchImageBytes('https://evil.example/x.jpg', { supabaseUrl: SB, fetchImpl: okFetch }), { code: 'FETCH_NOT_ALLOWED' });
    await assert.rejects(() => Job.fetchImageBytes(pub('support-attachments', 'u/x.jpg'), { supabaseUrl: SB, fetchImpl: okFetch }), { code: 'FETCH_NOT_ALLOWED' });
    await assert.rejects(() => Job.fetchImageBytes('http://169.254.169.254/latest/meta-data', { supabaseUrl: SB, fetchImpl: okFetch }), { code: 'FETCH_NOT_ALLOWED' });
    assert.equal(calls.length, 0, 'nunca se pide una URL no permitida');

    const buf = await Job.fetchImageBytes(pub('artist-gallery', 'u/x.jpg'), { supabaseUrl: SB, fetchImpl: okFetch });
    assert.equal(buf.toString(), 'abc');
    assert.equal(calls[0].opts.redirect, 'error');
    assert.ok(calls[0].opts.signal);

    const big = async () => ({ ok: true, status: 200, headers: { get: () => String(Job.MAX_BYTES + 1) }, arrayBuffer: async () => Buffer.alloc(1) });
    await assert.rejects(() => Job.fetchImageBytes(pub('artist-gallery', 'u/x.jpg'), { supabaseUrl: SB, fetchImpl: big }), { code: 'FETCH_TOO_LARGE' });

    // Sin content-length: el tope se aplica mientras se lee.
    const chunk = new Uint8Array(1024 * 1024);
    let reads = 0;
    const streaming = async () => ({
        ok: true, status: 200, headers: { get: () => null },
        body: { getReader: () => ({ read: async () => (++reads > 12 ? { done: true } : { done: false, value: chunk }), cancel: async () => {} }) }
    });
    await assert.rejects(() => Job.fetchImageBytes(pub('artist-gallery', 'u/x.jpg'), { supabaseUrl: SB, fetchImpl: streaming }), { code: 'FETCH_TOO_LARGE' });

    const slow = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await assert.rejects(() => Job.fetchImageBytes(pub('artist-gallery', 'u/x.jpg'), { supabaseUrl: SB, fetchImpl: slow, timeoutMs: 10 }), { code: 'FETCH_TIMEOUT' });
});

// ---- revisión: claves largas, cambios de contenido, reintentos ---------------------

test('URL externa de 1500 caracteres y ruta con muchos no ASCII: el resto del dueño se huellea igual', async () => {
    const env = makeEnv();
    const longExternal = `https://cdn.example.test/${'a'.repeat(1500)}.jpg`;
    const nonAsciiPath = `${A}/${'ñ'.repeat(600)}.jpg`;
    const encodedUrl = `${SB}/storage/v1/object/public/artist-gallery/${A}/${encodeURIComponent('ñ'.repeat(600))}.jpg`;
    assert.ok(encodedUrl.length > 2048, 'la URL codificada no entra en image_url');
    env.upload('artist-gallery', nonAsciiPath, 'skull', '2026-04-01T00:00:00Z');
    env.files.set(encodedUrl, 'skull');
    env.putArtist(A, [
        { url: longExternal, kind: 'image' },
        { url: encodedUrl, kind: 'image' },
        { url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }
    ]);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.failed_owners, 0);
    assert.equal(env.state.queue.length, 0);
    assert.equal(env.state.fps.length, 3);
    const ext = env.state.fps.find((f) => f.status === 'skipped_external');
    assert.ok(ext.item_key.length <= 1200);
    assert.match(ext.item_key, new RegExp(`^artist:${A}\\|sha256:[0-9a-f]{64}$`));
    assert.equal(ext.image_url, longExternal, 'la URL sí entra en image_url (≤ 2048)');
    const accents = env.state.fps.find((f) => f.storage_path === nonAsciiPath);
    assert.equal(accents.status, 'ok');
    assert.equal(accents.image_url, null);
    assert.equal(accents.first_seen_at, '2026-04-01T00:00:00Z');
    assert.ok(accents.item_key.length <= 1200);
    assert.equal(env.state.fps.find((f) => f.storage_path === `${A}/1.jpg`).status, 'ok');
});

test('una fila rechazada por la base no tumba al resto; el dueño queda en la cola sin datos en el error', async () => {
    const env = makeEnv();
    env.putArtist(A, [
        { url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose'), kind: 'image' },
        { url: env.upload('artist-gallery', `${A}/2.jpg`, 'skull'), kind: 'image' }
    ]);
    env.state.rejectKeys.add(`artist:${A}|artist-gallery/${A}/2.jpg`);
    const r = await Job.runFingerprintCycle(env.deps);
    assert.equal(r.failed_owners, 0);
    assert.equal(r.retried_owners, 1);
    assert.equal(env.state.fps.length, 1);
    assert.equal(env.state.fps[0].storage_path, `${A}/1.jpg`);
    const left = env.state.queue.find((e) => e.owner_id === A);
    assert.equal(left.attempts, 1);
    assert.equal(left.last_error, 'save_failed');
    const logs = env.log.warns.join('\n');
    assert.doesNotMatch(logs, /Failing row|2\.jpg/, 'ni el cuerpo de PostgREST ni la URL');
    assert.match(logs, /postgrest_400:23514/);

    // Se arregla la causa: el próximo intento guarda solo la que faltaba.
    env.state.rejectKeys.clear();
    env.state.clock += 3 * 60000;
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.fps.length, 2);
    assert.equal(env.state.queue.length, 0);
    assert.equal(env.state.fetched.length, 3, 'la que ya estaba no se vuelve a descargar');
});

test('flash con el mismo id y otra URL: se recalcula la huella y se detecta la copia', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    env.putArtist(B, [{ id: 'fl_1', url: env.upload('artist-gallery', `${B}/flash-a.png`, 'skull'), kind: 'image', category: 'flash' }]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 0);
    const before = { ...env.state.fps.find((f) => f.item_key === `artist:${B}|id:fl_1`) };
    assert.equal(before.phash, HASHES.skull.phash);

    env.state.clock += 60000;
    env.putArtist(B, [{ id: 'fl_1', url: env.upload('artist-gallery', `${B}/flash-b.png`, 'rose'), kind: 'image', category: 'flash' }]);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    const after = env.state.fps.find((f) => f.item_key === `artist:${B}|id:fl_1`);
    assert.equal(after.id, before.id, 'misma fila');
    assert.equal(after.phash, HASHES.rose.phash);
    assert.equal(after.storage_path, `${B}/flash-b.png`);
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.alerts[0].subject_user_id, B);
    assert.equal(env.state.emails.length, 1);
});

test('archivo pisado en la misma ruta: nueva huella, fecha de la nueva versión y alerta', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/x.jpg`, 'skull', '2026-01-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 0);

    // B pisa su archivo con la imagen de A (misma ruta, mismo objeto).
    env.state.clock += 60000;
    const overwrittenAt = new Date(env.state.clock).toISOString();
    env.upload('artist-gallery', `${B}/x.jpg`, 'rose');
    env.enqueue('artists_db', B);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    const fpB = env.state.fps.find((f) => f.artist_id === B);
    assert.equal(fpB.phash, HASHES.rose.phash);
    assert.equal(fpB.first_seen_at, overwrittenAt, 'no la fecha de la subida inocente');
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.alerts[0].subject_user_id, B, 'B es la nueva');
    assert.equal(env.state.alerts[0].related_user_id, A);

    // Sin cambios de versión no se vuelve a descargar.
    const fetched = env.state.fetched.length;
    env.enqueue('artists_db', B);
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.fetched.length, fetched);
});

test('archivo borrado y vuelto a subir en la misma ruta: fecha del objeto nuevo', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/x.jpg`, 'skull', '2026-01-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    env.state.clock += 60000;
    env.upload('artist-gallery', `${B}/x.jpg`, 'rose', null, 'reupload');
    const reuploadedAt = new Date(env.state.clock).toISOString();
    env.enqueue('artists_db', B);
    await Job.runFingerprintCycle(env.deps);
    const fpB = env.state.fps.find((f) => f.artist_id === B);
    assert.equal(fpB.phash, HASHES.rose.phash);
    assert.equal(fpB.first_seen_at, reuploadedAt);
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.alerts[0].subject_user_id, B);
});

test('si la búsqueda de copias falla, el dueño sigue en la cola y el ciclo siguiente crea UNA alerta y UN correo', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/1.jpg`, 'rose_tweaked'), kind: 'image' }]);
    const real = env.deps.repo.findCandidates;
    env.deps.repo.findCandidates = async () => { throw Object.assign(new Error('PostgREST rpc failed (503): upstream'), { status: 503 }); };
    const r1 = await Job.runFingerprintCycle(env.deps);
    assert.equal(r1.failed_owners, 1);
    assert.equal(env.state.alerts.length, 0);
    const fpB = env.state.fps.find((f) => f.artist_id === B);
    assert.equal(fpB.status, 'ok');
    assert.ok(!fpB.match_checked_at, 'queda pendiente');
    const left = env.state.queue.find((e) => e.owner_id === B);
    assert.equal(left.last_error, 'postgrest_503');

    env.deps.repo.findCandidates = real;
    env.state.clock += 3 * 60000;
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.emails.length, 1);
    assert.ok(env.state.fps.find((f) => f.artist_id === B).match_checked_at);
    assert.equal(env.state.queue.length, 0);
    assert.equal(env.state.fetched.filter((u) => u.includes(`${B}/1.jpg`)).length, 1, 'no se vuelve a descargar');

    // Otro ciclo del mismo dueño: no repite.
    env.enqueue('artists_db', B);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.emails.length, 1);
});

test('si crear la alerta falla, se reintenta sin duplicar', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(B, [{ url: env.upload('artist-gallery', `${B}/1.jpg`, 'rose'), kind: 'image' }]);
    const real = env.deps.repo.recordAlert;
    env.deps.repo.recordAlert = async () => { throw new Error('PostgREST caído'); };
    await Job.runFingerprintCycle(env.deps);
    assert.equal(env.state.alerts.length, 0);
    env.deps.repo.recordAlert = real;
    env.state.clock += 3 * 60000;
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(env.state.alerts.length, 1);
    assert.equal(env.state.emails.length, 1);
});

test('descarga fallida: el dueño sigue en la cola con espera y se reintenta solo, conservando la fecha', async () => {
    const env = makeEnv();
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-05-01T10:00:00Z'), kind: 'image' }]);
    env.state.failFetch = 1;
    const r1 = await Job.runFingerprintCycle(env.deps);
    assert.equal(r1.retried_owners, 1);
    assert.equal(env.state.fps[0].status, 'fetch_failed');
    const entry = env.state.queue.find((e) => e.owner_id === A);
    assert.equal(entry.attempts, 1);
    assert.equal(entry.last_error, 'fetch_failed');
    assert.ok(Date.parse(entry.dirty_at) > env.state.clock, 'reintento con espera');

    // Antes de la espera no se toma.
    const r2 = await Job.runFingerprintCycle(env.deps);
    assert.equal(r2.owners, 0);
    assert.equal(env.state.fetched.length, 1);

    env.state.clock += 3 * 60000;
    const r3 = await Job.runFingerprintCycle(env.deps);
    assert.equal(r3.fingerprinted, 1);
    assert.equal(env.state.fps[0].status, 'ok');
    assert.equal(env.state.fps[0].first_seen_at, '2026-05-01T10:00:00Z');
    assert.equal(env.state.queue.length, 0);
});

test('firstSeenFor: reintento sin dato de Storage conserva la fecha; archivo pisado usa updated_at', () => {
    const { firstSeenFor } = Job._internal;
    const previous = { first_seen_at: '2026-02-02T00:00:00Z', content_version: null };
    assert.equal(firstSeenFor({ reason: 'retry', previous, obj: null }, '2026-11-18T00:00:00Z'), '2026-02-02T00:00:00Z');
    assert.equal(firstSeenFor({ reason: 'new', previous: null, obj: null }, '2026-11-18T00:00:00Z'), '2026-11-18T00:00:00Z');
    const obj = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z', version: 'o1|v2|e' };
    assert.equal(firstSeenFor({ reason: 'content_changed', previous: { content_version: 'o1|v1|e' }, obj }, 'x'), '2026-06-01T00:00:00Z');
    assert.equal(firstSeenFor({ reason: 'content_changed', previous: { content_version: 'o0|v1|e' }, obj }, 'x'), '2026-01-01T00:00:00Z');
});

test('short(): de un error de PostgREST no quedan datos de la fila', () => {
    const { short } = Job._internal;
    const err = Object.assign(new Error('PostgREST POST image_fingerprints failed (400): {"code":"23514","message":"Failing row contains (artist:x|url:https://secreto)"}'), { status: 400 });
    assert.equal(short(err), 'postgrest_400:23514');
    assert.equal(short(new Error('Failing row contains (dato)')), 'postgrest_error');
    assert.equal(short(Object.assign(new Error('x'), { code: 'FETCH_TIMEOUT' })), 'FETCH_TIMEOUT');
});

// ---- imagen retirada por soporte que vuelve a publicarse ---------------------------------

// Lo que hace «Retirar» (lib/routes/disenos.js): quita el ítem del feed del que
// subió la copia, marca la huella borrada y deja la alerta 'handled' con
// payload.removal.
async function copyAndRetire(env) {
    env.putArtist(A, [{ url: env.upload('artist-gallery', `${A}/1.jpg`, 'rose', '2026-03-01T00:00:00Z'), kind: 'image' }]);
    await Job.runFingerprintCycle(env.deps);
    const copy = { url: env.upload('artist-gallery', `${B}/copia.jpg`, 'rose_tweaked'), kind: 'image', category: 'realizados' };
    env.putArtist(B, [copy]);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    const alert = env.state.alerts[0];
    assert.ok(alert, 'hay alerta del par');
    const fpB = env.state.fps.find((f) => f.id === alert.payload.new.fp_id);
    Object.assign(alert, {
        status: 'handled',
        resolution: 'Retirada: copia evidente',
        handled_by: P1,
        handled_at: new Date(env.state.clock).toISOString(),
        payload: { ...alert.payload, removal: { at: new Date(env.state.clock).toISOString(), by: P1, source: 'artists_db.gallery_feed_items', owner_kind: 'artist', owner_id: B, items: [copy] } }
    });
    fpB.removed_at = new Date(env.state.clock).toISOString();
    env.putArtist(B, []);
    await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(alert.status, 'handled', 'quitarla no reabre nada');
    env.state.emails.length = 0;
    return { alert, copy, fpB };
}

test('una imagen que soporte retiró y vuelve a publicarse: reabre la alerta y avisa UNA vez', async () => {
    const env = makeEnv();
    const { alert, copy, fpB } = await copyAndRetire(env);

    env.putArtist(B, [copy]); // el dueño guarda una copia vieja de su galería
    const r = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r.reopened, 1);
    assert.equal(alert.status, 'open');
    assert.equal(alert.handled_by, null);
    assert.equal(alert.payload.reappeared_at, new Date(env.state.clock).toISOString());
    assert.ok(alert.payload.removal, 'la copia de lo retirado se conserva');
    assert.equal(fpB.removed_at, null, 'la huella vuelve a estar activa');
    assert.equal(env.state.alerts.length, 1, 'no crea otra alerta');

    assert.equal(env.state.emails.length, 1);
    const mail = env.state.emails[0];
    assert.equal(mail.eventId, 'support_security_alert');
    assert.equal(mail.opts.idempotencyKey, `image_duplicate_reappeared:${alert.id}`);
    assert.equal(mail.opts.ignorePreferences, true);
    assert.equal(mail.payload.reappeared, true);
    assert.equal(mail.payload.alert_id, alert.id);
    assert.equal(mail.payload.confidence_label, 'casi segura');
    assert.equal(mail.payload.distance, '1');
    assert.equal(mail.payload.new_owner_kind, 'artist');
    assert.equal(mail.payload.existing_owner_kind, 'artist');

    // El correo se arma con el render real: asunto y CTA de reaparición.
    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail(mail.eventId, mail.payload);
    assert.match(out.subject, /volvió a publicarse una imagen retirada/i);
    assert.match(out.text, /Subió la nueva \(artista\)/);
    assert.match(out.cta.url, /\/support\/dashboard#sanciones$/);

    // Otro ciclo del mismo dueño: ni otra reapertura ni otro correo.
    env.enqueue('artists_db', B);
    const r2 = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r2.reopened, 0);
    assert.equal(env.state.emails.length, 1);
});

test('reaparición: si la alerta ya no está «handled» o el ítem lo quitó su dueño, no se reabre nada', async () => {
    const env = makeEnv();
    const { alert, copy } = await copyAndRetire(env);
    alert.status = 'dismissed';
    env.putArtist(B, [copy]);
    const r = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r.reopened, 0);
    assert.equal(alert.status, 'dismissed');
    assert.equal(env.state.emails.length, 0);

    // Un ítem que el propio dueño quitó y vuelve: sin alerta de retiro, nada.
    const own = { url: env.upload('artist-gallery', `${C}/1.jpg`, 'skull'), kind: 'image' };
    env.putArtist(C, [own]);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(C, []);
    await Job.runFingerprintCycle(env.deps);
    env.putArtist(C, [own]);
    const r2 = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r2.reopened, 0);
    assert.equal(env.state.fps.find((f) => f.artist_id === C).removed_at, null);
    assert.equal(env.state.emails.length, 0);
});

test('reaparición: si la consulta de alertas falla, removed_at sigue y el próximo ciclo la reabre', async () => {
    const env = makeEnv();
    const { alert, copy, fpB } = await copyAndRetire(env);
    const real = env.deps.repo.findRemovalAlerts;
    env.deps.repo.findRemovalAlerts = async () => { throw Object.assign(new Error('PostgREST GET security_alerts failed (503)'), { status: 503 }); };
    env.putArtist(B, [copy]);
    const r1 = await Job.runFingerprintCycle(env.deps);
    assert.equal(r1.failed_owners, 1);
    assert.ok(fpB.removed_at, 'no se limpia sin revisar la alerta');
    assert.equal(alert.status, 'handled');
    assert.equal(env.state.queue.find((e) => e.owner_id === B).last_error, 'postgrest_503');

    env.deps.repo.findRemovalAlerts = real;
    env.state.clock += 3 * 60000;
    const r2 = await Job.runFingerprintCycle(env.deps);
    await flush();
    assert.equal(r2.reopened, 1);
    assert.equal(alert.status, 'open');
    assert.equal(fpB.removed_at, null);
    assert.equal(env.state.emails.length, 1);
    assert.equal(env.state.queue.length, 0);
});
