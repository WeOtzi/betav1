const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/shared/js/studio-registration-media.js'), 'utf8');
const email = 'studio@example.test';
const studio = { id: 'studio-id', user_id: 'owner-id', photo_feed_items: [{ url: 'https://example.test/existing.jpg' }] };
const image = (name = 'photo.jpg', type = 'image/jpeg') => new File(['image fixture'], name, { type, lastModified: 123 });

// Small IndexedDB transaction adapter: persisted records survive reloading the module.
function indexedDBHarness() {
    const databases = new Map();
    return {
        open(name) {
            const request = {};
            queueMicrotask(() => {
                const fresh = !databases.has(name);
                if (fresh) databases.set(name, new Map());
                const rows = databases.get(name);
                request.result = {
                    createObjectStore() {},
                    transaction() {
                        const tx = {};
                        const action = work => {
                            const operation = {};
                            queueMicrotask(() => {
                                operation.result = work();
                                operation.onsuccess?.();
                                queueMicrotask(() => tx.oncomplete?.());
                            });
                            return operation;
                        };
                        tx.objectStore = () => ({
                            get: key => action(() => {
                                const row = rows.get(key);
                                return row && { ...row, items: row.items.map(item => ({ ...item })) };
                            }),
                            put: value => action(() => rows.set(value.email, { ...value, items: value.items.map(item => ({ ...item })) })),
                            delete: key => action(() => rows.delete(key))
                        });
                        return tx;
                    }
                };
                if (fresh) request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request;
        }
    };
}
function harness(options = {}) {
    const uploads = [];
    const patches = [];
    let failAt = options.failAt;
    const client = { auth: { getSession: async () => ({ data: { session: options.noSession ? null : {
        user: { id: 'owner-id', email: options.sessionEmail || email }
    } } }) } };
    const window = {
        location: { pathname: options.pathname || '/studio/register' },
        indexedDB: options.indexedDB || indexedDBHarness(),
        WeotziData: {
            getClient: () => client,
            Studios: { update(id, patch) {
                patches.push([id, patch]);
                return { select() { return { single: async () => options.zeroRows ? { data: null } : { data: { id } } }; } };
            } }
        },
        WeOtziUploader: { uploadFile: async args => {
            uploads.push(args);
            if (uploads.length === failAt) { failAt = null; throw new Error('Storage unavailable'); }
            return { publicUrl: 'https://example.test/' + args.file.name, path: args.pathPrefix + '/' + args.file.name };
        } }
    };
    vm.runInNewContext(source, { window, console });
    return { api: window.WeOtziStudioMedia, uploads, patches, indexedDB: window.indexedDB };
}

test('photo validation rejects unsupported types, large files and oversized gallery selections', () => {
    const h = harness();
    assert.throws(() => h.api.validate({ cover: image('bad.svg', 'image/svg+xml') }), /JPG, PNG o WebP/);
    assert.throws(() => h.api.validate({ cover: { type: 'image/png', size: 6 * 1024 * 1024 } }), /5 MB/);
    assert.throws(() => h.api.validate({ gallery: Array.from({ length: 9 }, () => image()) }), /hasta 8/);
    assert.equal(h.api.validate({ cover: image(), gallery: [image('second.webp', 'image/webp')] }), 2);
});

test('staged photos survive reload and stay separated by email and deployment path', async () => {
    const h = harness();
    await h.api.stage(email, { cover: image() });
    const reloaded = harness({ indexedDB: h.indexedDB });
    assert.equal(await reloaded.api.hasPending('STUDIO@example.test'), true);
    const restored = await reloaded.api.load(email);
    assert.equal(restored.cover.name, 'photo.jpg');
    assert.equal(restored.logo, null);
    assert.equal(restored.gallery.length, 0);
    assert.equal(await reloaded.api.hasPending('other@example.test'), false);
    const beta = harness({ indexedDB: h.indexedDB, pathname: '/beta/studio/register' });
    assert.equal(await beta.api.hasPending(email), false);
});

test('unconfirmed and different-owner sessions cannot upload staged photos', async () => {
    const h = harness({ noSession: true });
    await h.api.stage(email, { cover: image() });
    await assert.rejects(h.api.finish(studio, email), /Iniciá sesión/);
    assert.equal(h.uploads.length, 0);
    const other = harness({ indexedDB: h.indexedDB, sessionEmail: 'other@example.test' });
    await assert.rejects(other.api.finish(studio, email), /Iniciá sesión/);
    assert.equal(other.uploads.length, 0);
    const wrongOwner = harness({ indexedDB: h.indexedDB });
    await assert.rejects(wrongOwner.api.finish({ ...studio, user_id: 'another-owner' }, email), /Iniciá sesión/);
    assert.equal(wrongOwner.uploads.length, 0);
});

test('interrupted upload resumes only unfinished files after a page reload', async () => {
    const h = harness({ failAt: 2 });
    await h.api.stage(email, { cover: image('cover.jpg'), logo: image('logo.png', 'image/png'), gallery: [image('room.jpg')] });
    await assert.rejects(h.api.finish(studio, email), /Storage unavailable/);
    assert.equal(await h.api.hasPending(email), true);
    assert.equal(h.patches.length, 0);
    const retry = harness({ indexedDB: h.indexedDB });
    const result = await retry.api.finish(studio, email);
    assert.deepEqual(retry.uploads.map(item => item.file.name), ['logo.png', 'room.jpg']);
    assert.equal(retry.uploads.every(item => item.bucket === 'studio-photos' && item.pathPrefix === 'studio-id/registration'), true);
    assert.equal(result.cover_image, 'https://example.test/cover.jpg');
    assert.equal(result.logo_image, 'https://example.test/logo.png');
    assert.equal(result.photo_feed_items.length, 2);
    assert.equal(result.photo_feed_items[0].url, studio.photo_feed_items[0].url);
    assert.equal(await retry.api.hasPending(email), false);
});

test('an RLS update affecting zero rows retains staged progress for retry', async () => {
    const h = harness({ zeroRows: true });
    await h.api.stage(email, { cover: image() });
    await assert.rejects(h.api.finish(studio, email), /guardar las imágenes/);
    assert.equal(await h.api.hasPending(email), true);
    const retry = harness({ indexedDB: h.indexedDB });
    await retry.api.finish(studio, email);
    assert.equal(retry.uploads.length, 0);
    assert.equal(await retry.api.hasPending(email), false);
});

test('concurrent completion requests upload once and clearing removes only the selected email', async () => {
    const h = harness();
    await h.api.stage(email, { cover: image() });
    await h.api.stage('other@example.test', { logo: image() });
    await Promise.all([h.api.finish(studio, email), h.api.finish(studio, email)]);
    assert.equal(h.uploads.length, 1);
    assert.equal(await h.api.hasPending(email), false);
    assert.equal(await h.api.hasPending('other@example.test'), true);
    await h.api.clear('other@example.test');
    assert.equal(await h.api.hasPending('other@example.test'), false);
});
