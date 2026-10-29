/* Figma 801:1126: presentation fixtures ONLY on the isolated preview dashboard.
 * No writes, no shared fixture changes, no replacement of production data. */
(function () {
    'use strict';
    if (window.WEOTZI_PREVIEW !== true || !window.WeotziPreview?.isSimulated) return;
    const now = Date.now();
    window.ClientDashboardReference = {
        greeting: 'Buen día, Sophie',
        counters: [2, 3, 1, 4],
        appointment: { artist_name: 'Lauu Marth', label: 'Vie 14 de agosto · 15:30 — Estudio Bauhaus Ink' },
        events: [
            { icon: 'message-circle', text: 'Fede Ruiz te respondió tu cotización', at: new Date(now - 2 * 3600000).toISOString() },
            { icon: 'inbox', text: 'Nuevo mensaje de Estudio Bauhaus Ink', at: new Date(now - 5 * 3600000).toISOString() },
            { icon: 'calendar', text: 'Tu reserva con Lauu Marth quedó confirmada', at: new Date(now - 86400000).toISOString() },
            { icon: 'briefcase', text: 'Recibiste una propuesta en tu publicación', at: new Date(now - 2 * 86400000).toISOString() }
        ],
        artists: [
            { username: 'lauu-marth', name: 'Lauu Marth', city: 'Buenos Aires', styles_array: ['Blackwork', 'Ornamental'], badge: 'reco', rating: 4.9 },
            { username: 'kenji-aoki', name: 'Kenji Aoki', city: 'Buenos Aires', styles_array: ['Japonés'], badge: 'guest', rating: 4.8 },
            { username: 'emma-cruz', name: 'Emma Cruz', city: 'Palermo, BA', styles_array: ['Fine line'], badge: 'near' }
        ]
    };
}());
