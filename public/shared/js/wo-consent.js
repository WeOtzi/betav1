/*
 * We Ötzi · Banner y gestor de consentimiento de cookies (grupo "privacidad").
 *
 * - Ningún script no esencial (Microsoft Clarity, etc.) se carga antes de que
 *   la persona lo acepte, ni si lo rechaza. Los scripts los inyecta SOLO este
 *   archivo, según la configuración pública del backoffice
 *   (GET /api/privacy/cookie-config → app_settings.cookie_consent_config).
 * - Respeta Global Privacy Control (navigator.globalPrivacyControl): con la
 *   señal activa y sin una elección explícita posterior, todo lo no esencial
 *   queda apagado y no se muestra el banner.
 * - Guarda la elección en localStorage (wo_cookie_consent) y en una cookie de
 *   primera parte (wo_consent) con versión y fecha. Si hay sesión, también en
 *   la base (POST /api/privacy/cookie-consent → user_preferences + historial).
 * - Cambiar la versión en el backoffice vuelve a pedir el consentimiento.
 * - Cualquier elemento con [data-wo-cookie-settings] reabre la configuración;
 *   se agrega solo un botón "Configuración de cookies" al pie de página.
 *
 * El bloque factory es puro (sin DOM) y se testea con node:test.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.WoConsent) {
        api.boot(window, document);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var STORAGE_KEY = 'wo_cookie_consent';
    var COOKIE_NAME = 'wo_consent';
    var NON_ESSENTIAL = ['analytics', 'marketing'];
    var DAY_MS = 24 * 60 * 60 * 1000;

    // Respaldo cuando el endpoint no responde (preview, red caída): banner
    // activo, sin ningún script de terceros configurado.
    var FALLBACK_CONFIG = {
        enabled: true,
        version: '2026-11-13',
        renew_days: 365,
        policy_url: '/legal/privacy#cookies',
        texts: {
            title: 'Cookies y privacidad',
            body: 'Usamos cookies y almacenamiento local necesarios para que la plataforma funcione. Con tu permiso también usamos analítica para entender cómo se usa y mejorarla. Podés cambiar tu elección cuando quieras desde «Configuración de cookies».',
            accept_all: 'Aceptar todas',
            reject: 'Rechazar no esenciales',
            configure: 'Configurar',
            save: 'Guardar elección',
            gpc_notice: 'Tu navegador envía la señal Global Privacy Control: dejamos apagadas las cookies no esenciales. Si querés, podés activarlas acá.'
        },
        categories: [
            { id: 'necessary', label: 'Necesarias', description: 'Sesión iniciada, seguridad, preferencias de la interfaz, borradores y esta misma elección. Siempre están activas.', required: true, providers: [] },
            { id: 'analytics', label: 'Analítica', description: 'Medición del uso y grabación anónima de sesiones para mejorar la plataforma (Microsoft Clarity).', required: false, providers: [] }
        ],
        scripts: []
    };

    // ── lógica pura ─────────────────────────────────────────────────────

    function normalizeConfig(cfg) {
        var src = cfg && typeof cfg === 'object' ? cfg : {};
        var out = {
            enabled: typeof src.enabled === 'boolean' ? src.enabled : FALLBACK_CONFIG.enabled,
            version: typeof src.version === 'string' && src.version ? src.version : FALLBACK_CONFIG.version,
            renew_days: Number(src.renew_days) > 0 ? Number(src.renew_days) : FALLBACK_CONFIG.renew_days,
            policy_url: typeof src.policy_url === 'string' && /^\/(?!\/)/.test(src.policy_url) ? src.policy_url : FALLBACK_CONFIG.policy_url,
            texts: {},
            categories: Array.isArray(src.categories) && src.categories.length ? src.categories : FALLBACK_CONFIG.categories,
            scripts: Array.isArray(src.scripts) ? src.scripts : []
        };
        var t = src.texts && typeof src.texts === 'object' ? src.texts : {};
        Object.keys(FALLBACK_CONFIG.texts).forEach(function (k) {
            out.texts[k] = typeof t[k] === 'string' && t[k] ? t[k] : FALLBACK_CONFIG.texts[k];
        });
        if (!out.categories.some(function (c) { return c && c.id === 'necessary'; })) {
            out.categories = [FALLBACK_CONFIG.categories[0]].concat(out.categories);
        }
        return out;
    }

    function emptyCategories() {
        return { necessary: true, analytics: false, marketing: false };
    }

    function allCategories(config) {
        var cats = emptyCategories();
        (config.categories || []).forEach(function (c) { if (c && c.id && c.id !== 'necessary') cats[c.id] = true; });
        return cats;
    }

    function parseStored(raw) {
        if (!raw) return null;
        var data = raw;
        if (typeof raw === 'string') {
            try { data = JSON.parse(raw); } catch (_) { return null; }
        }
        if (!data || typeof data !== 'object') return null;
        if (typeof data.version !== 'string' || !data.version) return null;
        if (!data.categories || typeof data.categories !== 'object') return null;
        var when = Date.parse(data.decided_at);
        if (!isFinite(when)) return null;
        var cats = emptyCategories();
        NON_ESSENTIAL.forEach(function (id) { cats[id] = data.categories[id] === true; });
        return {
            v: 1,
            version: data.version,
            decided_at: new Date(when).toISOString(),
            categories: cats,
            source: typeof data.source === 'string' ? data.source : 'banner',
            gpc: data.gpc === true,
            gpc_override: data.gpc_override === true
        };
    }

    // Cookie wo_consent = "<versión>~a1m0~<epoch días>" (lectura de respaldo).
    function parseCookieValue(value) {
        if (typeof value !== 'string') return null;
        var parts = decodeURIComponent(value).split('~');
        if (parts.length !== 3 || !/^a[01]m[01]$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return null;
        return parseStored({
            version: parts[0],
            decided_at: new Date(Number(parts[2]) * DAY_MS).toISOString(),
            categories: { analytics: parts[1].charAt(1) === '1', marketing: parts[1].charAt(3) === '1' },
            source: 'banner'
        });
    }

    function cookieValue(record) {
        var days = Math.floor(Date.parse(record.decided_at) / DAY_MS);
        return encodeURIComponent(record.version + '~a' + (record.categories.analytics ? 1 : 0) + 'm' + (record.categories.marketing ? 1 : 0) + '~' + days);
    }

    function cookieString(record, opts) {
        var o = opts || {};
        var maxAge = Math.round((o.renewDays || 365) * 86400);
        return COOKIE_NAME + '=' + cookieValue(record) + '; Max-Age=' + maxAge + '; Path=/; SameSite=Lax' + (o.secure ? '; Secure' : '');
    }

    function isCurrent(stored, config, now) {
        if (!stored) return false;
        if (stored.version !== config.version) return false;
        var age = (now || new Date()).getTime() - Date.parse(stored.decided_at);
        return age >= 0 - DAY_MS && age <= config.renew_days * DAY_MS;
    }

    /**
     * Decide qué está permitido al cargar la página.
     *   - consentimiento vigente → se respeta (GPC apaga lo no esencial salvo
     *     que la persona lo haya activado a mano con la señal ya presente);
     *   - sin consentimiento + GPC → todo lo no esencial apagado, sin banner;
     *   - sin consentimiento → todo apagado y se muestra el banner;
     *   - banner desactivado en el backoffice → igual nada no esencial sin un
     *     consentimiento vigente (desactivar el banner no es consentir).
     */
    function decide(input) {
        var config = normalizeConfig(input && input.config);
        var stored = input && input.stored ? input.stored : null;
        var gpc = !!(input && input.gpc);
        var current = isCurrent(stored, config, input && input.now);
        if (current) {
            var cats = Object.assign(emptyCategories(), stored.categories);
            var gpcApplied = false;
            if (gpc && !stored.gpc_override) {
                NON_ESSENTIAL.forEach(function (id) { cats[id] = false; });
                gpcApplied = true;
            }
            return { categories: cats, showBanner: false, gpcApplied: gpcApplied, decided: true };
        }
        if (gpc) return { categories: emptyCategories(), showBanner: false, gpcApplied: true, decided: false };
        return { categories: emptyCategories(), showBanner: config.enabled, gpcApplied: false, decided: false };
    }

    function buildRecord(categories, config, source, gpc, now) {
        var cats = emptyCategories();
        NON_ESSENTIAL.forEach(function (id) { cats[id] = !!(categories && categories[id] === true); });
        var anyOn = NON_ESSENTIAL.some(function (id) { return cats[id]; });
        return {
            v: 1,
            version: normalizeConfig(config).version,
            decided_at: (now || new Date()).toISOString(),
            categories: cats,
            source: source === 'settings' || source === 'gpc' ? source : 'banner',
            gpc: !!gpc,
            gpc_override: !!gpc && anyOn
        };
    }

    function pathExcluded(script, pathname, basePath) {
        var path = String(pathname || '/');
        var base = String(basePath || '').replace(/\/$/, '');
        if (base && path.indexOf(base + '/') === 0) path = path.slice(base.length);
        var ex = Array.isArray(script.exclude_paths) ? script.exclude_paths : [];
        return ex.some(function (p) { return path === p || path.indexOf(p.replace(/\/$/, '') + '/') === 0; });
    }

    function scriptsToLoad(config, categories, pathname, basePath) {
        var cfg = normalizeConfig(config);
        return cfg.scripts.filter(function (s) {
            return s && s.category !== 'necessary' && categories && categories[s.category] === true &&
                s.type === 'clarity' && /^[a-z0-9]{6,20}$/i.test(String(s.project_id || '')) &&
                !pathExcluded(s, pathname, basePath);
        });
    }

    // ── navegador ───────────────────────────────────────────────────────

    function boot(win, doc) {
        var state = { config: normalizeConfig(null), categories: emptyCategories(), loaded: {}, gpc: false, opener: null };
        var listeners = [];
        var scriptSrc = (doc.currentScript && doc.currentScript.src) || '';

        function basePath() {
            if (win.WEOTZI_BASE_PATH) return String(win.WEOTZI_BASE_PATH).replace(/\/$/, '');
            var p = (win.location && win.location.pathname) || '';
            return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
        }
        function appUrl(path) { return basePath() + path; }

        function readStored() {
            var stored = null;
            try { stored = parseStored(win.localStorage.getItem(STORAGE_KEY)); } catch (_) { /* almacenamiento bloqueado */ }
            if (stored) return stored;
            var m = String(doc.cookie || '').match(/(?:^|;\s*)wo_consent=([^;]+)/);
            return m ? parseCookieValue(m[1]) : null;
        }

        function persist(record) {
            try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (_) { /* sin localStorage: queda la cookie */ }
            try { doc.cookie = cookieString(record, { renewDays: state.config.renew_days, secure: win.location.protocol === 'https:' }); } catch (_) { /* cookies bloqueadas */ }
        }

        function sessionToken() {
            try {
                for (var i = 0; i < win.localStorage.length; i++) {
                    var key = win.localStorage.key(i);
                    if (!/^sb-[a-z0-9]+-auth-token$/.test(key || '')) continue;
                    var data = JSON.parse(win.localStorage.getItem(key) || 'null');
                    var s = data && (data.access_token ? data : data.currentSession);
                    if (s && s.access_token && (!s.expires_at || s.expires_at * 1000 > Date.now())) return s.access_token;
                }
            } catch (_) { /* sin sesión legible */ }
            return null;
        }

        function syncToServer(record) {
            var token = sessionToken();
            if (!token || win.WEOTZI_PREVIEW) return;
            try {
                win.fetch(appUrl('/api/privacy/cookie-consent'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                    body: JSON.stringify({ version: record.version, categories: record.categories, source: record.source, gpc: record.gpc }),
                    keepalive: true
                }).catch(function () { /* la elección local ya quedó guardada */ });
            } catch (_) { /* noop */ }
        }

        function fetchJson(url, opts, ms) {
            if (!win.fetch) return Promise.resolve(null);
            var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 3000) : null;
            var o = Object.assign({ credentials: 'same-origin' }, opts || {});
            if (ctrl) o.signal = ctrl.signal;
            return win.fetch(url, o).then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; })
                .then(function (d) { if (timer) clearTimeout(timer); return d; });
        }

        function fetchServerConsent() {
            var token = sessionToken();
            if (!token || win.WEOTZI_PREVIEW) return Promise.resolve(null);
            return fetchJson(appUrl('/api/privacy/cookie-consent'), { headers: { Authorization: 'Bearer ' + token } }, 2500)
                .then(function (d) { return d && d.consent ? parseStored(d.consent) : null; });
        }

        // ── carga de scripts no esenciales ─────────────────────────────
        function loadClarity(projectId) {
            /* eslint-disable */
            (function (c, l, a, r, i, t, y) {
                c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
                t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(i);
                t.setAttribute('data-wo-consent-script', 'clarity');
                y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
            })(win, doc, 'clarity', 'script', projectId);
            /* eslint-enable */
            try { win.clarity('consent'); } catch (_) { /* noop */ }
        }

        function applyScripts() {
            scriptsToLoad(state.config, state.categories, win.location.pathname, basePath()).forEach(function (s) {
                if (state.loaded[s.id]) return;
                state.loaded[s.id] = s;
                if (s.type === 'clarity') loadClarity(s.project_id);
            });
        }

        function clearCookies(names) {
            var host = win.location.hostname;
            var domains = ['', host];
            var parts = host.split('.');
            if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
            if (parts.length > 1) domains.push('.' + host);
            names.forEach(function (n) {
                domains.forEach(function (d) {
                    doc.cookie = n + '=; Max-Age=0; Path=/' + (d ? '; Domain=' + d : '');
                });
            });
        }

        // Si se retira un permiso de algo ya cargado: se avisa al proveedor,
        // se borran sus cookies y se recarga para descargar el script.
        function revokeLoaded() {
            var needsReload = false;
            Object.keys(state.loaded).forEach(function (id) {
                var s = state.loaded[id];
                if (state.categories[s.category]) return;
                needsReload = true;
                if (s.type === 'clarity') {
                    try { win.clarity && win.clarity('consent', false); } catch (_) { /* noop */ }
                    clearCookies(['_clck', '_clsk', 'CLID', 'ANONCHK', 'MR', 'MUID', 'SM']);
                }
            });
            return needsReload;
        }

        function emit() {
            var detail = { categories: Object.assign({}, state.categories), version: state.config.version };
            listeners.slice().forEach(function (fn) { try { fn(detail); } catch (_) { /* noop */ } });
            try { win.dispatchEvent(new CustomEvent('wo:consent', { detail: detail })); } catch (_) { /* noop */ }
        }

        function commit(categories, source) {
            var record = buildRecord(categories, state.config, source, state.gpc);
            persist(record);
            state.categories = Object.assign(emptyCategories(), record.categories);
            syncToServer(record);
            hideBanner();
            var reload = revokeLoaded();
            applyScripts();
            emit();
            announce('Guardamos tu elección de cookies.');
            if (reload) setTimeout(function () { win.location.reload(); }, 300);
        }

        // ── UI ──────────────────────────────────────────────────────────
        function el(tag, attrs, children) {
            var node = doc.createElement(tag);
            Object.keys(attrs || {}).forEach(function (k) {
                if (k === 'text') node.textContent = attrs[k];
                else if (k === 'className') node.className = attrs[k];
                else node.setAttribute(k, attrs[k]);
            });
            (children || []).forEach(function (c) { if (c) node.appendChild(c); });
            return node;
        }

        function ensureCss() {
            if (doc.querySelector('link[data-wo-consent-css]')) return;
            var href = scriptSrc ? scriptSrc.replace(/js\/wo-consent\.js(\?.*)?$/, 'css/wo-consent.css') : appUrl('/shared/css/wo-consent.css');
            var link = el('link', { rel: 'stylesheet', href: href, 'data-wo-consent-css': '' });
            doc.head.appendChild(link);
        }

        var live = null;
        function announce(msg) {
            if (!live) {
                live = el('div', { className: 'wo-consent-sr', role: 'status', 'aria-live': 'polite' });
                doc.body.appendChild(live);
            }
            live.textContent = '';
            setTimeout(function () { live.textContent = msg; }, 50);
        }

        var banner = null;
        function policyLink(className) {
            return el('a', { className: className, href: appUrl(state.config.policy_url), text: 'Política de privacidad →' });
        }

        function showBanner() {
            if (banner || !doc.body) return;
            ensureCss();
            var t = state.config.texts;
            banner = el('section', { className: 'wo-consent', role: 'region', 'aria-labelledby': 'wo-consent-title', 'data-wo-consent-banner': '' }, [
                el('div', { className: 'wo-consent__inner' }, [
                    el('div', { className: 'wo-consent__copy' }, [
                        el('p', { className: 'wo-consent__eyebrow', text: 'PRIVACIDAD' }),
                        el('h2', { className: 'wo-consent__title', id: 'wo-consent-title', text: t.title }),
                        el('p', { className: 'wo-consent__body', text: t.body }),
                        policyLink('wo-consent__link')
                    ]),
                    el('div', { className: 'wo-consent__actions' }, [
                        el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--secondary', 'data-wo-consent-action': 'reject', text: t.reject }),
                        el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--ghost', 'data-wo-consent-action': 'configure', text: t.configure }),
                        el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--primary', 'data-wo-consent-action': 'accept', text: t.accept_all })
                    ])
                ])
            ]);
            banner.addEventListener('click', function (e) {
                var b = e.target.closest('[data-wo-consent-action]');
                if (!b) return;
                var action = b.getAttribute('data-wo-consent-action');
                if (action === 'accept') commit(allCategories(state.config), 'banner');
                else if (action === 'reject') commit(emptyCategories(), 'banner');
                else openSettings(b);
            });
            // Primero en el orden de tabulación; visualmente fijo abajo.
            doc.body.insertBefore(banner, doc.body.firstChild);
        }

        function hideBanner() {
            if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
            banner = null;
        }

        var dialog = null;
        // Limpieza idempotente: se llama al cerrar con botones y desde el
        // evento "close" (Escape); no depende de que el evento llegue.
        function finishClose() {
            if (!dialog) return;
            var node = dialog;
            dialog = null;
            if (node.parentNode) node.parentNode.removeChild(node);
            var back = state.opener;
            if (back && typeof back.focus === 'function' && doc.contains(back)) back.focus();
            else if (banner) { var first = banner.querySelector('button'); if (first) first.focus(); }
        }

        function closeSettings() {
            if (!dialog) return;
            if (typeof dialog.close === 'function' && dialog.open) dialog.close();
            else dialog.removeAttribute('open');
            finishClose();
        }

        function openSettings(opener) {
            ensureCss();
            state.opener = opener || doc.activeElement;
            if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
            var t = state.config.texts;
            var list = el('div', { className: 'wo-consent-dialog__list' });
            state.config.categories.forEach(function (c) {
                if (!c || !c.id) return;
                var id = 'wo-consent-cat-' + c.id;
                var input = el('input', { type: 'checkbox', id: id, role: 'switch', className: 'wo-consent-switch__input', 'data-wo-consent-category': c.id, 'aria-describedby': id + '-desc' });
                input.checked = c.required ? true : !!state.categories[c.id];
                if (c.required) { input.disabled = true; input.setAttribute('aria-disabled', 'true'); }
                var providers = Array.isArray(c.providers) && c.providers.length
                    ? 'Servicios: ' + c.providers.join(' · ')
                    : (c.required ? 'Propias de We Ötzi.' : 'Hoy no hay servicios activos en esta categoría.');
                list.appendChild(el('div', { className: 'wo-consent-dialog__item' }, [
                    el('div', { className: 'wo-consent-dialog__item-head' }, [
                        el('label', { className: 'wo-consent-dialog__label', for: id, text: c.label }),
                        el('span', { className: 'wo-consent-switch' }, [input, el('span', { className: 'wo-consent-switch__track', 'aria-hidden': 'true' })]),
                        c.required ? el('span', { className: 'wo-consent-dialog__always', text: 'Siempre activas' }) : null
                    ]),
                    el('p', { className: 'wo-consent-dialog__desc', id: id + '-desc', text: c.description || '' }),
                    el('p', { className: 'wo-consent-dialog__providers', text: providers })
                ]));
            });
            var form = el('form', { method: 'dialog', className: 'wo-consent-dialog__form' }, [
                el('p', { className: 'wo-consent__eyebrow', text: 'PRIVACIDAD · VERSIÓN ' + state.config.version }),
                el('h2', { className: 'wo-consent-dialog__title', id: 'wo-consent-dialog-title', text: 'Configuración de cookies' }),
                el('p', { className: 'wo-consent__body', text: t.body }),
                state.gpc ? el('p', { className: 'wo-consent-dialog__gpc', role: 'note', text: t.gpc_notice }) : null,
                list,
                policyLink('wo-consent__link'),
                el('div', { className: 'wo-consent__actions wo-consent-dialog__actions' }, [
                    el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--secondary', 'data-wo-consent-action': 'reject', text: t.reject }),
                    el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--ghost', 'data-wo-consent-action': 'save', text: t.save }),
                    el('button', { type: 'button', className: 'wo-consent__btn wo-consent__btn--primary', 'data-wo-consent-action': 'accept', text: t.accept_all })
                ])
            ]);
            var closeBtn = el('button', { type: 'button', className: 'wo-consent-dialog__close', 'aria-label': 'Cerrar configuración de cookies', 'data-wo-consent-action': 'close', text: '×' });
            dialog = el('dialog', { className: 'wo-consent-dialog', 'aria-labelledby': 'wo-consent-dialog-title', 'data-wo-consent-dialog': '' }, [closeBtn, form]);
            dialog.addEventListener('click', function (e) {
                if (e.target === dialog) { closeSettings(); return; }
                var b = e.target.closest('[data-wo-consent-action]');
                if (!b) return;
                var action = b.getAttribute('data-wo-consent-action');
                if (action === 'close') { closeSettings(); return; }
                var cats = emptyCategories();
                if (action === 'accept') cats = allCategories(state.config);
                else if (action === 'save') {
                    dialog.querySelectorAll('[data-wo-consent-category]').forEach(function (inp) {
                        var cid = inp.getAttribute('data-wo-consent-category');
                        if (cid !== 'necessary') cats[cid] = inp.checked;
                    });
                }
                commit(cats, 'settings');
                closeSettings();
            });
            var thisDialog = dialog;
            dialog.addEventListener('close', function () { if (dialog === thisDialog) finishClose(); });
            doc.body.appendChild(dialog);
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else { dialog.setAttribute('open', ''); var f = dialog.querySelector('input:not([disabled]),button'); if (f) f.focus(); }
        }

        // ── "Configuración de cookies" en el pie de página ─────────────
        function addFooterLink() {
            if (doc.querySelector('[data-wo-cookie-settings]')) { ensureCss(); return; }
            var footers = Array.prototype.filter.call(doc.querySelectorAll('footer'), function (f) {
                return !f.closest('form, dialog, [role="dialog"], .modal, .wo-modal, [data-wo-consent-banner]');
            });
            var footer = footers[footers.length - 1];
            if (!footer) return;
            ensureCss();
            footer.appendChild(el('p', { className: 'wo-consent-footer-link' }, [
                el('button', { type: 'button', 'data-wo-cookie-settings': '', text: 'Configuración de cookies' })
            ]));
        }

        doc.addEventListener('click', function (e) {
            var trigger = e.target && e.target.closest && e.target.closest('[data-wo-cookie-settings]');
            if (!trigger) return;
            e.preventDefault();
            openSettings(trigger);
        });

        // ── arranque ────────────────────────────────────────────────────
        state.gpc = !!(win.navigator && win.navigator.globalPrivacyControl === true);

        var api = {
            open: function (opener) { openSettings(opener); },
            get: function () { return { categories: Object.assign({}, state.categories), version: state.config.version, gpc: state.gpc }; },
            has: function (category) { return state.categories[category] === true; },
            onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
            reset: function () {
                try { win.localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
                doc.cookie = COOKIE_NAME + '=; Max-Age=0; Path=/';
            }
        };
        win.WoConsent = api;

        function start(rawConfig) {
            state.config = normalizeConfig(rawConfig);
            var stored = readStored();
            var pending = isCurrent(stored, state.config) ? Promise.resolve(stored) : fetchServerConsent().then(function (remote) {
                if (remote && isCurrent(remote, state.config)) { persist(remote); return remote; }
                return stored;
            });
            pending.then(function (finalStored) {
                var d = decide({ config: state.config, stored: finalStored, gpc: state.gpc });
                state.categories = d.categories;
                applyScripts();
                emit();
                var ui = function () { addFooterLink(); if (d.showBanner) showBanner(); };
                if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ui); else ui();
                // El pie de página del DS lo pinta organisms.js: segundo intento.
                setTimeout(addFooterLink, 1200);
            });
        }

        fetchJson(appUrl('/api/privacy/cookie-config'), null, 3000).then(function (data) {
            start(data && data.config ? data.config : null);
        });
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        COOKIE_NAME: COOKIE_NAME,
        FALLBACK_CONFIG: FALLBACK_CONFIG,
        normalizeConfig: normalizeConfig,
        parseStored: parseStored,
        parseCookieValue: parseCookieValue,
        cookieValue: cookieValue,
        cookieString: cookieString,
        isCurrent: isCurrent,
        decide: decide,
        buildRecord: buildRecord,
        allCategories: allCategories,
        scriptsToLoad: scriptsToLoad,
        boot: boot
    };
});
