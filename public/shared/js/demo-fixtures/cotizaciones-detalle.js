/**
 * Fixtures de preview/demo · área "cotizaciones-detalle" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Solo AGREGA datos que lee el expediente /my-quotations/detail sin mover los
 * estados ni montos que usan otras áreas (listado, calendario, dashboard).
 * Única excepción de fechas: la cronología de DEMO-C01, DEMO-D03 y DEMO-D01
 * (ver timelineFix). Agrega columnas nuevas de la migración 20261028130000 (duración por
 * sesión, primera apertura, fotos de sesión), notas privadas, comentario del
 * acuerdo y estudio, notas de trabajo (quotation_notes) y una disputa abierta
 * (tabla nueva quotation_disputes) sobre DEMO-D03.
 *
 * Expediente por estado real (preview): DEMO-P01 pendiente · DEMO-S01
 * respondida · DEMO-D01 aprobada · DEMO-D03 en disputa · DEMO-C01 completada.
 * Cada frame del Figma también se captura con ?estado=<clave> (solo preview).
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['cotizaciones-detalle'] = function (ctx) {
        var tables = ctx.tables;
        var ASSETS = (ctx.helpers && ctx.helpers.ASSETS) || '/shared/assets/demo/';
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = Date.now();
        function ago(days, hours) { return new Date(now - days * DAY - (hours || 0) * 3600000).toISOString(); }
        function photos(a, b, c) { return [a, b, c].map(function (n) { return ASSETS + 'ref-0' + n + '.svg'; }); }

        var quotes = tables.quotations_db || [];
        var byQuote = {};
        quotes.forEach(function (q) { byQuote[q.quote_id] = q; });
        function patch(quoteId, values) {
            var row = byQuote[quoteId];
            if (row) Object.keys(values).forEach(function (k) { if (row[k] == null) row[k] = values[k]; });
            return row;
        }

        var STUDIO = 'Estudio Ötzi · Providencia';
        patch('DEMO-P01', {
            artist_session_minutes: 240, artist_viewed_at: (byQuote['DEMO-P01'] || {}).created_at || ago(0), client_flexible_dates: 'Sí',
            artist_availability: 'Fines de semana, desde agosto',
            notes: 'Clienta segura de la idea; ya trae referencias. Ofrecer plan de pago en 2 cuotas.'
        });
        patch('DEMO-P02', { artist_session_minutes: 180 });
        patch('DEMO-P03', { artist_session_minutes: 200 });
        patch('DEMO-S01', {
            artist_session_minutes: 150, artist_viewed_at: ago(5, 20), client_flexible_dates: 'Sí',
            notes: 'Cliente parece serio, ya tiene el tatuaje pensado hace tiempo. Ofrecer plan de pago en 2 cuotas.'
        });
        patch('DEMO-D01', { artist_session_minutes: 180, artist_viewed_at: ago(8, 20), artist_studio_name: STUDIO, final_comment: 'Va a llevar una amiga. Solicita anestesia.' });
        patch('DEMO-D02', { artist_session_minutes: 240, artist_viewed_at: ago(13, 20), artist_studio_name: STUDIO, final_comment: 'Prefiere turnos de tarde.' });
        patch('DEMO-D03', { artist_session_minutes: 150, artist_viewed_at: ago(19, 20), artist_studio_name: STUDIO });
        patch('DEMO-D04', { artist_session_minutes: 60, artist_studio_name: STUDIO });
        patch('DEMO-D05', { artist_session_minutes: 45, artist_studio_name: STUDIO });
        patch('DEMO-C01', { artist_session_minutes: 180, artist_viewed_at: ago(11, 20), artist_studio_name: STUDIO, final_comment: 'Retoque sin cargo dentro de los 30 días.' });

        // Cronología coherente para DEMO-C01 y DEMO-D03: las fixtures base fechan
        // sus sesiones antes de la solicitud (C01: sesiones -20/-13 y solicitud -12;
        // D03: sesión -21 y solicitud -20, sin filas de historial). Solo para estas
        // dos se adelanta la solicitud, la apertura y la respuesta, y se fecha el
        // acuerdo en quotation_status_history (Figma 801:583/584: solicitud →
        // respuesta → acuerdo → sesiones → entrega). Siguen dentro del mismo mes y
        // de la ventana de 30 días de estadísticas; no cambian estados ni montos.
        var history = tables.quotation_status_history || (tables.quotation_status_history = []);
        function timelineFix(quoteId, createdDays, rows) {
            var q = byQuote[quoteId];
            if (!q) return;
            q.created_at = ago(createdDays);
            q.sent_to_artist_at = q.created_at;
            q.artist_viewed_at = ago(createdDays - 1, 20);
            q.artist_responded_at = ago(createdDays - 1);
            rows.forEach(function (r) {
                var row = history.find(function (h) { return h.quotation_id === q.id && h.new_status === r[1]; });
                if (row) { row.changed_at = r[2]; return; }
                history.push({ id: r[3], quotation_id: q.id, quote_id: q.quote_id, old_status: r[0], new_status: r[1], changed_at: r[2],
                    changed_by: r[1] === 'pending' || /client/.test(r[1]) ? q.client_user_id : q.artist_id, notes: null });
            });
        }
        timelineFix('DEMO-C01', 24, [
            [null, 'pending', ago(24), 999301], ['pending', 'responded', ago(23), 999302], ['responded', 'client_approved', ago(22), 999303]
        ]);
        // DEMO-D01 (ronda 2): la sesión 1 realizada (-10) quedaba antes de la
        // solicitud (-9). Solicitud -13, respuesta -12 y acuerdo -11: mantiene el
        // orden del listado (entre DEMO-S01 y DEMO-D02) y no toca estado, montos
        // ni sesiones (calendario).
        timelineFix('DEMO-D01', 13, [
            [null, 'pending', ago(13), 999321], ['pending', 'responded', ago(12), 999322], ['responded', 'client_approved', ago(11), 999323]
        ]);
        var firstD03 = (tables.quotation_sessions || []).filter(function (s) { return byQuote['DEMO-D03'] && s.quotation_id === byQuote['DEMO-D03'].id; })
            .map(function (s) { return s.session_date; }).sort()[0];
        timelineFix('DEMO-D03', 25, [
            [null, 'pending', ago(25), 999311], ['pending', 'responded', ago(24), 999312], ['responded', 'client_approved', ago(23), 999313],
            ['client_approved', 'in_progress', firstD03 || ago(21), 999314], ['in_progress', 'artist_completed', (byQuote['DEMO-D03'] || {}).artist_completed_at || ago(3), 999315]
        ]);

        // Fotos de avance en las sesiones ya realizadas (columna nueva photo_urls).
        var idToQuote = {};
        quotes.forEach(function (q) { idToQuote[q.id] = q.quote_id; });
        var photoSets = { 'DEMO-D01': [1, 2, 3], 'DEMO-D02': [2, 3, 4], 'DEMO-D03': [3, 4, 5], 'DEMO-C01': [6, 7, 8] };
        (tables.quotation_sessions || []).forEach(function (s) {
            if (s.photo_urls == null) s.photo_urls = [];
            var set = photoSets[idToQuote[s.quotation_id]];
            if (s.status === 'completed' && set && !s.photo_urls.length) s.photo_urls = photos(set[0], set[1], set[2]);
        });

        // Notas de trabajo (quotation_notes.content: bloques compatibles con EditorJS).
        function header(text) { return { type: 'header', data: { text: text, level: 3 } }; }
        function para(text) { return { type: 'paragraph', data: { text: text } }; }
        function check(text, checked) { return { type: 'checklist', data: { items: [{ text: text, checked: !!checked }] } }; }
        function item(text) { return { type: 'list', data: { style: 'unordered', items: [text] } }; }
        function quote(text) { return { type: 'quote', data: { text: text, caption: '', alignment: 'left' } }; }
        function content(blocks, tags) { return { time: now, version: 'wo-work-notes-1', template: null, tags: tags || [], blocks: blocks }; }

        var notes = tables.quotation_notes || (tables.quotation_notes = []);
        var s01 = byQuote['DEMO-S01'];
        var p01 = byQuote['DEMO-P01'];
        if (s01) {
            notes.push(
                { id: 999101, quotation_id: s01.id, title: 'Brief y preparación', label: null, note_date: ago(0, 2), created_at: ago(0, 3), updated_at: ago(0, 2),
                    content: content([
                        header('Preparación'),
                        para('Cliente parece serio, ya tiene el tatuaje pensado hace tiempo. Ofrecer plan de pago en 2 cuotas.'),
                        check('Confirmar tamaño final del stencil', true),
                        check('Pedir foto de la zona sin remera', false),
                        quote('Quiero que envuelva todo el antebrazo, como un brazalete.')
                    ], ['geométrico', 'antebrazo']) },
                { id: 999102, quotation_id: s01.id, title: 'Consulta inicial · llamada', label: null, note_date: ago(5), created_at: ago(5), updated_at: ago(5),
                    content: content([header('Llamada de 15 minutos'), para('Quiere líneas finas y simetría estricta.'), item('Mandar dos propuestas de patrón')]) },
                { id: 999103, quotation_id: s01.id, title: 'Ideas de composición', label: null, note_date: ago(6), created_at: ago(6), updated_at: ago(6),
                    content: content([header('Patrón'), para('Base hexagonal que cierre sin costura visible.'), item('Variante con puntos'), item('Variante con líneas dobles'), quote('Nada de grises intermedios.')]) }
            );
        }
        if (p01) {
            notes.push({ id: 999104, quotation_id: p01.id, title: 'Primeras ideas', label: null, note_date: ago(0, 1), created_at: ago(0, 1), updated_at: ago(0, 1),
                content: content([header('Referencias'), para('Láminas botánicas del siglo XIX, línea fina.'), check('Pedir medidas del antebrazo', false)], ['botánico']) });
        }

        // Disputa abierta sobre la entrega de DEMO-D03 (tabla nueva).
        var d03 = byQuote['DEMO-D03'];
        tables.quotation_disputes = tables.quotation_disputes || [];
        if (d03) {
            tables.quotation_disputes.push({
                id: 999201, quotation_id: d03.id, quote_id: d03.quote_id,
                opened_by: d03.client_user_id, opened_by_role: 'client', status: 'open',
                title: 'El punteado del sector inferior quedó incompleto',
                description: 'La clienta indica que la zona inferior del mandala no coincide con la referencia aprobada y pide una sesión de corrección antes de cerrar el proyecto.',
                evidence: [{ name: 'reclamo-foto-01.jpg', url: ASSETS + 'ref-03.svg' }, { name: 'referencia-aprobada.jpg', url: ASSETS + 'ref-04.svg' }],
                artist_response: null, artist_responded_at: null, resolution: null, resolved_at: null, resolved_by: null,
                created_at: ago(2), updated_at: ago(2)
            });
        }
        if (ctx.TABLES && ctx.TABLES.indexOf('quotation_disputes') === -1) ctx.TABLES.push('quotation_disputes');
    };
}(typeof self !== 'undefined' ? self : this));
