/**
 * Fixtures de preview/demo · área "dashboard" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * - artist_reminders: tabla nueva (migración 20261028110000_artist_reminders.sql)
 *   con los 4 recordatorios del frame 24:1425 / 801:563, fechas relativas a hoy.
 * - WoDemoIGImportSample: respuesta simulada de /api/instagram/preview para que
 *   el flujo "Importar Instagram" (frames 2003:1191 / 1902 / 2583) se pueda
 *   recorrer en el preview local, donde la API real está bloqueada.
 */
(function (root) {
    'use strict';
    var DAY = 24 * 60 * 60 * 1000;

    function dateOnly(offset) {
        var d = new Date(Date.now() + offset * DAY);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function ago(hours) { return new Date(Date.now() - hours * 3600000).toISOString(); }

    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['dashboard'] = function (ctx) {
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        if (ctx.TABLES.indexOf('artist_reminders') === -1) ctx.TABLES.push('artist_reminders');
        var rows = [
            ['0000c0de-0000-4000-8000-d45b00000001', 'Reponer tinta negra', 'Se está terminando la Dynamic Triple Black. Pedir 3 unidades al proveedor de siempre antes del jueves.', 'droplet', 2, 'alta', true],
            ['0000c0de-0000-4000-8000-d45b00000002', 'Enviar boceto a Camila', 'Mandar la segunda versión del boceto con el ajuste de la línea del hombro.', 'edit', 1, 'urgente', true],
            ['0000c0de-0000-4000-8000-d45b00000003', 'Responder WhatsApp de Nico', '', 'message-circle', 0, 'normal', false],
            ['0000c0de-0000-4000-8000-d45b00000004', 'Cobrar saldo · Mateo', 'Queda pendiente $650 de la sesión 2/3. Cobrar al inicio del próximo turno.', 'dollar-sign', 4, 'alta', true]
        ];
        ctx.tables.artist_reminders = rows.map(function (r, i) {
            return {
                id: r[0], artist_user_id: artistId, title: r[1], detail: r[2] || null, icon: r[3],
                due_date: dateOnly(r[4]), priority: r[5], is_important: r[6], attachments: [],
                completed_at: null, created_at: ago(72 - i), updated_at: ago(72 - i)
            };
        });
    };

    // Publicaciones ficticias para el paso 02 · SELECCIÓN (Figma 2003:1902).
    var ASSET = '/shared/assets/demo/';
    root.WoDemoIGImportSample = {
        summary: {
            username: 'valentina.preview', full_name: 'Valentina · Preview', profile_pic: null,
            bio_present: true, bio_link_present: false, location_guess: 'Buenos Aires', location_source: 'bio',
            photos_count: 4, reels_count: 2,
            media: [
                { permalink: 'https://www.instagram.com/p/PREVIEW01/', kind: 'image', thumbnail_url: ASSET + 'ref-04.svg', caption: 'Mandala dotwork' },
                { permalink: 'https://www.instagram.com/p/PREVIEW02/', kind: 'reel', thumbnail_url: ASSET + 'ref-05.svg', caption: 'Sesión blackwork', video_duration: 18 },
                { permalink: 'https://www.instagram.com/p/PREVIEW03/', kind: 'image', thumbnail_url: ASSET + 'ref-06.svg', caption: 'Rosa fineline' },
                { permalink: 'https://www.instagram.com/p/PREVIEW04/', kind: 'image', thumbnail_url: ASSET + 'ref-07.svg', caption: 'Tigre japonés' },
                { permalink: 'https://www.instagram.com/p/PREVIEW05/', kind: 'reel', thumbnail_url: ASSET + 'ref-08.svg', caption: 'Sesión completa', video_duration: 45 },
                { permalink: 'https://www.instagram.com/p/PREVIEW06/', kind: 'image', thumbnail_url: ASSET + 'ref-09.svg', caption: 'Lettering script' }
            ]
        }
    };
}(typeof self !== 'undefined' ? self : this));
