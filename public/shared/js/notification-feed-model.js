/**
 * WE OTZI - Ítems del panel de notificaciones del artista (Figma 801:558)
 * ----------------------------------------------------------------------
 * Ronda 3 · P15: "Contraoferta recibida". Lógica pura que usa
 * wo-artist-menu.js con las postulaciones y contraofertas que ya lee de la
 * capa de datos (Job Board: contraoferta del cliente en 'pendiente'; Spots:
 * contraoferta del estudio en 'pending'). Sin tabla nueva: el ítem existe
 * mientras la contraoferta sigue pendiente.
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

    return {
        MAX_LOOKUPS: MAX_LOOKUPS,
        openJbApplications: openJbApplications,
        openSpotApplications: openSpotApplications,
        pendingOffer: pendingOffer,
        counterOfferItems: counterOfferItems
    };
}));
