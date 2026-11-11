/**
 * Fixtures de preview/demo · área "perfil-estadisticas" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Perfil público (801:1108): residencias con país y estados (agenda abierta,
 * lista de espera), un viaje confirmado de Travel como presencia pública,
 * idiomas y estudio del artista. Estadísticas (801:543) ya se alimentan de las
 * visitas, cotizaciones, invitaciones y postulaciones de las fixtures base.
 *
 * `artists_db`, `artist_tattoo_locations` y `artist_public_travel_presences`
 * los vuelve a asignar el adaptador del preview local (seedProfiles) DESPUÉS de
 * build(); por eso se enriquecen "al asignar": la primera asignación se
 * intercepta, se completa y la propiedad vuelve a ser un dato común. Si nadie la
 * asigna (modo demo legacy, donde artists_db es real) la propiedad queda oculta
 * y no altera el store. No se agregan nombres a ctx.TABLES: ninguna tabla es
 * nueva y el modo demo legacy sigue leyendo esas tablas del backend real.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};

    var DAY = 24 * 60 * 60 * 1000;

    function dateOnly(offsetDays) {
        var d = new Date(Date.now() + offsetDays * DAY);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // Completa `tables[name]` cuando alguien le asigna valor. Encadena con un
    // interceptor previo (otra área) si ya existe.
    function enrichOnAssign(tables, name, enrich) {
        var desc = Object.getOwnPropertyDescriptor(tables, name);
        if (desc && !desc.configurable) return;
        // Si ya tiene datos se enriquecen ahora y también en la próxima asignación.
        var current = desc && Object.prototype.hasOwnProperty.call(desc, 'value') ? desc.value : undefined;
        if (current !== undefined) current = enrich(current);
        var previousSet = desc && desc.set;
        var previousGet = desc && desc.get;
        Object.defineProperty(tables, name, {
            configurable: true,
            enumerable: current !== undefined || Boolean(desc && desc.enumerable),
            get: function () { return current !== undefined ? current : (previousGet ? previousGet.call(tables) : undefined); },
            set: function (value) {
                var next = value;
                if (previousSet) {
                    previousSet.call(tables, value);
                    next = tables[name];
                }
                Object.defineProperty(tables, name, {
                    configurable: true, enumerable: true, writable: true,
                    value: enrich(next)
                });
            }
        });
    }

    root.WoDemoFixtureExtensions['perfil-estadisticas'] = function (ctx) {
        var tables = ctx.tables;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var studio = (tables.studios || [])[0] || null;

        // Perfil: idiomas y estudio (La Aguja Negra) si el seed no los trae.
        enrichOnAssign(tables, 'artists_db', function (rows) {
            if (!Array.isArray(rows)) return rows;
            return rows.map(function (artist, index) {
                if (index !== 0 || !artist) return artist;
                var extra = {};
                if (!Array.isArray(artist.languages) || !artist.languages.length) extra.languages = ['Español', 'English', 'Italiano'];
                if (!artist.studio_id && studio) extra.studio_id = studio.id;
                return Object.assign({}, artist, extra);
            });
        });

        // Panel Estudio · ARTISTAS (Figma "6 residentes"): roster activo de La
        // Aguja Negra. El artista del perfil suma uno más por su studio_id (su
        // invitación a ese estudio sigue pendiente en las fixtures base). Los
        // residentes viven en artists_db_roster_demo, la tabla de roster de la
        // extensión "invitaciones" (que crea la relación del embed artists_db).
        if (studio && Array.isArray(tables.studio_artist_memberships)) {
            if (!Array.isArray(tables.artists_db_roster_demo)) tables.artists_db_roster_demo = [];
            if (Array.isArray(ctx.TABLES) && ctx.TABLES.indexOf('artists_db_roster_demo') === -1) ctx.TABLES.push('artists_db_roster_demo');
            [['Bianca Ruiz', 'Fine line'], ['Joaquín Ledesma', 'Blackwork'], ['Lucía Ferrer', 'Botánico'],
                ['Tomi Acosta', 'Realismo'], ['Ana Quiroga', 'Minimalista']].forEach(function (r, i) {
                var userId = 'perfil-roster-aguja-' + (i + 1);
                if (!tables.artists_db_roster_demo.some(function (a) { return a.user_id === userId; })) {
                    tables.artists_db_roster_demo.push({
                        id: userId, user_id: userId, username: r[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.') + '.wo',
                        name: r[0], profile_picture: null, styles_array: [r[1]], city: studio.city, country: studio.country, session_price: null
                    });
                }
                if (tables.studio_artist_memberships.some(function (m) { return m.id === 'perfil-membresia-aguja-' + (i + 1); })) return;
                tables.studio_artist_memberships.push({
                    id: 'perfil-membresia-aguja-' + (i + 1), studio_id: studio.id, artist_user_id: userId, role: 'resident', status: 'active',
                    location_id: studio.primary_location_id || null, invited_at: new Date(Date.now() - (420 - i * 30) * DAY).toISOString(),
                    started_at: new Date(Date.now() - (400 - i * 30) * DAY).toISOString(), ended_at: null, revenue_split_pct: 60,
                    notes: null, created_at: new Date(Date.now() - (420 - i * 30) * DAY).toISOString(), updated_at: new Date(Date.now() - 30 * DAY).toISOString()
                });
            });
        }

        // Residencia en lista de espera (estado del Figma que el resto de las
        // fixtures no cubre; "cuenta" ya suma Ciudad de México y Berlín).
        enrichOnAssign(tables, 'artist_tattoo_locations', function (rows) {
            var list = Array.isArray(rows) ? rows.slice() : [];
            var owner = artistId || (list[0] && list[0].artist_user_id) || null;
            list.forEach(function (row) { if (row && row.agenda_status == null) row.agenda_status = 'open'; });
            list.push(
                { id: 'perfil-residencia-paris', artist_user_id: owner, period_type: 'upcoming', sort_order: 2,
                    studio_id: null, studio_name: 'Atelier Encre', city: 'París', country: 'Francia',
                    agenda_status: 'waitlist', start_date: dateOnly(40), end_date: dateOnly(46) }
            );
            return list;
        });

        // Presencias públicas de Travel: viajes confirmados con estudio confirmado.
        enrichOnAssign(tables, 'artist_public_travel_presences', function (rows) {
            var list = Array.isArray(rows) ? rows.slice() : [];
            var links = tables.trip_studio_links || [];
            (tables.artist_trips || []).forEach(function (trip) {
                if (trip.status !== 'confirmado' && trip.status !== 'finalizado') return;
                var link = links.find(function (l) { return l.trip_id === trip.id && l.status === 'confirmada'; });
                if (!link) return;
                var linkedStudio = (tables.studios || []).find(function (s) { return s.id === link.studio_id; }) || {};
                list.push({
                    trip_id: trip.id, artist_user_id: artistId || trip.artist_user_id, city: trip.city, country: trip.country,
                    region: trip.region, start_date: trip.start_date, end_date: trip.end_date, trip_type: trip.trip_type,
                    event_name: trip.event_name, studio_id: link.studio_id, studio_slug: linkedStudio.slug || null,
                    studio_name: link.studio_name, studio_city: link.studio_city, studio_country: linkedStudio.country || trip.country
                });
            });
            return list;
        });
    };
}(typeof self !== 'undefined' ? self : this));
