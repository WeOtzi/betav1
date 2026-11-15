/**
 * WE OTZI - Ítems del panel de notificaciones del artista (Figma 801:558)
 * ----------------------------------------------------------------------
 * Ronda 3 · P15: "Contraoferta recibida". Lógica pura que usa
 * wo-artist-menu.js con las postulaciones y contraofertas que ya lee de la
 * capa de datos (Job Board: contraoferta del cliente en 'pendiente'; Spots:
 * contraoferta del estudio en 'pending'). Sin tabla nueva: el ítem existe
 * mientras la contraoferta sigue pendiente.
 *
 * Ronda 2 · P26: destinos exactos de cada ítem de actividad y de notificación
 * (cotización con ?quote= / ?id=, chat con ?quote= / ?thread=, sesión en el
 * calendario, verificación), también para "Tu actividad" del panel del
 * cliente. ?ver=<zona> le dice a wo-notify.js qué bloque resaltar al llegar.
 *
 * Navegador: window.WoNotificationFeedModel. Node (tests): require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoNotificationFeedModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Postulaciones que todavía pueden recibir una contraoferta.
    var OPEN_JB = ['pending', 'viewed'];
    var OPEN_SPOT = ['pending', 'shortlisted'];
    // Tope de consultas por apertura del menú (una por postulación abierta).
    var MAX_LOOKUPS = 12;

    function rows(value) {
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.data)) return value.data;
        return [];
    }

    function openJbApplications(apps) {
        return rows(apps).filter(function (a) { return a && OPEN_JB.indexOf(a.status) !== -1; }).slice(0, MAX_LOOKUPS);
    }

    function openSpotApplications(apps) {
        return rows(apps).filter(function (a) { return a && OPEN_SPOT.indexOf(a.status) !== -1; }).slice(0, MAX_LOOKUPS);
    }

    function pendingOffer(offers, role, status) {
        return rows(offers).filter(function (o) { return o && o.author_role === role && o.status === status; })
            .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); })[0] || null;
    }

    function jbTitle(app) {
        var req = app && app.job_board_requests;
        return (req && (req.display_title || req.request_code)) || 'tu propuesta del Job Board';
    }

    function spotTitle(app) {
        var spot = app && app.studio_spots;
        return (spot && spot.title) || 'un spot';
    }

    /**
     * entries: { jb: [{ app, offers }], spots: [{ app, offers }] }
     * seen: Set de claves leídas (user_notification_reads).
     */
    function counterOfferItems(entries, seen) {
        var read = seen && typeof seen.has === 'function' ? seen : { has: function () { return false; } };
        var items = [];
        (entries && entries.jb || []).forEach(function (entry) {
            var offer = pendingOffer(entry.offers, 'client', 'pendiente');
            if (!offer || !entry.app) return;
            var key = 'cof:jb:' + offer.id;
            items.push({
                key: key, type: 'contraoferta', icon: 'briefcase',
                title: 'Contraoferta recibida',
                desc: 'El cliente te mandó una contraoferta por ' + jbTitle(entry.app) + '.',
                ts: offer.created_at, unread: !read.has(key),
                href: '/artist/applications?type=jobboard&id=' + encodeURIComponent(entry.app.id) + '&from=jobboard'
            });
        });
        (entries && entries.spots || []).forEach(function (entry) {
            var offer = pendingOffer(entry.offers, 'studio', 'pending');
            if (!offer || !entry.app) return;
            var key = 'cof:spot:' + offer.id;
            items.push({
                key: key, type: 'contraoferta', icon: 'briefcase',
                title: 'Contraoferta recibida',
                desc: 'El estudio te mandó una contraoferta para ' + spotTitle(entry.app) + '.',
                ts: offer.created_at, unread: !read.has(key),
                href: '/artist/applications?type=spot&id=' + encodeURIComponent(entry.app.id) + '&from=spots'
            });
        });
        return items;
    }

    /* ------------------------------------------------------------------ *
     *  Destinos exactos (ronda 2 · P26)                                   *
     * ------------------------------------------------------------------ */
    // Zonas que wo-notify.js sabe resaltar al llegar (?ver=<zona>).
    var FOCUS_ZONES = ['propuesta', 'acuerdo', 'chat', 'sesiones', 'historial', 'disputa', 'cierre', 'pagos', 'actividad'];

    function enc(value) { return encodeURIComponent(String(value == null ? '' : value)); }

    function withVer(href, ver) {
        if (!href || !ver || FOCUS_ZONES.indexOf(ver) === -1) return href;
        if (/[?&]ver=/.test(href)) return href;
        var hashAt = href.indexOf('#');
        var hash = hashAt === -1 ? '' : href.slice(hashAt);
        var rest = hashAt === -1 ? href : href.slice(0, hashAt);
        return rest + (rest.indexOf('?') === -1 ? '?' : '&') + 'ver=' + ver + hash;
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    // Día local (YYYY-MM-DD) de una fecha, para ?date= del calendario.
    function localDateKey(value) {
        var d = value instanceof Date ? value : new Date(value);
        if (!value || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    // Detalle de la cotización: artista → /my-quotations/detail?id=, cliente →
    // /client/dashboard?quote= (abre el detalle). Sin id, la lista.
    function quoteHref(role, quoteId, ver) {
        if (!quoteId) return role === 'client' ? '/client/dashboard#mis-cotizaciones' : '/my-quotations';
        return withVer(role === 'client'
            ? '/client/dashboard?quote=' + enc(quoteId)
            : '/my-quotations/detail?id=' + enc(quoteId), ver);
    }

    // Conversación: ref = { quoteId } (chat de la cotización) o { threadId } (inbox).
    function chatHref(role, ref) {
        var base = role === 'client' ? '/client/chats' : (role === 'studio' ? '/studio/dashboard' : '/artist/inbox');
        if (ref && ref.threadId) return base + '?thread=' + enc(ref.threadId);
        if (ref && ref.quoteId && role !== 'studio') return base + '?quote=' + enc(ref.quoteId);
        return base;
    }

    // Sesión: el artista va al día y al evento en su calendario; el cliente (sin
    // calendario propio) a la cotización, con las sesiones resaltadas.
    function sessionHref(role, session, quoteId) {
        if (role === 'client') return quoteHref('client', quoteId, 'sesiones');
        var day = localDateKey(session && session.session_date);
        if (!session || !session.id || !day) return '/calendar';
        return '/calendar?view=day&date=' + day + '&event=' + enc('session:' + session.id);
    }

    // Postulación del artista: type = 'spot' | 'jobboard'.
    function applicationHref(type, applicationId) {
        if (!applicationId) return '/artist/applications' + (type === 'spot' ? '?tab=spots' : '');
        return type === 'spot'
            ? '/artist/applications?type=spot&id=' + enc(applicationId) + '&from=spots'
            : '/artist/applications?type=jobboard&id=' + enc(applicationId) + '&from=jobboard';
    }

    // Propuesta recibida por el cliente en una publicación del Job Board
    // (client-requests.js: ?id=<solicitud>&view=postulacion&app=<postulación>).
    function clientRequestHref(requestId, applicationId) {
        if (!requestId) return '/client/requests';
        return '/client/requests?id=' + enc(requestId)
            + (applicationId ? '&view=postulacion&app=' + enc(applicationId) : '');
    }

    function verificationHref(role) {
        return role === 'studio' ? '/studio/dashboard' : '/artist/account#verificacion';
    }

    /**
     * Destino de un ítem según su tipo. data depende del tipo:
     *   quote { quoteId, ver } · chat { quoteId | threadId } ·
     *   session { session, quoteId } · application { type, id } ·
     *   request { requestId, applicationId } · verification · invitation
     */
    function destination(role, kind, data) {
        var d = data || {};
        if (kind === 'quote') return quoteHref(role, d.quoteId, d.ver);
        if (kind === 'chat') return chatHref(role, d);
        if (kind === 'session') return sessionHref(role, d.session, d.quoteId);
        if (kind === 'application') return applicationHref(d.type, d.id);
        if (kind === 'request') return clientRequestHref(d.requestId, d.applicationId);
        if (kind === 'verification') return verificationHref(role);
        if (kind === 'invitation') return '/artist/invitations';
        return null;
    }

    // Actividad reciente del dashboard del artista (dashboard-live-model.js):
    // el enlace al detalle suma la zona que corresponde al tipo de evento.
    var ARTIST_ACTIVITY_FOCUS = { confirmation: 'acuerdo', session: 'sesiones', payment: 'pagos', message: 'chat' };
    function artistActivityHref(ev) {
        if (!ev || !ev.href) return null;
        var href = String(ev.href);
        if (href.indexOf('/my-quotations/detail') !== 0) return href;
        var ver = ARTIST_ACTIVITY_FOCUS[ev.type] || (ev.icon === 'corner-up-left' ? 'propuesta' : (ev.icon === 'x-circle' ? 'historial' : ''));
        return withVer(href, ver);
    }

    /* ------------------------------------------------------------------ *
     *  "Tu actividad" del panel del cliente (ronda 2 · P26)               *
     * ------------------------------------------------------------------ */
    // Zona del detalle que corresponde a cada cambio de estado que ve el cliente.
    var CLIENT_STATUS_FOCUS = {
        responded: 'propuesta', client_approved: 'propuesta', in_progress: 'propuesta',
        artist_completed: 'cierre', completed: 'cierre', cancelled: 'propuesta', expired: 'propuesta'
    };

    /**
     * Enlace y clave estable de una fila de "Tu actividad" del cliente:
     *   status   { quoteId, status, at }  → detalle de la cotización, zona según el estado
     *   dispute  { quoteId, at }          → detalle de la cotización, zona disputa
     *   message  { quoteId, at }          → conversación de esa cotización
     *   proposal { requestId, applicationId, at } → la postulación recibida
     * Devuelve { key, href, quoteId, ver } (quoteId y ver solo si abre el detalle).
     */
    function clientActivityLink(source, data) {
        var d = data || {};
        var at = d.at || '';
        if (source === 'status') {
            var ver = CLIENT_STATUS_FOCUS[d.status] || '';
            return { key: 'st:' + d.quoteId + ':' + d.status + ':' + at, href: quoteHref('client', d.quoteId, ver), quoteId: d.quoteId || '', ver: ver };
        }
        if (source === 'dispute') {
            return { key: 'dis:' + d.quoteId + ':' + at, href: quoteHref('client', d.quoteId, 'disputa'), quoteId: d.quoteId || '', ver: 'disputa' };
        }
        if (source === 'message') {
            return { key: 'msg:' + d.quoteId + ':' + at, href: chatHref('client', { quoteId: d.quoteId }), quoteId: '', ver: '' };
        }
        if (source === 'proposal') {
            return { key: 'jb:' + (d.applicationId || '') + ':' + at, href: clientRequestHref(d.requestId, d.applicationId), quoteId: '', ver: '' };
        }
        return { key: '', href: null, quoteId: '', ver: '' };
    }

    return {
        MAX_LOOKUPS: MAX_LOOKUPS,
        openJbApplications: openJbApplications,
        openSpotApplications: openSpotApplications,
        pendingOffer: pendingOffer,
        counterOfferItems: counterOfferItems,
        // destinos (P26)
        FOCUS_ZONES: FOCUS_ZONES,
        withVer: withVer,
        localDateKey: localDateKey,
        quoteHref: quoteHref,
        chatHref: chatHref,
        sessionHref: sessionHref,
        applicationHref: applicationHref,
        clientRequestHref: clientRequestHref,
        verificationHref: verificationHref,
        destination: destination,
        artistActivityHref: artistActivityHref,
        CLIENT_STATUS_FOCUS: CLIENT_STATUS_FOCUS,
        clientActivityLink: clientActivityLink
    };
}));
