/* ==========================================================================
 * WE ÖTZI · service worker de avisos push (frente push · P24)
 * --------------------------------------------------------------------------
 * Lo registra public/shared/js/wo-notify.js SOLO cuando el usuario activó los
 * avisos ("Activar avisos"). No intercepta la red ni guarda nada en caché:
 * únicamente recibe el push, muestra el aviso y abre el destino al tocarlo.
 *
 *   push              → si We Ötzi está a la vista y con foco, el aviso se
 *                       muestra dentro de la app (toast + sonido, mensaje
 *                       'wo-push' a la página); si no, notificación del
 *                       sistema.
 *   notificationclick → enfoca la pestaña que ya está en ese destino o abre
 *                       una nueva. Solo rutas internas de la app.
 *   pushsubscriptionchange → el navegador rotó la suscripción: se renueva y se
 *                       avisa al servidor (POST /api/push/refresh).
 *
 * Vive en la raíz pública para que su alcance cubra toda la app (también bajo
 * el prefijo /beta/).
 * ========================================================================== */
'use strict';

var ICON_PATH = 'shared/assets/ronda2/push/icon-192.webp';
var BADGE_PATH = 'shared/assets/ronda2/push/badge-96.webp';
var assetChecks = {};

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

function scopeBase() { return self.registration.scope; }

// Ruta interna ("/client/dashboard?quote=1") → URL absoluta dentro del alcance.
function scopedUrl(path) {
    var base = scopeBase();
    var raw = typeof path === 'string' ? path : '';
    if (!/^\/([^\/\\]|$)/.test(raw)) return base;
    try {
        var url = new URL(raw.replace(/^\/+/, ''), base);
        return url.origin === new URL(base).origin ? url.href : base;
    } catch (e) {
        return base;
    }
}

// El ícono es opcional: si el archivo todavía no existe, el aviso sale sin él.
function optionalAsset(path) {
    if (assetChecks[path]) return assetChecks[path];
    var url = new URL(path, scopeBase()).href;
    assetChecks[path] = fetch(url, { method: 'HEAD', cache: 'no-cache' })
        .then(function (res) { return res.ok ? url : undefined; })
        .catch(function () { return undefined; });
    return assetChecks[path];
}

function text(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function readPush(event) {
    var data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) {
        try { data = { body: event.data.text() }; } catch (err) { data = {}; }
    }
    if (!data || typeof data !== 'object') data = {};
    return {
        id: data.id ? text(data.id, 64) : '',
        title: text(data.title, 160) || 'We Ötzi',
        body: text(data.body, 400),
        url: typeof data.url === 'string' && /^\/([^\/\\]|$)/.test(data.url) ? data.url.slice(0, 600) : '/',
        tag: text(data.tag, 120),
        kind: text(data.kind, 40),
        ts: Number(data.ts) || Date.now()
    };
}

self.addEventListener('push', function (event) {
    var notification = readPush(event);
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        var visible = windows.filter(function (client) { return client.visibilityState === 'visible'; });
        var focused = visible.some(function (client) { return client.focused; });
        visible.forEach(function (client) {
            // shown=true: ya hay notificación del sistema; la página no repite el sonido.
            try { client.postMessage({ type: 'wo-push', notification: notification, shown: !focused }); } catch (e) { /* pestaña cerrándose */ }
        });
        if (focused) return undefined;
        return Promise.all([optionalAsset(ICON_PATH), optionalAsset(BADGE_PATH)]).then(function (assets) {
            var options = {
                body: notification.body,
                lang: 'es',
                data: { url: notification.url, id: notification.id },
                timestamp: notification.ts
            };
            if (notification.tag) { options.tag = notification.tag; options.renotify = true; }
            if (assets[0]) options.icon = assets[0];
            if (assets[1]) options.badge = assets[1];
            return self.registration.showNotification(notification.title, options);
        });
    }));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var data = event.notification.data || {};
    var target = scopedUrl(data.url);
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        for (var i = 0; i < windows.length; i++) {
            if (windows[i].url === target && 'focus' in windows[i]) return windows[i].focus();
        }
        // ?wo_n=<id>: la página sabe que ese aviso ya se vio (no lo repite) y lo marca leído.
        var open = target;
        if (/^[0-9a-f-]{36}$/i.test(String(data.id || ''))) {
            try {
                var withId = new URL(target);
                withId.searchParams.set('wo_n', data.id);
                open = withId.href;
            } catch (e) { open = target; }
        }
        return self.clients.openWindow ? self.clients.openWindow(open) : undefined;
    }));
});

self.addEventListener('pushsubscriptionchange', function (event) {
    var old = event.oldSubscription;
    var renew = event.newSubscription
        ? Promise.resolve(event.newSubscription)
        : (old && old.options && old.options.applicationServerKey
            ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey })
            : Promise.resolve(null));
    event.waitUntil(renew.then(function (fresh) {
        if (!old || !fresh) return undefined;
        // El servidor exige el secreto `auth` de la suscripción anterior como
        // prueba de que la renueva el mismo navegador. Sin él (navegadores que
        // no entregan la anterior), la app la vuelve a guardar al abrirse.
        var oldKeys = (typeof old.toJSON === 'function' && old.toJSON().keys) || {};
        if (!oldKeys.auth) return undefined;
        return fetch(new URL('api/push/refresh', scopeBase()).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_endpoint: old.endpoint, old_auth: oldKeys.auth, subscription: fresh.toJSON() })
        });
    }).catch(function () { /* se vuelve a sincronizar al abrir la app */ }));
});
