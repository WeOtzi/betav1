/**
 * Fixtures de preview/demo · área "flash" (Flash Tattoos, 17 nov 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 *   - Flashes con precio en la galería del artista demo (Valentina): el dueño
 *     los ve con su precio y estado, sin "Reservar este flash".
 *   - Otra artista ficticia, Mara (mara-flash.wo), con tres flashes: dos
 *     disponibles y uno reservado. Su perfil muestra "Reservar este flash" y
 *     lleva a /flash?artist=mara-flash.wo&id=fl_demo_golondrina.
 *   - Una solicitud de flash pendiente en /my-quotations (source 'flash' con
 *     su flash_snapshot), para ver la insignia, el bloque del flash y el
 *     presupuesto precargado al responder.
 *
 * El preview (seedProfiles) reemplaza artists_db DESPUÉS de las extensiones:
 * por eso artists_db se define con un setter que agrega los flashes sobre la
 * lista que deja el preview. Todo es ficticio y queda solo en el navegador.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['flash'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var now = Date.now();
        function daysAgo(n) { return new Date(now - n * DAY).toISOString(); }

        var MARA_ID = 'f1a5f1a5-0000-4000-8000-00000000f1a5';
        var OWN_FLASHES = [
            { id: 'fl_demo_rosa', url: '/shared/assets/demo/ref-04.svg', kind: 'image', category: 'flash', title: 'Rosa de línea fina', created_at: daysAgo(12),
                flash: { price: 90, currency: 'USD', size_h_cm: 8, size_w_cm: 6, zones: ['Muñeca', 'Antebrazo'], available: true, mode: 'unique' } },
            { id: 'fl_demo_luna', url: '/shared/assets/demo/ref-05.svg', kind: 'image', category: 'flash', title: 'Luna creciente', created_at: daysAgo(30),
                flash: { price: 60, currency: 'USD', size_text: 'Chico, del tamaño de una moneda', zones: [], available: true, mode: 'repeat' } }
        ];
        var MARA_FLASHES = [
            { id: 'fl_demo_golondrina', url: '/shared/assets/demo/ref-06.svg', kind: 'image', category: 'flash', title: 'Golondrina tradicional', created_at: daysAgo(5),
                flash: { price: 120, currency: 'USD', size_h_cm: 10, size_w_cm: 8, zones: ['Antebrazo', 'Pantorrilla'], available: true, mode: 'unique' } },
            { id: 'fl_demo_daga', url: '/shared/assets/demo/ref-07.svg', kind: 'image', category: 'flash', title: 'Daga y serpiente', created_at: daysAgo(9),
                flash: { price: 150000, currency: 'ARS', size_h_cm: 14, size_w_cm: 6, zones: ['Pantorrilla'], available: true, mode: 'repeat' } },
            { id: 'fl_demo_corazon', url: '/shared/assets/demo/ref-08.svg', kind: 'image', category: 'flash', title: 'Corazón sagrado', created_at: daysAgo(20),
                flash: { price: 110, currency: 'USD', size_h_cm: 9, size_w_cm: 9, zones: [], available: false, mode: 'unique' } },
            { id: 'demo-mara-work-1', url: '/shared/assets/demo/ref-09.svg', kind: 'image', category: 'realizados', title: 'Pantera', created_at: daysAgo(40) }
        ];

        function withFlashes(list) {
            var rows = Array.isArray(list) ? list : [];
            rows.forEach(function (artist) {
                if (!artist || artist.user_id !== artistId) return;
                var feed = Array.isArray(artist.gallery_feed_items) ? artist.gallery_feed_items : [];
                if (!feed.some(function (it) { return it && it.id === OWN_FLASHES[0].id; })) {
                    artist.gallery_feed_items = feed.concat(OWN_FLASHES.map(function (it) { return JSON.parse(JSON.stringify(it)); }));
                }
            });
            if (!rows.some(function (a) { return a && a.user_id === MARA_ID; })) {
                var base = rows[0] || {};
                rows.push(Object.assign({}, base, {
                    id: MARA_ID, user_id: MARA_ID, username: 'mara-flash.wo', name: 'Mara · Flash Demo',
                    email: 'mara.preview@example.invalid', instagram: 'mara.flash.demo',
                    bio: 'Artista ficticia para revisar Flash Tattoos. Diseños listos con precio fijo.',
                    bio_description: 'Artista ficticia para revisar Flash Tattoos. Diseños listos con precio fijo.',
                    styles_array: ['Old school', 'Neotradicional'], estilo: 'Old school',
                    ubicacion: 'Córdoba, Argentina', city: 'Córdoba', country: 'Argentina',
                    gallery_images: MARA_FLASHES.map(function (it) { return it.url; }),
                    gallery_feed_items: MARA_FLASHES.map(function (it) { return JSON.parse(JSON.stringify(it)); }),
                    registration_status: 'aprobado', is_public: true, created_at: daysAgo(90)
                }));
            }
            return rows;
        }

        // artists_db con setter: el preview la reemplaza después de las extensiones.
        var current = withFlashes(tables.artists_db || []);
        try {
            Object.defineProperty(tables, 'artists_db', {
                configurable: true,
                enumerable: true,
                get: function () { return current; },
                set: function (value) { current = withFlashes(value); }
            });
        } catch (_) {
            tables.artists_db = current;
        }

        /* -------- solicitud de flash pendiente en /my-quotations -------- */
        var quotes = tables.quotations_db || (tables.quotations_db = []);
        if (!quotes.some(function (q) { return q.quote_id === 'DEMO-F01'; })) {
            var template = quotes[0] || {};
            var nextId = quotes.reduce(function (m, q) { return Math.max(m, Number(q.id) || 0); }, 990000) + 50;
            var snapshot = {
                id: 'fl_demo_rosa', title: 'Rosa de línea fina', price: 90, currency: 'USD', size: '8 × 6 cm',
                size_h_cm: 8, size_w_cm: 6, zones: ['Muñeca', 'Antebrazo'], mode: 'unique',
                image: '/shared/assets/demo/ref-04.svg', slot_minutes: 120
            };
            quotes.push(Object.assign({}, template, {
                id: nextId, quote_id: 'DEMO-F01', short_code: 'FR4SH2', quote_status: 'pending',
                created_at: daysAgo(0), updated_at: daysAgo(0), artist_id: template.artist_id || artistId,
                source: 'flash', quotation_medium: 'web', flash_snapshot: snapshot,
                tattoo_idea_description: 'Flash «Rosa de línea fina» del artista, para tatuarlo tal cual. Tamaño aproximado: 8 × 6 cm. Zonas sugeridas por el artista: Muñeca, Antebrazo. Diseño único: se tatúa una sola vez.',
                project_description: 'Flash · Rosa de línea fina', tattoo_style: 'Flash', tattoo_size: '8 × 6 cm',
                tattoo_body_part: 'Muñeca', tattoo_body_side: null, tattoo_estimated_sessions: '1',
                client_full_name: 'Lucía Benítez', client_city_residence: 'Buenos Aires',
                client_budget_amount: 90, client_budget_currency: 'USD',
                artist_budget_amount: null, artist_budget_currency: null, final_budget_amount: null, final_budget_currency: null,
                artist_session_minutes: null, priority: 'high', is_archived: false,
                reference_images: ['/shared/assets/demo/ref-04.svg'], reference_images_count: 1, notes: null,
                artist_responded_at: null, artist_completed_at: null, client_completed_at: null,
                preferred_date_from: new Date(now + 9 * DAY).toISOString().slice(0, 10),
                preferred_date_to: new Date(now + 9 * DAY).toISOString().slice(0, 10),
                client_preferred_date: 'Turno elegido', client_flexible_dates: false
            }));
        }
    };
})(typeof self !== 'undefined' ? self : this);
