/**
 * WE OTZI - Fixtures del modo demo (datos de ejemplo del artista)
 * ---------------------------------------------------------------
 * Genera, para el artista logueado, el conjunto de tablas de mentira que
 * consume el emulador PostgREST (wo-demo-postgrest.js): cotizaciones con
 * sesiones/adjuntos/chat, job board, spots e invitaciones de estudios,
 * viajes, inbox unificado, calendario, visitas al perfil, reseñas y centro de
 * la cuenta. Las fechas son relativas a "hoy" para que la agenda del día y
 * los contadores siempre tengan sentido.
 *
 * El perfil del artista (`artists_db`) NO se simula: se lee el real, así el
 * demo muestra el nombre, avatar y galería de quien está logueado.
 *
 * Módulo puro (sin DOM): `window.WoDemoFixtures` en el navegador y `require`
 * en Node para los tests. API: `build(identity)` → { tables, relations, rpcs,
 * views }. Los nombres de columnas replican el esquema real (ver seeds en
 * supabase/seeds/ y las migraciones).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoDemoFixtures = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ASSETS = '/shared/assets/demo/';
    var DAY = 24 * 60 * 60 * 1000;

    // Tablas que el demo sirve desde memoria. Todo lo que no esté acá se lee
    // del backend real (y sus escrituras se ignoran mientras dura el demo).
    var TABLES = [
        'quotations_db', 'quotation_sessions', 'quotations_attachments', 'chat_messages', 'quotation_notes',
        'quotation_status_history', 'quotation_intake_extras',
        'job_board_requests', 'job_board_applications', 'job_board_attachments', 'job_board_request_stats',
        'job_board_counter_offers', 'artist_saved_job_requests', 'client_public_profiles',
        'studios', 'studio_locations', 'studio_spots', 'studio_spot_attachments', 'studio_spot_applications',
        'studio_spot_counter_offers', 'studio_artist_memberships', 'studio_membership_invitation_details',
        'studio_invitation_change_requests',
        'artist_trips', 'trip_studio_links', 'trip_checklist_items', 'trip_documents', 'trip_events',
        'artist_travel_passport_stamps',
        'artist_calendar_events', 'artist_profile_visits', 'verified_reviews',
        'inbox_threads', 'inbox_messages', 'support_conversations', 'support_messages',
        'user_preferences', 'artist_billing_profiles', 'artist_payment_methods', 'artist_financial_entries',
        'artist_account_sessions', 'artist_integration_connections', 'artist_account_deletion_requests',
        'artist_verification_documents'
    ];
    var VIEWS = ['chat_threads', 'public_review_summary', 'artist_profile_visits_daily', 'artist_artwork_view_counts'];

    function rel(table, localKey, foreignKey, many) {
        return { table: table, localKey: localKey, foreignKey: foreignKey, many: !!many };
    }
    var RELATIONS = {
        quotations_db: {
            quotation_sessions: rel('quotation_sessions', 'id', 'quotation_id', true),
            quotations_attachments: rel('quotations_attachments', 'quote_id', 'quotation_id', true),
            chat_messages: rel('chat_messages', 'quote_id', 'quotation_id', true),
            quotation_notes: rel('quotation_notes', 'id', 'quotation_id', true),
            quotation_status_history: rel('quotation_status_history', 'id', 'quotation_id', true)
        },
        quotation_sessions: { quotations_db: rel('quotations_db', 'quotation_id', 'id', false) },
        quotations_attachments: { quotations_db: rel('quotations_db', 'quotation_id', 'quote_id', false) },
        chat_messages: { quotations_db: rel('quotations_db', 'quotation_id', 'quote_id', false) },
        job_board_requests: {
            job_board_applications: rel('job_board_applications', 'id', 'request_id', true),
            job_board_attachments: rel('job_board_attachments', 'id', 'request_id', true),
            job_board_request_stats: rel('job_board_request_stats', 'id', 'request_id', false),
            client_public_profiles: rel('client_public_profiles', 'client_user_id', 'user_id', false)
        },
        job_board_applications: {
            job_board_requests: rel('job_board_requests', 'request_id', 'id', false),
            request_id: rel('job_board_requests', 'request_id', 'id', false),
            job_board_counter_offers: rel('job_board_counter_offers', 'id', 'application_id', true)
        },
        studios: {
            studio_locations: rel('studio_locations', 'id', 'studio_id', true),
            studio_spots: rel('studio_spots', 'id', 'studio_id', true)
        },
        studio_spots: {
            studios: rel('studios', 'studio_id', 'id', false), studio_id: rel('studios', 'studio_id', 'id', false),
            studio_locations: rel('studio_locations', 'location_id', 'id', false), location_id: rel('studio_locations', 'location_id', 'id', false),
            studio_spot_attachments: rel('studio_spot_attachments', 'id', 'spot_id', true),
            studio_spot_applications: rel('studio_spot_applications', 'id', 'spot_id', true)
        },
        studio_spot_applications: {
            studio_spots: rel('studio_spots', 'spot_id', 'id', false), spot_id: rel('studio_spots', 'spot_id', 'id', false),
            studio_spot_counter_offers: rel('studio_spot_counter_offers', 'id', 'application_id', true)
        },
        studio_artist_memberships: {
            studios: rel('studios', 'studio_id', 'id', false), studio_id: rel('studios', 'studio_id', 'id', false),
            studio_locations: rel('studio_locations', 'location_id', 'id', false), location_id: rel('studio_locations', 'location_id', 'id', false),
            studio_membership_invitation_details: rel('studio_membership_invitation_details', 'id', 'membership_id', false)
        },
        artist_trips: {
            trip_studio_links: rel('trip_studio_links', 'id', 'trip_id', true),
            trip_checklist_items: rel('trip_checklist_items', 'id', 'trip_id', true),
            trip_documents: rel('trip_documents', 'id', 'trip_id', true),
            trip_events: rel('trip_events', 'id', 'trip_id', true)
        },
        trip_studio_links: { artist_trips: rel('artist_trips', 'trip_id', 'id', false) },
        inbox_threads: { inbox_messages: rel('inbox_messages', 'id', 'thread_id', true) }
    };

    /* ------------------------------ helpers ------------------------------ */
    function uid(prefix, n) {
        var tail = (prefix + String(n)).replace(/[^0-9a-f]/gi, '0');
        while (tail.length < 12) tail = tail.slice(0, prefix.length) + '0' + tail.slice(prefix.length);
        return '0000c0de-0000-4000-8000-' + tail.slice(0, 12);
    }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function initials(name) {
        return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('') || 'WO';
    }
    // PRNG determinista (mulberry32) para que el demo sea estable entre cargas.
    function prng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function timeHelpers(now) {
        return {
            iso: function (d) { return new Date(d).toISOString(); },
            ago: function (ms) { return new Date(now.getTime() - ms).toISOString(); },
            minutesAgo: function (n) { return new Date(now.getTime() - n * 60000).toISOString(); },
            hoursAgo: function (n) { return new Date(now.getTime() - n * 3600000).toISOString(); },
            daysAgo: function (n) { return new Date(now.getTime() - n * DAY).toISOString(); },
            inDays: function (n) { return new Date(now.getTime() + n * DAY).toISOString(); },
            // Fecha local (día relativo) a una hora dada, en ISO.
            at: function (dayOffset, hhmm) {
                var d = new Date(now.getTime()); d.setDate(d.getDate() + dayOffset);
                var parts = hhmm.split(':'); d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10) || 0, 0, 0);
                return d.toISOString();
            },
            dateOnly: function (dayOffset) {
                var d = new Date(now.getTime()); d.setDate(d.getDate() + dayOffset);
                return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            },
            nextWeekday: function (weekday) {
                var d = new Date(now.getTime()); d.setHours(0, 0, 0, 0);
                var delta = (weekday - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + delta);
                return d;
            }
        };
    }

    var CLIENTS = [
        { key: 'camila', name: 'Camila Soto', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'nicolas', name: 'Nicolás Duarte', city: 'Rosario', country: 'Argentina' },
        { key: 'valentina', name: 'Valentina Ríos', city: 'La Plata', country: 'Argentina' },
        { key: 'sofia', name: 'Sofía Martínez', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'mateo', name: 'Mateo Ruiz', city: 'Córdoba', country: 'Argentina' },
        { key: 'lucia', name: 'Lucía Beltrán', city: 'Montevideo', country: 'Uruguay' },
        { key: 'julia', name: 'Julia Ferrer', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'tomas', name: 'Tomás Vega', city: 'Mendoza', country: 'Argentina' },
        { key: 'martin', name: 'Martín Aguirre', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'paula', name: 'Paula Giménez', city: 'Santiago', country: 'Chile' },
        { key: 'franco', name: 'Franco Medina', city: 'Rosario', country: 'Argentina' },
        { key: 'rocio', name: 'Rocío Cabrera', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'bruno', name: 'Bruno Tapia', city: 'Córdoba', country: 'Argentina' },
        { key: 'agustin', name: 'Agustín Torres', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'ana', name: 'Ana Pereyra', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'diego', name: 'Diego Lamas', city: 'Córdoba', country: 'Argentina' },
        { key: 'flor', name: 'Florencia Iturri', city: 'Mar del Plata', country: 'Argentina' },
        { key: 'santi', name: 'Santiago Ocampo', city: 'Buenos Aires', country: 'Argentina' },
        { key: 'mica', name: 'Micaela Ledesma', city: 'Rosario', country: 'Argentina' },
        { key: 'joaco', name: 'Joaquín Salas', city: 'Montevideo', country: 'Uruguay' }
    ];
    var CITIES = [
        { city: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lng: -58.3816 },
        { city: 'Córdoba', country: 'Argentina', lat: -31.4201, lng: -64.1888 },
        { city: 'Rosario', country: 'Argentina', lat: -32.9468, lng: -60.6393 },
        { city: 'Montevideo', country: 'Uruguay', lat: -34.9011, lng: -56.1645 },
        { city: 'Santiago', country: 'Chile', lat: -33.4489, lng: -70.6693 },
        { city: 'Madrid', country: 'España', lat: 40.4168, lng: -3.7038 },
        { city: 'Barcelona', country: 'España', lat: 41.3874, lng: 2.1686 },
        { city: 'Ciudad de México', country: 'México', lat: 19.4326, lng: -99.1332 },
        { city: 'Lima', country: 'Perú', lat: -12.0464, lng: -77.0428 },
        { city: 'Miami', country: 'Estados Unidos', lat: 25.7617, lng: -80.1918 }
    ];

    /* -------------------------------- build -------------------------------- */
    function build(identity) {
        identity = identity || {};
        var now = new Date();
        var T = timeHelpers(now);
        var artistId = identity.userId || null;
        var artistName = identity.name || 'Artista demo';
        var artistUsername = identity.username || 'artista.wo';
        var artistEmail = identity.email || 'artista@weotzi.demo';
        var clientsByKey = {};
        var clients = CLIENTS.map(function (c, i) {
            var row = Object.assign({}, c, {
                user_id: uid('c1', i + 1),
                email: c.key + '@ejemplo.weotzi.demo',
                username: c.key + '.cliente',
                initials: initials(c.name)
            });
            clientsByKey[c.key] = row;
            return row;
        });
        var tables = {};

        /* ------------------------------ clientes ------------------------------ */
        tables.client_public_profiles = clients.map(function (c, i) {
            return { user_id: c.user_id, public_username: c.username, profile_picture: null, city_residence: c.city, country: c.country, created_at: T.daysAgo(120 + i * 3) };
        });

        /* ---------------------------- cotizaciones ---------------------------- */
        // [quote_id, status, ageDays, updDays, cliente, zona, lado, idea, proyecto, estilo, sesiones, montoArtista, montoFinal, etapa, límiteDías, prioridad, tamaño, presupuestoCliente, source, ref]
        var QUOTES = [
            ['DEMO-P01', 'pending', 0, 0, 'camila', 'Antebrazo', 'Izquierdo', 'Retrato botánico con líneas finas, inspirado en ilustraciones científicas antiguas.', 'Retrato botánico', 'Realismo', 2, null, null, null, null, 'high', 'Mediano (10 a 15 cm)', 350, 'direct', 6],
            ['DEMO-P02', 'pending', 1, 1, 'nicolas', 'Pantorrilla', 'Derecho', 'Personaje anime en movimiento, con líneas dinámicas y algo de color.', 'Anime dinámico', 'Anime', 2, null, null, null, null, 'medium', 'Grande (más de 15 cm)', 420, 'direct', 7],
            ['DEMO-P03', 'pending', 2, 2, 'valentina', 'Muslo', 'Izquierdo', 'Composición floral Art Nouveau con marco ornamental.', 'Flores Art Nouveau', 'Art Nouveau', 3, null, null, null, null, 'medium', 'Grande (más de 15 cm)', 600, 'job_board', 11],
            ['DEMO-S01', 'responded', 6, 3, 'agustin', 'Antebrazo', 'Derecho', 'Patrón geométrico que envuelva el antebrazo como un brazalete.', 'Brazalete geométrico', 'Geométrico', 2, 380, null, 'BOCETO', null, 'low', 'Mediano (10 a 15 cm)', 300, 'direct', 3],
            ['DEMO-D01', 'client_approved', 9, 1, 'sofia', 'Brazo completo', 'Izquierdo', 'Manga floral en fine line, de la muñeca al hombro.', 'Manga floral', 'Fine line', 3, 250, null, 'ENTINTADO', 12, 'high', 'Grande (más de 15 cm)', 900, 'direct', 1],
            ['DEMO-D02', 'client_approved', 14, 2, 'mateo', 'Espalda', null, 'Dragón japonés para espalda completa, con olas y nubes.', 'Dragón espalda', 'Japonés', 4, 220, null, 'BOCETO', 20, 'medium', 'Grande (más de 15 cm)', 1000, 'direct', 2],
            ['DEMO-D03', 'artist_completed', 20, 3, 'lucia', 'Hombro', 'Derecho', 'Mandala geométrico en dotwork sobre el hombro.', 'Mandala geométrico', 'Dotwork', 2, 180, 180, 'FINAL', 28, 'low', 'Mediano (10 a 15 cm)', 200, 'direct', 3],
            ['DEMO-D04', 'client_approved', 5, 1, 'julia', 'Muñeca', 'Izquierdo', 'Retoque de líneas finas de un tatuaje anterior.', 'Retoque muñeca', 'Fine line', 1, 90, null, 'BOCETO', 8, 'low', 'Chico (menos de 10 cm)', 100, 'direct', 4],
            ['DEMO-D05', 'client_approved', 3, 1, 'tomas', 'Pierna', 'Derecho', 'Consulta de boceto realista para una pieza grande en la pierna.', 'Consulta boceto', 'Realismo', 2, 450, null, 'BOCETO', 15, 'medium', 'Grande (más de 15 cm)', 500, 'direct', 5],
            ['DEMO-C01', 'completed', 12, 2, 'martin', 'Brazo', 'Derecho', 'Retrato realista en negro y gris, finalizado.', 'Retrato finalizado', 'Realismo', 2, 1240, 1240, 'FINAL', null, 'medium', 'Grande (más de 15 cm)', 1200, 'direct', 8],
            ['DEMO-C02', 'completed', 18, 11, 'paula', 'Antebrazo', 'Izquierdo', 'Dotwork ornamental finalizado en dos sesiones.', 'Ornamental finalizado', 'Dotwork', 1, 980, 980, 'FINAL', null, 'low', 'Mediano (10 a 15 cm)', 900, 'job_board', null],
            ['DEMO-C03', 'completed', 25, 17, 'franco', 'Espalda alta', null, 'Pointillism de gran formato en la espalda alta.', 'Pointillism finalizado', 'Pointillism', 3, 1600, 1600, 'FINAL', null, 'medium', 'Grande (más de 15 cm)', 1500, 'direct', null],
            ['DEMO-C04', 'completed', 28, 21, 'rocio', 'Clavícula', 'Derecho', 'Fine line botánico finalizado.', 'Fine line finalizado', 'Fine line', 1, 1000, 1000, 'FINAL', null, 'low', 'Chico (menos de 10 cm)', 1000, 'direct', null],
            ['DEMO-R01', 'client_rejected', 30, 26, 'bruno', 'Hombro', 'Izquierdo', 'Blackwork de alto contraste en el hombro.', 'Blackwork hombro', 'Blackwork', 2, 900, null, null, null, 'low', 'Grande (más de 15 cm)', 500, 'direct', null]
        ];
        var quotesById = {};
        tables.quotations_db = QUOTES.map(function (q, i) {
            var client = clientsByKey[q[4]];
            var status = q[1];
            var created = T.daysAgo(q[2]);
            var updated = T.daysAgo(q[3]);
            var done = status === 'completed';
            var responded = status !== 'pending';
            var row = {
                id: 990001 + i, quote_id: q[0], quote_status: status, created_at: created, updated_at: updated,
                tattoo_body_part: q[5], tattoo_body_side: q[6], tattoo_idea_description: q[7], project_description: q[8],
                tattoo_style: [q[9]], tattoo_color_type: /Anime|Nouveau/.test(q[9]) ? 'Color' : 'Negro y gris',
                tattoo_size: q[16], tattoo_estimated_sessions: q[10], tattoo_is_first_tattoo: i % 4 === 0, tattoo_is_cover_up: false,
                client_full_name: client.name, client_email: client.email, client_city_residence: client.city,
                client_user_id: client.user_id, client_budget_amount: q[17], client_budget_currency: 'USD',
                client_preferred_date: q[14] != null ? T.dateOnly(q[14]) : null,
                artist_id: artistId, artist_name: artistName, artist_username: artistUsername, artist_email: artistEmail,
                artist_current_city: 'Buenos Aires', artist_session_cost_amount: 180, artist_session_cost_currency: 'USD',
                artist_budget_amount: q[11], artist_budget_currency: q[11] != null ? 'USD' : null,
                final_budget_amount: q[12], final_budget_currency: q[12] != null ? 'USD' : null,
                final_sessions: q[10], current_step: q[13], artist_availability: responded ? 'Disponible este mes' : null,
                priority: q[15], source: q[18], notes: null, is_archived: false, client_deleted_at: null,
                rating: done ? 5 : null, rating_reason: null, rating_comment: null,
                reference_images_count: q[19] != null ? 1 : 0,
                reference_images: q[19] != null ? [ASSETS + 'ref-' + pad2(q[19]) + '.svg'] : [],
                sent_to_artist_at: created,
                artist_responded_at: responded ? updated : null,
                artist_completed_at: (status === 'artist_completed' || done) ? updated : null,
                client_completed_at: done ? updated : null,
                completed_by_client_user_id: done ? client.user_id : null
            };
            quotesById[row.quote_id] = row;
            return row;
        });

        // Sesiones: cuatro turnos de hoy reproducen la agenda del Figma.
        var SESSIONS = [
            ['DEMO-D01', 1, null, -10, 3, 'completed', 'Sesión 1 · línea'],
            ['DEMO-D01', 2, '10:00', 0, 3, 'scheduled', 'Primera sesión · Brazo completo'],
            ['DEMO-D01', 3, null, 12, 3, 'scheduled', 'Sesión 3 · color'],
            ['DEMO-D02', 1, null, -15, 4, 'completed', 'Sesión 1 · boceto y línea'],
            ['DEMO-D02', 2, '13:30', 0, 2, 'scheduled', 'Sesión 2/3 · Espalda · dragón'],
            ['DEMO-D02', 3, null, 20, 3, 'scheduled', 'Sesión 3/4 · sombras'],
            ['DEMO-D03', 1, null, -21, 2.5, 'completed', 'Sesión 1 · dotwork'],
            ['DEMO-D03', 2, null, -7, 2, 'completed', 'Sesión 2 · cierre'],
            ['DEMO-D04', 1, '16:00', 0, 1, 'rescheduled', 'Retoque · Muñeca'],
            ['DEMO-D05', 1, '18:30', 0, 0.75, 'scheduled', 'Consulta · Boceto nuevo'],
            ['DEMO-D05', 2, null, 15, 3, 'scheduled', 'Sesión 1 · línea'],
            ['DEMO-C01', 1, null, -20, 3, 'completed', 'Sesión 1'],
            ['DEMO-C01', 2, null, -13, 3, 'completed', 'Sesión 2 · cierre']
        ];
        tables.quotation_sessions = SESSIONS.map(function (s, i) {
            return {
                id: 995001 + i, quotation_id: quotesById[s[0]].id, session_number: s[1],
                session_date: s[2] ? T.at(s[3], s[2]) : T.at(s[3], '11:00'),
                duration_hours: s[4], status: s[5], notes: s[6], google_event_id: null,
                created_at: T.daysAgo(30), updated_at: T.daysAgo(1)
            };
        });

        tables.quotations_attachments = QUOTES.filter(function (q) { return q[19] != null; }).map(function (q, i) {
            return {
                id: 996001 + i, quotation_id: q[0], google_drive_url: ASSETS + 'ref-' + pad2(q[19]) + '.svg',
                file_name: q[8].toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg', mime_type: 'image/svg+xml',
                attachment_type: 'reference', status: 'confirmed', sort_order: 0, created_at: T.daysAgo(q[2])
            };
        });

        var CHATS = [
            ['DEMO-P01', 'client', 'Hola, te paso más referencias del retrato. ¿Te sirven?', false, T.minutesAgo(35)],
            ['DEMO-P01', 'client', 'Si podés, me gustaría que las hojas queden bien finas.', false, T.minutesAgo(33)],
            ['DEMO-D01', 'client', 'Confirmo el turno de hoy, gracias.', false, T.minutesAgo(12)],
            ['DEMO-D02', 'client', '¿Podemos mover la sesión del viernes una hora más tarde?', false, T.hoursAgo(3)],
            ['DEMO-D02', 'artist', 'Sí, sin problema. Te confirmo el horario nuevo mañana.', true, T.hoursAgo(2)],
            ['DEMO-D04', 'artist', 'Te espero a las 16. Traé la crema que te indiqué.', true, T.daysAgo(1)],
            ['DEMO-S01', 'artist', 'Te mandé la propuesta con dos sesiones. Cualquier duda me escribís.', true, T.daysAgo(3)],
            ['DEMO-S01', 'client', 'Gracias, lo veo el fin de semana y te confirmo.', true, T.daysAgo(2)]
        ];
        tables.chat_messages = CHATS.map(function (m, i) {
            var q = quotesById[m[0]];
            return { id: 997001 + i, quotation_id: m[0], sender_type: m[1], sender_id: m[1] === 'artist' ? artistId : q.client_user_id, message: m[2], is_read: m[3], created_at: m[4] };
        });

        var HISTORY = [
            ['DEMO-D01', null, 'pending', 9, 'Cotización recibida'], ['DEMO-D01', 'pending', 'responded', 8, 'Propuesta enviada'], ['DEMO-D01', 'responded', 'client_approved', 7, 'La clienta aprobó la propuesta'],
            ['DEMO-C01', null, 'pending', 12, null], ['DEMO-C01', 'pending', 'responded', 11, null], ['DEMO-C01', 'responded', 'client_approved', 10, null], ['DEMO-C01', 'client_approved', 'artist_completed', 3, 'Trabajo terminado'], ['DEMO-C01', 'artist_completed', 'completed', 2, 'El cliente confirmó la finalización'],
            ['DEMO-S01', null, 'pending', 6, null], ['DEMO-S01', 'pending', 'responded', 3, 'Propuesta enviada'],
            ['DEMO-R01', null, 'pending', 30, null], ['DEMO-R01', 'pending', 'responded', 28, null], ['DEMO-R01', 'responded', 'client_rejected', 26, 'El cliente eligió otra propuesta'],
            ['DEMO-P01', null, 'pending', 0, 'Cotización recibida']
        ];
        tables.quotation_status_history = HISTORY.map(function (h, i) {
            var q = quotesById[h[0]];
            return { id: 998001 + i, quotation_id: q.id, quote_id: q.quote_id, old_status: h[1], new_status: h[2], changed_at: T.daysAgo(h[3]), changed_by: h[2] === 'pending' || /client/.test(h[2]) ? q.client_user_id : artistId, notes: h[4] };
        });
        tables.quotation_notes = [];
        tables.quotation_intake_extras = [];

        /* ------------------------------ job board ------------------------------ */
        var JOBS = [
            ['JB-DEMO1', 'ana', 'Lobo aullando en blackwork, antebrazo completo.', 'Lobo en blackwork', 'Antebrazo', 'Blackwork', 'Grande (más de 15 cm)', 300, 500, 4, 9, 1, true],
            ['JB-DEMO2', 'diego', 'Retrato realista de mi perro en el brazo, negro y gris.', 'Retrato de mascota', 'Brazo', 'Realismo', 'Mediano (10 a 15 cm)', 200, 350, 11, 10, 2, false],
            ['JB-DEMO3', 'flor', 'Ramas y flores en fine line que sigan la curva de las costillas.', 'Botánico en costillas', 'Costillas', 'Fine line', 'Grande (más de 15 cm)', 150, 250, 2, 11, 3, false],
            ['JB-DEMO4', 'santi', 'Manga japonesa completa: koi, olas y flores de cerezo.', 'Manga japonesa', 'Brazo completo', 'Japonés', 'Grande (más de 15 cm)', 1200, 2000, 6, 12, 4, true],
            ['JB-DEMO5', 'mica', 'Lettering fino en la muñeca con una fecha.', 'Lettering en muñeca', 'Muñeca', 'Lettering', 'Chico (menos de 10 cm)', 80, 150, 1, null, 5, false],
            ['JB-DEMO6', 'joaco', 'Cover up de un tatuaje viejo en el hombro, idealmente blackwork.', 'Cover up en hombro', 'Hombro', 'Blackwork', 'Mediano (10 a 15 cm)', 400, 700, 8, 9, 6, false]
        ];
        tables.job_board_requests = JOBS.map(function (j, i) {
            var client = clientsByKey[j[1]];
            return {
                id: uid('e1', i + 1), request_code: j[0], client_user_id: client.user_id,
                client_display_name: client.name, client_avatar_url: null,
                display_title: j[3], tattoo_idea_title: j[3], tattoo_idea_description: j[2],
                tattoo_style: [j[5]], tattoo_body_part: j[4], tattoo_body_side: null, tattoo_size: j[6],
                tattoo_color_type: j[5] === 'Japonés' ? 'Color' : 'Negro y gris', tattoo_is_first_tattoo: i === 4, tattoo_is_cover_up: i === 5,
                client_city: client.city, client_country: client.country, client_travel_willing: j[12],
                client_budget_min: j[7], client_budget_max: j[8], client_budget_currency: 'USD',
                client_preferred_date: T.dateOnly(30 + i * 7), client_flexible_dates: true,
                status: 'open', application_count: j[11], max_applications: 12, is_public: true,
                is_featured: false, featured_rank: null, feed_rank: i + 1, is_sponsored: false, sponsor_name: null, sponsor_description: null,
                featured_tags: [], featured_image_url: null, featured_slots_count: null, resulting_quote_id: null,
                created_at: T.daysAgo(j[9]), updated_at: T.daysAgo(Math.max(0, j[9] - 1)), expires_at: T.inDays(30 - j[9])
            };
        });
        tables.job_board_attachments = JOBS.filter(function (j) { return j[10] != null; }).map(function (j, i) {
            var req = tables.job_board_requests[JOBS.indexOf(j)];
            return { id: uid('e3', i + 1), request_id: req.id, file_url: ASSETS + 'ref-' + pad2(j[10]) + '.svg', file_name: 'referencia-' + (i + 1) + '.svg', sort_order: 0, created_at: req.created_at };
        });
        tables.job_board_request_stats = tables.job_board_requests.map(function (r, i) { return { request_id: r.id, view_count: 40 + i * 17, updated_at: T.hoursAgo(1) }; });
        tables.job_board_applications = [
            { id: uid('e2', 1), request_id: tables.job_board_requests[0].id, artist_id: artistId, status: 'viewed', message: 'Me encanta la idea del lobo. Lo haría en blackwork con sombras suaves y buen contraste.', estimated_price: '420 USD', estimated_sessions: 2, availability_note: 'Disponible este mes', portfolio_links: ['/artist/profile?artist=' + artistUsername], created_at: T.daysAgo(3), updated_at: T.daysAgo(2), decided_at: null, viewed_at: T.daysAgo(2) },
            { id: uid('e2', 2), request_id: tables.job_board_requests[1].id, artist_id: artistId, status: 'pending', message: 'Trabajo retratos de mascotas en realismo y puedo resolverlo en una sesión larga.', estimated_price: '320 USD', estimated_sessions: 1, availability_note: 'Fines de semana', portfolio_links: ['/artist/profile?artist=' + artistUsername], created_at: T.daysAgo(2), updated_at: T.daysAgo(2), decided_at: null, viewed_at: null }
        ];
        tables.job_board_counter_offers = [
            { id: uid('e4', 1), application_id: tables.job_board_applications[0].id, author_role: 'client', price: 380, currency: 'USD', proposed_date: T.dateOnly(21), note: '¿Podés hacerlo por 380 si te confirmo esta semana?', status: 'pendiente', created_at: T.daysAgo(1), decided_at: null }
        ];
        tables.artist_saved_job_requests = [{ artist_user_id: artistId, request_id: tables.job_board_requests[2].id, created_at: T.daysAgo(1) }];

        /* ------------------------------ estudios ------------------------------ */
        var STUDIOS = [
            ['la-aguja-negra', 'La Aguja Negra', 'Estudio de autor en Palermo', 'Buenos Aires', 'Argentina', -34.5889, -58.4306, 'Palermo, Buenos Aires', '@laagujanegra'],
            ['bang-bang-nyc', 'Bang Bang NYC', 'Residencias para artistas internacionales', 'Nueva York', 'Estados Unidos', 40.7128, -74.006, 'Manhattan, Nueva York', '@bangbangnyc'],
            ['costa-ink-collective', 'Costa Ink Collective', 'Colectivo frente al mar', 'Valparaíso', 'Chile', -33.0472, -71.6127, 'Cerro Alegre, Valparaíso', '@costaink'],
            ['zorro-rojo-tattoo', 'Zorro Rojo Tattoo', 'Guest spots todo el año', 'Barcelona', 'España', 41.3874, 2.1686, 'El Born, Barcelona', '@zorrorojotattoo']
        ];
        tables.studios = STUDIOS.map(function (s, i) {
            return {
                id: uid('a5', i + 1), slug: s[0], name: s[1], normalized_name: s[1].toLowerCase(), tagline: s[2],
                bio: s[1] + ' recibe artistas invitados y publica sus spots en We Ötzi. Datos de ejemplo del modo demo.',
                cover_image: ASSETS + 'spot-' + pad2(i + 1) + '.svg', logo_image: ASSETS + 'logo-' + pad2(i + 1) + '.svg', photo_feed_items: [],
                instagram: s[8], website: 'https://ejemplo.weotzi.demo/' + s[0], city: s[3], country: s[4],
                latitude: s[5], longitude: s[6], formatted_address: s[7], primary_location_id: uid('a6', i + 1),
                user_id: null, status: 'active', created_at: T.daysAgo(400), updated_at: T.daysAgo(3)
            };
        });
        tables.studio_locations = STUDIOS.map(function (s, i) {
            return { id: uid('a6', i + 1), studio_id: uid('a5', i + 1), label: 'Sede principal', city: s[3], country: s[4], formatted_address: s[7], latitude: s[5], longitude: s[6], is_primary: true, is_active: true, created_at: T.daysAgo(400) };
        });

        var SPOTS = [
            // studioIdx, title, kind, styles, languages, exp, housing, split, start, end, wMin, wMax, count, max, expiresIn, stipend, featured
            [0, 'Guest spot · Buenos Aires · 4 semanas', 'guest_spot', ['Fine line', 'Blackwork'], ['Español'], 2, false, 70, 20, 48, 2, 4, 4, 20, 25, null, true],
            [1, 'Residency · Nueva York · 3 a 6 meses', 'resident', ['Realismo', 'Fine line'], ['Inglés'], 3, true, 60, 45, 135, 12, 24, 11, 15, 30, 1500, false],
            [2, 'Guest spot · Valparaíso · 2 semanas', 'guest_spot', ['Blackwork', 'Dotwork'], ['Español'], 1, true, 65, 12, 26, 1, 2, 2, 10, 3, null, false],
            [3, 'Guest spot · Barcelona · 3 semanas', 'guest_spot', ['Japonés', 'Realismo'], ['Español', 'Inglés'], 3, false, 70, 19, 40, 2, 3, 6, 12, 10, null, false]
        ];
        tables.studio_spots = SPOTS.map(function (s, i) {
            var studio = tables.studios[s[0]];
            return {
                id: uid('b1', i + 1), studio_id: studio.id, location_id: studio.primary_location_id,
                title: s[1], kind: s[2], description: 'Buscamos artistas con estilo propio para ' + s[1].toLowerCase() + '. Estación completa, difusión en redes y agenda compartida con el estudio.',
                styles_wanted: s[3], language_requirements: s[4], experience_min_years: s[5], includes_housing: s[6],
                revenue_split_pct: s[7], stipend_amount: s[15], stipend_currency: s[15] ? 'USD' : null, stipend_frequency: s[15] ? 'mensual' : null,
                start_date: T.dateOnly(s[8]), end_date: T.dateOnly(s[9]), weeks_minimum: s[10], weeks_maximum: s[11],
                application_count: s[12], max_applications: s[13], expires_at: T.inDays(s[14]), status: 'open',
                cover_image: studio.cover_image, is_featured: s[16], featured_rank: s[16] ? 1 : null, directory_rank: i + 1,
                studio_includes: ['Camilla y estación propia', 'Insumos básicos', 'Difusión en redes del estudio'],
                artist_expectations: ['Portfolio actualizado', 'Agenda propia de al menos el 60%'],
                minimum_requirements: [s[5] + ' años de experiencia', 'Certificado de bioseguridad vigente'],
                contact_name: ['Marina Paz', 'Chris Lee', 'Paula Herrera', 'Marc Vidal'][i], contact_title: 'Manager', response_sla_label: 'Responde en 48 h',
                created_at: T.daysAgo(10 + i * 3), updated_at: T.daysAgo(1)
            };
        });
        tables.studio_spot_attachments = tables.studio_spots.map(function (s, i) {
            return { id: uid('b3', i + 1), spot_id: s.id, file_name: 'portada.svg', file_url: s.cover_image, mime_type: 'image/svg+xml', sort_order: 0, created_at: s.created_at };
        });
        function daterange(startIso, endIso) { return '[' + startIso + ',' + endIso + ']'; }
        tables.studio_spot_applications = [
            { id: uid('b2', 1), spot_id: tables.studio_spots[0].id, artist_user_id: artistId, message: 'Me interesa el guest spot y tengo disponibilidad completa para esas fechas.', portfolio_url: '/artist/profile?artist=' + artistUsername, requested_dates: daterange(tables.studio_spots[0].start_date, tables.studio_spots[0].end_date), status: 'pending', created_at: T.daysAgo(3), decided_at: null },
            { id: uid('b2', 2), spot_id: tables.studio_spots[1].id, artist_user_id: artistId, message: 'Quiero sumarme a la residencia y puedo trabajar en inglés sin problema.', portfolio_url: '/artist/profile?artist=' + artistUsername, requested_dates: daterange(tables.studio_spots[1].start_date, tables.studio_spots[1].end_date), status: 'shortlisted', created_at: T.daysAgo(6), decided_at: T.daysAgo(2) }
        ];
        tables.studio_spot_counter_offers = [
            { id: uid('b4', 1), application_id: tables.studio_spot_applications[1].id, author_role: 'studio', split_pct: 65, proposed_start_date: T.dateOnly(50), proposed_end_date: T.dateOnly(170), note: 'Podemos subir el reparto al 65% si te sumás por cuatro meses.', status: 'pending', created_at: T.daysAgo(1), decided_at: null }
        ];

        tables.studio_artist_memberships = [
            { id: uid('d1', 1), studio_id: tables.studios[0].id, artist_user_id: artistId, role: 'guest', status: 'pending_acceptance', location_id: tables.studios[0].primary_location_id, invited_at: T.minutesAgo(20), started_at: null, ended_at: null, revenue_split_pct: 70, notes: 'Te invitamos como guest artist para la temporada de primavera. Tenemos estación libre y agenda de clientes que buscan tu estilo.', created_at: T.minutesAgo(20), updated_at: T.minutesAgo(20) },
            { id: uid('d1', 2), studio_id: tables.studios[2].id, artist_user_id: artistId, role: 'guest', status: 'active', location_id: tables.studios[2].primary_location_id, invited_at: T.daysAgo(48), started_at: T.daysAgo(40), ended_at: null, revenue_split_pct: 65, notes: 'Guest spot de dos semanas con opción a repetir.', created_at: T.daysAgo(48), updated_at: T.daysAgo(40) },
            { id: uid('d1', 3), studio_id: tables.studios[1].id, artist_user_id: artistId, role: 'guest', status: 'rejected', location_id: tables.studios[1].primary_location_id, invited_at: T.daysAgo(22), started_at: null, ended_at: T.daysAgo(15), revenue_split_pct: 55, notes: 'Guest spot de un mes en Manhattan.', created_at: T.daysAgo(22), updated_at: T.daysAgo(15) }
        ];
        tables.studio_membership_invitation_details = [
            { membership_id: uid('d1', 1), is_featured: true, styles: ['Fine line', 'Blackwork'], response_due_at: T.inDays(7), proposed_start_date: T.dateOnly(30), duration_label: '4 semanas', benefits: ['Reparto 70/30 a tu favor', 'Difusión en redes del estudio', 'Clientes del estudio con agenda abierta'], studio_provides: ['Estación completa', 'Insumos básicos', 'Recepción y cobros'], artist_expectations: ['Portfolio actualizado', 'Agenda propia de al menos el 60%'], requirements: ['Certificado de bioseguridad', 'Monotributo o factura'], acceptance_steps: ['Aceptá la invitación', 'Coordiná fechas con Marina', 'Firmá el acuerdo de guest'], contact_name: 'Marina Paz', contact_email: 'marina@ejemplo.weotzi.demo', contact_title: 'Manager', message: 'Vimos tu trabajo en fine line y creemos que encaja perfecto con nuestra clientela de primavera.', created_at: T.minutesAgo(20), updated_at: T.minutesAgo(20) }
        ];
        tables.studio_invitation_change_requests = [];

        /* -------------------------------- travel -------------------------------- */
        var TRIPS = [
            ['Barcelona', 'España', 'Europa', 19, 33, 'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null, 'Llevar máquinas de línea y cartuchos 3RL.', 'barcelona-zorro-rojo', true, 41.3874, 2.1686, 14],
            ['Madrid', 'España', 'Europa', 35, 42, 'guest_spot', 'pendiente', 'La Nave Tattoo', null, 'Confirmar fechas con el estudio.', null, false, 40.4168, -3.7038, 6],
            ['Ciudad de México', 'México', 'Norteamérica', 70, 77, 'convencion', 'planificado', null, 'Expo Tattoo México', 'Sacar pasajes con anticipación.', null, false, 19.4326, -99.1332, 21],
            ['Montevideo', 'Uruguay', 'Sudamérica', -50, -43, 'guest_spot', 'finalizado', 'Ink Society', null, 'Buena respuesta, repetir el año que viene.', null, false, -34.9011, -56.1645, 9],
            ['Lima', 'Perú', 'Sudamérica', -100, -93, 'guest_spot', 'finalizado', 'Lima Ink Studio', null, null, null, false, -12.0464, -77.0428, 5]
        ];
        tables.artist_trips = TRIPS.map(function (t, i) {
            return {
                id: uid('f1', i + 1), artist_user_id: artistId, city: t[0], country: t[1], region: t[2],
                start_date: T.dateOnly(t[3]), end_date: T.dateOnly(t[4]), trip_type: t[5], status: t[6], origin: 'manual',
                studio_name_hint: t[7], event_name: t[8], personal_notes: t[9], share_slug: t[10], share_enabled: t[11],
                latitude: t[12], longitude: t[13], interest_count: t[14], agreed_conditions: t[6] === 'confirmado' ? 'Reparto 70/30 · estación propia · 2 semanas' : null,
                created_at: T.daysAgo(30 + i * 5), updated_at: T.daysAgo(i)
            };
        });
        var barcelona = tables.artist_trips[0];
        tables.trip_checklist_items = [
            ['Comprar pasajes', true, false], ['Confirmar estudio', true, false], ['Preparar insumos', false, false], ['Publicar agenda del viaje', false, true]
        ].map(function (c, i) { return { id: uid('f3', i + 1), trip_id: barcelona.id, label: c[0], is_done: c[1], is_custom: c[2], sort_order: i + 1, created_at: barcelona.created_at }; });
        tables.trip_events = [
            ['creado', 'Viaje creado', 14], ['estudio_confirmado', 'Zorro Rojo Tattoo confirmó el guest spot', 10], ['nota', 'Agenda de Barcelona abierta', 6]
        ].map(function (e, i) { return { id: uid('f4', i + 1), trip_id: barcelona.id, event_type: e[0], detail: e[1], event_date: T.dateOnly(-e[2]), created_at: T.daysAgo(e[2]) }; });
        tables.trip_studio_links = [
            { id: uid('f2', 1), trip_id: barcelona.id, studio_id: tables.studios[3].id, studio_name: 'Zorro Rojo Tattoo', studio_city: 'Barcelona', status: 'confirmada', requested_at: T.daysAgo(10), resolved_at: T.daysAgo(6), contact_name: 'Marc Vidal', contact_details: 'marc@ejemplo.weotzi.demo', address_snapshot: 'El Born, Barcelona', created_at: T.daysAgo(10) }
        ];
        tables.trip_documents = [];
        tables.artist_travel_passport_stamps = [
            { id: uid('f6', 1), artist_user_id: artistId, city: 'Montevideo', country: 'Uruguay', year: now.getFullYear(), tattoo_count: 9, studio_count: 1 },
            { id: uid('f6', 2), artist_user_id: artistId, city: 'Lima', country: 'Perú', year: now.getFullYear(), tattoo_count: 12, studio_count: 1 },
            { id: uid('f6', 3), artist_user_id: artistId, city: 'Santiago', country: 'Chile', year: now.getFullYear() - 1, tattoo_count: 7, studio_count: 2 }
        ];

        /* ------------------------------ calendario ------------------------------ */
        var monday = T.nextWeekday(1);
        var mondayIso = new Date(monday.getTime()).toISOString();
        var mondayEnd = new Date(monday.getTime() + DAY).toISOString();
        tables.artist_calendar_events = [
            { id: uid('a1', 1), artist_user_id: artistId, event_type: 'blocked_day', title: 'Día bloqueado · descanso', client_name: null, starts_at: mondayIso, ends_at: mondayEnd, all_day: true, location: null, notes: 'Sin turnos.', status: 'scheduled', recurrence_rule: 'none', recurrence_until: null, created_at: T.daysAgo(5), updated_at: T.daysAgo(5) },
            { id: uid('a1', 2), artist_user_id: artistId, event_type: 'personal', title: 'Turno con el dentista', client_name: null, starts_at: T.at(3, '09:00'), ends_at: T.at(3, '10:00'), all_day: false, location: 'Consultorio', notes: null, status: 'scheduled', recurrence_rule: 'none', recurrence_until: null, created_at: T.daysAgo(4), updated_at: T.daysAgo(4) },
            { id: uid('a1', 3), artist_user_id: artistId, event_type: 'reservation', title: 'Tomás Vega — reserva', client_name: 'Tomás Vega', starts_at: T.at(5, '15:00'), ends_at: T.at(5, '17:00'), all_day: false, location: 'Estudio propio', notes: 'Pieza grande en la pierna, esperando seña.', status: 'pending', recurrence_rule: 'none', recurrence_until: null, created_at: T.daysAgo(2), updated_at: T.daysAgo(2) }
        ];

        /* ------------------------------- visitas ------------------------------- */
        var rnd = prng(20260903);
        var ARTWORKS = [['ref-01', 'Manga floral'], ['ref-02', 'Dragón espalda'], ['ref-03', 'Mandala geométrico'], ['ref-08', 'Retrato finalizado']];
        var visits = [];
        for (var v = 0; v < 64; v++) {
            var dayBack = Math.floor(Math.pow(rnd(), 1.6) * 30);
            var c = CITIES[Math.floor(rnd() * CITIES.length)];
            var kindRoll = rnd();
            var kind = kindRoll < 0.6 ? 'profile_view' : kindRoll < 0.85 ? 'portfolio_view' : 'artwork_view';
            var typeRoll = rnd();
            var visitorType = typeRoll < 0.42 ? 'client' : typeRoll < 0.52 ? 'studio' : null;
            var who = visitorType === 'client' ? clients[Math.floor(rnd() * clients.length)] : null;
            var studioWho = visitorType === 'studio' ? tables.studios[Math.floor(rnd() * tables.studios.length)] : null;
            var art = kind === 'artwork_view' ? ARTWORKS[Math.floor(rnd() * ARTWORKS.length)] : null;
            var at = new Date(now.getTime() - dayBack * DAY - Math.floor(rnd() * 14 + 8) * 3600000).toISOString();
            visits.push({
                id: uid('a2', v + 1), artist_id: artistId, artist_username: artistUsername, event_kind: kind,
                country: c.country, city: c.city, latitude: c.lat + (rnd() - 0.5) * 0.08, longitude: c.lng + (rnd() - 0.5) * 0.08,
                device_type: rnd() < 0.68 ? 'mobile' : 'desktop', os: rnd() < 0.5 ? 'iOS' : 'Android', browser: rnd() < 0.6 ? 'Chrome' : 'Safari',
                created_at: at, ip_hash: 'h' + Math.floor(rnd() * 900 + 100), device_fingerprint: 'fp' + Math.floor(rnd() * 9000 + 1000),
                visitor_user_id: who ? who.user_id : null, visitor_display_name: who ? who.name : studioWho ? studioWho.name : null,
                visitor_type: visitorType, visitor_city: who ? who.city : studioWho ? studioWho.city : null,
                visitor_interests: who ? [QUOTES[Math.floor(rnd() * QUOTES.length)][9]] : [],
                artwork_key: art ? art[0] : null, artwork_title: art ? art[1] : null, requested_quote: who ? rnd() < 0.3 : false
            });
        }
        visits.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        tables.artist_profile_visits = visits;

        /* -------------------------------- reseñas -------------------------------- */
        tables.verified_reviews = [
            ['DEMO-C01', 'martin', 5, 'Una experiencia excelente y un trabajo impecable. Cuidó cada detalle del retrato.', ['trato', 'resultado', 'puntualidad'], 2],
            ['DEMO-C02', 'paula', 5, 'El dotwork quedó exactamente como lo imaginé. Muy prolija y clara con los cuidados.', ['resultado', 'higiene'], 11],
            ['DEMO-C04', 'rocio', 4, 'Líneas finísimas y muy buen ojo para la composición. Repetiría sin dudar.', ['resultado', 'trato'], 20]
        ].map(function (r, i) {
            var q = quotesById[r[0]];
            var client = clientsByKey[r[1]];
            return {
                id: uid('a7', i + 1), context_type: 'quotation', quotation_id: q.id, reviewer_type: 'client', reviewer_user_id: client.user_id,
                reviewer_display_name: client.name, reviewer_country: client.country, reviewee_type: 'artist', reviewee_user_id: artistId,
                reviewee_display_name: artistName, rating: r[2], comment: r[3], tags: r[4], photo_urls: [], highlights: [],
                moderation_status: 'approved', approved_at: T.daysAgo(r[5]), is_public: true, response: null, response_status: null,
                created_at: T.daysAgo(r[5]), updated_at: T.daysAgo(r[5])
            };
        });

        /* --------------------------------- inbox --------------------------------- */
        // Categorías del check constraint de inbox_threads (migración 20260829153500):
        // clients · quotations · support · invitations · spots · job_board · studios · trips
        var THREADS = [
            // categoría, contraparte, iniciales, asunto, contexto, último mensaje, hace (min), sin leer, prioridad, favorito, context_type
            ['spots', 'Costa Ink Collective', 'CI', 'Guest spot · Valparaíso', { spot_title: 'Guest spot · Valparaíso · 2 semanas', city: 'Valparaíso', dates: T.dateOnly(12) + ' → ' + T.dateOnly(26) }, '¿Podés confirmar si llegás el lunes o el martes? Te reservamos la estación de la ventana.', 25, 1, true, false, 'studio_spot'],
            ['support', 'Soporte We Ötzi', 'WO', 'Verificación de perfil', { ticket: 'SOP-1042' }, 'Recibimos tus documentos. En 48 h te confirmamos la verificación.', 190, 1, false, false, 'support'],
            ['invitations', 'La Aguja Negra', 'LA', 'Invitación · guest artist de primavera', { studio: 'La Aguja Negra', role: 'guest', split: '70/30' }, 'Te mandamos la invitación formal con las condiciones. Cualquier duda, acá estamos.', 20, 0, false, false, 'studio_membership'],
            ['studios', 'Zorro Rojo Tattoo', 'ZR', 'Guest spot Barcelona · logística', { studio: 'Zorro Rojo Tattoo', city: 'Barcelona' }, 'Perfecto, te esperamos el 22. Traé tu portfolio impreso para la vidriera.', 60 * 26, 0, false, false, 'studio'],
            ['spots', 'Bang Bang NYC', 'BB', 'Residency · Nueva York', { spot_title: 'Residency · Nueva York · 3 a 6 meses', city: 'Nueva York' }, 'Quedaste en la lista corta. Te contamos novedades la semana que viene.', 60 * 50, 0, false, true, 'studio_spot'],
            ['trips', 'Expo Tattoo México', 'EM', 'Stand y acreditación', { city: 'Ciudad de México', event: 'Expo Tattoo México' }, 'Tu acreditación de artista quedó confirmada. Te mandamos el mapa del predio.', 60 * 80, 0, false, false, 'artist_trip']
        ];
        tables.inbox_threads = THREADS.map(function (t, i) {
            return {
                id: uid('a3', i + 1), artist_user_id: artistId, category: t[0], context_type: t[10], context_id: null,
                counterparty_user_id: null, counterparty_name: t[1], counterparty_initials: t[2], subject: t[3], context: t[4],
                status: 'open', is_priority: t[8], last_message: t[5], last_message_at: T.minutesAgo(t[6]), last_sender_user_id: null,
                is_favorite: t[9], is_archived: false, unread_count: t[7], created_at: T.minutesAgo(t[6] + 60 * 24 * 3), updated_at: T.minutesAgo(t[6])
            };
        });
        var MESSAGES = [
            [0, 'counterparty', 'Hola. Vimos tu postulación al guest spot y nos encantó tu blackwork.', 60 * 24 * 2],
            [0, 'artist', 'Gracias. Tengo disponibilidad completa para esas fechas.', 60 * 24 * 2 - 30],
            [0, 'counterparty', '¿Podés confirmar si llegás el lunes o el martes? Te reservamos la estación de la ventana.', 25],
            [1, 'artist', 'Hola, subí los documentos de verificación. ¿Cuánto tarda la revisión?', 60 * 5],
            [1, 'counterparty', 'Recibimos tus documentos. En 48 h te confirmamos la verificación.', 190],
            [2, 'counterparty', 'Te mandamos la invitación formal con las condiciones. Cualquier duda, acá estamos.', 20],
            [3, 'artist', 'Confirmo que llego el 22 y me quedo dos semanas.', 60 * 28],
            [3, 'counterparty', 'Perfecto, te esperamos el 22. Traé tu portfolio impreso para la vidriera.', 60 * 26],
            [4, 'counterparty', 'Quedaste en la lista corta. Te contamos novedades la semana que viene.', 60 * 50],
            [5, 'counterparty', 'Tu acreditación de artista quedó confirmada. Te mandamos el mapa del predio.', 60 * 80]
        ];
        tables.inbox_messages = MESSAGES.map(function (m, i) {
            return {
                id: uid('a4', i + 1), thread_id: tables.inbox_threads[m[0]].id, sender_user_id: m[1] === 'artist' ? artistId : null,
                sender_role: m[1] === 'artist' ? 'artist' : (tables.inbox_threads[m[0]].category === 'support' ? 'support' : 'studio'),
                body: m[2], message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null,
                client_nonce: null, created_at: T.minutesAgo(m[3])
            };
        });
        tables.support_conversations = [];
        tables.support_messages = [];

        /* ------------------------------- cuenta ------------------------------- */
        tables.user_preferences = [{
            user_id: artistId,
            notification_prefs: { quote_new: { email: true, push: false, sms: false }, message_new: { email: true, push: true, sms: false }, session_reminder: { email: true, push: true, sms: false }, invitation_new: { email: true, push: false, sms: false } },
            privacy: { show_city: true, show_socials: true, allow_search_indexing: true, show_price: true },
            app_settings: {
                reminders: [
                    { text: 'Reponer tinta negra', type: 'stock', done: false },
                    { text: 'Enviar boceto a Camila', type: 'sketch', done: false },
                    { text: 'Responder WhatsApp de Nico', type: 'message', done: false },
                    { text: 'Cobrar saldo · Mateo', type: 'payment', done: false }
                ],
                dashboard_activity: [
                    { text: 'Sofía confirmó su turno', type: 'confirmation', created_at: T.minutesAgo(12) },
                    { text: 'Pago recibido · Mateo · $180', type: 'payment', created_at: T.hoursAgo(1) },
                    { text: 'Nueva cotización de Camila Soto', type: 'quote', created_at: T.hoursAgo(2) },
                    { text: 'Reseña 5★ de Martín Aguirre', type: 'review', created_at: T.daysAgo(1) }
                ],
                working_days: ['lun', 'mar', 'mie', 'jue', 'vie'],
                timezone: 'America/Argentina/Buenos_Aires', currency: 'USD', language: 'es'
            },
            updated_at: T.daysAgo(1)
        }];
        tables.artist_billing_profiles = [{ artist_user_id: artistId, legal_name: artistName, tax_id: '20-12345678-9', updated_at: T.daysAgo(20) }];
        tables.artist_payment_methods = [
            { id: uid('a8', 1), artist_user_id: artistId, provider: 'mercado_pago', method_type: 'wallet', provider_reference: 'demo-mp-1', display_name: 'Mercado Pago', brand: null, last_four: null, account_hint: artistEmail, metadata_json: {}, is_default: true, active: true, created_at: T.daysAgo(60), updated_at: T.daysAgo(60) },
            { id: uid('a8', 2), artist_user_id: artistId, provider: 'bank_transfer', method_type: 'bank_account_token', provider_reference: 'demo-bank-1', display_name: 'Cuenta bancaria', brand: null, last_four: '4821', account_hint: 'CBU ···· 4821', metadata_json: {}, is_default: false, active: true, created_at: T.daysAgo(45), updated_at: T.daysAgo(45) }
        ];
        tables.artist_financial_entries = [
            ['income', 'Seña · Mateo Ruiz', 180, 1 / 24], ['income', 'Retrato realista · Martín Aguirre', 1240, 2], ['fee', 'Comisión de plataforma', -62, 2],
            ['payout', 'Transferencia a cuenta ···· 4821', -1178, 1.5], ['income', 'Ornamental · Paula Giménez', 980, 11], ['income', 'Fine line botánico · Rocío Cabrera', 1000, 21]
        ].map(function (e, i) { return { id: uid('a9', i + 1), artist_user_id: artistId, entry_type: e[0], title: e[1], amount: e[2], currency: 'USD', status: 'completed', occurred_at: T.daysAgo(e[3]), external_reference: null, metadata_json: {}, created_at: T.daysAgo(e[3]) }; });
        tables.artist_account_sessions = [
            { id: uid('aa', 1), artist_user_id: artistId, auth_session_id: uid('aa', 91), device_name: 'Este dispositivo', browser: 'Chrome', operating_system: 'Windows', city: 'Buenos Aires', country: 'Argentina', user_agent_hash: 'ua1', first_seen_at: T.daysAgo(30), last_seen_at: T.minutesAgo(1), revoked_at: null, revoke_reason: null },
            { id: uid('aa', 2), artist_user_id: artistId, auth_session_id: uid('aa', 92), device_name: 'iPhone', browser: 'Safari', operating_system: 'iOS', city: 'Buenos Aires', country: 'Argentina', user_agent_hash: 'ua2', first_seen_at: T.daysAgo(12), last_seen_at: T.daysAgo(2), revoked_at: null, revoke_reason: null }
        ];
        tables.artist_integration_connections = [
            { id: uid('ab', 1), artist_user_id: artistId, provider: 'instagram', status: 'connected', account_label: '@' + artistUsername.replace(/\.wo$/, ''), provider_reference: 'demo-ig', scopes: ['media'], metadata_json: {}, connected_at: T.daysAgo(40), updated_at: T.daysAgo(40) },
            { id: uid('ab', 2), artist_user_id: artistId, provider: 'google_calendar', status: 'disconnected', account_label: null, provider_reference: null, scopes: [], metadata_json: {}, connected_at: null, updated_at: T.daysAgo(40) },
            { id: uid('ab', 3), artist_user_id: artistId, provider: 'whatsapp_business', status: 'pending', account_label: null, provider_reference: null, scopes: [], metadata_json: {}, connected_at: null, updated_at: T.daysAgo(3) }
        ];
        tables.artist_account_deletion_requests = [];
        tables.artist_verification_documents = [];

        /* -------------------------------- vistas -------------------------------- */
        var views = {
            chat_threads: function (store) {
                var msgs = store.rows('chat_messages');
                return store.rows('quotations_db').filter(function (q) { return q.client_user_id != null; }).map(function (q) {
                    var mine = msgs.filter(function (m) { return String(m.quotation_id) === String(q.quote_id); });
                    if (!mine.length) return null;
                    var last = mine.reduce(function (a, b) { return a.created_at > b.created_at ? a : b; });
                    return {
                        quote_id: q.quote_id, quotation_id_int: q.id, artist_id: q.artist_id, artist_name: q.artist_name, artist_username: q.artist_username,
                        client_user_id: q.client_user_id, client_full_name: q.client_full_name, client_email: q.client_email, quote_status: q.quote_status,
                        tattoo_body_part: q.tattoo_body_part, tattoo_style: q.tattoo_style, tattoo_size: q.tattoo_size,
                        final_budget_amount: q.final_budget_amount, final_budget_currency: q.final_budget_currency, source: q.source,
                        last_message: last.message, last_message_sender: last.sender_type, last_message_at: last.created_at,
                        unread_for_artist: mine.filter(function (m) { return m.sender_type === 'client' && !m.is_read; }).length,
                        unread_for_client: mine.filter(function (m) { return m.sender_type === 'artist' && !m.is_read; }).length
                    };
                }).filter(Boolean);
            },
            public_review_summary: function (store) {
                var groups = {};
                store.rows('verified_reviews').forEach(function (r) {
                    if (r.moderation_status !== 'approved' || !r.is_public) return;
                    var key = r.reviewee_type + ':' + r.reviewee_user_id;
                    var g = groups[key] || (groups[key] = { reviewee_user_id: r.reviewee_user_id, reviewee_type: r.reviewee_type, review_count: 0, sum: 0 });
                    g.review_count += 1; g.sum += Number(r.rating) || 0;
                });
                return Object.keys(groups).map(function (k) {
                    var g = groups[k];
                    return { reviewee_user_id: g.reviewee_user_id, reviewee_type: g.reviewee_type, average_rating: Math.round((g.sum / g.review_count) * 10) / 10, review_count: g.review_count };
                });
            },
            artist_profile_visits_daily: function (store) {
                var groups = {};
                store.rows('artist_profile_visits').forEach(function (vis) {
                    var day = String(vis.created_at).slice(0, 10);
                    var key = [vis.artist_id, day, vis.event_kind, vis.country, vis.city, vis.device_type].join('|');
                    var g = groups[key] || (groups[key] = { artist_id: vis.artist_id, artist_username: vis.artist_username, day: day, event_kind: vis.event_kind, country: vis.country, city: vis.city, device_type: vis.device_type, visits_count: 0, ips: {} });
                    g.visits_count += 1; g.ips[vis.ip_hash] = true;
                });
                return Object.keys(groups).map(function (k) {
                    var g = groups[k];
                    return { artist_id: g.artist_id, artist_username: g.artist_username, day: g.day, event_kind: g.event_kind, country: g.country, city: g.city, device_type: g.device_type, visits_count: g.visits_count, unique_visitors: Object.keys(g.ips).length };
                });
            },
            artist_artwork_view_counts: function (store) {
                var groups = {};
                store.rows('artist_profile_visits').forEach(function (vis) {
                    if (!vis.artwork_key) return;
                    var g = groups[vis.artwork_key] || (groups[vis.artwork_key] = { artist_id: vis.artist_id, artwork_key: vis.artwork_key, artwork_title: vis.artwork_title, views_count: 0, last_viewed_at: vis.created_at });
                    g.views_count += 1; if (vis.created_at > g.last_viewed_at) g.last_viewed_at = vis.created_at;
                });
                return Object.keys(groups).map(function (k) { return groups[k]; });
            }
        };

        /* --------------------------------- RPCs --------------------------------- */
        function threadShape(t) {
            return {
                id: t.id, category: t.category, context_type: t.context_type, context_id: t.context_id,
                counterparty_name: t.counterparty_name, counterparty_initials: t.counterparty_initials, subject: t.subject,
                context: t.context, status: t.status, is_priority: t.is_priority, last_message: t.last_message,
                last_message_at: t.last_message_at, last_sender_user_id: t.last_sender_user_id,
                is_favorite: t.is_favorite, is_archived: t.is_archived, unread_count: t.unread_count
            };
        }
        function findThread(store, id) { return store.rows('inbox_threads').find(function (t) { return t.id === id; }) || null; }
        function findTrip(store, id) { return store.rows('artist_trips').find(function (t) { return t.id === id; }) || null; }
        function nowIso() { return new Date().toISOString(); }
        function tripEvent(store, tripId, type, detail) {
            store.insert('trip_events', [{ trip_id: tripId, event_type: type, detail: detail, event_date: nowIso().slice(0, 10) }]);
        }
        var rpcs = {
            list_artist_inbox_threads: function (args, store, ctx) {
                return store.rows('inbox_threads').filter(function (t) { return !t.artist_user_id || !ctx.userId || t.artist_user_id === ctx.userId; })
                    .sort(function (a, b) { return a.last_message_at < b.last_message_at ? 1 : -1; }).map(threadShape);
            },
            send_inbox_message: function (args, store, ctx) {
                var thread = findThread(store, args.p_thread_id);
                if (!thread) return null;
                var row = store.insert('inbox_messages', [{
                    thread_id: thread.id, sender_user_id: ctx.userId, sender_role: 'artist', body: args.p_body || null,
                    message_kind: args.p_attachment_path ? 'attachment' : 'text', attachment_path: args.p_attachment_path || null,
                    attachment_name: args.p_attachment_name || null, attachment_mime: args.p_attachment_mime || null,
                    attachment_size: args.p_attachment_size || null, client_nonce: args.p_client_nonce || null
                }])[0];
                thread.last_message = row.body || row.attachment_name || 'Adjunto';
                thread.last_message_at = row.created_at; thread.last_sender_user_id = ctx.userId; thread.updated_at = row.created_at;
                return row;
            },
            mark_inbox_thread_read: function (args, store) {
                var thread = findThread(store, args.p_thread_id);
                if (thread) thread.unread_count = 0;
                return null;
            },
            set_inbox_thread_flags: function (args, store) {
                var thread = findThread(store, args.p_thread_id);
                if (!thread) return null;
                if (args.p_is_favorite != null) thread.is_favorite = !!args.p_is_favorite;
                if (args.p_is_archived != null) thread.is_archived = !!args.p_is_archived;
                return threadShape(thread);
            },
            increment_job_request_views: function (args, store) {
                var stat = store.rows('job_board_request_stats').find(function (s) { return s.request_id === args.p_request_id; });
                if (stat) stat.view_count += 1;
                return null;
            },
            check_artist_calendar_conflicts: function (args, store) {
                var start = Date.parse(args.p_starts_at), end = Date.parse(args.p_ends_at);
                if (isNaN(start) || isNaN(end)) return [];
                return store.rows('artist_calendar_events').filter(function (e) {
                    if (e.status === 'cancelled' || e.id === args.p_exclude_event_id) return false;
                    return Date.parse(e.starts_at) < end && Date.parse(e.ends_at) > start;
                }).map(function (e) { return { id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, event_type: e.event_type }; });
            },
            create_artist_trip: function (args, store, ctx) {
                var trip = store.insert('artist_trips', [{
                    artist_user_id: ctx.userId, city: args.p_city, country: args.p_country, region: args.p_region || null,
                    start_date: args.p_start_date, end_date: args.p_end_date, trip_type: args.p_trip_type || 'guest_spot',
                    status: 'planificado', origin: 'manual', studio_name_hint: args.p_studio_name_hint || null, event_name: null,
                    personal_notes: args.p_personal_notes || null, share_slug: null, share_enabled: false, latitude: null, longitude: null,
                    interest_count: 0, agreed_conditions: null, updated_at: nowIso()
                }])[0];
                ['Comprar pasajes', 'Confirmar estudio', 'Preparar insumos', 'Publicar agenda del viaje'].forEach(function (label, i) {
                    store.insert('trip_checklist_items', [{ trip_id: trip.id, label: label, is_done: false, is_custom: false, sort_order: i + 1 }]);
                });
                tripEvent(store, trip.id, 'creado', 'Viaje creado');
                return trip;
            },
            cancel_artist_trip: function (args, store) {
                var trip = findTrip(store, args.p_trip_id);
                if (!trip) return null;
                trip.status = 'cancelado'; trip.share_enabled = false; trip.updated_at = nowIso();
                tripEvent(store, trip.id, 'cancelado', args.p_reason || 'Viaje cancelado');
                return trip;
            },
            reactivate_artist_trip: function (args, store) {
                var trip = findTrip(store, args.p_trip_id);
                if (!trip) return null;
                trip.status = trip.end_date < nowIso().slice(0, 10) ? 'finalizado' : 'planificado'; trip.updated_at = nowIso();
                tripEvent(store, trip.id, 'reactivado', 'Viaje reactivado');
                return trip;
            },
            update_artist_trip_dates: function (args, store) {
                var trip = findTrip(store, args.p_trip_id);
                if (!trip) return null;
                trip.start_date = args.p_start_date; trip.end_date = args.p_end_date; trip.updated_at = nowIso();
                tripEvent(store, trip.id, 'fechas', 'Fechas actualizadas: ' + args.p_start_date + ' → ' + args.p_end_date);
                return trip;
            },
            request_trip_studio_link: function (args, store) {
                var trip = findTrip(store, args.p_trip_id);
                var studio = store.rows('studios').find(function (s) { return s.id === args.p_studio_id; });
                if (!trip) return null;
                var link = store.insert('trip_studio_links', [{
                    trip_id: trip.id, studio_id: args.p_studio_id, studio_name: studio ? studio.name : 'Estudio', studio_city: studio ? studio.city : trip.city,
                    status: 'pendiente', requested_at: nowIso(), resolved_at: null, contact_name: null, contact_details: null, address_snapshot: studio ? studio.formatted_address : null
                }])[0];
                tripEvent(store, trip.id, 'estudio_solicitado', 'Solicitud enviada a ' + link.studio_name);
                return link;
            },
            create_studio_spot_counter_offer: function (args, store) {
                var offer = store.insert('studio_spot_counter_offers', [{
                    application_id: args.p_application_id, author_role: args.p_author_role || 'artist', split_pct: args.p_split_pct || null,
                    proposed_start_date: args.p_proposed_start_date || null, proposed_end_date: args.p_proposed_end_date || null,
                    note: args.p_note || null, status: 'pending', decided_at: null
                }])[0];
                return { success: true, offer: offer, offer_id: offer.id };
            },
            respond_to_studio_spot_counter_offer: function (args, store) {
                var offer = store.rows('studio_spot_counter_offers').find(function (o) { return o.id === args.p_offer_id; });
                if (!offer) return { success: false, message: 'Contraoferta no encontrada' };
                offer.status = /accept/i.test(args.p_action || '') ? 'accepted' : 'rejected'; offer.decided_at = nowIso();
                return { success: true, status: offer.status };
            },
            respond_to_studio_invitation: function (args, store) {
                var m = store.rows('studio_artist_memberships').find(function (x) { return x.id === args.p_membership_id; });
                if (!m) return { success: false, message: 'Invitación no encontrada' };
                var accept = /accept/i.test(args.p_action || '');
                m.status = accept ? 'active' : 'rejected'; m.updated_at = nowIso();
                if (accept) m.started_at = nowIso(); else m.ended_at = nowIso();
                return { success: true, status: m.status };
            },
            request_studio_invitation_changes: function (args, store, ctx) {
                store.insert('studio_invitation_change_requests', [{ membership_id: args.p_membership_id, artist_user_id: ctx.userId, message: args.p_message || '', status: 'pending', resolved_at: null }]);
                return { success: true };
            },
            end_studio_membership: function (args, store) {
                var m = store.rows('studio_artist_memberships').find(function (x) { return x.id === args.p_membership_id; });
                if (!m) return { success: false, message: 'Membresía no encontrada' };
                m.status = 'ended'; m.ended_at = nowIso(); m.updated_at = nowIso();
                return { success: true, status: 'ended' };
            },
            set_artist_default_payment_method: function (args, store) {
                store.rows('artist_payment_methods').forEach(function (pm) { pm.is_default = pm.id === args.p_method_id; });
                return null;
            }
        };

        return { tables: tables, relations: RELATIONS, rpcs: rpcs, views: views, clients: clients };
    }

    return { build: build, TABLES: TABLES, VIEWS: VIEWS, RELATIONS: RELATIONS, ASSETS: ASSETS };
}));
