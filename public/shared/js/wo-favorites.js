/* ============================================================================
   WE ÖTZI — Favoritos (ronda 2 · P22) · wo-favorites.js
   ----------------------------------------------------------------------------
   Activa cualquier corazón de la página, presente o agregado después
   (MutationObserver). Quien pinta una tarjeta o un perfil solo deja el botón:

     <button type="button" data-wo-favorite
             data-kind="artist|design|merch|studio"
             data-id="…"          artist → artists_db.user_id (uuid)
                                  studio → studios.id
                                  design/merch de la Store → store_products.id
                                  diseño del portfolio → id estable del ítem
             data-label="…"       nombre visible (queda como snapshot)
             data-image="…"       imagen https o ruta local (opcional)
             data-url="…"         destino dentro del sitio (opcional; por
                                  defecto el perfil del artista/estudio o la
                                  página donde se guardó)
             data-artist-id="…"   autor del diseño/merch, uuid (opcional: suma
                                  al contador "veces guardado" del artista)
             data-fav-variant="float|label"   (opcional, botones vacíos)
             hidden></button>     (opcional: aparece cuando el módulo lo activa)

   - Botón vacío: el módulo pinta el corazón (.wo-fav-btn) y su nombre
     accesible. Botón con contenido propio: solo recibe el estado
     (.is-fav + aria-pressed) y conserva su aspecto.
   - Variantes del botón vacío: "float" lo ubica arriba a la derecha de su
     contenedor (que debe ser position:relative; .wo-fav-host sirve para
     envolver una tarjeta que es un <a> completo, con el botón como hermano);
     "label" agrega el texto Guardar / Guardado.
   - Al tocar: guarda en la lista por defecto ("Favoritos") y ofrece "Guardar
     en otra lista…" (listas del usuario + crear lista). Si ya estaba en una
     lista lo quita (con "Deshacer"); si estaba en varias abre el selector.
   - Sin sesión: invita a iniciar sesión o crear cuenta y recuerda la intención
     (localStorage); al volver con sesión se guarda solo.
   - Datos: SOLO por WeotziData.FavoriteLists (data/favorites-repo.js). Si la
     página no lo cargó, se pide solo.

   API (window.WoFavorites): ready(), reload(), refresh(root), isSaved(kind,id),
   listIdsFor(kind,id), ids(kind), lists(), items(filter), save(item,listId),
   remove(item,listId), openPicker(anchor,item), ensureDefaultList(),
   createList(name), renameList(id,name), deleteList(id), moveItem(itemId,listId),
   removeItem(itemId), messageFor(err,ctx), appPath(path) y las propiedades
   available, loaded y userId.
   Evento en document: 'wo:favorites-change' con detail { reason, kind?, id? }.

   Lo carga el cargador de config-manager.js cuando la página tiene (o recibe)
   un [data-wo-favorite] o hay una intención pendiente. Requiere antes
   wo-favorites-model.js. Estilos: shared/css/wo-favorites.css.
   ============================================================================ */
(function (root) {
    'use strict';

    if (!root || !root.document) return;
    if (root.WoFavorites && root.WoFavorites.__real) return;

    var doc = root.document;
    var Model = root.WoFavoritesModel;
    if (!Model) {
        if (root.console) root.console.error('[wo-favorites] falta wo-favorites-model.js');
        return;
    }

    var SEL = '[data-wo-favorite]';
    var ON = 'data-wo-fav-on';
    var FAVORITES_PATH = '/client/favorites/';
    var SAVED_POP_MS = 6000;
    var TOAST_MS = 7000;

    var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
    var HEART_SVG = SVG_OPEN + '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    var CHECK_SVG = SVG_OPEN + '<polyline points="20 6 9 17 4 12"/></svg>';
    var X_SVG = SVG_OPEN + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    /* ------------------------------------------------------------------ */
    /* Rutas y recursos                                                    */
    /* ------------------------------------------------------------------ */

    var me = doc.currentScript;
    var srcMatch = me && me.src ? /^(.*\/shared\/)js\/[^\/?#]+(?:[?#].*)?$/.exec(me.src) : null;

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var pathname = (root.location && root.location.pathname) || '';
        return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
    }
    function appPath(path) {
        var base = basePath();
        var s = String(path || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }
    var SHARED = srcMatch ? srcMatch[1] : (basePath() + '/shared/');

    function currentPath() {
        var loc = root.location || {};
        return Model.safePath(String(loc.pathname || '') + String(loc.search || '') + String(loc.hash || ''), { basePath: basePath() });
    }
    function itemContext() {
        var loc = root.location || {};
        return {
            origin: loc.origin || '',
            basePath: basePath(),
            pagePath: String(loc.pathname || '') + String(loc.search || '')
        };
    }

    var scriptLoads = Object.create(null);
    function loadScript(src) {
        if (!scriptLoads[src]) {
            scriptLoads[src] = new Promise(function (resolve, reject) {
                var s = doc.createElement('script');
                s.src = src;
                s.async = false;
                s.onload = function () { resolve(); };
                s.onerror = function () { delete scriptLoads[src]; reject(new Error('No se pudo cargar ' + src)); };
                (doc.head || doc.documentElement).appendChild(s);
            });
        }
        return scriptLoads[src];
    }

    var cssReady = null;
    function ensureCss() {
        if (cssReady) return cssReady;
        cssReady = new Promise(function (resolve) {
            var existing = doc.querySelector('link[rel="stylesheet"][href*="wo-favorites.css"]');
            if (existing) {
                // Ya cargada (o cargando): no hay forma fiable de saberlo en todos los
                // navegadores; un tope corto evita esperar de más.
                if (existing.sheet) { resolve(); return; }
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { resolve(); });
                root.setTimeout(resolve, 1200);
                return;
            }
            var link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = SHARED + 'css/wo-favorites.css';
            link.addEventListener('load', function () { resolve(); });
            link.addEventListener('error', function () { resolve(); });
            root.setTimeout(resolve, 1500);
            (doc.head || doc.documentElement).appendChild(link);
        });
        return cssReady;
    }

    function ensureRepo() {
        var chain = Promise.resolve();
        if (!(root.WeotziData && typeof root.WeotziData.run === 'function')) {
            chain = chain.then(function () { return loadScript(SHARED + 'js/data/postgrest-client.js'); });
        }
        return chain.then(function () {
            if (root.WeotziData && root.WeotziData.FavoriteLists) return null;
            return loadScript(SHARED + 'js/data/favorites-repo.js');
        }).then(function () {
            var repo = root.WeotziData && root.WeotziData.FavoriteLists;
            if (!repo) throw new Error('favorites: repositorio no disponible');
            return repo;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Estado                                                              */
    /* ------------------------------------------------------------------ */

    var state = {
        phase: 'idle',       // idle | loading | ready
        userId: null,
        available: true,     // false: la base todavía no tiene las tablas
        demo: false,         // modo demo: no se guarda nada
        error: null,         // último error de carga (se reintenta al tocar)
        lists: [],
        items: [],
        index: Object.create(null)
    };
    var loadPromise = null;
    var busy = Object.create(null);

    function emit(reason, detail) {
        var d = detail || {};
        d.reason = reason;
        try { doc.dispatchEvent(new root.CustomEvent('wo:favorites-change', { detail: d })); } catch (e) { /* sin CustomEvent */ }
    }

    function reindex() { state.index = Model.buildIndex(state.items); }
    function setData(listRows, itemRows) {
        state.lists = Model.sortLists((listRows || []).map(Model.rowToList).filter(function (l) { return l.id; }));
        state.items = (itemRows || []).map(Model.rowToItem).filter(function (it) { return it.itemId && it.kind && it.id; });
        reindex();
    }
    function resetData() {
        state.lists = [];
        state.items = [];
        state.index = Object.create(null);
    }
    function findList(id) {
        for (var i = 0; i < state.lists.length; i++) if (state.lists[i].id === id) return state.lists[i];
        return null;
    }
    function defaultList() {
        for (var i = 0; i < state.lists.length; i++) if (state.lists[i].isDefault) return state.lists[i];
        return null;
    }
    function listCount(listId) {
        var n = 0;
        state.items.forEach(function (it) { if (it.listId === listId) n += 1; });
        return n;
    }
    function listIdsFor(kind, id) {
        var k = Model.normalizeKind(kind);
        return (state.index[Model.itemKey(k, Model.normalizeId(k, id))] || []).slice();
    }
    function isSaved(kind, id) { return listIdsFor(kind, id).length > 0; }

    function userError(message) {
        var err = new Error(message);
        err.userMessage = message;
        return err;
    }
    function messageFor(err, context) {
        return (err && err.userMessage) || Model.errorMessage(err, context);
    }

    /* ------------------------------------------------------------------ */
    /* Sesión y carga                                                      */
    /* ------------------------------------------------------------------ */

    function supabaseClient() {
        try {
            var CM = root.ConfigManager;
            if (typeof root.supabase !== 'undefined' && CM && typeof CM.getSupabaseClient === 'function'
                && (typeof CM.isSupabaseConfigured !== 'function' || CM.isSupabaseConfigured())) {
                var client = CM.getSupabaseClient();
                if (client) return client;
            }
        } catch (e) { /* sigue con el singleton */ }
        return root._supabase || null;
    }

    // Modo demo de la app (sin Supabase) o sandbox del artista (wo-demo.js):
    // ahí no se escribe nada en la base.
    function demoActive() {
        try {
            var CM = root.ConfigManager;
            if (CM && typeof CM.isDemoMode === 'function' && CM.isDemoMode()) return true;
            return !!(root.WoDemo && root.WoDemo.enabled === true);
        } catch (e) { return false; }
    }

    function resolveSession() {
        var CM = root.ConfigManager;
        var wait = CM && typeof CM.ready === 'function' ? Promise.resolve(CM.ready()).catch(function () {}) : Promise.resolve();
        return wait.then(function () {
            state.demo = demoActive();
            if (state.demo) return null;
            var client = supabaseClient();
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
            return client.auth.getSession().then(function (res) {
                return (res && res.data && res.data.session) || null;
            });
        }).catch(function () { return null; });
    }

    function load() {
        state.phase = 'loading';
        state.error = null;
        return resolveSession().then(function (session) {
            state.userId = session && session.user && session.user.id ? session.user.id : null;
            if (!state.userId) { resetData(); return null; }
            return ensureRepo().then(function (Repo) {
                return Promise.all([Repo.listLists(state.userId), Repo.listItems(state.userId)]);
            }).then(function (res) {
                state.available = true;
                setData(res[0], res[1]);
            }).catch(function (err) {
                resetData();
                if (Model.isMissingSchemaError(err)) state.available = false;
                else state.error = err;
                if (root.console) root.console.warn('[wo-favorites] no se pudieron cargar los favoritos:', err && err.message);
            });
        }).then(function () {
            state.phase = 'ready';
            paintAll();
            emit('ready');
            return api;
        });
    }

    function ready() {
        if (!loadPromise) {
            loadPromise = load();
            // Fuera de la cadena de carga: guardar la intención pendiente vuelve
            // a pedir ready(), y esperarla aquí adentro se trabaría a sí misma.
            loadPromise.then(applyPendingIntent);
        }
        return loadPromise;
    }
    function reload() {
        loadPromise = null;
        return ready();
    }
    // Estado listo para operar; reintenta si la carga anterior falló por red.
    function settled() {
        return ready().then(function () {
            if (state.error) return reload();
            return api;
        });
    }
    function requireSession() {
        if (state.available === false) throw userError('Los favoritos todavía no están disponibles. Inténtalo más tarde.');
        if (!state.userId) throw userError('Inicia sesión para usar tus favoritos.');
        if (state.error) throw state.error;
    }

    function refreshLists(Repo) {
        return Repo.listLists(state.userId).then(function (rows) {
            state.lists = Model.sortLists((rows || []).map(Model.rowToList).filter(function (l) { return l.id; }));
        });
    }

    /* ------------------------------------------------------------------ */
    /* Operaciones                                                         */
    /* ------------------------------------------------------------------ */

    function cleanItem(item) {
        return Model.normalizeItem(item || {}, { origin: (root.location && root.location.origin) || '', basePath: basePath() });
    }

    // Guarda en una lista (sin listId: la de defecto). Devuelve el ítem guardado.
    function save(item, listId) {
        var it = cleanItem(item);
        if (!it) return Promise.reject(userError('No pudimos guardar este elemento.'));
        return settled().then(function () {
            requireSession();
            return ensureRepo();
        }).then(function (Repo) {
            return Repo.save(it, listId || null).then(function (row) {
                if (!row || !row.id) throw new Error('favorites: respuesta vacía al guardar');
                var saved = Model.rowToItem(row);
                state.items = state.items.filter(function (x) { return x.itemId !== saved.itemId; });
                state.items.unshift(saved);
                reindex();
                // La lista por defecto se crea en el primer guardado.
                return findList(saved.listId) ? saved : refreshLists(Repo).then(function () { return saved; });
            });
        }).then(function (saved) {
            paintAll();
            emit('saved', { kind: saved.kind, id: saved.id, listId: saved.listId });
            return saved;
        });
    }

    // Quita de una lista o, sin listId, de todas. Devuelve lo que se quitó.
    function remove(item, listId) {
        var it = cleanItem(item);
        if (!it) return Promise.resolve([]);
        var matches = function (x) {
            return x.kind === it.kind && x.id === it.id && (!listId || x.listId === listId);
        };
        var removed = [];
        return settled().then(function () {
            requireSession();
            return ensureRepo();
        }).then(function (Repo) {
            removed = state.items.filter(matches);
            return Repo.removeTarget(state.userId, it.kind, it.id, listId || null);
        }).then(function () {
            state.items = state.items.filter(function (x) { return !matches(x); });
            reindex();
            paintAll();
            emit('removed', { kind: it.kind, id: it.id, listId: listId || null });
            return removed;
        });
    }

    function removeItem(itemId) {
        var target = null;
        return settled().then(function () {
            requireSession();
            target = state.items.filter(function (x) { return x.itemId === itemId; })[0] || null;
            return ensureRepo();
        }).then(function (Repo) {
            return Repo.removeItem(state.userId, itemId);
        }).then(function () {
            state.items = state.items.filter(function (x) { return x.itemId !== itemId; });
            reindex();
            paintAll();
            emit('removed', target ? { kind: target.kind, id: target.id, listId: target.listId } : {});
            return target;
        });
    }

    function moveItem(itemId, listId) {
        return settled().then(function () {
            requireSession();
            if (!findList(listId)) throw userError('Esa lista ya no existe.');
            return ensureRepo();
        }).then(function (Repo) {
            return Repo.moveItem(state.userId, itemId, listId);
        }).then(function (res) {
            if (res && res.merged) {
                state.items = state.items.filter(function (x) { return x.itemId !== itemId; });
            } else {
                state.items.forEach(function (x) { if (x.itemId === itemId) x.listId = listId; });
            }
            reindex();
            paintAll();
            emit('moved', { itemId: itemId, listId: listId });
            return res || { merged: false };
        });
    }

    function ensureDefaultList() {
        return settled().then(function () {
            requireSession();
            var current = defaultList();
            if (current) return current;
            return ensureRepo().then(function (Repo) {
                return Repo.ensureDefaultList().then(function () { return refreshLists(Repo); });
            }).then(function () {
                emit('list-created', {});
                return defaultList();
            });
        });
    }

    function createList(name) {
        return settled().then(function () {
            requireSession();
            var check = Model.validateListName(name, state.lists);
            if (!check.ok) throw userError(check.error);
            if (!Model.canCreateList(state.lists)) {
                throw userError('Llegaste al máximo de ' + Model.LIMITS.LISTS + ' listas. Borra alguna para crear otra.');
            }
            return ensureRepo().then(function (Repo) {
                return Repo.createList(state.userId, check.value, Model.nextSortOrder(state.lists));
            });
        }).then(function (row) {
            if (!row || !row.id) throw new Error('favorites: respuesta vacía al crear la lista');
            var list = Model.rowToList(row);
            state.lists = Model.sortLists(state.lists.filter(function (l) { return l.id !== list.id; }).concat([list]));
            emit('list-created', { listId: list.id });
            return list;
        });
    }

    function renameList(listId, name) {
        return settled().then(function () {
            requireSession();
            var check = Model.validateListName(name, state.lists, listId);
            if (!check.ok) throw userError(check.error);
            return ensureRepo().then(function (Repo) { return Repo.renameList(state.userId, listId, check.value); });
        }).then(function (row) {
            if (!row || !row.id) throw userError('Esa lista ya no existe.');
            var list = Model.rowToList(row);
            state.lists = Model.sortLists(state.lists.map(function (l) { return l.id === list.id ? list : l; }));
            emit('list-renamed', { listId: list.id });
            return list;
        });
    }

    function deleteList(listId) {
        return settled().then(function () {
            requireSession();
            var list = findList(listId);
            if (list && list.isDefault) throw userError('La lista principal no se puede borrar.');
            return ensureRepo();
        }).then(function (Repo) {
            return Repo.deleteList(state.userId, listId);
        }).then(function (deleted) {
            if (!deleted) throw userError('No pudimos borrar la lista. Recarga la página e inténtalo de nuevo.');
            state.lists = state.lists.filter(function (l) { return l.id !== listId; });
            state.items = state.items.filter(function (x) { return x.listId !== listId; });
            reindex();
            paintAll();
            emit('list-deleted', { listId: listId });
            return true;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Botones                                                             */
    /* ------------------------------------------------------------------ */

    function readItem(btn) {
        if (!btn || typeof btn.getAttribute !== 'function') return null;
        return Model.normalizeItem({
            kind: btn.getAttribute('data-kind'),
            id: btn.getAttribute('data-id'),
            label: btn.getAttribute('data-label'),
            image: btn.getAttribute('data-image'),
            url: btn.getAttribute('data-url'),
            artistId: btn.getAttribute('data-artist-id')
        }, itemContext());
    }

    function paint(btn) {
        var item = readItem(btn);
        if (!item) return;
        var saved = isSaved(item.kind, item.id);
        btn.classList.toggle('is-fav', saved);
        btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
        if (btn.hasAttribute('data-wo-fav-label')) {
            var label = Model.buttonLabel(item, saved);
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
        }
        var text = btn.querySelector('.wo-fav-btn-text');
        if (text) text.textContent = saved ? 'Guardado' : 'Guardar';
        // Los que llegaron ocultos solo se muestran mientras el módulo puede
        // atenderlos (si la base todavía no tiene las listas, vuelven a ocultarse).
        if (btn.hasAttribute('data-wo-fav-hid')) {
            if (state.available === false) btn.setAttribute('hidden', '');
            else btn.removeAttribute('hidden');
        }
    }

    function activate(btn) {
        if (!btn || btn.hasAttribute(ON)) return;
        var item = readItem(btn);
        if (!item) return;   // sin kind/id válidos no hay nada que guardar
        btn.setAttribute(ON, '1');
        if (btn.tagName === 'BUTTON') {
            if (!btn.getAttribute('type')) btn.setAttribute('type', 'button');
        } else {
            if (!btn.getAttribute('role')) btn.setAttribute('role', 'button');
            if (!btn.hasAttribute('tabindex')) btn.setAttribute('tabindex', '0');
        }
        var empty = !btn.firstElementChild && !String(btn.textContent || '').trim();
        if (empty) {
            var variant = btn.getAttribute('data-fav-variant');
            btn.classList.add('wo-fav-btn');
            if (variant === 'float') btn.classList.add('wo-fav-btn--float');
            btn.innerHTML = HEART_SVG;
            if (variant === 'label') {
                btn.classList.add('wo-fav-btn--label');
                var text = doc.createElement('span');
                text.className = 'wo-fav-btn-text';
                btn.appendChild(text);
            }
        }
        // Si el botón no trae su propio nombre accesible, lo lleva el módulo.
        if (!btn.getAttribute('aria-label')) btn.setAttribute('data-wo-fav-label', '1');
        if (btn.hasAttribute('hidden')) btn.setAttribute('data-wo-fav-hid', '1');
        paint(btn);
    }

    function scan(scope) {
        var base = scope && typeof scope.querySelectorAll === 'function' ? scope : doc;
        var found = base.querySelectorAll(SEL + ':not([' + ON + '])');
        for (var i = 0; i < found.length; i++) activate(found[i]);
        if (base !== doc && typeof base.matches === 'function' && base.matches(SEL)) activate(base);
    }

    function paintAll() {
        var all = doc.querySelectorAll(SEL + '[' + ON + ']');
        for (var i = 0; i < all.length; i++) paint(all[i]);
    }

    function findButton(item) {
        if (!item) return null;
        var all = doc.querySelectorAll(SEL);
        for (var i = 0; i < all.length; i++) {
            var it = readItem(all[i]);
            if (it && it.kind === item.kind && it.id === item.id) return all[i];
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Piezas de UI                                                        */
    /* ------------------------------------------------------------------ */

    function el(tag, className, text) {
        var node = doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }
    function iconButton(className, label, svg) {
        var b = el('button', className);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.innerHTML = svg;
        return b;
    }
    function isNarrow() {
        try { return !!(root.matchMedia && root.matchMedia('(max-width: 600px)').matches); } catch (e) { return false; }
    }
    function focusNode(node) {
        if (!node || typeof node.focus !== 'function') return;
        try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    }

    var live = null;
    function announce(message) {
        if (!live) {
            live = el('div', 'wo-fav-live');
            live.setAttribute('role', 'status');
            live.setAttribute('aria-live', 'polite');
            doc.body.appendChild(live);
        }
        live.textContent = '';
        root.setTimeout(function () { if (live) live.textContent = message; }, 40);
    }

    /* ------------------------------- aviso ------------------------------- */

    var toastEl = null;
    var toastTimer = null;
    function hideToast() {
        if (toastTimer) { root.clearTimeout(toastTimer); toastTimer = null; }
        if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        toastEl = null;
    }
    // actions: [{ label, href } | { label, run }]
    function toast(message, opts) {
        var o = opts || {};
        hideToast();
        ensureCss();
        var bar = el('div', 'wo-fav-toast' + (o.error ? ' wo-fav-toast--error' : ''));
        bar.appendChild(el('span', 'wo-fav-toast-msg', message));
        (o.actions || []).forEach(function (action) {
            if (!action || !action.label) return;
            var node;
            if (action.href) {
                node = el('a', 'wo-fav-toast-act', action.label);
                node.setAttribute('href', action.href);
            } else {
                node = el('button', 'wo-fav-toast-act', action.label);
                node.type = 'button';
                node.addEventListener('click', function () { hideToast(); action.run(); });
            }
            bar.appendChild(node);
        });
        var close = iconButton('wo-fav-toast-x', 'Cerrar aviso', X_SVG);
        close.addEventListener('click', hideToast);
        bar.appendChild(close);
        doc.body.appendChild(bar);
        toastEl = bar;
        toastTimer = root.setTimeout(hideToast, o.ms || TOAST_MS);
        announce(message);
    }
    function fail(err, context) {
        if (root.console) root.console.warn('[wo-favorites]', err && err.message);
        toast(messageFor(err, context), { error: true });
    }

    /* ------------------------------ popover ------------------------------ */

    var pop = null;   // { el, anchor, item, timer, scrim }

    function closePop(restoreFocus) {
        if (!pop) return;
        var p = pop;
        pop = null;
        if (p.timer) root.clearTimeout(p.timer);
        if (p.scrim && p.scrim.parentNode) p.scrim.parentNode.removeChild(p.scrim);
        if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
        if (restoreFocus) focusNode(p.anchor && doc.contains(p.anchor) ? p.anchor : findButton(p.item));
    }

    // modal: en el teléfono suma un fondo que tapa la página (selector de
    // listas e invitación a entrar). El aviso "Guardado en…" no lo lleva: es
    // una confirmación breve que no debe frenar a quien sigue mirando.
    function openPop(anchor, item, label, modal) {
        closePop(false);
        hideToast();
        ensureCss();
        var box = el('div', 'wo-fav-pop');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', label);
        box.tabIndex = -1;
        var scrim = null;
        if (isNarrow()) {
            box.classList.add('wo-fav-pop--sheet');
            if (modal) {
                scrim = el('div', 'wo-fav-scrim');
                scrim.addEventListener('click', function () { closePop(true); });
                doc.body.appendChild(scrim);
            }
        }
        doc.body.appendChild(box);
        pop = { el: box, anchor: anchor || null, item: item, timer: null, scrim: scrim };
        return box;
    }

    function placePop() {
        if (!pop || pop.el.classList.contains('wo-fav-pop--sheet')) return;
        var anchor = pop.anchor && doc.contains(pop.anchor) ? pop.anchor : null;
        // Sin corazón de referencia (la página lo repintó): centrado.
        pop.el.classList.toggle('wo-fav-pop--center', !anchor);
        if (!anchor) {
            pop.el.style.left = '';
            pop.el.style.top = '';
            return;
        }
        var a = anchor.getBoundingClientRect();
        var box = pop.el;
        var w = box.offsetWidth;
        var h = box.offsetHeight;
        var vw = doc.documentElement.clientWidth || root.innerWidth;
        var vh = root.innerHeight;
        var gap = 8;
        var margin = 12;
        var left = Math.max(margin, Math.min(a.right - w, vw - w - margin));
        var top = a.bottom + gap;
        if (top + h > vh - margin) {
            var above = a.top - gap - h;
            top = above >= margin ? above : Math.max(margin, vh - h - margin);
        }
        box.style.left = Math.round(left) + 'px';
        box.style.top = Math.round(top) + 'px';
    }

    var placeQueued = false;
    function queuePlace() {
        if (!pop || placeQueued) return;
        placeQueued = true;
        var run = function () { placeQueued = false; placePop(); };
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run); else root.setTimeout(run, 16);
    }

    function focusables(box) {
        return Array.prototype.filter.call(
            box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])'),
            function (node) { return node.offsetParent !== null || node === doc.activeElement; }
        );
    }

    function popHead(title) {
        var head = el('div', 'wo-fav-pop-head');
        head.appendChild(el('p', 'wo-fav-pop-title', title));
        var close = iconButton('wo-fav-pop-x', 'Cerrar', X_SVG);
        close.addEventListener('click', function () { closePop(true); });
        head.appendChild(close);
        return head;
    }
    function favoritesLink(className) {
        var link = el('a', className, 'Ver mis favoritos');
        link.setAttribute('href', appPath(FAVORITES_PATH));
        return link;
    }

    /* ---- "Guardado en «Favoritos»" + Guardar en otra lista… ---- */
    function openSavedPop(anchor, item, listName) {
        var message = Model.savedMessage(listName);
        var box = openPop(anchor, item, message);
        box.classList.add('wo-fav-pop--saved');

        var head = el('div', 'wo-fav-pop-head');
        var mark = el('span', 'wo-fav-pop-check');
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML = CHECK_SVG;
        head.appendChild(mark);
        head.appendChild(el('p', 'wo-fav-pop-title', message));
        var close = iconButton('wo-fav-pop-x', 'Cerrar', X_SVG);
        close.addEventListener('click', function () { closePop(true); });
        head.appendChild(close);
        box.appendChild(head);

        var actions = el('div', 'wo-fav-pop-actions');
        var other = el('button', 'wo-fav-pop-btn wo-fav-pop-btn--ink', 'Guardar en otra lista…');
        other.type = 'button';
        other.addEventListener('click', function () { openPicker(anchor, item); });
        actions.appendChild(other);
        actions.appendChild(favoritesLink('wo-fav-pop-link'));
        box.appendChild(actions);

        placePop();
        announce(message + '. Pulsa Tab para guardar en otra lista.');

        // Se cierra solo, salvo que la persona esté encima o adentro.
        var current = pop;
        var arm = function (ms) {
            if (pop !== current) return;
            if (current.timer) root.clearTimeout(current.timer);
            current.timer = root.setTimeout(function () { if (pop === current) closePop(false); }, ms);
        };
        var hold = function () { if (current.timer) { root.clearTimeout(current.timer); current.timer = null; } };
        box.addEventListener('pointerenter', hold);
        box.addEventListener('focusin', hold);
        box.addEventListener('pointerleave', function () { arm(2500); });
        box.addEventListener('focusout', function (e) { if (!box.contains(e.relatedTarget)) arm(2500); });
        arm(SAVED_POP_MS);
    }

    /* ---- Selector de listas (+ crear lista) ---- */
    function openPicker(anchor, rawItem) {
        var item = cleanItem(rawItem);
        if (!item) return;
        var box = openPop(anchor, item, 'Guardar en una lista', true);
        box.classList.add('wo-fav-pop--picker');
        box.appendChild(popHead('Guardar en…'));
        if (item.label) box.appendChild(el('p', 'wo-fav-pop-item', item.label));

        var listBox = el('ul', 'wo-fav-pop-lists');
        listBox.setAttribute('role', 'group');
        listBox.setAttribute('aria-label', 'Tus listas');
        box.appendChild(listBox);

        var error = el('p', 'wo-fav-pop-error');
        error.setAttribute('role', 'alert');
        error.hidden = true;
        var showError = function (message) {
            error.textContent = message || '';
            error.hidden = !message;
            queuePlace();
        };

        function row(list) {
            var li = el('li');
            var label = el('label', 'wo-fav-pop-list');
            var input = el('input');
            input.type = 'checkbox';
            input.setAttribute('data-list-id', list.id);
            label.appendChild(input);
            label.appendChild(el('span', 'wo-fav-pop-list-name', list.name));
            label.appendChild(el('span', 'wo-fav-pop-list-count'));
            li.appendChild(label);
            input.addEventListener('change', function () {
                var want = input.checked;
                input.disabled = true;
                showError('');
                var job = want ? save(item, list.id) : remove(item, list.id);
                job.then(function () {
                    announce(want ? Model.savedMessage(list.name) : 'Quitado de «' + list.name + '»');
                }).catch(function (err) {
                    input.checked = !want;
                    showError(messageFor(err));
                }).then(function () {
                    input.disabled = false;
                    sync();
                });
            });
            return li;
        }

        function sync() {
            if (!pop || pop.el !== box) return;
            var saved = listIdsFor(item.kind, item.id);
            var inputs = listBox.querySelectorAll('input[data-list-id]');
            for (var i = 0; i < inputs.length; i++) {
                var id = inputs[i].getAttribute('data-list-id');
                if (!inputs[i].disabled) inputs[i].checked = saved.indexOf(id) !== -1;
                var count = inputs[i].parentNode.querySelector('.wo-fav-pop-list-count');
                if (count) count.textContent = String(listCount(id));
            }
        }

        function renderLists() {
            listBox.textContent = '';
            state.lists.forEach(function (list) { listBox.appendChild(row(list)); });
            sync();
        }

        // Crear lista y guardar ahí.
        var form = el('form', 'wo-fav-pop-new');
        form.setAttribute('novalidate', '');
        var fieldId = 'wo-fav-new-' + String(Date.now());
        var fieldLabel = el('label', 'wo-fav-pop-label', 'Nueva lista');
        fieldLabel.setAttribute('for', fieldId);
        var name = el('input', 'wo-fav-pop-input');
        name.type = 'text';
        name.id = fieldId;
        name.maxLength = Model.LIMITS.LIST_NAME;
        name.setAttribute('autocomplete', 'off');
        name.setAttribute('placeholder', 'Ej.: Ideas para el brazo');
        var create = el('button', 'wo-fav-pop-btn', 'Crear y guardar');
        create.type = 'submit';
        var fieldRow = el('div', 'wo-fav-pop-new-row');
        fieldRow.appendChild(name);
        fieldRow.appendChild(create);
        form.appendChild(fieldLabel);
        form.appendChild(fieldRow);
        form.appendChild(error);
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (create.disabled) return;
            showError('');
            create.disabled = true;
            createList(name.value).then(function (list) {
                return save(item, list.id).then(function () { return list; });
            }).then(function (list) {
                name.value = '';
                renderLists();
                announce('Lista «' + list.name + '» creada. ' + Model.savedMessage(list.name) + '.');
            }).catch(function (err) {
                if (state.lists.length !== listBox.children.length) renderLists();
                showError(messageFor(err, 'list'));
            }).then(function () {
                create.disabled = false;
                if (pop && pop.el === box) focusNode(name);
                queuePlace();
            });
        });
        box.appendChild(form);

        var foot = el('div', 'wo-fav-pop-foot');
        foot.appendChild(favoritesLink('wo-fav-pop-link'));
        var done = el('button', 'wo-fav-pop-btn wo-fav-pop-btn--ink', 'Listo');
        done.type = 'button';
        done.addEventListener('click', function () { closePop(true); });
        foot.appendChild(done);
        box.appendChild(foot);

        renderLists();
        placePop();
        focusNode(listBox.querySelector('input') || name);

        // Las listas pueden no estar cargadas (API llamada antes de ready()).
        settled().then(function () {
            if (!pop || pop.el !== box) return null;
            if (!state.userId) { closePop(false); openLoginPrompt(anchor, item); return null; }
            return defaultList() ? null : ensureDefaultList();
        }).then(function () {
            if (!pop || pop.el !== box) return;
            if (listBox.children.length !== state.lists.length) {
                renderLists();
                placePop();
                focusNode(listBox.querySelector('input') || name);
            }
        }).catch(function (err) { showError(messageFor(err)); });
    }

    /* ---- Sin sesión: invitar a entrar y recordar la intención ---- */
    function storeIntent(item) {
        try {
            var intent = Model.buildIntent(item, { returnTo: currentPath(), now: Date.now() });
            if (intent) root.localStorage.setItem(Model.INTENT_KEY, JSON.stringify(intent));
        } catch (e) { /* almacenamiento bloqueado: se pierde solo la intención */ }
    }
    function clearIntent() {
        try { root.localStorage.removeItem(Model.INTENT_KEY); } catch (e) { /* noop */ }
    }

    function openLoginPrompt(anchor, item) {
        var box = openPop(anchor, item, 'Inicia sesión para guardar favoritos', true);
        box.classList.add('wo-fav-pop--login');
        box.appendChild(popHead('Guarda tus favoritos'));
        box.appendChild(el('p', 'wo-fav-pop-text', item.label
            ? 'Inicia sesión o crea tu cuenta para guardar «' + item.label + '». Lo dejamos en tus favoritos en cuanto entres.'
            : 'Inicia sesión o crea tu cuenta para guardar esto. Lo dejamos en tus favoritos en cuanto entres.'));
        var links = Model.authLinks(currentPath());
        var actions = el('div', 'wo-fav-pop-actions');
        var login = el('a', 'wo-fav-pop-btn wo-fav-pop-btn--ink', 'Iniciar sesión');
        login.setAttribute('href', appPath(links.login));
        var register = el('a', 'wo-fav-pop-btn', 'Crear cuenta');
        register.setAttribute('href', appPath(links.register));
        [login, register].forEach(function (link) {
            var remember = function () { storeIntent(item); };
            link.addEventListener('click', remember);
            link.addEventListener('auxclick', remember);
            actions.appendChild(link);
        });
        box.appendChild(actions);
        placePop();
        focusNode(login);
    }

    // Guardado que quedó pendiente antes de iniciar sesión.
    function applyPendingIntent() {
        var raw = null;
        try { raw = root.localStorage.getItem(Model.INTENT_KEY); } catch (e) { return Promise.resolve(); }
        if (!raw) return Promise.resolve();
        var intent = Model.parseIntent(raw, Date.now());
        if (!intent) { clearIntent(); return Promise.resolve(); }
        // Sin sesión todavía (p. ej. en la página de ingreso): se conserva.
        if (!state.userId || state.available === false || state.error) return Promise.resolve();
        var item = intent.item;
        var job = isSaved(item.kind, item.id) ? Promise.resolve() : save(item, null);
        return job.then(function () {
            clearIntent();
            var list = defaultList();
            var actions = [{ label: 'Ver mis favoritos', href: appPath(FAVORITES_PATH) }];
            if (intent.returnTo && intent.returnTo !== currentPath()) {
                actions.push({ label: 'Volver a donde estabas', href: appPath(intent.returnTo) });
            }
            var listName = (list && list.name) || Model.DEFAULT_LIST_NAME;
            toast(item.label ? 'Guardamos «' + item.label + '» en «' + listName + '»' : Model.savedMessage(listName), { actions: actions, ms: 10000 });
        }).catch(function (err) {
            // Un error de red deja la intención para el próximo intento.
            if (!/failed to fetch|networkerror|load failed/i.test(String(err && err.message))) clearIntent();
            if (root.console) root.console.warn('[wo-favorites] guardado pendiente:', err && err.message);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Tocar el corazón                                                    */
    /* ------------------------------------------------------------------ */

    function undoRemoval(removed) {
        var jobs = (removed || []).map(function (it) { return save(it, it.listId); });
        Promise.all(jobs).then(function () {
            announce('Volvió a tus favoritos.');
        }).catch(function (err) { fail(err); });
    }

    function toggle(btn, item) {
        var key = Model.itemKey(item.kind, item.id);
        if (busy[key]) return;
        busy[key] = true;
        btn.setAttribute('aria-busy', 'true');
        var done = function () {
            delete busy[key];
            btn.removeAttribute('aria-busy');
        };
        settled().then(function () {
            if (state.available === false) {
                toast('Los favoritos todavía no están disponibles. Inténtalo más tarde.', { error: true });
                return null;
            }
            if (state.demo) {
                toast('En el modo demo no se guardan favoritos.');
                return null;
            }
            if (!state.userId) { openLoginPrompt(btn, item); return null; }
            if (state.error) throw state.error;
            var inLists = listIdsFor(item.kind, item.id);
            if (inLists.length > 1) { openPicker(btn, item); return null; }
            if (inLists.length === 1) {
                closePop(false);
                btn.classList.remove('is-fav');
                return remove(item, null).then(function (removed) {
                    toast('Quitado de favoritos', { actions: [{ label: 'Deshacer', run: function () { undoRemoval(removed); } }] });
                });
            }
            btn.classList.add('is-fav');   // respuesta inmediata; paintAll corrige si falla
            return save(item, null).then(function (saved) {
                var list = findList(saved.listId);
                openSavedPop(doc.contains(btn) ? btn : findButton(item), item, list && list.name);
            });
        }).catch(function (err) {
            paintAll();
            fail(err);
        }).then(done);
    }

    function onClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') return;
        var btn = target.closest(SEL);
        if (!btn) return;
        if (state.available === false) return;   // módulo apagado: decide la página
        var item = readItem(btn);
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        if (!btn.hasAttribute(ON)) activate(btn);
        toggle(btn, item);
    }

    function onKeydown(e) {
        // Elementos que no son <button>: Enter y Espacio también activan.
        var active = doc.activeElement;
        if ((e.key === 'Enter' || e.key === ' ') && active && active.tagName !== 'BUTTON'
            && typeof active.matches === 'function' && active.matches(SEL) && e.target === active) {
            var item = readItem(active);
            if (item && state.available !== false) {
                e.preventDefault();
                if (!active.hasAttribute(ON)) activate(active);
                toggle(active, item);
            }
            return;
        }
        if (!pop) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePop(true);
            return;
        }
        if (e.key !== 'Tab') return;
        var nodes = focusables(pop.el);
        if (!nodes.length) return;
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        var inside = pop.el.contains(active);
        if (!inside) {
            // Desde el corazón, Tab entra al panel.
            if (active === pop.anchor && !e.shiftKey) { e.preventDefault(); focusNode(first); }
            return;
        }
        if (e.shiftKey && active === first) {
            e.preventDefault();
            focusNode(pop.anchor && doc.contains(pop.anchor) ? pop.anchor : last);
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            focusNode(first);
        }
    }

    function onPointerDown(e) {
        if (!pop) return;
        var target = e.target;
        if (pop.el.contains(target)) return;
        if (pop.anchor && pop.anchor.contains && pop.anchor.contains(target)) return;
        if (pop.scrim && pop.scrim === target) return;   // lo cierra su propio click
        closePop(false);
    }

    /* ------------------------------------------------------------------ */
    /* Arranque                                                            */
    /* ------------------------------------------------------------------ */

    // Activa los corazones con su hoja de estilos ya cargada; la primera vez
    // que aparece uno se resuelve la sesión y se leen las listas.
    function scanNow() {
        ensureCss().then(function () {
            scan(doc);
            if (doc.querySelector(SEL + '[' + ON + ']')) ready();
        });
    }

    var scanQueued = false;
    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        var run = function () {
            scanQueued = false;
            scanNow();
        };
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run); else root.setTimeout(run, 16);
    }

    function hasCandidate(node) {
        if (!node || node.nodeType !== 1) return false;
        if (typeof node.matches === 'function' && node.matches(SEL)) return true;
        return typeof node.querySelector === 'function' && !!node.querySelector(SEL);
    }

    function observe() {
        if (typeof root.MutationObserver !== 'function') return;
        var observer = new root.MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'attributes') {
                    if (m.target && m.target.hasAttribute && m.target.hasAttribute('data-wo-favorite')) {
                        if (m.target.hasAttribute(ON)) paint(m.target); else { queueScan(); return; }
                    }
                    continue;
                }
                for (var j = 0; j < m.addedNodes.length; j++) {
                    if (hasCandidate(m.addedNodes[j])) { queueScan(); return; }
                }
            }
        });
        observer.observe(doc.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-wo-favorite', 'data-id', 'data-kind']
        });
    }

    function start() {
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('keydown', onKeydown, true);
        doc.addEventListener(root.PointerEvent ? 'pointerdown' : 'mousedown', onPointerDown, true);
        root.addEventListener('scroll', queuePlace, true);
        root.addEventListener('resize', queuePlace);
        observe();
        var hasButtons = !!doc.querySelector(SEL);
        var hasIntent = false;
        try { hasIntent = !!root.localStorage.getItem(Model.INTENT_KEY); } catch (e) { hasIntent = false; }
        if (hasButtons) scanNow();
        else if (hasIntent) ready();
    }

    var api = {
        __real: true,
        ready: ready,
        reload: reload,
        refresh: function (scope) { scan(scope || doc); paintAll(); },
        isSaved: isSaved,
        listIdsFor: listIdsFor,
        ids: function (kind) {
            var k = Model.normalizeKind(kind);
            var seen = Object.create(null);
            var out = [];
            state.items.forEach(function (it) {
                if ((!k || it.kind === k) && !seen[it.kind + ':' + it.id]) {
                    seen[it.kind + ':' + it.id] = true;
                    out.push(it.id);
                }
            });
            return out;
        },
        lists: function () {
            return state.lists.map(function (l) {
                return { id: l.id, name: l.name, isDefault: l.isDefault, sortOrder: l.sortOrder, count: listCount(l.id) };
            });
        },
        items: function (filter) {
            return Model.filterItems(state.items, filter).map(function (it) {
                return {
                    itemId: it.itemId, listId: it.listId, kind: it.kind, id: it.id, label: it.label,
                    image: it.image, url: it.url, artistId: it.artistId, createdAt: it.createdAt
                };
            });
        },
        save: save,
        remove: remove,
        removeItem: removeItem,
        moveItem: moveItem,
        openPicker: openPicker,
        ensureDefaultList: ensureDefaultList,
        createList: createList,
        renameList: renameList,
        deleteList: deleteList,
        messageFor: messageFor,
        appPath: appPath
    };
    Object.defineProperty(api, 'available', { get: function () { return state.available !== false; } });
    Object.defineProperty(api, 'loaded', { get: function () { return state.phase === 'ready'; } });
    Object.defineProperty(api, 'userId', { get: function () { return state.userId; } });

    root.WoFavorites = api;

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
})(typeof window !== 'undefined' ? window : null);
