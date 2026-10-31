/**
 * Fixtures de preview/demo · área "travel-inbox" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Travel (frames 801:1076–801:1084): ocho viajes con el reparto del Figma
 * (2 confirmados · 3 pendientes · 3 finalizados), Barcelona como próximo
 * destino con vínculo pendiente, checklist canónica de 10 tareas, documentos,
 * cronología y Tattoo Passport. Las RPC de Travel se alinean con el contrato
 * real (20260830013000_secure_travel_data_contract.sql) y se agrega
 * get_public_travel_share para que /travel/t/<slug> funcione en el preview.
 *
 * Inbox (frame 801:1085): hilos de todas las categorías del sidebar
 * (clientes, cotizaciones, invitaciones, spots, job board, estudios, viajes,
 * archivados) sin tocar los hilos base que usan otras áreas.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['travel-inbox'] = function (ctx) {
        var tables = ctx.tables || {};
        var rpcs = ctx.rpcs || {};
        var now = new Date();
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;

        function pad2(n) { return (n < 10 ? '0' : '') + n; }
        function dateOnly(offset) {
            var d = new Date(now.getTime()); d.setDate(d.getDate() + offset);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }
        function daysAgo(n) { return new Date(now.getTime() - n * DAY).toISOString(); }
        function minutesAgo(n) { return new Date(now.getTime() - n * 60000).toISOString(); }
        function at(dayOffset, hhmm) {
            var d = new Date(now.getTime()); d.setDate(d.getDate() + dayOffset);
            var p = hhmm.split(':'); d.setHours(parseInt(p[0], 10), parseInt(p[1], 10) || 0, 0, 0);
            return d.toISOString();
        }
        function id(prefix, n) {
            var tail = String(n);
            while (tail.length < 10) tail = '0' + tail;
            return '0000c0de-0000-4000-8000-' + prefix + tail;
        }
        function nowIso() { return new Date().toISOString(); }

        var artistId = (ctx.identity && ctx.identity.userId)
            || ((tables.artist_trips || [])[0] || {}).artist_user_id
            || ((tables.inbox_threads || [])[0] || {}).artist_user_id
            || null;

        /* =============================== TRAVEL =============================== */
        var studios = tables.studios || [];
        var zorro = studios.find(function (s) { return s.slug === 'zorro-rojo-tattoo'; }) || studios[3] || null;

        var CHECKLIST = ['Pasajes comprados', 'Hospedaje reservado', 'Estudio confirmado', 'Contacté al estudio',
            'Agenda recibida', 'Equipos preparados', 'Materiales de trabajo listos', 'Documentación preparada',
            'Seguro de viaje', 'Equipaje listo'];

        // ciudad, país, región, inicio (días desde hoy), duración, tipo, estado,
        // estudio/evento, notas, slug, interesados, clima, lat, lng
        var TRIPS = [
            ['Barcelona', 'España', 'europa', 39, 7, 'guest_spot', 'confirmado', 'Zorro Rojo Tattoo', null,
                'Llevar flash sheets nuevos y stencils impresos — la impresora del estudio es lenta.', 'barcelona-zorro-rojo', 12, 28, 41.3874, 2.1686],
            ['Berlín', 'Alemania', 'europa', 58, 2, 'convencion', 'confirmado', null, 'Bauhaus Ink Fest',
                'Acreditación lista. Llevar banner del stand.', null, 31, 19, 52.52, 13.405],
            ['Ciudad de México', 'México', 'norteamerica', 75, 7, 'estudio_invitado', 'pendiente', 'Estudio Cactus', null,
                'Confirmar materiales con el estudio.', null, 8, 24, 19.4326, -99.1332],
            ['Madrid', 'España', 'europa', 95, 4, 'guest_spot', 'pendiente', 'Madrid Ink Studio', null,
                'Esperando agenda del estudio.', null, 5, 17, 40.4168, -3.7038],
            ['Santiago', 'Chile', 'sudamerica', 118, 2, 'convencion', 'pendiente', null, 'Congreso Sudamericano de Tatuaje',
                null, null, 14, 22, -33.4489, -70.6693],
            ['Montevideo', 'Uruguay', 'sudamerica', -17, 7, 'guest_spot', 'finalizado', 'Ink Society', null,
                'Buena respuesta, repetir el año que viene.', 'montevideo-ink-society', 9, 14, -34.9011, -56.1645],
            ['Lima', 'Perú', 'sudamerica', -32, 7, 'guest_spot', 'finalizado', 'Lima Ink Studio', null,
                null, null, 5, 18, -12.0464, -77.0428],
            ['Barcelona', 'España', 'europa', -253, 2, 'convencion', 'finalizado', null, 'Barcelona Tattoo Expo',
                null, null, 40, 12, 41.3874, 2.1686]
        ];

        if (artistId) {
            tables.artist_trips = TRIPS.map(function (t, i) {
                return {
                    id: id('e7', i + 1), artist_user_id: artistId, city: t[0], country: t[1], region: t[2],
                    start_date: dateOnly(t[3]), end_date: dateOnly(t[3] + t[4]), trip_type: t[5], status: t[6],
                    origin: i === 1 ? 'automatico' : 'manual', studio_name_hint: t[7], event_name: t[8], personal_notes: t[9],
                    // Figma 801:1083 muestra un enlace todavía sin publicar: Barcelona tiene slug pero no está compartido.
                // Montevideo (finalizado) queda publicado para probar /travel/t/<slug> en el preview.
                share_slug: t[10], share_enabled: Boolean(t[10]) && i !== 0, latitude: t[13], longitude: t[14],
                    interested_people_count: t[11], interest_count: t[11], climate_celsius: t[12],
                    agreed_conditions: i === 0 ? 'Split 65% para el artista. Agenda garantizada de 5 días, materiales incluidos.' : null,
                    contact_name: null, contact_details: null, cancelled_at: null, cancel_reason: null,
                    created_at: daysAgo(118 - i * 3), updated_at: daysAgo(i)
                };
            });

            var barcelona = tables.artist_trips[0];
            var berlin = tables.artist_trips[1];
            var cdmx = tables.artist_trips[2];
            var madrid = tables.artist_trips[3];

            var checklistRows = [];
            CHECKLIST.forEach(function (label, i) {
                checklistRows.push({
                    id: id('e3', i + 1), trip_id: barcelona.id, label: label,
                    is_done: i === 0 || i === 1 || i === 3, is_custom: false, sort_order: i, created_at: barcelona.created_at
                });
            });
            [berlin, cdmx, madrid].forEach(function (trip, tripIndex) {
                CHECKLIST.forEach(function (label, i) {
                    checklistRows.push({
                        id: id('e3', 100 + tripIndex * 20 + i), trip_id: trip.id, label: label,
                        is_done: tripIndex === 0 && i < 4, is_custom: false, sort_order: i, created_at: trip.created_at
                    });
                });
            });
            tables.trip_checklist_items = checklistRows;

            tables.trip_studio_links = [
                {
                    id: id('e2', 1), trip_id: barcelona.id, studio_id: zorro ? zorro.id : null, studio_name: 'Zorro Rojo Tattoo',
                    studio_city: 'Barcelona', status: 'esperando_confirmacion', requested_at: daysAgo(108), resolved_at: null,
                    contact_name: 'Marc Solé', contact_details: '+34 611 222 333 · WhatsApp', address_snapshot: 'Carrer del Rec 45, Barcelona',
                    created_at: daysAgo(108)
                },
                {
                    id: id('e2', 2), trip_id: barcelona.id, studio_id: null, studio_name: 'Costa Ink Barcelona',
                    studio_city: 'Barcelona', status: 'confirmada', requested_at: daysAgo(110), resolved_at: daysAgo(108),
                    contact_name: 'Marta Vidal', contact_details: 'marta@ejemplo.weotzi.demo', address_snapshot: 'Gràcia, Barcelona',
                    created_at: daysAgo(110)
                },
                {
                    id: id('e2', 3), trip_id: barcelona.id, studio_id: null, studio_name: 'Tinta Gòtica',
                    studio_city: 'Barcelona', status: 'confirmada', requested_at: daysAgo(105), resolved_at: daysAgo(100),
                    contact_name: 'Pau Ferrer', contact_details: 'pau@ejemplo.weotzi.demo', address_snapshot: 'Barri Gòtic, Barcelona',
                    created_at: daysAgo(105)
                },
                {
                    id: id('e2', 4), trip_id: cdmx.id, studio_id: null, studio_name: 'Estudio Cactus',
                    studio_city: 'Ciudad de México', status: 'esperando_confirmacion', requested_at: daysAgo(20), resolved_at: null,
                    contact_name: 'Lucía Ramos', contact_details: '+52 55 1234 5678', address_snapshot: 'Roma Norte, Ciudad de México',
                    created_at: daysAgo(20)
                }
            ];

            tables.trip_documents = [
                ['pasaje', 'Pasaje_ida_vuelta.pdf', 100],
                ['reserva_hotel', 'Reserva_hotel_barcelona.pdf', 98],
                ['contrato', 'Acuerdo_costa_ink.pdf', 95]
            ].map(function (d, i) {
                return {
                    id: id('e4', i + 1), trip_id: barcelona.id, category: d[0], file_name: d[1],
                    storage_path: artistId + '/' + barcelona.id + '/' + d[1], created_at: daysAgo(d[2])
                };
            });

            tables.trip_events = [
                ['creado', 'Viaje creado', 118],
                ['estudio_confirmado', 'Costa Ink Barcelona', 108],
                ['pasajes_agregados', null, 100]
            ].map(function (e, i) {
                return { id: id('e5', i + 1), trip_id: barcelona.id, event_type: e[0], detail: e[1], event_date: dateOnly(-e[2]), created_at: daysAgo(e[2]) };
            }).concat([berlin, cdmx, madrid].map(function (trip, i) {
                return { id: id('e5', 20 + i), trip_id: trip.id, event_type: 'creado', detail: 'Viaje creado', event_date: trip.created_at.slice(0, 10), created_at: trip.created_at };
            }));

            tables.artist_travel_passport_stamps = [
                ['Buenos Aires', 'Argentina', now.getFullYear() - 1, 3, 2],
                ['São Paulo', 'Brasil', now.getFullYear() - 2, 1, 1],
                ['Bogotá', 'Colombia', now.getFullYear() - 3, 2, 2]
            ].map(function (s, i) {
                return { id: id('e6', i + 1), artist_user_id: artistId, city: s[0], country: s[1], year: s[2], tattoo_count: s[3], studio_count: s[4] };
            });
        }

        function findTrip(store, tripId) {
            return store.rows('artist_trips').find(function (t) { return t.id === tripId; }) || null;
        }
        function tripEvent(store, tripId, type, detail) {
            store.insert('trip_events', [{ trip_id: tripId, event_type: type, detail: detail || null, event_date: nowIso().slice(0, 10) }]);
        }

        // Contrato real: checklist canónica de 10 tareas + evento "creado".
        rpcs.create_artist_trip = function (args, store, rctx) {
            var trip = store.insert('artist_trips', [{
                artist_user_id: rctx.userId, city: args.p_city, country: args.p_country, region: args.p_region || null,
                start_date: args.p_start_date, end_date: args.p_end_date, trip_type: args.p_trip_type || 'guest_spot',
                status: 'planificado', origin: 'manual', studio_name_hint: args.p_studio_name_hint || null, event_name: null,
                personal_notes: args.p_personal_notes || null, share_slug: null, share_enabled: false, latitude: null, longitude: null,
                interested_people_count: 0, climate_celsius: null, agreed_conditions: null, updated_at: nowIso()
            }])[0];
            CHECKLIST.forEach(function (label, i) {
                store.insert('trip_checklist_items', [{ trip_id: trip.id, label: label, is_done: false, is_custom: false, sort_order: i }]);
            });
            tripEvent(store, trip.id, 'creado', 'Viaje creado');
            return trip;
        };
        rpcs.update_artist_trip_dates = function (args, store) {
            var trip = findTrip(store, args.p_trip_id);
            if (!trip) return null;
            trip.start_date = args.p_start_date; trip.end_date = args.p_end_date; trip.updated_at = nowIso();
            tripEvent(store, trip.id, 'nota', 'Fechas actualizadas · ' + args.p_start_date + ' – ' + args.p_end_date);
            return trip;
        };
        rpcs.cancel_artist_trip = function (args, store) {
            var trip = findTrip(store, args.p_trip_id);
            if (!trip) return null;
            trip.status = 'cancelado'; trip.share_enabled = false; trip.updated_at = nowIso();
            store.rows('trip_studio_links').forEach(function (link) {
                if (link.trip_id === trip.id && link.status === 'esperando_confirmacion') link.status = 'cancelada';
            });
            tripEvent(store, trip.id, 'cancelado', args.p_reason || null);
            return trip;
        };
        rpcs.reactivate_artist_trip = function (args, store) {
            var trip = findTrip(store, args.p_trip_id);
            if (!trip) return null;
            var links = store.rows('trip_studio_links').filter(function (l) { return l.trip_id === trip.id; });
            trip.status = trip.end_date < nowIso().slice(0, 10) ? 'finalizado'
                : links.some(function (l) { return l.status === 'confirmada'; }) ? 'confirmado' : 'planificado';
            trip.updated_at = nowIso();
            tripEvent(store, trip.id, 'nota', 'Viaje reactivado');
            return trip;
        };
        rpcs.request_trip_studio_link = function (args, store) {
            var trip = findTrip(store, args.p_trip_id);
            if (!trip) return null;
            var studio = store.rows('studios').find(function (s) { return s.id === args.p_studio_id; });
            var link = store.insert('trip_studio_links', [{
                trip_id: trip.id, studio_id: args.p_studio_id, studio_name: studio ? studio.name : 'Estudio',
                studio_city: studio ? studio.city : trip.city, status: 'esperando_confirmacion', requested_at: nowIso(),
                resolved_at: null, contact_name: null, contact_details: null, address_snapshot: studio ? studio.formatted_address : null
            }])[0];
            if (trip.status === 'planificado') trip.status = 'pendiente';
            return link;
        };
        // Proyección pública (whitelist) de /travel/t/<slug>: sin notas, condiciones ni contactos.
        rpcs.get_public_travel_share = function (args, store) {
            var slug = String(args.p_share_slug || '').toLowerCase();
            if (!slug) return [];
            var identity = ctx.identity || {};
            return store.rows('artist_trips').filter(function (t) {
                return t.share_enabled && t.status !== 'cancelado' && String(t.share_slug || '').toLowerCase() === slug;
            }).slice(0, 1).map(function (t) {
                return {
                    id: t.id, city: t.city, country: t.country, region: t.region, start_date: t.start_date, end_date: t.end_date,
                    trip_type: t.trip_type, status: t.status, event_name: t.event_name, share_slug: t.share_slug,
                    interested_people_count: t.interested_people_count == null ? 0 : t.interested_people_count,
                    climate_celsius: t.climate_celsius == null ? null : t.climate_celsius,
                    artist_name: identity.name || null, artist_username: identity.username || null
                };
            });
        };

        /* =============================== INBOX =============================== */
        var threads = tables.inbox_threads || (tables.inbox_threads = []);
        var messages = tables.inbox_messages || (tables.inbox_messages = []);

        // El hilo de Spot base (Costa Ink Collective) recibe el contexto exacto
        // del frame: estudio, fechas y postulación aceptada.
        var costa = threads.find(function (t) { return t.counterparty_name === 'Costa Ink Collective' && t.category === 'spots'; });
        var MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        // daterange de Postgres "[inicio,fin)" → { start, end } con fin inclusivo.
        function rangeBounds(value) {
            var m = String(value || '').match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
            if (!m) return null;
            var end = new Date(m[2] + 'T00:00:00');
            if (/\)\s*$/.test(String(value))) end.setDate(end.getDate() - 1);
            return { start: m[1], end: end.getFullYear() + '-' + pad2(end.getMonth() + 1) + '-' + pad2(end.getDate()) };
        }
        var spotApplications = tables.studio_spot_applications || [];
        var spotsById = {};
        (tables.studio_spots || []).forEach(function (spot) { spotsById[spot.id] = spot; });
        var studiosById = {};
        studios.forEach(function (studio) { studiosById[studio.id] = studio; });
        if (costa) {
            // Mismo hilo que abre "Ver conversación" en Postulaciones: fechas pedidas en la
            // postulación, ciudad y título del Spot (Residencia · Barcelona).
            var costaApp = spotApplications.find(function (a) { return a.id === costa.context_id; })
                || spotApplications.find(function (a) { var sp = spotsById[a.spot_id]; return sp && studiosById[sp.studio_id] && studiosById[sp.studio_id].name === 'Costa Ink Collective'; })
                || null;
            var costaSpot = costaApp ? spotsById[costaApp.spot_id] : null;
            var costaRange = costaApp ? rangeBounds(costaApp.requested_dates) : null;
            var costaStart = costaRange ? costaRange.start : dateOnly(34);
            var costaEnd = costaRange ? costaRange.end : dateOnly(48);
            var costaMonth = MONTHS_LONG[Number(costaStart.slice(5, 7)) - 1];
            if (costaApp) { costa.context_type = 'studio_spot_application'; costa.context_id = costaApp.id; }
            costa.subject = costaSpot ? costaSpot.title.split(' · ').slice(0, 2).join(' · ') : 'Residencia · Barcelona';
            costa.context = Object.assign({}, costa.context, {
                studio: 'Costa Ink Collective', start_date: costaStart, end_date: costaEnd,
                application_id: costaApp ? costaApp.id : null, spot_id: costaSpot ? costaSpot.id : null,
                application_status: 'accepted', dates: null, city: null, spot_title: costaSpot ? costaSpot.title : null, reply_status: 'replied'
            });
            costa.last_message = 'Perfecto, mandanos tus fechas confirmadas';
            costa.last_message_at = at(-4, '18:20');
            costa.unread_count = 0;
            costa.is_priority = false;
            var costaMessages = messages.filter(function (m) { return m.thread_id === costa.id; });
            costaMessages.forEach(function (m) { messages.splice(messages.indexOf(m), 1); });
            messages.push(
                { id: id('e8', 1), thread_id: costa.id, sender_user_id: artistId, sender_role: 'artist', body: 'Confirmo mi interés en la próxima residencia de ' + costaMonth + '.', message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: at(-4, '17:55') },
                { id: id('e8', 2), thread_id: costa.id, sender_user_id: null, sender_role: 'studio', body: 'Perfecto, mandanos tus fechas confirmadas', message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: at(-4, '18:20') }
            );
        }

        var barcelonaTrip = (tables.artist_trips || [])[0] || null;
        // categoría, contraparte, iniciales, asunto, contexto, último, cuándo, sin leer, prioridad, estado, archivado, context_type, mensajes [rol, texto]
        var EXTRA = [
            ['clients', 'Camila R.', 'CR', 'Sesión de fine line', { client: 'Camila R.', reply_status: 'waiting' }, '¿Podemos mover la sesión al sábado?', minutesAgo(35), 2, false, 'open', false, 'client',
                [['artist', 'Te confirmo el turno del viernes a las 15.'], ['counterparty', '¿Podemos mover la sesión al sábado?']]],
            ['clients', 'Rodrigo A.', 'RA', 'Retoque de brazo', { client: 'Rodrigo A.', reply_status: 'replied' }, 'Genial, ¡nos vemos el 12!', minutesAgo(240), 0, false, 'open', false, 'client',
                [['counterparty', '¿Tenés lugar el 12 para el retoque?'], ['artist', 'Sí, te anoto a las 11.'], ['counterparty', 'Genial, ¡nos vemos el 12!']]],
            ['clients', 'Valentina Cruz', 'VC', 'Tatuaje de antebrazo', { client: 'Valentina Cruz', reply_status: 'replied' }, 'Mil gracias, ¡quedó hermoso el tatuaje!', at(-3, '12:10'), 0, false, 'open', false, 'client',
                [['counterparty', 'Mil gracias, ¡quedó hermoso el tatuaje!'], ['artist', 'Gracias a vos. Acordate de la crema dos veces por día.']]],
            ['quotations', 'Bruno T.', 'BT', 'Cotización · espalda completa', { budget: '$480.000', style: 'Blackwork', reply_status: 'waiting' }, '¿Podrías bajar un poco el precio?', at(-1, '19:40'), 0, true, 'open', false, 'quotation',
                [['artist', 'Te paso la cotización: $480.000 en tres sesiones.'], ['counterparty', '¿Podrías bajar un poco el precio?']]],
            ['quotations', 'Sofía L.', 'SL', 'Cotización · mandala', { budget: '$150.000', style: 'Dotwork' }, 'Voy a seguir buscando, gracias', at(-3, '10:05'), 0, false, 'closed', false, 'quotation',
                [['artist', 'La pieza queda en $150.000 en una sesión.'], ['counterparty', 'Voy a seguir buscando, gracias']]],
            ['invitations', 'Fierro Negro Tattoo', 'FN', 'Invitación · guest de verano', { studio: 'Fierro Negro Tattoo', invitation_status: 'pending_acceptance', reply_status: 'waiting' }, 'Esperamos tu respuesta a la invitación.', minutesAgo(15), 1, false, 'open', false, 'studio_membership',
                [['counterparty', 'Esperamos tu respuesta a la invitación.']]],
            ['studios', 'Estudio Cactus', 'EC', 'Residencia en Ciudad de México', { studio: 'Estudio Cactus', city: 'Ciudad de México', reply_status: 'replied' }, 'Cualquier cosa avisanos', at(-5, '16:00'), 0, false, 'open', false, 'studio',
                [['artist', 'Gracias por la info de la residencia.'], ['counterparty', 'Cualquier cosa avisanos']]],
            ['trips', 'Marta Vidal — Costa Ink', 'MV', 'Guest spot Barcelona', { studio: 'Costa Ink Barcelona', city: 'Barcelona', country: 'España', start_date: barcelonaTrip ? barcelonaTrip.start_date : null, end_date: barcelonaTrip ? barcelonaTrip.end_date : null, reply_status: 'replied' }, 'Te esperamos el 15 en el estudio, cualquier cosa por acá', at(-2, '20:30'), 0, false, 'open', false, 'artist_trip',
                [['artist', 'Llego a Barcelona el 14 a la noche.'], ['counterparty', 'Te esperamos el 15 en el estudio, cualquier cosa por acá']]],
            ['clients', 'Julián P.', 'JP', 'Consulta cerrada', { client: 'Julián P.', reply_status: 'replied' }, 'Perfecto, quedamos así.', daysAgo(30), 0, false, 'closed', true, 'client',
                [['counterparty', 'Perfecto, quedamos así.']]]
        ];

        if (artistId) {
            EXTRA.forEach(function (t, i) {
                var threadId = id('e9', i + 1);
                var lastIsArtist = t[12].length && t[12][t[12].length - 1][0] === 'artist';
                var ctxRow = Object.assign({}, t[4]);
                if (t[11] === 'artist_trip' && barcelonaTrip) ctxRow.trip_id = barcelonaTrip.id;
                threads.push({
                    id: threadId, artist_user_id: artistId, category: t[0], context_type: t[11],
                    context_id: t[11] === 'artist_trip' && barcelonaTrip ? barcelonaTrip.id : null,
                    counterparty_user_id: null, counterparty_name: t[1], counterparty_initials: t[2], subject: t[3], context: ctxRow,
                    status: t[9], is_priority: t[8], last_message: t[5], last_message_at: t[6],
                    last_sender_user_id: lastIsArtist ? artistId : null, is_favorite: false, is_archived: t[10], unread_count: t[7],
                    created_at: daysAgo(40), updated_at: t[6]
                });
                var lastAt = Date.parse(t[6]);
                t[12].forEach(function (m, j) {
                    var stamp = new Date(lastAt - (t[12].length - 1 - j) * 47 * 60000).toISOString();
                    messages.push({
                        id: id('ea', (i + 1) * 10 + j), thread_id: threadId, sender_user_id: m[0] === 'artist' ? artistId : null,
                        sender_role: m[0] === 'artist' ? 'artist' : (t[0] === 'clients' || t[0] === 'quotations' ? 'client' : 'studio'),
                        body: m[1], message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null,
                        attachment_size: null, client_nonce: null, created_at: stamp
                    });
                });
            });
        }

        // Zorro Rojo: el hilo es el primer contacto desde Invitaciones ("me interesa hacer
        // un guest spot…"); la logística heredada del demo base ("llego el 22") lo
        // contradecía, así que se retira de ese hilo.
        var zorroThread = threads.find(function (t) { return t.category === 'studios' && t.counterparty_name === 'Zorro Rojo Tattoo'; });
        if (zorroThread) {
            // El primer contacto menciona el mes de la ventana de guest del estudio.
            var zStart = zorroThread.context && zorroThread.context.start_date;
            if (zStart) {
                var zMonth = 'en ' + MONTHS_LONG[Number(String(zStart).slice(5, 7)) - 1];
                messages.forEach(function (m) {
                    if (m.thread_id === zorroThread.id && m.body) m.body = m.body.replace('en septiembre', zMonth);
                });
                if (zorroThread.last_message) zorroThread.last_message = zorroThread.last_message.replace('en septiembre', zMonth);
            }
            for (var zi = messages.length - 1; zi >= 0; zi -= 1) {
                var zm = messages[zi];
                if (zm.thread_id === zorroThread.id && /el 22/.test(String(zm.body || ''))) messages.splice(zi, 1);
            }
        }

        // Postulaciones sin hilo: el trigger real (inbox_from_job_board_application /
        // inbox_from_spot_application) crea uno por postulación. Se replica acá para que
        // "Ver conversación" de Postulaciones abra siempre la conversación.
        var JB_MESSAGES = {
            accepted: 'Tu propuesta fue aceptada. Podés coordinar los próximos pasos por acá.',
            rejected: 'La solicitud eligió otra propuesta.',
            shortlisted: 'Tu propuesta quedó preseleccionada.',
            viewed: 'Nos encantó tu propuesta, ¿podemos coordinar una llamada?'
        };
        var SPOT_MESSAGES = {
            accepted: 'Tu postulación fue aceptada. Coordinemos las fechas confirmadas por acá.',
            rejected: 'El estudio cerró esta postulación.',
            shortlisted: 'Tu postulación quedó preseleccionada.'
        };
        function initialsOf(name) {
            var parts = String(name || '').split(/\s+/).map(function (part) { return part.replace(/[^A-Za-zÀ-ÿ]/g, ''); }).filter(Boolean);
            if (!parts.length) return '—';
            return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
        }
        function hasThreadFor(applicationId) {
            return threads.some(function (t) {
                return t.context_id === applicationId || (t.context && t.context.application_id === applicationId);
            });
        }
        function pushDomainThread(row) {
            threads.push(row.thread);
            row.messages.forEach(function (m) { messages.push(m); });
        }
        if (artistId) {
            var requestsById = {};
            (tables.job_board_requests || []).forEach(function (r) { requestsById[r.id] = r; });
            (tables.job_board_applications || []).forEach(function (app, i) {
                if (hasThreadFor(app.id)) return;
                var req = requestsById[app.request_id] || {};
                var reply = app.status === 'pending' ? null : (JB_MESSAGES[app.status] || null);
                var lastAt = reply ? (app.decided_at || app.viewed_at || app.updated_at || app.created_at) : app.created_at;
                var threadId = id('eb', i + 1);
                var waiting = app.status === 'viewed';
                pushDomainThread({
                    thread: {
                        id: threadId, artist_user_id: artistId, category: 'job_board', context_type: 'job_board_application', context_id: app.id,
                        counterparty_user_id: req.client_user_id || null, counterparty_name: req.client_display_name || 'Cliente de Job Board',
                        counterparty_initials: initialsOf(req.client_display_name), subject: req.display_title || 'Job Board',
                        context: {
                            application_id: app.id, request_id: req.id || null, request_code: req.request_code || null,
                            application_status: app.status, reply_status: waiting ? 'waiting' : 'replied'
                        },
                        status: app.status === 'rejected' ? 'closed' : 'open', is_priority: waiting, last_message: reply || app.message,
                        last_message_at: lastAt, last_sender_user_id: reply ? null : artistId, is_favorite: false, is_archived: false,
                        unread_count: waiting ? 3 : 0, created_at: app.created_at, updated_at: lastAt
                    },
                    messages: [
                        { id: id('ec', (i + 1) * 10), thread_id: threadId, sender_user_id: artistId, sender_role: 'artist', body: app.message, message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: app.created_at }
                    ].concat(reply ? [
                        { id: id('ec', (i + 1) * 10 + 1), thread_id: threadId, sender_user_id: null, sender_role: 'client', body: reply, message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: lastAt }
                    ] : [])
                });
            });
            spotApplications.forEach(function (app, i) {
                if (hasThreadFor(app.id)) return;
                var spot = spotsById[app.spot_id] || {};
                var studio = studiosById[spot.studio_id] || {};
                var bounds = rangeBounds(app.requested_dates);
                var reply = SPOT_MESSAGES[app.status] || null;
                var lastAt = reply ? (app.decided_at || app.created_at) : app.created_at;
                var threadId = id('ed', i + 1);
                pushDomainThread({
                    thread: {
                        id: threadId, artist_user_id: artistId, category: 'spots', context_type: 'studio_spot_application', context_id: app.id,
                        counterparty_user_id: studio.user_id || null, counterparty_name: studio.name || 'Estudio',
                        counterparty_initials: initialsOf(studio.name), subject: spot.title || 'Spot',
                        context: {
                            application_id: app.id, spot_id: spot.id || null, studio_id: studio.id || null, studio: studio.name || null,
                            city: studio.city || null, start_date: bounds ? bounds.start : spot.start_date || null,
                            end_date: bounds ? bounds.end : spot.end_date || null, application_status: app.status, reply_status: 'replied'
                        },
                        status: app.status === 'rejected' ? 'closed' : 'open', is_priority: false, last_message: reply || app.message,
                        last_message_at: lastAt, last_sender_user_id: reply ? null : artistId, is_favorite: false, is_archived: false,
                        unread_count: 0, created_at: app.created_at, updated_at: lastAt
                    },
                    messages: [
                        { id: id('ee', (i + 1) * 10), thread_id: threadId, sender_user_id: artistId, sender_role: 'artist', body: app.message, message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: app.created_at }
                    ].concat(reply ? [
                        { id: id('ee', (i + 1) * 10 + 1), thread_id: threadId, sender_user_id: null, sender_role: 'studio', body: reply, message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null, created_at: lastAt }
                    ] : [])
                });
            });
        }
    };
}(typeof self !== 'undefined' ? self : this));
