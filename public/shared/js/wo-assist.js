/**
 * WE OTZI - Modo asistido del artista (panel)
 * -------------------------------------------
 * Panel fijo que acompaña al artista real (sin demo) por los ocho pasos que
 * dejan su cuenta lista para recibir cotizaciones: perfil, portafolio,
 * compartir en Instagram, retiro, disponibilidad, notificaciones,
 * verificación y configuración. El estado de cada paso lo calcula el servidor
 * (GET /api/artist/onboarding); este script lo muestra, enfoca el campo
 * pendiente con un marco que no bloquea la página y avisa al servidor cuando
 * el artista posterga un paso o confirma algo que no se detecta solo
 * (pegar el enlace en Instagram).
 *
 * Carga: wo-demo.js lo trae lazy (después de wo-tour.js, para la voz) cuando
 * el modo asistido está activo y el demo apagado, y llama
 * WoAssist.boot({ start, identity }). Con el demo prendido no hace nada.
 *
 * Datos: usa WoDemo.onboarding() / WoDemo.api() si existen; si no, su propio
 * fetch con el token de la sesión de Supabase y el base path (/beta).
 *
 * Anclas: el centro de la cuenta marca los campos con data-assist (lista
 * separada por espacios); el marco busca [data-assist~="paso.check"], después
 * [data-assist~="paso"] y por último la sección #aac-<sección>.
 *
 * Eventos: escucha wo:assist-refresh (lo disparan las páginas al guardar),
 * wo:demo-suggestions-changed (acceso al demo en el dock), visibilitychange,
 * hashchange y un latido de 30 s mientras la pestaña se ve. Al montar emite
 * wo:assist-changed { active: true } para que el menú Ö actualice su entrada.
 */
(function () {
    'use strict';

    /* ------------------------------ constantes ------------------------------ */
    var STEP_IDS = ['perfil', 'portafolio', 'compartir', 'retiro', 'disponibilidad', 'notificaciones', 'verificacion', 'configuracion'];
    // Sección del centro de cuenta donde se resuelve cada paso (compartir vive en el panel).
    var STEP_SECTION = {
        perfil: 'perfil', portafolio: 'portafolio', compartir: null, retiro: 'cobros',
        disponibilidad: 'disponibilidad', notificaciones: 'notificaciones',
        verificacion: 'verificacion', configuracion: 'configuracion'
    };
    var ACCOUNT_PATH = '/artist/account';
    var DASHBOARD_PATH = '/artist/dashboard';
    var INBOX_PATH = '/artist/inbox';
    var API_PATH = '/api/artist/onboarding';
    var INSTAGRAM_EDIT_URL = 'https://www.instagram.com/accounts/edit/';
    var SUPPORT_EMAIL = 'artistas@weotzi.com';
    var UI_KEY = 'wo_assist_ui';
    // Contrato §2: "AHORA NO" en la tarjeta del demo la oculta por esta sesión.
    var DEMO_DISMISSED_KEY = 'wo_demo_suggest_dismissed';
    // Pasos que el artista puede dar por revisados (ACK_IDS del servidor).
    var REVIEW_ACK_STEPS = ['notificaciones', 'configuracion'];
    var REFRESH_DEBOUNCE_MS = 600;
    var POLL_MS = 30000;
    var FLASH_MS = 2600;
    var COPIED_MS = 1800;
    var PENDING_FOCUS_TTL_MS = 60000;
    var RING_PAD = 6;
    var DEFAULT_RATES = [1, 1.25, 1.5, 1.75, 2];
    var STATUS_LABEL = { done: 'Listo', skipped: 'Para después', unavailable: 'No disponible', pending: 'Pendiente' };
    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    /* --------------------------------- copy --------------------------------- */
    // Títulos = contrato §1. Las etiquetas de checks son respaldo: manda el servidor.
    var STEP_COPY = {
        perfil: {
            title: 'Completá tu perfil',
            description: 'Subí un banner y tu foto, sumá al menos una red (Instagram, TikTok o tu sitio web) y dejá tu WhatsApp y tu email de contacto. La biografía es opcional, pero ayuda a que te elijan.',
            checks: { banner: 'Banner de perfil', foto: 'Foto de perfil', redes: 'Instagram, TikTok o sitio web', whatsapp: 'WhatsApp', email: 'Email de contacto', bio: 'Biografía' }
        },
        portafolio: {
            title: 'Validá tu Instagram y tu portafolio',
            description: 'Cargá al menos un trabajo y validá tu cuenta de Instagram. Las fotos que importes de Instagram se muestran en tu perfil público cuando la cuenta queda validada.',
            checks: { trabajos: 'Al menos un trabajo cargado', instagram_validado: 'Instagram validado', portafolio_validado: 'Fotos de Instagram revisadas' }
        },
        compartir: {
            title: 'Compartí tu perfil en Instagram',
            description: 'Pegá tu enlace de We Ötzi en tu Instagram para que tus clientes coticen directo desde ahí. Copiar el enlace y el mensaje desde acá es opcional: lo que cuenta es que quede pegado.',
            checks: { enlace_copiado: 'Enlace copiado', bio_copiada: 'Mensaje para la bio copiado', pegado: 'Enlace pegado en tu Instagram' }
        },
        retiro: {
            title: 'Configurá un medio de retiro',
            description: 'Agregá al menos un destino de retiro en Cobros para recibir lo que cobrás con We Ötzi. Podés cambiarlo cuando quieras.',
            unavailable: 'El Wallet todavía no está activo en tu cuenta: este paso se habilita pronto.',
            checks: { destino: 'Destino de retiro activo' }
        },
        disponibilidad: {
            title: 'Configurá tu disponibilidad',
            description: 'Contanos si trabajás de forma independiente, en un estudio o en ambos, y marcá al menos un día con horario. Si trabajás en un estudio, indicá cuál.',
            checks: { modalidad: 'Modalidad de trabajo', estudio: 'Estudio donde trabajás', horarios: 'Días y horarios' }
        },
        notificaciones: {
            title: 'Configurá tus notificaciones',
            description: 'Elegí por qué canal querés enterarte de mensajes, cotizaciones e invitaciones. Con guardar una preferencia ya alcanza.',
            checks: { preferencias: 'Preferencias guardadas' }
        },
        verificacion: {
            title: 'Completá la verificación',
            description: 'Subí tu documento de identidad y un comprobante de domicilio, y pedí la verificación de tu cuenta. El certificado de bioseguridad es opcional.',
            checks: { identidad: 'Documento de identidad', domicilio: 'Comprobante de domicilio', bioseguridad: 'Certificado de bioseguridad', solicitud: 'Solicitud de verificación' }
        },
        configuracion: {
            title: 'Completá la configuración',
            description: 'Revisá tu país, tu zona horaria y la moneda en la que ves los precios. Con eso la agenda y las cotizaciones te muestran todo en tu horario.',
            checks: { region: 'País y zona horaria', moneda: 'Moneda de los precios', revisada: 'Configuración revisada' }
        }
    };

    // Mensajes cortos para la bio de Instagram (el enlace va en el campo de enlaces).
    var BIO_MESSAGES = [
        'Agendá conmigo en el enlace',
        'Cotizá fácil desde el enlace',
        'Pedí tu cotización en el enlace',
        'Reservá tu turno en el enlace',
        'Contame tu idea en el enlace',
        'Pedí tu turno en el enlace',
        'Escribime tu idea desde el enlace',
        'Consultá fechas en el enlace',
        'Mandame tu referencia en el enlace',
        'Sacá turno desde el enlace',
        'Contá qué querés tatuarte en el enlace',
        'Agendá tu sesión en el enlace',
        'Pedí presupuesto en el enlace',
        'Mirá mi agenda en el enlace',
        'Reservá tu lugar en el enlace',
        'Cotizá sin vueltas en el enlace',
        'Elegí tu fecha en el enlace',
        'Subí tu idea y cotizá en el enlace',
        'Cotizá tu próximo tatuaje en el enlace',
        'Turnos y cotizaciones en el enlace'
    ];

    var SHARE_COPY = {
        linkLabel: 'Tu enlace de We Ötzi',
        noLink: 'Todavía no encontramos tu enlace público. Revisá tu nombre de usuario en Mi perfil.',
        instructions: 'En Instagram: Editar perfil → Enlaces → Agregar enlace externo. Pegá este enlace en el campo URL.',
        bioLabel: 'Mensaje para tu bio',
        bioHint: 'Pegalo al final de tu presentación sin borrar lo que ya tenés.'
    };

    // Sin el módulo de Instagram (instagram.available === false) el paso se
    // completa con los trabajos: el servidor deja opcionales los dos checks de IG.
    var IG_UNAVAILABLE_NOTE = 'La validación de Instagram se habilita pronto: por ahora cargá tus trabajos.';
    // Acceso al demo desde el dock (en móvil reemplaza a la tarjeta, que se oculta).
    var DEMO_LINK_LABEL = 'Probá el modo demo →';
    var REVIEWED_LABEL = 'Ya lo revisé';
    // Motivos con los que WoTour.narrator.speak avisa que no pudo leer.
    var VOICE_FAIL = {
        unsupported: 'Este navegador no tiene voz para leer los pasos.',
        gesture: 'Tocá de nuevo para escuchar: el navegador pide un toque antes de habilitar la voz.',
        generic: 'No pudimos leer el paso en voz alta. Probá de nuevo.'
    };

    var COMPLETED_COPY = {
        title: 'Tu perfil está listo',
        description: 'Ya recorriste todos los pasos. Mirá la bienvenida para conocer todo lo que podés hacer en We Ötzi.'
    };

    var WELCOME = {
        eyebrow: 'Modo asistido · completo',
        intro: 'Bienvenido a We Ötzi. Tu perfil ya tiene todo lo necesario para recibir cotizaciones: desde ahora, cada persona que entre a tu enlace puede pedirte un tatuaje con la información completa.',
        featuresTitle: 'Todo lo que podés hacer en We Ötzi',
        features: [
            { icon: 'file-text', name: 'Cotizaciones', text: 'Recibí pedidos completos y respondé con tu presupuesto.' },
            { icon: 'calendar', name: 'Calendario', text: 'Organizá tus sesiones y recordatorios en una sola agenda.' },
            { icon: 'briefcase', name: 'Job board', text: 'Encontrá personas que ya buscan tatuarse con tu estilo.' },
            { icon: 'map-pin', name: 'Spots e invitaciones', text: 'Postulate a espacios en estudios y respondé invitaciones.' },
            { icon: 'globe', name: 'Travel', text: 'Planificá tus viajes y avisá dónde vas a tatuar.' },
            { icon: 'inbox', name: 'Inbox', text: 'Hablá con clientes, estudios y soporte desde un solo lugar.' },
            { icon: 'bar-chart-2', name: 'Estadísticas', text: 'Mirá cuántas visitas y cotizaciones suma tu perfil.' },
            { icon: 'credit-card', name: 'Wallet', text: 'Cobrá señas y pagos protegidos, y retirá tu saldo.' }
        ],
        whyTitle: 'Por qué conviene que tus clientes coticen con We Ötzi',
        why: [
            'Solicitudes completas: cada pedido llega con idea, zona, tamaño, referencias y presupuesto.',
            'Todo ordenado en un solo lugar, con historial y sin mensajes perdidos.',
            'Tu enlace funciona como cotizador las 24 horas, aunque no estés conectado.',
            'Agenda y recordatorios conectados a tu calendario.',
            'Cobros y señas protegidos en el Wallet.',
            'Reseñas verificadas que suman confianza a tu perfil.',
            'Soporte del equipo We Ötzi ante cancelaciones, disputas o dudas.'
        ],
        supportTitle: 'Soporte',
        supportBefore: 'Si necesitás ayuda, escribinos desde ',
        supportInbox: 'Inbox → Soporte',
        supportMiddle: ' o a ',
        supportAfter: '. Te responde una persona del equipo We Ötzi.'
    };

    /* -------------------------------- utils --------------------------------- */
    function ss(key, value) {
        try {
            if (value === undefined) return sessionStorage.getItem(key);
            if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function ls(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function warn() { if (window.console) console.warn.apply(console, ['[wo-assist]'].concat([].slice.call(arguments))); }
    function noop() { /* sin acción */ }
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\x22/g, '&quot;').replace(/\x27/g, '&#39;');
    }
    function icon(name) {
        return '<i data-wo-icon="' + name + '" class="wo-icon-18" aria-hidden="true"></i>';
    }
    function hydrate(node) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') { try { window.WoIcons.hydrate(node); } catch (e) { /* opcional */ } }
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    // rAF con respaldo: en pestañas que no pintan (fondo) rAF no llega nunca.
    function nextFrame() {
        return new Promise(function (r) {
            var settled = false;
            var finish = function () { if (!settled) { settled = true; r(); } };
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(finish);
            setTimeout(finish, 100);
        });
    }
    function waitFor(check, timeout) {
        var deadline = Date.now() + (timeout || 2000);
        return new Promise(function (resolve) {
            (function tick() {
                var ok = false;
                try { ok = !!check(); } catch (e) { ok = false; }
                if (ok) return resolve(true);
                if (Date.now() > deadline) return resolve(false);
                setTimeout(tick, 60);
            })();
        });
    }
    function demoOn() { return !!(window.WoDemo && window.WoDemo.enabled); }
    function reducedMotion() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }
    function isNarrow() { return (window.innerWidth || 1024) < 768; }
    function whenReady() {
        if (document.readyState !== 'loading') return Promise.resolve();
        return new Promise(function (r) { document.addEventListener('DOMContentLoaded', function () { r(); }); });
    }

    /* ------------------------------ rutas (base) ----------------------------- */
    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var p = String((window.location && window.location.pathname) || '');
        return /^\/beta(?:\/|$)/.test(p) ? '/beta' : '';
    }
    function appPath(p) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') {
            try { return window.WoDemo.appPath(p); } catch (e) { /* respaldo local */ }
        }
        var base = basePath();
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }
    // Ruta actual sin base path ni barra final (para comparar con /artist/account).
    function localPath() {
        var p = String((window.location && window.location.pathname) || '/');
        var base = basePath();
        if (base && (p === base || p.indexOf(base + '/') === 0)) p = p.slice(base.length) || '/';
        return p.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
    }
    function onAccountPage() { return localPath() === ACCOUNT_PATH; }
    function safeUrl(u) { return /^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u) : ''; }

    /* ------------------------------- sesión ------------------------------- */
    function readSession() {
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!/^sb-.+-auth-token$/.test(key)) continue;
                var raw = JSON.parse(localStorage.getItem(key) || 'null');
                var session = raw && raw.currentSession ? raw.currentSession : raw;
                if (session && session.access_token) return session;
            }
        } catch (e) { /* storage bloqueado */ }
        return null;
    }
    function getAccessToken() {
        if (window.WoDemo && typeof window.WoDemo.getAccessToken === 'function') {
            try { return Promise.resolve(window.WoDemo.getAccessToken()); } catch (e) { /* respaldo local */ }
        }
        var fromStorage = function () { var s = readSession(); return (s && s.access_token) || null; };
        var client = window._supabase;
        if (client && client.auth && typeof client.auth.getSession === 'function') {
            return Promise.resolve(client.auth.getSession()).then(function (res) {
                var s = res && res.data && res.data.session;
                return (s && s.access_token) || fromStorage();
            }).catch(fromStorage);
        }
        return Promise.resolve(fromStorage());
    }

    /* --------------------------------- API --------------------------------- */
    function ownApi(path, opts) {
        opts = opts || {};
        return getAccessToken().then(function (token) {
            if (!token) { var e = new Error('Authentication required'); e.status = 401; throw e; }
            var headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
            var init = { method: opts.method || 'GET', headers: headers, credentials: 'same-origin' };
            if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
            return window.fetch(appPath(path), init);
        }).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (json) {
                if (!res.ok || (json && json.success === false)) {
                    var err = new Error((json && json.error) || ('HTTP ' + res.status));
                    err.status = res.status;
                    throw err;
                }
                return json;
            });
        });
    }
    function fetchState(fresh) {
        if (window.WoDemo && typeof window.WoDemo.onboarding === 'function') {
            try { return Promise.resolve(window.WoDemo.onboarding(fresh ? { fresh: true } : undefined)); } catch (e) { return Promise.reject(e); }
        }
        return ownApi(API_PATH, { method: 'GET' });
    }
    // POST /api/artist/onboarding; la respuesta es el estado completo y se aplica.
    function post(body, opts) {
        opts = opts || {};
        var p;
        if (window.WoDemo && typeof window.WoDemo.api === 'function') {
            try { p = window.WoDemo.api(API_PATH, { method: 'POST', body: body }); } catch (e) { p = Promise.reject(e); }
        } else {
            p = ownApi(API_PATH, { method: 'POST', body: body });
        }
        return Promise.resolve(p).then(function (res) {
            if (!opts.noApply && state.mounted && res && Array.isArray(res.steps)) {
                state.fetchToken++;
                apply(res, {});
            }
            return res;
        });
    }

    /* ---------------------------- lógica de pasos ---------------------------- */
    function sectionForStep(step) {
        return Object.prototype.hasOwnProperty.call(STEP_SECTION, step) ? STEP_SECTION[step] : null;
    }
    var SAFE_ID = /^[a-z0-9_-]+$/i;
    // Selectores del marco, del más específico al más general.
    function anchorSelectors(step, check) {
        var out = [];
        if (!SAFE_ID.test(String(step || ''))) return out;
        if (check && SAFE_ID.test(String(check))) out.push('[data-assist~="' + step + '.' + check + '"]');
        out.push('[data-assist~="' + step + '"]');
        var section = sectionForStep(step);
        if (section) out.push('#aac-' + section);
        return out;
    }
    // Un mensaje distinto del actual (rnd inyectable para tests).
    function pickMessage(current, rnd) {
        var pool = BIO_MESSAGES.filter(function (m) { return m !== current; });
        if (!pool.length) return current || BIO_MESSAGES[0];
        var r = typeof rnd === 'function' ? Number(rnd()) : Math.random();
        if (!isFinite(r) || r < 0) r = 0;
        var idx = Math.floor(r * pool.length);
        if (idx >= pool.length) idx = pool.length - 1;
        return pool[idx];
    }
    function copyFor(step) { return STEP_COPY[step] || { title: step, description: '', checks: {} }; }
    // Pasos en el orden del contrato, completando lo que falte en la respuesta.
    function normalizeSteps(data) {
        var list = data && Array.isArray(data.steps) ? data.steps : [];
        var byId = {};
        list.forEach(function (s) { if (s && s.id) byId[s.id] = s; });
        return STEP_IDS.map(function (id, i) {
            var s = byId[id] || {};
            var copy = copyFor(id);
            var checks = (Array.isArray(s.checks) ? s.checks : []).filter(function (c) { return c && c.id; }).map(function (c) {
                var id2 = String(c.id);
                return { id: id2, label: String(c.label || (copy.checks && copy.checks[id2]) || id2), done: !!c.done, optional: !!c.optional };
            });
            var status = /^(done|skipped|unavailable|pending)$/.test(String(s.status)) ? s.status : 'pending';
            return { id: id, n: i + 1, title: String(s.title || copy.title || id), status: status, checks: checks };
        });
    }
    function statusOf(steps, id) {
        var idx = STEP_IDS.indexOf(id);
        return idx === -1 || !steps[idx] ? null : steps[idx].status;
    }
    function firstPendingCheck(step) {
        if (!step || !step.checks) return null;
        var optional = null;
        for (var i = 0; i < step.checks.length; i++) {
            var c = step.checks[i];
            if (c.done) continue;
            if (!c.optional) return c;
            if (!optional) optional = c;
        }
        return optional;
    }
    // Siguiente paso a mostrar: el próximo pendiente (o no disponible que todavía
    // no se mostró); si no hay más adelante, el primer pendiente desde el inicio.
    function nextStepAfter(steps, id, passed) {
        passed = passed || {};
        var idx = STEP_IDS.indexOf(id);
        var i;
        for (i = idx + 1; i < STEP_IDS.length; i++) {
            var st = steps[i] && steps[i].status;
            if (st === 'pending' || (st === 'unavailable' && !passed[STEP_IDS[i]])) return STEP_IDS[i];
        }
        for (i = 0; i < Math.max(idx, 0); i++) {
            if (steps[i] && steps[i].status === 'pending') return STEP_IDS[i];
        }
        return null;
    }
    function resolveView(data, steps, uiState) {
        if (uiState && uiState.view && STEP_IDS.indexOf(uiState.view) !== -1) return uiState.view;
        if (!data) return null;
        if (data.completed) return null;
        if (data.current_step && STEP_IDS.indexOf(data.current_step) !== -1) return data.current_step;
        for (var i = 0; i < steps.length; i++) if (steps[i].status === 'pending') return steps[i].id;
        return null;
    }

    /* ------------------------- modelo y markup (puros) ------------------------ */
    function buildPanelModel(data, uiState, ctx) {
        ctx = ctx || {};
        uiState = uiState || {};
        var steps = normalizeSteps(data);
        var viewId = data ? resolveView(data, steps, uiState) : null;
        var v = viewId ? steps[STEP_IDS.indexOf(viewId)] : null;
        var progress = (data && data.progress) || {};
        var done = typeof progress.done === 'number' ? progress.done : steps.filter(function (s) { return s.status === 'done'; }).length;
        var total = STEP_IDS.length;
        var anyPending = steps.some(function (s) { return s.status === 'pending'; });
        var copy = v ? copyFor(v.id) : null;
        var igOff = !!(v && v.id === 'portafolio' && data && data.instagram && data.instagram.available === false);
        return {
            loading: !!ctx.loading,
            error: !!ctx.error,
            confirmExit: !!ctx.confirmExit,
            minimized: !!uiState.minimized,
            stepsOpen: !!uiState.stepsOpen,
            completed: !!data && !v && (!!data.completed || !anyPending),
            completedAll: !!(data && data.completed),
            viewId: viewId,
            view: v ? {
                id: v.id, n: v.n, title: v.title, status: v.status, checks: v.checks,
                description: copy.description || '', unavailableCopy: copy.unavailable || 'Este paso todavía no está disponible.',
                extra: igOff ? IG_UNAVAILABLE_NOTE : '',
                reviewable: REVIEW_ACK_STEPS.indexOf(v.id) !== -1,
                section: sectionForStep(v.id)
            } : null,
            steps: steps.map(function (s) { return { id: s.id, n: s.n, title: s.title, status: s.status, isView: s.id === viewId }; }),
            total: total,
            done: Math.max(0, Math.min(total, done)),
            pct: Math.round((Math.max(0, Math.min(total, done)) / total) * 100),
            share: viewId === 'compartir' ? {
                url: safeUrl(data && data.profile_url),
                bio: BIO_MESSAGES.indexOf(uiState.bio) !== -1 ? uiState.bio : BIO_MESSAGES[0],
                copied: ctx.copied || null
            } : null,
            flash: ctx.flash || null,
            narrator: !!ctx.narrator,
            speaking: !!ctx.speaking,
            rateLabel: ctx.rateLabel || '',
            demoLink: !!ctx.demoLink
        };
    }

    // Botones del panel: el primario es ink (el accent amarillo queda para la página).
    function btn(act, label, kind, extra) {
        var cls = 'wo-btn wo-btn--s ' + (kind === 'ink' ? 'wo-btn--ink wo-btn--hard' : 'wo-btn--ghost');
        return '<button type="button" class="' + cls + ' wo-assist__btn" data-assist-act="' + act + '"' + (extra || '') + '>' + esc(label) + '</button>';
    }
    function renderChecks(v) {
        if (!v.checks.length) return '';
        return '<ul class="wo-assist__checks" aria-label="Qué incluye este paso">' + v.checks.map(function (c) {
            var inner = icon(c.done ? 'check-circle' : 'circle') +
                '<span class="wo-assist__sr">' + (c.done ? 'Hecho: ' : 'Pendiente: ') + '</span>' +
                '<span class="wo-assist__checklabel">' + esc(c.label) + '</span>' +
                (c.optional ? '<span class="wo-assist__opt">Opcional</span>' : '');
            var row = v.section && !c.done && v.status !== 'unavailable'
                ? '<button type="button" class="wo-assist__checkrow" data-assist-act="focus-check" data-check="' + esc(c.id) + '">' + inner + '</button>'
                : '<div class="wo-assist__checkrow">' + inner + '</div>';
            return '<li class="wo-assist__check' + (c.done ? ' is-done' : '') + '">' + row + '</li>';
        }).join('') + '</ul>';
    }
    function renderShare(m) {
        var s = m.share;
        var html = '<div class="wo-assist__share">';
        html += '<label class="wo-assist__label" for="wo-assist-link">' + esc(SHARE_COPY.linkLabel) + '</label>';
        if (s.url) {
            html += '<div class="wo-assist__copyrow"><input class="wo-assist__field" id="wo-assist-link" type="text" readonly value="' + esc(s.url) + '">' +
                btn('copy-link', s.copied === 'link' ? 'COPIADO' : 'COPIAR ENLACE', 'ghost') + '</div>';
        } else {
            html += '<p class="wo-assist__hint">' + esc(SHARE_COPY.noLink) + '</p>';
        }
        html += '<p class="wo-assist__hint">' + esc(SHARE_COPY.instructions) + '</p>';
        html += '<label class="wo-assist__label" for="wo-assist-bio">' + esc(SHARE_COPY.bioLabel) + '</label>';
        html += '<textarea class="wo-assist__field wo-assist__bio" id="wo-assist-bio" rows="2" readonly>' + esc(s.bio) + '</textarea>';
        html += '<div class="wo-assist__copyrow">' + btn('regen', 'GENERAR OTRO', 'ghost') +
            btn('copy-bio', s.copied === 'bio' ? 'COPIADO' : 'COPIAR MENSAJE', 'ghost') + '</div>';
        html += '<p class="wo-assist__hint">' + esc(SHARE_COPY.bioHint) + '</p>';
        html += '<a class="wo-btn wo-btn--s wo-btn--ghost wo-assist__btn" href="' + INSTAGRAM_EDIT_URL + '" target="_blank" rel="noopener">ABRIR INSTAGRAM →</a>';
        return html + '</div>';
    }
    function renderStep(m) {
        var v = m.view;
        var note = v.status === 'done' ? 'Este paso ya está listo.' : v.status === 'skipped' ? 'Lo dejaste para después.' : '';
        var desc = v.status === 'unavailable' ? v.unavailableCopy : v.description;
        var html = '<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">' + esc(v.title) + '</h2>' +
            (note ? '<p class="wo-assist__note">' + esc(note) + '</p>' : '') +
            '<p class="wo-assist__desc">' + esc(desc) + '</p>' +
            (v.extra && v.status !== 'unavailable' ? '<p class="wo-assist__desc wo-assist__extra">' + esc(v.extra) + '</p>' : '');
        if (v.status !== 'unavailable') html += renderChecks(v);
        if (v.id === 'compartir' && v.status !== 'done' && m.share) html += renderShare(m);
        var actions;
        if (v.status === 'unavailable') actions = btn('continue', 'CONTINUAR →', 'ink');
        else if (v.status === 'done') actions = btn('continue', 'CONTINUAR →', 'ink') + (v.section ? btn('go', 'IR AL PASO →', 'ghost') : '');
        else if (v.id === 'compartir') actions = btn('pasted', 'YA LO PEGUÉ EN MI INSTAGRAM', 'ink') + btn('later', 'LO HAGO DESPUÉS', 'ghost');
        else {
            // Notificaciones y configuración pueden estar bien como vienen: "Ya lo revisé"
            // las da por hechas (acknowledge) sin obligar a cambiar un valor.
            actions = btn('go', 'IR AL PASO →', 'ink') + (v.reviewable ? btn('reviewed', REVIEWED_LABEL, 'ghost') : '') +
                (v.status === 'skipped' ? '' : btn('later', 'LO HAGO DESPUÉS', 'ghost'));
        }
        return html + '<div class="wo-assist__actions">' + actions + '</div>';
    }
    function renderCompleted() {
        return '<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">' + esc(COMPLETED_COPY.title) + '</h2>' +
            '<p class="wo-assist__desc">' + esc(COMPLETED_COPY.description) + '</p>' +
            '<div class="wo-assist__actions">' + btn('welcome', 'VER BIENVENIDA →', 'ink') + btn('finish', 'TERMINAR', 'ghost') + '</div>';
    }
    function renderConfirm() {
        return '<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">¿Salir del modo asistido?</h2>' +
            '<p class="wo-assist__desc">Podés retomarlo desde el menú Ö.</p>' +
            '<div class="wo-assist__actions">' + btn('exit-confirm', 'SALIR', 'ink') + btn('exit-cancel', 'SEGUIR CON LOS PASOS', 'ghost') + '</div>';
    }
    function renderTools(m) {
        var html = '<div class="wo-assist__tools">';
        if (m.narrator) {
            html += '<button type="button" class="wo-assist__tool" data-assist-act="listen" aria-pressed="' + (m.speaking ? 'true' : 'false') + '">' +
                icon(m.speaking ? 'square' : 'volume-2') + '<span>' + (m.speaking ? 'DETENER' : 'ESCUCHAR') + '</span></button>';
            html += '<button type="button" class="wo-assist__tool" data-assist-act="rate" title="Velocidad de narración" aria-label="' +
                esc('Velocidad de narración: ' + m.rateLabel) + '">' + icon('fast-forward') + '<span>' + esc(m.rateLabel) + '</span></button>';
        }
        html += '<button type="button" class="wo-assist__link" data-assist-act="toggle-steps" aria-controls="wo-assist-steps" aria-expanded="' +
            (m.stepsOpen ? 'true' : 'false') + '">' + (m.stepsOpen ? 'Ocultar los pasos' : 'Ver todos los pasos') + '</button>';
        html += '</div>';
        html += '<ol class="wo-assist__steps" id="wo-assist-steps" aria-label="Pasos del modo asistido"' + (m.stepsOpen ? '' : ' hidden') + '>' +
            m.steps.map(function (s) {
                return '<li><button type="button" class="wo-assist__stepbtn is-' + s.status + (s.isView ? ' is-view' : '') + '" data-assist-act="pick-step" data-step="' + s.id + '"' +
                    (s.isView ? ' aria-current="step"' : '') + '>' +
                    '<span class="wo-assist__stepn">' + (s.status === 'done' ? icon('check-circle') : esc(s.n)) + '</span>' +
                    '<span class="wo-assist__stept">' + esc(s.title) + '</span>' +
                    '<span class="wo-assist__stepstatus">' + esc(STATUS_LABEL[s.status] || '') + '</span></button></li>';
            }).join('') +
            (m.completedAll ? '<li><button type="button" class="wo-assist__stepbtn is-welcome" data-assist-act="welcome">' +
                '<span class="wo-assist__stepn">' + icon('star') + '</span><span class="wo-assist__stept">Bienvenida a We Ötzi</span>' +
                '<span class="wo-assist__stepstatus">Ver</span></button></li>' : '') +
            '</ol>';
        if (m.demoLink) html += '<button type="button" class="wo-assist__link wo-assist__demo" data-assist-act="demo">' + esc(DEMO_LINK_LABEL) + '</button>';
        return html;
    }
    function renderPanel(m) {
        var eyebrow = 'Modo asistido';
        if (!m.loading && !m.error && !m.confirmExit) {
            if (m.view) eyebrow += ' · paso ' + m.view.n + ' de ' + m.total;
            else if (m.completed) eyebrow += ' · completo';
        }
        var html = '<div class="wo-assist__head"><p class="wo-assist__eyebrow">' + esc(eyebrow) + '</p><div class="wo-assist__headtools">' +
            '<button type="button" class="wo-assist__icon" data-assist-act="minimize" aria-label="Minimizar el modo asistido" aria-controls="wo-assist-panel" aria-expanded="true">' + icon('minus') + '</button>' +
            '<button type="button" class="wo-assist__icon" data-assist-act="close" aria-label="Salir del modo asistido">' + icon('x') + '</button>' +
            '</div></div>';
        if (!m.loading && !m.error) {
            html += '<div class="wo-assist__bar" aria-hidden="true"><span style="width:' + m.pct + '%"></span></div>' +
                '<p class="wo-assist__sr">' + esc(m.done + ' de ' + m.total + ' pasos listos') + '</p>';
        }
        if (m.flash && !m.confirmExit) html += '<p class="wo-assist__flash">' + icon('check-circle') + '<span>' + esc(m.flash) + '</span></p>';
        if (m.confirmExit) html += renderConfirm();
        else if (m.loading) html += '<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">Cargando tus pasos</h2><p class="wo-assist__desc">Estamos revisando qué te falta completar.</p>';
        else if (m.error) html += '<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">No pudimos cargar tus pasos</h2>' +
            '<p class="wo-assist__desc">Revisá tu conexión y probá de nuevo en unos segundos.</p><div class="wo-assist__actions">' + btn('retry', 'REINTENTAR', 'ink') + '</div>';
        else if (m.view) html += renderStep(m);
        else html += renderCompleted();
        if (!m.loading && !m.error && !m.confirmExit) html += renderTools(m);
        return html;
    }
    function pillLabel(m) {
        if (m.view) return 'Modo asistido · ' + m.view.n + '/' + m.total;
        if (m.completed) return 'Modo asistido · listo';
        return 'Modo asistido';
    }
    function renderPill(m) { return icon('chevron-up') + '<span>' + esc(pillLabel(m)) + '</span>'; }

    function buildWelcomeModel(data, identity, ctx) {
        ctx = ctx || {};
        var name = String((data && data.artist_name) || (identity && identity.name) || '').trim();
        return {
            title: name ? 'Felicitaciones, ' + name + ': tu perfil está listo' : 'Felicitaciones: tu perfil está listo',
            profileUrl: safeUrl(data && data.profile_url),
            dashboardHref: appPath(DASHBOARD_PATH),
            inboxHref: appPath(INBOX_PATH),
            narrator: !!ctx.narrator,
            speaking: !!ctx.speaking
        };
    }
    function renderWelcome(w) {
        var html = '<section class="wo-assist-welcome__card" role="dialog" aria-modal="true" aria-labelledby="wo-assist-welcome-title" aria-describedby="wo-assist-welcome-intro">' +
            '<div class="wo-assist-welcome__head"><p class="wo-assist__eyebrow">' + esc(WELCOME.eyebrow) + '</p>' +
            '<button type="button" class="wo-assist__icon" data-welcome-act="close" aria-label="Cerrar la bienvenida y terminar el modo asistido">' + icon('x') + '</button></div>' +
            '<h2 class="wo-assist-welcome__title" id="wo-assist-welcome-title" tabindex="-1">' + esc(w.title) + '</h2>' +
            '<p class="wo-assist-welcome__intro" id="wo-assist-welcome-intro">' + esc(WELCOME.intro) + '</p>' +
            '<h3 class="wo-assist-welcome__h">' + esc(WELCOME.featuresTitle) + '</h3>' +
            '<ul class="wo-assist-welcome__grid">' + WELCOME.features.map(function (f) {
                return '<li class="wo-assist-welcome__feat"><span class="wo-assist-welcome__ic">' + icon(f.icon) + '</span>' +
                    '<span class="wo-assist-welcome__feattext"><b>' + esc(f.name) + '</b><span>' + esc(f.text) + '</span></span></li>';
            }).join('') + '</ul>' +
            '<h3 class="wo-assist-welcome__h">' + esc(WELCOME.whyTitle) + '</h3>' +
            '<ul class="wo-assist-welcome__why">' + WELCOME.why.map(function (t) {
                return '<li>' + icon('check') + '<span>' + esc(t) + '</span></li>';
            }).join('') + '</ul>' +
            '<h3 class="wo-assist-welcome__h">' + esc(WELCOME.supportTitle) + '</h3>' +
            '<p class="wo-assist-welcome__support">' + esc(WELCOME.supportBefore) +
            '<a href="' + esc(w.inboxHref) + '">' + esc(WELCOME.supportInbox) + '</a>' + esc(WELCOME.supportMiddle) +
            '<a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a>' + esc(WELCOME.supportAfter) + '</p>' +
            '<div class="wo-assist-welcome__actions">' +
            '<a class="wo-btn wo-btn--accent wo-btn--hard" href="' + esc(w.dashboardHref) + '" data-welcome-act="panel">IR A MI PANEL →</a>' +
            (w.profileUrl ? '<a class="wo-btn wo-btn--ghost" href="' + esc(w.profileUrl) + '" target="_blank" rel="noopener">VER MI PERFIL PÚBLICO</a>' : '') +
            (w.narrator ? '<button type="button" class="wo-btn wo-btn--ghost wo-assist-welcome__listen" data-welcome-act="listen" aria-pressed="' + (w.speaking ? 'true' : 'false') + '">' +
                (w.speaking ? 'DETENER' : 'ESCUCHAR') + '</button>' : '') +
            '</div></section>';
        return html;
    }

    /* -------------------------------- estado -------------------------------- */
    var state = {
        mounted: false, booting: null, explicit: false, identity: null,
        data: null, error: false, confirmExit: false, viewId: null, renderKey: '',
        fetchToken: 0, focusToken: 0, speakToken: 0, speaking: false,
        flash: null, copied: null, acked: {}, welcomeShown: false,
        timers: {}, poll: null,
        // Sube en cada close(): un arranque que resuelve después de salir no monta nada.
        closeGen: 0,
        // Último wo:demo-suggestions-changed (null = preguntarle a WoDemo).
        suggest: null
    };
    var els = null;
    var welcome = { el: null, lastFocus: null };
    var ring = { el: null, target: null, step: null, section: null, raf: 0, pulse: 0, ro: null, watching: false };

    function loadUi() {
        var raw = null;
        try { raw = JSON.parse(ss(UI_KEY) || 'null'); } catch (e) { raw = null; }
        raw = raw && typeof raw === 'object' ? raw : {};
        return {
            uid: raw.uid || null,
            minimized: !!raw.minimized,
            stepsOpen: !!raw.stepsOpen,
            view: STEP_IDS.indexOf(raw.view) !== -1 ? raw.view : null,
            passed: raw.passed && typeof raw.passed === 'object' ? raw.passed : {},
            bio: BIO_MESSAGES.indexOf(raw.bio) !== -1 ? raw.bio : null,
            focus: raw.focus && STEP_IDS.indexOf(raw.focus.step) !== -1 ? raw.focus : null
        };
    }
    var ui = loadUi();
    function persistUi() { ss(UI_KEY, JSON.stringify(ui)); }
    function clearTimer(name) { if (state.timers[name]) { clearTimeout(state.timers[name]); state.timers[name] = null; } }
    function later(name, fn, ms) { clearTimer(name); state.timers[name] = setTimeout(function () { state.timers[name] = null; fn(); }, ms); }

    function userId() {
        var id = state.identity && state.identity.userId;
        if (!id && window.WoDemo && window.WoDemo.identity) id = window.WoDemo.identity.userId;
        if (!id && state.data && state.data.user_id) id = state.data.user_id;
        if (!id) { var s = readSession(); id = s && s.user && s.user.id; }
        return id || null;
    }
    // Espejo local del contrato §2 (solo cuando WoDemo no lo maneja).
    function writeMirror(active) {
        var uid = userId();
        if (!uid) return;
        var key = 'wo_onb_' + uid;
        var m = {};
        try { m = JSON.parse(ls(key) || '{}') || {}; } catch (e) { m = {}; }
        m.assisted_active = !!active;
        m.synced_at = new Date().toISOString();
        ls(key, JSON.stringify(m));
    }
    function dispatchChanged(active) {
        try { document.dispatchEvent(new CustomEvent('wo:assist-changed', { detail: { active: !!active } })); } catch (e) { /* sin CustomEvent */ }
    }
    // Con la bienvenida abierta el dock queda inert (fuera del árbol accesible):
    // los avisos van a la región viva del diálogo.
    function liveRegion() {
        if (welcome.el) {
            var w = welcome.el.querySelector('.wo-assist-welcome__live');
            if (w) return w;
        }
        return els && els.live ? els.live : null;
    }
    function announce(text) {
        var node = liveRegion();
        if (!node) return;
        node.textContent = '';
        setTimeout(function () { if (node.isConnected !== false) node.textContent = text; }, 40);
    }

    /* ------------------------------ modo demo ------------------------------ */
    // El dock ofrece el demo en el dashboard mientras la sugerencia siga
    // prendida y el artista no la haya cerrado en esta sesión ("AHORA NO").
    function demoLinkAllowed() {
        var D = window.WoDemo;
        if (!D || D.enabled || typeof D.enable !== 'function') return false;
        if (localPath() !== DASHBOARD_PATH) return false;
        if (state.suggest === false) return false;
        if (state.suggest !== true) {
            try { if (typeof D.suggestionsEnabled !== 'function' || D.suggestionsEnabled() === false) return false; } catch (e) { return false; }
        }
        return ss(DEMO_DISMISSED_KEY) !== '1';
    }
    function startDemo() {
        var D = window.WoDemo;
        if (!D || typeof D.enable !== 'function') return;
        stopNarration();
        try { D.enable({ tour: true }); } catch (e) { warn('no se pudo abrir el demo', e && e.message); }
    }
    function onSuggestionsChanged(e) {
        var d = e && e.detail;
        state.suggest = d && typeof d.enabled === 'boolean' ? d.enabled : null;
        render();
    }

    /* --------------------------------- voz --------------------------------- */
    function narrator() {
        var n = window.WoTour && window.WoTour.narrator;
        return n && typeof n.speak === 'function' ? n : null;
    }
    function narratorSupported() {
        var n = narrator();
        if (!n) return false;
        try { return typeof n.supported !== 'function' || !!n.supported(); } catch (e) { return false; }
    }
    function rates() {
        var n = narrator();
        return n && Array.isArray(n.RATES) && n.RATES.length ? n.RATES : DEFAULT_RATES;
    }
    function currentRate() {
        var n = narrator();
        var r = 1;
        try { r = Number(n && n.getRate ? n.getRate() : 1) || 1; } catch (e) { r = 1; }
        return r;
    }
    function formatRate(r) {
        var n = narrator();
        if (n && typeof n.formatRate === 'function') { try { return String(n.formatRate(r)); } catch (e) { /* respaldo */ } }
        return String(r).replace('.', ',') + '×';
    }
    function speechText(text) { return String(text || '').replace(/\s*→\s*/g, ', ').replace(/\s+/g, ' ').trim(); }
    function dockNarration() {
        var m = currentModel();
        if (m.view) {
            var v = m.view;
            var text = v.title + '. ' + (v.status === 'unavailable' ? v.unavailableCopy : v.description + (v.extra ? ' ' + v.extra : ''));
            if (v.id === 'compartir' && v.status !== 'done') text += ' ' + SHARE_COPY.instructions + ' ' + SHARE_COPY.bioHint;
            return speechText(text);
        }
        if (m.completed) return speechText(COMPLETED_COPY.title + '. ' + COMPLETED_COPY.description);
        return '';
    }
    function welcomeNarration() {
        var w = buildWelcomeModel(state.data, state.identity);
        return speechText(w.title + '. ' + WELCOME.intro + ' ' + WELCOME.supportBefore + WELCOME.supportInbox + WELCOME.supportMiddle + SUPPORT_EMAIL + WELCOME.supportAfter);
    }
    function stopNarration() {
        if (!state.speaking) return;
        state.speakToken++;
        state.speaking = false;
        try { var n = narrator(); if (n && typeof n.stop === 'function') n.stop(); } catch (e) { /* sin voz */ }
        syncListenButtons();
    }
    function toggleListen(source) {
        var n = narrator();
        if (!n) return;
        if (state.speaking) { var was = state.speaking; stopNarration(); render(); if (was === source) return; }
        var text = source === 'welcome' ? welcomeNarration() : dockNarration();
        if (!text) return;
        var token = ++state.speakToken;
        state.speaking = source;
        syncListenButtons();
        render();
        var called = false;
        var finish = function (ok, reason) {
            if (called || token !== state.speakToken) return;
            called = true;
            state.speaking = false;
            syncListenButtons();
            render();
            if (ok === false) {
                var why = voiceFailMessage(reason);
                if (why) announce(why);
            }
        };
        // Tocar ESCUCHAR es pedir la voz: si se apagó en el recorrido del demo
        // (preferencia compartida wo_tour_voice), se vuelve a prender.
        try {
            if (typeof n.voiceEnabled === 'function' && !n.voiceEnabled() && typeof n.setVoiceEnabled === 'function') n.setVoiceEnabled(true);
        } catch (e) { /* narrador sin preferencia de voz */ }
        try { n.speak(text, finish); } catch (e) { finish(false, 'error'); }
    }
    // Texto para la región viva cuando la voz no arrancó; null si la cortó el artista.
    function voiceFailMessage(reason) {
        if (reason === 'stopped' || reason === 'replaced') return null;
        if (reason === 'unsupported') return VOICE_FAIL.unsupported;
        if (reason === 'gesture') return VOICE_FAIL.gesture;
        return VOICE_FAIL.generic;
    }
    function cycleRate() {
        var n = narrator();
        if (!n) return;
        var list = rates();
        var cur = currentRate();
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - cur) < 0.01) idx = i;
        var next = list[(idx + 1) % list.length];
        try { n.setRate(next); } catch (e) { /* narrador sin velocidad */ }
        render();
        announce('Velocidad de narración: ' + formatRate(next));
    }
    function syncListenButtons() {
        if (!welcome.el) return;
        var b = welcome.el.querySelector('[data-welcome-act="listen"]');
        if (!b) return;
        var on = state.speaking === 'welcome';
        b.textContent = on ? 'DETENER' : 'ESCUCHAR';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    /* ------------------------------ render ------------------------------ */
    function currentModel() {
        var nar = narratorSupported();
        return buildPanelModel(state.data, ui, {
            loading: !state.data && !state.error,
            error: !state.data && state.error,
            confirmExit: state.confirmExit,
            flash: state.flash,
            copied: state.copied,
            narrator: nar,
            speaking: state.speaking === 'dock',
            rateLabel: nar ? formatRate(currentRate()) : '',
            demoLink: demoLinkAllowed()
        });
    }
    function activeAct() {
        var a = document.activeElement;
        if (!els || !a || !els.root.contains(a)) return null;
        if (a.id === 'wo-assist-title') return { title: true };
        if (!a.getAttribute || !a.getAttribute('data-assist-act')) return a.id ? { id: a.id } : null;
        return { act: a.getAttribute('data-assist-act'), step: a.getAttribute('data-step'), check: a.getAttribute('data-check') };
    }
    function restoreAct(r) {
        if (!r || !els) return;
        var node = null;
        if (r.title) node = els.panel.querySelector('#wo-assist-title');
        else if (r.id) node = document.getElementById(r.id);
        else {
            var sel = '[data-assist-act="' + r.act + '"]' + (r.step ? '[data-step="' + r.step + '"]' : '') + (r.check ? '[data-check="' + r.check + '"]' : '');
            try { node = els.root.querySelector(sel); } catch (e) { node = null; }
        }
        if (node && !node.closest('[hidden]')) { try { node.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
    }
    function render(force) {
        if (!state.mounted || !els) return;
        var model = currentModel();
        if (model.viewId !== state.viewId) {
            if (state.speaking === 'dock') { stopNarration(); model = currentModel(); }
            state.viewId = model.viewId;
        }
        var key = JSON.stringify(model);
        if (!force && key === state.renderKey) return;
        state.renderKey = key;
        var restore = activeAct();
        els.panel.innerHTML = renderPanel(model);
        els.panel.hidden = model.minimized;
        els.pill.hidden = !model.minimized;
        els.pill.innerHTML = renderPill(model);
        els.pill.setAttribute('aria-label', model.view ? 'Abrir el modo asistido · paso ' + model.view.n + ' de ' + model.total
            : model.completed ? 'Abrir el modo asistido · completo' : 'Abrir el modo asistido');
        els.root.classList.toggle('is-min', model.minimized);
        hydrate(els.root);
        restoreAct(restore);
    }
    function focusTitle() {
        if (!els) return;
        var t = els.panel.querySelector('#wo-assist-title');
        if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
    }
    // Cambios efímeros (fin del "Listo", "COPIADO") se parchean en el lugar para
    // no reemplazar botones mientras el artista está por tocarlos.
    function syncKey() { if (state.mounted && els) state.renderKey = JSON.stringify(currentModel()); }
    function setFlash(text) {
        state.flash = text;
        later('flash', function () {
            state.flash = null;
            var node = els && els.panel.querySelector('.wo-assist__flash');
            if (node && node.parentNode) { node.parentNode.removeChild(node); syncKey(); } else render();
        }, FLASH_MS);
    }
    function setMinimized(min) {
        ui.minimized = !!min;
        persistUi();
        render();
        if (!els) return;
        if (min) { try { els.pill.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
    }

    /* --------------------------------- montaje --------------------------------- */
    function ensureCss() {
        try {
            if (document.querySelector('link[href*="wo-assist.css"]')) return;
            var href = (window.WoDemo && window.WoDemo.assets && window.WoDemo.assets.assistCss) || '/shared/css/wo-assist.css';
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = appPath(href);
            (document.head || document.documentElement).appendChild(l);
        } catch (e) { /* sin estilos propios */ }
    }
    function mount() {
        if (state.mounted) return;
        ensureCss();
        var root = document.createElement('aside');
        root.className = 'wo-assist';
        root.setAttribute('role', 'complementary');
        root.setAttribute('aria-label', 'Modo asistido');
        root.innerHTML =
            '<p class="wo-assist__sr wo-assist__live" role="status" aria-live="polite"></p>' +
            '<div class="wo-assist__panel" id="wo-assist-panel"></div>' +
            '<button type="button" class="wo-assist__pill" data-assist-act="expand" aria-controls="wo-assist-panel" aria-expanded="false" hidden></button>';
        document.body.appendChild(root);
        els = {
            root: root,
            live: root.querySelector('.wo-assist__live'),
            panel: root.querySelector('.wo-assist__panel'),
            pill: root.querySelector('.wo-assist__pill')
        };
        root.addEventListener('click', onRootClick);
        root.addEventListener('keydown', onRootKey);
        document.documentElement.classList.add('wo-assist-on');
        state.mounted = true;
        state.renderKey = '';
        startWatchers();
        // El menú Ö re-arma su entrada ahora que isActive() ya es true. El
        // listener propio de wo:assist-changed solo reacciona a active:false.
        dispatchChanged(true);
    }
    function startWatchers() {
        document.addEventListener('wo:assist-refresh', onRefreshEvent);
        document.addEventListener('wo:demo-suggestions-changed', onSuggestionsChanged);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('hashchange', onHashChange);
        state.poll = setInterval(function () {
            if (document.visibilityState !== 'hidden') refresh();
        }, POLL_MS);
    }
    function stopWatchers() {
        document.removeEventListener('wo:assist-refresh', onRefreshEvent);
        document.removeEventListener('wo:demo-suggestions-changed', onSuggestionsChanged);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('hashchange', onHashChange);
        if (state.poll) { clearInterval(state.poll); state.poll = null; }
    }
    function onRefreshEvent() { later('refresh', refresh, REFRESH_DEBOUNCE_MS); }
    function onVisibility() { if (document.visibilityState === 'visible') refresh(); }
    function onHashChange() {
        // Después de que el centro de cuenta muestre la nueva sección.
        nextFrame().then(function () {
            if (ring.section && !sectionShown(ring.section)) hideRing();
            render();
        });
        later('refresh', refresh, REFRESH_DEBOUNCE_MS);
    }

    /* -------------------------------- aplicar -------------------------------- */
    function validateView(data) {
        if (!ui.view) return;
        var st = statusOf(normalizeSteps(data), ui.view);
        if (st === 'done' || st === 'skipped' || (st === 'unavailable' && ui.passed[ui.view])) ui.view = null;
    }
    function apply(data, opts) {
        opts = opts || {};
        if (!data || typeof data !== 'object' || !state.mounted) return;
        var prev = state.data;
        var prevSteps = prev ? normalizeSteps(prev) : null;
        state.data = data;
        state.error = false;
        var assisted = (data.onboarding && data.onboarding.assisted) || {};
        // El arranque explícito solo protege hasta que el servidor confirma
        // active:true; después, un active:false (otra pestaña, ?asistido=0) cierra.
        if (assisted.active === true) state.explicit = false;
        if (assisted.active === false && !state.explicit) { close(); return; }
        var steps = normalizeSteps(data);
        var shown = state.viewId;
        var justDone = null;
        var checkAdvanced = false;
        if (prevSteps && shown) {
            var i = STEP_IDS.indexOf(shown);
            var before = prevSteps[i], after = steps[i];
            if (after && after.status === 'done' && before && before.status !== 'done') justDone = after;
            else if (after && before) {
                checkAdvanced = after.checks.some(function (c) {
                    if (!c.done) return false;
                    for (var k = 0; k < before.checks.length; k++) if (before.checks[k].id === c.id) return !before.checks[k].done;
                    return false;
                });
            }
        }
        if (justDone) {
            var msg = 'Listo · ' + justDone.title;
            setFlash(msg);
            announce(msg);
            hideRing();
            ui.view = nextStepAfter(steps, justDone.id, ui.passed);
            persistUi();
        }
        render();
        if (data.completed && !assisted.welcome_seen_at && !state.welcomeShown) {
            later('welcome', openWelcome, justDone ? 1400 : (opts.initial ? 500 : 0));
            return;
        }
        var view = state.viewId;
        var section = view && sectionForStep(view);
        if (justDone && section && onAccountPage() && sectionShown(section)) {
            // Mismo lugar: después del "Listo" el marco pasa al próximo paso.
            later('refocus', function () { if (state.viewId === view) focusStep(view, null, {}); }, 900);
        } else if (checkAdvanced && ring.step === view && section && sectionShown(section)) {
            var nextCheck = firstPendingCheck(steps[STEP_IDS.indexOf(view)]);
            if (nextCheck) focusStep(view, nextCheck.id, {});
        }
    }
    function refresh() {
        if (!state.mounted) return Promise.resolve(null);
        var token = ++state.fetchToken;
        return fetchState(true).then(function (data) {
            if (token !== state.fetchToken || !state.mounted) return null;
            apply(data, {});
            return data;
        }).catch(function (err) {
            if (token !== state.fetchToken || !state.mounted) return null;
            warn('no se pudo actualizar el estado', err && err.message);
            if (!state.data) { state.error = true; render(); }
            return null;
        });
    }

    /* ----------------------------- acciones del panel ----------------------------- */
    function onRootClick(e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-assist-act]') : null;
        if (!b || !els || !els.root.contains(b)) return;
        var act = b.getAttribute('data-assist-act');
        var view = state.viewId;
        switch (act) {
            case 'minimize': setMinimized(true); break;
            case 'expand': setMinimized(false); focusTitle(); break;
            case 'close': state.confirmExit = true; render(); focusTitle(); break;
            case 'exit-cancel': state.confirmExit = false; render(); focusTitle(); break;
            case 'exit-confirm': exitAssist(); break;
            case 'finish': exitAssist(); break;
            case 'retry': state.error = false; render(); refresh(); break;
            case 'go': goToStep(view, null); break;
            case 'focus-check': goToStep(view, b.getAttribute('data-check')); break;
            case 'later': skipLater(view); break;
            case 'continue': continueFrom(view); break;
            case 'toggle-steps': ui.stepsOpen = !ui.stepsOpen; persistUi(); render(); break;
            case 'pick-step': pickStep(b.getAttribute('data-step')); break;
            case 'welcome': openWelcome(); break;
            case 'listen': toggleListen('dock'); break;
            case 'rate': cycleRate(); break;
            case 'copy-link': copyLink(); break;
            case 'regen': regenBio(); break;
            case 'copy-bio': copyBio(); break;
            case 'pasted': ackShared(); break;
            case 'reviewed': ackReviewed(view); break;
            case 'demo': startDemo(); break;
            default: break;
        }
    }
    function onRootKey(e) {
        if (e.key !== 'Escape' || !els || els.panel.hidden) return;
        e.stopPropagation();
        if (state.confirmExit) { state.confirmExit = false; render(); focusTitle(); return; }
        setMinimized(true);
    }
    function goToStep(stepId, checkId) {
        var section = sectionForStep(stepId);
        if (!section) return;
        if (!onAccountPage()) {
            ui.focus = { step: stepId, check: checkId || null, at: Date.now() };
            if (isNarrow()) ui.minimized = true;
            persistUi();
            window.location.href = appPath(ACCOUNT_PATH + '#' + section);
            return;
        }
        if (isNarrow()) setMinimized(true);
        focusStep(stepId, checkId, { focus: true });
    }
    function skipLater(stepId) {
        if (!stepId) return;
        var steps = normalizeSteps(state.data);
        hideRing();
        ui.view = nextStepAfter(steps, stepId, ui.passed);
        persistUi();
        render();
        focusTitle();
        post({ assisted: { skip: stepId } }).then(function () {
            announce('Lo dejamos para después. Lo encontrás en la lista de pasos.');
        }, function (err) {
            warn('skip', err && err.message);
            announce('No pudimos guardar el cambio. Probá de nuevo.');
        });
    }
    function continueFrom(stepId) {
        var steps = normalizeSteps(state.data);
        hideRing();
        var st = statusOf(steps, stepId);
        if (st === 'unavailable') {
            ui.passed[stepId] = 1;
            ui.view = nextStepAfter(steps, stepId, ui.passed);
            post({ assisted: { skip: stepId } }).catch(function (err) { warn('skip', err && err.message); });
        } else {
            ui.view = null;
        }
        persistUi();
        render();
        focusTitle();
    }
    function pickStep(stepId) {
        if (STEP_IDS.indexOf(stepId) === -1) return;
        var st = statusOf(normalizeSteps(state.data), stepId);
        ui.view = stepId;
        ui.stepsOpen = false;
        persistUi();
        hideRing();
        render();
        focusTitle();
        if (st === 'skipped') post({ assisted: { unskip: stepId } }).catch(function (err) { warn('unskip', err && err.message); });
    }

    /* ------------------------------ compartir ------------------------------ */
    function legacyCopy(field, text) {
        var ok = false;
        var temp = null;
        try {
            var node = field;
            if (!node) {
                temp = document.createElement('textarea');
                temp.value = text;
                temp.setAttribute('readonly', '');
                temp.className = 'wo-assist__sr';
                document.body.appendChild(temp);
                node = temp;
            }
            node.focus();
            node.select();
            try { node.setSelectionRange(0, String(node.value || '').length); } catch (e) { /* inputs sin rango */ }
            ok = !!document.execCommand('copy');
        } catch (e) { ok = false; }
        if (temp && temp.parentNode) temp.parentNode.removeChild(temp);
        return ok;
    }
    function copyText(text, field) {
        var clip = window.navigator && window.navigator.clipboard;
        if (clip && typeof clip.writeText === 'function' && window.isSecureContext !== false) {
            return clip.writeText(text).then(function () { return true; }, function () { return legacyCopy(field, text); });
        }
        return Promise.resolve(legacyCopy(field, text));
    }
    function ack(id) {
        if (state.acked[id]) return;
        state.acked[id] = true;
        post({ assisted: { acknowledge: id } }).catch(function (err) { state.acked[id] = false; warn('acknowledge', err && err.message); });
    }
    function copyButton(which) {
        return els ? els.panel.querySelector('[data-assist-act="' + (which === 'link' ? 'copy-link' : 'copy-bio') + '"]') : null;
    }
    function markCopied(which) {
        if (state.copied && state.copied !== which) {
            var other = copyButton(state.copied);
            if (other) other.textContent = state.copied === 'link' ? 'COPIAR ENLACE' : 'COPIAR MENSAJE';
        }
        state.copied = which;
        var b = copyButton(which);
        if (b) { b.textContent = 'COPIADO'; syncKey(); } else render();
        later('copied', function () {
            var was = state.copied;
            state.copied = null;
            var node = copyButton(was);
            if (node) { node.textContent = was === 'link' ? 'COPIAR ENLACE' : 'COPIAR MENSAJE'; syncKey(); } else render();
        }, COPIED_MS);
    }
    function copyLink() {
        var url = state.data && safeUrl(state.data.profile_url);
        if (!url) return;
        copyText(url, document.getElementById('wo-assist-link')).then(function (ok) {
            if (!ok) { announce('No pudimos copiar. Seleccioná el enlace y copialo a mano.'); return; }
            markCopied('link');
            announce('Copiamos tu enlace.');
            ack('compartir.enlace');
        });
    }
    function regenBio() {
        ui.bio = pickMessage(ui.bio);
        persistUi();
        render();
        announce('Nuevo mensaje: ' + ui.bio);
    }
    function copyBio() {
        var text = ui.bio || BIO_MESSAGES[0];
        copyText(text, document.getElementById('wo-assist-bio')).then(function (ok) {
            if (!ok) { announce('No pudimos copiar. Seleccioná el mensaje y copialo a mano.'); return; }
            markCopied('bio');
            announce('Copiamos el mensaje.');
            ack('compartir.bio');
        });
    }
    function ackShared() {
        post({ assisted: { acknowledge: 'compartir' } }).catch(function (err) {
            warn('acknowledge', err && err.message);
            announce('No pudimos guardar el cambio. Probá de nuevo.');
        });
    }
    // "Ya lo revisé" (notificaciones, configuración): el servidor acepta el ack
    // y marca el paso; después se relee el estado completo.
    function ackReviewed(stepId) {
        if (REVIEW_ACK_STEPS.indexOf(stepId) === -1) return Promise.resolve(null);
        return post({ assisted: { acknowledge: stepId } }).then(function () {
            return refresh();
        }, function (err) {
            warn('acknowledge', err && err.message);
            announce('No pudimos guardar el cambio. Probá de nuevo.');
            return null;
        });
    }

    /* ------------------------------ marco de foco ------------------------------ */
    function isVisible(node) {
        if (!node || !node.getClientRects || !node.getClientRects().length) return false;
        if (node.closest && node.closest('[hidden]')) return false;
        var cs = window.getComputedStyle(node);
        if (cs.visibility === 'hidden' || cs.display === 'none') return false;
        var r = node.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
    }
    function firstVisible(selector) {
        var list;
        try { list = document.querySelectorAll(selector); } catch (e) { return null; }
        for (var i = 0; i < list.length; i++) if (isVisible(list[i])) return list[i];
        return null;
    }
    function sectionShown(section) {
        var el = section ? document.getElementById('aac-' + section) : null;
        return !!el && !el.hidden && isVisible(el);
    }
    // El centro de cuenta marca la sección activa con aria-current al terminar de iniciar.
    function accountReady() {
        return !document.querySelector('[data-aac-nav]') || !!document.querySelector('[data-aac-nav][aria-current]');
    }
    function clickNav(section) {
        var navs = document.querySelectorAll('[data-aac-nav="' + section + '"]');
        var nav = null;
        for (var i = 0; i < navs.length; i++) if (isVisible(navs[i])) { nav = navs[i]; break; }
        if (!nav) nav = navs[0] || null;
        if (nav && typeof nav.click === 'function') nav.click();
        else { try { window.location.hash = section; } catch (e) { /* sin hash */ } }
    }
    function ensureSection(section, timeout) {
        if (!section) return Promise.resolve(false);
        var ready = function () { return sectionShown(section) && accountReady(); };
        if (ready()) return Promise.resolve(true);
        var clicked = false;
        return waitFor(function () {
            if (ready()) return true;
            if (!clicked && accountReady()) { clicked = true; clickNav(section); }
            return false;
        }, timeout).then(function (ok) {
            return nextFrame().then(nextFrame).then(function () { return ok; });
        });
    }
    function findAnchor(stepId, checkId) {
        var sels = anchorSelectors(stepId, checkId);
        var specific = checkId ? sels[0] : null;
        var deadline = Date.now() + 1500;
        return new Promise(function (resolve) {
            (function tick() {
                var hit = specific ? firstVisible(specific) : null;
                if (hit) return resolve(hit);
                if (specific && Date.now() < deadline) return setTimeout(tick, 120);
                for (var i = specific ? 1 : 0; i < sels.length; i++) {
                    hit = firstVisible(sels[i]);
                    if (hit) return resolve(hit);
                }
                resolve(null);
            })();
        });
    }
    function focusStep(stepId, checkId, opts) {
        opts = opts || {};
        var section = sectionForStep(stepId);
        if (!section || !onAccountPage()) return Promise.resolve(null);
        var token = ++state.focusToken;
        var step = normalizeSteps(state.data)[STEP_IDS.indexOf(stepId)];
        if (!step) return Promise.resolve(null);
        var check = null;
        if (checkId) step.checks.forEach(function (c) { if (c.id === checkId) check = c; });
        if (!check) check = firstPendingCheck(step);
        return ensureSection(section, opts.slow ? 8000 : 2000).then(function () {
            if (token !== state.focusToken || !state.mounted) return null;
            return findAnchor(stepId, check && check.id);
        }).then(function (target) {
            if (token !== state.focusToken || !state.mounted || !target) return null;
            showRing(target, 'Paso ' + step.n + ' · ' + (check ? check.label : step.title), stepId, section);
            try { target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { target.scrollIntoView(); }
            if (opts.focus && !isNarrow()) focusInside(target);
            return target;
        });
    }
    function focusInside(target) {
        var node = null;
        try { node = target.matches && target.matches(FOCUSABLE) ? target : target.querySelector(FOCUSABLE); } catch (e) { node = null; }
        if (node && isVisible(node)) { try { node.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
    }
    function ensureRing() {
        if (ring.el) return ring.el;
        var el = document.createElement('div');
        el.className = 'wo-assist-ring';
        el.setAttribute('aria-hidden', 'true');
        el.hidden = true;
        el.innerHTML = '<span class="wo-assist-ring__chip"></span>';
        document.body.appendChild(el);
        ring.el = el;
        return el;
    }
    function showRing(target, label, step, section) {
        var el = ensureRing();
        el.querySelector('.wo-assist-ring__chip').textContent = label;
        ring.target = target; ring.step = step; ring.section = section;
        el.hidden = false;
        el.classList.remove('is-on');
        void el.offsetWidth; // reinicia la entrada
        el.classList.add('is-on');
        placeRing();
        watchRing();
    }
    function hideRing() {
        ring.target = null; ring.step = null; ring.section = null;
        unwatchRing();
        if (ring.el) ring.el.hidden = true;
    }
    function placeRing() {
        if (!ring.el || !ring.target) return;
        if (!ring.target.isConnected || !isVisible(ring.target)) { ring.el.hidden = true; return; }
        var r = ring.target.getBoundingClientRect();
        var x = Math.round(r.left - RING_PAD), y = Math.round(r.top - RING_PAD);
        ring.el.hidden = false;
        ring.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        ring.el.style.width = Math.round(r.width + RING_PAD * 2) + 'px';
        ring.el.style.height = Math.round(r.height + RING_PAD * 2) + 'px';
        ring.el.classList.toggle('is-below', y < 28);
    }
    function scheduleRing() {
        if (ring.raf) return;
        ring.raf = 1;
        nextFrame().then(function () { ring.raf = 0; placeRing(); });
    }
    function watchRing() {
        if (ring.watching) return;
        ring.watching = true;
        window.addEventListener('scroll', scheduleRing, true);
        window.addEventListener('resize', scheduleRing);
        if (typeof window.ResizeObserver === 'function' && ring.target) {
            try { ring.ro = new window.ResizeObserver(scheduleRing); ring.ro.observe(ring.target); } catch (e) { ring.ro = null; }
        }
        // Latido lento para cambios de layout que no disparan scroll ni resize.
        ring.pulse = setInterval(scheduleRing, 800);
    }
    function unwatchRing() {
        if (!ring.watching) return;
        ring.watching = false;
        window.removeEventListener('scroll', scheduleRing, true);
        window.removeEventListener('resize', scheduleRing);
        if (ring.ro) { try { ring.ro.disconnect(); } catch (e) { /* nada */ } ring.ro = null; }
        clearInterval(ring.pulse); ring.pulse = 0;
        ring.raf = 0;
    }
    function resumePendingFocus() {
        var f = ui.focus;
        if (!f) return;
        ui.focus = null;
        persistUi();
        if (Date.now() - (Number(f.at) || 0) > PENDING_FOCUS_TTL_MS) return;
        if (!onAccountPage() || !sectionForStep(f.step)) return;
        focusStep(f.step, f.check || null, { focus: true, slow: true });
    }

    /* ------------------------------ bienvenida ------------------------------ */
    function focusables(root) {
        var list = root.querySelectorAll(FOCUSABLE);
        var out = [];
        for (var i = 0; i < list.length; i++) if (isVisible(list[i])) out.push(list[i]);
        return out;
    }
    function onWelcomeKey(e) {
        if (!welcome.el) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishWelcome({}); return; }
        if (e.key !== 'Tab') return;
        var list = focusables(welcome.el);
        if (!list.length) { e.preventDefault(); return; }
        var first = list[0], last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || !welcome.el.contains(document.activeElement) || document.activeElement.id === 'wo-assist-welcome-title')) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function onWelcomeFocusIn(e) {
        if (!welcome.el || welcome.el.contains(e.target)) return;
        var list = focusables(welcome.el);
        if (list.length) { try { list[0].focus({ preventScroll: true }); } catch (err) { /* foco opcional */ } }
    }
    function onWelcomeClick(e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-welcome-act]') : null;
        if (!b) return;
        var act = b.getAttribute('data-welcome-act');
        if (act === 'close') finishWelcome({});
        else if (act === 'listen') toggleListen('welcome');
        else if (act === 'panel') {
            e.preventDefault();
            finishWelcome({ href: localPath() === DASHBOARD_PATH ? null : b.getAttribute('href') });
        }
    }
    function openWelcome() {
        if (!state.mounted || welcome.el || !state.data) return;
        clearTimer('welcome');
        stopNarration();
        hideRing();
        var host = document.createElement('div');
        host.className = 'wo-assist-welcome';
        host.innerHTML = renderWelcome(buildWelcomeModel(state.data, state.identity, { narrator: narratorSupported() })) +
            '<p class="wo-assist__sr wo-assist-welcome__live" role="status" aria-live="polite"></p>';
        document.body.appendChild(host);
        welcome.el = host;
        welcome.lastFocus = document.activeElement;
        state.welcomeShown = true;
        document.documentElement.classList.add('wo-assist-modal-open');
        if (els && els.root) els.root.setAttribute('inert', '');
        hydrate(host);
        host.addEventListener('click', onWelcomeClick);
        // En el documento: un click en el texto deja el foco en <body> y Esc
        // igual tiene que cerrar el diálogo. Se quita en closeWelcomeDom.
        document.addEventListener('keydown', onWelcomeKey);
        document.addEventListener('focusin', onWelcomeFocusIn, true);
        var title = host.querySelector('#wo-assist-welcome-title');
        if (title) { try { title.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
        post({ assisted: { welcome_seen: true } }).catch(function (err) { warn('welcome_seen', err && err.message); });
    }
    function closeWelcomeDom() {
        if (!welcome.el) return;
        if (state.speaking === 'welcome') stopNarration();
        document.removeEventListener('keydown', onWelcomeKey);
        document.removeEventListener('focusin', onWelcomeFocusIn, true);
        if (welcome.el.parentNode) welcome.el.parentNode.removeChild(welcome.el);
        welcome.el = null;
        document.documentElement.classList.remove('wo-assist-modal-open');
        if (els && els.root) els.root.removeAttribute('inert');
        var back = welcome.lastFocus;
        welcome.lastFocus = null;
        if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* foco opcional */ } }
    }
    // Cerrar la bienvenida termina el modo asistido.
    function finishWelcome(opts) {
        opts = opts || {};
        closeWelcomeDom();
        var done = exitAssist();
        if (opts.href) {
            var go = function () { window.location.href = opts.href; };
            Promise.race([done, wait(1500)]).then(go, go);
        }
    }

    /* ------------------------------ ciclo de vida ------------------------------ */
    // Salida pedida por el artista: servidor + espejo + desmontar.
    function exitAssist() {
        var done;
        if (window.WoDemo && typeof window.WoDemo.stopAssist === 'function') {
            try { done = Promise.resolve(window.WoDemo.stopAssist()); } catch (e) { done = Promise.reject(e); }
        } else {
            done = post({ assisted: { active: false } }, { noApply: true }).then(function () {
                writeMirror(false);
                dispatchChanged(false);
            });
        }
        close();
        // Si el servidor no confirmó la salida no se toca el espejo: WoDemo ya
        // lo devolvió al último valor confirmado (y vuelve a montar el panel).
        return done.catch(function (err) {
            warn('no se pudo apagar el modo asistido en el servidor', err && err.message);
        });
    }
    function close() {
        stopNarration();
        hideRing();
        closeWelcomeDom();
        Object.keys(state.timers).forEach(clearTimer);
        stopWatchers();
        if (els && els.root && els.root.parentNode) els.root.parentNode.removeChild(els.root);
        els = null;
        var wasMounted = state.mounted;
        state.mounted = false;
        state.explicit = false;
        state.confirmExit = false;
        state.flash = null;
        state.copied = null;
        state.viewId = null;
        state.renderKey = '';
        state.fetchToken++;
        state.focusToken++;
        // Un boot en vuelo queda descartado (ver gen en boot) y el próximo arranca de cero.
        state.closeGen++;
        state.booting = null;
        state.suggest = null; // sin listener mientras está cerrado: al volver se le pregunta a WoDemo

        if (wasMounted) { ui = { uid: ui.uid, minimized: false, stepsOpen: false, view: null, passed: {}, bio: null, focus: null }; ss(UI_KEY, null); }
        try { document.documentElement.classList.remove('wo-assist-on'); } catch (e) { /* sin DOM */ }
    }
    function adoptUser(data) {
        var uid = userId() || (data && data.user_id) || null;
        if (uid && ui.uid && ui.uid !== uid) ui = { uid: uid, minimized: false, stepsOpen: false, view: null, passed: {}, bio: null, focus: null };
        if (uid) ui.uid = uid;
        if (!ui.bio) ui.bio = pickMessage(null);
        persistUi();
    }
    function boot(opts) {
        opts = opts || {};
        if (demoOn()) return Promise.resolve(false);
        if (opts.identity && typeof opts.identity === 'object') state.identity = opts.identity;
        if (opts.start) { state.explicit = true; ui.minimized = false; }
        if (typeof opts.start === 'string' && STEP_IDS.indexOf(opts.start) !== -1) ui.view = opts.start;
        persistUi();
        if (state.mounted) { render(); return refresh().then(function () { return true; }); }
        if (state.booting) return state.booting;
        // Si el artista sale (close) mientras esto carga, la generación cambia y
        // nada de lo que resuelva después vuelve a montar el panel.
        var gen = state.closeGen;
        var booting = whenReady().then(function () {
            if (demoOn() || gen !== state.closeGen) return false;
            // Con arranque explícito el panel aparece ya (cargando); si no, recién con datos.
            if (state.explicit) { mount(); render(); }
            return fetchState(false).then(function (data) {
                if (gen !== state.closeGen) return false;
                var assisted = (data && data.onboarding && data.onboarding.assisted) || {};
                if (assisted.active === false && !state.explicit) { close(); return false; }
                if (!state.mounted) mount();
                adoptUser(data);
                validateView(data);
                apply(data, { initial: true });
                if (!state.mounted) return false;
                resumePendingFocus();
                return true;
            }, function (err) {
                if (gen !== state.closeGen) return false;
                warn('no se pudo cargar el estado', err && err.message);
                if (err && (err.status === 401 || err.status === 403)) { close(); return false; }
                if (!state.mounted) mount();
                state.error = true;
                render();
                return true;
            });
        }).then(function (r) {
            if (state.booting === booting) state.booting = null;
            return r;
        }, function (err) {
            if (state.booting === booting) state.booting = null;
            warn('arranque fallido', err && err.message);
            return false;
        });
        state.booting = booting;
        return booting;
    }
    function open() {
        if (demoOn()) return Promise.resolve(false);
        state.explicit = true;
        ui.minimized = false;
        persistUi();
        if (state.booting) return state.booting;
        if (state.mounted) {
            state.confirmExit = false;
            render(true);
            focusTitle();
            return refresh().then(function () { return true; });
        }
        return boot({ start: true });
    }
    function snapshot() {
        var m = state.mounted ? currentModel() : null;
        return {
            active: state.mounted,
            minimized: !!ui.minimized,
            step: m ? m.viewId : null,
            completed: !!(state.data && state.data.completed),
            welcomeOpen: !!welcome.el,
            data: state.data
        };
    }

    // WoDemo.stopAssist() avisa con este evento; desmontar es idempotente.
    try {
        document.addEventListener('wo:assist-changed', function (e) {
            if (e && e.detail && e.detail.active === false && state.mounted) close();
        });
    } catch (e) { /* sin DOM */ }

    window.WoAssist = {
        boot: boot,
        open: open,
        close: close,
        refresh: refresh,
        isActive: function () { return state.mounted; },
        state: snapshot,
        _internal: {
            STEP_IDS: STEP_IDS,
            STEP_COPY: STEP_COPY,
            BIO_MESSAGES: BIO_MESSAGES,
            SHARE_COPY: SHARE_COPY,
            WELCOME: WELCOME,
            pickMessage: pickMessage,
            sectionForStep: sectionForStep,
            anchorSelectors: anchorSelectors,
            normalizeSteps: normalizeSteps,
            nextStepAfter: nextStepAfter,
            firstPendingCheck: firstPendingCheck,
            buildPanelModel: buildPanelModel,
            renderPanel: renderPanel,
            buildWelcomeModel: buildWelcomeModel,
            renderWelcome: renderWelcome,
            appPath: appPath,
            localPath: localPath
        }
    };
})();
