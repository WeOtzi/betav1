/**
 * Fixtures de preview/demo · área "invitaciones" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Reproduce los estados de los frames del área en /artist/invitations:
 *   - 801:540  listado: invitación destacada, aceptadas, pendientes y rechazada.
 *   - 2007:5792/5793 mapa de estudios: ~30 estudios geolocalizados en 13 países.
 *   - 2007:5794 detalle ampliado (Zorro Rojo Tattoo: equipo, perfil de trabajo).
 *   - 2007:5795 escribir al estudio (RPC contact_studio_as_artist + Inbox).
 *
 * Reglas: los estudios, spots e invitaciones del demo base y de "oportunidades"
 * se conservan; solo se completan coordenadas faltantes, cuenta del estudio y
 * las columnas nuevas del perfil de trabajo (migración
 * 20261028180000_invitaciones_estudios_contacto.sql, no aplicada).
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['invitaciones'] = function (ctx) {
        var t = ctx.tables;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var username = (ctx.identity && ctx.identity.username) || 'artista.wo';
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = new Date();

        /* ------------------------------ helpers ------------------------------ */
        function id(group, n) {
            var tail = String(n);
            while (tail.length < 8) tail = '0' + tail;
            return '0000c0de-0000-4000-8000-1d' + group + tail;
        }
        function pad2(n) { return String(n).padStart(2, '0'); }
        function iso(ms) { return new Date(ms).toISOString(); }
        function daysAgo(n) { return iso(now.getTime() - n * DAY); }
        function minutesAgo(n) { return iso(now.getTime() - n * 60000); }
        function inDays(n) { return iso(now.getTime() + n * DAY); }
        function dateOnly(offset) {
            var d = new Date(now.getTime() + offset * DAY);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }
        function list(name) { if (!Array.isArray(t[name])) t[name] = []; return t[name]; }
        function addTable(name) { if (ctx.TABLES.indexOf(name) === -1) ctx.TABLES.push(name); }
        function rel(table, localKey, foreignKey, many) { return { table: table, localKey: localKey, foreignKey: foreignKey, many: !!many }; }
        function initials(name) {
            return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || 'WO';
        }
        function bySlug(slug) { return list('studios').find(function (s) { return s.slug === slug; }) || null; }

        ['studios', 'studio_locations', 'studio_spots', 'studio_artist_memberships', 'studio_membership_invitation_details',
            'studio_invitation_change_requests', 'inbox_threads', 'inbox_messages', 'artists_db_roster_demo'].forEach(addTable);

        /* --------------------------- relaciones --------------------------- */
        ctx.relations.studio_locations = Object.assign({}, ctx.relations.studio_locations, {
            studios: rel('studios', 'studio_id', 'id', false),
            studio_id: rel('studios', 'studio_id', 'id', false)
        });
        // El roster de un estudio embebe artists_db; en el demo esos artistas
        // viven en una tabla propia para no pisar el perfil real del preview.
        ctx.relations.studio_artist_memberships = Object.assign({}, ctx.relations.studio_artist_memberships, {
            artists_db: rel('artists_db_roster_demo', 'artist_user_id', 'user_id', false)
        });

        /* ---------------------------- estudios ---------------------------- */
        // Coordenadas por ciudad para sedes que llegan sin geocodificar.
        var CITY = {
            'Buenos Aires': [-34.6037, -58.3816], 'Rosario': [-32.9442, -60.6505], 'Córdoba': [-31.4201, -64.1888],
            'Bariloche': [-41.1335, -71.3103], 'Mendoza': [-32.8895, -68.8458], 'Lisboa': [38.7223, -9.1393],
            'Berlín': [52.52, 13.405], 'Oslo': [59.9139, 10.7522], 'Ciudad de México': [19.4326, -99.1332],
            'Barcelona': [41.3874, 2.1686], 'Madrid': [40.4168, -3.7038], 'Valparaíso': [-33.0472, -71.6127],
            'Santiago': [-33.4489, -70.6693], 'Nueva York': [40.7128, -74.006]
        };

        // [slug, nombre, ciudad, país, barrio, dirección, lat, lng, tagline, estilos, guest, residente, split, ventana guests (días), puestos]
        var NEW_STUDIOS = [
            ['fierro-negro-tattoo', 'Fierro Negro Tattoo', 'Buenos Aires', 'Argentina', 'Palermo', 'Gorriti 4870, Palermo, Buenos Aires', -34.5862, -58.4279,
                'Blackwork y dotwork en Palermo.', ['Blackwork', 'Dotwork'], false, true, 60, null, 5],
            ['gotic-13', 'Gòtic 13', 'Barcelona', 'España', 'Barri Gòtic', "Carrer d'Avinyó 13, Barri Gòtic, Barcelona", 41.3812, 2.1771,
                'Tradicional y neotradicional en el corazón del Gòtic.', ['Tradicional', 'Neotradicional'], true, false, 55, [12, 40], 4],
            ['taller-ceiba', 'Taller Ceiba', 'Bogotá', 'Colombia', 'Chapinero', 'Calle 57 #9-24, Chapinero, Bogotá', 4.6486, -74.0628,
                'Botánico y fine line con luz natural.', ['Fine line', 'Botánico'], true, false, 60, [20, 48], 3],
            ['casa-aguja', 'Casa Aguja', 'Córdoba', 'Argentina', 'Güemes', 'Belgrano 830, Güemes, Córdoba', -31.4255, -64.19,
                'Fine line y ornamental en Güemes.', ['Fine line', 'Ornamental'], false, true, 50, null, 4],
            ['hueso-estudio', 'Hueso Estudio', 'Medellín', 'Colombia', 'El Poblado', 'Carrera 37 #8A-32, El Poblado, Medellín', 6.2088, -75.5676,
                'Realismo y color con agenda internacional.', ['Realismo', 'Color'], true, true, 55, [25, 60], 6],
            ['kuntur-tattoo', 'Kuntur Tattoo', 'Lima', 'Perú', 'Barranco', 'Av. Pedro de Osma 135, Barranco, Lima', -12.1464, -77.0219,
                'Iconografía andina y blackwork.', ['Blackwork', 'Tribal'], true, false, 60, [8, 30], 3],
            ['atelie-concreto', 'Ateliê Concreto', 'São Paulo', 'Brasil', 'Vila Madalena', 'Rua Harmonia 512, Vila Madalena, São Paulo', -23.5568, -46.691,
                'Geométrico y abstracto en Vila Madalena.', ['Geométrico', 'Abstracto'], false, true, 50, null, 8],
            ['bowery-line', 'Bowery Line', 'Nueva York', 'Estados Unidos', 'Lower East Side', '211 Bowery, Nueva York', 40.7223, -73.9927,
                'Old school y lettering desde 2009.', ['Old school', 'Lettering'], true, false, 50, [35, 70], 9],
            ['kontrast-studio', 'Kontrast Studio', 'Berlín', 'Alemania', 'Neukölln', 'Weserstraße 58, Neukölln, Berlín', 52.4811, 13.435,
                'Blackwork experimental y ignorant.', ['Blackwork', 'Ignorant'], true, true, 50, [15, 45], 7],
            ['officina-nera', 'Officina Nera', 'Milán', 'Italia', 'Navigli', 'Ripa di Porta Ticinese 41, Milán', 45.452, 9.175,
                'Black & grey y realismo italiano.', ['Black & grey', 'Realismo'], true, false, 55, [30, 58], 5],
            ['azulejo-tattoo', 'Azulejo Tattoo', 'Lisboa', 'Portugal', 'Bairro Alto', 'Rua da Rosa 147, Bairro Alto, Lisboa', 38.7139, -9.1446,
                'Ornamental inspirado en la azulejería.', ['Ornamental', 'Dotwork'], true, false, 60, [18, 50], 4],
            ['tierra-firme-tattoo', 'Tierra Firme Tattoo', 'Santiago', 'Chile', 'Barrio Italia', 'Av. Italia 1240, Providencia, Santiago', -33.443, -70.625,
                'Colectivo de dotwork y geométrico.', ['Dotwork', 'Geométrico'], false, true, 55, null, 5],
            ['estudio-cactus', 'Estudio Cactus', 'Ciudad de México', 'México', 'Roma Norte', 'Colima 180, Roma Norte, Ciudad de México', 19.418, -99.162,
                'Old school y color en Roma Norte.', ['Old school', 'Color'], true, true, 50, [40, 75], 6],
            ['tinta-castiza', 'Tinta Castiza', 'Madrid', 'España', 'Malasaña', 'Calle del Espíritu Santo 22, Malasaña, Madrid', 40.426, -3.705,
                'Neotradicional castizo con guests todo el año.', ['Neotradicional', 'Color'], true, false, 55, [10, 38], 5],
            ['la-nave-tattoo', 'La Nave Tattoo', 'Madrid', 'España', 'Lavapiés', 'Calle de Argumosa 9, Lavapiés, Madrid', 40.4087, -3.701,
                'Fine line y microrealismo.', ['Fine line', 'Microrealismo'], true, true, 50, [22, 52], 6],
            ['jaguar-ink', 'Jaguar Ink', 'Guadalajara', 'México', 'Americana', 'Av. Chapultepec 233, Americana, Guadalajara', 20.6736, -103.37,
                'Neotradicional mexicano.', ['Neotradicional', 'Lettering'], true, false, 55, [28, 60], 4],
            ['ink-society', 'Ink Society', 'Montevideo', 'Uruguay', 'Ciudad Vieja', 'Sarandí 450, Ciudad Vieja, Montevideo', -34.907, -56.205,
                'Estudio boutique frente a la rambla.', ['Fine line', 'Blackwork'], true, false, 60, [14, 35], 3]
        ];
        var EQUIPMENT = ['Camillas hidráulicas', 'Autoclave', 'Impresora de stencil'];
        NEW_STUDIOS.forEach(function (s, i) {
            if (bySlug(s[0])) return;
            var studioId = id('a1', i + 1);
            var locationId = id('a2', i + 1);
            var studio = {
                id: studioId, slug: s[0], name: s[1], normalized_name: s[1].toLowerCase(), tagline: s[8],
                bio: s[1] + ' es un estudio de ' + s[9].join(' y ').toLowerCase() + ' en ' + s[4] + ', ' + s[2] + '. Recibe artistas y publica sus oportunidades en We Ötzi.',
                cover_image: null, logo_image: null, photo_feed_items: [], instagram: '@' + s[0].replace(/-/g, '') , website: 'https://' + s[0].replace(/-/g, '') + '.ejemplo.weotzi.demo',
                city: s[2], country: s[3], locality: s[4], formatted_address: s[5], latitude: s[6], longitude: s[7],
                primary_location_id: locationId, user_id: id('a3', i + 1), status: 'active', is_active: true, profile_complete: true,
                languages: s[3] === 'Brasil' ? ['Portugués', 'Español'] : (s[3] === 'Alemania' || s[3] === 'Italia' || s[3] === 'Estados Unidos' || s[3] === 'Portugal')
                    ? ['Inglés', 'Español'] : ['Español', 'Inglés'],
                specialty_styles: s[9], station_count: s[14], equipment: EQUIPMENT.slice(0, 2 + (i % 2)),
                artist_requirements: ['Portfolio actualizado', 'Certificado de bioseguridad vigente'],
                default_revenue_split_pct: s[12], accepts_guest_spots: s[10], is_seeking_artists: s[11],
                guest_window_start: s[13] ? dateOnly(s[13][0]) : null, guest_window_end: s[13] ? dateOnly(s[13][1]) : null,
                accepts_artist_inquiries: true, created_at: daysAgo(300 + i * 7), updated_at: daysAgo(4)
            };
            list('studios').push(studio);
            list('studio_locations').push({
                id: locationId, studio_id: studioId, label: 'Sede principal', city: s[2], country: s[3], locality: s[4],
                formatted_address: s[5], latitude: s[6], longitude: s[7], is_primary: true, is_active: true, sort_order: 0,
                created_at: studio.created_at
            });
        });

        // Fierro Negro usa la foto del mockup como portada.
        var fierro = bySlug('fierro-negro-tattoo');
        if (fierro) {
            fierro.cover_image = '/shared/assets/figma/opportunities/invitation-bang-bang.jpeg';
            fierro.bio = 'Estudio de blackwork y dotwork en Palermo, con seis años de trayectoria y roster estable de tres artistas. Ambiente under, agenda propia y fuerte presencia en redes.';
            fierro.instagram = '@fierronegro.tattoo';
            fierro.website = 'https://fierronegro.ejemplo.weotzi.demo';
        }

        // Zorro Rojo Tattoo: el estudio del frame 2007:5794.
        var zorro = bySlug('zorro-rojo-tattoo');
        if (zorro) {
            Object.assign(zorro, {
                tagline: 'Realismo y black & grey con roster internacional.',
                bio: 'Somos seis artistas de cuatro países. Recibimos guests con fecha y sumamos residentes cada año.',
                locality: 'Gràcia', formatted_address: 'Carrer de Verdi 42, Gràcia, Barcelona', latitude: 41.4036, longitude: 2.1586,
                instagram: '@zorrorojo.tattoo', website: 'https://zorrorojo.es', languages: ['Español', 'Catalán', 'Inglés'],
                specialty_styles: ['Realismo', 'Black & grey'], station_count: 7, equipment: EQUIPMENT.slice(),
                artist_requirements: ['NIE o permiso de trabajo en España'], default_revenue_split_pct: 50,
                accepts_guest_spots: true, is_seeking_artists: true, guest_window_start: dateOnly(30), guest_window_end: dateOnly(43),
                accepts_artist_inquiries: true, is_active: true
            });
            list('studio_locations').forEach(function (loc) {
                if (loc.studio_id !== zorro.id || !loc.is_primary) return;
                Object.assign(loc, { locality: 'Gràcia', formatted_address: 'Carrer de Verdi 42, Gràcia, Barcelona', latitude: 41.4036, longitude: 2.1586 });
            });
        }

        // Coordenadas faltantes (estudios de "oportunidades") con un corrimiento
        // determinista para que dos estudios de la misma ciudad no se pisen.
        var studiosById = {};
        list('studios').forEach(function (s) { studiosById[s.id] = s; });
        list('studio_locations').forEach(function (loc, i) {
            if (loc.latitude != null && loc.longitude != null) return;
            var base = CITY[loc.city];
            if (!base) return;
            var jitter = ((i % 5) - 2) * 0.018;
            loc.latitude = base[0] + jitter;
            loc.longitude = base[1] - jitter;
            if (loc.locality == null) loc.locality = String(loc.formatted_address || '').split(',')[0] || null;
            var owner = studiosById[loc.studio_id];
            if (owner && loc.is_primary && owner.latitude == null) { owner.latitude = loc.latitude; owner.longitude = loc.longitude; }
        });

        // Perfil de trabajo y cuenta para todos los estudios del demo.
        list('studios').forEach(function (s, i) {
            if (!s.user_id) s.user_id = id('a4', i + 1);
            if (s.is_active == null) s.is_active = true;
            if (!Array.isArray(s.languages)) s.languages = ['Español'];
            if (!Array.isArray(s.specialty_styles)) s.specialty_styles = [];
            if (s.station_count === undefined) s.station_count = null;
            if (!Array.isArray(s.equipment)) s.equipment = [];
            if (!Array.isArray(s.artist_requirements)) s.artist_requirements = [];
            if (s.default_revenue_split_pct === undefined) s.default_revenue_split_pct = null;
            if (s.accepts_guest_spots === undefined) s.accepts_guest_spots = false;
            if (s.is_seeking_artists === undefined) s.is_seeking_artists = false;
            if (s.guest_window_start === undefined) { s.guest_window_start = null; s.guest_window_end = null; }
            if (s.accepts_artist_inquiries === undefined) s.accepts_artist_inquiries = true;
            if (s.locality === undefined) s.locality = null;
        });
        list('studio_locations').forEach(function (loc) {
            if (loc.locality === undefined) loc.locality = null;
            if (loc.sort_order === undefined) loc.sort_order = 0;
        });

        /* ----------------------------- roster ----------------------------- */
        // [slug del estudio, nombre, estilo]
        var ROSTER = [
            ['zorro-rojo-tattoo', 'Pau Serra', 'Realismo'], ['zorro-rojo-tattoo', 'Lu Ibarra', 'Black & grey'], ['zorro-rojo-tattoo', 'Laura M.', 'Fine line'],
            ['fierro-negro-tattoo', 'Nico Ferro', 'Blackwork'], ['fierro-negro-tattoo', 'Juli Sosa', 'Dotwork'], ['fierro-negro-tattoo', 'Tomás Rey', 'Blackwork'],
            ['casa-aguja', 'Mora Quiroga', 'Fine line'], ['casa-aguja', 'Ezequiel Paz', 'Ornamental'],
            ['tierra-firme-tattoo', 'Antonia Riquelme', 'Dotwork'], ['tierra-firme-tattoo', 'Benjamín Soto', 'Geométrico'],
            ['gotic-13', 'Jordi Puig', 'Tradicional'], ['gotic-13', 'Clara Vives', 'Neotradicional'],
            ['kontrast-studio', 'Lena Vogel', 'Blackwork'], ['officina-nera', 'Marco Bellini', 'Black & grey'],
            ['taller-ceiba', 'Sara Gómez', 'Fine line'], ['estudio-cactus', 'Diego Luna R.', 'Old school']
        ];
        var roster = list('artists_db_roster_demo');
        ROSTER.forEach(function (r, i) {
            var studio = bySlug(r[0]);
            if (!studio) return;
            var userId = id('b1', i + 1);
            if (!roster.some(function (a) { return a.user_id === userId; })) {
                roster.push({
                    id: userId, user_id: userId, username: r[1].toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.+$/, '') + '.wo',
                    name: r[1], profile_picture: null, styles_array: [r[2]], city: studio.city, country: studio.country, session_price: null
                });
            }
            list('studio_artist_memberships').push({
                id: id('b2', i + 1), studio_id: studio.id, artist_user_id: userId, role: 'resident', status: 'active',
                location_id: studio.primary_location_id, invited_at: daysAgo(400 - i * 9), started_at: daysAgo(380 - i * 9), ended_at: null,
                revenue_split_pct: studio.default_revenue_split_pct || 50, notes: null, created_at: daysAgo(400 - i * 9), updated_at: daysAgo(30)
            });
        });

        /* --------------------------- invitaciones --------------------------- */
        var memberships = list('studio_artist_memberships');
        var details = list('studio_membership_invitation_details');
        // La invitación del mes pasa a ser Fierro Negro (frame 801:540).
        details.forEach(function (d) { d.is_featured = false; });

        function invite(n, slug, row, detail) {
            var studio = bySlug(slug);
            if (!studio || !artistId) return;
            var membershipId = id('c1', n);
            if (memberships.some(function (m) { return m.id === membershipId; })) return;
            memberships.push(Object.assign({
                id: membershipId, studio_id: studio.id, artist_user_id: artistId, role: 'resident',
                location_id: studio.primary_location_id, started_at: null, ended_at: null, notes: detail.message,
                updated_at: row.invited_at, created_at: row.invited_at
            }, row));
            details.push(Object.assign({
                membership_id: membershipId, is_featured: false, styles: [], response_due_at: inDays(7), proposed_start_date: dateOnly(14),
                duration_label: 'Indefinida — miembro estable del roster', benefits: [], studio_provides: [], artist_expectations: [],
                requirements: [], acceptance_steps: [], contact_name: null, contact_email: null, contact_title: null,
                created_at: row.invited_at, updated_at: row.invited_at
            }, detail));
        }

        invite(1, 'fierro-negro-tattoo', { status: 'pending_acceptance', invited_at: minutesAgo(60 * 9), revenue_split_pct: 60 }, {
            is_featured: true, styles: ['Blackwork', 'Dotwork'], response_due_at: inDays(6), proposed_start_date: dateOnly(10),
            duration_label: 'Indefinida — miembro estable del roster', benefits: ['Materiales incluidos', 'Piso mínimo garantizado'],
            studio_provides: ['Materiales e insumos de bioseguridad', 'Piso mínimo garantizado los primeros 3 meses', 'Difusión en redes del estudio', 'Agenda gestionada por recepción'],
            artist_expectations: ['Disponibilidad de al menos 4 días por semana', 'Buen manejo de blackwork y dotwork', 'Compromiso con la agenda y los tiempos del estudio'],
            requirements: ['Portfolio activo en el Job Board', 'Mínimo 2 años de experiencia profesional', 'Residencia legal o permiso de trabajo en Argentina'],
            acceptance_steps: ['Coordinamos tu primera semana de agenda', 'Te sumamos al grupo del estudio', 'Firmamos el acuerdo de roster'],
            contact_name: 'Nico Ferro', contact_email: 'nico@fierronegro.ejemplo.weotzi.demo', contact_title: 'Fundador, Fierro Negro Tattoo',
            message: 'Vimos tu portfolio en el Job Board y creemos que encajás con la casa. Nos encantaría sumarte al roster.'
        });
        invite(2, 'casa-aguja', { status: 'pending_acceptance', invited_at: daysAgo(4), revenue_split_pct: 50 }, {
            styles: ['Fine line', 'Ornamental'], response_due_at: inDays(9), benefits: ['Agenda gestionada'],
            studio_provides: ['Estación propia', 'Agenda gestionada por recepción'], artist_expectations: ['Disponibilidad de 3 días por semana'],
            requirements: ['Portfolio de fine line'], acceptance_steps: ['Coordinamos una visita al estudio', 'Firmamos el acuerdo de roster'],
            contact_name: 'Mora Quiroga', contact_email: 'mora@casaaguja.ejemplo.weotzi.demo', contact_title: 'Directora, Casa Aguja',
            message: 'Tu trabajo en fine line es justo lo que nos falta. 50/50 comisión, agenda gestionada.'
        });
        invite(3, 'tierra-firme-tattoo', { status: 'pending_acceptance', invited_at: daysAgo(12), revenue_split_pct: 55 }, {
            styles: ['Dotwork', 'Geométrico'], response_due_at: inDays(3), benefits: ['Difusión en redes del estudio'],
            studio_provides: ['Estación compartida', 'Difusión en redes del estudio'], artist_expectations: ['Trabajo en colectivo'],
            requirements: ['Portfolio de dotwork o geométrico'], acceptance_steps: ['Te presentamos al colectivo', 'Armamos tu agenda del primer mes'],
            contact_name: 'Antonia Riquelme', contact_email: 'antonia@tierrafirme.ejemplo.weotzi.demo', contact_title: 'Cofundadora, Tierra Firme Tattoo',
            message: 'Armamos un colectivo de dotwork y tu estilo geométrico es perfecto.'
        });
        invite(4, 'zorro-rojo-tattoo', { status: 'active', invited_at: daysAgo(20), started_at: daysAgo(18), revenue_split_pct: 50 }, {
            styles: ['Realismo', 'Black & grey'], response_due_at: daysAgo(13), proposed_start_date: dateOnly(-14),
            benefits: ['Agenda compartida', 'Difusión internacional'], studio_provides: ['Estación propia', 'Recepción bilingüe'],
            artist_expectations: ['Disponibilidad de 4 días por semana'], requirements: ['NIE o permiso de trabajo en España'],
            acceptance_steps: ['Coordinamos tu llegada a Barcelona'], contact_name: 'Marc Vidal', contact_email: 'marc@zorrorojo.ejemplo.weotzi.demo',
            contact_title: 'Manager, Zorro Rojo Tattoo', message: 'Bienvenida al equipo — arrancamos el lunes.'
        });

        // Detalle para las invitaciones del demo base que no lo tenían.
        memberships.forEach(function (m) {
            if (m.artist_user_id !== artistId || details.some(function (d) { return d.membership_id === m.id; })) return;
            var studio = studiosById[m.studio_id] || {};
            details.push({
                membership_id: m.id, is_featured: false, styles: (studio.specialty_styles || []).slice(0, 2).length ? studio.specialty_styles.slice(0, 2) : ['Blackwork', 'Dotwork'],
                response_due_at: m.ended_at || inDays(7), proposed_start_date: m.started_at ? String(m.started_at).slice(0, 10) : dateOnly(21),
                duration_label: m.role === 'guest' ? '2 semanas' : 'Indefinida', benefits: ['Difusión en redes del estudio'],
                studio_provides: ['Estación completa', 'Insumos básicos'], artist_expectations: ['Portfolio actualizado'], requirements: ['Certificado de bioseguridad'],
                acceptance_steps: ['Coordinamos fechas con el estudio'], contact_name: 'Equipo de ' + (studio.name || 'estudio'),
                contact_email: null, contact_title: studio.name || null, message: m.notes || null,
                created_at: m.invited_at, updated_at: m.updated_at || m.invited_at
            });
        });

        /* ---------------------- contacto con estudios ---------------------- */
        var threads = list('inbox_threads');
        var messages = list('inbox_messages');
        if (zorro && artistId) {
            var zorroThread = threads.find(function (th) { return th.category === 'studios' && th.counterparty_name === 'Zorro Rojo Tattoo'; });
            var contactAt = minutesAgo(50);
            var body = 'Hola, me interesa hacer un guest spot en septiembre. Trabajo fine line y blackwork; les dejo mi portfolio.\nPortfolio: /artist/profile?artist=' + username;
            if (!zorroThread) {
                zorroThread = {
                    id: id('d1', 1), artist_user_id: artistId, category: 'studios', counterparty_user_id: zorro.user_id,
                    counterparty_name: zorro.name, counterparty_initials: 'ZR', subject: 'Guest spot · Zorro Rojo Tattoo', context: {},
                    status: 'open', is_priority: false, is_favorite: false, is_archived: false, unread_count: 0, created_at: daysAgo(30)
                };
                threads.push(zorroThread);
            }
            Object.assign(zorroThread, {
                context_type: 'studio_contact', context_id: zorro.id, counterparty_user_id: zorro.user_id,
                context: Object.assign({}, zorroThread.context, {
                    studio_id: zorro.id, studio_name: zorro.name, studio_slug: zorro.slug, city: 'Barcelona',
                    reason: 'guest_spot', reason_label: 'Guest spot', start_date: zorro.guest_window_start, end_date: zorro.guest_window_end,
                    include_portfolio: true, portfolio_url: '/artist/profile?artist=' + username, last_contact_at: contactAt
                }),
                last_message: body, last_message_at: contactAt, last_sender_user_id: artistId, updated_at: contactAt
            });
            messages.push({
                id: id('d2', 1), thread_id: zorroThread.id, sender_user_id: artistId, sender_role: 'artist', body: body,
                message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null,
                client_nonce: null, created_at: contactAt
            });
        }

        var REASONS = { guest_spot: 'Guest spot', resident: 'Artista residente', other: 'Otra consulta' };
        ctx.rpcs.contact_studio_as_artist = function (args, store, rctx) {
            var uid = (rctx && rctx.userId) || artistId;
            var studio = store.rows('studios').find(function (s) { return s.id === args.p_studio_id; });
            if (!studio) return null;
            var label = REASONS[args.p_reason] || REASONS.other;
            var stamp = new Date().toISOString();
            var portfolio = args.p_include_portfolio ? '/artist/profile?artist=' + username : null;
            var text = String(args.p_message || '').trim();
            if (args.p_start_date && args.p_end_date) {
                var fmt = function (v) { var p = String(v).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
                text += '\n\nFechas tentativas: ' + fmt(args.p_start_date) + ' – ' + fmt(args.p_end_date);
            }
            if (portfolio) text += '\nPortfolio: ' + portfolio;
            var context = {
                studio_id: studio.id, studio_name: studio.name, studio_slug: studio.slug, city: studio.city,
                reason: args.p_reason, reason_label: label, start_date: args.p_start_date || null, end_date: args.p_end_date || null,
                include_portfolio: !!args.p_include_portfolio, portfolio_url: portfolio, last_contact_at: stamp
            };
            var thread = store.rows('inbox_threads').find(function (th) {
                return th.context_type === 'studio_contact' && th.context_id === studio.id && (!th.artist_user_id || th.artist_user_id === uid);
            });
            if (!thread) {
                thread = store.insert('inbox_threads', [{
                    artist_user_id: uid, category: 'studios', context_type: 'studio_contact', context_id: studio.id,
                    counterparty_user_id: studio.user_id || null, counterparty_name: studio.name, counterparty_initials: initials(studio.name),
                    subject: label + ' · ' + studio.name, context: context, status: 'open', is_priority: false,
                    last_message: null, last_message_at: stamp, last_sender_user_id: uid, is_favorite: false, is_archived: false,
                    unread_count: 0, updated_at: stamp
                }])[0];
            } else {
                thread.context = Object.assign({}, thread.context, context);
                thread.subject = label + ' · ' + studio.name;
            }
            var row = store.insert('inbox_messages', [{
                thread_id: thread.id, sender_user_id: uid, sender_role: 'artist', body: text, message_kind: 'text',
                attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null
            }])[0];
            thread.last_message = text; thread.last_message_at = row.created_at; thread.last_sender_user_id = uid; thread.updated_at = row.created_at;
            return { thread_id: thread.id, message_id: row.id, contacted_at: row.created_at, reason: args.p_reason, reason_label: label };
        };
    };
}(typeof self !== 'undefined' ? self : this));
