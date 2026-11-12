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

        /* ---- ronda 3 · grupo dashboard (P11 / P12) ---- */
        // P12: etapa y fecha límite del diseño en sus columnas propias
        // (migración 20261112180000). Se copian de los valores de ejemplo que
        // las cotizaciones demo traían en current_step / client_preferred_date.
        (ctx.tables.quotations_db || []).forEach(function (q) {
            var stage = String(q.current_step || '').toLowerCase();
            if (q.design_stage === undefined) q.design_stage = ['boceto', 'entintado', 'final'].indexOf(stage) > -1 ? stage : null;
            if (q.design_due_date === undefined) {
                q.design_due_date = (q.design_stage && q.client_preferred_date) ? String(q.client_preferred_date).slice(0, 10) : null;
            }
        });
        ctx.rpcs = ctx.rpcs || {};
        ctx.rpcs.set_quotation_design_stage = function (args, store) {
            var stage = args.p_stage ? String(args.p_stage).trim().toLowerCase() : null;
            if (stage && ['boceto', 'entintado', 'final'].indexOf(stage) === -1) {
                throw Object.assign(new Error('Etapa inválida: ' + args.p_stage), { code: '22023' });
            }
            var q = store.rows('quotations_db').find(function (r) { return String(r.id) === String(args.p_quotation_id); });
            if (!q) throw Object.assign(new Error('La cotización no existe.'), { code: 'P0002' });
            q.design_stage = stage;
            q.design_due_date = args.p_due_date || null;
            q.updated_at = new Date().toISOString();
            return [{ id: q.id, quote_id: q.quote_id, design_stage: q.design_stage, design_due_date: q.design_due_date }];
        };

        // P11: eventos propios del calendario HOY para la "Agenda del día"
        // (un bloque de dibujo y un evento personal semanal). Los turnos del
        // Figma (10:00 … 18:30) siguen saliendo de quotation_sessions.
        function todayAt(h, m) { var d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }
        var events = ctx.tables.artist_calendar_events = (ctx.tables.artist_calendar_events || [])
            .filter(function (e) { return !/^0000c0de-0000-4000-8000-d45b000000e/.test(String(e.id)); });
        events.push(
            { id: '0000c0de-0000-4000-8000-d45b000000e1', artist_user_id: artistId, event_type: 'personal', title: 'Bloque de dibujo', client_name: null, starts_at: todayAt(8, 0), ends_at: todayAt(9, 0), all_day: false, location: null, notes: 'Bocetos de la semana.', status: 'scheduled', recurrence_rule: 'none', recurrence_until: null, created_at: ago(30), updated_at: ago(30) },
            { id: '0000c0de-0000-4000-8000-d45b000000e2', artist_user_id: artistId, event_type: 'personal', title: 'Pedido de insumos', client_name: null, starts_at: todayAt(12, 0), ends_at: todayAt(12, 30), all_day: false, location: null, notes: 'Retirar agujas y film.', status: 'scheduled', recurrence_rule: 'weekly', recurrence_until: null, created_at: ago(24 * 20), updated_at: ago(24 * 20) }
        );
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
