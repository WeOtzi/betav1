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
//   renderPending(container, opts)     → estado "Revisá tu email" (DS)
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
        if (isRateLimitError(err)) return 'Ya te enviamos un email hace muy poco. Esperá un minuto y probá de nuevo.';
        if (/already confirmed|email_confirmed/i.test(String((err && err.message) || ''))) {
            return 'Tu email ya está confirmado. Ya podés ingresar.';
        }
        return 'No pudimos reenviar el email. Probá de nuevo en unos minutos.';
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
            return { ok: true, message: 'Te enviamos un nuevo email. Revisá también la carpeta de spam.' };
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
     * Estado "Revisá tu email para confirmar la cuenta".
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
                '<p class="wo-eyebrow wo-ec-eyebrow">' + escapeHtml(o.eyebrow || 'Último paso · Confirmá tu email') + '</p>' +
                '<h2 class="wo-h2 wo-ec-title" id="' + headingId + '" tabindex="-1">' + escapeHtml(o.title || 'Revisá tu email para confirmar la cuenta') + '</h2>' +
                '<p class="wo-ec-lead">' + (o.lead ? o.lead : 'Te enviamos un link a <strong class="wo-ec-email">' + escapeHtml(email) + '</strong>. Abrilo desde este navegador para activar tu cuenta.') + '</p>' +
                (o.note ? '<p class="wo-ec-note"><i data-wo-icon="save" class="wo-icon-18" aria-hidden="true"></i><span>' + o.note + '</span></p>' : '') +
                (o.extraHtml || '') +
                '<ul class="wo-ec-tips">' +
                    '<li>¿No llegó? Revisá spam y promociones.</li>' +
                    '<li>El link vence en 24 horas. Podés pedir otro cuando quieras.</li>' +
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
                        status.textContent = 'Escribí un email válido.';
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
                '<p class="wo-ec-notice-title">Confirmá tu email para ingresar</p>' +
                '<p class="wo-ec-notice-text">Tu cuenta' + (o.email ? ' <strong>' + escapeHtml(o.email) + '</strong>' : '') +
                    ' todavía no está confirmada. Abrí el link que te enviamos por email (revisá spam).</p>' +
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

    return {
        RESEND_COOLDOWN_SECONDS: RESEND_COOLDOWN_SECONDS,
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
