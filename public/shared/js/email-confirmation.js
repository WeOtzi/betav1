// ============================================
// We Ötzi · Confirmación de email (Supabase Auth "Confirm email")
// ============================================
// Funciona con la confirmación DESACTIVADA (signUp devuelve sesión) y ACTIVADA
// (signUp devuelve session: null). Nunca asume el modo: mira la respuesta.
//
// Expone window.WeotziEmailConfirm (y module.exports para los tests):
//   needsConfirmation(data)       → true si hay user y no hay session
//   isExistingAccountSignup(data) → signUp de un email ya confirmado (identities: [])
//   isEmailNotConfirmedError(err) → "Email not confirmed" del login
//   resend(client, email, redirectTo)
//   renderPending(container, opts)     → estado "Revisa tu email" (DS)
//   renderLoginNotice(container, opts) → aviso de login con "Reenviar email"
//   savePending / readPending / clearPending → progreso en localStorage
//   stashFiles / takeFiles / clearFiles      → archivos en IndexedDB
// Nunca guarda contraseñas.
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object') root.WeotziEmailConfirm = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const RESEND_COOLDOWN_SECONDS = 60;
    const PENDING_PREFIX = 'weotzi_email_confirm:';
    const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const IDB_NAME = 'weotzi-email-confirm-files';

    // ---------------- Lógica pura ----------------

    function needsConfirmation(data) {
        return Boolean(data && data.user && data.user.id && !data.session);
    }

    // Con la confirmación activa, Supabase responde al signUp de un email ya
    // confirmado con un usuario "ofuscado" sin identidades (no revela la cuenta).
    function isExistingAccountSignup(data) {
        const user = data && data.user;
        return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
    }

    function isEmailNotConfirmedError(err) {
        if (!err) return false;
        const code = String(err.code || err.error_code || '').toLowerCase();
        if (code === 'email_not_confirmed') return true;
        return /email not confirmed/i.test(String(err.message || err.msg || err.error_description || ''));
    }

    function isRateLimitError(err) {
        if (!err) return false;
        const code = String(err.code || '').toLowerCase();
        const status = Number(err.status || 0);
        return status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' ||
            /rate limit|security purposes|only request this after/i.test(String(err.message || ''));
    }

    function resendErrorMessage(err) {
        if (isRateLimitError(err)) return 'Ya te enviamos un email hace muy poco. Espera un minuto y prueba de nuevo.';
        if (/already confirmed|email_confirmed/i.test(String((err && err.message) || ''))) {
            return 'Tu email ya está confirmado. Ya puedes ingresar.';
        }
        return 'No pudimos reenviar el email. Prueba de nuevo en unos minutos.';
    }

    // ── acceso: enlace mágico. Con shouldCreateUser:false Supabase responde
    // "Signups not allowed for otp" si el email no tiene cuenta: se trata como
    // éxito para no revelar qué emails existen (anti-enumeración).
    function isNeutralOtpError(err) {
        if (!err) return false;
        const code = String(err.code || err.error_code || '').toLowerCase();
        if (code === 'otp_disabled' || code === 'user_not_found' || code === 'signup_disabled') return true;
        return /signups? not allowed|user not found|otp_disabled|signup.*disabled/i.test(String(err.message || err.msg || ''));
    }

    // Resultado de signInWithOtp para la UI: { ok, message, kind }.
    function magicLinkOutcome(err, email) {
        const who = escapeHtml(String(email || '').trim());
        const neutral = 'Si ' + who + ' tiene una cuenta, te enviamos un link de acceso. Revisa tu correo (también spam).';
        if (!err || isNeutralOtpError(err)) return { ok: true, kind: 'success', message: neutral };
        if (isRateLimitError(err)) {
            return { ok: false, kind: 'error', message: 'Ya te enviamos un link hace muy poco. Espera un minuto y prueba de nuevo.' };
        }
        return { ok: false, kind: 'error', message: 'No pudimos enviar el link de acceso. Prueba de nuevo en un momento o ingresa con tu contraseña.' };
    }

    // ── acceso: links de Supabase vencidos o ya usados. Supabase vuelve con
    // #error=access_denied&error_code=otp_expired&error_description=… (o en la
    // query). Los antivirus de correo suelen abrir el link antes que la persona.
    function parseAuthLinkError(hash, search) {
        const read = (raw) => {
            const s = String(raw || '').replace(/^[#?]/, '');
            if (!s || !/(^|&)(error|error_code|error_description)=/.test(s)) return null;
            try { return new URLSearchParams(s); } catch (_) { return null; }
        };
        const params = read(hash) || read(search);
        if (!params) return null;
        const error = params.get('error') || '';
        const code = params.get('error_code') || '';
        const description = (params.get('error_description') || '').replace(/\+/g, ' ').slice(0, 300);
        if (!error && !code) return null;
        const expired = /otp_expired|expired/i.test(code + ' ' + description) ||
            (error === 'access_denied' && /invalid|expired|used/i.test(description || 'expired'));
        return { error, code, description, expired };
    }

    function linkErrorCopy(linkError, context) {
        const ctx = context || {};
        const what = ctx.what || 'link';
        if (!linkError) return null;
        if (linkError.expired) {
            return {
                title: 'El ' + what + ' venció o ya se usó',
                text: 'Por seguridad cada link sirve una sola vez y vence en poco tiempo. A veces el antivirus del correo lo abre antes que tú. ' +
                    (ctx.hint || 'Pide uno nuevo y ábrelo apenas llegue.')
            };
        }
        return {
            title: 'No pudimos validar el ' + what,
            text: (ctx.hint || 'Pide uno nuevo y ábrelo apenas llegue.')
        };
    }

    const INITIAL_LINK_ERROR = (function () {
        try {
            const loc = root && root.location;
            return loc ? parseAuthLinkError(loc.hash, loc.search) : null;
        } catch (_) { return null; }
    })();

    // Lee el error del link de esta carga (capturado al cargar el script, antes
    // de que otro código toque la URL) y, con clean, lo quita de la barra.
    function readAuthLinkError(opts) {
        const o = opts || {};
        let found = INITIAL_LINK_ERROR;
        try {
            const loc = root && root.location;
            if (!found && loc) found = parseAuthLinkError(loc.hash, loc.search);
            if (found && o.clean !== false && loc && root.history && typeof root.history.replaceState === 'function') {
                const qs = new URLSearchParams(String(loc.search || '').replace(/^\?/, ''));
                ['error', 'error_code', 'error_description'].forEach(function (k) { qs.delete(k); });
                const q = qs.toString();
                const hashHasError = /(^#?|&)(error|error_code)=/.test(String(loc.hash || ''));
                root.history.replaceState(root.history.state, '', loc.pathname + (q ? '?' + q : '') + (hashHasError ? '' : (loc.hash || '')));
            }
        } catch (_) { /* URL sin limpiar: no bloquea */ }
        return found;
    }

    function cooldownLeft(lastSentAt, now, seconds) {
        const span = (seconds == null ? RESEND_COOLDOWN_SECONDS : seconds) * 1000;
        const last = Number(lastSentAt || 0);
        if (!last) return 0;
        const left = Math.ceil((last + span - Number(now || Date.now())) / 1000);
        return left > 0 ? left : 0;
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function basePath() {
        const w = root || {};
        if (w.WEOTZI_BASE_PATH) return String(w.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const pathname = (w.location && w.location.pathname) || '';
        return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
    }

    // URL absoluta del producto para emailRedirectTo (respeta /beta y la preview).
    function redirectUrl(path, params, opts) {
        const o = opts || {};
        const origin = o.origin != null ? o.origin : ((root && root.location && root.location.origin) || '');
        const base = o.basePath != null ? String(o.basePath).replace(/\/$/, '') : basePath();
        let p = String(path || '/');
        if (p.charAt(0) !== '/') p = '/' + p;
        if (base && p !== base && p.indexOf(base + '/') !== 0) p = base + p;
        const qs = new URLSearchParams();
        Object.keys(params || {}).forEach(function (k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') qs.set(k, String(params[k]));
        });
        const q = qs.toString();
        if (!q) return origin + p;
        return origin + p + (p.indexOf('?') === -1 ? '?' : '&') + q;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---------------- Progreso (localStorage, sin secretos) ----------------

    function storage(custom) {
        if (custom) return custom;
        try { return root.localStorage || null; } catch (_) { return null; }
    }

    function savePending(key, record, store) {
        const s = storage(store);
        if (!s || !key) return false;
        const clean = Object.assign({}, record || {});
        delete clean.password;
        clean.savedAt = clean.savedAt || Date.now();
        try { s.setItem(PENDING_PREFIX + key, JSON.stringify(clean)); return true; } catch (_) { return false; }
    }

    function readPending(key, store, now) {
        const s = storage(store);
        if (!s || !key) return null;
        try {
            const raw = s.getItem(PENDING_PREFIX + key);
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (!rec || typeof rec !== 'object') return null;
            if (Number(now || Date.now()) - Number(rec.savedAt || 0) > PENDING_MAX_AGE_MS) {
                s.removeItem(PENDING_PREFIX + key);
                return null;
            }
            return rec;
        } catch (_) { return null; }
    }

    function clearPending(key, store) {
        const s = storage(store);
        if (!s || !key) return;
        try { s.removeItem(PENDING_PREFIX + key); } catch (_) { /* sin storage */ }
    }

    // ---------------- Archivos (IndexedDB) ----------------
    // Los File no sobreviven a localStorage: se guardan como Blob hasta volver
    // del link de confirmación en este mismo navegador.

    let dbPromise = null;
    function openDb() {
        const idb = root && root.indexedDB;
        if (!idb) return Promise.reject(new Error('IndexedDB no disponible'));
        if (!dbPromise) {
            dbPromise = new Promise(function (resolve, reject) {
                const req = idb.open(IDB_NAME, 1);
                req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { dbPromise = null; reject(req.error || new Error('IndexedDB')); };
                req.onblocked = function () { dbPromise = null; reject(new Error('IndexedDB bloqueada')); };
            });
        }
        return dbPromise;
    }

    function idbRun(mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction('files', mode);
                let result;
                const req = fn(tx.objectStore('files'));
                if (req) req.onsuccess = function () { result = req.result; };
                tx.oncomplete = function () { resolve(result); };
                tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB')); };
            });
        });
    }

    async function stashFiles(key, files) {
        const list = Array.from(files || []).filter(Boolean);
        if (!key) return 0;
        try {
            if (!list.length) { await idbRun('readwrite', function (s) { return s.delete(key); }); return 0; }
            const items = list.map(function (f) {
                return { blob: f, name: f.name || 'archivo', type: f.type || '', lastModified: f.lastModified || Date.now() };
            });
            await idbRun('readwrite', function (s) { return s.put(items, key); });
            return items.length;
        } catch (e) {
            console.warn('[email-confirm] no se pudieron guardar los archivos:', e && e.message);
            return 0;
        }
    }

    async function takeFiles(key) {
        if (!key) return [];
        try {
            const items = await idbRun('readonly', function (s) { return s.get(key); });
            if (!Array.isArray(items)) return [];
            const FileCtor = root.File;
            return items.map(function (it) {
                if (!it || !it.blob) return null;
                if (typeof FileCtor === 'function') {
                    try { return new FileCtor([it.blob], it.name, { type: it.type, lastModified: it.lastModified }); } catch (_) { /* Blob */ }
                }
                return it.blob;
            }).filter(Boolean);
        } catch (_) { return []; }
    }

    async function clearFiles(key) {
        if (!key) return;
        try { await idbRun('readwrite', function (s) { return s.delete(key); }); } catch (_) { /* sin IndexedDB */ }
    }

    // ---------------- Supabase ----------------

    async function resend(client, email, redirectTo) {
        const auth = client && client.auth;
        if (!auth || typeof auth.resend !== 'function') {
            return { ok: false, message: 'El reenvío de email no está disponible en este entorno.' };
        }
        const payload = { type: 'signup', email: String(email || '').trim().toLowerCase() };
        if (redirectTo) payload.options = { emailRedirectTo: redirectTo };
        try {
            const res = await auth.resend(payload);
            if (res && res.error) return { ok: false, message: resendErrorMessage(res.error), error: res.error };
            return { ok: true, message: 'Te enviamos un nuevo email. Revisa también la carpeta de spam.' };
        } catch (err) {
            return { ok: false, message: resendErrorMessage(err), error: err };
        }
    }

    // ---------------- UI (DS) ----------------

    function ensureStyles() {
        const doc = root && root.document;
        if (!doc || !doc.head || doc.querySelector('link[data-wo-email-confirm-css]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = basePath() + '/shared/css/email-confirmation.css';
        link.setAttribute('data-wo-email-confirm-css', '');
        doc.head.appendChild(link);
    }

    function hydrateIcons(el) {
        if (root.WoIcons && typeof root.WoIcons.hydrate === 'function') {
            try { root.WoIcons.hydrate(el); } catch (_) { /* íconos opcionales */ }
        }
    }

    // Botón "Reenviar email" con cuenta regresiva (rate limit de Supabase: 60 s).
    function wireResend(button, status, opts) {
        let lastSentAt = Number(opts.sentAt || 0);
        let timer = null;
        const label = button.textContent;
        function tick() {
            const left = cooldownLeft(lastSentAt, Date.now());
            if (left > 0) {
                button.disabled = true;
                button.textContent = 'Reenviar en ' + left + ' s';
                timer = setTimeout(tick, 1000);
            } else {
                button.disabled = false;
                button.textContent = label;
                timer = null;
            }
        }
        button.addEventListener('click', async function () {
            if (button.disabled) return;
            button.disabled = true;
            status.className = 'wo-ec-status';
            status.textContent = 'Enviando…';
            let res;
            try {
                res = opts.onResend
                    ? await opts.onResend()
                    : await resend(opts.client, opts.email, opts.redirectTo);
            } catch (err) {
                res = { ok: false, message: resendErrorMessage(err) };
            }
            res = res || { ok: false, message: resendErrorMessage(null) };
            status.className = 'wo-ec-status ' + (res.ok ? 'is-success' : 'is-error');
            status.textContent = res.message || '';
            if (res.ok || (res.error && isRateLimitError(res.error))) lastSentAt = Date.now();
            if (timer) clearTimeout(timer);
            tick();
        });
        if (lastSentAt) tick();
    }

    /**
     * Estado "Revisa tu email para confirmar la cuenta".
     * opts: { email, client?, redirectTo?, onResend?, onChangeEmail?(newEmail|undefined),
     *         title?, lead?, note?, eyebrow?, sentAt?, changeEmailMode?: 'callback'|'inline',
     *         extraHtml? }
     */
    function renderPending(container, opts) {
        if (!container) return null;
        const o = opts || {};
        ensureStyles();
        const email = String(o.email || '').trim();
        const headingId = 'wo-ec-title-' + Math.random().toString(36).slice(2, 8);
        container.innerHTML =
            '<section class="wo-ec" role="region" aria-labelledby="' + headingId + '">' +
                '<span class="wo-marks wo-ec-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>' +
                '<p class="wo-eyebrow wo-ec-eyebrow">' + escapeHtml(o.eyebrow || 'Último paso · Confirma tu email') + '</p>' +
                '<h2 class="wo-h2 wo-ec-title" id="' + headingId + '" tabindex="-1">' + escapeHtml(o.title || 'Revisa tu email para confirmar la cuenta') + '</h2>' +
                '<p class="wo-ec-lead">' + (o.lead ? o.lead : 'Te enviamos un link a <strong class="wo-ec-email">' + escapeHtml(email) + '</strong>. Ábrelo desde este navegador para activar tu cuenta.') + '</p>' +
                (o.note ? '<p class="wo-ec-note"><i data-wo-icon="save" class="wo-icon-18" aria-hidden="true"></i><span>' + o.note + '</span></p>' : '') +
                (o.extraHtml || '') +
                '<ul class="wo-ec-tips">' +
                    '<li>¿No llegó? Revisa spam y promociones.</li>' +
                    '<li>El link vence en 24 horas. Puedes pedir otro cuando quieras.</li>' +
                '</ul>' +
                '<div class="wo-ec-actions">' +
                    '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-ec-resend>Reenviar email</button>' +
                    (o.onChangeEmail ? '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-ec-change>Cambiar email</button>' : '') +
                '</div>' +
                (o.onChangeEmail && o.changeEmailMode === 'inline'
                    ? '<form class="wo-ec-change" data-ec-change-form hidden novalidate>' +
                        '<label class="wo-label" for="' + headingId + '-email">Email correcto</label>' +
                        '<div class="wo-ec-change-row">' +
                            '<input type="email" class="wo-input" id="' + headingId + '-email" autocomplete="email" required value="' + escapeHtml(email) + '">' +
                            '<button type="submit" class="wo-btn wo-btn--ink wo-btn--s">Usar este email</button>' +
                        '</div>' +
                      '</form>'
                    : '') +
                '<p class="wo-ec-status" role="status" aria-live="polite" data-ec-status></p>' +
            '</section>';

        const status = container.querySelector('[data-ec-status]');
        wireResend(container.querySelector('[data-ec-resend]'), status, {
            client: o.client, email: email, redirectTo: o.redirectTo, onResend: o.onResend, sentAt: o.sentAt || Date.now()
        });
        const change = container.querySelector('[data-ec-change]');
        if (change) {
            const form = container.querySelector('[data-ec-change-form]');
            change.addEventListener('click', function () {
                if (!form) { o.onChangeEmail(); return; }
                form.hidden = false;
                const input = form.querySelector('input');
                if (input) { input.focus(); input.select(); }
            });
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    const input = form.querySelector('input');
                    const next = String(input.value || '').trim().toLowerCase();
                    if (!isValidEmail(next)) {
                        status.className = 'wo-ec-status is-error';
                        status.textContent = 'Escribe un email válido.';
                        input.focus();
                        return;
                    }
                    o.onChangeEmail(next);
                });
            }
        }
        hydrateIcons(container);
        const heading = container.querySelector('#' + headingId);
        if (heading && o.focus !== false) {
            try { heading.focus({ preventScroll: false }); } catch (_) { /* noop */ }
        }
        // ── registro (ronda 2 · N4): opts.watch = { key, userId?, statusUrl?,
        // onConfirmed } deja a esta pestaña atenta a la confirmación.
        if (o.watch && o.watch.key && typeof o.watch.onConfirmed === 'function') {
            if (container.__woEcWatcher) { try { container.__woEcWatcher.stop(); } catch (_) { /* noop */ } }
            container.__woEcWatcher = watchConfirmation({
                key: o.watch.key, client: o.client, email: email, userId: o.watch.userId,
                statusUrl: o.watch.statusUrl, onConfirmed: o.watch.onConfirmed
            });
        }
        return container.firstElementChild;
    }

    /**
     * Aviso del login cuando Supabase responde "Email not confirmed".
     * opts: { email, client?, redirectTo?, onResend? }
     */
    function renderLoginNotice(container, opts) {
        if (!container) return null;
        const o = opts || {};
        ensureStyles();
        container.innerHTML =
            '<div class="wo-ec-notice" role="alert">' +
                '<p class="wo-ec-notice-title">Confirma tu email para ingresar</p>' +
                '<p class="wo-ec-notice-text">Tu cuenta' + (o.email ? ' <strong>' + escapeHtml(o.email) + '</strong>' : '') +
                    ' todavía no está confirmada. Abre el link que te enviamos por email (revisa spam).</p>' +
                '<div class="wo-ec-actions">' +
                    '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-ec-resend>Reenviar email</button>' +
                '</div>' +
                '<p class="wo-ec-status" role="status" aria-live="polite" data-ec-status></p>' +
            '</div>';
        container.hidden = false;
        if (container.style) container.style.display = '';
        wireResend(container.querySelector('[data-ec-resend]'), container.querySelector('[data-ec-status]'), {
            client: o.client, email: o.email, redirectTo: o.redirectTo, onResend: o.onResend
        });
        return container.firstElementChild;
    }

    /**
     * Aviso de link vencido o ya usado (DS). opts: { linkError, what?, hint?,
     * actions?: [{ label, onClick?(statusEl, button), href?, kind? }], focus? }
     */
    function renderLinkErrorNotice(container, opts) {
        if (!container) return null;
        const o = opts || {};
        const copy = linkErrorCopy(o.linkError || { expired: true }, { what: o.what, hint: o.hint });
        ensureStyles();
        const actions = Array.isArray(o.actions) ? o.actions : [];
        container.innerHTML =
            '<div class="wo-ec-notice wo-ec-notice--link" role="alert">' +
                '<p class="wo-ec-notice-title">' + escapeHtml(copy.title) + '</p>' +
                '<p class="wo-ec-notice-text">' + escapeHtml(copy.text) + '</p>' +
                (actions.length ? '<div class="wo-ec-actions">' + actions.map(function (a, i) {
                    const cls = 'wo-btn wo-btn--' + (a.kind || (i === 0 ? 'secondary' : 'ghost')) + ' wo-btn--s';
                    return a.href
                        ? '<a class="' + cls + '" href="' + escapeHtml(a.href) + '" data-ec-action="' + i + '">' + escapeHtml(a.label) + '</a>'
                        : '<button type="button" class="' + cls + '" data-ec-action="' + i + '">' + escapeHtml(a.label) + '</button>';
                }).join('') + '</div>' : '') +
                '<p class="wo-ec-status" role="status" aria-live="polite" data-ec-status></p>' +
            '</div>';
        container.hidden = false;
        if (container.style) container.style.display = '';
        const status = container.querySelector('[data-ec-status]');
        actions.forEach(function (a, i) {
            const el = container.querySelector('[data-ec-action="' + i + '"]');
            if (el && typeof a.onClick === 'function') {
                el.addEventListener('click', function (event) {
                    if (!a.href) event.preventDefault();
                    a.onClick(status, el);
                });
            }
        });
        return container.firstElementChild;
    }

    // =====================================================================
    // ── registro (ronda 2 · N4) ── continuar en la pestaña que espera
    // =====================================================================
    // El link "Confirmar mi email" se abre en otra pestaña. La pestaña original
    // ("Falta confirmar email") se entera sola y sigue ahí; la del link muestra
    // "Listo, ya puedes cerrar esta pestaña". Canales (todos opcionales):
    //   · BroadcastChannel + evento `storage`  → aviso inmediato entre pestañas;
    //   · sesión de Supabase en este navegador → polling liviano (sin red);
    //   · GET statusUrl ({ confirmed })        → link abierto en otro navegador
    //     o en el teléfono (polling espaciado).
    const CHANNEL_NAME = 'weotzi-email-confirm';
    const SIGNAL_PREFIX = PENDING_PREFIX + 'signal:';
    const SESSION_POLL_MS = 3000;
    const STATUS_POLL_MS = 12000;
    const STATUS_POLL_SLOW_MS = 30000;
    const STATUS_POLL_SLOW_AFTER_MS = 10 * 60 * 1000;
    const WATCH_MAX_MS = 45 * 60 * 1000;
    const HANDOFF_WAIT_MS = 2500;
    const CLAIM_TTL_MS = 3 * 60 * 1000;
    const TAB_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    function sessionMatches(session, who) {
        const user = session && session.user;
        if (!user || !who) return false;
        if (who.userId && user.id === who.userId) return true;
        const a = String(user.email || '').trim().toLowerCase();
        const b = String(who.email || '').trim().toLowerCase();
        return Boolean(a && b && a === b);
    }

    // Qué hace la pestaña que abrió el link de confirmación. Lógica pura:
    //   'ignore'    no es una vuelta del link ni hay nada pendiente
    //   'login'     el link no abrió sesión (otro navegador o link vencido)
    //   'dashboard' sesión de otra cuenta o sin nada pendiente: al panel
    //   'handoff'   hay una pestaña esperando: esa termina y esta se cierra
    //   'complete'  no hay pestaña esperando: esta termina el alta
    function linkTabAction(o) {
        const s = o || {};
        if (!s.confirmed && !s.hasPending) return 'ignore';
        if (!s.hasSession) return s.confirmed ? 'login' : 'ignore';
        if (!s.sameAccount) return s.confirmed ? 'dashboard' : 'ignore';
        if (s.waitingTab || s.claimedElsewhere) return 'handoff';
        return 'complete';
    }

    function openChannel() {
        try {
            return typeof root.BroadcastChannel === 'function' ? new root.BroadcastChannel(CHANNEL_NAME) : null;
        } catch (_) { return null; }
    }

    function writeSignal(kind, key, extra) {
        const s = storage();
        if (!s) return;
        try {
            s.setItem(SIGNAL_PREFIX + kind + ':' + key, JSON.stringify(Object.assign({ at: Date.now(), tab: TAB_ID }, extra || {})));
        } catch (_) { /* sin storage: queda el canal */ }
    }

    function readSignal(kind, key) {
        const s = storage();
        if (!s) return null;
        try { return JSON.parse(s.getItem(SIGNAL_PREFIX + kind + ':' + key) || 'null'); } catch (_) { return null; }
    }

    // Una sola pestaña termina el alta pendiente: la que la reclama primero.
    function claimPending(key, store, now) {
        const rec = readPending(key, store);
        if (!rec) return false;
        const t = Number(now || Date.now());
        if (rec.claimedBy && rec.claimedBy !== TAB_ID && t - Number(rec.claimedAt || 0) < CLAIM_TTL_MS) return false;
        rec.claimedBy = TAB_ID;
        rec.claimedAt = t;
        return savePending(key, rec, store);
    }

    function isClaimedElsewhere(rec, now) {
        if (!rec || !rec.claimedBy || rec.claimedBy === TAB_ID) return false;
        return Number(now || Date.now()) - Number(rec.claimedAt || 0) < CLAIM_TTL_MS;
    }

    /**
     * Pestaña en espera: avisa una sola vez cuando el email quedó confirmado.
     * opts: { key, client?, email?, userId?, statusUrl?, onConfirmed({ session, via }) }
     * Devuelve { stop() }.
     */
    function watchConfirmation(opts) {
        const o = opts || {};
        const who = { userId: o.userId || null, email: o.email || null };
        const startedAt = Date.now();
        let stopped = false;
        let lastStatusAt = 0;
        let checking = false;
        const channel = openChannel();
        const doc = root.document;
        let timer = null;
        let authSub = null;

        function stop() {
            stopped = true;
            if (timer) root.clearInterval(timer);
            if (channel) { try { channel.close(); } catch (_) { /* cerrado */ } }
            try { root.removeEventListener('storage', onStorage); } catch (_) { /* sin window */ }
            try { root.removeEventListener('focus', check); } catch (_) { /* sin window */ }
            if (doc) { try { doc.removeEventListener('visibilitychange', check); } catch (_) { /* sin document */ } }
            if (authSub && typeof authSub.unsubscribe === 'function') { try { authSub.unsubscribe(); } catch (_) { /* noop */ } }
        }

        function done(session, via) {
            if (stopped) return;
            stop();
            try { if (typeof o.onConfirmed === 'function') o.onConfirmed({ session: session || null, via: via }); }
            catch (err) { console.warn('[email-confirm] onConfirmed:', err && err.message); }
        }

        async function readSession() {
            const auth = o.client && o.client.auth;
            if (!auth || typeof auth.getSession !== 'function') return null;
            try {
                const res = await auth.getSession();
                const session = res && res.data && res.data.session;
                return sessionMatches(session, who) ? session : null;
            } catch (_) { return null; }
        }

        async function readStatus() {
            if (!o.statusUrl || typeof root.fetch !== 'function') return false;
            try {
                const res = await root.fetch(o.statusUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
                if (!res.ok) return false;
                const body = await res.json();
                return Boolean(body && body.confirmed === true);
            } catch (_) { return false; }
        }

        async function check(force) {
            if (stopped || checking) return;
            checking = true;
            try {
                const session = await readSession();
                if (session) { done(session, 'session'); return; }
                const now = Date.now();
                if (now - startedAt > WATCH_MAX_MS) { stop(); return; }
                const every = now - startedAt > STATUS_POLL_SLOW_AFTER_MS ? STATUS_POLL_SLOW_MS : STATUS_POLL_MS;
                const visible = !doc || doc.visibilityState !== 'hidden';
                if (force === true || (visible && now - lastStatusAt >= every)) {
                    lastStatusAt = now;
                    if (await readStatus()) done(null, 'server');
                }
            } finally { checking = false; }
        }

        function ack() {
            writeSignal('ack', o.key);
            if (channel) { try { channel.postMessage({ type: 'ack', key: o.key, tab: TAB_ID }); } catch (_) { /* canal cerrado */ } }
        }

        function onStorage(event) {
            if (!event || event.key !== SIGNAL_PREFIX + 'confirmed:' + o.key || !event.newValue) return;
            ack();
            check(true);
        }

        if (channel) {
            channel.onmessage = function (event) {
                const msg = event && event.data;
                if (!msg || msg.key !== o.key || msg.tab === TAB_ID) return;
                if (msg.type === 'confirmed' || msg.type === 'ping') { ack(); check(msg.type === 'confirmed'); }
            };
        }
        try { root.addEventListener('storage', onStorage); } catch (_) { /* sin window */ }
        try { root.addEventListener('focus', check); } catch (_) { /* sin window */ }
        if (doc) { try { doc.addEventListener('visibilitychange', check); } catch (_) { /* sin document */ } }
        try {
            const auth = o.client && o.client.auth;
            if (auth && typeof auth.onAuthStateChange === 'function') {
                const res = auth.onAuthStateChange(function (event, session) {
                    // Fuera del callback: supabase-js no admite llamadas a auth aquí adentro.
                    if (session && sessionMatches(session, who)) root.setTimeout(function () { done(session, 'session'); }, 0);
                });
                authSub = res && res.data && res.data.subscription;
            }
        } catch (_) { /* sin eventos de auth: queda el polling */ }
        timer = root.setInterval(check, SESSION_POLL_MS);
        return { stop: stop, check: check };
    }

    /**
     * Pestaña del link: avisa que el email quedó confirmado y espera a que una
     * pestaña en espera lo reciba. Resuelve true si hay una (ella termina).
     */
    function announceConfirmed(key, info, waitMs) {
        return new Promise(function (resolve) {
            const since = Date.now();
            const channel = openChannel();
            let settled = false;
            let timer = null;
            let poll = null;
            function finish(value) {
                if (settled) return;
                settled = true;
                if (timer) root.clearTimeout(timer);
                if (poll) root.clearInterval(poll);
                try { root.removeEventListener('storage', onStorage); } catch (_) { /* sin window */ }
                if (channel) { try { channel.close(); } catch (_) { /* cerrado */ } }
                resolve(value);
            }
            function acked() {
                const sig = readSignal('ack', key);
                return Boolean(sig && sig.tab !== TAB_ID && Number(sig.at) >= since - 50);
            }
            function onStorage(event) {
                if (event && event.key === SIGNAL_PREFIX + 'ack:' + key && acked()) finish(true);
            }
            if (channel) {
                channel.onmessage = function (event) {
                    const msg = event && event.data;
                    if (msg && msg.type === 'ack' && msg.key === key && msg.tab !== TAB_ID) finish(true);
                };
            }
            try { root.addEventListener('storage', onStorage); } catch (_) { /* sin window */ }
            writeSignal('confirmed', key, { userId: (info && info.userId) || null });
            if (channel) {
                try { channel.postMessage({ type: 'confirmed', key: key, tab: TAB_ID, userId: (info && info.userId) || null }); }
                catch (_) { /* canal cerrado */ }
            }
            poll = root.setInterval(function () { if (acked()) finish(true); }, 150);
            timer = root.setTimeout(function () { finish(false); }, typeof waitMs === 'number' ? waitMs : HANDOFF_WAIT_MS);
        });
    }

    function tryCloseTab() {
        try { root.close(); } catch (_) { /* el navegador decide */ }
    }

    /**
     * Estados posteriores a la confirmación (DS):
     *   state 'confirmed' → "Email confirmado" + qué sigue (pestaña que espera)
     *   state 'close'     → "Listo, ya puedes cerrar esta pestaña" (la del link)
     * opts: { state, title?, text?, busyText?, action?: { label, href }, focus? }
     */
    function renderConfirmed(container, opts) {
        if (!container) return null;
        const o = opts || {};
        ensureStyles();
        const close = o.state === 'close';
        const headingId = 'wo-ec-done-' + Math.random().toString(36).slice(2, 8);
        const title = o.title || (close ? 'Listo, ya puedes cerrar esta pestaña' : 'Email confirmado');
        const text = o.text || (close
            ? 'Tu email quedó confirmado. Tu registro continúa en la pestaña donde lo empezaste.'
            : 'Tu cuenta ya está activa. Te llevamos a tu panel.');
        container.innerHTML =
            '<section class="wo-ec wo-ec--done" role="status" aria-live="polite" aria-labelledby="' + headingId + '">' +
                '<span class="wo-ec-done-mark" aria-hidden="true"><i data-wo-icon="check" class="wo-icon-18"></i></span>' +
                '<p class="wo-eyebrow wo-ec-eyebrow">' + escapeHtml(o.eyebrow || 'Confirmación de email') + '</p>' +
                '<h2 class="wo-h2 wo-ec-title" id="' + headingId + '" tabindex="-1">' + escapeHtml(title) + '</h2>' +
                '<p class="wo-ec-lead">' + escapeHtml(text) + '</p>' +
                (o.busyText ? '<p class="wo-ec-busy"><span class="wo-spinner" aria-hidden="true"></span><span data-ec-busy>' + escapeHtml(o.busyText) + '</span></p>' : '') +
                '<div class="wo-ec-actions">' +
                    (close ? '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-ec-close>Cerrar esta pestaña</button>' : '') +
                    (o.action && o.action.href ? '<a class="wo-btn wo-btn--' + (close ? 'ghost' : 'secondary') + ' wo-btn--s" href="' + escapeHtml(o.action.href) + '">' + escapeHtml(o.action.label || 'Continuar') + '</a>' : '') +
                '</div>' +
                (close ? '<p class="wo-ec-status" data-ec-close-hint hidden>Si la pestaña no se cierra sola, ciérrala desde el navegador.</p>' : '') +
            '</section>';
        const closeBtn = container.querySelector('[data-ec-close]');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                tryCloseTab();
                const hint = container.querySelector('[data-ec-close-hint]');
                if (hint) root.setTimeout(function () { hint.hidden = false; }, 300);
            });
        }
        hydrateIcons(container);
        const heading = container.querySelector('#' + headingId);
        if (heading && o.focus !== false) {
            try { heading.focus({ preventScroll: false }); } catch (_) { /* noop */ }
        }
        return container.firstElementChild;
    }

    return {
        // ── registro (ronda 2 · N4)
        TAB_ID: TAB_ID,
        sessionMatches: sessionMatches,
        linkTabAction: linkTabAction,
        claimPending: claimPending,
        isClaimedElsewhere: isClaimedElsewhere,
        watchConfirmation: watchConfirmation,
        announceConfirmed: announceConfirmed,
        renderConfirmed: renderConfirmed,
        tryCloseTab: tryCloseTab,
        RESEND_COOLDOWN_SECONDS: RESEND_COOLDOWN_SECONDS,
        isNeutralOtpError: isNeutralOtpError,
        magicLinkOutcome: magicLinkOutcome,
        parseAuthLinkError: parseAuthLinkError,
        linkErrorCopy: linkErrorCopy,
        readAuthLinkError: readAuthLinkError,
        renderLinkErrorNotice: renderLinkErrorNotice,
        PENDING_MAX_AGE_MS: PENDING_MAX_AGE_MS,
        needsConfirmation: needsConfirmation,
        isExistingAccountSignup: isExistingAccountSignup,
        isEmailNotConfirmedError: isEmailNotConfirmedError,
        isRateLimitError: isRateLimitError,
        resendErrorMessage: resendErrorMessage,
        cooldownLeft: cooldownLeft,
        isValidEmail: isValidEmail,
        redirectUrl: redirectUrl,
        escapeHtml: escapeHtml,
        savePending: savePending,
        readPending: readPending,
        clearPending: clearPending,
        stashFiles: stashFiles,
        takeFiles: takeFiles,
        clearFiles: clearFiles,
        resend: resend,
        renderPending: renderPending,
        renderLoginNotice: renderLoginNotice
    };
});
