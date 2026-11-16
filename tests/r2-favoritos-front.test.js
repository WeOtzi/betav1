// Ronda 2 · frente "favoritos" (P22) — lado navegador.
//   1. data/favorites-repo.js sobre un cliente supabase-js falso: consultas
//      con dueño explícito, RPC, mover con choque y la API anterior del
//      marketplace (con caída a client_favorites si falta la migración).
//   2. wo-favorites.js sobre un DOM mínimo: activar botones, guardar, quitar,
//      elegir lista, invitar a iniciar sesión y aplicar la intención guardada.
//   3. Contratos de las páginas y de los puntos donde se dejaron corazones
//      (marketplace, perfil del estudio, Store) y del cargador perezoso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const MODEL_JS = read('public/shared/js/wo-favorites-model.js');
const MODULE_JS = read('public/shared/js/wo-favorites.js');
const REPO_JS = read('public/shared/js/data/favorites-repo.js');
const CLIENT_JS = read('public/shared/js/data/postgrest-client.js');
const PAGE_JS = read('public/shared/js/client-favorites.js');
const PAGE_HTML = read('public/client/favorites/index.html');
const MODULE_CSS = read('public/shared/css/wo-favorites.css');
const PAGE_CSS = read('public/shared/css/client-favorites-ds.css');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ARTIST = '002c10bc-45a6-4406-bd7f-2db50a76a368';
const flush = async (times = 6) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)); };
// Los objetos que nacen dentro de vm tienen otro prototipo: se comparan por valor.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

/* ====================================================================== */
/* 1. Repositorio del navegador                                            */
/* ====================================================================== */

// Cliente supabase-js falso: registra cada consulta y responde con `respond`.
function fakeSupabase(respond) {
    const calls = [];
    function builder(table) {
        const call = { table, steps: [] };
        calls.push(call);
        const qb = {};
        for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'limit', 'maybeSingle']) {
            qb[method] = (...args) => { call.steps.push([method, ...args]); return qb; };
        }
        qb.then = (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject);
        return qb;
    }
    return {
        calls,
        from: (table) => builder(table),
        rpc: (name, args) => {
            const call = { rpc: name, args };
            calls.push(call);
            return { then: (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject) };
        }
    };
}

function loadRepo(respond) {
    const client = fakeSupabase(respond);
    const window = { console: { error() {}, warn() {} }, ConfigManager: { getSupabaseClient: () => client } };
    window.window = window;
    const context = vm.createContext(window);
    vm.runInContext(CLIENT_JS, context);
    vm.runInContext(REPO_JS, context);
    return { client, Lists: window.WeotziData.FavoriteLists, Legacy: window.WeotziData.Favorites };
}
const steps = (call) => call.steps.map((s) => s[0] + '(' + s.slice(1).map((a) => JSON.stringify(a)).join(',') + ')').join('.');

test('repo: toda lectura y escritura filtra por el dueño (soporte puede leer todo por RLS)', async () => {
    const { client, Lists } = loadRepo(() => ({ data: [], error: null }));
    await Lists.listLists(USER);
    await Lists.listItems(USER);
    await Lists.removeItem(USER, 'i1');
    await Lists.removeTarget(USER, 'design', 'p1');
    await Lists.removeTarget(USER, 'design', 'p1', 'l2');
    await Lists.renameList(USER, 'l1', 'Nuevo');
    await Lists.deleteList(USER, 'l1');
    for (const call of client.calls) {
        assert.ok(call.steps.some((s) => s[0] === 'eq' && s[1] === 'owner_user_id' && s[2] === USER), call.table + ': ' + steps(call));
    }
    assert.equal(client.calls[0].table, 'favorite_lists');
    assert.match(steps(client.calls[0]), /^select\("id, name, is_default, sort_order, created_at"\)\.eq\("owner_user_id","[^"]+"\)\.order\("is_default",\{"ascending":false\}\)/);
    assert.equal(client.calls[1].table, 'favorite_items');
    assert.match(steps(client.calls[1]), /order\("created_at",\{"ascending":false\}\)\.limit\(5000\)$/);
    assert.equal(steps(client.calls[3]), `delete().eq("owner_user_id","${USER}").eq("kind","design").eq("target_id","p1")`);
    assert.ok(steps(client.calls[4]).endsWith('.eq("list_id","l2")'));
    // La lista por defecto nunca se borra desde acá.
    assert.ok(steps(client.calls[6]).includes('.eq("is_default",false)'));
});

test('repo: guardar va por la RPC favorites_save con el snapshot', async () => {
    const row = { id: 'i9', list_id: 'l1', kind: 'design', target_id: 'p1', created_at: '2026-11-16' };
    const { client, Lists } = loadRepo((call) => ({ data: call.rpc === 'favorites_default_list_id' ? 'l1' : row, error: null }));
    const saved = await Lists.save({ kind: 'design', id: 'p1', label: 'Flor', image: 'https://cdn.test/f.webp', url: '/store/item/?id=p1', artistId: ARTIST }, 'l2');
    same(saved, row);
    same(client.calls[0], {
        rpc: 'favorites_save',
        args: { p_kind: 'design', p_target_id: 'p1', p_label: 'Flor', p_image_url: 'https://cdn.test/f.webp', p_url: '/store/item/?id=p1', p_artist_user_id: ARTIST, p_list_id: 'l2' }
    });
    await Lists.save({ kind: 'studio', id: 's1' });
    same(client.calls[1].args, { p_kind: 'studio', p_target_id: 's1', p_label: null, p_image_url: null, p_url: null, p_artist_user_id: null, p_list_id: null });
    assert.equal(await Lists.ensureDefaultList(), 'l1');
    assert.equal(client.calls[2].rpc, 'favorites_default_list_id');
});

test('repo: crear lista, mover (con choque en el destino) y contadores públicos', async () => {
    let failMove = false;
    const { client, Lists } = loadRepo((call) => {
        if (call.table === 'favorite_items' && call.steps[0][0] === 'update' && failMove) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        if (call.table === 'favorite_lists' && call.steps[0][0] === 'insert') return { data: [{ id: 'l5', name: 'Ideas', is_default: false, sort_order: 3 }], error: null };
        if (call.table === 'favorite_lists' && call.steps[0][0] === 'delete') return { data: [{ id: 'l5' }], error: null };
        if (call.rpc) return { data: [{ artist_user_id: ARTIST, saved_count: 2, items_saved_count: 1 }], error: null };
        return { data: [{ id: 'i1', list_id: 'l5' }], error: null };
    });
    const list = await Lists.createList(USER, 'Ideas', 3);
    assert.equal(list.id, 'l5');
    same(client.calls[0].steps[0], ['insert', { owner_user_id: USER, name: 'Ideas', sort_order: 3 }]);
    assert.equal(await Lists.deleteList(USER, 'l5'), true);

    const moved = await Lists.moveItem(USER, 'i1', 'l5');
    same(moved, { row: { id: 'i1', list_id: 'l5' }, merged: false });
    failMove = true;
    const merged = await Lists.moveItem(USER, 'i1', 'l5');
    same(merged, { row: null, merged: true }, 'ya estaba en el destino: queda uno solo');
    const last = client.calls[client.calls.length - 1];
    assert.equal(steps(last), `delete().eq("id","i1").eq("owner_user_id","${USER}")`);

    const counts = await Lists.artistSaveCounts([ARTIST, null]);
    same(client.calls[client.calls.length - 1], { rpc: 'favorite_artist_save_counts', args: { p_artist_user_ids: [ARTIST] } });
    assert.equal(counts[0].saved_count, 2);
    await Lists.targetSaveCounts('design', ['p1', 2]);
    same(client.calls[client.calls.length - 1], { rpc: 'favorite_target_save_counts', args: { p_kind: 'design', p_target_ids: ['p1', '2'] } });
    const before = client.calls.length;
    same(await Lists.artistSaveCounts([]), []);
    assert.equal(client.calls.length, before);
});

test('repo: los errores de la base suben como excepción con su código', async () => {
    const { Lists } = loadRepo(() => ({ data: null, error: { code: 'P0001', message: 'favorites:list_limit' } }));
    await assert.rejects(() => Lists.createList(USER, 'Otra', 9), (err) => err.code === 'P0001' && /favorites:list_limit/.test(err.message));
});

test('API anterior (marketplace): lee y escribe las listas con las mismas firmas', async () => {
    const { client, Legacy } = loadRepo((call) => {
        if (call.rpc === 'favorites_save') return { data: { id: 'i1', target_id: ARTIST, created_at: '2026-11-16' }, error: null };
        if (call.steps && call.steps[0][0] === 'select') {
            return { data: [{ target_id: ARTIST, created_at: '2026-11-16' }, { target_id: ARTIST, created_at: '2026-11-10' }, { target_id: 'b', created_at: '2026-11-01' }], error: null };
        }
        return { data: null, error: null };
    });
    const rows = await Legacy.listByClient(USER);
    same(rows, [{ artist_user_id: ARTIST, created_at: '2026-11-16' }, { artist_user_id: 'b', created_at: '2026-11-01' }], 'un artista en dos listas cuenta una vez');
    assert.equal(client.calls[0].table, 'favorite_items');
    assert.ok(steps(client.calls[0]).includes('.eq("kind","artist")'));

    same(await Legacy.add(USER, ARTIST), { artist_user_id: ARTIST, created_at: '2026-11-16' });
    assert.equal(client.calls[1].rpc, 'favorites_save');
    assert.equal(client.calls[1].args.p_kind, 'artist');
    assert.equal(client.calls[1].args.p_list_id, null, 'va a la lista por defecto');

    assert.equal(await Legacy.toggle(USER, ARTIST.toUpperCase(), true), false);
    const removal = client.calls[client.calls.length - 1];
    assert.equal(removal.table, 'favorite_items');
    assert.equal(steps(removal), `delete().eq("owner_user_id","${USER}").eq("kind","artist").eq("target_id","${ARTIST}")`);
    assert.equal(await Legacy.toggle(USER, ARTIST, false), true);
});

test('API anterior: sin la migración aplicada cae a client_favorites', async () => {
    const { client, Legacy } = loadRepo((call) => {
        if (call.rpc || call.table === 'favorite_items') {
            return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.favorite_items' in the schema cache" } };
        }
        if (call.steps[0][0] === 'select') return { data: [{ artist_user_id: ARTIST, created_at: 'x' }], error: null };
        return { data: [{ artist_user_id: ARTIST, created_at: 'x' }], error: null };
    });
    same(await Legacy.listByClient(USER), [{ artist_user_id: ARTIST, created_at: 'x' }]);
    await Legacy.add(USER, ARTIST);
    await Legacy.remove(USER, ARTIST);
    const legacyCalls = client.calls.filter((c) => c.table === 'client_favorites');
    assert.equal(legacyCalls.length, 3);
    same(legacyCalls[1].steps[0], ['upsert', { client_user_id: USER, artist_user_id: ARTIST }, { onConflict: 'client_user_id,artist_user_id' }]);
    // Un error que no es "falta la tabla" no se traga.
    const other = loadRepo(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await assert.rejects(() => other.Legacy.listByClient(USER), /permission denied/);
});

/* ====================================================================== */
/* 2. wo-favorites.js sobre un DOM mínimo                                  */
/* ====================================================================== */

function makeDom() {
    const dom = {};

    function matchCompound(node, selector) {
        let rest = selector.trim();
        const tag = /^[a-zA-Z][\w-]*/.exec(rest);
        if (tag) {
            if (node.tagName !== tag[0].toUpperCase()) return false;
            rest = rest.slice(tag[0].length);
        }
        while (rest) {
            let m;
            if ((m = /^\.([\w-]+)/.exec(rest))) {
                if (!node.classList.contains(m[1])) return false;
            } else if ((m = /^#([\w-]+)/.exec(rest))) {
                if (node.getAttribute('id') !== m[1]) return false;
            } else if ((m = /^\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/.exec(rest))) {
                const value = node.getAttribute(m[1]);
                if (value === null) return false;
                if (m[2] === '=' && value !== m[3]) return false;
                if (m[2] === '*=' && !value.includes(m[3])) return false;
            } else if ((m = /^:not\(([^()]*)\)/.exec(rest))) {
                if (matchCompound(node, m[1])) return false;
            } else {
                throw new Error('selector no soportado por el DOM de prueba: ' + selector);
            }
            rest = rest.slice(m[0].length);
        }
        return true;
    }
    const matches = (node, selector) => selector.split(',').some((part) => matchCompound(node, part));

    class El {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.nodeType = 1;
            this.children = [];
            this.parentNode = null;
            this.attrs = new Map();
            this.listeners = [];
            this.style = {};
            this._text = '';
            this._html = '';
            this.value = '';
            this.checked = false;
        }
        getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
        setAttribute(name, value) { this.attrs.set(name, String(value)); }
        hasAttribute(name) { return this.attrs.has(name); }
        removeAttribute(name) { this.attrs.delete(name); }
        get id() { return this.getAttribute('id') || ''; }
        set id(v) { this.setAttribute('id', v); }
        get type() { return this.getAttribute('type') || ''; }
        set type(v) { this.setAttribute('type', v); }
        get className() { return this.getAttribute('class') || ''; }
        set className(v) { this.setAttribute('class', v); }
        get hidden() { return this.hasAttribute('hidden'); }
        set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
        get disabled() { return this.hasAttribute('disabled'); }
        set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
        get classList() {
            const el = this;
            const list = () => el.className.split(/\s+/).filter(Boolean);
            return {
                contains: (name) => list().includes(name),
                add: (name) => { if (!list().includes(name)) el.className = list().concat([name]).join(' '); },
                remove: (name) => { el.className = list().filter((c) => c !== name).join(' '); },
                toggle: (name, force) => {
                    const want = force === undefined ? !list().includes(name) : !!force;
                    if (want) this.classList.add(name); else this.classList.remove(name);
                    return want;
                }
            };
        }
        get firstElementChild() { return this.children[0] || null; }
        get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
        set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); this._html = ''; }
        get innerHTML() { return this._html; }
        set innerHTML(v) { this.textContent = ''; this._html = String(v); }
        appendChild(child) {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = this;
            this.children.push(child);
            if (child.tagName === 'LINK' || child.tagName === 'SCRIPT') {
                Promise.resolve().then(() => child.listeners.filter((l) => l.type === 'load').forEach((l) => l.fn({})));
                if (child.onload) Promise.resolve().then(() => child.onload());
            }
            return child;
        }
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            child.parentNode = null;
            return child;
        }
        contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
        matches(selector) { return matches(this, selector); }
        closest(selector) { for (let n = this; n; n = n.parentNode) if (n.nodeType === 1 && n.matches(selector)) return n; return null; }
        querySelectorAll(selector) {
            const out = [];
            const walk = (node) => node.children.forEach((c) => { if (c.matches(selector)) out.push(c); walk(c); });
            walk(this);
            return out;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: !!capture }); }
        focus() { dom.document.activeElement = this; }
        getBoundingClientRect() { return { left: 200, right: 244, top: 100, bottom: 144, width: 44, height: 44 }; }
        get offsetWidth() { return 300; }
        get offsetHeight() { return 140; }
        get offsetParent() { return this.parentNode; }
    }

    const html = new El('html');
    html.clientWidth = 1280;
    const head = new El('head');
    const body = new El('body');
    html.appendChild(head);
    html.appendChild(body);

    dom.document = {
        nodeType: 9,
        readyState: 'complete',
        documentElement: html,
        head,
        body,
        activeElement: null,
        listeners: [],
        currentScript: { src: 'https://beta.weotzi.com/shared/js/wo-favorites.js' },
        createElement: (tag) => new El(tag),
        querySelectorAll: (selector) => (html.matches(selector) ? [html] : []).concat(html.querySelectorAll(selector)),
        querySelector: (selector) => dom.document.querySelectorAll(selector)[0] || null,
        contains: (node) => html.contains(node),
        addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: !!capture }); },
        dispatchEvent(event) { this.listeners.filter((l) => l.type === event.type).forEach((l) => l.fn(event)); return true; }
    };

    // Captura en document → destino y ancestros → burbuja en document.
    dom.fire = (type, target, init) => {
        const event = Object.assign({
            type, target, key: undefined, shiftKey: false, relatedTarget: null, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; }
        }, init || {});
        for (const l of dom.document.listeners.filter((x) => x.type === type && x.capture)) l.fn(event);
        if (event.stopped) return event;
        for (let node = target; node && !event.stopped; node = node.parentNode) {
            event.currentTarget = node;
            for (const l of node.listeners.filter((x) => x.type === type)) l.fn(event);
        }
        if (!event.stopped) for (const l of dom.document.listeners.filter((x) => x.type === type && !x.capture)) l.fn(event);
        return event;
    };

    dom.button = (attrs, content) => {
        const btn = new El('button');
        btn.setAttribute('data-wo-favorite', '');
        Object.entries(attrs || {}).forEach(([k, v]) => btn.setAttribute(k, v));
        if (content) btn.appendChild(content);
        body.appendChild(btn);
        return btn;
    };
    dom.El = El;
    return dom;
}

// Repositorio falso con el mismo contrato que WeotziData.FavoriteLists.
function fakeRepo(seed) {
    const data = {
        lists: (seed && seed.lists) || [{ id: 'l-def', name: 'Favoritos', is_default: true, sort_order: 0, created_at: '2026-11-01' }],
        items: (seed && seed.items) || []
    };
    let next = 1;
    const calls = [];
    const repo = {
        calls,
        data,
        fail: null,   // { method, error } → la próxima llamada a ese método falla
        guard(method) {
            if (repo.fail && repo.fail.method === method) {
                const error = repo.fail.error;
                repo.fail = null;
                throw error;
            }
        },
        async listLists(userId) { calls.push(['listLists', userId]); repo.guard('listLists'); return data.lists.map((l) => ({ ...l })); },
        async listItems(userId) { calls.push(['listItems', userId]); repo.guard('listItems'); return data.items.map((i) => ({ ...i })); },
        async ensureDefaultList() {
            calls.push(['ensureDefaultList']);
            if (!data.lists.some((l) => l.is_default)) data.lists.unshift({ id: 'l-def', name: 'Favoritos', is_default: true, sort_order: 0, created_at: '2026-11-01' });
            return 'l-def';
        },
        async save(item, listId) {
            calls.push(['save', { ...item }, listId]);
            repo.guard('save');
            if (!listId) await repo.ensureDefaultList();
            const list = listId || 'l-def';
            let row = data.items.find((i) => i.list_id === list && i.kind === item.kind && i.target_id === item.id);
            if (!row) {
                row = { id: 'i' + (next++), list_id: list, kind: item.kind, target_id: item.id, created_at: '2026-11-16T10:0' + next + ':00Z' };
                data.items.push(row);
            }
            Object.assign(row, { label: item.label || row.label || null, image_url: item.image || row.image_url || null, url: item.url || row.url || null, artist_user_id: item.artistId || null });
            return { ...row };
        },
        async removeTarget(userId, kind, targetId, listId) {
            calls.push(['removeTarget', userId, kind, targetId, listId]);
            repo.guard('removeTarget');
            data.items = data.items.filter((i) => !(i.kind === kind && i.target_id === targetId && (!listId || i.list_id === listId)));
            return true;
        },
        async removeItem(userId, itemId) { calls.push(['removeItem', userId, itemId]); data.items = data.items.filter((i) => i.id !== itemId); return true; },
        async moveItem(userId, itemId, listId) {
            calls.push(['moveItem', userId, itemId, listId]);
            const row = data.items.find((i) => i.id === itemId);
            const clash = data.items.find((i) => i.id !== itemId && i.list_id === listId && i.kind === row.kind && i.target_id === row.target_id);
            if (clash) { data.items = data.items.filter((i) => i.id !== itemId); return { row: null, merged: true }; }
            row.list_id = listId;
            return { row: { ...row }, merged: false };
        },
        async createList(userId, name, sortOrder) {
            calls.push(['createList', userId, name, sortOrder]);
            repo.guard('createList');
            const row = { id: 'l' + (next++), name, is_default: false, sort_order: sortOrder, created_at: '2026-11-16' };
            data.lists.push(row);
            return { ...row };
        },
        async renameList(userId, listId, name) {
            calls.push(['renameList', userId, listId, name]);
            const row = data.lists.find((l) => l.id === listId);
            if (!row) return null;
            row.name = name;
            return { ...row };
        },
        async deleteList(userId, listId) {
            calls.push(['deleteList', userId, listId]);
            const before = data.lists.length;
            data.lists = data.lists.filter((l) => l.id !== listId || l.is_default);
            data.items = data.items.filter((i) => i.list_id !== listId);
            return data.lists.length < before;
        }
    };
    return repo;
}

// Carga el modelo y el módulo en una ventana de prueba.
function loadModule(options) {
    const o = options || {};
    const dom = makeDom();
    const storage = new Map(Object.entries(o.storage || {}));
    const events = [];
    const repo = o.repo || fakeRepo(o.seed);
    const session = o.session === undefined ? { user: { id: USER } } : o.session;
    const window = {
        document: dom.document,
        console: { error() {}, warn() {}, log() {} },
        location: Object.assign({ origin: 'https://beta.weotzi.com', pathname: '/marketplace', search: '', hash: '' }, o.location || {}),
        localStorage: {
            getItem: (k) => (storage.has(k) ? storage.get(k) : null),
            setItem: (k, v) => { storage.set(k, String(v)); },
            removeItem: (k) => { storage.delete(k); }
        },
        setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
        clearTimeout,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        addEventListener() {},
        innerHeight: 720,
        innerWidth: 1280,
        matchMedia: () => ({ matches: !!o.narrow }),
        supabase: {},
        ConfigManager: {
            ready: async () => {},
            isDemoMode: () => !!o.demo,
            isSupabaseConfigured: () => true,
            getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } })
        },
        WeotziData: { run() {}, FavoriteLists: repo }
    };
    window.window = window;
    dom.document.addEventListener('wo:favorites-change', (e) => events.push(e.detail));
    if (o.before) o.before(dom, window);
    const context = vm.createContext(window);
    vm.runInContext(MODEL_JS, context);
    vm.runInContext(MODULE_JS, context);
    return { dom, window, repo, storage, events, Fav: window.WoFavorites, Model: window.WoFavoritesModel };
}
const popover = (dom) => dom.document.body.children.filter((c) => c.classList.contains('wo-fav-pop'))[0] || null;
const toast = (dom) => dom.document.body.children.filter((c) => c.classList.contains('wo-fav-toast'))[0] || null;

test('módulo: activa botones vacíos (pinta el corazón) y respeta los que ya traen contenido', async () => {
    let empty; let own; let invalid; let labeled;
    const ctx = loadModule({
        seed: { items: [{ id: 'i1', list_id: 'l-def', kind: 'studio', target_id: 's1', label: 'Casa Koi', created_at: '2026-11-10' }] },
        before: (dom) => {
            empty = dom.button({ 'data-kind': 'artist', 'data-id': ARTIST, 'data-label': 'Mara Ink', hidden: '' });
            const icon = new dom.El('i');
            own = dom.button({ 'data-kind': 'studio', 'data-id': 's1', 'data-label': 'Casa Koi', class: 'mk-card-fav', 'aria-label': 'Guardar el estudio Casa Koi en favoritos' }, icon);
            invalid = dom.button({ 'data-kind': 'planeta', 'data-id': 'x', hidden: '' });
            labeled = dom.button({ 'data-kind': 'merch', 'data-id': 'm1', 'data-label': 'Remera', 'data-fav-variant': 'label', hidden: '' });
        }
    });
    await flush();
    await ctx.Fav.ready();

    // Vacío: corazón, estilo, nombre accesible y visible recién al activarse.
    assert.equal(empty.getAttribute('data-wo-fav-on'), '1');
    assert.ok(empty.classList.contains('wo-fav-btn'));
    assert.match(empty.innerHTML, /^<svg /);
    assert.equal(empty.hidden, false);
    assert.equal(empty.getAttribute('type'), 'button');
    assert.equal(empty.getAttribute('aria-pressed'), 'false');
    assert.equal(empty.getAttribute('aria-label'), 'Guardar a Mara Ink en favoritos');

    // Con contenido propio: conserva aspecto y etiqueta; solo recibe el estado.
    assert.equal(own.classList.contains('wo-fav-btn'), false);
    assert.equal(own.children.length, 1);
    assert.equal(own.getAttribute('aria-label'), 'Guardar el estudio Casa Koi en favoritos');
    assert.equal(own.getAttribute('aria-pressed'), 'true', 'ya estaba guardado');
    assert.ok(own.classList.contains('is-fav'));

    // Sin tipo válido no se activa ni aparece.
    assert.equal(invalid.hasAttribute('data-wo-fav-on'), false);
    assert.equal(invalid.hidden, true);

    // Variante con texto.
    assert.ok(labeled.classList.contains('wo-fav-btn--label'));
    assert.equal(labeled.querySelector('.wo-fav-btn-text').textContent, 'Guardar');

    // Estado público.
    assert.equal(ctx.Fav.loaded, true);
    assert.equal(ctx.Fav.available, true);
    assert.equal(ctx.Fav.userId, USER);
    assert.equal(ctx.Fav.isSaved('studio', 's1'), true);
    assert.equal(ctx.Fav.isSaved('artist', ARTIST), false);
    assert.equal(JSON.stringify(ctx.Fav.lists()), JSON.stringify([{ id: 'l-def', name: 'Favoritos', isDefault: true, sortOrder: 0, count: 1 }]));
    same(ctx.repo.calls.slice(0, 2), [['listLists', USER], ['listItems', USER]]);
    assert.ok(ctx.events.some((e) => e.reason === 'ready'));
});

test('módulo: tocar el corazón guarda en la lista por defecto y ofrece otra lista', async () => {
    let btn;
    const ctx = loadModule({
        seed: { lists: [] },   // todavía no tiene ni la lista por defecto
        before: (dom) => { btn = dom.button({ 'data-kind': 'artist', 'data-id': ARTIST.toUpperCase(), 'data-label': 'Mara Ink', 'data-image': 'https://cdn.test/m.jpg', 'data-url': '/artist/profile?artist=mara' }); }
    });
    await flush();
    await ctx.Fav.ready();

    const click = ctx.dom.fire('click', btn);
    assert.equal(click.defaultPrevented, true);
    assert.equal(click.stopped, true, 'la página no recibe el clic (lo maneja el módulo)');
    await flush();

    const saveCall = ctx.repo.calls.find((c) => c[0] === 'save');
    assert.equal(JSON.stringify(saveCall), JSON.stringify(['save', {
        kind: 'artist', id: ARTIST, label: 'Mara Ink', image: 'https://cdn.test/m.jpg', url: '/artist/profile?artist=mara', artistId: ARTIST
    }, null]));
    assert.equal(ctx.Fav.isSaved('artist', ARTIST), true);
    assert.ok(btn.classList.contains('is-fav'));
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(btn.getAttribute('aria-label'), 'Quitar a Mara Ink de favoritos');
    assert.equal(ctx.Fav.lists()[0].name, 'Favoritos', 'la lista por defecto se creó al guardar');
    assert.equal(JSON.stringify(ctx.Fav.ids('artist')), JSON.stringify([ARTIST]));
    assert.ok(ctx.events.some((e) => e.reason === 'saved' && e.kind === 'artist' && e.id === ARTIST));

    // Panel "Guardado en «Favoritos»" con la opción de otra lista.
    const pop = popover(ctx.dom);
    assert.ok(pop, 'aparece el panel');
    assert.equal(pop.getAttribute('role'), 'dialog');
    assert.equal(pop.getAttribute('aria-label'), 'Guardado en «Favoritos»');
    assert.match(pop.textContent, /Guardar en otra lista…/);
    assert.match(pop.textContent, /Ver mis favoritos/);
    const link = pop.querySelectorAll('a')[0];
    assert.equal(link.getAttribute('href'), '/client/favorites/');

    // Escape lo cierra y devuelve el foco al corazón.
    ctx.dom.fire('keydown', btn, { key: 'Escape' });
    assert.equal(popover(ctx.dom), null);
    assert.equal(ctx.dom.document.activeElement, btn);
});

test('módulo: tocar de nuevo quita (con Deshacer); en varias listas abre el selector', async () => {
    let btn;
    const ctx = loadModule({
        seed: {
            lists: [
                { id: 'l-def', name: 'Favoritos', is_default: true, sort_order: 0, created_at: '2026-11-01' },
                { id: 'l-2', name: 'Ideas', is_default: false, sort_order: 1, created_at: '2026-11-02' }
            ],
            items: [{ id: 'i1', list_id: 'l-2', kind: 'design', target_id: 'p1', label: 'Flor', url: '/store/item/?id=p1', created_at: '2026-11-10' }]
        },
        before: (dom) => { btn = dom.button({ 'data-kind': 'design', 'data-id': 'p1', 'data-label': 'Flor' }); }
    });
    await flush();
    await ctx.Fav.ready();
    assert.equal(btn.getAttribute('aria-pressed'), 'true');

    // En una sola lista: se quita de inmediato.
    ctx.dom.fire('click', btn);
    await flush();
    assert.equal(JSON.stringify(ctx.repo.calls.find((c) => c[0] === 'removeTarget')), JSON.stringify(['removeTarget', USER, 'design', 'p1', null]));
    assert.equal(ctx.Fav.isSaved('design', 'p1'), false);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    const bar = toast(ctx.dom);
    assert.match(bar.textContent, /Quitado de favoritos/);
    const undo = bar.querySelectorAll('button').find((b) => b.textContent === 'Deshacer');
    assert.ok(undo);

    // Deshacer lo devuelve a la MISMA lista, con su snapshot.
    ctx.dom.fire('click', undo);
    await flush();
    const resave = ctx.repo.calls.filter((c) => c[0] === 'save').pop();
    assert.equal(resave[2], 'l-2');
    assert.equal(resave[1].label, 'Flor');
    assert.equal(JSON.stringify(ctx.Fav.listIdsFor('design', 'p1')), JSON.stringify(['l-2']));

    // Ahora en dos listas: el corazón abre el selector en vez de borrar.
    await ctx.Fav.save({ kind: 'design', id: 'p1', label: 'Flor' }, 'l-def');
    const removalsBefore = ctx.repo.calls.filter((c) => c[0] === 'removeTarget').length;
    ctx.dom.fire('click', btn);
    await flush();
    assert.equal(ctx.repo.calls.filter((c) => c[0] === 'removeTarget').length, removalsBefore);
    const pop = popover(ctx.dom);
    assert.ok(pop.classList.contains('wo-fav-pop--picker'));
    const boxes = pop.querySelectorAll('input[data-list-id]');
    assert.equal(JSON.stringify(boxes.map((b) => [b.getAttribute('data-list-id'), b.checked])), JSON.stringify([['l-def', true], ['l-2', true]]));

    // Desmarcar una lista quita solo de esa.
    boxes[1].checked = false;
    ctx.dom.fire('change', boxes[1]);
    await flush();
    assert.equal(JSON.stringify(ctx.repo.calls.filter((c) => c[0] === 'removeTarget').pop()), JSON.stringify(['removeTarget', USER, 'design', 'p1', 'l-2']));
    assert.equal(JSON.stringify(ctx.Fav.listIdsFor('design', 'p1')), JSON.stringify(['l-def']));
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'sigue guardado en la otra');
});

test('módulo: el selector crea una lista y guarda ahí; nombres repetidos se rechazan sin llamar a la base', async () => {
    let btn;
    const ctx = loadModule({ before: (dom) => { btn = dom.button({ 'data-kind': 'studio', 'data-id': 's1', 'data-label': 'Casa Koi' }); } });
    await flush();
    await ctx.Fav.ready();
    ctx.Fav.openPicker(btn, { kind: 'studio', id: 's1', label: 'Casa Koi' });
    await flush();
    const pop = popover(ctx.dom);
    const form = pop.querySelectorAll('form')[0];
    const input = form.querySelectorAll('input')[0];
    const error = pop.querySelectorAll('.wo-fav-pop-error')[0];
    assert.equal(input.maxLength, 60);

    input.value = '  favoritos ';
    ctx.dom.fire('submit', form);
    await flush();
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, 'Ya tienes una lista con ese nombre.');
    assert.equal(ctx.repo.calls.some((c) => c[0] === 'createList'), false);

    input.value = ' Para   la espalda ';
    ctx.dom.fire('submit', form);
    await flush();
    assert.equal(JSON.stringify(ctx.repo.calls.find((c) => c[0] === 'createList')), JSON.stringify(['createList', USER, 'Para la espalda', 1]));
    const created = ctx.Fav.lists().find((l) => l.name === 'Para la espalda');
    assert.ok(created);
    assert.equal(JSON.stringify(ctx.Fav.listIdsFor('studio', 's1')), JSON.stringify([created.id]));
    assert.equal(error.hidden, true);
    assert.equal(input.value, '');
    assert.equal(pop.querySelectorAll('input[data-list-id]').length, 2, 'la lista nueva aparece en el selector');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
});

test('módulo: sin sesión invita a entrar y recuerda la intención solo si la persona sigue', async () => {
    let btn;
    const ctx = loadModule({
        session: null,
        location: { pathname: '/store/item/', search: '?id=p1' },
        before: (dom) => { btn = dom.button({ 'data-kind': 'merch', 'data-id': 'p1', 'data-label': 'Remera <b>negra</b>', 'data-url': '/store/item/?id=p1' }); }
    });
    await flush();
    await ctx.Fav.ready();
    assert.equal(ctx.Fav.userId, null);
    assert.equal(ctx.repo.calls.length, 0, 'sin sesión no se consulta nada');

    ctx.dom.fire('click', btn);
    await flush();
    assert.equal(ctx.repo.calls.length, 0);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    const pop = popover(ctx.dom);
    assert.ok(pop.classList.contains('wo-fav-pop--login'));
    // El nombre guardado va como texto, nunca como HTML.
    assert.match(pop.textContent, /Inicia sesión o crea tu cuenta para guardar «Remera <b>negra<\/b>»/);
    assert.equal(pop.querySelectorAll('b').length, 0);
    const links = pop.querySelectorAll('a');
    assert.equal(JSON.stringify(links.map((a) => a.getAttribute('href'))), JSON.stringify([
        '/client/login?returnTo=%2Fstore%2Fitem%2F%3Fid%3Dp1',
        '/client/register?returnTo=%2Fstore%2Fitem%2F%3Fid%3Dp1'
    ]));
    assert.equal(ctx.dom.document.activeElement, links[0], 'el foco entra al panel');
    assert.equal(ctx.storage.has('wo_fav_intent'), false, 'ver el aviso no guarda nada');

    ctx.dom.fire('click', links[0]);
    const intent = ctx.Model.parseIntent(ctx.storage.get('wo_fav_intent'), Date.now());
    assert.equal(intent.item.kind, 'merch');
    assert.equal(intent.item.id, 'p1');
    assert.equal(intent.returnTo, '/store/item/?id=p1');
});

test('módulo: al volver con sesión, la intención guardada se aplica sola (aunque la página no tenga corazones)', async () => {
    const Model = require('../public/shared/js/wo-favorites-model.js');
    const intent = Model.buildIntent({ kind: 'studio', id: 's9', label: 'Casa Koi' }, { returnTo: '/studio/profile?studio=casa-koi', now: Date.now() });
    const ctx = loadModule({ storage: { wo_fav_intent: JSON.stringify(intent) }, location: { pathname: '/client/dashboard' } });
    await flush();
    await ctx.Fav.ready();
    await flush();
    const save = ctx.repo.calls.find((c) => c[0] === 'save');
    assert.equal(save[1].kind, 'studio');
    assert.equal(save[1].id, 's9');
    assert.equal(save[2], null, 'a la lista por defecto');
    assert.equal(ctx.storage.has('wo_fav_intent'), false, 'se consume al guardar');
    const bar = toast(ctx.dom);
    assert.match(bar.textContent, /Guardamos «Casa Koi» en «Favoritos»/);
    assert.equal(JSON.stringify(bar.querySelectorAll('a').map((a) => a.getAttribute('href'))), JSON.stringify(['/client/favorites/', '/studio/profile?studio=casa-koi']));
});

test('módulo: la intención se conserva mientras no haya sesión y se descarta si venció', async () => {
    const Model = require('../public/shared/js/wo-favorites-model.js');
    const fresh = JSON.stringify(Model.buildIntent({ kind: 'studio', id: 's9' }, { now: Date.now() }));
    const anon = loadModule({ session: null, storage: { wo_fav_intent: fresh }, location: { pathname: '/client/login' } });
    await flush();
    await anon.Fav.ready();
    assert.equal(anon.storage.get('wo_fav_intent'), fresh, 'en la página de ingreso todavía no hay sesión');
    assert.equal(anon.repo.calls.length, 0);

    const old = JSON.stringify(Model.buildIntent({ kind: 'studio', id: 's9' }, { now: Date.now() - Model.INTENT_TTL_MS - 5000 }));
    const expired = loadModule({ storage: { wo_fav_intent: old } });
    await flush();
    await expired.Fav.ready();
    assert.equal(expired.storage.has('wo_fav_intent'), false);
    assert.equal(expired.repo.calls.some((c) => c[0] === 'save'), false);
});

test('módulo: si guardar falla, el corazón vuelve atrás y se avisa', async () => {
    let btn;
    const ctx = loadModule({ before: (dom) => { btn = dom.button({ 'data-kind': 'design', 'data-id': 'p7', 'data-label': 'Flor' }); } });
    await flush();
    await ctx.Fav.ready();
    ctx.repo.fail = { method: 'save', error: Object.assign(new Error('[favoriteLists.save] favorites:item_limit'), { code: 'P0001' }) };
    ctx.dom.fire('click', btn);
    await flush();
    assert.equal(ctx.Fav.isSaved('design', 'p7'), false);
    assert.equal(btn.classList.contains('is-fav'), false);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.equal(btn.hasAttribute('aria-busy'), false);
    const bar = toast(ctx.dom);
    assert.ok(bar.classList.contains('wo-fav-toast--error'));
    assert.match(bar.textContent, /Esta lista está llena \(500 guardados\)/);
    assert.equal(popover(ctx.dom), null);
});

test('módulo: sin las tablas (migración pendiente) se apaga y deja el clic a la página', async () => {
    let btn; let studio;
    const repo = fakeRepo();
    repo.fail = { method: 'listLists', error: Object.assign(new Error("Could not find the table 'public.favorite_lists' in the schema cache"), { code: 'PGRST205' }) };
    const ctx = loadModule({
        repo,
        before: (dom) => {
            btn = dom.button({ 'data-kind': 'artist', 'data-id': ARTIST, class: 'mk-card-fav' }, new dom.El('i'));
            studio = dom.button({ 'data-kind': 'studio', 'data-id': 's1', hidden: '' });
        }
    });
    await flush();
    await ctx.Fav.ready();
    assert.equal(ctx.Fav.available, false);
    assert.equal(studio.hidden, true, 'los corazones que dependen del módulo vuelven a ocultarse');
    assert.equal(btn.hidden, false, 'el del marketplace sigue visible: tiene su camino anterior');
    const click = ctx.dom.fire('click', btn);
    assert.equal(click.stopped, false, 'el marketplace sigue con su camino anterior');
    assert.equal(click.defaultPrevented, false);
    await assert.rejects(() => ctx.Fav.save({ kind: 'artist', id: ARTIST }), (err) => /todavía no están disponibles/.test(err.userMessage));
});

test('módulo: en el modo demo no se guarda nada', async () => {
    let btn;
    const ctx = loadModule({ demo: true, before: (dom) => { btn = dom.button({ 'data-kind': 'studio', 'data-id': 's1' }); } });
    await flush();
    await ctx.Fav.ready();
    ctx.dom.fire('click', btn);
    await flush();
    assert.equal(ctx.repo.calls.length, 0);
    assert.match(toast(ctx.dom).textContent, /En el modo demo no se guardan favoritos/);
});

test('módulo: API de listas (crear, renombrar, mover, quitar, borrar) con sus validaciones', async () => {
    const ctx = loadModule({
        seed: { items: [{ id: 'i1', list_id: 'l-def', kind: 'artist', target_id: ARTIST, label: 'Mara', created_at: '2026-11-10' }] }
    });
    await ctx.Fav.ready();
    const Fav = ctx.Fav;

    const ideas = await Fav.createList('  Ideas ');
    assert.equal(ideas.name, 'Ideas');
    await assert.rejects(() => Fav.createList('IDEAS'), (err) => err.userMessage === 'Ya tienes una lista con ese nombre.');
    await assert.rejects(() => Fav.createList('   '), (err) => err.userMessage === 'Escribe un nombre para la lista.');

    const renamed = await Fav.renameList(ideas.id, 'Brazo');
    assert.equal(renamed.name, 'Brazo');
    assert.equal(JSON.stringify(Fav.lists().map((l) => l.name)), JSON.stringify(['Favoritos', 'Brazo']));

    // Mover: cambia de lista; si en el destino ya estaba, queda uno solo.
    assert.equal((await Fav.moveItem('i1', ideas.id)).merged, false);
    assert.equal(JSON.stringify(Fav.listIdsFor('artist', ARTIST)), JSON.stringify([ideas.id]));
    const again = await Fav.save({ kind: 'artist', id: ARTIST, label: 'Mara' }, 'l-def');
    assert.equal((await Fav.moveItem(again.itemId, ideas.id)).merged, true);
    assert.equal(Fav.items({ kind: 'artist' }).length, 1);
    await assert.rejects(() => Fav.moveItem('i1', 'no-existe'), (err) => err.userMessage === 'Esa lista ya no existe.');

    // Borrar: la principal no; la otra se va con sus guardados.
    await assert.rejects(() => Fav.deleteList('l-def'), (err) => err.userMessage === 'La lista principal no se puede borrar.');
    assert.equal(await Fav.deleteList(ideas.id), true);
    assert.equal(Fav.lists().length, 1);
    assert.equal(Fav.isSaved('artist', ARTIST), false);
    assert.equal(JSON.stringify(ctx.events.map((e) => e.reason).filter((r) => r.indexOf('list-') === 0)), JSON.stringify(['list-created', 'list-renamed', 'list-deleted']));

    const kept = await Fav.save({ kind: 'merch', id: 'm1', label: 'Remera' });
    await Fav.removeItem(kept.itemId);
    assert.equal(Fav.items().length, 0);
});

test('módulo: tope de listas y items() entrega copias filtradas', async () => {
    const lists = [{ id: 'l-def', name: 'Favoritos', is_default: true, sort_order: 0, created_at: '2026-11-01' }];
    for (let i = 1; i < 50; i++) lists.push({ id: 'l' + i, name: 'Lista ' + i, is_default: false, sort_order: i, created_at: '2026-11-02' });
    const ctx = loadModule({
        seed: {
            lists,
            items: [
                { id: 'a', list_id: 'l-def', kind: 'artist', target_id: ARTIST, created_at: '2026-11-10' },
                { id: 'b', list_id: 'l1', kind: 'design', target_id: 'p1', created_at: '2026-11-12' }
            ]
        }
    });
    await ctx.Fav.ready();
    await assert.rejects(() => ctx.Fav.createList('Una más'), (err) => /máximo de 50 listas/.test(err.userMessage));
    assert.equal(ctx.repo.calls.some((c) => c[0] === 'createList'), false);
    const items = ctx.Fav.items({ listId: 'l1' });
    assert.equal(items.length, 1);
    items[0].listId = 'otro';
    assert.equal(ctx.Fav.items({ listId: 'l1' }).length, 1, 'no se puede alterar el estado desde afuera');
});

/* ====================================================================== */
/* 3. Contratos de páginas, corazones colocados y cargador                 */
/* ====================================================================== */

test('contrato del módulo: selector, evento, intención y acceso a datos solo por el repo', () => {
    assert.ok(MODULE_JS.includes("var SEL = '[data-wo-favorite]';"));
    assert.ok(MODULE_JS.includes("'wo:favorites-change'"));
    assert.ok(MODULE_JS.includes('Model.INTENT_KEY'));
    assert.ok(MODULE_JS.includes("doc.addEventListener('click', onClick, true)"), 'captura: funciona en cualquier página');
    assert.ok(MODULE_JS.includes('new root.MutationObserver('), 'activa los botones agregados después');
    assert.ok(MODULE_JS.includes('root.WeotziData.FavoriteLists'));
    for (const source of [MODULE_JS, PAGE_JS]) {
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(code, /\.from\(\s*['"]/, 'sin CRUD ad-hoc');
        assert.doesNotMatch(code, /\/rest\/v1\//);
        assert.doesNotMatch(code, /\.rpc\(/, 'las RPC viven en el repo');
        assert.doesNotMatch(code, /createClient\(/);
    }
    // El repo usa la capa unificada.
    assert.ok(REPO_JS.includes('const run = D.run;'));
    assert.doesNotMatch(REPO_JS, /fetch\(/);
});

test('cargador de config-manager.js: perezoso y con la misma clave de intención', () => {
    const cm = read('public/shared/js/config-manager.js');
    const start = cm.indexOf('// Favoritos (ronda 2 · P22): carga perezosa de wo-favorites.js');
    assert.ok(start > -1);
    const block = cm.slice(start, cm.indexOf('// Auto-initialize when script loads', start));
    assert.ok(block.includes("var SELECTOR = '[data-wo-favorite]';"));
    assert.ok(block.includes("window.localStorage.getItem('wo_fav_intent')"));
    assert.ok(block.includes("['js/wo-favorites-model.js', 'js/wo-favorites.js']"), 'el modelo se carga antes que el módulo');
    assert.ok(block.includes('s.async = false;'), 'en orden');
    assert.ok(block.includes("css.href = base + 'css/wo-favorites.css';"));
    assert.ok(block.includes('new MutationObserver('), 'también para corazones que llegan después');
    assert.ok(block.includes('try {') && block.includes('} catch (err) {'), 'nunca bloquea la página');
    // No toca el cargador de controles del DS.
    assert.ok(cm.includes("['js/wo-controls.js', 'js/wo-richtext.js'].forEach("));

    // Sin corazones ni intención no agrega nada; con un corazón, sí.
    const run = (withButton, intent) => {
        const added = [];
        const doc = {
            currentScript: { src: 'https://beta.weotzi.com/shared/js/config-manager.js' },
            readyState: 'complete',
            head: { appendChild: (node) => added.push(node) },
            documentElement: {},
            createElement: (tag) => ({ tag, setAttribute() {} }),
            querySelector: (sel) => (sel === '[data-wo-favorite]' && withButton ? {} : null),
            addEventListener() {}
        };
        const win = { localStorage: { getItem: () => (intent ? '{}' : null) } };
        const observers = [];
        class MO { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} }
        new Function('window', 'document', 'MutationObserver', block)(win, doc, MO);
        return { added, win, observers, doc };
    };
    const idle = run(false, false);
    assert.equal(idle.added.length, 0);
    assert.equal(idle.observers.length, 1, 'queda mirando por si aparece un corazón');
    // Llega un corazón más tarde.
    idle.observers[0].cb([{ addedNodes: [{ nodeType: 1, matches: () => false, querySelector: () => ({}) }] }]);
    assert.equal(JSON.stringify(idle.added.map((n) => n.href || n.src)), JSON.stringify([
        'https://beta.weotzi.com/shared/css/wo-favorites.css',
        'https://beta.weotzi.com/shared/js/wo-favorites-model.js',
        'https://beta.weotzi.com/shared/js/wo-favorites.js'
    ]));
    assert.equal(run(true, false).added.length, 3);
    assert.equal(run(false, true).added.length, 3, 'guardado pendiente: se carga aunque no haya corazones');
    assert.equal(typeof idle.win.WoFavoritesLoader.load, 'function');
});

// FE-01: /client/dashboard y las postulaciones de /client/requests pintan los corazones y
// llaman a WoClientPanelUi.ensureModules() en la MISMA tarea. El MutationObserver del cargador
// corre después (microtarea): si el panel insertara wo-favorites.js, el modelo quedaría detrás,
// el módulo saldría con "falta wo-favorites-model.js" y los corazones quedarían ocultos.
test('panel del cliente: los corazones pintados en la misma tarea cargan el modelo antes que el módulo', async () => {
    const cm = read('public/shared/js/config-manager.js');
    const from = cm.indexOf('// Favoritos (ronda 2 · P22): carga perezosa de wo-favorites.js');
    const loaderBlock = cm.slice(cm.indexOf('(function () {', from), cm.indexOf('// Auto-initialize when script loads', from));
    const panelUi = read('public/shared/js/client-panel-ui.js');

    const run = async ({ withLoader }) => {
        const inserted = [];
        const observers = [];
        let pending = [];
        let hearts = false;
        // Como en el navegador: los registros del MutationObserver se entregan en una microtarea.
        const queue = (node) => {
            if (!pending.length) Promise.resolve().then(() => { const records = pending; pending = []; observers.forEach((o) => { if (!o.off) o.cb(records); }); });
            pending.push({ addedNodes: [node] });
        };
        const document = {
            readyState: 'complete',
            currentScript: { src: 'https://beta.weotzi.com/shared/js/config-manager.js' },
            head: { appendChild(node) { if (node.tag === 'script') inserted.push(node); queue(node); return node; } },
            documentElement: { setAttribute() {} },
            createElement: (tag) => ({ tag, nodeType: 1, setAttribute() {}, remove() { this.removed = true; } }),
            addEventListener() {},
            getElementById: () => null,
            querySelector(sel) {
                const script = /^script\[src\*="(.+)"\]$/.exec(sel);
                if (script) return inserted.some((s) => !s.removed && s.src.indexOf(script[1]) !== -1) ? {} : null;
                return sel === '[data-wo-favorite]' && hearts ? {} : null;
            }
        };
        class MO { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.off = true; } }
        const window = { location: { hash: '', pathname: '/client/dashboard' }, localStorage: { getItem: () => null } };
        const context = vm.createContext({ window, document, MutationObserver: MO, console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise });
        if (withLoader) vm.runInContext(loaderBlock, context, { filename: 'config-manager.js (cargador de favoritos)' });
        vm.runInContext(panelUi, context, { filename: 'client-panel-ui.js' });
        assert.equal(inserted.length, 0, 'sin corazones no se pide nada');

        // client-dashboard.js: grid.innerHTML = '…<button data-wo-favorite>…'; ui.ensureModules(grid);
        const grid = { nodeType: 1, matches: () => false, querySelector: (sel) => (sel === '[data-wo-favorite]' ? {} : null) };
        hearts = true;
        queue(grid);
        window.WoClientPanelUi.ensureModules(grid);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Los scripts con async=false corren en orden de inserción: el respaldo encadena con onload.
        for (let i = 0; i < inserted.length; i++) if (typeof inserted[i].onload === 'function') inserted[i].onload();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return inserted.map((s) => s.src.replace(/^https:\/\/beta\.weotzi\.com/, ''));
    };

    assert.deepEqual(await run({ withLoader: true }), ['/shared/js/wo-favorites-model.js', '/shared/js/wo-favorites.js'],
        'con el cargador de config-manager.js: una sola copia de cada uno, el modelo primero');
    assert.deepEqual(await run({ withLoader: false }), ['/shared/js/wo-favorites-model.js', '/shared/js/wo-favorites.js'],
        'sin config-manager.js (respaldo): el modelo primero');
});

test('marketplace: corazones de artista y de estudio con el contrato, y espejo del estado', () => {
    const js = read('public/shared/js/marketplace.js');
    const Core = require('../public/shared/js/marketplace-core.js');
    const cut = (from, to) => js.slice(js.indexOf(from), js.indexOf(to));
    const context = vm.createContext({
        Core, escapeHtml: Core.escapeHtml, favoriteIds: new Set(), artistRatings: {}, studioRatings: {},
        getArtistStatus: () => null, isVerifiedArtist: () => false, artistStudioLabel: () => ''
    });
    vm.runInContext(cut('function getInitials', 'function showLoading') + cut('function cardMedia', 'function resetPaging'), context);

    const artist = context.artistCardHtml({ user_id: ARTIST, username: 'mara.wo', name: 'Mara "Ink" <b>', profile_picture: 'https://cdn.test/m.jpg', styles_array: [] });
    const artistBtn = /<button[^>]*data-wo-favorite[^>]*>/.exec(artist)[0];
    assert.ok(artistBtn.includes('data-kind="artist"'));
    assert.ok(artistBtn.includes(`data-id="${ARTIST}"`));
    assert.ok(artistBtn.includes('data-label="Mara &quot;ink&quot; &lt;b&gt;"') || artistBtn.includes('data-label="Mara &quot;Ink&quot; &lt;b&gt;"'), artistBtn);
    assert.ok(artistBtn.includes('data-image="https://cdn.test/m.jpg"'));
    assert.ok(artistBtn.includes('data-url="/artist/profile?artist=mara.wo"'));
    assert.ok(artistBtn.includes(`data-fav-artist="${ARTIST}"`), 'conserva el camino anterior como respaldo');
    assert.ok(!/<b>/.test(artistBtn));

    const studio = context.studioCardHtml({ id: 'st-1', slug: 'casa-koi', name: 'Casa "Koi"', cover_image: 'javascript:alert(1)', logo_image: 'https://cdn.test/logo.png', _cities: [], _styles: [], _flags: {} });
    const studioBtn = /<button[^>]*data-wo-favorite[^>]*>/.exec(studio)[0];
    assert.ok(studioBtn.includes('data-kind="studio"'));
    assert.ok(studioBtn.includes('data-id="st-1"'));
    assert.ok(studioBtn.includes('data-label="Casa &quot;Koi&quot;"'));
    assert.ok(studioBtn.includes('data-image="https://cdn.test/logo.png"'), 'imagen peligrosa descartada');
    assert.ok(studioBtn.includes('data-url="/studio/profile?studio=casa-koi"'));
    assert.ok(/\shidden\s/.test(studioBtn), 'sin el módulo no queda un botón muerto');
    assert.ok(!studio.includes('javascript:'));
    // El corazón nunca queda dentro del enlace de la card.
    assert.ok(studio.indexOf('</a>') < studio.indexOf('data-wo-favorite'));

    assert.match(js, /document\.addEventListener\('wo:favorites-change', \(\) => \{[\s\S]*?favoriteIds = new Set\(W\.ids\('artist'\)\);/);
    assert.ok(js.includes("{ href: '/client/favorites/', label: 'Favoritos' }"));
    assert.match(read('public/shared/css/marketplace-ds.css'), /\.mk-card-fav\[hidden\]\{display:none\}/);
    assert.ok(read('public/marketplace/index.html').includes('/shared/js/data/favorites-repo.js'));
});

test('perfil del estudio: deja el botón vacío y oculto junto al título', () => {
    const sp = require('../public/shared/js/studio-profile.js');
    const html = sp.favoriteButtonHtml({ id: 'st-1', slug: 'casa koi', name: 'Casa <Koi>', cover_image: 'https://cdn.test/c.jpg' });
    assert.equal(html, '<button type="button" class="sp-fav" hidden data-wo-favorite data-kind="studio" data-fav-variant="label"'
        + ' data-id="st-1" data-label="Casa &lt;Koi&gt;" data-image="https://cdn.test/c.jpg" data-url="/studio/profile?studio=casa%20koi"></button>');
    assert.equal(sp.favoriteButtonHtml({ name: 'Sin id' }), '');
    assert.ok(!sp.favoriteButtonHtml({ id: 'x', name: 'x', cover_image: 'javascript:alert(1)' }).includes('data-image'));
    const js = read('public/shared/js/studio-profile.js');
    assert.ok(js.includes("titleRow.insertAdjacentHTML('beforeend', favoriteButtonHtml(studio));"));
    assert.ok(js.includes("!titleRow.querySelector('[data-wo-favorite]')"), 'no se duplica');
});

test('Store: corazón en las cards (hermano del enlace) y en la ficha, con autor para el contador', () => {
    const js = read('public/shared/js/store-catalog.js');
    assert.ok(js.includes("return '<div class=\"stc-card-wrap\">' +"));
    assert.ok(js.includes("favoriteButtonHtml(p, seller && typeof seller === 'object' ? seller : null, 'float') +"));
    assert.ok(js.includes("favoriteButtonHtml(p, seller, 'label') +"));
    assert.ok(js.includes("shown.map(function (p) { return cardHtml(p, s); })"));
    assert.ok(js.includes("shown.map(function (p) { return cardHtml(p, seller); })"), 'el filtro repinta con el mismo vendedor');
    const start = js.indexOf('function favoriteButtonHtml(product, seller, variant) {');
    const fn = js.slice(start, js.indexOf('\n    }\n', start) + 7);
    const text = (v) => (v == null ? '' : String(v).trim());
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const Shell = { previewUrl: (p) => (p ? 'https://cdn.test/' + p : '') };
    const favoriteButtonHtml = new Function('text', 'esc', 'list', 'Shell', fn + '; return favoriteButtonHtml;')(text, esc, (v) => (Array.isArray(v) ? v : []), Shell);
    const design = favoriteButtonHtml({ id: 'p1', kind: 'design', title: 'Flor "x"', images: [{ path: 'a/b.webp' }] }, { type: 'artist', id: ARTIST }, 'float');
    assert.equal(design, '<button type="button" class="stc-fav" hidden data-wo-favorite data-kind="design" data-id="p1" data-label="Flor &quot;x&quot;"'
        + ' data-image="https://cdn.test/a/b.webp" data-url="/store/item/?id=p1" data-artist-id="' + ARTIST + '" data-fav-variant="float"></button>');
    const merch = favoriteButtonHtml({ id: 'p2', kind: 'merch', title: 'Remera', images: [] }, { type: 'studio', id: 'st-1' }, 'label');
    assert.ok(merch.includes('data-kind="merch"') && merch.includes('data-fav-variant="label"'));
    assert.ok(!merch.includes('data-artist-id'), 'un estudio vendedor no suma al contador de un artista');
    assert.ok(!merch.includes('data-image'));
    assert.equal(favoriteButtonHtml({ id: 'p3', kind: 'otro', title: 'x' }, null, 'float'), '');
    assert.equal(favoriteButtonHtml({ kind: 'design', title: 'x' }, null, 'float'), '');
    const css = read('public/shared/css/store-catalog.css');
    assert.match(css, /\.stc-card-wrap\{position:relative;display:flex;min-width:0\}/);
});

test('/client/favorites: página, scripts en orden y entradas desde el área del cliente', () => {
    const srcs = [...PAGE_HTML.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    const order = ['/shared/js/config-manager.js', '/shared/js/data/postgrest-client.js', '/shared/js/data/favorites-repo.js',
        '/shared/js/wo-favorites-model.js', '/shared/js/wo-favorites.js', '/shared/js/client-favorites.js'];
    let last = -1;
    for (const src of order) {
        const at = srcs.indexOf(src);
        assert.ok(at > last, 'orden de scripts: ' + src);
        last = at;
        assert.ok(fs.existsSync(path.join(root, 'public', src)), src + ' existe');
    }
    for (const href of ['/shared/css/ds/tokens.css', '/shared/css/ds/components.css', '/shared/css/wo-favorites.css', '/shared/css/client-favorites-ds.css']) {
        assert.ok(PAGE_HTML.includes(`<link rel="stylesheet" href="${href}">`), href);
    }
    assert.match(PAGE_HTML, /<html lang="es">/);
    assert.match(PAGE_HTML, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
    assert.match(PAGE_HTML, /<meta name="robots" content="noindex">/);
    assert.match(PAGE_HTML, /<h1 class="cfv-title">Mis favoritos<\/h1>/);
    assert.match(PAGE_HTML, /<a class="wo-topbar-item is-active" href="\/client\/favorites\/" aria-current="page">Favoritos<\/a>/);
    assert.match(PAGE_HTML, /<main class="cfv-main" id="cfv-main" tabindex="-1">/);
    assert.match(PAGE_HTML, /<a class="cfv-skip" href="#cfv-main">Ir al contenido<\/a>/);
    // Diálogos nativos con título y campos con etiqueta.
    for (const id of ['cfv-dialog-name', 'cfv-dialog-delete', 'cfv-dialog-move']) {
        assert.match(PAGE_HTML, new RegExp(`<dialog class="cfv-dialog" id="${id}" aria-labelledby="[\\w-]+">`));
    }
    assert.match(PAGE_HTML, /<label class="wo-label" for="cfv-name-input">Nombre de la lista<\/label>/);
    assert.match(PAGE_HTML, /<input class="wo-input" type="text" id="cfv-name-input" maxlength="60"/);
    assert.match(PAGE_HTML, /<label class="wo-label" for="cfv-move-input">/);
    assert.doesNotMatch(PAGE_HTML, /onclick=/);

    for (const page of ['public/client/dashboard/index.html', 'public/client/requests/index.html', 'public/client/chats/index.html', 'public/client/profile/index.html']) {
        assert.ok(read(page).includes('<a class="wo-topbar-item" href="/client/favorites/">Favoritos</a>'), page);
    }
    assert.ok(read('public/client/dashboard/index.html').includes('href="/client/favorites/">Mis favoritos'), 'entrada visible también en el teléfono');
});

test('/client/favorites: la página escapa lo guardado y no arma URL por su cuenta', () => {
    const start = PAGE_JS.indexOf('function cardHtml(item, canMove) {');
    const fn = PAGE_JS.slice(start, PAGE_JS.indexOf('\n    }\n', start) + 7);
    const Model = require('../public/shared/js/wo-favorites-model.js');
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const cardHtml = new Function('Model', 'esc', 'appPath', 'icon', 'KIND_ICONS', 'itemTitle', fn + '; return cardHtml;')(
        Model, esc, (p) => '/beta' + p, (name) => '<i data-wo-icon="' + name + '"></i>', { artist: 'user' },
        (item) => item.label || Model.kindLabel(item.kind) || 'Guardado');
    const evil = '<img src=x onerror="alert(1)">';
    const item = Model.rowToItem({ id: 'i"1', list_id: 'l1', kind: 'artist', target_id: ARTIST, label: evil, image_url: 'javascript:alert(1)', url: 'https://evil.test/x' });
    const html = cardHtml(item, true);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /javascript:/);
    assert.doesNotMatch(html, /evil\.test/);
    assert.ok(html.includes('data-cfv-item="i&quot;1"'));
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    assert.ok(html.includes('aria-label="Quitar «&lt;img'), 'los botones nombran el elemento');
    assert.ok(!html.includes('<a '), 'sin destino válido no hay enlace');

    const ok = cardHtml(Model.rowToItem({ id: 'i2', list_id: 'l1', kind: 'artist', target_id: ARTIST, label: 'Mara', image_url: '/shared/assets/a.webp', url: '/artist/profile?artist=mara' }), true);
    assert.ok(ok.includes('<a href="/beta/artist/profile?artist=mara">Mara</a>'));
    assert.ok(ok.includes('<img src="/beta/shared/assets/a.webp" alt="" loading="lazy" decoding="async">'));
    assert.ok(ok.includes('data-cfv-move') && ok.includes('data-cfv-remove'));
    assert.ok(PAGE_JS.includes("window.location.href = appPath('/client/login');"), 'sin sesión va al ingreso');
});

test('CSS: solo tokens, [hidden] respetado, foco visible y respuesta al ancho', () => {
    for (const [name, raw] of [['wo-favorites.css', MODULE_CSS], ['client-favorites-ds.css', PAGE_CSS]]) {
        const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, name + ' sin hex sueltos');
        assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/, name + ' sin colores literales');
        assert.doesNotMatch(css, /!important/, name);
        for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
            assert.ok(['0', 'var(--radius-none)', 'var(--radius-circle)'].includes(m[1].trim()), name + ' radius: ' + m[1]);
        }
        for (const m of css.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)) {
            assert.match(m[2], /^\s*display\s*:\s*none\s*;?\s*$/, name + ': [hidden] solo oculta → ' + m[1].trim());
        }
    }
    // Lo que se muestra con display propio respeta el atributo hidden.
    assert.match(MODULE_CSS, /\.wo-fav-btn\[hidden\]\{display:none\}/);
    assert.match(MODULE_CSS, /\.wo-fav-pop-error\[hidden\]\{display:none\}/);
    assert.match(PAGE_CSS, /\.cfv-field-error\[hidden\] \{ display: none; \}/);
    assert.match(PAGE_CSS, /\.cfv-move-new\[hidden\] \{ display: none; \}/);
    // Foco visible y objetivo táctil.
    assert.match(MODULE_CSS, /\.wo-fav-btn:focus-visible\{outline:none;box-shadow:var\(--shadow-focus\)\}/);
    assert.match(MODULE_CSS, /min-width:var\(--tap-target-min\)/);
    // Teléfono: el panel es una hoja; la grilla nunca usa 1fr sin minmax.
    assert.match(MODULE_CSS, /\.wo-fav-pop--sheet\{/);
    assert.match(MODULE_CSS, /@media \(max-width:600px\)/);
    assert.doesNotMatch(PAGE_CSS, /repeat\(\d+,\s*1fr\)/);
    assert.match(PAGE_CSS, /@media \(min-width: 56\.25rem\)/);
    assert.match(MODULE_CSS, /@media \(prefers-reduced-motion:reduce\)/);
});
