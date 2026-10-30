/**
 * WE OTZI - Shell de las páginas públicas de la Store (/store/*)
 * --------------------------------------------------------------
 * Topbar con tres estados, toasts, diálogos con focus trap, sesión y links de
 * ingreso con returnTo, más helpers de UI que comparten vitrina, ficha,
 * checkout, compras y licencias. Estilos en shared/css/store-ds.css (.sts-*).
 *
 * Carga: después de config-manager.js, postgrest-client.js, artists-repo.js y
 * (si está) data/store-repo.js. wo-demo.js va primero en el <head>. Las
 * páginas /store/* no cargan client-auth.js (salvo el checkout).
 *
 *   WeotziStoreShell.mountStoreTopbar(root, { active })  → Promise<viewer>
 *     anónimo: Marketplace · Mapa · Cotizar · Job board · Acceder
 *     cliente: Cotizaciones · Job board · Chats · Explorar artistas ·
 *              Tattoo globe · Compras
 *     artista: Dashboard → · Mi Store · Mis compras
 *   El rol sale de auth.getSession() y de WeotziData.Artists.getByUserId
 *   (nunca CRUD inline). No usa .wo-topbar-right a propósito: así
 *   account-modes.js no monta su selector en estas páginas.
 *
 * viewer = { role: 'anon'|'client'|'artist', session, user, artist, artistReady }
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.WeotziStoreShell = api;
}(typeof window !== 'undefined' ? window : this, function (root) {
    'use strict';

    var FOCUSABLE = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'summary',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    var TOAST_MS = 4200;
    var DESKTOP_NAV_QUERY = '(min-width: 64rem)';
    var DEFAULT_RETURN = '/store/purchases/';

    /* ------------------------------------------------------------------ */
    /* Utilidades                                                          */
    /* ------------------------------------------------------------------ */

    function basePath() { return String((root && root.WEOTZI_BASE_PATH) || '').replace(/\/$/, ''); }

    // Rutas absolutas del producto respetando el base path (/beta, preview).
    function appPath(p) {
        var base = basePath();
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }
    function stripBase(path) {
        var base = basePath();
        var s = String(path || '');
        if (base && (s === base || s.indexOf(base + '/') === 0)) s = s.slice(base.length) || '/';
        return s;
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function initials(name) {
        var parts = String(name || '').trim().replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
        if (!parts.length) return 'Ö';
        var first = parts[0].charAt(0);
        var second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || '');
        return (first + second).toUpperCase();
    }

    function hydrateIcons(node) {
        try { if (root.WoIcons && typeof root.WoIcons.hydrate === 'function') root.WoIcons.hydrate(node || root.document); } catch (e) { /* íconos opcionales */ }
    }

    function model() { return root && root.WeotziStoreModel ? root.WeotziStoreModel : null; }
    function storeRepo() { return root && root.WeotziData && root.WeotziData.Store ? root.WeotziData.Store : null; }

    function whenReady() {
        var CM = root && root.ConfigManager;
        if (CM && typeof CM.ready === 'function') {
            try { return Promise.resolve(CM.ready()).then(function () {}, function () {}); } catch (e) { /* sigue */ }
        }
        return Promise.resolve();
    }

    // Cliente supabase-js autenticado (singleton de config-manager).
    function getClient() {
        var CM = root && root.ConfigManager;
        if (CM && typeof CM.getSupabaseClient === 'function') {
            try { var c = CM.getSupabaseClient(); if (c) return c; } catch (e) { /* sin config */ }
        }
        return (root && root._supabase) || null;
    }

    /* ------------------------------------------------------------------ */
    /* Sesión y rol                                                        */
    /* ------------------------------------------------------------------ */

    var viewerPromise = null;

    function resolveViewer() {
        return whenReady().then(function () {
            var client = getClient();
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return { role: 'anon', session: null, user: null, artist: null, artistReady: false };
            return client.auth.getSession().then(function (res) {
                var session = res && res.data && res.data.session;
                if (!session || !session.user) return { role: 'anon', session: null, user: null, artist: null, artistReady: false };
                var Artists = root.WeotziData && root.WeotziData.Artists;
                if (!Artists || typeof Artists.getByUserId !== 'function') {
                    return { role: 'client', session: session, user: session.user, artist: null, artistReady: false };
                }
                return Promise.resolve(Artists.getByUserId(session.user.id, 'user_id, username, name, profile_picture, registration_status'))
                    .then(function (r) { return (r && !r.error && r.data) || null; }, function () { return null; })
                    .then(function (artist) {
                        return {
                            role: artist ? 'artist' : 'client',
                            session: session,
                            user: session.user,
                            artist: artist,
                            artistReady: !!artist && artist.registration_status !== 'incompleto'
                        };
                    });
            });
        }).catch(function (err) {
            if (root.console) root.console.warn('[store-shell] No pudimos leer la sesión:', err && err.message);
            return { role: 'anon', session: null, user: null, artist: null, artistReady: false };
        });
    }

    // Promesa cacheada: la topbar y la página comparten la misma consulta.
    function viewer(opts) {
        if (!viewerPromise || (opts && opts.refresh)) viewerPromise = resolveViewer();
        return viewerPromise;
    }

    // Devuelve la sesión o null. Con { redirect: true } y sin sesión, manda al
    // login de cliente con returnTo.
    function requireSession(opts) {
        opts = opts || {};
        return viewer().then(function (v) {
            if (v.session) return v.session;
            if (opts.redirect && root.location) root.location.href = loginLinks(opts.returnTo).client;
            return null;
        });
    }

    function logout() {
        var client = getClient();
        var done = function () { viewerPromise = null; if (root.location) root.location.reload(); };
        if (!client || !client.auth || typeof client.auth.signOut !== 'function') { done(); return Promise.resolve(); }
        return Promise.resolve(client.auth.signOut()).then(done, done);
    }

    /* ------------------------------ returnTo ------------------------------ */

    // Mismo criterio que normalizeReturnTo de client-auth.js: solo paths del
    // mismo origen bajo /store/. Se manda sin base path (el login lo agrega).
    function normalizeReturnTo(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return null;
        var origin = (root.location && root.location.origin) || 'http://localhost';
        var URLApi = root.URL || (typeof URL !== 'undefined' ? URL : null);
        if (!URLApi) return null;
        try {
            var u = new URLApi(s, origin + '/');
            if (u.origin !== origin) return null;
            s = u.pathname + u.search + u.hash;
        } catch (e) { return null; }
        s = stripBase(s).replace(/^\/store(?=$|[?#])/, '/store/');
        return s.indexOf('/store/') === 0 ? s : null;
    }

    function currentReturnTo() {
        var loc = root.location;
        return loc ? stripBase(loc.pathname) + (loc.search || '') : DEFAULT_RETURN;
    }

    // { returnTo, client, register, artist } con el base path aplicado.
    function loginLinks(returnTo) {
        var rt = normalizeReturnTo(returnTo == null ? currentReturnTo() : returnTo) || DEFAULT_RETURN;
        var q = '?returnTo=' + encodeURIComponent(rt);
        return {
            returnTo: rt,
            client: appPath('/client/login') + q,
            register: appPath('/client/register') + q,
            artist: appPath('/artist/login') + q
        };
    }

    /* ------------------------------------------------------------------ */
    /* Topbar                                                              */
    /* ------------------------------------------------------------------ */

    function navItems(role) {
        if (role === 'artist') {
            return [
                { key: 'dashboard', label: 'Dashboard →', href: '/artist/dashboard' },
                { key: 'my-store', label: 'Mi Store', href: '/artist/store/' },
                { key: 'purchases', label: 'Mis compras', href: '/store/purchases/' }
            ];
        }
        if (role === 'client') {
            return [
                { key: 'quotations', label: 'Cotizaciones', href: '/client/dashboard' },
                { key: 'job-board', label: 'Job board', href: '/job-board' },
                { key: 'chats', label: 'Chats', href: '/client/chats' },
                { key: 'marketplace', label: 'Explorar artistas', href: '/marketplace' },
                { key: 'explore', label: 'Tattoo globe', href: '/explore' },
                { key: 'purchases', label: 'Compras', href: '/store/purchases/' }
            ];
        }
        if (role === 'anon') {
            return [
                { key: 'marketplace', label: 'Marketplace', href: '/marketplace' },
                { key: 'explore', label: 'Mapa', href: '/explore' },
                { key: 'quotation', label: 'Cotizar', href: '/quotation' },
                { key: 'job-board', label: 'Job board', href: '/job-board' },
                { key: 'login', label: 'Acceder', href: loginLinks().client, raw: true }
            ];
        }
        return [];
    }

    function itemHtml(item, active, cls) {
        var href = item.raw ? item.href : appPath(item.href);
        var isActive = item.key === active;
        return '<a class="' + cls + (isActive ? ' is-active' : '') + '" href="' + esc(href) + '"' +
            (isActive ? ' aria-current="page"' : '') + ' data-sts-nav="' + esc(item.key) + '">' + esc(item.label) + '</a>';
    }

    function topbarHtml(state, v, opts) {
        var items = navItems(state);
        var active = opts.active || null;
        var nav = items.map(function (i) { return itemHtml(i, active, 'wo-topbar-item'); }).join('');
        var mobile = items.map(function (i) { return itemHtml(i, active, 'sts-mobile-menu-link'); }).join('');
        var right = '';
        if (state === 'client' || state === 'artist') {
            var meta = (v.user && v.user.user_metadata) || {};
            var name = state === 'artist' && v.artist ? (v.artist.name || v.artist.username) : (meta.full_name || meta.name || (v.user && v.user.email) || '');
            var home = state === 'artist' ? '/artist/dashboard' : '/client/dashboard';
            var tileLabel = state === 'artist' ? 'Ir a tu dashboard' : 'Ir al centro de cuenta';
            right += '<a class="sts-profile-tile" href="' + esc(appPath(home)) + '" title="' + esc(tileLabel) + '" aria-label="' + esc(tileLabel) + '">' + esc(initials(name)) + '</a>';
            right += '<button class="wo-btn wo-btn--danger wo-btn--s wo-btn--mono sts-logout" type="button" data-sts-logout>Log out</button>';
            mobile += '<button class="sts-mobile-menu-link sts-mobile-menu-logout" type="button" data-sts-logout>Log out</button>';
        }
        var toggle = state === 'pending' ? '' :
            '<button class="wo-iconbtn wo-iconbtn--s sts-menu-toggle" type="button" aria-expanded="false" aria-controls="sts-mobile-menu" aria-label="Abrir menú">' +
            '<i data-wo-icon="menu" class="wo-icon-18" aria-hidden="true"></i></button>';
        return '' +
            '<header class="wo-topbar sts-topbar" data-sts-role="' + esc(state) + '"' + (state === 'pending' ? ' aria-busy="true"' : '') + '>' +
                '<div class="wo-topbar-left sts-topbar-left">' +
                    '<a class="wo-topbar-brand sts-topbar-brand" href="' + esc(appPath('/')) + '"><span class="wo-o-tile" aria-hidden="true">Ö</span>WE ÖTZI</a>' +
                    (nav ? '<nav class="wo-topbar-nav sts-topbar-nav" aria-label="Navegación principal">' + nav + '</nav>' : '') +
                '</div>' +
                '<div class="sts-topbar-right">' + right + toggle + '</div>' +
            '</header>' +
            (mobile ? '<nav class="sts-mobile-menu" id="sts-mobile-menu" aria-label="Navegación móvil" hidden>' + mobile + '</nav>' : '');
    }

    function setMenuOpen(host, open) {
        var menu = host.querySelector('.sts-mobile-menu');
        var toggle = host.querySelector('.sts-menu-toggle');
        if (!menu || !toggle) return;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    }

    function wireTopbar(host) {
        if (host.getAttribute('data-sts-wired') === '1') return;
        host.setAttribute('data-sts-wired', '1');
        host.addEventListener('click', function (e) {
            var target = e.target && e.target.closest ? e.target : null;
            if (!target) return;
            if (target.closest('[data-sts-logout]')) { e.preventDefault(); logout(); return; }
            if (target.closest('.sts-menu-toggle')) {
                var menu = host.querySelector('.sts-mobile-menu');
                setMenuOpen(host, !!(menu && menu.hidden));
                return;
            }
            if (target.closest('.sts-mobile-menu a')) setMenuOpen(host, false);
        });
        host.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var menu = host.querySelector('.sts-mobile-menu');
            if (menu && !menu.hidden) {
                setMenuOpen(host, false);
                var toggle = host.querySelector('.sts-menu-toggle');
                if (toggle) toggle.focus();
            }
        });
        if (typeof root.matchMedia === 'function') {
            var mq = root.matchMedia(DESKTOP_NAV_QUERY);
            var onChange = function () { if (mq.matches) setMenuOpen(host, false); };
            if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
            else if (typeof mq.addListener === 'function') mq.addListener(onChange);
        }
    }

    function resolveHost(target) {
        var doc = root.document;
        var el = typeof target === 'string' ? (doc.getElementById(target) || doc.querySelector(target)) : target;
        if (el) return el;
        el = doc.createElement('div');
        el.id = 'sts-topbar-root';
        doc.body.insertBefore(el, doc.body.firstChild);
        return el;
    }

    // Pinta la marca enseguida (sin nav, para no mostrar el estado anónimo a
    // quien tiene sesión) y completa la barra cuando se resuelve el rol.
    function mountStoreTopbar(target, opts) {
        opts = opts || {};
        var host = resolveHost(target);
        if (!host.classList.contains('sts-topbar-root')) host.classList.add('sts-topbar-root');
        wireTopbar(host);
        host.innerHTML = topbarHtml('pending', {}, opts);
        return viewer().then(function (v) {
            host.innerHTML = topbarHtml(v.role, v, opts);
            host.setAttribute('data-sts-role', v.role);
            hydrateIcons(host);
            return v;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Toasts                                                              */
    /* ------------------------------------------------------------------ */

    // Aviso breve. tone: info | success | error (los errores se anuncian con
    // role=alert). Devuelve el nodo del toast.
    function notify(message, tone, opts) {
        var doc = root.document;
        var kind = tone === 'error' || tone === 'success' ? tone : 'info';
        var toast = doc.querySelector('.sts-toast');
        if (!toast) {
            toast = doc.createElement('div');
            toast.className = 'sts-toast';
            toast.hidden = true;
            doc.body.appendChild(toast);
        }
        toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
        toast.className = 'sts-toast is-' + kind;
        toast.textContent = String(message == null ? '' : message);
        toast.hidden = false;
        clearTimeout(toast._stsTimer);
        toast._stsTimer = setTimeout(function () { toast.hidden = true; }, (opts && opts.duration) || TOAST_MS);
        return toast;
    }

    // Traduce un error store:* con WeotziStoreModel y lo muestra.
    function errorMessage(err, fallback) {
        var M = model();
        if (M && typeof M.errorMessage === 'function') return M.errorMessage(err, fallback);
        return fallback || 'No pudimos completar la acción. Probá de nuevo en unos minutos.';
    }
    function notifyError(err, fallback) { return notify(errorMessage(err, fallback), 'error'); }

    /* ------------------------------------------------------------------ */
    /* Diálogos                                                            */
    /* ------------------------------------------------------------------ */
    // Markup esperado (el overlay arranca con `hidden`):
    //   <div class="sts-overlay" id="x" hidden>
    //     <div class="sts-dialog" role="dialog" aria-modal="true" aria-labelledby="x-title" tabindex="-1">
    //       <h2 class="sts-dialog-title" id="x-title">…</h2> … <button data-sts-close>…</button>
    //     </div>
    //   </div>

    var stack = [];
    var keysWired = false;

    function resolveOverlay(target) {
        var doc = root.document;
        var el = typeof target === 'string' ? (doc.getElementById(target) || doc.querySelector(target)) : target;
        if (!el) return null;
        if (el.classList && el.classList.contains('sts-overlay')) return el;
        return (el.closest && el.closest('.sts-overlay')) || el;
    }
    function dialogOf(overlay) {
        if (overlay.matches && overlay.matches('[role="dialog"],[role="alertdialog"]')) return overlay;
        return overlay.querySelector('[role="dialog"],[role="alertdialog"]') || overlay;
    }
    function indexOf(overlay) {
        for (var i = stack.length - 1; i >= 0; i--) if (stack[i].overlay === overlay) return i;
        return -1;
    }
    function visibleFocusables(dialog) {
        return Array.prototype.slice.call(dialog.querySelectorAll(FOCUSABLE)).filter(function (el) {
            return el.getClientRects().length > 0 && !el.closest('[hidden]');
        });
    }

    function wireKeys() {
        if (keysWired) return;
        keysWired = true;
        root.document.addEventListener('keydown', function (e) {
            if (!stack.length) return;
            var top = stack[stack.length - 1];
            if (top.overlay.hidden) return;
            if (e.key === 'Escape') {
                if (top.overlay.hasAttribute('data-sts-static')) return;
                e.preventDefault();
                closeDialog(top.overlay, { reason: 'escape' });
                return;
            }
            if (e.key !== 'Tab') return;
            var dialog = dialogOf(top.overlay);
            var items = visibleFocusables(dialog);
            if (!items.length) { e.preventDefault(); dialog.focus(); return; }
            var first = items[0];
            var last = items[items.length - 1];
            var activeEl = root.document.activeElement;
            if (e.shiftKey && (activeEl === first || activeEl === dialog || !dialog.contains(activeEl))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (activeEl === last || !dialog.contains(activeEl))) {
                e.preventDefault();
                first.focus();
            }
        });
    }

    function wireOverlay(overlay) {
        if (overlay.getAttribute('data-sts-wired') === '1') return;
        overlay.setAttribute('data-sts-wired', '1');
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay && !overlay.hasAttribute('data-sts-static')) closeDialog(overlay, { reason: 'backdrop' });
        });
        overlay.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-sts-close]') : null;
            if (btn && overlay.contains(btn)) { e.preventDefault(); closeDialog(overlay, { reason: 'close' }); }
        });
    }

    // Abre un overlay (id, selector o nodo). opts: { initialFocus, onClose }.
    // El foco va al diálogo (o a initialFocus) y vuelve al disparador al cerrar.
    function openDialog(target, opts) {
        opts = opts || {};
        var overlay = resolveOverlay(target);
        if (!overlay) return null;
        wireKeys();
        wireOverlay(overlay);
        var doc = root.document;
        if (indexOf(overlay) === -1) {
            stack.push({
                overlay: overlay,
                returnFocus: doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null,
                onClose: opts.onClose || null
            });
        }
        overlay.hidden = false;
        doc.body.classList.add('sts-dialog-open');
        var dialog = dialogOf(overlay);
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        if (!dialog.hasAttribute('aria-modal')) dialog.setAttribute('aria-modal', 'true');
        hydrateIcons(overlay);
        var focus = function () {
            var initial = typeof opts.initialFocus === 'string' ? overlay.querySelector(opts.initialFocus) : opts.initialFocus;
            try { (initial || dialog).focus({ preventScroll: true }); } catch (e) { (initial || dialog).focus(); }
        };
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(focus); else focus();
        return overlay;
    }

    // Cierra el overlay indicado o el de arriba. opts: { reason, restoreFocus }.
    function closeDialog(target, opts) {
        opts = opts || {};
        var overlay = target ? resolveOverlay(target) : (stack.length ? stack[stack.length - 1].overlay : null);
        if (!overlay) return false;
        var i = indexOf(overlay);
        var entry = i === -1 ? null : stack.splice(i, 1)[0];
        if (overlay.hidden && !entry) return false;
        overlay.hidden = true;
        if (!stack.length) root.document.body.classList.remove('sts-dialog-open');
        if (entry && entry.onClose) { try { entry.onClose(opts.reason || 'close'); } catch (e) { /* callback de página */ } }
        var back = entry && entry.returnFocus;
        if (opts.restoreFocus !== false && back && back.isConnected && typeof back.focus === 'function') {
            if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(function () { back.focus(); }); else back.focus();
        }
        return true;
    }

    // Confirmación genérica armada al vuelo. opts: { title, message,
    // confirmLabel, cancelLabel, tone: 'primary'|'danger', input: { label,
    // placeholder, maxLength, required, multiline } }.
    // Resuelve { confirmed, value } (value = texto del input o null).
    var dialogSeq = 0;
    function confirmDialog(opts) {
        opts = opts || {};
        var doc = root.document;
        var id = 'sts-confirm-' + (++dialogSeq);
        var input = opts.input || null;
        var field = '';
        if (input) {
            var tag = input.multiline ? 'textarea' : 'input';
            field = '<div class="wo-field sts-dialog-field">' +
                '<label class="wo-label" for="' + id + '-input">' + esc(input.label || '') + '</label>' +
                '<' + tag + ' class="' + (input.multiline ? 'wo-textarea' : 'wo-input') + '" id="' + id + '-input"' +
                (input.multiline ? '' : ' type="text"') +
                (input.maxLength ? ' maxlength="' + Number(input.maxLength) + '"' : '') +
                (input.placeholder ? ' placeholder="' + esc(input.placeholder) + '"' : '') + '>' +
                (input.multiline ? '</textarea>' : '') +
                '<p class="wo-error-msg" id="' + id + '-error" hidden></p></div>';
        }
        var overlay = doc.createElement('div');
        overlay.className = 'sts-overlay';
        overlay.id = id;
        overlay.hidden = true;
        overlay.innerHTML = '<div class="sts-dialog" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title"' +
            (opts.message ? ' aria-describedby="' + id + '-msg"' : '') + ' tabindex="-1">' +
            '<div class="sts-dialog-head"><h2 class="sts-dialog-title" id="' + id + '-title">' + esc(opts.title || 'Confirmá la acción') + '</h2>' +
            '<button class="sts-dialog-close" type="button" data-sts-close aria-label="Cerrar"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i></button></div>' +
            '<div class="sts-dialog-body">' + (opts.message ? '<p class="sts-dialog-text" id="' + id + '-msg">' + esc(opts.message) + '</p>' : '') + field + '</div>' +
            '<div class="sts-dialog-actions">' +
            '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-sts-close>' + esc(opts.cancelLabel || 'Volver') + '</button>' +
            '<button class="wo-btn wo-btn--s ' + (opts.tone === 'danger' ? 'wo-btn--danger' : '') + '" type="button" data-sts-confirm>' + esc(opts.confirmLabel || 'Confirmar') + '</button>' +
            '</div></div>';
        doc.body.appendChild(overlay);
        return new Promise(function (resolve) {
            var settled = false;
            var finish = function (confirmed, value) {
                if (settled) return;
                settled = true;
                resolve({ confirmed: confirmed, value: value });
                setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 0);
            };
            overlay.querySelector('[data-sts-confirm]').addEventListener('click', function () {
                var value = null;
                if (input) {
                    var el = overlay.querySelector('#' + id + '-input');
                    value = String(el.value || '').trim();
                    var err = overlay.querySelector('#' + id + '-error');
                    if (input.required && !value) {
                        err.textContent = input.requiredMessage || 'Completá este campo.';
                        err.hidden = false;
                        el.classList.add('wo-input--error');
                        el.setAttribute('aria-invalid', 'true');
                        el.setAttribute('aria-describedby', id + '-error');
                        el.focus();
                        return;
                    }
                }
                // Primero se resuelve: closeDialog dispara onClose (= cancelar).
                finish(true, value);
                closeDialog(overlay, { reason: 'confirm' });
            });
            openDialog(overlay, {
                initialFocus: input ? '#' + id + '-input' : null,
                onClose: function () { finish(false, null); }
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Helpers de página                                                   */
    /* ------------------------------------------------------------------ */

    // URL de una vista previa. data:/blob: tal cual; el resto lo resuelve el
    // repo (WeotziData.Store.previewUrl: demo/ → asset de demo, si no Storage
    // público). Sin repo, solo se resuelven los demo/.
    function previewUrl(path) {
        var p = String(path == null ? '' : path).trim();
        if (!p) return '';
        if (/^(data:image\/|blob:)/i.test(p)) return p;
        var Store = storeRepo();
        if (Store && typeof Store.previewUrl === 'function') {
            try { return Store.previewUrl(p) || ''; } catch (e) { return ''; }
        }
        if (p.indexOf('demo/') === 0) return appPath('/shared/assets/' + p);
        return '';
    }

    // <img> listo para insertar (o un placeholder si no hay imagen).
    // opts: { alt, className, loading, width, height }.
    function previewImg(path, opts) {
        opts = opts || {};
        var src = previewUrl(path);
        var cls = opts.className ? ' ' + esc(opts.className) : '';
        if (!src) {
            return '<span class="sts-media-ph' + cls + '" role="img" aria-label="' + esc(opts.alt || 'Sin imagen') + '">' +
                '<i data-wo-icon="image" aria-hidden="true"></i></span>';
        }
        return '<img class="sts-img' + cls + '" src="' + esc(src) + '" alt="' + esc(opts.alt || '') + '"' +
            (opts.width ? ' width="' + Number(opts.width) + '"' : '') +
            (opts.height ? ' height="' + Number(opts.height) + '"' : '') +
            ' loading="' + (opts.loading === 'eager' ? 'eager' : 'lazy') + '" decoding="async">';
    }

    // Estado vacío del DS. opts: { title, text, actionLabel, actionHref, icon }.
    function emptyState(opts) {
        opts = opts || {};
        return '<div class="sts-empty">' +
            (opts.icon ? '<i data-wo-icon="' + esc(opts.icon) + '" class="sts-empty-icon" aria-hidden="true"></i>' : '') +
            (opts.title ? '<p class="sts-empty-title">' + esc(opts.title) + '</p>' : '') +
            (opts.text ? '<p class="sts-empty-text">' + esc(opts.text) + '</p>' : '') +
            (opts.actionLabel && opts.actionHref ? '<a class="wo-btn wo-btn--ghost wo-btn--s wo-btn--hard" href="' + esc(appPath(opts.actionHref)) + '">' + esc(opts.actionLabel) + '</a>' : '') +
            '</div>';
    }

    // n cards esqueleto para la grilla mientras carga.
    function skeletonCards(n) {
        var out = '';
        for (var i = 0; i < (n || 6); i++) {
            out += '<div class="sts-card sts-card--skeleton" aria-hidden="true">' +
                '<div class="sts-card-media wo-skeleton"></div>' +
                '<div class="sts-card-body"><span class="wo-skeleton sts-skel-line"></span><span class="wo-skeleton sts-skel-line sts-skel-line--short"></span></div>' +
                '</div>';
        }
        return out;
    }

    // Deshabilita un botón mientras corre una acción (sin perder su texto).
    function setBusy(button, busy, busyLabel) {
        if (!button) return;
        if (busy) {
            if (button.getAttribute('data-sts-label') == null) button.setAttribute('data-sts-label', button.textContent);
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            if (busyLabel) button.textContent = busyLabel;
        } else {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            var label = button.getAttribute('data-sts-label');
            if (label != null) { button.textContent = label; button.removeAttribute('data-sts-label'); }
        }
    }

    function param(name) {
        try { return new root.URLSearchParams(root.location.search).get(name); } catch (e) { return null; }
    }

    // Actualiza la query sin recargar (null o '' borra el parámetro).
    function setParams(values, opts) {
        try {
            var url = new root.URL(root.location.href);
            Object.keys(values || {}).forEach(function (k) {
                var v = values[k];
                if (v === null || v === undefined || v === '') url.searchParams.delete(k);
                else url.searchParams.set(k, String(v));
            });
            var next = url.pathname + url.search + url.hash;
            if (opts && opts.push) root.history.pushState(null, '', next);
            else root.history.replaceState(null, '', next);
        } catch (e) { /* history no disponible */ }
    }

    // <meta name="robots">: respeta allow_search_indexing del vendedor.
    function setRobots(allowIndexing) {
        var doc = root.document;
        var meta = doc.querySelector('meta[name="robots"]');
        if (!meta) {
            meta = doc.createElement('meta');
            meta.setAttribute('name', 'robots');
            doc.head.appendChild(meta);
        }
        meta.setAttribute('content', allowIndexing === true ? 'index, follow' : 'noindex, nofollow');
    }

    function setTitle(title) {
        root.document.title = title ? String(title) + ' · Store · We Ötzi' : 'Store · We Ötzi';
    }

    // Gate común de la §8.5: feature activa y tablas desplegadas.
    function isStoreEnabled() {
        var Store = storeRepo();
        if (!Store || typeof Store.featureEnabled !== 'function' || typeof Store.isAvailable !== 'function') return Promise.resolve(false);
        return whenReady().then(function () {
            if (!Store.featureEnabled()) return false;
            return Promise.resolve(Store.isAvailable()).then(function (ok) { return ok === true; }, function () { return false; });
        });
    }

    return {
        FOCUSABLE: FOCUSABLE,
        appPath: appPath,
        stripBase: stripBase,
        esc: esc,
        initials: initials,
        hydrateIcons: hydrateIcons,
        whenReady: whenReady,
        getClient: getClient,
        viewer: viewer,
        requireSession: requireSession,
        logout: logout,
        normalizeReturnTo: normalizeReturnTo,
        loginLinks: loginLinks,
        mountStoreTopbar: mountStoreTopbar,
        notify: notify,
        notifyError: notifyError,
        errorMessage: errorMessage,
        openDialog: openDialog,
        closeDialog: closeDialog,
        confirmDialog: confirmDialog,
        previewUrl: previewUrl,
        previewImg: previewImg,
        emptyState: emptyState,
        skeletonCards: skeletonCards,
        setBusy: setBusy,
        param: param,
        setParams: setParams,
        setRobots: setRobots,
        setTitle: setTitle,
        isStoreEnabled: isStoreEnabled
    };
}));
