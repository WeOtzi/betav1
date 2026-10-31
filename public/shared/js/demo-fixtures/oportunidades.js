/**
 * Fixtures de preview/demo · área "oportunidades" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Reproduce los datos de los frames del Figma final para que las tres pantallas
 * del área funcionen en el preview local sin backend real:
 *   - /job-board        → 801:1067 · 801:1068 · 801:1069 (rieles curados + sponsor)
 *   - /artist/applications → 801:1070 · 801:1071 · 801:1073 · 801:1074 · 801:1075
 *   - /studio-spots     → 801:537 · 801:538 · 801:539 (13 spots abiertos)
 *
 * Reglas:
 *   - Las solicitudes y spots del demo base se conservan (otras pantallas los
 *     usan); solo se les quita la curaduría para que no ocupen los rieles.
 *   - Las postulaciones del demo base se reemplazan por las 9 del Figma
 *     (5 Job Board + 4 Spots) con todos los estados: esperando respuesta,
 *     en revisión, contraoferta recibida, confirmada, rechazada y expirada.
 *   - Columnas nuevas (migración 20261028170000_oportunidades_figma_final, no
 *     aplicada): job_board_requests.specific_requirements, studio_spots.benefit_tags
 *     y studio_spots.availability_summary.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['oportunidades'] = function (ctx) {
        var t = ctx.tables;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var username = (ctx.identity && ctx.identity.username) || 'artista.wo';
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = new Date();

        /* ------------------------------ helpers ------------------------------ */
        function id(group, n) {
            var tail = String(n);
            while (tail.length < 8) tail = '0' + tail;
            return '0000c0de-0000-4000-8000-f' + group + tail;
        }
        function pad2(n) { return String(n).padStart(2, '0'); }
        function daysAgo(n) { return new Date(now.getTime() - n * DAY).toISOString(); }
        function hoursAgo(n) { return new Date(now.getTime() - n * 3600000).toISOString(); }
        function inDays(n) { return new Date(now.getTime() + n * DAY).toISOString(); }
        function at(dayOffset, hhmm) {
            var d = new Date(now.getTime()); d.setDate(d.getDate() + dayOffset);
            var p = hhmm.split(':'); d.setHours(parseInt(p[0], 10), parseInt(p[1], 10) || 0, 0, 0);
            if (d.getTime() > now.getTime()) d = new Date(now.getTime() - 3600000);
            return d.toISOString();
        }
        function dateOnly(dayOffset) {
            var d = new Date(now.getTime()); d.setDate(d.getDate() + dayOffset);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }
        function list(name) { if (!Array.isArray(t[name])) t[name] = []; return t[name]; }
        function addTable(name) { if (ctx.TABLES.indexOf(name) === -1) ctx.TABLES.push(name); }

        /* ------------------------------ clientes ------------------------------ */
        // [clave, nombre visible, ciudad, país, antigüedad en días]
        var CLIENTS = [
            ['diego', 'Diego M.', 'Medellín', 'Colombia', 140], ['camila', 'Camila R.', 'Santiago', 'Chile', 120],
            ['rodrigo', 'Rodrigo A.', 'Bogotá', 'Colombia', 200], ['sofia', 'Sofía L.', 'Medellín', 'Colombia', 90],
            ['bruno', 'Bruno T.', 'Ciudad de México', 'México', 160], ['ines', 'Inés P.', 'Lima', 'Perú', 60],
            ['martina', 'Martina G.', 'Quito', 'Ecuador', 75], ['joaquin', 'Joaquín S.', 'Montevideo', 'Uruguay', 50],
            ['lucas', 'Lucas F.', 'Medellín', 'Colombia', 45], ['paula', 'Paula V.', 'Buenos Aires', 'Argentina', 30],
            ['tomas', 'Tomás E.', 'Rosario', 'Argentina', 80], ['valeria', 'Valeria N.', 'Córdoba', 'Argentina', 66],
            ['nico', 'Nicolás B.', 'Ciudad de México', 'México', 34], ['aurora', 'Aurora Ink Collective', 'Ciudad de México', 'México', 300]
        ];
        var client = {};
        // Perfil completo = check de "cliente verificado" en el detalle (801:1068).
        var UNVERIFIED = { lucas: true, nico: true };
        CLIENTS.forEach(function (c, i) {
            client[c[0]] = { user_id: id('c10', i + 1), name: c[1], city: c[2], country: c[3] };
            list('client_public_profiles').push({
                user_id: id('c10', i + 1), public_username: c[1], profile_picture: null, city_residence: c[2], country: c[3],
                public_profile_enabled: true, profile_completed_at: UNVERIFIED[c[0]] ? null : daysAgo(Math.max(1, c[4] - 2)),
                created_at: daysAgo(c[4])
            });
        });

        // Reseñas de otros artistas sobre clientes → public_review_summary ("☆ 4,9 · Cliente desde 2026").
        // [cliente, notas]
        var CLIENT_REVIEWS = [
            ['camila', [5, 5, 5, 5, 5, 5, 5, 5, 5, 4]], ['joaquin', [5, 5, 4]], ['diego', [5, 5, 5, 4]],
            ['rodrigo', [5, 4]], ['martina', [5]], ['valeria', [4, 5, 5]]
        ];
        CLIENT_REVIEWS.forEach(function (entry, i) {
            var c = client[entry[0]];
            entry[1].forEach(function (rating, j) {
                list('verified_reviews').push({
                    id: id('c40', i * 20 + j + 1), context_type: 'quotation', quotation_id: null,
                    reviewer_type: 'artist', reviewer_user_id: id('c41', j + 1), reviewer_display_name: 'Artista de We Ötzi', reviewer_country: c.country,
                    reviewee_type: 'client', reviewee_user_id: c.user_id, reviewee_display_name: c.name,
                    rating: rating, comment: 'Puntual, clara con la idea y con buena comunicación.', tags: ['puntualidad', 'trato'], photo_urls: [], highlights: [],
                    moderation_status: 'approved', approved_at: daysAgo(20 + j * 9), is_public: true, response: null, response_status: null,
                    created_at: daysAgo(20 + j * 9), updated_at: daysAgo(20 + j * 9)
                });
            });
        });

        /* ---------------------------- job board feed ---------------------------- */
        // Las solicitudes del demo base quedan abiertas pero fuera de la curaduría.
        list('job_board_requests').forEach(function (r) { r.feed_rank = null; r.is_featured = false; r.featured_rank = null; });

        // [código, cliente, título, estilos, ciudad, país, zona, tamaño, min, max, postulaciones, días publicada, rank, viaja, expira en días]
        var REQUESTS = [
            ['JB-59407', 'diego', 'Calavera con auriculares y notas musicales, estilo new school', ['New School', 'Tradicional'], 'Medellín', 'Colombia', 'Hombro', 'Mediano (10–15 cm)', 200, 400, 4, 2, 1, true, 12],
            ['JB-76217', 'ines', 'Retrato de gato persa estilo anime con ojos grandes', ['Anime', 'New School'], 'Lima', 'Perú', 'Antebrazo', 'Pequeño (menos de 10 cm)', 100, 250, 1, 3, 2, false, 18],
            ['JB-33085', 'valeria', 'Mandala geométrico con simbolismo lunar', ['Geométrico', 'Mandala'], 'Bogotá', 'Colombia', 'Costilla', 'Mediano (15–20 cm)', 150, 300, 2, 9, 3, true, 9],
            ['JB-34654', 'nico', 'Serpiente enroscada estilo japonés tradicional', ['Japonés', 'Tradicional'], 'CDMX', 'México', 'Pierna', 'Grande (20–30 cm)', 400, 800, 6, 11, 4, false, 7],
            ['JB-41873', 'paula', 'Golondrina tradicional con banner y rosa', ['Tradicional', 'Lettering'], 'Buenos Aires', 'Argentina', 'Pecho', 'Mediano (10–15 cm)', 150, 350, 3, 8, 5, true, 14],
            ['JB-51027', 'martina', 'Loro tropical con flores exóticas y colores vibrantes', ['Realismo', 'Acuarela'], 'Quito', 'Ecuador', 'Antebrazo', 'Mediano (15–20 cm)', 200, 500, 4, 12, 6, false, 10],
            ['JB-24872', 'camila', 'Retrato realista de abuela en blanco y negro', ['Realismo', 'Black & Grey'], 'Santiago', 'Chile', 'Antebrazo', 'Mediano (15–20 cm)', 300, 600, 5, 2, 7, true, 3],
            ['JB-45210', 'joaquin', 'Retrato hiperrealista de lobo aullando bajo la luna', ['Hiperrealismo', 'Realismo'], 'Montevideo', 'Uruguay', 'Pantorrilla', 'Grande (20–30 cm)', 400, 900, 4, 13, 8, true, 11],
            ['JB-30991', 'lucas', 'Paisaje de montaña realista', ['Realismo', 'Acuarela'], 'Medellín', 'Colombia', 'Brazo', 'Grande (20–30 cm)', 250, 500, 2, 15, 9, false, 15],
            ['JB-41432', 'tomas', 'Brazalete ornamental en blackwork sólido', ['Blackwork', 'Ornamental'], 'Rosario', 'Argentina', 'Antebrazo', 'Mediano (10–15 cm)', 180, 350, 3, 5, 10, true, 20],
            ['JB-19832', 'paula', 'Cover up de flor vieja con blackwork denso', ['Blackwork', 'Fine Line'], 'Buenos Aires', 'Argentina', 'Hombro', 'Mediano (15–20 cm)', 300, 550, 5, 6, 11, false, 16],
            ['JB-38820', 'sofia', 'Lobo geométrico en blackwork con líneas finas', ['Blackwork', 'Geométrico'], 'Medellín', 'Colombia', 'Muslo', 'Grande (20–30 cm)', 350, 700, 2, 10, 12, true, 13],
            ['JB-27654', 'valeria', 'Polilla ornamental en el esternón', ['Blackwork', 'Microrealismo'], 'Córdoba', 'Argentina', 'Esternón', 'Mediano (10–15 cm)', 200, 400, 1, 4, 13, false, 19]
        ];
        var reqByCode = {};
        REQUESTS.forEach(function (r, i) {
            var c = client[r[1]];
            var row = {
                id: id('a10', i + 1), request_code: r[0], display_code: r[0], client_user_id: c.user_id,
                client_display_name: c.name, client_avatar_url: null,
                display_title: r[2], tattoo_idea_title: r[2],
                tattoo_idea_description: r[2] + '. Busco a alguien con experiencia en ' + r[3].join(' y ').toLowerCase() + ' que respete la idea y proponga su versión.',
                tattoo_style: r[3], tattoo_body_part: r[6], tattoo_body_side: null, tattoo_size: r[7],
                tattoo_color_type: /Acuarela|New School|Anime|Tradicional/.test(r[3].join(' ')) ? 'Color' : 'Negro y gris',
                tattoo_is_first_tattoo: false, tattoo_is_cover_up: /Cover up/.test(r[2]),
                client_city: r[4], client_country: r[5], client_travel_willing: r[13],
                client_budget_min: r[8], client_budget_max: r[9], client_budget_currency: 'USD',
                client_preferred_date: null, client_flexible_dates: true,
                status: 'open', application_count: r[10], max_applications: 12, is_public: true,
                is_featured: false, featured_rank: null, feed_rank: r[12], is_sponsored: false,
                sponsor_name: null, sponsor_description: null, featured_tags: [], featured_image_url: null, featured_slots_count: null,
                specific_requirements: [], resulting_quote_id: null,
                created_at: at(-r[11], '08:30'), updated_at: daysAgo(Math.max(0, r[11] - 1)), expires_at: inDays(r[14])
            };
            reqByCode[r[0]] = row;
            list('job_board_requests').push(row);
        });
        // Detalle del frame 801:1068 (la idea y los requisitos se muestran literales).
        Object.assign(reqByCode['JB-24872'], {
            tattoo_idea_description: 'Quiero un retrato realista en blanco y negro de mi abuela, basado en una foto de los años 70. Me gustaría que se note el detalle de su expresión y el pañuelo que llevaba puesto. Es mi primer tatuaje grande y busco un artista con experiencia real en retratos hiperrealistas.',
            specific_requirements: ['Mostrar trabajos previos de retratos', 'Prefiere resolverlo en una sola sesión si es posible', 'Abierta a recibir un boceto antes de confirmar'],
            tattoo_is_first_tattoo: true, created_at: at(-2, '07:40')
        });
        Object.assign(reqByCode['JB-45210'], {
            specific_requirements: ['Mostrar retratos de animales en realismo', 'Disponibilidad para dos sesiones largas', 'Boceto previo antes de la primera sesión']
        });

        // Oportunidad patrocinada (sección 103:1666).
        list('job_board_requests').push({
            id: id('a10', 90), request_code: 'JB-SP001', display_code: 'JB-SP001', client_user_id: client.aurora.user_id,
            client_display_name: 'Aurora Ink Collective', client_avatar_url: null,
            display_title: 'Buscamos artistas residentes para nueva sede en Ciudad de México',
            tattoo_idea_title: 'Residencia en Ciudad de México',
            tattoo_idea_description: 'Residencia de 3 meses en la nueva sede del estudio. Proyectos en blackwork y fine line con clientela propia.',
            tattoo_style: ['Blackwork', 'Fine Line'], tattoo_body_part: 'Varios', tattoo_body_side: null, tattoo_size: 'Varios',
            tattoo_color_type: 'Negro y gris', tattoo_is_first_tattoo: false, tattoo_is_cover_up: false,
            client_city: 'Ciudad de México', client_country: 'México', client_travel_willing: false,
            client_budget_min: 800, client_budget_max: 2500, client_budget_currency: 'USD',
            client_preferred_date: null, client_flexible_dates: true,
            status: 'open', application_count: 9, max_applications: 30, is_public: true,
            is_featured: true, featured_rank: 1, feed_rank: null, is_sponsored: true,
            sponsor_name: 'Aurora Ink Collective',
            sponsor_description: 'Estudio boutique especializado en blackwork y fine line abre agenda para una residencia de 3 meses. Clientela propia, marketing incluido y flexibilidad de fechas.',
            featured_tags: ['Agenda inmediata', 'Múltiples proyectos', 'Contratación frecuente'],
            featured_image_url: null, featured_slots_count: 3, specific_requirements: [], resulting_quote_id: null,
            created_at: hoursAgo(5), updated_at: hoursAgo(5), expires_at: inDays(30)
        });

        // Solicitudes ya cerradas a las que el artista se postuló (no aparecen en el feed).
        var CLOSED = [
            ['JB-33012', 'rodrigo', 'Mandala geométrico con simbolismo lunar', ['Geométrico', 'Mandala'], 'Bogotá', 'Colombia', 'Costilla', 150, 300, 30],
            ['JB-41190', 'sofia', 'Tigre feroz en blackwork con detalle ornamental', ['Blackwork', 'Ornamental'], 'Medellín', 'Colombia', 'Muslo', 600, 1100, 34],
            ['JB-34510', 'bruno', 'Serpiente enroscada estilo japonés tradicional', ['Japonés', 'Tradicional'], 'CDMX', 'México', 'Pierna', 400, 800, 45]
        ];
        CLOSED.forEach(function (r, i) {
            var c = client[r[1]];
            var row = {
                id: id('a11', i + 1), request_code: r[0], display_code: r[0], client_user_id: c.user_id,
                client_display_name: c.name, client_avatar_url: null, display_title: r[2], tattoo_idea_title: r[2],
                tattoo_idea_description: r[2] + '. Pieza pensada para una sola zona, con buen contraste.',
                tattoo_style: r[3], tattoo_body_part: r[6], tattoo_body_side: null, tattoo_size: 'Mediano (15–20 cm)',
                tattoo_color_type: 'Negro y gris', tattoo_is_first_tattoo: false, tattoo_is_cover_up: false,
                client_city: r[4], client_country: r[5], client_travel_willing: false,
                client_budget_min: r[7], client_budget_max: r[8], client_budget_currency: 'USD',
                client_preferred_date: null, client_flexible_dates: true,
                status: 'closed', application_count: 6, max_applications: 12, is_public: false,
                is_featured: false, featured_rank: null, feed_rank: null, is_sponsored: false,
                sponsor_name: null, sponsor_description: null, featured_tags: [], featured_image_url: null, featured_slots_count: null,
                specific_requirements: [], resulting_quote_id: null,
                created_at: daysAgo(r[9]), updated_at: daysAgo(r[9] - 10), expires_at: daysAgo(r[9] - 14)
            };
            reqByCode[r[0]] = row;
            list('job_board_requests').push(row);
        });
        list('job_board_request_stats');
        Object.keys(reqByCode).forEach(function (code, i) {
            t.job_board_request_stats.push({ request_id: reqByCode[code].id, view_count: 30 + i * 11, updated_at: hoursAgo(1) });
        });

        /* ------------------------ postulaciones Job Board ------------------------ */
        // Ruta canónica del perfil público: artist-profile.js lee ?artist=<username>.
        var portfolio = '/artist/profile?artist=' + encodeURIComponent(username);
        // [código, estado, precio, sesiones, duración, días desde el envío, hora, mensaje, visto hace días, decidido hace días]
        var JB_APPS = [
            ['JB-59407', 'pending', 280, 2, '2_3_days', 1, '11:20', 'Me encanta la idea. La resolvería en new school con colores saturados y línea gruesa.', null, null],
            ['JB-24872', 'viewed', 450, 3, null, 2, '18:10', 'Hola Camila, me encantaría hacer este retrato — trabajo hace 4 años con realismo en blanco y negro y tengo experiencia con este tipo de fotos antiguas. Te comparto mi portfolio.', 1, null],
            ['JB-33012', 'accepted', 220, 1, '1_day', 10, '15:00', 'Puedo hacerlo en una sesión, con dotwork suave para la luna.', 9, 7],
            ['JB-41190', 'rejected', 900, 3, '1_week', 13, '10:45', 'Lo haría en tres sesiones, con el ornamental en blackwork sólido.', 12, 9],
            ['JB-34510', 'pending', 600, 2, '2_3_days', 26, '17:30', 'Japonés tradicional con paleta clásica, en dos sesiones.', null, null]
        ];
        t.job_board_applications = JB_APPS.map(function (a, i) {
            var req = reqByCode[a[0]];
            return {
                id: id('a20', i + 1), request_id: req.id, artist_id: artistId, status: a[1], message: a[7],
                estimated_price: a[2], estimated_sessions: a[3], estimated_duration: a[4], availability_note: 'Disponible desde la semana próxima',
                portfolio_links: [portfolio], created_at: at(-a[5], a[6]), updated_at: a[8] != null ? at(-a[8], '09:30') : at(-a[5], a[6]),
                viewed_at: a[8] != null ? at(-a[8], '09:30') : null, decided_at: a[9] != null ? daysAgo(a[9]) : null
            };
        });
        t.job_board_counter_offers = [{
            id: id('a30', 1), application_id: id('a20', 2), author_role: 'client', price: 400, currency: 'USD',
            proposed_date: null, note: 'Prefiere resolverlo en una sola sesión si es posible.', status: 'pendiente',
            created_at: hoursAgo(3), decided_at: null
        }];

        /* --------------------------------- spots --------------------------------- */
        // Estudios nuevos del directorio (los del demo base se reutilizan por slug).
        var studioBySlug = {};
        list('studios').forEach(function (s) { studioBySlug[s.slug] = s; });
        // [slug, nombre, ciudad, país, dirección, instagram]
        var STUDIOS = [
            ['palermo-tattoo-club', 'Palermo Tattoo Club', 'Buenos Aires', 'Argentina', 'Palermo Soho, Buenos Aires', '@palermotattooclub'],
            ['sur-tattoo-house', 'Sur Tattoo House', 'Rosario', 'Argentina', 'Pichincha, Rosario', '@surtattoohouse'],
            ['linea-fina-studio', 'Línea Fina Studio', 'Buenos Aires', 'Argentina', 'Villa Crespo, Buenos Aires', '@lineafinastudio'],
            ['estudio-lisboa-sur', 'Estudio Lisboa Sur', 'Lisboa', 'Portugal', 'Alfama, Lisboa', '@estudiolisboasur'],
            ['estudio-bauhaus-ink', 'Estudio Bauhaus Ink', 'Berlín', 'Alemania', 'Kreuzberg, Berlín', '@bauhausink'],
            ['geometria-negra', 'Geometría Negra', 'Córdoba', 'Argentina', 'Nueva Córdoba, Córdoba', '@geometrianegra'],
            ['nordic-line-studio', 'Nordic Line Studio', 'Oslo', 'Noruega', 'Grünerløkka, Oslo', '@nordiclinestudio'],
            ['casa-re-tattoo', 'Casa Ré Tattoo', 'Ciudad de México', 'México', 'Roma Norte, Ciudad de México', '@casaretattoo'],
            ['bariloche-ink', 'Bariloche Ink', 'Bariloche', 'Argentina', 'Centro Cívico, Bariloche', '@barilocheink'],
            ['mendoza-tattoo-lab', 'Mendoza Tattoo Lab', 'Mendoza', 'Argentina', 'Quinta Sección, Mendoza', '@mendozatattoolab']
        ];
        STUDIOS.forEach(function (s, i) {
            var studio = {
                id: id('b10', i + 1), slug: s[0], name: s[1], normalized_name: s[1].toLowerCase(), tagline: 'Estudio en ' + s[2],
                bio: s[1] + ' recibe artistas invitados y publica sus spots en We Ötzi.', cover_image: null, logo_image: null,
                photo_feed_items: [], instagram: s[5], website: 'https://' + s[0].replace(/-/g, '') + '.com', city: s[2], country: s[3],
                latitude: null, longitude: null, formatted_address: s[4], primary_location_id: id('b20', i + 1),
                user_id: null, status: 'active', created_at: daysAgo(500), updated_at: daysAgo(20)
            };
            studioBySlug[s[0]] = studio;
            list('studios').push(studio);
            list('studio_locations').push({ id: id('b20', i + 1), studio_id: studio.id, label: 'Sede principal', city: s[2], country: s[3], formatted_address: s[4], latitude: null, longitude: null, is_primary: true, is_active: true, created_at: daysAgo(500) });
        });
        // Costa Ink Collective abre una sede en Barcelona para la residencia del Figma.
        var costa = studioBySlug['costa-ink-collective'];
        var bang = studioBySlug['bang-bang-nyc'];
        if (costa) {
            list('studio_locations').push({ id: id('b20', 50), studio_id: costa.id, label: 'Sede Barcelona', city: 'Barcelona', country: 'España', formatted_address: 'Gràcia, Barcelona', latitude: 41.4036, longitude: 2.1586, is_primary: false, is_active: true, created_at: daysAgo(200) });
            costa.instagram = '@costainkcollective';
            costa.website = 'https://costainkcollective.com';
        }

        // Los spots del demo base que no están en el Figma quedan cerrados.
        var baseSpots = list('studio_spots');
        var bangSpot = null;
        var costaSpot = null;
        baseSpots.forEach(function (s) {
            if (bang && s.studio_id === bang.id) bangSpot = s;
            else if (costa && s.studio_id === costa.id) costaSpot = s;
            else s.status = 'closed';
            s.is_featured = false; s.featured_rank = null; s.directory_rank = null;
        });

        var SPOT_DEFAULTS = {
            language_requirements: ['Español'], experience_min_years: 2, includes_housing: false,
            stipend_amount: null, stipend_currency: null, stipend_frequency: null, max_applications: 20, status: 'open',
            cover_image: null, is_featured: false, featured_rank: null,
            studio_includes: ['Camilla y estación de trabajo propia', 'Material de bioseguridad e insumos base', 'Difusión en redes del estudio'],
            artist_expectations: ['Portfolio actualizado', 'Agenda propia de al menos el 50%'],
            minimum_requirements: ['Mínimo 2 años de experiencia profesional', 'Certificado de bioseguridad vigente'],
            benefit_tags: [], availability_summary: null,
            contact_title: 'Manager', response_sla_label: '24 – 72 horas'
        };
        function spot(fields) {
            var row = Object.assign({}, SPOT_DEFAULTS, fields);
            row.updated_at = row.updated_at || daysAgo(1);
            return row;
        }

        // Costa Ink Collective · residencia en Barcelona (hero patrocinado + detalle 801:538).
        var costaFields = {
            title: 'Residencia · Barcelona · 3 a 6 meses', kind: 'resident',
            location_id: id('b20', 50),
            description: 'Estudio boutique en el barrio de Gràcia especializado en realismo y black & grey. Espacio compartido con dos artistas residentes, luz natural y clientela recurrente de proyectos grandes.',
            styles_wanted: ['Realismo', 'Black and grey', 'Fine line'], language_requirements: ['Español', 'Inglés'],
            experience_min_years: 3, revenue_split_pct: 66, stipend_amount: 1000, stipend_currency: 'EUR', stipend_frequency: 'monthly',
            start_date: dateOnly(35), end_date: dateOnly(215), weeks_minimum: 12, weeks_maximum: 24,
            application_count: 14, expires_at: inDays(40), cover_image: null,
            is_featured: true, featured_rank: 1, directory_rank: 1,
            availability_summary: '3 a 6 meses, inicio flexible entre septiembre y octubre',
            benefit_tags: ['Agenda garantizada', 'Materiales incluidos', 'Difusión en redes'],
            studio_includes: ['Camilla y estación de trabajo propia', 'Material de bioseguridad e insumos base', 'Difusión en redes del estudio', 'Agenda compartida con clientela del estudio'],
            artist_expectations: ['Portfolio con foco en realismo o black & grey', 'Disponibilidad mínima de 3 meses', 'Buen manejo de clientes propios y del estudio'],
            minimum_requirements: ['Mínimo 3 años de experiencia profesional', 'Certificado de bioseguridad vigente', 'Seguro de responsabilidad civil (o tramitarlo antes de llegar)'],
            contact_name: 'Marta Vidal', contact_title: 'Coordinadora de residencias'
        };
        if (costaSpot) Object.assign(costaSpot, SPOT_DEFAULTS, costaFields, { status: 'open' });
        else if (costa) { costaSpot = spot(Object.assign({ id: id('b30', 50), studio_id: costa.id, created_at: daysAgo(30) }, costaFields)); baseSpots.push(costaSpot); }

        // Bang Bang NYC · residencia con foto (tile grande con imagen).
        var bangFields = {
            title: 'Residencia · Nueva York · 3 a 6 meses', kind: 'resident',
            description: 'Residencia larga en uno de los estudios más reconocidos de NYC. Incluye stipend mensual y mentoría.',
            styles_wanted: ['Realismo', 'Black and grey', 'Fine line'], language_requirements: ['Inglés'], experience_min_years: 4,
            revenue_split_pct: 70, stipend_amount: 800, stipend_currency: 'USD', stipend_frequency: 'monthly', includes_housing: true,
            start_date: dateOnly(45), end_date: dateOnly(225), weeks_minimum: 12, weeks_maximum: 24, application_count: 22,
            expires_at: inDays(30), cover_image: '/shared/assets/figma/opportunities/spots-studio-01.png',
            directory_rank: 3, benefit_tags: ['Stipend mensual', 'Mentoría', 'Alojamiento incluido'],
            availability_summary: '3 a 6 meses, desde mediados de octubre', contact_name: 'Chris Lee', response_sla_label: '3 – 5 días'
        };
        if (bangSpot) Object.assign(bangSpot, SPOT_DEFAULTS, bangFields, { status: 'open' });
        else if (bang) { bangSpot = spot(Object.assign({ id: id('b30', 51), studio_id: bang.id, location_id: bang.primary_location_id, created_at: daysAgo(30) }, bangFields)); baseSpots.push(bangSpot); }
        // Las portadas SVG del demo base no aplican a estos dos spots del Figma.
        t.studio_spot_attachments = list('studio_spot_attachments').filter(function (a) {
            return !((costaSpot && a.spot_id === costaSpot.id) || (bangSpot && a.spot_id === bangSpot.id));
        });

        // [slug, kind, rank, estilos, split, stipend, moneda, semMin, semMax, inicio, cierra en días, descripción, destacado]
        var SPOTS = [
            ['palermo-tattoo-club', 'guest_spot', 2, ['Blackwork', 'Dotwork', 'Tradicional'], 68, null, null, 4, 4, 20, 3, 'Cupo guest para blackwork y dotwork en el corazón de Palermo. Clientela propia más agenda compartida con el estudio.', false],
            ['sur-tattoo-house', 'guest_spot', 4, ['Fine line', 'Blackwork'], 65, null, null, 2, 3, 15, 2, 'Guest spot de verano frente al río. Estudio luminoso con dos estaciones para invitados.', false],
            ['linea-fina-studio', 'itinerant', 5, ['Fine line', 'Minimalista'], 65, null, null, 2, 2, 12, 5, 'Línea Fina Studio, Villa Crespo, BA. 2 semanas, Fine line / Minimalista, split 65%. Cierra en 5 días.', false],
            ['estudio-lisboa-sur', 'resident', 6, ['Blackwork', 'Ornamental'], 70, 900, 'EUR', 12, 20, 40, 90, 'Estudio con ambiente creativo en el corazón de Lisboa. Alojamiento incluido.', true],
            ['estudio-bauhaus-ink', 'resident', 7, ['Geométrico', 'Blackwork'], null, 1200, 'EUR', 24, 24, 60, 45, 'Residencia de seis meses con stipend fijo y estación propia en Kreuzberg.', false],
            ['costa-ink-collective', 'guest_spot', 8, ['Realismo', 'Black and grey'], 66, null, null, 3, 3, 25, 21, 'Guest spot de tres semanas en la sede de Barcelona, con agenda compartida.', false],
            ['geometria-negra', 'guest_spot', 9, ['Geométrico', 'Dotwork'], 70, null, null, 2, 2, 18, 16, 'Dos semanas en un estudio especializado en geometría y dotwork.', false],
            ['nordic-line-studio', 'resident', 10, ['Fine line', 'Minimalista'], null, 900, 'EUR', 16, 16, 50, 60, 'Residencia de cuatro meses en Oslo para artistas de fine line.', false],
            ['casa-re-tattoo', 'guest_spot', 11, ['Neotradicional', 'Color'], 70, null, null, 2, 4, 30, 12, 'Guest spot en Roma Norte con clientela internacional.', false],
            ['bariloche-ink', 'guest_spot', 12, ['Blackwork', 'Realismo'], 65, null, null, 2, 3, 40, 25, 'Temporada de invierno en Bariloche con alojamiento a convenir.', false],
            ['mendoza-tattoo-lab', 'guest_spot', 13, ['Fine line', 'Lettering'], 70, null, null, 1, 2, 10, 1, 'Guest spot corto durante la vendimia.', false]
        ];
        var spotBySlug = {};
        SPOTS.forEach(function (s, i) {
            var studio = studioBySlug[s[0]];
            if (!studio) return;
            var loc = s[0] === 'costa-ink-collective' ? id('b20', 50) : studio.primary_location_id;
            var row = spot({
                id: id('b30', i + 1), studio_id: studio.id, location_id: loc,
                title: (s[1] === 'resident' ? 'Residencia' : s[1] === 'itinerant' ? 'Itinerante' : 'Guest spot') + ' · ' + studio.city,
                kind: s[1], description: s[11], styles_wanted: s[3], revenue_split_pct: s[4],
                stipend_amount: s[5], stipend_currency: s[6], stipend_frequency: s[5] ? 'monthly' : null,
                weeks_minimum: s[7], weeks_maximum: s[8], start_date: dateOnly(s[9]), end_date: dateOnly(s[9] + s[8] * 7),
                application_count: 3 + i, expires_at: inDays(s[10]), directory_rank: s[2],
                is_featured: s[12], featured_rank: s[12] ? 2 : null, includes_housing: /Alojamiento incluido/.test(s[11]),
                contact_name: ['Lucía Ferro', 'Martín Ruiz', 'Juli Paz', 'Inês Costa', 'Jonas Weber', 'Marta Vidal', 'Sofía Díaz', 'Ida Berg', 'René Ortiz', 'Carla Nahuel', 'Pablo Sosa'][i],
                created_at: daysAgo(12 + i)
            });
            spotBySlug[s[0]] = row;
            baseSpots.push(row);
        });

        /* ---------------------------- postulaciones spots ---------------------------- */
        function range(startOffset, endOffset) { return '[' + dateOnly(startOffset) + ',' + dateOnly(endOffset + 1) + ')'; }
        var spotApps = [];
        if (costaSpot) spotApps.push({ id: id('b40', 1), spot_id: costaSpot.id, status: 'shortlisted', message: 'Hola equipo, me encantaría sumarme a la residencia — vengo trabajando en realismo y black & grey hace 4 años y creo que encajo con la línea del estudio.', requested_dates: range(35, 49), created_at: at(-28, '16:20'), decided_at: at(-27, '09:05') });
        if (bangSpot) spotApps.push({ id: id('b40', 2), spot_id: bangSpot.id, status: 'shortlisted', message: 'Quiero sumarme a la residencia; trabajo en inglés sin problema y tengo agenda propia en realismo.', requested_dates: range(45, 135), created_at: at(-30, '12:10'), decided_at: at(-26, '10:00') });
        if (spotBySlug['palermo-tattoo-club']) spotApps.push({ id: id('b40', 3), spot_id: spotBySlug['palermo-tattoo-club'].id, status: 'accepted', message: 'Me sumo al guest de blackwork con agenda propia para las cuatro semanas.', requested_dates: range(20, 47), created_at: at(-34, '11:00'), decided_at: at(-27, '17:15') });
        if (spotBySlug['sur-tattoo-house']) spotApps.push({ id: id('b40', 4), spot_id: spotBySlug['sur-tattoo-house'].id, status: 'rejected', message: 'Tengo disponibilidad completa para las fechas de verano.', requested_dates: range(15, 29), created_at: at(-36, '19:40'), decided_at: at(-29, '12:00') });
        t.studio_spot_applications = spotApps.map(function (a) {
            return Object.assign({ artist_user_id: artistId, portfolio_url: portfolio }, a);
        });
        t.studio_spot_counter_offers = costaSpot ? [{
            id: id('b50', 1), application_id: id('b40', 1), author_role: 'studio', split_pct: 70,
            proposed_start_date: dateOnly(49), proposed_end_date: dateOnly(64),
            note: 'El estudio no incluye alojamiento, pero ofrece 15% de descuento en materiales.',
            status: 'pending', created_at: at(-18, '14:40'), decided_at: null
        }] : [];

        /* ------------------------------ inbox ------------------------------ */
        // "Ver conversación" (?opportunity=&application=<id>) abre el hilo cuyo
        // context_id es la postulación. En producción los crea el trigger de
        // 20260829153500_unified_artist_inbox.sql; acá hay uno por postulación,
        // con el estado y las fechas de la postulación.
        var threads = list('inbox_threads');
        var messages = list('inbox_messages');
        var MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        function shifted(offset) { var d = new Date(now.getTime()); d.setDate(d.getDate() + offset); return d; }
        function dayMonth(offset) { var d = shifted(offset); return d.getDate() + ' de ' + MONTH_NAMES[d.getMonth()]; }
        function initialsOf(name) {
            return String(name).split(' ').filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
        }
        var threadSeq = 0;
        var msgSeq = 0;
        function addThread(o) {
            threadSeq += 1;
            var first = o.messages[0];
            var last = o.messages[o.messages.length - 1];
            var thread = {
                id: id('c20', threadSeq), artist_user_id: artistId, category: o.category, context_type: o.contextType, context_id: o.applicationId,
                counterparty_user_id: o.counterpartyId || null, counterparty_name: o.name, counterparty_initials: initialsOf(o.name), subject: o.subject,
                context: Object.assign({ application_id: o.applicationId, application_status: o.status }, o.context || {}),
                status: o.closed ? 'closed' : 'open', is_priority: !!o.priority, last_message: last[1], last_message_at: last[2],
                last_sender_user_id: last[0] === 'artist' ? artistId : (o.counterpartyId || null),
                is_favorite: false, is_archived: false, unread_count: o.unread || 0, created_at: first[2], updated_at: last[2]
            };
            o.messages.forEach(function (m) {
                msgSeq += 1;
                messages.push({
                    id: id('c30', msgSeq), thread_id: thread.id, sender_user_id: m[0] === 'artist' ? artistId : (o.counterpartyId || null),
                    sender_role: m[0] === 'artist' ? 'artist' : (o.category === 'job_board' ? 'client' : 'studio'),
                    body: m[1], message_kind: 'text', attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null,
                    client_nonce: null, created_at: m[2]
                });
            });
            threads.push(thread);
            return thread;
        }

        // Job Board: una conversación por propuesta (cliente con artista).
        // [índice en JB_APPS, cliente, estado del panel, mensajes [rol, texto, fecha], sin leer, cerrado]
        var JB_THREADS = [
            [0, 'diego', 'pending', [['artist', 'Hola Diego, te mandé mi propuesta: $280 en 2 sesiones, en new school con colores saturados.', at(-1, '11:20')]], 0, false],
            [1, 'camila', 'pending_acceptance', [
                ['artist', 'Hola Camila, me encantaría hacer este retrato. Te dejé la propuesta con mi portfolio.', at(-2, '18:10')],
                ['client', 'Gracias. Te mandé una contraoferta: $400. Prefiero resolverlo en una sola sesión si es posible.', hoursAgo(3)]
            ], 1, false],
            [2, 'rodrigo', 'accepted', [
                ['artist', 'Puedo hacerlo en una sesión, con dotwork suave para la luna.', at(-10, '15:00')],
                ['client', 'Acepté tu propuesta. Coordinemos el turno por acá.', daysAgo(7)]
            ], 0, false],
            [3, 'sofia', 'rejected', [
                ['artist', 'Lo haría en tres sesiones, con el ornamental en blackwork sólido.', at(-13, '10:45')],
                ['client', 'Gracias por la propuesta. Esta vez elegí a otro artista.', daysAgo(9)]
            ], 0, true],
            [4, 'bruno', 'expired', [['artist', 'Japonés tradicional con paleta clásica, en dos sesiones.', at(-26, '17:30')]], 0, true]
        ];
        var requestsById = {};
        Object.keys(reqByCode).forEach(function (k) { requestsById[reqByCode[k].id] = reqByCode[k]; });
        JB_THREADS.forEach(function (row) {
            var app = t.job_board_applications[row[0]];
            var req = app ? requestsById[app.request_id] : null;
            var c = client[row[1]];
            if (!app || !req || !c) return;
            addThread({
                category: 'job_board', contextType: 'job_board_application', applicationId: app.id, counterpartyId: c.user_id,
                name: c.name, subject: req.display_title, status: row[2], unread: row[4], closed: row[5], priority: row[2] === 'pending_acceptance',
                context: {
                    client: c.name, request_code: req.request_code, style: (req.tattoo_style || []).join(' · '), body_part: req.tattoo_body_part,
                    budget: '$' + req.client_budget_min + ' – $' + req.client_budget_max
                },
                messages: row[3]
            });
        });

        // Spots: Costa Ink (contraoferta), Palermo (confirmada) y Sur (rechazada) con hilo propio.
        // Bang Bang NYC reutiliza el hilo base del demo ("Quedaste en la lista corta").
        var costaOffer = t.studio_spot_counter_offers[0] || null;
        if (costaSpot && spotApps[0]) {
            addThread({
                category: 'spots', contextType: 'studio_spot_application', applicationId: spotApps[0].id,
                name: 'Costa Ink Collective', subject: 'Residencia · Barcelona', status: 'pending_acceptance', unread: 1, priority: true,
                context: {
                    studio: 'Costa Ink Collective', spot_id: costaSpot.id, spot_title: costaSpot.title,
                    start_date: costaOffer ? costaOffer.proposed_start_date : dateOnly(35), end_date: costaOffer ? costaOffer.proposed_end_date : dateOnly(49)
                },
                messages: [
                    ['artist', 'Hola equipo, me encantaría sumarme a la residencia. Les propuse del ' + dayMonth(35) + ' al ' + dayMonth(49) + '.', at(-28, '16:20')],
                    ['studio', 'Te enviamos una contraoferta: del ' + dayMonth(49) + ' al ' + dayMonth(64) + ', split 70%. No incluimos alojamiento, pero sí 15% de descuento en materiales.', at(-18, '14:40')],
                    ['studio', '¿Pudiste revisar la contraoferta? Necesitamos confirmar las fechas esta semana.', hoursAgo(5)]
                ]
            });
        }
        if (spotBySlug['palermo-tattoo-club'] && spotApps[2]) {
            addThread({
                category: 'spots', contextType: 'studio_spot_application', applicationId: spotApps[2].id,
                name: 'Palermo Tattoo Club', subject: 'Guest spot · Buenos Aires', status: 'accepted',
                context: { studio: 'Palermo Tattoo Club', spot_id: spotBySlug['palermo-tattoo-club'].id, start_date: dateOnly(20), end_date: dateOnly(47) },
                messages: [
                    ['artist', 'Me sumo al guest de blackwork con agenda propia para las cuatro semanas.', at(-34, '11:00')],
                    ['studio', 'Confirmado. Te esperamos el ' + dayMonth(20) + '; te reservamos la estación junto a la vidriera.', at(-27, '17:15')]
                ]
            });
        }
        if (spotBySlug['sur-tattoo-house'] && spotApps[3]) {
            addThread({
                category: 'spots', contextType: 'studio_spot_application', applicationId: spotApps[3].id,
                name: 'Sur Tattoo House', subject: 'Guest spot · Rosario', status: 'rejected', closed: true,
                context: { studio: 'Sur Tattoo House', spot_id: spotBySlug['sur-tattoo-house'].id, start_date: dateOnly(15), end_date: dateOnly(29) },
                messages: [
                    ['artist', 'Tengo disponibilidad completa para las fechas de verano.', at(-36, '19:40')],
                    ['studio', 'Gracias por postularte. Esta temporada cubrimos los cupos con artistas de fine line.', at(-29, '12:00')]
                ]
            });
        }
        threads.forEach(function (thread) {
            if (thread.context_id) return;
            if (thread.counterparty_name === 'Bang Bang NYC' && spotApps[1]) {
                thread.context_type = 'studio_spot_application'; thread.context_id = spotApps[1].id;
                thread.context = Object.assign({}, thread.context, { application_id: spotApps[1].id, application_status: 'shortlisted' });
            }
        });

        ['job_board_requests', 'job_board_applications', 'job_board_counter_offers', 'studio_spots',
            'studio_spot_applications', 'studio_spot_counter_offers', 'studios', 'studio_locations',
            'inbox_threads', 'inbox_messages', 'verified_reviews'].forEach(addTable);
    };
}(typeof self !== 'undefined' ? self : this));
