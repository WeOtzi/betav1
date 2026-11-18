/*
 * We Ötzi · Gate de Términos y bloqueo de cuentas sancionadas (2.7.0).
 *
 * window.WoTermsGate.ensure(session, { surface }) consulta
 * GET /api/account/terms-status con el Bearer de la sesión y:
 *   - blocked (alta que coincide con una cuenta baneada) o sanción 'ban' →
 *     cierra la sesión y muestra un modal que no se puede cerrar;
 *   - sanción 'suspension' → aviso arriba de la página (se puede cerrar);
 *   - Términos sin aceptar → modal bloqueante «Actualizamos los Términos…»
 *     con casilla obligatoria, «Aceptar y continuar» (POST
 *     /api/account/terms-accept) y «Cerrar sesión».
 * La aceptación se guarda por pestaña en sessionStorage (clave con versión y
 * usuario) para no volver a consultar en cada página.
 *
 * Carga: lo inyectan wo-consent.js (si hay una sesión de Supabase en
 * localStorage y la página no es de soporte ni del backoffice) y
 * artist-auth.js / client-auth.js / studio-auth.js al resolver la sesión. Al
 * cargarse, se ejecuta solo con la sesión guardada y vacía la cola
 * window.__woTermsGateQueue que dejan los módulos de auth.
 *
 * El bloque factory es puro (sin DOM) y se testea con node:test.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.WoTermsGate) {
        api.boot(window, document);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Igual que lib/terms-acceptance.js TERMS_VERSION (tests/terms-gate.test.js lo compara).
    var TERMS_VERSION = '2026-11-18';
    var CACHE_PREFIX = 'wo_terms_gate:';
    var SURFACES = ['artist', 'client', 'studio', 'gate'];
    // Páginas donde el gate no corre: soporte, backoffice y los textos legales
    // (tienen que poder leerse con el modal pendiente).
    var EXCLUDED_PREFIXES = ['/support', '/backoffice', '/legal', '/seguridad', '/apelacion'];
    // Login, registro y recuperación: tienen su propia casilla de Términos y
    // redirigen enseguida. Ahí solo se revisa el bloqueo; el modal de
    // aceptación aparece en la página siguiente.
    var DEFER_ACCEPT_PREFIXES = ['/register-artist', '/registerclosedbeta', '/client/register', '/client/login',
        '/studio/register', '/studio/login', '/artist/login', '/recover'];

    var BAN_MESSAGE = 'Tu cuenta fue dada de baja por incumplir los Términos. Revisa el correo que te enviamos para conocer el motivo y cómo apelar.';
    var BLOCKED_MESSAGE = 'No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.';

    var SUMMARY = [
        { title: 'Identidad', text: 'una persona tiene una sola cuenta de artista y nadie puede hacerse pasar por otra persona o estudio.' },
        { title: 'Tu obra', text: 'solo publicas trabajos tuyos o con permiso de su autor.' },
        { title: 'Sanciones', text: 'según la gravedad, advertencia, suspensión o cierre permanente de la cuenta, con bloqueo para volver a registrarse.' },
        { title: 'Apelación', text: 'puedes responder a una denuncia y apelar una sanción. Denunciar de mala fe también se sanciona.' }
    ];

    // ── lógica pura ─────────────────────────────────────────────────────

    function normalizeSurface(value) {
        var v = String(value || '').toLowerCase();
        return SURFACES.indexOf(v) >= 0 ? v : 'gate';
    }

    function cacheKey(version, userId) {
        return CACHE_PREFIX + String(version || TERMS_VERSION) + ':' + String(userId || '');
    }

    function stripBase(pathname, basePath) {
        var p = String(pathname || '/');
        var base = String(basePath || '').replace(/\/$/, '');
        if (base && (p === base || p.indexOf(base + '/') === 0)) p = p.slice(base.length) || '/';
        return p;
    }

    function matchesPrefix(prefixes, pathname, basePath) {
        var p = stripBase(pathname, basePath);
        return prefixes.some(function (prefix) {
            return p === prefix || p.indexOf(prefix + '/') === 0;
        });
    }

    function isExcludedPath(pathname, basePath) {
        return matchesPrefix(EXCLUDED_PREFIXES, pathname, basePath);
    }

    function defersAccept(pathname, basePath) {
        return matchesPrefix(DEFER_ACCEPT_PREFIXES, pathname, basePath);
    }

    /**
     * Qué hacer con la respuesta de terms-status:
     *   'blocked' | 'banned' | 'needs_accept' | 'suspended' | 'ok' | 'unknown'
     * Una suspensión con los Términos sin aceptar pide primero la aceptación
     * (el aviso se muestra después).
     */
    function decide(status) {
        if (!status || status.success !== true) return 'unknown';
        if (status.blocked === true) return 'blocked';
        var kind = status.sanction && status.sanction.kind;
        if (kind === 'ban') return 'banned';
        if (status.accepted !== true) return 'needs_accept';
        if (kind === 'suspension') return 'suspended';
        return 'ok';
    }

    function formatDate(iso) {
        var t = Date.parse(iso || '');
        if (!isFinite(t)) return '';
        try {
            return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
        } catch (_) {
            return new Date(t).toISOString().slice(0, 10);
        }
    }

    function suspensionText(sanction) {
        var until = formatDate(sanction && sanction.ends_at);
        return until
            ? 'Tu perfil está suspendido hasta el ' + until + '; mientras tanto no aparece en búsquedas.'
            : 'Tu perfil está suspendido; mientras tanto no aparece en búsquedas.';
    }

    // Auth rechaza la cuenta: user_banned al iniciar sesión o al consultar.
    function isBannedAuthError(error) {
        if (!error) return false;
        if (error.code === 'user_banned' || error.error_code === 'user_banned') return true;
        return /\bbanned\b/i.test(String(error.message || error.msg || ''));
    }

    /**
     * terms-status respondió 401 con una sesión guardada. Con el error de
     * auth.getUser() de Supabase decide: 'banned' (Auth dice user_banned),
     * 'invalid' (sesión revocada, usuario borrado o token inválido: la sesión
     * local ya no sirve) o 'unknown' (Supabase acepta la sesión o el error es
     * de red: no se toca nada).
     */
    function classifyRejectedSession(error) {
        if (!error) return 'unknown';
        if (isBannedAuthError(error)) return 'banned';
        var code = String(error.code || error.error_code || '');
        if (['session_not_found', 'user_not_found', 'bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used'].indexOf(code) >= 0) return 'invalid';
        if (error.name === 'AuthSessionMissingError') return 'invalid';
        if (error.status === 401 || error.status === 403) return 'invalid';
        return 'unknown';
    }

    function sessionFromStorageValue(raw) {
        if (!raw) return null;
        var data = raw;
        if (typeof raw === 'string') {
            try { data = JSON.parse(raw); } catch (_) { return null; }
        }
        var s = data && (data.access_token ? data : data.currentSession);
        if (!s || !s.access_token) return null;
        if (s.expires_at && s.expires_at * 1000 <= Date.now()) return null;
        return { access_token: s.access_token, user: s.user || null };
    }

    // ── navegador ───────────────────────────────────────────────────────

    function boot(win, doc) {
        var scriptSrc = (doc.currentScript && doc.currentScript.src) || '';
        var state = { inflight: null, surface: 'gate', supabase: null, userId: null, modal: null, banner: null, lastFocus: null, inerted: [] };

        function basePath() {
            if (win.WEOTZI_BASE_PATH) return String(win.WEOTZI_BASE_PATH).replace(/\/$/, '');
            var p = (win.location && win.location.pathname) || '';
            return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
        }
        function appUrl(path) { return basePath() + path; }

        function readCache(key) {
            try { return win.sessionStorage.getItem(key) === '1'; } catch (_) { return false; }
        }
        function writeCache(key) {
            try { win.sessionStorage.setItem(key, '1'); } catch (_) { /* sin sessionStorage: se vuelve a consultar */ }
        }

        function storedSession() {
            try {
                for (var i = 0; i < win.localStorage.length; i++) {
                    var key = win.localStorage.key(i);
                    if (!/^sb-[a-z0-9]+-auth-token$/.test(key || '')) continue;
                    var s = sessionFromStorageValue(win.localStorage.getItem(key));
                    if (s) return s;
                }
            } catch (_) { /* sin sesión legible */ }
            return null;
        }

        function clearStoredSessions() {
            try {
                var keys = [];
                for (var i = 0; i < win.localStorage.length; i++) {
                    var key = win.localStorage.key(i);
                    if (/^sb-[a-z0-9]+-auth-token$/.test(key || '')) keys.push(key);
                }
                keys.forEach(function (k) { win.localStorage.removeItem(k); });
            } catch (_) { /* noop */ }
        }

        function supabaseClient() {
            if (state.supabase && state.supabase.auth) return state.supabase;
            try {
                if (win._supabase && win._supabase.auth) return win._supabase;
                if (win.WeOtziStudioAuth && typeof win.WeOtziStudioAuth.getSupabase === 'function') {
                    var c = win.WeOtziStudioAuth.getSupabase();
                    if (c && c.auth) return c;
                }
                if (win.ConfigManager && typeof win.ConfigManager.getSupabaseClient === 'function') {
                    var cm = win.ConfigManager.getSupabaseClient();
                    if (cm && cm.auth) return cm;
                }
            } catch (_) { /* sin cliente */ }
            return null;
        }

        function signOut() {
            var client = supabaseClient();
            var done = Promise.resolve();
            if (client) {
                try {
                    done = Promise.resolve(client.auth.signOut()).catch(function () { /* la sesión local se borra igual */ });
                } catch (_) { /* noop */ }
            }
            return done.then(clearStoredSessions);
        }

        function ensureCss() {
            if (doc.querySelector('link[data-wo-terms-gate-css]')) return;
            var href = scriptSrc ? scriptSrc.replace(/js\/wo-terms-gate\.js(\?.*)?$/, 'css/wo-terms-gate.css') : appUrl('/shared/css/wo-terms-gate.css');
            var link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-wo-terms-gate-css', '');
            (doc.head || doc.documentElement).appendChild(link);
        }

        function el(tag, attrs, children) {
            var node = doc.createElement(tag);
            Object.keys(attrs || {}).forEach(function (k) {
                if (attrs[k] == null || attrs[k] === false) return;
                if (k === 'text') node.textContent = attrs[k];
                else if (k === 'className') node.className = attrs[k];
                else node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
            });
            (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
            return node;
        }

        function fetchJson(url, opts) {
            return win.fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}))
                .then(function (r) {
                    return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, ok: r.ok, body: body || {} }; });
                });
        }

        // ── modal accesible (foco atrapado, fondo inerte, sin Escape) ──
        function setBackgroundInert(on) {
            if (on) {
                state.inerted = [];
                Array.prototype.forEach.call(doc.body.children, function (child) {
                    if (child === state.modal || child.hasAttribute('inert')) return;
                    child.setAttribute('inert', '');
                    child.setAttribute('aria-hidden', 'true');
                    state.inerted.push(child);
                });
            } else {
                state.inerted.forEach(function (child) {
                    child.removeAttribute('inert');
                    child.removeAttribute('aria-hidden');
                });
                state.inerted = [];
            }
        }

        function focusables(container) {
            return Array.prototype.filter.call(
                container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
                function (node) { return node.offsetParent !== null || node === doc.activeElement; }
            );
        }

        function onKeydown(event) {
            if (!state.modal) return;
            if (event.key === 'Escape') { event.preventDefault(); return; }
            if (event.key !== 'Tab') return;
            var items = focusables(state.modal);
            if (!items.length) { event.preventDefault(); return; }
            var first = items[0];
            var last = items[items.length - 1];
            if (event.shiftKey && (doc.activeElement === first || !state.modal.contains(doc.activeElement))) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (doc.activeElement === last || !state.modal.contains(doc.activeElement))) {
                event.preventDefault(); first.focus();
            }
        }

        function openModal(panel, labelledBy, describedBy) {
            closeModal();
            ensureCss();
            state.lastFocus = doc.activeElement;
            state.modal = el('div', { className: 'wo-terms-gate', 'data-wo-terms-gate': '' }, [panel]);
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', labelledBy);
            if (describedBy) panel.setAttribute('aria-describedby', describedBy);
            panel.setAttribute('tabindex', '-1');
            doc.body.appendChild(state.modal);
            setBackgroundInert(true);
            doc.addEventListener('keydown', onKeydown, true);
            var items = focusables(panel);
            (items[0] || panel).focus();
        }

        function closeModal() {
            if (!state.modal) return;
            doc.removeEventListener('keydown', onKeydown, true);
            setBackgroundInert(false);
            if (state.modal.parentNode) state.modal.parentNode.removeChild(state.modal);
            state.modal = null;
            if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
                try { state.lastFocus.focus(); } catch (_) { /* noop */ }
            }
        }

        function goHome() { win.location.href = appUrl('/'); }

        // terms-status respondió 401: la sesión guardada ya no vale para el
        // servidor (típico de una baja: blockNewAccount / applySanction
        // revocan las sesiones y banean en Auth). Se confirma con Supabase y,
        // si de verdad no vale, se cierra la sesión local y se recarga para
        // que la página deje de actuar con sesión. Al volver a entrar, el
        // login muestra el mensaje de la baja (user_banned).
        function handleRejectedSession() {
            var client = supabaseClient();
            if (!client || !client.auth || typeof client.auth.getUser !== 'function') return Promise.resolve({ status: 'unknown' });
            return Promise.resolve(client.auth.getUser()).then(function (res) {
                var verdict = classifyRejectedSession(res && res.error);
                if (verdict === 'banned') return whenBody().then(function () { return showBlocked(BAN_MESSAGE); });
                if (verdict !== 'invalid') return { status: 'unknown' };
                return signOut().then(function () {
                    var flag = CACHE_PREFIX + 'reloaded';
                    var already = false;
                    try { already = win.sessionStorage.getItem(flag) === '1'; win.sessionStorage.setItem(flag, '1'); } catch (_) { /* sin sessionStorage */ }
                    if (!already && win.location && typeof win.location.reload === 'function') win.location.reload();
                    return { status: 'signed_out' };
                });
            }).catch(function () { return { status: 'unknown' }; });
        }

        // Baneo o alta bloqueada: sin sesión y sin forma de cerrar el modal.
        function showBlocked(message) {
            return signOut().then(function () {
                var title = el('h2', { className: 'wo-terms-gate__title', id: 'wo-terms-gate-title', text: 'No puedes usar esta cuenta' });
                var body = el('p', { className: 'wo-terms-gate__body', id: 'wo-terms-gate-desc', text: message });
                var home = el('button', { type: 'button', className: 'wo-terms-gate__btn wo-terms-gate__btn--primary', text: 'Ir al inicio' });
                home.addEventListener('click', goHome);
                var panel = el('div', { className: 'wo-terms-gate__panel' }, [
                    el('p', { className: 'wo-terms-gate__eyebrow', text: 'CUENTA' }),
                    title,
                    body,
                    el('div', { className: 'wo-terms-gate__actions' }, [home])
                ]);
                openModal(panel, 'wo-terms-gate-title', 'wo-terms-gate-desc');
                return { status: 'blocked' };
            });
        }

        function showSuspension(sanction) {
            if (state.banner || !doc.body) return;
            ensureCss();
            var close = el('button', { type: 'button', className: 'wo-terms-banner__close', 'aria-label': 'Cerrar aviso de suspensión', text: '×' });
            state.banner = el('div', { className: 'wo-terms-banner', role: 'status', 'data-wo-terms-banner': '' }, [
                el('p', { className: 'wo-terms-banner__text', text: suspensionText(sanction) }),
                close
            ]);
            close.addEventListener('click', function () {
                if (state.banner && state.banner.parentNode) state.banner.parentNode.removeChild(state.banner);
                state.banner = null;
            });
            doc.body.appendChild(state.banner);
        }

        function showAccept(status, token) {
            return new Promise(function (resolve) {
                var version = status.current || TERMS_VERSION;
                var checkbox = el('input', { type: 'checkbox', id: 'wo-terms-gate-check', required: true });
                var accept = el('button', { type: 'button', className: 'wo-terms-gate__btn wo-terms-gate__btn--primary', disabled: true, text: 'Aceptar y continuar' });
                var logout = el('button', { type: 'button', className: 'wo-terms-gate__btn wo-terms-gate__btn--ghost', text: 'Cerrar sesión' });
                var error = el('p', { className: 'wo-terms-gate__error', role: 'alert', hidden: true });
                var list = el('ul', { className: 'wo-terms-gate__list' }, SUMMARY.map(function (item) {
                    return el('li', null, [el('strong', { text: item.title + ': ' }), item.text]);
                }));
                var linkAttrs = { className: 'wo-terms-gate__link', target: '_blank', rel: 'noopener' };
                var panel = el('div', { className: 'wo-terms-gate__panel' }, [
                    el('p', { className: 'wo-terms-gate__eyebrow', text: 'TÉRMINOS · VERSIÓN ' + version }),
                    el('h2', { className: 'wo-terms-gate__title', id: 'wo-terms-gate-title', text: 'Actualizamos los Términos y la Política de privacidad' }),
                    el('p', { className: 'wo-terms-gate__body', id: 'wo-terms-gate-desc', text: 'Para seguir usando We Ötzi, revisa los cambios y acéptalos. Lo principal:' }),
                    list,
                    el('p', { className: 'wo-terms-gate__links' }, [
                        el('a', Object.assign({ href: appUrl('/legal/terms') }, linkAttrs), ['Términos y Condiciones']),
                        el('a', Object.assign({ href: appUrl('/legal/privacy') }, linkAttrs), ['Política de privacidad'])
                    ]),
                    el('label', { className: 'wo-terms-gate__check', for: 'wo-terms-gate-check' }, [
                        checkbox,
                        el('span', { text: 'Leí y acepto los Términos y Condiciones y la Política de privacidad.' })
                    ]),
                    error,
                    el('div', { className: 'wo-terms-gate__actions' }, [logout, accept])
                ]);

                function showError(text) {
                    error.textContent = text;
                    error.hidden = false;
                }

                checkbox.addEventListener('change', function () {
                    accept.disabled = !checkbox.checked;
                    if (checkbox.checked) error.hidden = true;
                });
                logout.addEventListener('click', function () {
                    logout.disabled = true;
                    accept.disabled = true;
                    signOut().then(goHome);
                });
                accept.addEventListener('click', function () {
                    if (!checkbox.checked) { showError('Marca la casilla para aceptar los Términos y la Política de privacidad.'); return; }
                    accept.disabled = true;
                    logout.disabled = true;
                    error.hidden = true;
                    fetchJson(appUrl('/api/account/terms-accept'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                        body: JSON.stringify({ accepted: true, version: version, surface: state.surface })
                    }).then(function (r) {
                        if (r.ok && r.body && r.body.success) {
                            writeCache(cacheKey(version, state.userId));
                            closeModal();
                            resolve({ status: 'accepted' });
                            return;
                        }
                        logout.disabled = false;
                        if (r.body && r.body.code === 'REGISTRATION_BLOCKED') {
                            closeModal();
                            showBlocked(BLOCKED_MESSAGE).then(resolve);
                            return;
                        }
                        if (r.body && r.body.code === 'ACCOUNT_SANCTIONED') {
                            closeModal();
                            showBlocked(BAN_MESSAGE).then(resolve);
                            return;
                        }
                        if (r.status === 409) {
                            showError('Los Términos cambiaron mientras leías. Recarga la página para ver la versión vigente.');
                            return;
                        }
                        accept.disabled = !checkbox.checked;
                        showError((r.body && r.body.error) || 'No pudimos guardar tu aceptación. Intenta de nuevo.');
                    }).catch(function () {
                        logout.disabled = false;
                        accept.disabled = !checkbox.checked;
                        showError('Sin conexión. Revisa tu red e intenta de nuevo.');
                    });
                });

                openModal(panel, 'wo-terms-gate-title', 'wo-terms-gate-desc');
            });
        }

        function whenBody() {
            if (doc.body) return Promise.resolve();
            return new Promise(function (resolve) { doc.addEventListener('DOMContentLoaded', function () { resolve(); }, { once: true }); });
        }

        function run(session) {
            var token = session.access_token;
            var userId = (session.user && session.user.id) || '';
            state.userId = userId;
            if (userId && readCache(cacheKey(TERMS_VERSION, userId))) return Promise.resolve({ status: 'cached' });
            return fetchJson(appUrl('/api/account/terms-status'), { headers: { Authorization: 'Bearer ' + token } })
                .then(function (r) {
                    if (r.status === 401) return handleRejectedSession();
                    if (!r.ok) return { status: 'unknown' };
                    try { win.sessionStorage.removeItem(CACHE_PREFIX + 'reloaded'); } catch (_) { /* noop */ }
                    var status = r.body;
                    var action = decide(status);
                    return whenBody().then(function () {
                        if (action === 'blocked') return showBlocked(BLOCKED_MESSAGE);
                        if (action === 'banned') return showBlocked(BAN_MESSAGE);
                        if (action === 'needs_accept' && defersAccept(win.location && win.location.pathname, basePath())) {
                            return { status: 'deferred' };
                        }
                        if (action === 'needs_accept') {
                            return showAccept(status, token).then(function (res) {
                                if (res && res.status === 'accepted' && status.sanction && status.sanction.kind === 'suspension') showSuspension(status.sanction);
                                return res;
                            });
                        }
                        if (action === 'suspended') { showSuspension(status.sanction); return { status: 'suspended' }; }
                        if (action === 'ok' && userId && status.current === TERMS_VERSION) writeCache(cacheKey(TERMS_VERSION, userId));
                        return { status: action };
                    });
                })
                // Sin red o el servidor caído: no se bloquea a nadie por eso.
                .catch(function () { return { status: 'unknown' }; });
        }

        function ensure(session, opts) {
            var o = opts || {};
            if (o.surface) state.surface = normalizeSurface(o.surface);
            if (o.supabase && o.supabase.auth) state.supabase = o.supabase;
            if (!session || !session.access_token || win.WEOTZI_PREVIEW) return Promise.resolve({ status: 'anonymous' });
            if (isExcludedPath(win.location && win.location.pathname, basePath())) return Promise.resolve({ status: 'excluded' });
            if (state.inflight) return state.inflight;
            state.inflight = run(session).then(function (res) {
                // Una vez resuelto se puede volver a consultar (otro usuario, otra pestaña de auth).
                if (!state.modal) state.inflight = null;
                return res;
            }, function () { state.inflight = null; return { status: 'unknown' }; });
            return state.inflight;
        }

        var api = {
            ensure: ensure,
            version: TERMS_VERSION,
            reset: function () {
                try {
                    var keys = [];
                    for (var i = 0; i < win.sessionStorage.length; i++) {
                        var k = win.sessionStorage.key(i);
                        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
                    }
                    keys.forEach(function (k) { win.sessionStorage.removeItem(k); });
                } catch (_) { /* noop */ }
            }
        };
        win.WoTermsGate = api;

        // Cola que dejan los módulos de auth antes de que este archivo cargue.
        var queue = Array.isArray(win.__woTermsGateQueue) ? win.__woTermsGateQueue.splice(0) : [];
        queue.forEach(function (item) { if (item) ensure(item.session, { surface: item.surface, supabase: item.supabase }); });
        if (!queue.length) {
            var stored = storedSession();
            if (stored) ensure(stored, {});
        }
    }

    return {
        TERMS_VERSION: TERMS_VERSION,
        BAN_MESSAGE: BAN_MESSAGE,
        BLOCKED_MESSAGE: BLOCKED_MESSAGE,
        SUMMARY: SUMMARY,
        EXCLUDED_PREFIXES: EXCLUDED_PREFIXES,
        DEFER_ACCEPT_PREFIXES: DEFER_ACCEPT_PREFIXES,
        normalizeSurface: normalizeSurface,
        cacheKey: cacheKey,
        isExcludedPath: isExcludedPath,
        defersAccept: defersAccept,
        decide: decide,
        formatDate: formatDate,
        suspensionText: suspensionText,
        sessionFromStorageValue: sessionFromStorageValue,
        isBannedAuthError: isBannedAuthError,
        classifyRejectedSession: classifyRejectedSession,
        boot: boot
    };
});
