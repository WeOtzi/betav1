// ============================================================================
// We Ötzi · Denuncias (ronda 2 · frente "denuncias", P33)
// ----------------------------------------------------------------------------
// Activa cualquier
//   <button data-wo-report data-kind="quotation|artist|studio" data-id="…" data-label="…">
// que esté en la página o que se agregue después. Contrato entre frentes: las
// pantallas solo dejan el botón (puede ir vacío); este módulo
//   · decide quién lo ve (GET /api/reports/eligibility): el artista en una
//     cotización que recibió, un artista en el perfil de OTRO artista y el
//     dueño o manager de un estudio en el perfil de OTRO estudio;
//   · abre el modal: motivo según el tipo, descripción obligatoria, evidencia
//     opcional (enlaces y hasta 3 imágenes al bucket privado
//     `support-attachments`), confirmación y acuse con el número de ticket;
//   · envía la denuncia a POST /api/reports (lib/routes/denuncias.js), que
//     crea el ticket de soporte con el expediente completo.
// Carga sus estilos solo (/shared/css/wo-report.css). Basta con incluir este
// script: usa el cliente de Supabase de la página (ConfigManager).
// API: window.WoReport.open({ kind, id, label }) · .refresh() · .close()
// Al enviar dispara en document el CustomEvent 'wo:report-submitted'.
// En Node (tests) solo exporta los helpers puros.
// ============================================================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root && root.document && !root.__woReportBooted) {
        root.__woReportBooted = true;
        root.WoReport = api;
        api.boot();
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    // ---------------------------------------------------------------
    // Catálogo y límites (espejo de lib/denuncias.js; un test los compara)
    // ---------------------------------------------------------------
    const KINDS = ['quotation', 'artist', 'studio'];
    const QUOTATION_REASONS = [
        { code: 'comentarios_abusivos', label: 'Comentarios abusivos' },
        { code: 'fotos_inapropiadas', label: 'Fotos inapropiadas' },
        { code: 'violencia', label: 'Violencia' },
        { code: 'spam', label: 'Spam' }
    ];
    const PROFILE_REASONS = [
        { code: 'suplantacion_identidad', label: 'Suplantación de identidad' },
        { code: 'robo_propiedad_intelectual', label: 'Robo de propiedad intelectual' },
        { code: 'difamacion', label: 'Difamación' }
    ];
    const REASONS = { quotation: QUOTATION_REASONS, artist: PROFILE_REASONS, studio: PROFILE_REASONS };
    const TITLES = { quotation: 'Denunciar cotización', artist: 'Denunciar artista', studio: 'Denunciar estudio' };
    const DESCRIPTION_MIN = 20;
    const DESCRIPTION_MAX = 3000;
    const MAX_LINKS = 5;
    const MAX_LINK_LENGTH = 500;
    const MAX_IMAGES = 3;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    const EXT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
    const BUCKET = 'support-attachments';
    const FOLDER = 'denuncias';
    const STEPS = ['reason', 'evidence', 'confirm'];
    const STEP_LABELS = { reason: 'Paso 1 de 3 · Motivo', evidence: 'Paso 2 de 3 · Evidencia', confirm: 'Paso 3 de 3 · Confirmación' };
    const CSS_HREF = '/shared/css/wo-report.css?v=20261116-denuncias';

    const MSG = {
        trigger: 'Denunciar',
        login: 'Inicia sesión para enviar una denuncia.',
        unavailable: 'No puedes enviar esta denuncia desde tu cuenta.',
        checking: 'Comprobando si puedes enviar esta denuncia…',
        reason: 'Elige el motivo de la denuncia.',
        descriptionShort: 'Cuéntanos qué pasó con al menos ' + DESCRIPTION_MIN + ' caracteres.',
        descriptionLong: 'La descripción puede tener hasta ' + DESCRIPTION_MAX + ' caracteres.',
        linkInvalid: 'Revisa los enlaces: cada uno debe ser una dirección completa que empiece con https://',
        linkMany: 'Puedes agregar hasta ' + MAX_LINKS + ' enlaces.',
        fileType: 'Solo se admiten imágenes JPG, PNG, WEBP o HEIC.',
        fileSize: 'Cada imagen puede pesar hasta 10 MB.',
        fileEmpty: 'El archivo está vacío.',
        fileMany: 'Puedes adjuntar hasta ' + MAX_IMAGES + ' imágenes.',
        confirm: 'Marca la casilla para confirmar la denuncia.',
        upload: 'No pudimos subir una de las imágenes. Revisa tu conexión e inténtalo de nuevo.',
        generic: 'No pudimos enviar tu denuncia. Inténtalo de nuevo en unos minutos.',
        offline: 'No pudimos conectar con We Ötzi. Revisa tu conexión e inténtalo de nuevo.'
    };

    const FLAG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true" focusable="false">'
        + '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/></svg>';
    const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true" focusable="false">'
        + '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true" focusable="false">'
        + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

    // ---------------------------------------------------------------
    // Helpers puros
    // ---------------------------------------------------------------
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function reasonsFor(kind) {
        return (REASONS[kind] || []).map(function (r) { return { code: r.code, label: r.label }; });
    }

    function reasonLabel(reasons, code) {
        const found = (reasons || []).find(function (r) { return r.code === code; });
        return found ? found.label : '';
    }

    function normalizeLink(raw) {
        const text = String(raw == null ? '' : raw).trim();
        if (!text || text.length > MAX_LINK_LENGTH) return null;
        // eslint-disable-next-line no-control-regex
        if (/[\u0000- \u007f<>"'`\\]/.test(text)) return null;
        let url;
        try { url = new URL(text); } catch (_) { return null; }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (!url.hostname || url.hostname.indexOf('.') < 0 || url.username || url.password) return null;
        return url.href.length <= MAX_LINK_LENGTH ? url.href : null;
    }

    // Texto libre (un enlace por línea) → { links } | { error }
    function parseLinksText(text) {
        const parts = String(text == null ? '' : text).split(/[\s,]+/).map(function (p) { return p.trim(); }).filter(Boolean);
        const links = [];
        for (let i = 0; i < parts.length; i += 1) {
            const link = normalizeLink(parts[i]);
            if (!link) return { error: MSG.linkInvalid };
            if (links.indexOf(link) < 0) links.push(link);
        }
        if (links.length > MAX_LINKS) return { error: MSG.linkMany };
        return { links: links };
    }

    function fileExt(name) {
        const match = /\.([A-Za-z0-9]{2,5})$/.exec(String(name || ''));
        return match ? match[1].toLowerCase() : '';
    }

    function fileType(file) {
        const declared = String((file && file.type) || '').toLowerCase();
        if (declared) return declared;
        return EXT_TYPES[fileExt(file && file.name)] || '';
    }

    function validateFile(file) {
        if (!file) return MSG.fileType;
        if (IMAGE_TYPES.indexOf(fileType(file)) < 0) return MSG.fileType;
        if (!file.size) return MSG.fileEmpty;
        if (file.size > MAX_IMAGE_BYTES) return MSG.fileSize;
        return null;
    }

    // Nombre apto para la ruta de Storage (solo letras, números, punto, guion).
    function safeName(name) {
        const clean = String(name || 'imagen').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
        return clean || 'imagen';
    }

    // `<user_id>/denuncias/<marca>-<azar>-<nombre>`: la policy del bucket exige la carpeta del usuario.
    function storagePath(userId, name, now, rand) {
        const stamp = String(now == null ? Date.now() : now);
        const salt = String(rand == null ? Math.random().toString(36).slice(2, 8) : rand).replace(/[^a-z0-9]/gi, '') || 'x';
        return String(userId) + '/' + FOLDER + '/' + stamp + '-' + salt + '-' + safeName(name);
    }

    function newDraft() {
        return { reason: '', description: '', linksText: '', files: [], confirmed: false };
    }

    // Valida un paso del borrador → null | { field, error }
    function validateStep(draft, step, reasons) {
        const d = draft || newDraft();
        if (step === 'reason') {
            if (!reasonLabel(reasons, d.reason)) return { field: 'reason', error: MSG.reason };
            const length = String(d.description || '').trim().length;
            if (length < DESCRIPTION_MIN) return { field: 'description', error: MSG.descriptionShort };
            if (length > DESCRIPTION_MAX) return { field: 'description', error: MSG.descriptionLong };
            return null;
        }
        if (step === 'evidence') {
            const parsed = parseLinksText(d.linksText);
            if (parsed.error) return { field: 'links', error: parsed.error };
            if ((d.files || []).length > MAX_IMAGES) return { field: 'attachments', error: MSG.fileMany };
            return null;
        }
        if (step === 'confirm') {
            return d.confirmed ? null : { field: 'confirm', error: MSG.confirm };
        }
        return null;
    }

    // Paso al que hay que volver cuando el servidor rechaza un campo.
    function stepForField(field) {
        if (field === 'reason' || field === 'description') return 'reason';
        if (field === 'links' || field === 'attachments') return 'evidence';
        return 'confirm';
    }

    function evidenceSummary(linkCount, imageCount) {
        const parts = [];
        if (linkCount) parts.push(linkCount + (linkCount === 1 ? ' enlace' : ' enlaces'));
        if (imageCount) parts.push(imageCount + (imageCount === 1 ? ' imagen' : ' imágenes'));
        return parts.length ? parts.join(' · ') : 'Sin evidencia adjunta';
    }

    function excerpt(text, max) {
        const clean = String(text || '').trim();
        return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
    }

    // ---------------------------------------------------------------
    // HTML del modal (puro: todo dato de la persona o del servidor se escapa aquí)
    // ---------------------------------------------------------------
    function triggerHtml() {
        return FLAG_ICON + '<span>' + esc(MSG.trigger) + '</span>';
    }

    function titleFor(view) {
        const v = view || {};
        if (v.step === 'done') return v.result && v.result.duplicate ? 'Ya tienes esta denuncia abierta' : 'Recibimos tu denuncia';
        return TITLES[v.kind] || 'Denunciar';
    }

    function stepsHtml(step) {
        const current = STEPS.indexOf(step);
        return STEPS.map(function (_, i) {
            return '<li class="' + (i < current ? 'is-done' : i === current ? 'is-current' : '') + '"></li>';
        }).join('');
    }

    function reasonStepHtml(draft, reasons) {
        const d = draft || newDraft();
        const radios = (reasons || []).map(function (r) {
            return '<label class="wor-reason"><input type="radio" name="wor-reason" value="' + esc(r.code) + '"'
                + (d.reason === r.code ? ' checked' : '') + '><span>' + esc(r.label) + '</span></label>';
        }).join('');
        return '<div class="wor-alert" id="wor-alert" role="alert" hidden></div>'
            + '<fieldset class="wor-fieldset" aria-describedby="wor-reason-error">'
            + '<legend class="wor-legend">Motivo <span class="wor-req" aria-hidden="true">*</span></legend>'
            + '<div class="wor-reasons">' + radios + '</div>'
            + '<p class="wor-error" id="wor-reason-error" role="alert" hidden></p>'
            + '</fieldset>'
            + '<div class="wor-field">'
            + '<label class="wor-label" for="wor-description">Cuéntanos qué pasó <span class="wor-req" aria-hidden="true">*</span></label>'
            + '<textarea id="wor-description" class="wor-input" rows="4" maxlength="' + DESCRIPTION_MAX + '" required '
            + 'aria-describedby="wor-description-help wor-description-error">' + esc(d.description) + '</textarea>'
            + '<p class="wor-help" id="wor-description-help"><span>Qué pasó, cuándo y dónde lo viste. Mínimo ' + DESCRIPTION_MIN + ' caracteres.</span>'
            + '<span class="wor-count" id="wor-count">' + String(d.description || '').length + ' / ' + DESCRIPTION_MAX + '</span></p>'
            + '<p class="wor-error" id="wor-description-error" role="alert" hidden></p>'
            + '</div>';
    }

    function filesHtml(files) {
        return (files || []).map(function (f, i) {
            const name = (f.file && f.file.name) || 'imagen';
            const thumb = f.preview
                ? '<img src="' + esc(f.preview) + '" alt="">'
                : '<span aria-hidden="true">' + esc((fileType(f.file).split('/')[1] || 'img').toUpperCase()) + '</span>';
            return '<li class="wor-file"><div class="wor-file-thumb">' + thumb + '</div>'
                + '<span class="wor-file-name" title="' + esc(name) + '">' + esc(name) + '</span>'
                + '<button type="button" class="wor-remove" data-wor-remove="' + i + '" aria-label="Quitar ' + esc(name) + '">'
                + '<span>' + CLOSE_ICON + '</span></button></li>';
        }).join('');
    }

    function evidenceStepHtml(draft) {
        const d = draft || newDraft();
        const files = d.files || [];
        const full = files.length >= MAX_IMAGES;
        return '<div class="wor-alert" id="wor-alert" role="alert" hidden></div>'
            + '<div class="wor-field">'
            + '<label class="wor-label" for="wor-links">Enlaces <span class="wor-optional">(opcional)</span></label>'
            + '<textarea id="wor-links" class="wor-input wor-input--links" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off" '
            + 'placeholder="https://" aria-describedby="wor-links-help wor-links-error">' + esc(d.linksText) + '</textarea>'
            + '<p class="wor-help" id="wor-links-help"><span>Uno por línea, hasta ' + MAX_LINKS + '. Por ejemplo, la publicación o el perfil donde lo viste.</span></p>'
            + '<p class="wor-error" id="wor-links-error" role="alert" hidden></p>'
            + '</div>'
            + '<div class="wor-field">'
            + '<span class="wor-label" id="wor-files-label">Imágenes <span class="wor-optional">(opcional)</span></span>'
            + '<ul class="wor-files" id="wor-files" aria-labelledby="wor-files-label">' + filesHtml(files) + '</ul>'
            + '<input type="file" id="wor-file-input" class="wor-file-input" accept="image/jpeg,image/png,image/webp,image/heic,.heic" multiple tabindex="-1" aria-hidden="true">'
            + '<button type="button" class="wor-btn wor-btn--ghost" data-wor-add-files aria-describedby="wor-files-help"' + (full ? ' disabled' : '') + '>Agregar imágenes</button>'
            + '<p class="wor-help" id="wor-files-help"><span>Hasta ' + MAX_IMAGES + ' imágenes JPG, PNG, WEBP o HEIC, de 10 MB como máximo cada una. Solo las ve el equipo de soporte.</span></p>'
            + '<p class="wor-error" id="wor-files-error" role="alert" hidden></p>'
            + '</div>';
    }

    function confirmStepHtml(view) {
        const v = view || {};
        const d = v.draft || newDraft();
        const links = parseLinksText(d.linksText).links || [];
        return '<div class="wor-alert" id="wor-alert" role="alert" hidden></div>'
            + '<dl class="wor-summary">'
            + '<dt>Denuncias a</dt><dd>' + esc(v.label || TITLES[v.kind] || '') + '</dd>'
            + '<dt>Motivo</dt><dd>' + esc(reasonLabel(v.reasons, d.reason)) + '</dd>'
            + '<dt>Descripción</dt><dd>' + esc(excerpt(d.description, 260)) + '</dd>'
            + '<dt>Evidencia</dt><dd>' + esc(evidenceSummary(links.length, (d.files || []).length)) + '</dd>'
            + '</dl>'
            + '<label class="wor-check"><input type="checkbox" id="wor-confirm"' + (d.confirmed ? ' checked' : '') + ' aria-describedby="wor-confirm-error">'
            + '<span>Confirmo que la información es verdadera y que envío esta denuncia de buena fe.</span></label>'
            + '<p class="wor-error" id="wor-confirm-error" role="alert" hidden></p>'
            + '<p class="wor-note">Quien recibe la denuncia no ve tu denuncia ni tus datos. El equipo de soporte de We Ötzi la revisa y puede escribirte si necesita más información.</p>';
    }

    function doneStepHtml(result) {
        const r = result || {};
        const ticket = r.ticket || {};
        const lead = r.duplicate
            ? 'Ya habías enviado esta misma denuncia y sigue abierta. Nuestro equipo de soporte la está revisando.'
            : 'Tu denuncia quedó registrada. Guarda tu número de ticket:';
        return '<div class="wor-done">'
            + '<span class="wor-done-mark" aria-hidden="true">' + CHECK_ICON + '</span>'
            + '<p class="wor-text">' + esc(lead) + '</p>'
            + (ticket.code ? '<p class="wor-ticket" aria-label="Número de ticket ' + esc(ticket.code) + '">' + esc(ticket.code) + '</p>' : '')
            + '<p class="wor-text">Nuestro equipo de soporte la va a revisar. Si necesitamos más información, te escribiremos a tu correo.</p>'
            + '</div>';
    }

    // view: { step, kind, label, draft, reasons, message, result }
    function bodyHtml(view) {
        const v = view || {};
        if (v.step === 'loading') {
            return '<p class="wor-text" role="status"><span class="wor-spinner" aria-hidden="true"></span> ' + esc(MSG.checking) + '</p>';
        }
        if (v.step === 'blocked') {
            return '<div class="wor-alert wor-alert--info" role="alert">' + esc(v.message || MSG.unavailable) + '</div>';
        }
        if (v.step === 'reason') return reasonStepHtml(v.draft, v.reasons);
        if (v.step === 'evidence') return evidenceStepHtml(v.draft);
        if (v.step === 'confirm') return confirmStepHtml(v);
        return doneStepHtml(v.result);
    }

    // view: { step, busy, status }
    function footHtml(view) {
        const v = view || {};
        const dis = v.busy ? ' disabled' : '';
        if (v.step === 'loading') return '<button type="button" class="wor-btn wor-btn--ghost" data-wor-close>Cancelar</button>';
        if (v.step === 'blocked' || v.step === 'done') return '<button type="button" class="wor-btn" data-wor-close>Cerrar</button>';
        if (v.step === 'reason') {
            return '<button type="button" class="wor-btn wor-btn--ghost" data-wor-close>Cancelar</button>'
                + '<button type="submit" class="wor-btn">Continuar</button>';
        }
        if (v.step === 'evidence') {
            return '<button type="button" class="wor-btn wor-btn--ghost" data-wor-back>Volver</button>'
                + '<button type="submit" class="wor-btn">Continuar</button>';
        }
        return '<p class="wor-status" id="wor-status" role="status" aria-live="polite">' + esc(v.status || '') + '</p>'
            + '<button type="button" class="wor-btn wor-btn--ghost" data-wor-back' + dis + '>Volver</button>'
            + '<button type="submit" class="wor-btn wor-btn--danger"' + dis + '>'
            + (v.busy ? '<span class="wor-spinner" aria-hidden="true"></span>' : '') + 'Enviar denuncia</button>';
    }

    const pure = {
        KINDS: KINDS, REASONS: REASONS, TITLES: TITLES, MSG: MSG, BUCKET: BUCKET, FOLDER: FOLDER, STEPS: STEPS,
        DESCRIPTION_MIN: DESCRIPTION_MIN, DESCRIPTION_MAX: DESCRIPTION_MAX, MAX_LINKS: MAX_LINKS, MAX_IMAGES: MAX_IMAGES,
        MAX_IMAGE_BYTES: MAX_IMAGE_BYTES, IMAGE_TYPES: IMAGE_TYPES,
        esc: esc, reasonsFor: reasonsFor, reasonLabel: reasonLabel, normalizeLink: normalizeLink, parseLinksText: parseLinksText,
        fileType: fileType, validateFile: validateFile, safeName: safeName, storagePath: storagePath, newDraft: newDraft,
        validateStep: validateStep, stepForField: stepForField, evidenceSummary: evidenceSummary, excerpt: excerpt,
        triggerHtml: triggerHtml, titleFor: titleFor, stepsHtml: stepsHtml, reasonStepHtml: reasonStepHtml, filesHtml: filesHtml,
        evidenceStepHtml: evidenceStepHtml, confirmStepHtml: confirmStepHtml, doneStepHtml: doneStepHtml, bodyHtml: bodyHtml, footHtml: footHtml
    };

    const doc = root && root.document;
    if (!doc) {
        return { boot: function () {}, open: function () { return Promise.resolve(false); }, refresh: function () {}, close: function () {}, _internal: pure };
    }

    // ---------------------------------------------------------------
    // Sesión y red
    // ---------------------------------------------------------------
    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    async function getClient() {
        const CM = root.ConfigManager;
        if (CM && typeof CM.ready === 'function') {
            // La configuración llega del servidor: se espera, pero nunca indefinidamente.
            try {
                await Promise.race([CM.ready(), new Promise(function (resolve) { root.setTimeout(resolve, 8000); })]);
            } catch (_) { /* seguimos con lo que haya */ }
        }
        try {
            if (CM && typeof CM.getSupabaseClient === 'function') {
                const client = CM.getSupabaseClient();
                if (client) return client;
            }
        } catch (_) { /* probamos el siguiente */ }
        return root._supabase || null;
    }

    async function getSession() {
        try {
            const client = await getClient();
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
            const res = await client.auth.getSession();
            const session = res && res.data && res.data.session;
            return session && session.user && session.access_token ? session : null;
        } catch (_) {
            return null;
        }
    }

    async function request(method, path, body, session) {
        const s = session || await getSession();
        if (!s) return { ok: false, status: 401, json: { code: 'AUTH_REQUIRED', error: MSG.login } };
        try {
            const res = await root.fetch(basePath() + path, {
                method: method,
                headers: Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + s.access_token },
                    body ? { 'Content-Type': 'application/json' } : {}),
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const json = await res.json().catch(function () { return {}; });
            return { ok: res.ok && !!(json && json.success), status: res.status, json: json || {} };
        } catch (_) {
            return { ok: false, status: 0, json: { error: MSG.offline } };
        }
    }

    // ---------------------------------------------------------------
    // Elegibilidad (una consulta por objetivo y por sesión)
    // ---------------------------------------------------------------
    const eligibilityCache = new Map();

    async function fetchEligibility(kind, id) {
        const session = await getSession();
        if (!session) return { eligible: false, code: 'AUTH_REQUIRED', message: MSG.login, transient: true };
        const res = await request('GET', '/api/reports/eligibility?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id), null, session);
        if (res.status === 401) return { eligible: false, code: 'AUTH_REQUIRED', message: MSG.login, transient: true };
        if (!res.ok) {
            // Sin respuesta clara del servidor el botón no se muestra; no se guarda, para reintentar.
            return { eligible: false, code: 'UNAVAILABLE', message: (res.json && res.json.error) || MSG.offline, transient: true };
        }
        return res.json;
    }

    function eligibility(kind, id) {
        const key = kind + ':' + id;
        if (!eligibilityCache.has(key)) {
            const promise = fetchEligibility(kind, id).then(function (info) {
                if (info && info.transient && eligibilityCache.get(key) === promise) eligibilityCache.delete(key);
                return info;
            }, function () {
                if (eligibilityCache.get(key) === promise) eligibilityCache.delete(key);
                return { eligible: false, code: 'UNAVAILABLE', message: MSG.offline };
            });
            eligibilityCache.set(key, promise);
        }
        return eligibilityCache.get(key);
    }

    // ---------------------------------------------------------------
    // Botones [data-wo-report]
    // ---------------------------------------------------------------
    function buttonTarget(btn) {
        const kind = String(btn.getAttribute('data-kind') || '').trim();
        const id = String(btn.getAttribute('data-id') || '').trim();
        return KINDS.indexOf(kind) >= 0 && id ? { kind: kind, id: id, key: kind + ':' + id } : null;
    }

    function setVisible(btn, visible) {
        btn.setAttribute('data-wo-report-state', visible ? 'ready' : 'hidden');
        if (visible) {
            btn.hidden = false;
            if (btn.__worHid) { btn.style.display = ''; btn.__worHid = false; }
        } else {
            btn.hidden = true;
            if (btn.style.display !== 'none') { btn.style.display = 'none'; btn.__worHid = true; }
        }
    }

    function decorate(btn) {
        if (btn.tagName === 'BUTTON' && !btn.getAttribute('type')) btn.setAttribute('type', 'button');
        btn.setAttribute('aria-haspopup', 'dialog');
        // Botón vacío (contrato entre frentes): este módulo le pone ícono y texto.
        if (!btn.children.length && !btn.textContent.trim()) {
            btn.classList.add('wor-trigger');
            btn.innerHTML = triggerHtml();
            btn.__worFilled = true;
        }
        // El nombre accesible incluye a quién se denuncia (solo en botones que completó este módulo).
        if (btn.__worFilled && (btn.__worAria || !btn.getAttribute('aria-label'))) {
            const label = String(btn.getAttribute('data-label') || '').trim();
            if (label) { btn.setAttribute('aria-label', MSG.trigger + ': ' + label); btn.__worAria = true; }
        }
    }

    async function evaluate(btn) {
        const target = buttonTarget(btn);
        if (!target) { btn.__worKey = ''; setVisible(btn, false); return; }
        if (btn.__worKey === target.key) return;
        btn.__worKey = target.key;
        decorate(btn);
        setVisible(btn, false);
        const info = await eligibility(target.kind, target.id);
        if (btn.__worKey !== target.key || !btn.isConnected) return;
        setVisible(btn, !!(info && info.eligible));
    }

    function scan(force) {
        const buttons = doc.querySelectorAll('[data-wo-report]');
        for (let i = 0; i < buttons.length; i += 1) {
            if (force) buttons[i].__worKey = null;
            evaluate(buttons[i]);
        }
    }

    let scanTimer = null;
    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = root.setTimeout(function () { scanTimer = null; scan(false); }, 60);
    }

    function refresh() {
        eligibilityCache.clear();
        scan(true);
    }

    // ---------------------------------------------------------------
    // Modal
    // ---------------------------------------------------------------
    const drafts = new Map();
    let dialog = null;
    let fallbackBackdrop = null;
    let state = null;
    let opener = null;
    let previousOverflow = null;

    function $(id) { return doc.getElementById(id); }

    function ensureStyles() {
        if (doc.querySelector('link[data-wo-report-css], link[href*="wo-report.css"]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = basePath() + CSS_HREF;
        link.setAttribute('data-wo-report-css', '');
        (doc.head || doc.documentElement).appendChild(link);
    }

    function ensureDialog() {
        if (dialog) return dialog;
        dialog = doc.createElement('dialog');
        dialog.id = 'wor-dialog';
        dialog.className = 'wor-dialog';
        dialog.setAttribute('aria-labelledby', 'wor-title');
        dialog.innerHTML = ''
            + '<div class="wor-head">'
            + '<div class="wor-head-text"><p class="wor-eyebrow">Denuncias</p>'
            + '<h2 class="wor-title" id="wor-title" tabindex="-1"></h2><p class="wor-target" id="wor-target"></p></div>'
            + '<button type="button" class="wor-close" data-wor-close aria-label="Cerrar">' + CLOSE_ICON + '</button>'
            + '</div>'
            + '<ol class="wor-steps" id="wor-steps" aria-hidden="true"></ol>'
            + '<p class="wor-step-label" id="wor-step-label"></p>'
            + '<form class="wor-form" id="wor-form" novalidate>'
            + '<div class="wor-body" id="wor-body"></div>'
            + '<div class="wor-foot" id="wor-foot"></div>'
            + '</form>';
        doc.body.appendChild(dialog);
        dialog.addEventListener('click', onDialogClick);
        dialog.addEventListener('input', onDialogInput);
        dialog.addEventListener('change', onDialogChange);
        dialog.addEventListener('cancel', function (e) { if (state && state.busy) e.preventDefault(); });
        dialog.addEventListener('close', onDialogClosed);
        dialog.addEventListener('keydown', function (e) {
            // Respaldo sin <dialog> nativo: Escape cierra.
            if (e.key === 'Escape' && dialog.classList.contains('wor-dialog--fallback')) { e.preventDefault(); close(); }
        });
        $('wor-form').addEventListener('submit', function (e) { e.preventDefault(); next(); });
        return dialog;
    }

    function showDialog() {
        if (dialog.open) return;
        previousOverflow = doc.documentElement.style.overflow;
        doc.documentElement.style.overflow = 'hidden';
        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            fallbackBackdrop = doc.createElement('div');
            fallbackBackdrop.className = 'wor-fallback-backdrop';
            doc.body.insertBefore(fallbackBackdrop, dialog);
            dialog.classList.add('wor-dialog--fallback');
            dialog.setAttribute('open', '');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
        }
    }

    function onDialogClosed() {
        doc.documentElement.style.overflow = previousOverflow || '';
        previousOverflow = null;
        if (fallbackBackdrop && fallbackBackdrop.parentNode) fallbackBackdrop.parentNode.removeChild(fallbackBackdrop);
        fallbackBackdrop = null;
        const back = opener;
        opener = null;
        state = null;
        if (back && back.isConnected && typeof back.focus === 'function') {
            try { back.focus({ preventScroll: true }); } catch (_) { back.focus(); }
        }
    }

    function close() {
        if (!dialog || !dialog.open || (state && state.busy)) return;
        if (typeof dialog.close === 'function' && !dialog.classList.contains('wor-dialog--fallback')) {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
            dialog.classList.remove('wor-dialog--fallback');
            onDialogClosed();
        }
    }

    function releaseFiles(files) {
        (files || []).forEach(function (f) {
            if (f && f.preview) { try { root.URL.revokeObjectURL(f.preview); } catch (_) { /* nada */ } }
        });
    }

    function render(focusTitle) {
        if (!state || !dialog) return;
        $('wor-title').textContent = titleFor(state);
        const target = $('wor-target');
        const showTarget = !!state.label && state.step !== 'done';
        target.hidden = !showTarget;
        target.innerHTML = showTarget ? 'Vas a denunciar: <strong>' + esc(state.label) + '</strong>' : '';
        const inSteps = STEPS.indexOf(state.step) >= 0;
        const steps = $('wor-steps');
        steps.hidden = !inSteps;
        steps.innerHTML = inSteps ? stepsHtml(state.step) : '';
        const label = $('wor-step-label');
        label.hidden = !inSteps;
        label.textContent = inSteps ? STEP_LABELS[state.step] : '';
        $('wor-body').innerHTML = bodyHtml(state);
        $('wor-foot').innerHTML = footHtml(state);
        const closeBtn = dialog.querySelector('.wor-close');
        if (closeBtn) closeBtn.disabled = !!state.busy;
        if (focusTitle) {
            const heading = $('wor-title');
            try { heading.focus({ preventScroll: true }); } catch (_) { heading.focus(); }
            $('wor-body').scrollTop = 0;
        }
    }

    function showAlert(message) {
        const el = $('wor-alert');
        if (!el) return;
        el.textContent = message || '';
        el.hidden = !message;
        if (message) $('wor-body').scrollTop = 0;
    }

    function showFieldError(field, message) {
        const map = {
            reason: ['wor-reason-error', 'input[name="wor-reason"]'],
            description: ['wor-description-error', '#wor-description'],
            links: ['wor-links-error', '#wor-links'],
            attachments: ['wor-files-error', '[data-wor-add-files]'],
            confirm: ['wor-confirm-error', '#wor-confirm']
        };
        const entry = map[field];
        const el = entry ? $(entry[0]) : null;
        if (!el) { showAlert(message); return; }
        el.textContent = message;
        el.hidden = false;
        const input = dialog.querySelector(entry[1]);
        if (input) {
            if (field === 'description' || field === 'links') input.setAttribute('aria-invalid', 'true');
            try { input.focus(); } catch (_) { /* nada */ }
        }
    }

    function clearFieldError(id, input) {
        const el = $(id);
        if (el && !el.hidden) { el.hidden = true; el.textContent = ''; }
        if (input) input.removeAttribute('aria-invalid');
    }

    function setStatus(text) {
        if (!state) return;
        state.status = text || '';
        const el = $('wor-status');
        if (el) el.textContent = state.status;
    }

    function goTo(step) {
        state.step = step;
        state.status = '';
        render(true);
    }

    // ---- eventos del modal ----

    function onDialogClick(e) {
        if (!state) return;
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-wor-close]')) { e.preventDefault(); close(); return; }
        if (t.closest('[data-wor-back]')) {
            e.preventDefault();
            if (state.busy) return;
            goTo(state.step === 'confirm' ? 'evidence' : 'reason');
            return;
        }
        if (t.closest('[data-wor-add-files]')) {
            e.preventDefault();
            const input = $('wor-file-input');
            if (input) input.click();
            return;
        }
        const remove = t.closest('[data-wor-remove]');
        if (remove) {
            e.preventDefault();
            const index = Number(remove.getAttribute('data-wor-remove'));
            releaseFiles(state.draft.files.splice(index, 1));
            render(false);
            const add = dialog.querySelector('[data-wor-add-files]');
            if (add) add.focus();
        }
    }

    function onDialogInput(e) {
        if (!state) return;
        const t = e.target;
        if (!t) return;
        if (t.id === 'wor-description') {
            state.draft.description = t.value;
            const count = $('wor-count');
            if (count) count.textContent = t.value.length + ' / ' + DESCRIPTION_MAX;
            clearFieldError('wor-description-error', t);
        } else if (t.id === 'wor-links') {
            state.draft.linksText = t.value;
            clearFieldError('wor-links-error', t);
        }
    }

    function onDialogChange(e) {
        if (!state) return;
        const t = e.target;
        if (!t) return;
        if (t.name === 'wor-reason') {
            state.draft.reason = t.value;
            clearFieldError('wor-reason-error');
        } else if (t.id === 'wor-confirm') {
            state.draft.confirmed = !!t.checked;
            clearFieldError('wor-confirm-error');
        } else if (t.id === 'wor-file-input') {
            addFiles(t.files);
            t.value = '';
        }
    }

    function addFiles(fileList) {
        const incoming = Array.prototype.slice.call(fileList || []);
        let problem = null;
        for (let i = 0; i < incoming.length; i += 1) {
            const file = incoming[i];
            if (state.draft.files.length >= MAX_IMAGES) { problem = MSG.fileMany; break; }
            const error = validateFile(file);
            if (error) { problem = error; continue; }
            const duplicate = state.draft.files.some(function (f) {
                return f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified;
            });
            if (duplicate) continue;
            let preview = '';
            // HEIC no se previsualiza en la mayoría de los navegadores: se muestra el formato.
            if (fileType(file) !== 'image/heic' && root.URL && typeof root.URL.createObjectURL === 'function') {
                try { preview = root.URL.createObjectURL(file); } catch (_) { preview = ''; }
            }
            state.draft.files.push({ file: file, preview: preview, uploaded: null });
        }
        render(false);
        if (problem) { showFieldError('attachments', problem); return; }
        const add = dialog.querySelector('[data-wor-add-files]');
        const focusTarget = add && !add.disabled ? add : dialog.querySelector('button[type="submit"]');
        if (focusTarget) focusTarget.focus();
    }

    function next() {
        if (!state || state.busy || STEPS.indexOf(state.step) < 0) return;
        const problem = validateStep(state.draft, state.step, state.reasons);
        if (problem) { showFieldError(problem.field, problem.error); return; }
        if (state.step === 'reason') { goTo('evidence'); return; }
        if (state.step === 'evidence') { goTo('confirm'); return; }
        submit();
    }

    async function uploadFile(entry, userId) {
        const client = await getClient();
        if (!client || !client.storage) throw new Error(MSG.upload);
        const file = entry.file;
        const type = fileType(file);
        const path = storagePath(userId, file.name);
        const result = await client.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: type });
        if (result && result.error) throw new Error(MSG.upload);
        return { path: path, name: String(file.name || 'imagen').slice(0, 120), size: file.size || 0, type: type };
    }

    async function submit() {
        const current = state;
        const d = current.draft;
        current.busy = true;
        current.status = 'Enviando…';
        render(false);
        let failure = null;
        try {
            const session = await getSession();
            if (!session) throw new Error(MSG.login);
            const attachments = [];
            for (let i = 0; i < d.files.length; i += 1) {
                if (!d.files[i].uploaded) {
                    setStatus('Subiendo imágenes (' + (i + 1) + ' de ' + d.files.length + ')…');
                    d.files[i].uploaded = await uploadFile(d.files[i], session.user.id);
                }
                attachments.push(d.files[i].uploaded);
            }
            setStatus('Enviando tu denuncia…');
            const loc = root.location || {};
            const res = await request('POST', '/api/reports', {
                kind: current.kind,
                target_id: current.id,
                reason: d.reason,
                description: String(d.description || '').trim(),
                links: parseLinksText(d.linksText).links || [],
                attachments: attachments,
                page_context: String((loc.pathname || '') + (loc.search || '')).slice(0, 300)
            }, session);
            if (res.ok) {
                releaseFiles(d.files);
                drafts.delete(current.key);
                current.busy = false;
                current.result = res.json;
                if (state === current) goTo('done');
                try {
                    doc.dispatchEvent(new root.CustomEvent('wo:report-submitted', {
                        detail: { kind: current.kind, id: current.id, ticket: res.json.ticket || null, duplicate: !!res.json.duplicate }
                    }));
                } catch (_) { /* navegadores sin CustomEvent */ }
                return;
            }
            failure = { field: res.json && res.json.field, message: (res.json && res.json.error) || MSG.generic };
            // Una imagen que el servidor no encontró se vuelve a subir en el próximo intento.
            if (failure.field === 'attachments') d.files.forEach(function (f) { f.uploaded = null; });
        } catch (err) {
            failure = { field: null, message: (err && err.message) || MSG.generic };
        }
        current.busy = false;
        current.status = '';
        if (state !== current) return;
        const step = failure.field ? stepForField(failure.field) : 'confirm';
        if (step !== current.step) { current.step = step; render(true); } else render(false);
        if (failure.field && step !== 'confirm') showFieldError(failure.field, failure.message);
        else showAlert(failure.message);
    }

    async function open(options) {
        const opts = options || {};
        const kind = String(opts.kind || '').trim();
        const id = String(opts.id == null ? '' : opts.id).trim();
        if (KINDS.indexOf(kind) < 0 || !id) return false;
        if (state && state.busy) return false;
        ensureStyles();
        ensureDialog();
        const key = kind + ':' + id;
        if (!drafts.has(key)) drafts.set(key, newDraft());
        opener = opts.opener || doc.activeElement || null;
        const current = {
            key: key, kind: kind, id: id, label: String(opts.label || '').trim(), step: 'loading',
            draft: drafts.get(key), reasons: [], busy: false, status: '', message: '', result: null
        };
        state = current;
        render(false);
        showDialog();
        const info = await eligibility(kind, id);
        if (state !== current || current.step !== 'loading') return false;
        if (!info || !info.eligible) {
            current.step = 'blocked';
            current.message = (info && info.message) || MSG.unavailable;
            render(true);
            return false;
        }
        current.reasons = Array.isArray(info.reasons) && info.reasons.length ? info.reasons : reasonsFor(kind);
        if (!current.label && info.target_label) current.label = String(info.target_label);
        if (!reasonLabel(current.reasons, current.draft.reason)) current.draft.reason = '';
        current.draft.confirmed = false;
        current.step = 'reason';
        render(true);
        return true;
    }

    // ---------------------------------------------------------------
    // Arranque
    // ---------------------------------------------------------------
    function onDocumentClick(e) {
        const btn = e.target && e.target.closest ? e.target.closest('[data-wo-report]') : null;
        if (!btn || btn.disabled || (dialog && dialog.contains(btn))) return;
        const target = buttonTarget(btn);
        if (!target) return;
        e.preventDefault();
        open({ kind: target.kind, id: target.id, label: btn.getAttribute('data-label') || '', opener: btn });
    }

    // Si la persona inicia o cierra sesión en la misma página, se vuelve a evaluar quién ve los botones.
    async function watchAuth() {
        try {
            const client = await getClient();
            if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
            const initial = await getSession();
            let lastUser = initial ? initial.user.id : null;
            client.auth.onAuthStateChange(function (event, session) {
                if (event === 'INITIAL_SESSION') return;
                const current = session && session.user ? session.user.id : null;
                if (current === lastUser) return;
                lastUser = current;
                refresh();
            });
        } catch (_) { /* sin cliente: los botones quedan ocultos */ }
    }

    function boot() {
        const start = function () {
            ensureStyles();
            doc.addEventListener('click', onDocumentClick);
            scan(false);
            if (typeof root.MutationObserver === 'function' && doc.body) {
                new root.MutationObserver(scheduleScan).observe(doc.body, {
                    childList: true, subtree: true, attributes: true, attributeFilter: ['data-wo-report', 'data-kind', 'data-id']
                });
            }
            watchAuth();
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
        else start();
        // Capa de datos: los demás módulos usan WeotziData.Reports, no fetch sueltos.
        root.WeotziData = root.WeotziData || {};
        root.WeotziData.Reports = {
            eligibility: eligibility,
            submit: function (payload) { return request('POST', '/api/reports', payload); }
        };
    }

    return { boot: boot, open: open, close: close, refresh: refresh, _internal: pure };
});
