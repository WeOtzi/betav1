// ============================================================================
// We Ötzi · Feedback de la beta cerrada
// ----------------------------------------------------------------------------
// 1. Botón flotante "Comentarios" (esquina inferior izquierda) en las páginas
//    con sesión de tatuador, cliente o estudio. Abre un modal: tipo (Error /
//    Idea / Comentario), "¿Qué tan fácil te resultó?" 1–5 (opcional), mensaje y
//    hasta 2 capturas al bucket privado `support-attachments`
//    (`<uid>/feedback/<ts>-<rand>-<nombre>`, mismo patrón que wo-report.js).
//    Junto con el mensaje se guarda solo: ruta y título de la página, tipo de
//    cuenta (lo decide el servidor), idioma, pantalla y navegador.
// 2. Encuestas cortas: window.WoFeedback.survey(key, { question, delay })
//    muestra UNA vez por persona y clave una tarjeta no bloqueante (1–5 +
//    comentario opcional + "Ahora no"). Responder o descartar no vuelve a
//    preguntar: queda en el servidor (POST /api/feedback · /surveys/:key/dismiss)
//    y, de respaldo, en localStorage. Si la página navega antes de mostrarla
//    (registro → panel), la encuesta queda pendiente y sale en la próxima
//    página con sesión.
//
// Lo carga config-manager.js (cargador "Feedback de la beta"): sin sesión no
// pide nada; en /support y /backoffice no existe. Opt-out del botón por
// página: <html data-wo-feedback="off"> (las encuestas siguen funcionando).
// Servidor: lib/routes/feedback.js. Estilos: /shared/css/wo-feedback.css.
// API: window.WoFeedback.open() · .survey(key, opts) · .refresh()
// En Node (tests) solo exporta los helpers puros.
// ============================================================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root && root.document && !root.__woFeedbackBooted) {
        root.__woFeedbackBooted = true;
        const stub = root.WoFeedback;
        root.WoFeedback = api;
        api.boot(stub && Array.isArray(stub.__queue) ? stub.__queue : []);
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    // ---------------------------------------------------------------
    // Catálogo y límites (espejo de lib/feedback.js; un test los compara)
    // ---------------------------------------------------------------
    const KINDS = ['bug', 'idea', 'comment'];
    const KIND_LABELS = { bug: 'Error', idea: 'Idea', comment: 'Comentario' };
    const KIND_HELP = {
        bug: 'Qué estabas haciendo, qué esperabas y qué pasó.',
        idea: 'Qué te gustaría poder hacer y para qué te serviría.',
        comment: 'Lo que quieras contarnos de la beta.'
    };
    const SURVEYS = {
        registro_tatuador: '¿Cómo fue registrarte como tatuador?',
        registro_cliente: '¿Cómo fue crear tu cuenta?',
        registro_estudio: '¿Cómo fue registrar tu estudio?',
        cotizacion_enviada: '¿Cómo fue pedir tu cotización?',
        propuesta_enviada: '¿Cómo fue enviar tu propuesta?',
        primera_sesion_agendada: '¿Cómo fue agendar tu primera sesión?',
        primer_tatuador_equipo: '¿Cómo fue sumar a tu primer tatuador al equipo?'
    };
    // Tipo de cuenta de cada encuesta (igual que SURVEY_ROLES de lib/feedback.js).
    const SURVEY_ROLES = {
        registro_tatuador: 'artist',
        propuesta_enviada: 'artist',
        primera_sesion_agendada: 'artist',
        registro_cliente: 'client',
        cotizacion_enviada: 'client',
        registro_estudio: 'studio',
        primer_tatuador_equipo: 'studio'
    };
    const ROLES = ['artist', 'client', 'studio'];
    const MESSAGE_MIN = 10;
    const MESSAGE_MAX = 2000;
    const MAX_IMAGES = 2;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    const EXT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
    const BUCKET = 'support-attachments';
    const FOLDER = 'feedback';
    const CSS_HREF = '/shared/css/wo-feedback.css?v=20261117-feedback';
    const LS_PENDING = 'wo_fb_pending';
    const LS_DONE = 'wo_fb_done:';
    const SS_STATE = 'wo_fb_state:';
    const SS_TAB = 'wo_fb_tab';
    const STATE_TTL_MS = 10 * 60 * 1000;
    const PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
    const SURVEY_DELAY_MS = 1500;
    const EXCLUDED_RE = /^\/(support|backoffice)(\/|$)/;

    const MSG = {
        trigger: 'Comentarios',
        triggerHint: 'Cuéntanos qué piensas de la beta',
        title: 'Cuéntanos qué piensas',
        kind: 'Elige si es un error, una idea o un comentario.',
        messageShort: 'Cuéntanos un poco más: al menos ' + MESSAGE_MIN + ' caracteres.',
        messageLong: 'El mensaje puede tener hasta ' + MESSAGE_MAX + ' caracteres.',
        fileType: 'Solo se admiten imágenes JPG, PNG, WEBP o HEIC.',
        fileSize: 'Cada captura puede pesar hasta 10 MB.',
        fileEmpty: 'El archivo está vacío.',
        fileMany: 'Puedes adjuntar hasta ' + MAX_IMAGES + ' capturas.',
        upload: 'No pudimos subir una de las capturas. Revisa tu conexión e inténtalo de nuevo.',
        login: 'Inicia sesión para enviarnos tu opinión.',
        generic: 'No pudimos enviar tu mensaje. Inténtalo de nuevo en unos minutos.',
        offline: 'No pudimos conectar con We Ötzi. Revisa tu conexión e inténtalo de nuevo.',
        thanks: '¡Gracias! Leemos todo lo que nos mandas para mejorar We Ötzi.',
        surveyRating: 'Elige una calificación del 1 al 5.',
        surveyThanks: '¡Gracias por contarnos!'
    };

    const CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true" focusable="false">'
        + '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>';
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

    // Ruta de la app sin el prefijo de despliegue (/beta, /preview/<rama>).
    function appPath(pathname, base) {
        const p = String(pathname || '/');
        const b = String(base || '').replace(/\/$/, '');
        if (b && (p === b || p.indexOf(b + '/') === 0)) return p.slice(b.length) || '/';
        return p;
    }

    // ¿Corresponde el botón en esta página? (la sesión se mira aparte)
    function buttonAllowed(path, offAttr) {
        if (String(offAttr || '').toLowerCase() === 'off') return false;
        return !EXCLUDED_RE.test(String(path || '/').toLowerCase());
    }

    // Modo activo que se le sugiere al servidor (solo cuenta si es de la persona).
    function modeFromPath(path, storedMode) {
        const p = String(path || '').toLowerCase();
        if (/^\/studio(\/|$)|^\/register-studio(\/|$)/.test(p)) return 'studio';
        if (/^\/client(\/|$)|^\/quotation(\/|$)|^\/pre-cotizador(\/|$)|^\/store\/purchases(\/|$)/.test(p)) return 'client';
        if (/^\/(artist|my-quotations|calendar|register-artist|registerclosedbeta|studio-spots)(\/|$)/.test(p)) return 'artist';
        const stored = String(storedMode || '');
        return ROLES.indexOf(stored) >= 0 ? stored : '';
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

    // Nombre apto para la ruta de Storage (mismo criterio que wo-report.js).
    function safeName(name) {
        const clean = String(name || 'captura').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
        return clean || 'captura';
    }

    // `<user_id>/feedback/<marca>-<azar>-<nombre>`: la policy del bucket exige la carpeta del usuario.
    function storagePath(userId, name, now, rand) {
        const stamp = String(now == null ? Date.now() : now);
        const salt = String(rand == null ? Math.random().toString(36).slice(2, 8) : rand).replace(/[^a-z0-9]/gi, '') || 'x';
        return String(userId) + '/' + FOLDER + '/' + stamp + '-' + salt + '-' + safeName(name);
    }

    function newDraft() {
        return { kind: 'comment', rating: null, message: '', files: [] };
    }

    // null | { field, error }
    function validateDraft(draft) {
        const d = draft || newDraft();
        if (KINDS.indexOf(d.kind) < 0) return { field: 'kind', error: MSG.kind };
        const length = String(d.message || '').trim().length;
        if (length < MESSAGE_MIN) return { field: 'message', error: MSG.messageShort };
        if (length > MESSAGE_MAX) return { field: 'message', error: MSG.messageLong };
        if ((d.files || []).length > MAX_IMAGES) return { field: 'attachments', error: MSG.fileMany };
        if (d.rating != null && !(Number.isInteger(d.rating) && d.rating >= 1 && d.rating <= 5)) return { field: 'rating', error: MSG.surveyRating };
        return null;
    }

    // Lo único que viaja de la página: ruta (sin query ni hash), título, idioma y pantalla.
    function pageContext(win, base) {
        const w = win || {};
        const loc = w.location || {};
        const doc = w.document || {};
        const nav = w.navigator || {};
        const lang = String((doc.documentElement && doc.documentElement.lang) || nav.language || '').slice(0, 35);
        const vw = Math.round(Number(w.innerWidth) || 0);
        const vh = Math.round(Number(w.innerHeight) || 0);
        return {
            page_path: appPath(loc.pathname || '/', base).slice(0, 300),
            page_title: String(doc.title || '').trim().slice(0, 200),
            context: {
                lang: lang,
                viewport: vw > 0 && vh > 0 ? { w: vw, h: vh } : null,
                ua: String(nav.userAgent || '').slice(0, 300)
            }
        };
    }

    // Lista de encuestas pendientes: agrega sin duplicar y descarta las viejas.
    // Cada pendiente tiene dueño: el id de la cuenta o 'anon' (pedida sin
    // sesión todavía) junto con la pestaña (`tab`) que la pidió.
    function addPending(list, key, question, now, owner, tab) {
        const t = Number(now) || Date.now();
        const who = owner ? String(owner) : 'anon';
        const clean = prunePending(list, t).filter(function (p) { return !(p.key === key && (p.owner || 'anon') === who); });
        const entry = { key: key, question: String(question || '').slice(0, 160), at: t, owner: who };
        if (who === 'anon' && tab) entry.tab = String(tab);
        clean.push(entry);
        return clean;
    }

    // Pendientes de esta cuenta. Una 'anon' pasa a la primera cuenta que entra
    // en ESA pestaña dentro del plazo; las de otra cuenta se descartan; las
    // 'anon' de otra pestaña quedan para esa pestaña.
    // → { list: lista a guardar, mine: pendientes de userId }
    function claimPending(list, userId, tab, now) {
        const uid = String(userId || '');
        const pruned = prunePending(list, now);
        if (!uid) return { list: pruned, mine: [] };
        const out = [];
        const mine = [];
        const mineKeys = {};
        pruned.forEach(function (p) {
            const owner = p.owner || 'anon';
            let entry = p;
            if (owner === 'anon') {
                if (!(tab && p.tab === String(tab))) { out.push(p); return; }
                entry = { key: p.key, question: p.question, at: p.at, owner: uid };
            } else if (owner !== uid) {
                return; // de otra cuenta: se descarta
            }
            if (mineKeys[entry.key]) return; // misma encuesta dos veces: queda una
            mineKeys[entry.key] = true;
            out.push(entry);
            mine.push(entry);
        });
        return { list: out, mine: mine };
    }

    // ¿La encuesta es de un tipo de cuenta que la persona tiene?
    function surveyFitsRoles(key, roles) {
        const role = SURVEY_ROLES[key];
        return !!role && Array.isArray(roles) && roles.indexOf(role) >= 0;
    }

    function prunePending(list, now) {
        const t = Number(now) || Date.now();
        return (Array.isArray(list) ? list : []).filter(function (p) {
            return p && typeof p.key === 'string' && Object.prototype.hasOwnProperty.call(SURVEYS, p.key)
                && Number(p.at) > 0 && t - Number(p.at) < PENDING_TTL_MS;
        });
    }

    function questionFor(key, custom) {
        const text = String(custom || '').trim();
        return text ? text.slice(0, 160) : (SURVEYS[key] || '');
    }

    // ---------------------------------------------------------------
    // HTML (puro: todo dato se escapa aquí)
    // ---------------------------------------------------------------
    function triggerHtml() {
        return '<span class="wofb-fab-icon">' + CHAT_ICON + '</span><span class="wofb-fab-text">' + esc(MSG.trigger) + '</span>';
    }

    function ratingRadios(name, current, idPrefix) {
        let html = '';
        for (let i = 1; i <= 5; i += 1) {
            const label = i === 1 ? '1, muy difícil' : i === 5 ? '5, muy fácil' : String(i);
            html += '<label class="wofb-rate"><input type="radio" name="' + esc(name) + '" value="' + i + '" id="' + esc(idPrefix) + i + '"'
                + (current === i ? ' checked' : '') + ' aria-label="' + esc(label) + '"><span aria-hidden="true">' + i + '</span></label>';
        }
        return html;
    }

    function filesHtml(files) {
        return (files || []).map(function (f, i) {
            const name = (f.file && f.file.name) || 'captura';
            const thumb = f.preview
                ? '<img src="' + esc(f.preview) + '" alt="">'
                : '<span aria-hidden="true">' + esc((fileType(f.file).split('/')[1] || 'img').toUpperCase()) + '</span>';
            return '<li class="wofb-file"><div class="wofb-file-thumb">' + thumb + '</div>'
                + '<span class="wofb-file-name" title="' + esc(name) + '">' + esc(name) + '</span>'
                + '<button type="button" class="wofb-remove" data-wofb-remove="' + i + '" aria-label="Quitar ' + esc(name) + '">'
                + '<span>' + CLOSE_ICON + '</span></button></li>';
        }).join('');
    }

    function formHtml(draft) {
        const d = draft || newDraft();
        const kinds = KINDS.map(function (k) {
            return '<label class="wofb-kind"><input type="radio" name="wofb-kind" value="' + k + '"' + (d.kind === k ? ' checked' : '') + '>'
                + '<span>' + esc(KIND_LABELS[k]) + '</span></label>';
        }).join('');
        const full = (d.files || []).length >= MAX_IMAGES;
        return '<div class="wofb-alert" id="wofb-alert" role="alert" hidden></div>'
            + '<fieldset class="wofb-fieldset">'
            + '<legend class="wofb-label">¿Qué nos quieres contar?</legend>'
            + '<div class="wofb-kinds">' + kinds + '</div>'
            + '</fieldset>'
            + '<fieldset class="wofb-fieldset" aria-describedby="wofb-ease-help">'
            + '<legend class="wofb-label">¿Qué tan fácil te resultó? <span class="wofb-optional">(opcional)</span></legend>'
            + '<div class="wofb-rates">' + ratingRadios('wofb-ease', d.rating, 'wofb-ease-') + '</div>'
            + '<p class="wofb-help wofb-scale" id="wofb-ease-help"><span>1 · Muy difícil</span><span>5 · Muy fácil</span></p>'
            + '</fieldset>'
            + '<div class="wofb-field">'
            + '<label class="wofb-label" for="wofb-message">Tu mensaje <span class="wofb-req" aria-hidden="true">*</span></label>'
            + '<textarea id="wofb-message" class="wofb-input" rows="4" maxlength="' + MESSAGE_MAX + '" required '
            + 'aria-describedby="wofb-message-help wofb-message-error">' + esc(d.message) + '</textarea>'
            + '<p class="wofb-help" id="wofb-message-help"><span id="wofb-kind-help">' + esc(KIND_HELP[d.kind] || KIND_HELP.comment) + '</span>'
            + '<span class="wofb-count" id="wofb-count">' + String(d.message || '').length + ' / ' + MESSAGE_MAX + '</span></p>'
            + '<p class="wofb-error" id="wofb-message-error" role="alert" hidden></p>'
            + '</div>'
            + '<div class="wofb-field">'
            + '<span class="wofb-label" id="wofb-files-label">Capturas <span class="wofb-optional">(opcional)</span></span>'
            + '<ul class="wofb-files" id="wofb-files" aria-labelledby="wofb-files-label">' + filesHtml(d.files) + '</ul>'
            + '<input type="file" id="wofb-file-input" class="wofb-file-input" accept="image/jpeg,image/png,image/webp,image/heic,.heic" multiple tabindex="-1" aria-hidden="true">'
            + '<button type="button" class="wofb-btn wofb-btn--ghost" data-wofb-add-files aria-describedby="wofb-files-help"' + (full ? ' disabled' : '') + '>Agregar capturas</button>'
            + '<p class="wofb-help" id="wofb-files-help"><span>Hasta ' + MAX_IMAGES + ' imágenes JPG, PNG, WEBP o HEIC de 10 MB como máximo. Solo las ve el equipo de soporte.</span></p>'
            + '<p class="wofb-error" id="wofb-files-error" role="alert" hidden></p>'
            + '</div>'
            + '<p class="wofb-note">Junto con tu mensaje guardamos la página donde estás, tu tipo de cuenta, el idioma, el tamaño de tu pantalla y tu navegador. Nada más.</p>';
    }

    function doneHtml(message) {
        return '<div class="wofb-done">'
            + '<span class="wofb-done-mark" aria-hidden="true">' + CHECK_ICON + '</span>'
            + '<p class="wofb-text">' + esc(message || MSG.thanks) + '</p>'
            + '<p class="wofb-text wofb-muted">Si necesitamos más detalles, te escribimos a tu correo.</p>'
            + '</div>';
    }

    function footHtml(view) {
        const v = view || {};
        if (v.step === 'done') return '<button type="button" class="wofb-btn" data-wofb-close>Cerrar</button>';
        const dis = v.busy ? ' disabled' : '';
        return '<p class="wofb-status" id="wofb-status" role="status" aria-live="polite">' + esc(v.status || '') + '</p>'
            + '<button type="button" class="wofb-btn wofb-btn--ghost" data-wofb-close' + dis + '>Cancelar</button>'
            + '<button type="submit" class="wofb-btn"' + dis + '>' + (v.busy ? '<span class="wofb-spinner" aria-hidden="true"></span>' : '') + 'Enviar</button>';
    }

    function surveyHtml(view) {
        const v = view || {};
        if (v.step === 'done') {
            return '<p class="wofb-sv-thanks" role="status"><span class="wofb-done-mark wofb-done-mark--s" aria-hidden="true">' + CHECK_ICON + '</span>'
                + esc(MSG.surveyThanks) + '</p>';
        }
        const dis = v.busy ? ' disabled' : '';
        return '<div class="wofb-sv-head"><p class="wofb-eyebrow">Encuesta rápida</p>'
            + '<button type="button" class="wofb-close wofb-close--s" data-wofb-sv-dismiss aria-label="Ahora no, cerrar la encuesta"' + dis + '>' + CLOSE_ICON + '</button></div>'
            + '<form class="wofb-sv-form" novalidate>'
            + '<fieldset class="wofb-fieldset wofb-fieldset--tight" aria-describedby="wofb-sv-scale">'
            + '<legend class="wofb-sv-title" id="wofb-sv-title">' + esc(v.question || '') + '</legend>'
            + '<div class="wofb-rates wofb-rates--s">' + ratingRadios('wofb-sv-rate', v.rating, 'wofb-sv-rate-') + '</div>'
            + '<p class="wofb-help wofb-scale" id="wofb-sv-scale"><span>1 · Muy difícil</span><span>5 · Muy fácil</span></p>'
            + '</fieldset>'
            + '<div class="wofb-field wofb-sv-comment"' + (v.rating ? '' : ' hidden') + '>'
            + '<label class="wofb-label" for="wofb-sv-message">¿Algo que quieras agregar? <span class="wofb-optional">(opcional)</span></label>'
            + '<textarea id="wofb-sv-message" class="wofb-input wofb-input--s" rows="2" maxlength="' + MESSAGE_MAX + '">' + esc(v.message || '') + '</textarea>'
            + '</div>'
            + '<p class="wofb-error" id="wofb-sv-error" role="alert"' + (v.error ? '' : ' hidden') + '>' + esc(v.error || '') + '</p>'
            + '<div class="wofb-sv-actions">'
            + '<button type="button" class="wofb-btn wofb-btn--ghost wofb-btn--s" data-wofb-sv-dismiss' + dis + '>Ahora no</button>'
            + '<button type="submit" class="wofb-btn wofb-btn--s"' + (v.busy || !v.rating ? ' disabled' : '') + '>'
            + (v.busy ? '<span class="wofb-spinner" aria-hidden="true"></span>' : '') + 'Enviar</button>'
            + '</div></form>';
    }

    const pure = {
        KINDS: KINDS, KIND_LABELS: KIND_LABELS, SURVEYS: SURVEYS, SURVEY_ROLES: SURVEY_ROLES, ROLES: ROLES, MSG: MSG, BUCKET: BUCKET, FOLDER: FOLDER,
        claimPending: claimPending, surveyFitsRoles: surveyFitsRoles,
        MESSAGE_MIN: MESSAGE_MIN, MESSAGE_MAX: MESSAGE_MAX, MAX_IMAGES: MAX_IMAGES, MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
        IMAGE_TYPES: IMAGE_TYPES, LS_PENDING: LS_PENDING, PENDING_TTL_MS: PENDING_TTL_MS, SURVEY_DELAY_MS: SURVEY_DELAY_MS,
        esc: esc, appPath: appPath, buttonAllowed: buttonAllowed, modeFromPath: modeFromPath, fileType: fileType,
        validateFile: validateFile, safeName: safeName, storagePath: storagePath, newDraft: newDraft, validateDraft: validateDraft,
        pageContext: pageContext, addPending: addPending, prunePending: prunePending, questionFor: questionFor,
        triggerHtml: triggerHtml, formHtml: formHtml, doneHtml: doneHtml, footHtml: footHtml, surveyHtml: surveyHtml
    };

    const doc = root && root.document;
    if (!doc) {
        const noop = function () { return false; };
        return { boot: function () {}, open: noop, survey: noop, refresh: function () {}, close: function () {}, _internal: pure };
    }

    // ---------------------------------------------------------------
    // Almacenamiento (todo con try: modo privado o bloqueado)
    // ---------------------------------------------------------------
    // Última cuenta con sesión vista en esta página (dueño de las encuestas que se piden).
    let knownUserId = null;
    function lsGet(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } }
    function lsSet(key, value) { try { root.localStorage.setItem(key, value); } catch (_) { /* sin almacenamiento */ } }
    function lsRemove(key) { try { root.localStorage.removeItem(key); } catch (_) { /* idem */ } }
    function ssGet(key) { try { return root.sessionStorage.getItem(key); } catch (_) { return null; } }
    function ssSet(key, value) { try { root.sessionStorage.setItem(key, value); } catch (_) { /* idem */ } }
    function readJson(raw, fallback) { try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch (_) { return fallback; } }

    function readPending() { return prunePending(readJson(lsGet(LS_PENDING), []), Date.now()); }
    function writePending(list) {
        if (list && list.length) lsSet(LS_PENDING, JSON.stringify(list)); else lsRemove(LS_PENDING);
    }
    function removePending(key, userId) {
        const who = String(userId || 'anon');
        writePending(readPending().filter(function (p) { return !(p.key === key && (p.owner || 'anon') === who); }));
    }
    // Pestaña actual (sessionStorage): una encuesta pedida sin sesión solo la
    // reclama la cuenta que entra en esta misma pestaña.
    function tabId() {
        let id = ssGet(SS_TAB);
        if (!id) {
            id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
            ssSet(SS_TAB, id);
            if (ssGet(SS_TAB) !== id) return '';
        }
        return id;
    }
    function localDone(userId) { return readJson(lsGet(LS_DONE + userId), []); }
    function markLocalDone(userId, key) {
        const list = localDone(userId);
        if (list.indexOf(key) < 0) list.push(key);
        lsSet(LS_DONE + userId, JSON.stringify(list.slice(-50)));
    }

    // ---------------------------------------------------------------
    // Sesión y red
    // ---------------------------------------------------------------
    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    function currentPath() { return appPath((root.location && root.location.pathname) || '/', basePath()); }

    async function getClient() {
        const CM = root.ConfigManager;
        if (CM && typeof CM.ready === 'function') {
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
            const ok = session && session.user && session.access_token ? session : null;
            knownUserId = ok ? String(ok.user.id) : null;
            return ok;
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

    function activeMode() { return modeFromPath(currentPath(), lsGet('weotzi_active_mode')); }

    function payloadBase() {
        const ctx = pageContext(root, basePath());
        const mode = activeMode();
        return Object.assign(ctx, mode ? { mode: mode } : {});
    }

    // Tipos de cuenta y encuestas ya resueltas: una lectura cada 10 min por pestaña.
    async function loadState(session, force) {
        const key = SS_STATE + session.user.id;
        if (!force) {
            const cached = readJson(ssGet(key), null);
            if (cached && Date.now() - Number(cached.t) < STATE_TTL_MS && Array.isArray(cached.roles)) return cached;
        }
        const res = await request('GET', '/api/feedback/surveys', null, session);
        if (!res.ok) return { roles: [], keys: [], t: Date.now(), failed: true };
        const fresh = {
            roles: Array.isArray(res.json.roles) ? res.json.roles.filter(function (r) { return ROLES.indexOf(r) >= 0; }) : [],
            keys: Array.isArray(res.json.keys) ? res.json.keys.filter(function (k) { return typeof k === 'string'; }) : [],
            t: Date.now()
        };
        ssSet(key, JSON.stringify(fresh));
        return fresh;
    }

    function rememberKey(session, surveyKey) {
        markLocalDone(session.user.id, surveyKey);
        const key = SS_STATE + session.user.id;
        const cached = readJson(ssGet(key), null);
        if (cached && Array.isArray(cached.keys) && cached.keys.indexOf(surveyKey) < 0) {
            cached.keys.push(surveyKey);
            ssSet(key, JSON.stringify(cached));
        }
    }

    // ---------------------------------------------------------------
    // Estilos
    // ---------------------------------------------------------------
    function ensureStyles() {
        if (doc.querySelector('link[data-wo-feedback-css], link[href*="wo-feedback.css"]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = basePath() + CSS_HREF;
        link.setAttribute('data-wo-feedback-css', '');
        (doc.head || doc.documentElement).appendChild(link);
    }

    // ---------------------------------------------------------------
    // Botón flotante
    // ---------------------------------------------------------------
    let fab = null;
    let liftTimer = null;
    let liftFrame = 0;

    // Sube el botón (y la tarjeta) por encima de cualquier barra fija o pegada
    // abajo (barra ATRÁS · CONTINUAR del cotizador, banner de cookies…).
    function measureLift() {
        if (!doc.elementsFromPoint || !root.getComputedStyle) return 0;
        const h = root.innerHeight || 0;
        if (!h) return 0;
        let lift = 0;
        // Se sondea a lo ancho del botón (en escritorio mide ~140 px).
        const r = fab && fab.getBoundingClientRect ? fab.getBoundingClientRect() : null;
        const xs = r && r.width ? [r.left + 4, r.left + r.width / 2, r.right - 4] : [24, 56];
        // Alturas fijas de la zona del botón sin levantar: el resultado no depende del propio lift.
        const points = [];
        xs.forEach(function (x) { points.push([x, h - 8], [x, h - 36]); });
        points.forEach(function (point) {
            let hits = [];
            try { hits = doc.elementsFromPoint(point[0], point[1]) || []; } catch (_) { hits = []; }
            for (let i = 0; i < hits.length; i += 1) {
                let el = hits[i];
                if (el.closest && el.closest('.wofb-fab, .wofb-survey')) continue;
                while (el && el !== doc.body && el !== doc.documentElement) {
                    const pos = root.getComputedStyle(el).position;
                    if (pos === 'fixed' || pos === 'sticky') {
                        const rect = el.getBoundingClientRect();
                        // Una barra abajo, no un panel o una capa a pantalla completa.
                        if (rect.top > h * 0.55 && rect.bottom >= h - 24 && rect.height < h * 0.45) lift = Math.max(lift, Math.ceil(h - rect.top));
                        break;
                    }
                    el = el.parentElement;
                }
                if (el && el !== doc.body && el !== doc.documentElement) break;
            }
        });
        return Math.min(lift, Math.round(h * 0.45));
    }

    function applyLift() {
        liftFrame = 0;
        const lift = measureLift();
        doc.documentElement.style.setProperty('--wofb-lift', lift + 'px');
    }

    function scheduleLift() {
        if (liftFrame || typeof root.requestAnimationFrame !== 'function') return;
        liftFrame = root.requestAnimationFrame(applyLift);
    }

    function mountButton() {
        if (fab || !doc.body) return;
        fab = doc.createElement('button');
        fab.type = 'button';
        fab.className = 'wofb-fab';
        fab.setAttribute('aria-haspopup', 'dialog');
        fab.setAttribute('aria-label', MSG.trigger + ': ' + MSG.triggerHint.toLowerCase());
        fab.title = MSG.triggerHint;
        fab.setAttribute('data-wo-feedback-fab', '');
        fab.innerHTML = triggerHtml();
        fab.addEventListener('click', function () { open({ opener: fab }); });
        doc.body.appendChild(fab);
        applyLift();
        root.addEventListener('scroll', scheduleLift, { passive: true });
        root.addEventListener('resize', scheduleLift, { passive: true });
        // Barras que aparecen o desaparecen sin scroll (pasos del cotizador, banner de cookies).
        liftTimer = root.setInterval(scheduleLift, 1500);
    }

    function unmountButton() {
        if (!fab) return;
        if (fab.parentNode) fab.parentNode.removeChild(fab);
        fab = null;
        if (liftTimer) root.clearInterval(liftTimer);
        liftTimer = null;
        root.removeEventListener('scroll', scheduleLift);
        root.removeEventListener('resize', scheduleLift);
    }

    // ---------------------------------------------------------------
    // Modal
    // ---------------------------------------------------------------
    let dialog = null;
    let fallbackBackdrop = null;
    let state = null;
    let opener = null;
    let draft = newDraft();
    let previousOverflow = null;

    function $(id) { return doc.getElementById(id); }

    function ensureDialog() {
        if (dialog) return dialog;
        dialog = doc.createElement('dialog');
        dialog.id = 'wofb-dialog';
        dialog.className = 'wofb-dialog';
        dialog.setAttribute('aria-labelledby', 'wofb-title');
        dialog.setAttribute('aria-describedby', 'wofb-lead');
        dialog.innerHTML = ''
            + '<div class="wofb-head">'
            + '<div class="wofb-head-text"><p class="wofb-eyebrow">Beta cerrada</p>'
            + '<h2 class="wofb-title" id="wofb-title" tabindex="-1">' + esc(MSG.title) + '</h2>'
            + '<p class="wofb-lead" id="wofb-lead">Un error, una idea o lo que te pareció: todo nos sirve.</p></div>'
            + '<button type="button" class="wofb-close" data-wofb-close aria-label="Cerrar">' + CLOSE_ICON + '</button>'
            + '</div>'
            + '<form class="wofb-form" id="wofb-form" novalidate>'
            + '<div class="wofb-body" id="wofb-body"></div>'
            + '<div class="wofb-foot" id="wofb-foot"></div>'
            + '</form>';
        doc.body.appendChild(dialog);
        dialog.addEventListener('click', onDialogClick);
        dialog.addEventListener('input', onDialogInput);
        dialog.addEventListener('change', onDialogChange);
        dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
        dialog.addEventListener('close', onDialogClosed);
        dialog.addEventListener('keydown', onDialogKeydown);
        $('wofb-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
        return dialog;
    }

    function focusables() {
        return Array.prototype.filter.call(
            dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
            function (el) { return el.offsetParent !== null || el === doc.activeElement; }
        );
    }

    // Foco atrapado (también sin <dialog> nativo) y Escape.
    function onDialogKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (!list.length) return;
        const firstEl = list[0];
        const lastEl = list[list.length - 1];
        if (e.shiftKey && (doc.activeElement === firstEl || !dialog.contains(doc.activeElement))) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && doc.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }

    function showDialog() {
        if (dialog.open) return;
        previousOverflow = doc.documentElement.style.overflow;
        doc.documentElement.style.overflow = 'hidden';
        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            fallbackBackdrop = doc.createElement('div');
            fallbackBackdrop.className = 'wofb-fallback-backdrop';
            doc.body.insertBefore(fallbackBackdrop, dialog);
            dialog.classList.add('wofb-dialog--fallback');
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
        const done = state && state.step === 'done';
        state = null;
        if (done) draft = newDraft();
        const back = opener;
        opener = null;
        if (back && back.isConnected && typeof back.focus === 'function') {
            try { back.focus({ preventScroll: true }); } catch (_) { back.focus(); }
        }
        // Una encuesta que esperaba a que se cerrara el modal.
        root.setTimeout(processPending, 600);
    }

    function close() {
        if (!dialog || !dialog.open || (state && state.busy)) return;
        if (typeof dialog.close === 'function' && !dialog.classList.contains('wofb-dialog--fallback')) {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
            dialog.classList.remove('wofb-dialog--fallback');
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
        $('wofb-body').innerHTML = state.step === 'done' ? doneHtml(state.thanks) : formHtml(draft);
        $('wofb-foot').innerHTML = footHtml(state);
        $('wofb-lead').hidden = state.step === 'done';
        $('wofb-title').textContent = state.step === 'done' ? '¡Gracias!' : MSG.title;
        const closeBtn = dialog.querySelector('.wofb-close');
        if (closeBtn) closeBtn.disabled = !!state.busy;
        if (focusTitle) {
            const heading = $('wofb-title');
            try { heading.focus({ preventScroll: true }); } catch (_) { heading.focus(); }
            $('wofb-body').scrollTop = 0;
        }
    }

    function showAlert(message) {
        const el = $('wofb-alert');
        if (!el) return;
        el.textContent = message || '';
        el.hidden = !message;
        if (message) $('wofb-body').scrollTop = 0;
    }

    function showFieldError(field, message) {
        const map = {
            message: ['wofb-message-error', '#wofb-message'],
            attachments: ['wofb-files-error', '[data-wofb-add-files]']
        };
        const entry = map[field];
        const el = entry ? $(entry[0]) : null;
        if (!el) { showAlert(message); return; }
        el.textContent = message;
        el.hidden = false;
        const input = dialog.querySelector(entry[1]);
        if (input) {
            if (field === 'message') input.setAttribute('aria-invalid', 'true');
            try { input.focus(); } catch (_) { /* nada */ }
        }
    }

    function setStatus(text) {
        if (!state) return;
        state.status = text || '';
        const el = $('wofb-status');
        if (el) el.textContent = state.status;
    }

    function onDialogClick(e) {
        if (!state) return;
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-wofb-close]')) { e.preventDefault(); close(); return; }
        if (t.closest('[data-wofb-add-files]')) {
            e.preventDefault();
            const input = $('wofb-file-input');
            if (input) input.click();
            return;
        }
        const remove = t.closest('[data-wofb-remove]');
        if (remove) {
            e.preventDefault();
            releaseFiles(draft.files.splice(Number(remove.getAttribute('data-wofb-remove')), 1));
            render(false);
            const add = dialog.querySelector('[data-wofb-add-files]');
            if (add) add.focus();
        }
    }

    function onDialogInput(e) {
        const t = e.target;
        if (!state || !t || t.id !== 'wofb-message') return;
        draft.message = t.value;
        const count = $('wofb-count');
        if (count) count.textContent = t.value.length + ' / ' + MESSAGE_MAX;
        const err = $('wofb-message-error');
        if (err && !err.hidden) { err.hidden = true; err.textContent = ''; }
        t.removeAttribute('aria-invalid');
    }

    function onDialogChange(e) {
        const t = e.target;
        if (!state || !t) return;
        if (t.name === 'wofb-kind') {
            draft.kind = t.value;
            const help = $('wofb-kind-help');
            if (help) help.textContent = KIND_HELP[draft.kind] || KIND_HELP.comment;
        } else if (t.name === 'wofb-ease') {
            draft.rating = Number(t.value) || null;
        } else if (t.id === 'wofb-file-input') {
            addFiles(t.files);
            t.value = '';
        }
    }

    function addFiles(fileList) {
        const incoming = Array.prototype.slice.call(fileList || []);
        let problem = null;
        for (let i = 0; i < incoming.length; i += 1) {
            const file = incoming[i];
            if (draft.files.length >= MAX_IMAGES) { problem = MSG.fileMany; break; }
            const error = validateFile(file);
            if (error) { problem = error; continue; }
            const duplicate = draft.files.some(function (f) {
                return f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified;
            });
            if (duplicate) continue;
            let preview = '';
            if (fileType(file) !== 'image/heic' && root.URL && typeof root.URL.createObjectURL === 'function') {
                try { preview = root.URL.createObjectURL(file); } catch (_) { preview = ''; }
            }
            draft.files.push({ file: file, preview: preview, uploaded: null });
        }
        render(false);
        if (problem) { showFieldError('attachments', problem); return; }
        const add = dialog.querySelector('[data-wofb-add-files]');
        const focusTarget = add && !add.disabled ? add : $('wofb-message');
        if (focusTarget) focusTarget.focus();
    }

    async function uploadFile(entry, userId) {
        const client = await getClient();
        if (!client || !client.storage) throw new Error(MSG.upload);
        const file = entry.file;
        const type = fileType(file);
        const path = storagePath(userId, file.name);
        const result = await client.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: type });
        if (!result || result.error) throw new Error(MSG.upload);
        return { path: path, name: String(file.name || 'captura').slice(0, 120), size: file.size || 0, type: type };
    }

    async function submit() {
        if (!state || state.busy || state.step !== 'form') return;
        const problem = validateDraft(draft);
        if (problem) { showFieldError(problem.field, problem.error); return; }
        const current = state;
        current.busy = true;
        current.status = 'Enviando…';
        render(false);
        let failure = null;
        try {
            const session = await getSession();
            if (!session) throw new Error(MSG.login);
            const attachments = [];
            for (let i = 0; i < draft.files.length; i += 1) {
                if (!draft.files[i].uploaded) {
                    setStatus('Subiendo capturas (' + (i + 1) + ' de ' + draft.files.length + ')…');
                    draft.files[i].uploaded = await uploadFile(draft.files[i], session.user.id);
                }
                attachments.push(draft.files[i].uploaded);
            }
            setStatus('Enviando tu mensaje…');
            const res = await request('POST', '/api/feedback', Object.assign(payloadBase(), {
                kind: draft.kind,
                rating: draft.rating,
                message: String(draft.message || '').trim(),
                attachments: attachments
            }), session);
            if (res.ok) {
                releaseFiles(draft.files);
                current.busy = false;
                current.step = 'done';
                current.thanks = res.json.message || MSG.thanks;
                if (state === current) render(true);
                try { doc.dispatchEvent(new root.CustomEvent('wo:feedback-sent', { detail: { kind: draft.kind, id: res.json.id || null } })); } catch (_) { /* sin CustomEvent */ }
                return;
            }
            failure = { field: res.json && res.json.field, message: (res.json && res.json.error) || MSG.generic };
            if (failure.field === 'attachments') draft.files.forEach(function (f) { f.uploaded = null; });
        } catch (err) {
            failure = { field: null, message: (err && err.message) || MSG.generic };
        }
        current.busy = false;
        current.status = '';
        if (state !== current) return;
        render(false);
        if (failure.field === 'message' || failure.field === 'attachments') showFieldError(failure.field, failure.message);
        else showAlert(failure.message);
    }

    function open(options) {
        const opts = options || {};
        if (state && state.busy) return false;
        ensureStyles();
        ensureDialog();
        opener = opts.opener || doc.activeElement || null;
        state = { step: 'form', busy: false, status: '', thanks: '' };
        if (opts.kind && KINDS.indexOf(opts.kind) >= 0) draft.kind = opts.kind;
        render(false);
        showDialog();
        const msg = $('wofb-message');
        if (msg) { try { msg.focus({ preventScroll: true }); } catch (_) { msg.focus(); } }
        return true;
    }

    // ---------------------------------------------------------------
    // Encuestas cortas
    // ---------------------------------------------------------------
    let card = null;
    let survey = null;
    let processing = false;
    let forceState = false;

    function hideCard() {
        if (card && card.parentNode) card.parentNode.removeChild(card);
        card = null;
        survey = null;
        if (fab) fab.hidden = false;
    }

    function renderCard() {
        if (!card || !survey) return;
        card.innerHTML = surveyHtml(survey);
        const form = card.querySelector('form');
        if (form) form.addEventListener('submit', function (e) { e.preventDefault(); answerSurvey(); });
    }

    function showCard(entry, session) {
        ensureStyles();
        survey = { key: entry.key, question: questionFor(entry.key, entry.question), rating: null, message: '', busy: false, error: '', step: 'ask', session: session };
        card = doc.createElement('section');
        card.className = 'wofb-survey';
        card.setAttribute('aria-labelledby', 'wofb-sv-title');
        card.setAttribute('data-wo-feedback-survey', entry.key);
        card.addEventListener('click', onCardClick);
        card.addEventListener('change', onCardChange);
        card.addEventListener('input', onCardInput);
        card.addEventListener('keydown', function (e) { if (e.key === 'Escape' && survey && survey.step === 'ask') { e.preventDefault(); dismissSurvey(); } });
        renderCard();
        doc.body.appendChild(card);
        // En celular la tarjeta ocupa el ancho: el botón espera.
        if (fab && root.matchMedia && root.matchMedia('(max-width: 600px)').matches) fab.hidden = true;
        scheduleLift();
    }

    function onCardClick(e) {
        const t = e.target;
        if (!t || !t.closest || !survey) return;
        if (t.closest('[data-wofb-sv-dismiss]')) { e.preventDefault(); dismissSurvey(); }
    }

    function onCardChange(e) {
        const t = e.target;
        if (!t || !survey || t.name !== 'wofb-sv-rate') return;
        const first = !survey.rating;
        survey.rating = Number(t.value) || null;
        survey.error = '';
        if (first) {
            renderCard();
            const checked = card.querySelector('input[name="wofb-sv-rate"]:checked');
            if (checked) checked.focus();
        } else {
            const submitBtn = card.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function onCardInput(e) {
        const t = e.target;
        if (t && survey && t.id === 'wofb-sv-message') survey.message = t.value;
    }

    function finishSurvey(key, session) {
        rememberKey(session, key);
        removePending(key, session.user.id);
    }

    async function answerSurvey() {
        const s = survey;
        if (!s || s.busy || s.step !== 'ask') return;
        if (!s.rating) { s.error = MSG.surveyRating; renderCard(); return; }
        s.busy = true;
        s.error = '';
        renderCard();
        const res = await request('POST', '/api/feedback', Object.assign(payloadBase(), {
            kind: 'survey',
            survey_key: s.key,
            rating: s.rating,
            message: String(s.message || '').trim()
        }), s.session);
        if (survey !== s) return;
        s.busy = false;
        // 403: sin tipo de cuenta; SURVEY_ROLE_MISMATCH: la encuesta no es de su tipo de cuenta.
        const notForMe = res.status === 403 || (res.json && res.json.code === 'SURVEY_ROLE_MISMATCH');
        if (res.ok || notForMe) {
            finishSurvey(s.key, s.session);
            if (notForMe) { hideCard(); return; }
            s.step = 'done';
            renderCard();
            root.setTimeout(function () { if (survey === s) { hideCard(); processPending(); } }, 2600);
            return;
        }
        s.error = (res.json && res.json.error) || MSG.generic;
        renderCard();
    }

    async function dismissSurvey() {
        const s = survey;
        if (!s || s.busy) return;
        // Respaldo local primero: aunque falle la red, este navegador no vuelve a preguntar.
        finishSurvey(s.key, s.session);
        hideCard();
        const base = payloadBase();
        await request('POST', '/api/feedback/surveys/' + encodeURIComponent(s.key) + '/dismiss', { mode: base.mode, page_path: base.page_path }, s.session);
        root.setTimeout(processPending, 400);
    }

    async function processPending() {
        if (processing || card || (dialog && dialog.open)) return;
        const pending = readPending();
        writePending(pending);
        if (!pending.length) return;
        processing = true;
        try {
            const session = await getSession();
            if (!session) return;
            // Solo las de esta cuenta: reclama las 'anon' de esta pestaña y
            // descarta las de otra cuenta.
            const claimed = claimPending(pending, session.user.id, tabId(), Date.now());
            writePending(claimed.list);
            if (!claimed.mine.length) return;
            const st = await loadState(session, forceState);
            forceState = false;
            if (st.failed || !st.roles.length) return;
            const done = st.keys.concat(localDone(session.user.id));
            let next = null;
            claimed.mine.forEach(function (p) {
                if (done.indexOf(p.key) >= 0) removePending(p.key, session.user.id);
                else if (!next && surveyFitsRoles(p.key, st.roles)) next = p;
            });
            if (next && !card && !(dialog && dialog.open)) showCard(next, session);
        } finally {
            processing = false;
        }
    }

    // Pública: WoFeedback.survey('registro_cliente', { question, delay })
    function askSurvey(key, options) {
        const opts = options || {};
        if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(SURVEYS, key)) {
            if (root.console) root.console.warn('[wo-feedback] encuesta desconocida:', key);
            return false;
        }
        // Dueño: la cuenta con sesión en esta página o 'anon' + esta pestaña.
        writePending(addPending(readPending(), key, opts.question, Date.now(), knownUserId || 'anon', tabId()));
        // Recién registrada o con un tipo de cuenta nuevo: se vuelve a preguntar al servidor.
        forceState = true;
        const delay = Number.isFinite(Number(opts.delay)) ? Math.max(0, Number(opts.delay)) : SURVEY_DELAY_MS;
        root.setTimeout(processPending, delay);
        return true;
    }

    // ---------------------------------------------------------------
    // Arranque
    // ---------------------------------------------------------------
    async function refresh() {
        const path = currentPath();
        const off = doc.documentElement.getAttribute('data-wo-feedback');
        const session = await getSession();
        if (!session) { unmountButton(); return; }
        const st = await loadState(session, false);
        if (st.roles.length && buttonAllowed(path, off)) { ensureStyles(); mountButton(); } else unmountButton();
    }

    async function watchAuth() {
        try {
            const client = await getClient();
            if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
            client.auth.onAuthStateChange(function (event) {
                if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
                if (event === 'SIGNED_OUT') { knownUserId = null; unmountButton(); hideCard(); return; }
                // Fuera del callback: supabase-js retiene el candado de auth mientras lo ejecuta.
                root.setTimeout(function () { refresh(); processPending(); }, 0);
            });
        } catch (_) { /* sin cliente: sin botón */ }
    }

    function boot(queue) {
        if (EXCLUDED_RE.test(currentPath().toLowerCase())) return;
        // Capa de datos: los demás módulos usan WeotziData.Feedback, no fetch sueltos.
        root.WeotziData = root.WeotziData || {};
        root.WeotziData.Feedback = {
            surveys: function () { return request('GET', '/api/feedback/surveys'); },
            submit: function (payload) { return request('POST', '/api/feedback', payload); },
            dismiss: function (key, payload) { return request('POST', '/api/feedback/surveys/' + encodeURIComponent(key) + '/dismiss', payload || {}); }
        };
        const start = function () {
            (queue || []).forEach(function (call) {
                if (!Array.isArray(call)) return;
                if (call[0] === '__open') open({});
                else askSurvey(call[0], call[1]);
            });
            refresh().catch(function () { /* mejora progresiva */ });
            root.setTimeout(processPending, 2000);
            watchAuth();
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
        else start();
    }

    return { boot: boot, open: open, close: close, survey: askSurvey, refresh: refresh, _internal: pure };
});
