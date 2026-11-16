/**
 * WE OTZI - Avisos en la app: toast + sonido + Web Push (frente push · P24 / P26)
 * ------------------------------------------------------------------------------
 * Se carga solo en todas las páginas (lo inyecta config-manager.js) y no hace
 * nada sin sesión. Con sesión:
 *
 *   1. App abierta · escucha por Realtime los avisos del usuario
 *      (user_notifications: mensajes de chat e inbox, cotizaciones, sesiones,
 *      estudios, verificación…) y muestra un toast con enlace al destino
 *      exacto + un sonido corto (WebAudio). Si la pestaña está en segundo
 *      plano y hay permiso, también una notificación del sistema.
 *   2. App cerrada · Web Push real con el service worker /wo-sw.js. La
 *      suscripción se crea solo cuando el usuario toca "Activar avisos"
 *      (nunca se pide permiso al cargar la página).
 *   3. Llegada · ?ver=<zona> resalta el bloque al que apunta un aviso o una
 *      fila de actividad (propuesta, chat, sesiones…).
 *
 * API pública (window.WoNotify):
 *   ping({ title, body, url, tag, kind, silent })  aviso local (toast + sonido)
 *   enablePush() / disablePush() / status()        avisos en este dispositivo
 *   setSound(bool) / soundEnabled()                preferencia de sonido
 *   focusArrival(ver)                              resalta la zona indicada
 *   mountSettings(el)                              tarjeta "Avisos en este dispositivo"
 * Evento: document 'wo:notify' (detail = aviso) por cada aviso recibido.
 *
 * Qué avisos llegan lo decide el servidor con la columna "Push" de la matriz
 * de notificaciones de la cuenta (lib/notification-prefs.js). El sonido se
 * apaga desde la tarjeta de la cuenta (preferencia de este dispositivo).
 * Datos: window.WeotziData.Notifications (data/notifications-repo.js).
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.WoNotify && window.WoNotify.ready) return;

    var LS_SOUND = 'wo_notify_sound';        // '0' = sin sonido
    var LS_PUSH_OFF = 'wo_notify_push_off';  // '1' = push desactivado en este dispositivo
    var LS_SYNC = 'wo_notify_sync_v1';       // última suscripción enviada al servidor
    var LS_PROMPT = 'wo_notify_prompt_v1';   // cuándo se descartó la invitación
    var LS_CLAIM = 'wo_notify_claim';        // qué pestaña hizo sonar un aviso
    var LS_SHOWN = 'wo_notify_shown_v1';     // avisos ya mostrados (para no repetir al navegar)
    var SS_CONFIG = 'wo_notify_cfg_v1';      // { enabled, publicKey } del servidor (por pestaña)
    var SS_SYNC = 'wo_notify_synced_v1';     // suscripción ya reenviada al servidor en esta pestaña
    var CONFIG_TTL_MS = 30 * 60 * 1000;
    var TOAST_MS = 9000;
    var MAX_TOASTS = 3;
    var STALE_MS = 2 * 60 * 1000;
    var CATCH_UP_MS = 90 * 1000;
    var RESYNC_MS = 3 * 24 * 60 * 60 * 1000;
    var PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
    var INTERNAL_PATH = /^\/([^\/\\]|$)/;

    // Zonas que se resaltan al llegar con ?ver=<zona> (primer selector visible).
    var ARRIVAL = {
        propuesta: ['#quote-proposal-slot', '.qd-dossier', '.qd-identity'],
        acuerdo: ['.qd-agreement', '#quote-proposal-slot', '.qd-dossier'],
        chat: ['.qd-messages', '.chat-section', '#chat-messages'],
        sesiones: ['#qd-sessions', '.qd-agreement', '#quote-proposal-slot'],
        historial: ['.qd-timeline-section', '#qd-history', '#quote-proposal-slot'],
        disputa: ['#qd-dispute', '.review-completion-panel', '#quote-proposal-slot'],
        cierre: ['.qd-closeout', '.review-completion-panel', '#quote-proposal-slot'],
        pagos: ['#qd-payments-slot', '#quote-proposal-slot'],
        actividad: ['#activity-feed', '#wod-activity-list']
    };
    var ICON_BY_KIND = {
        mensajes: 'message-circle', cotizaciones: 'inbox', calendario: 'calendar',
        invitaciones: 'star', spots: 'briefcase', job_board: 'briefcase', postulaciones: 'briefcase'
    };

    var state = {
        user: null,
        client: null,
        channel: null,
        config: null,
        configPending: null,
        endpoint: '',
        pushActive: false,
        started: false,
        seen: {},
        toasts: [],
        cards: [],
        openedId: ''
    };
    var els = { stack: null };
    var audio = { ctx: null, last: 0 };

    /* ------------------------------ utilidades ------------------------------ */
    function basePath() {
        var detected = /^\/beta(\/|$)/.test((window.location && window.location.pathname) || '') ? '/beta' : '';
        return String(window.WEOTZI_BASE_PATH || detected).replace(/\/$/, '');
    }
    function appPath(p) {
        var base = basePath();
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }
    function sharedUrl(rel) {
        // Misma carpeta /shared/ desde la que se cargó este script.
        var me = document.querySelector('script[data-wo-notify]');
        var match = me && me.src ? /^(.*\/shared\/)js\/[^\/?#]+(?:[?#].*)?$/.exec(me.src) : null;
        return (match ? match[1] : appPath('/shared/')) + rel;
    }
    function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
    function lsSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* almacenamiento bloqueado */ } }
    // sessionStorage vive lo que la pestaña. undefined = no se puede usar (null = clave ausente).
    function ssGet(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return undefined; } }
    function ssSet(key, value) { try { window.sessionStorage.setItem(key, value); } catch (e) { /* almacenamiento bloqueado */ } }
    function lsRemove(key) { try { window.localStorage.removeItem(key); } catch (e) { /* idem */ } }
    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }
    function reducedMotion() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }
    function shortHash(value) {
        var h = 5381;
        var s = String(value || '');
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }
    function warn(label, error) {
        if (window.__WEOTZI_DEBUG) console.warn('[wo-notify] ' + label + ':', error && error.message ? error.message : error);
    }
    function roleFromPath() {
        var path = ((window.location && window.location.pathname) || '').replace(basePath(), '');
        if (/^\/client(\/|$)/.test(path)) return 'client';
        if (/^\/studio(\/|$)/.test(path)) return 'studio';
        return 'artist';
    }
    function loadScript(src, isReady) {
        if (isReady()) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.onload = function () { if (isReady()) resolve(); else reject(new Error('sin API: ' + src)); };
            script.onerror = function () { reject(new Error('no se pudo cargar ' + src)); };
            document.head.appendChild(script);
        });
    }

    /* ------------------------------ sonido ------------------------------ */
    function soundEnabled() { return lsGet(LS_SOUND) !== '0'; }
    function setSound(on) {
        if (on) lsRemove(LS_SOUND); else lsSet(LS_SOUND, '0');
        refreshCards();
    }
    // El navegador solo deja sonar después de un gesto del usuario en la página.
    function unlockAudio() {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            if (!audio.ctx) audio.ctx = new AC();
            if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(function () { /* sin permiso todavía */ });
        } catch (e) { audio.ctx = null; }
    }
    function tone(ctx, frequency, start, duration) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.03);
    }
    // Dos notas cortas (La5 → Re6). `force` ignora la preferencia (botón de prueba).
    function playSound(force) {
        if (!force && !soundEnabled()) return false;
        var now = Date.now();
        if (now - audio.last < 1200) return false;
        var ctx = audio.ctx;
        if (!ctx) return false;
        try {
            if (ctx.state === 'suspended') ctx.resume().catch(function () { /* sin gesto */ });
            if (ctx.state !== 'running') return false;
            var t0 = ctx.currentTime + 0.02;
            tone(ctx, 880, t0, 0.16);
            tone(ctx, 1174.66, t0 + 0.14, 0.26);
            audio.last = now;
            return true;
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------ estilos ------------------------------ */
    function ensureStyles() {
        if (document.querySelector('link[data-wo-notify-css]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sharedUrl('css/wo-notify.css');
        link.setAttribute('data-wo-notify-css', '');
        (document.head || document.documentElement).appendChild(link);
    }
    function hydrateIcons(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            try { window.WoIcons.hydrate(root); } catch (e) { /* iconos luego */ }
        }
    }
    function iconTile(name) {
        var tile = document.createElement('span');
        tile.className = 'wo-ntf-icon';
        tile.setAttribute('aria-hidden', 'true');
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            var i = document.createElement('i');
            i.setAttribute('data-wo-icon', name);
            tile.appendChild(i);
        } else {
            tile.textContent = 'Ö';
        }
        return tile;
    }

    /* ------------------------------ toasts ------------------------------ */
    function ensureStack() {
        if (!els.stack || !document.body.contains(els.stack)) {
            els.stack = document.createElement('div');
            els.stack.className = 'wo-ntf-stack';
            els.stack.setAttribute('role', 'region');
            els.stack.setAttribute('aria-label', 'Avisos');
            document.body.appendChild(els.stack);
        }
        var bar = document.querySelector('.wo-topbar') || document.querySelector('body > header');
        var bottom = 0;
        if (bar) {
            var rect = bar.getBoundingClientRect();
            bottom = Math.max(0, Math.min(160, Math.round(rect.bottom)));
        }
        els.stack.style.setProperty('--wo-ntf-top', bottom + 'px');
        return els.stack;
    }
    function removeToast(entry, immediate) {
        if (!entry || entry.gone) return;
        entry.gone = true;
        window.clearTimeout(entry.timer);
        state.toasts = state.toasts.filter(function (t) { return t !== entry; });
        var node = entry.node;
        var drop = function () { if (node.parentNode) node.parentNode.removeChild(node); };
        if (immediate || reducedMotion()) { drop(); return; }
        node.classList.add('is-leaving');
        window.setTimeout(drop, 200);
    }
    function armToast(entry) {
        window.clearTimeout(entry.timer);
        if (entry.sticky || document.visibilityState !== 'visible') return;
        entry.timer = window.setTimeout(function () { removeToast(entry); }, TOAST_MS);
    }
    function internalHref(url) {
        return typeof url === 'string' && INTERNAL_PATH.test(url) ? appPath(url) : '';
    }
    function buildToast(n, options) {
        var node = document.createElement('div');
        node.className = 'wo-ntf-toast' + (options.actions ? ' wo-ntf-toast--prompt' : '');
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');

        var href = internalHref(n.url);
        var main = document.createElement(href ? 'a' : 'div');
        main.className = 'wo-ntf-link';
        if (href) main.href = href;
        main.appendChild(iconTile(options.icon || ICON_BY_KIND[n.kind] || 'bell'));
        var text = document.createElement('span');
        text.className = 'wo-ntf-text';
        var title = document.createElement('span');
        title.className = 'wo-ntf-title';
        title.textContent = n.title;
        text.appendChild(title);
        if (n.body) {
            var body = document.createElement('span');
            body.className = 'wo-ntf-body';
            body.textContent = n.body;
            text.appendChild(body);
        }
        if (href && !options.actions) {
            var cta = document.createElement('span');
            cta.className = 'wo-ntf-cta';
            cta.textContent = 'Ver →';
            text.appendChild(cta);
        }
        main.appendChild(text);

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'wo-ntf-close';
        close.setAttribute('aria-label', 'Cerrar aviso');
        close.textContent = '×';

        if (options.actions) {
            var head = document.createElement('div');
            head.className = 'wo-ntf-head';
            head.appendChild(main);
            head.appendChild(close);
            node.appendChild(head);
            var actions = document.createElement('div');
            actions.className = 'wo-ntf-actions';
            options.actions.forEach(function (action) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'wo-ntf-action' + (action.primary ? ' wo-ntf-action--primary' : '');
                btn.textContent = action.label;
                btn.addEventListener('click', function () { action.run(); });
                actions.appendChild(btn);
            });
            node.appendChild(actions);
        } else {
            node.appendChild(main);
            node.appendChild(close);
        }
        return { node: node, main: main, close: close };
    }
    function showToast(n, options) {
        options = options || {};
        if (!document.body) return null;
        ensureStyles();
        var stack = ensureStack();
        var built = buildToast(n, options);
        var entry = { node: built.node, at: Date.now(), sticky: !!options.sticky, timer: 0, gone: false };
        built.close.addEventListener('click', function () {
            removeToast(entry);
            if (typeof options.onClose === 'function') options.onClose();
        });
        if (built.main.tagName === 'A') {
            built.main.addEventListener('click', function () { markRead(n); });
        }
        // El aviso no se va mientras el puntero o el foco están encima.
        built.node.addEventListener('mouseenter', function () { window.clearTimeout(entry.timer); });
        built.node.addEventListener('mouseleave', function () { armToast(entry); });
        built.node.addEventListener('focusin', function () { window.clearTimeout(entry.timer); });
        built.node.addEventListener('focusout', function () { armToast(entry); });
        stack.insertBefore(built.node, stack.firstChild);
        hydrateIcons(built.node);
        state.toasts.unshift(entry);
        state.toasts.filter(function (t) { return !t.sticky; }).slice(MAX_TOASTS).forEach(function (t) { removeToast(t, true); });
        armToast(entry);
        return entry;
    }
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var now = Date.now();
        state.toasts.slice().forEach(function (entry) {
            // Avisos que quedaron esperando en una pestaña de fondo: los viejos se van.
            if (!entry.sticky && now - entry.at > STALE_MS) removeToast(entry, true);
            else armToast(entry);
        });
    });

    function markRead(n) {
        var N = window.WeotziData && window.WeotziData.Notifications;
        if (!n || !n.id || !N || typeof N.markRead !== 'function') return;
        try { Promise.resolve(N.markRead(n.id)).catch(function () { /* mejor esfuerzo */ }); } catch (e) { /* idem */ }
    }

    /* --------------------- notificación del sistema (pestaña de fondo) --------------------- */
    function notificationPermission() {
        try { return 'Notification' in window ? window.Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; }
    }
    function systemNotify(n) {
        if (notificationPermission() !== 'granted') return false;
        var href = internalHref(n.url) || appPath('/');
        var options = { body: n.body || '', lang: 'es', data: { url: n.url || '/' } };
        if (n.tag) options.tag = n.tag;
        try {
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === 'function') {
                navigator.serviceWorker.getRegistration(appPath('/')).then(function (reg) {
                    if (reg && typeof reg.showNotification === 'function') return reg.showNotification(n.title, options);
                    var direct = new window.Notification(n.title, options);
                    direct.onclick = function () { try { window.focus(); } catch (e) { /* noop */ } window.location.href = href; };
                    return undefined;
                }).catch(function (error) {
                    // Navegadores que solo notifican desde un service worker: queda el sonido.
                    warn('notificación', error);
                    playSound();
                });
                return true;
            }
            var plain = new window.Notification(n.title, options);
            plain.onclick = function () { try { window.focus(); } catch (e) { /* noop */ } window.location.href = href; };
            return true;
        } catch (error) {
            warn('notificación', error);
            return false;
        }
    }

    /* ------------------------------ recibir un aviso ------------------------------ */
    function normalize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var title = String(raw.title == null ? '' : raw.title).replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!title) return null;
        return {
            id: raw.id ? String(raw.id).slice(0, 64) : '',
            title: title,
            body: String(raw.body == null ? '' : raw.body).replace(/\s+/g, ' ').trim().slice(0, 400),
            url: typeof raw.url === 'string' && INTERNAL_PATH.test(raw.url) ? raw.url.slice(0, 600) : '',
            tag: String(raw.tag == null ? '' : raw.tag).slice(0, 120),
            kind: String(raw.kind == null ? '' : raw.kind).slice(0, 40)
        };
    }
    function shownIds() {
        try {
            var list = JSON.parse(lsGet(LS_SHOWN) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }
    function rememberShown(id) {
        if (!id) return;
        var list = shownIds().filter(function (x) { return x !== id; });
        list.push(id);
        lsSet(LS_SHOWN, JSON.stringify(list.slice(-60)));
    }
    // Varias pestañas reciben el mismo aviso: suena (o notifica) una sola. La
    // pestaña visible gana; las de fondo esperan un instante.
    function claim(key, done) {
        var wait = document.visibilityState === 'visible' ? 0 : 450 + Math.floor(Math.random() * 200);
        window.setTimeout(function () {
            var now = Date.now();
            var parts = String(lsGet(LS_CLAIM) || '').split('|');
            if (parts[0] === key && now - Number(parts[1] || 0) < 15000) { done(false); return; }
            lsSet(LS_CLAIM, key + '|' + now);
            done(true);
        }, wait);
    }
    // ¿El usuario ya está mirando esa conversación? Entonces no hace falta el toast.
    function isCurrentView(n) {
        if (!/^(chat|inbox):/.test(n.tag || '') || !n.url) return false;
        try {
            var target = new URL(appPath(n.url), window.location.origin);
            var here = new URL(window.location.href);
            var norm = function (p) { return p.replace(/\/+$/, ''); };
            if (norm(target.pathname) !== norm(here.pathname)) return false;
            var quote = target.searchParams.get('quote');
            var thread = target.searchParams.get('thread');
            return !!((quote && here.searchParams.get('quote') === quote) || (thread && here.searchParams.get('thread') === thread));
        } catch (e) {
            return false;
        }
    }
    /**
     * Muestra un aviso. options.shown = ya hay notificación del sistema (push);
     * options.silent = sin sonido; options.local = aviso creado en esta página.
     */
    function present(raw, options) {
        options = options || {};
        var n = normalize(raw);
        if (!n) return false;
        var key = n.id || shortHash(n.tag + '|' + n.title + '|' + n.body);
        var now = Date.now();
        if (state.seen[key] && now - state.seen[key] < 5 * 60 * 1000) return false;
        if (Object.keys(state.seen).length > 200) state.seen = {};
        state.seen[key] = now;

        var visible = document.visibilityState === 'visible';
        if (visible) rememberShown(n.id);
        try { document.dispatchEvent(new CustomEvent('wo:notify', { detail: n })); } catch (e) { /* CustomEvent ausente */ }
        if (!(visible && isCurrentView(n))) showToast(n);

        claim(key, function (won) {
            if (!won) return;
            var systemShown = options.shown === true;
            // Con Web Push activo, el service worker ya muestra (y hace sonar)
            // la notificación del sistema cuando la app no tiene el foco.
            var pushHandles = state.pushActive && !options.local && (!visible || !document.hasFocus());
            if (!visible && !systemShown && !pushHandles) systemShown = systemNotify(n);
            if (options.silent || systemShown || pushHandles) return;
            playSound();
        });
        return true;
    }

    /* ------------------------------ llegada (?ver=) ------------------------------ */
    function firstVisible(selectors) {
        for (var i = 0; i < selectors.length; i++) {
            var list = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                if (el.offsetParent !== null && el.getBoundingClientRect().height > 8) return el;
            }
        }
        return null;
    }
    function flash(el, selectors, again) {
        try { el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* navegador viejo */ }
        el.classList.add('wo-arrival-flash');
        window.setTimeout(function () { el.classList.remove('wo-arrival-flash'); }, 4200);
        // Algunas pantallas vuelven a pintar el bloque al terminar de cargar.
        if (again) return;
        window.setTimeout(function () {
            if (document.body.contains(el)) return;
            var next = firstVisible(selectors);
            if (next) flash(next, selectors, true);
        }, 1400);
    }
    function focusArrival(ver) {
        var selectors = ARRIVAL[String(ver || '').toLowerCase()];
        if (!selectors) return false;
        ensureStyles();
        var tries = 0;
        (function attempt() {
            var el = firstVisible(selectors);
            if (el) { flash(el, selectors, false); return; }
            tries += 1;
            if (tries < 48) window.setTimeout(attempt, 250);
        })();
        return true;
    }
    function applyArrival() {
        var ver = '';
        var opened = '';
        try {
            var params = new URLSearchParams(window.location.search);
            ver = params.get('ver') || '';
            opened = params.get('wo_n') || '';
        } catch (e) { ver = ''; opened = ''; }
        // ?wo_n=<id>: se llegó tocando la notificación del sistema; ese aviso
        // ya se vio (no se repite como toast) y queda leído.
        if (/^[0-9a-f-]{36}$/i.test(opened)) {
            state.seen[opened] = Date.now();
            rememberShown(opened);
            state.openedId = opened;
        } else {
            opened = '';
        }
        var focused = ver ? focusArrival(ver) : false;
        if (!focused && !opened) return;
        // Los parámetros se consumen: recargar la página no vuelve a resaltar.
        try {
            var url = new URL(window.location.href);
            if (focused) url.searchParams.delete('ver');
            url.searchParams.delete('wo_n');
            window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        } catch (e) { /* visor sin history */ }
    }

    /* ------------------------------ Web Push ------------------------------ */
    function pushSupported() {
        return !!(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
    }
    function repoReady() {
        var D = window.WeotziData;
        return !!(D && D.Notifications && D.Notifications.Push);
    }
    function ensureRepo() {
        var base = sharedUrl('js/data/');
        return loadScript(base + 'postgrest-client.js', function () {
            return !!(window.WeotziData && typeof window.WeotziData.getClient === 'function');
        }).then(function () {
            return loadScript(base + 'notifications-repo.js', repoReady);
        });
    }
    // La configuración del servidor se recuerda media hora por pestaña: la app
    // es multipágina y no hace falta pedirla en cada carga.
    function cachedConfig() {
        try {
            var saved = JSON.parse(window.sessionStorage.getItem(SS_CONFIG) || 'null');
            if (saved && Date.now() - Number(saved.t || 0) < CONFIG_TTL_MS) {
                return { enabled: !!(saved.enabled && saved.publicKey), publicKey: saved.publicKey || null };
            }
        } catch (e) { /* sin sessionStorage */ }
        return null;
    }
    function loadConfig() {
        if (state.config) return Promise.resolve(state.config);
        if (state.configPending) return state.configPending;
        var cached = cachedConfig();
        if (cached) { state.config = cached; return Promise.resolve(cached); }
        state.configPending = ensureRepo().then(function () { return window.WeotziData.Notifications.Push.config(); })
            .then(function (cfg) {
                state.config = cfg;
                try { window.sessionStorage.setItem(SS_CONFIG, JSON.stringify({ enabled: cfg.enabled, publicKey: cfg.publicKey, t: Date.now() })); } catch (e) { /* idem */ }
                return cfg;
            })
            .catch(function (error) { warn('configuración', error); return { enabled: false, publicKey: null }; })
            .then(function (cfg) { state.configPending = null; return cfg; });
        return state.configPending;
    }
    function keyBytes(base64url) {
        var padded = String(base64url).replace(/-/g, '+').replace(/_/g, '/');
        while (padded.length % 4) padded += '=';
        var raw = window.atob(padded);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }
    function sameServerKey(subscription, publicKey) {
        try {
            var current = subscription.options && subscription.options.applicationServerKey;
            if (!current) return true;
            var a = new Uint8Array(current);
            var b = keyBytes(publicKey);
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
            return true;
        } catch (e) { return true; }
    }
    function accessToken() {
        if (!state.client) return Promise.resolve('');
        return state.client.auth.getSession().then(function (res) {
            return (res && res.data && res.data.session && res.data.session.access_token) || '';
        }).catch(function () { return ''; });
    }
    /**
     * Deja la suscripción de este navegador creada y guardada en el servidor.
     * Solo corre con el permiso YA concedido: nunca dispara el pedido de permiso.
     */
    function syncPush(force) {
        state.pushActive = false;
        if (!state.user || !pushSupported() || notificationPermission() !== 'granted' || lsGet(LS_PUSH_OFF) === '1') {
            return Promise.resolve(false);
        }
        return loadConfig().then(function (cfg) {
            if (!cfg.enabled) return false;
            return navigator.serviceWorker.register(appPath('/wo-sw.js'))
                .then(function () { return navigator.serviceWorker.ready; })
                .then(function (reg) {
                    return reg.pushManager.getSubscription().then(function (existing) {
                        if (existing && !sameServerKey(existing, cfg.publicKey)) {
                            return existing.unsubscribe().catch(function () { return false; }).then(function () { return null; });
                        }
                        return existing;
                    }).then(function (existing) {
                        return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
                    });
                })
                .then(function (subscription) {
                    state.endpoint = subscription.endpoint;
                    var marker = shortHash(state.user.id + '|' + subscription.endpoint);
                    var saved = {};
                    try { saved = JSON.parse(lsGet(LS_SYNC) || '{}') || {}; } catch (e) { saved = {}; }
                    var fresh = !force && saved.m === marker && Date.now() - Number(saved.t || 0) < RESYNC_MS;
                    // Además del reenvío cada 3 días, uno por pestaña: si el servidor perdió
                    // la fila (envíos rechazados, limpieza), se repone al próximo ingreso en vez
                    // de quedar días sin push. POST /api/push/subscribe es un upsert por endpoint.
                    // Sin sessionStorage no hay cómo recordarlo: queda la regla de los 3 días.
                    var tab = ssGet(SS_SYNC);
                    if (fresh && (tab === undefined || tab === marker)) return true;
                    return accessToken().then(function (token) {
                        if (!token) return fresh;
                        return window.WeotziData.Notifications.Push.subscribe(token, subscription.toJSON()).then(function () {
                            lsSet(LS_SYNC, JSON.stringify({ m: marker, t: Date.now() }));
                            ssSet(SS_SYNC, marker);
                            return true;
                        }, function (error) {
                            // El reenvío de rutina falló (sin red): el servidor ya conocía esta
                            // suscripción, así que el push sigue activo y se reintenta al navegar.
                            if (!fresh) throw error;
                            warn('reenvío de la suscripción', error);
                            return true;
                        });
                    });
                });
        }).then(function (active) {
            state.pushActive = !!active;
            refreshCards();
            return state.pushActive;
        }).catch(function (error) {
            warn('suscripción', error);
            state.pushActive = false;
            refreshCards();
            return false;
        });
    }
    /** Pide el permiso (SOLO desde un click del usuario) y suscribe este navegador. */
    function enablePush() {
        if (!('Notification' in window)) return Promise.resolve({ ok: false, reason: 'unsupported' });
        var ask;
        try { ask = window.Notification.requestPermission(); } catch (e) { ask = null; }
        if (!ask || typeof ask.then !== 'function') {
            // Safari antiguo: la respuesta llega por callback.
            ask = new Promise(function (resolve) {
                try { window.Notification.requestPermission(resolve); } catch (e) { resolve(notificationPermission()); }
            });
        }
        return Promise.resolve(ask).then(function (permission) {
            if (permission !== 'granted') {
                refreshCards();
                return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };
            }
            lsRemove(LS_PUSH_OFF);
            if (!pushSupported() || !state.user) { refreshCards(); return { ok: true, push: false, reason: 'local_only' }; }
            return syncPush(true).then(function (active) {
                return { ok: true, push: !!active, reason: active ? 'subscribed' : 'local_only' };
            });
        }).catch(function (error) {
            warn('permiso', error);
            refreshCards();
            return { ok: false, reason: 'error' };
        });
    }
    function disablePush() {
        lsSet(LS_PUSH_OFF, '1');
        lsRemove(LS_SYNC);
        state.pushActive = false;
        var known = state.endpoint;
        state.endpoint = '';
        var unsubscribed = Promise.resolve(known);
        if (pushSupported()) {
            unsubscribed = navigator.serviceWorker.getRegistration(appPath('/')).then(function (reg) {
                return reg ? reg.pushManager.getSubscription() : null;
            }).then(function (subscription) {
                if (!subscription) return known;
                var endpoint = subscription.endpoint;
                return subscription.unsubscribe().catch(function () { return false; }).then(function () { return endpoint; });
            }).catch(function () { return known; });
        }
        return unsubscribed.then(function (endpoint) {
            if (!endpoint || !repoReady()) return true;
            return window.WeotziData.Notifications.Push.unsubscribe(endpoint).then(function () { return true; });
        }).catch(function (error) { warn('baja', error); return false; })
            .then(function (ok) { refreshCards(); return { ok: ok }; });
    }
    function status() {
        return loadConfig().then(function (cfg) {
            return {
                signedIn: !!state.user,
                supported: pushSupported(),
                permission: notificationPermission(),
                serverEnabled: !!cfg.enabled,
                subscribed: state.pushActive,
                off: lsGet(LS_PUSH_OFF) === '1',
                sound: soundEnabled()
            };
        });
    }

    /* --------------------- tarjeta "Avisos en este dispositivo" --------------------- */
    function isAppleMobile() {
        var ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    }
    function cardCopy(s) {
        if (s.permission === 'unsupported' || (!s.supported && s.permission !== 'granted')) {
            return {
                on: false, enable: false, disable: false,
                status: 'Este navegador no admite avisos push.',
                help: (isAppleMobile() ? 'En iPhone o iPad, agrega We Ötzi a tu pantalla de inicio para recibirlos. ' : '')
                    + 'Mientras tengas We Ötzi abierto, verás los avisos dentro de la app.'
            };
        }
        if (s.permission === 'denied') {
            return {
                on: false, enable: false, disable: false,
                status: 'Los avisos de We Ötzi están bloqueados en este navegador.',
                help: 'Para activarlos, permite las notificaciones de este sitio desde la configuración de tu navegador y vuelve a esta página.'
            };
        }
        if (s.permission === 'granted' && !s.off) {
            if (s.subscribed) {
                return {
                    on: true, enable: false, disable: true,
                    status: 'Avisos activados en este dispositivo.',
                    help: 'Te avisaremos con sonido cuando te escriban o haya novedades, aunque tengas We Ötzi cerrado.'
                };
            }
            return {
                on: true, enable: false, disable: true,
                status: 'Avisos activados mientras tengas We Ötzi abierto.',
                help: s.serverEnabled
                    ? 'Estamos terminando de conectar este dispositivo. Si no cambia en unos segundos, vuelve a cargar la página.'
                    : 'Verás los avisos y escucharás el sonido con la app abierta, también en otra pestaña.'
            };
        }
        return {
            on: false, enable: true, disable: false,
            status: s.off ? 'Avisos desactivados en este dispositivo.' : 'Los avisos de este dispositivo están apagados.',
            help: 'Actívalos para enterarte al instante, con sonido, cuando te escriban o haya novedades en tus cotizaciones, aunque tengas We Ötzi cerrado.'
        };
    }
    function renderCard(card) {
        status().then(function (s) {
            var copy = cardCopy(s);
            card.status.textContent = copy.status;
            card.status.classList.toggle('is-on', copy.on);
            card.help.textContent = copy.help;
            card.enable.hidden = !copy.enable;
            card.disable.hidden = !copy.disable;
            card.test.hidden = !s.signedIn;
            card.sound.checked = s.sound;
        }).catch(function (error) { warn('tarjeta', error); });
    }
    function refreshCards() {
        state.cards.forEach(renderCard);
    }
    function feedback(card, message, isError) {
        card.feedback.textContent = message || '';
        card.feedback.classList.toggle('is-error', !!isError);
    }
    function button(label, className) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wo-ntf-btn' + (className ? ' ' + className : '');
        btn.textContent = label;
        return btn;
    }
    function runTest(card) {
        card.test.disabled = true;
        feedback(card, 'Enviando un aviso de prueba…');
        unlockAudio();
        var local = function (message) {
            present({ title: 'Los avisos de We Ötzi están activos', body: 'Así se verá cuando recibas un mensaje o una novedad.', tag: 'push-test' }, { local: true });
            feedback(card, message);
        };
        accessToken().then(function (token) {
            if (!token || !repoReady()) { local('Este es un aviso de prueba dentro de la app.'); return undefined; }
            var send = function () { return window.WeotziData.Notifications.Push.test(token, roleFromPath()); };
            return send().then(function (res) {
                // Aquí el push figura activo, pero el servidor no tiene ningún dispositivo de la
                // cuenta: perdió la suscripción. Se registra otra vez y se repite la prueba (una vez).
                if (res && res.push_enabled && res.devices === 0 && state.pushActive) {
                    return syncPush(true).then(function (active) { return active ? send() : res; });
                }
                return res;
            }).then(function (res) {
                if (res.delivered > 0) feedback(card, 'Listo: enviamos un aviso de prueba a ' + (res.delivered === 1 ? 'este dispositivo.' : 'tus ' + res.delivered + ' dispositivos.'));
                else if (res.stored) feedback(card, 'Enviamos un aviso de prueba. Lo verás en unos segundos dentro de la app.');
                else local('Este es un aviso de prueba dentro de la app.');
            });
        }).catch(function (error) {
            warn('prueba', error);
            local('No pudimos enviar el aviso desde el servidor; este es un aviso de prueba local.');
        }).then(function () { card.test.disabled = false; });
    }
    /** Pinta la tarjeta dentro de `host` (un contenedor vacío de la página de cuenta). */
    function mountSettings(host) {
        if (!host || host.getAttribute('data-wo-notify-mounted') === '1') return null;
        host.setAttribute('data-wo-notify-mounted', '1');
        ensureStyles();
        var id = 'wo-ntf-card-' + (state.cards.length + 1);

        var root = document.createElement('section');
        root.className = 'wo-ntf-card';
        root.setAttribute('aria-labelledby', id + '-title');

        var head = document.createElement('div');
        head.className = 'wo-ntf-card-head';
        head.appendChild(iconTile('bell'));
        var headText = document.createElement('div');
        headText.className = 'wo-ntf-card-headtext';
        var title = document.createElement('h2');
        title.className = 'wo-ntf-card-title';
        title.id = id + '-title';
        title.textContent = 'Avisos en este dispositivo';
        var statusEl = document.createElement('p');
        statusEl.className = 'wo-ntf-card-status';
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        statusEl.textContent = 'Comprobando el estado de los avisos…';
        headText.appendChild(title);
        headText.appendChild(statusEl);
        head.appendChild(headText);

        var actions = document.createElement('div');
        actions.className = 'wo-ntf-card-actions';
        var enable = button('Activar avisos', 'wo-ntf-btn--primary');
        enable.hidden = true;
        var test = button('Probar aviso');
        test.hidden = true;
        var soundLabel = document.createElement('label');
        soundLabel.className = 'wo-ntf-sound';
        var sound = document.createElement('input');
        sound.type = 'checkbox';
        sound.checked = soundEnabled();
        soundLabel.appendChild(sound);
        soundLabel.appendChild(document.createTextNode('Sonido al recibir un aviso'));
        var disable = button('Desactivar en este dispositivo', 'wo-ntf-btn--quiet');
        disable.hidden = true;
        actions.appendChild(enable);
        actions.appendChild(test);
        actions.appendChild(soundLabel);
        actions.appendChild(disable);

        var feedbackEl = document.createElement('p');
        feedbackEl.className = 'wo-ntf-card-feedback';
        feedbackEl.setAttribute('role', 'status');
        feedbackEl.setAttribute('aria-live', 'polite');
        var help = document.createElement('p');
        help.className = 'wo-ntf-card-help';

        root.appendChild(head);
        root.appendChild(actions);
        root.appendChild(feedbackEl);
        root.appendChild(help);
        host.appendChild(root);
        hydrateIcons(root);

        var card = { root: root, status: statusEl, help: help, enable: enable, disable: disable, test: test, sound: sound, feedback: feedbackEl };
        enable.addEventListener('click', function () {
            enable.disabled = true;
            feedback(card, '');
            unlockAudio();
            enablePush().then(function (result) {
                enable.disabled = false;
                if (result.ok) feedback(card, result.push ? 'Listo: este dispositivo ya recibe los avisos.' : 'Listo: verás los avisos mientras tengas We Ötzi abierto.');
                else if (result.reason === 'denied') feedback(card, 'El navegador bloqueó los avisos. Puedes permitirlos desde su configuración.', true);
                else if (result.reason === 'unsupported') feedback(card, 'Este navegador no admite avisos.', true);
                else if (result.reason === 'error') feedback(card, 'No pudimos activar los avisos. Inténtalo de nuevo.', true);
                renderCard(card);
            });
        });
        disable.addEventListener('click', function () {
            disable.disabled = true;
            disablePush().then(function (result) {
                disable.disabled = false;
                feedback(card, result.ok ? 'Este dispositivo ya no recibe avisos push.' : 'No pudimos desactivar los avisos. Inténtalo de nuevo.', !result.ok);
                renderCard(card);
            });
        });
        test.addEventListener('click', function () { runTest(card); });
        sound.addEventListener('change', function () {
            setSound(sound.checked);
            if (sound.checked) { unlockAudio(); playSound(true); }
        });
        state.cards.push(card);
        renderCard(card);
        return card;
    }
    function mountAllSettings() {
        var hosts = document.querySelectorAll('[data-wo-notify-settings]');
        for (var i = 0; i < hosts.length; i++) mountSettings(hosts[i]);
    }

    /* --------------------- matriz de avisos: se prendió un toggle "Push" --------------------- */
    function announceEnable(result) {
        if (result.ok) present({ title: 'Avisos activados', body: result.push ? 'Este dispositivo ya recibe los avisos de We Ötzi.' : 'Verás los avisos mientras tengas We Ötzi abierto.', tag: 'push-enabled' }, { local: true });
        else if (result.reason === 'denied') present({ title: 'El navegador bloqueó los avisos', body: 'Puedes permitirlos desde la configuración de tu navegador.', tag: 'push-denied' }, { local: true, silent: true });
    }
    // La matriz (cuenta del cliente) emite 'wo:notif-pref-changed' al guardar un
    // toggle. Si prende uno de Push y este dispositivo no está suscripto, se
    // suscribe ahí mismo: el evento nace de un clic, así que el navegador deja
    // pedir el permiso. Si no, quedaría "Push" encendido sin ningún dispositivo.
    // No pisa lo que la persona eligió para este dispositivo (bloqueado o apagado).
    function onPrefChanged(event) {
        var detail = (event && event.detail) || {};
        if (detail.channel !== 'push' || detail.value !== true) return;
        status().then(function (s) {
            if (!s.signedIn || !s.supported || !s.serverEnabled || s.subscribed) return undefined;
            if (s.permission === 'denied') { announceEnable({ ok: false, reason: 'denied' }); return undefined; }
            if (s.off) {
                present({ title: 'Los avisos están apagados en este dispositivo', body: 'Actívalos en "Avisos en este dispositivo" para recibirlos aquí.', tag: 'push-off' }, { local: true, silent: true });
                return undefined;
            }
            unlockAudio();
            return enablePush().then(announceEnable);
        }).catch(function (error) { warn('preferencia de push', error); });
    }

    /* --------------------- invitación a activar los avisos (dashboards) --------------------- */
    function maybePrompt() {
        var path = ((window.location && window.location.pathname) || '').replace(/\/+$/, '');
        if (!/\/(artist|client|studio)\/dashboard$/.test(path)) return;
        if (!pushSupported() || notificationPermission() !== 'default') return;
        if (Date.now() - Number(lsGet(LS_PROMPT) || 0) < PROMPT_SNOOZE_MS) return;
        loadConfig().then(function (cfg) {
            if (!cfg.enabled || notificationPermission() !== 'default') return;
            window.setTimeout(function () {
                if (notificationPermission() !== 'default' || document.querySelector('.wo-ntf-toast--prompt')) return;
                var snooze = function () { lsSet(LS_PROMPT, String(Date.now())); };
                var entry = showToast({
                    title: 'Entérate al instante',
                    body: 'Activa los avisos para saber, con sonido, cuando te escriban o haya novedades en tus cotizaciones.'
                }, {
                    sticky: true,
                    onClose: snooze,
                    actions: [
                        {
                            label: 'Activar avisos', primary: true,
                            run: function () {
                                snooze();
                                removeToast(entry);
                                unlockAudio();
                                enablePush().then(announceEnable);
                            }
                        },
                        { label: 'Ahora no', run: function () { snooze(); removeToast(entry); } }
                    ]
                });
            }, 3500);
        });
    }

    /* ------------------------------ sesión y Realtime ------------------------------ */
    function resolveClient() {
        var ready = window.ConfigManager && typeof window.ConfigManager.ready === 'function'
            ? Promise.resolve(window.ConfigManager.ready()).catch(function () { /* sigue con reintentos */ })
            : Promise.resolve();
        return ready.then(function () {
            return new Promise(function (resolve) {
                var tries = 0;
                (function attempt() {
                    var c = (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function' && window.ConfigManager.getSupabaseClient())
                        || window._supabase || null;
                    if (c && c.auth) { resolve(c); return; }
                    tries += 1;
                    if (tries >= 20) { resolve(null); return; }
                    window.setTimeout(attempt, 200);
                })();
            });
        });
    }
    function subscribeRealtime() {
        var N = window.WeotziData && window.WeotziData.Notifications;
        if (!N || state.channel || !state.user) return;
        try {
            state.channel = N.subscribe(state.user.id, function (row) { present(row, {}); });
        } catch (error) { warn('realtime', error); }
    }
    // Avisos que llegaron mientras se cargaba la página (la app es multipágina)
    // o mientras la pestaña estuvo de fondo con la conexión dormida.
    function catchUp(windowMs, options) {
        var N = window.WeotziData && window.WeotziData.Notifications;
        if (!N || !state.user) return;
        var since = new Date(Date.now() - (windowMs || CATCH_UP_MS)).toISOString();
        N.listRecent(state.user.id, { since: since, limit: 5, unreadOnly: true }).then(function (rows) {
            var shown = shownIds();
            (rows || []).slice().reverse().forEach(function (row) {
                if (shown.indexOf(row.id) === -1) present(row, options || {});
            });
        }).catch(function (error) { warn('avisos recientes', error); });
    }
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
        if (!state.user || !hiddenAt) return;
        var away = Date.now() - hiddenAt;
        hiddenAt = 0;
        // Con push activo esos avisos ya sonaron como notificación del sistema.
        if (away > 20000) catchUp(Math.min(10 * 60 * 1000, away + 30000), { silent: state.pushActive });
    });
    function start(session) {
        if (state.started || !session || !session.user) return;
        state.started = true;
        state.user = session.user;
        ensureRepo().then(function () {
            if (state.openedId) { markRead({ id: state.openedId }); state.openedId = ''; }
            subscribeRealtime();
            catchUp();
            return syncPush(false);
        }).catch(function (error) { warn('inicio', error); })
            .then(function () { refreshCards(); maybePrompt(); });
    }
    function stop() {
        var N = window.WeotziData && window.WeotziData.Notifications;
        // Otro usuario puede entrar en este navegador: la suscripción deja de
        // estar asociada a la cuenta que cerró sesión.
        if (state.endpoint && N && N.Push) {
            try { Promise.resolve(N.Push.unsubscribe(state.endpoint, { keepalive: true })).catch(function () { /* se limpia al próximo ingreso */ }); } catch (e) { /* idem */ }
        }
        lsRemove(LS_SYNC);
        if (state.channel && N) { try { N.unsubscribe(state.channel); } catch (e) { /* canal ya cerrado */ } }
        state.channel = null;
        state.user = null;
        state.endpoint = '';
        state.pushActive = false;
        state.started = false;
        refreshCards();
    }
    function init() {
        document.addEventListener('pointerdown', unlockAudio, { passive: true });
        document.addEventListener('keydown', unlockAudio);
        document.addEventListener('wo:notif-pref-changed', onPrefChanged);
        if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
            navigator.serviceWorker.addEventListener('message', function (event) {
                var data = event && event.data;
                if (data && data.type === 'wo-push') present(data.notification, { shown: data.shown === true });
            });
        }
        // La hoja de estilos se pide ya: el primer aviso tiene que aparecer con su piel.
        ensureStyles();
        applyArrival();
        mountAllSettings();
        if (isPreview()) return;
        resolveClient().then(function (client) {
            if (!client) return undefined;
            state.client = client;
            try {
                client.auth.onAuthStateChange(function (event, session) {
                    if (event === 'SIGNED_OUT') { stop(); return; }
                    // Fuera del callback: supabase-js retiene el candado de auth mientras lo ejecuta.
                    if (session && session.user && !state.started) window.setTimeout(function () { start(session); }, 0);
                });
            } catch (error) { warn('sesión', error); }
            return client.auth.getSession().then(function (res) {
                var session = res && res.data && res.data.session;
                if (session) start(session);
            });
        }).catch(function (error) { warn('inicio', error); });
    }

    window.WoNotify = {
        ready: true,
        ping: function (notification) {
            var n = notification || {};
            return present({ title: n.title, body: n.body, url: n.url, tag: n.tag, kind: n.kind, id: n.id }, { local: true, silent: n.silent === true });
        },
        enablePush: enablePush,
        disablePush: disablePush,
        status: status,
        setSound: setSound,
        soundEnabled: soundEnabled,
        playSound: function () { unlockAudio(); return playSound(true); },
        focusArrival: focusArrival,
        mountSettings: mountSettings,
        ARRIVAL_TARGETS: ARRIVAL
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
