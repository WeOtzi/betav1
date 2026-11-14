/**
 * WE OTZI - Repositorios del dominio Artistas (frontend)
 * ------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js).
 * Reemplazan los `WeotziData.from('artists_db' | 'artist_tattoo_locations' |
 * 'artist_profile_visits' | ...)` dispersos por los modulos de artista.
 *
 * A DIFERENCIA de quotations-repo.js, estos metodos son WRAPPERS FINOS que
 * DEVUELVEN el builder de supabase-js sin resolver: el llamador sigue recibiendo
 * `{ data, error }` (o `{ data, error, count }`) y conserva su propio manejo de
 * error. No usan `run` ni lanzan. Asi la migracion de los call sites es mecanica
 * (reemplazar `WeotziData.from('artists_db').select(...).eq(...)` por
 * `WeotziData.Artists.<metodo>(...)`).
 *
 * Las columnas FIJAS de cada vista con nombre propio (dashboard, perfil publico,
 * mapa) quedan ENCAPSULADAS aqui para que ningun llamador las repita. Para reads
 * genericos con columnas variables se acepta `columns='*'` como parametro.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Artists,
 * ArtistLocations, ArtistVisits}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[artists-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    // Proyeccion completa del dashboard del artista (loadArtistData). Encapsula
    // la constante DASHBOARD_ARTIST_SELECT que vivia inline en dashboard.js.
    const DASHBOARD_SELECT =
        'id, user_id, username, name, email, ubicacion, city, country, country_code, ' +
        'state_province, locality, street, street_number, unit, postal_code, ' +
        'formatted_address, latitude, longitude, google_place_id, styles_array, estilo, ' +
        'years_experience, session_price, session_price_amount, session_price_currency, ' +
        'preferred_display_currency, portafolio, instagram, whatsapp_number, whatsapp_url, ' +
        'work_type, estudios, studio_id, birth_date, subscribed_newsletter, bio_description, ' +
        'profile_picture, gallery_images, gallery_feed_items, dashboard_config, embajador, nivel, ' +
        'verification_state, ms_profile_complete, ms_first_quote_received, ' +
        'ms_first_quote_completed, ms_whatsapp_shared, ms_profile_shared, profile_completeness';

    // Proyeccion del centro de la cuenta (/artist/account): perfil editable,
    // redes, galeria, vacaciones, verificacion y preferencias de moneda.
    const ACCOUNT_SELECT =
        'id, user_id, username, name, email, city, country, ubicacion, languages, ' +
        'bio_description, instagram, portafolio, profile_picture, gallery_images, ' +
        'gallery_feed_items, vacation_start, vacation_end, verification_state, ' +
        'preferred_display_currency, session_price_currency';

    // Proyeccion del perfil del artista para auth/onboarding (ARTIST_PROFILE_SELECT,
    // sin password). Usada por main.js, artist-login.js.
    const PROFILE_SELECT =
        'user_id, username, name, email, ubicacion, styles_array, estilo, years_experience, ' +
        'session_price, portafolio, instagram, work_type, estudios, birth_date, ' +
        'subscribed_newsletter, ms_profile_complete, profile_completeness';

    // Columnas de la vista artists_with_location (perfil + direccion del estudio
    // COALESCEada) para los pines del mapa/globo de explore.
    const WITH_LOCATION_SELECT =
        'user_id, username, name, profile_picture, styles_array, session_price, ' +
        'years_experience, languages, bio_description, is_recommended, work_type, studio_id, ' +
        'location_source, studio_name, studio_phone, studio_website, country, country_code, ' +
        'state_province, city, locality, street, street_number, unit, postal_code, ' +
        'formatted_address, latitude, longitude, google_place_id, geocoded_at';

    // Columnas del fallback a artists_db cuando la vista artists_with_location no
    // esta desplegada (explore-map / explore-globe).
    // Sin coordenadas ni dirección exactas (privadas): sin la vista no hay pines.
    const FOR_MAP_SELECT =
        'user_id, username, name, profile_picture, styles_array, city, country, ubicacion, ' +
        'session_price, years_experience, languages, bio_description, is_recommended, ' +
        'locality, work_type, studio_id';

    // ===================== pii-artistas (20261113106000) =====================
    // artists_db tiene privilegios POR COLUMNA: anon y authenticated solo leen
    // PUBLIC_COLUMNS (misma lista blanca que la migración). Las columnas de
    // PRIVATE_COLUMNS (email, fecha de nacimiento, WhatsApp, dirección y
    // coordenadas exactas, datos internos del registro...) solo se leen:
    //   - el propio artista -> rpc get_my_artist_profile() (fila completa propia)
    //   - soporte           -> rpc support_list_artists(p_user_ids)
    // `select('*')` directo sobre artists_db FALLA con privilegios por columna:
    // los métodos de abajo lo enrutan a la RPC que corresponde.
    const PUBLIC_COLUMNS = Object.freeze([
        'id', 'user_id', 'username', 'name',
        'instagram', 'portafolio', 'profile_links', 'instagram_verified_at',
        'ubicacion', 'city', 'country', 'country_code', 'state_province', 'locality',
        'estudios', 'studio_id', 'work_type',
        'estilo', 'styles_array',
        'session_price', 'session_price_amount', 'session_price_currency',
        'session_price_amount_usd', 'session_price_amount_eur',
        'preferred_display_currency',
        'years_experience', 'bio_description',
        'profile_picture', 'gallery_images', 'gallery_feed_items',
        'languages', 'vacation_start', 'vacation_end',
        'embajador', 'nivel', 'is_recommended', 'verification_state',
        'artist_index', 'idx', 'profile_completeness', 'index_updated_at',
        'registration_status'
    ]);
    const PRIVATE_COLUMNS = Object.freeze([
        'email', 'email_confirmed', 'whatsapp_number', 'whatsapp_url', 'birth_date',
        'street', 'street_number', 'unit', 'postal_code', 'formatted_address',
        'google_place_id', 'latitude', 'longitude', 'geocoded_at', 'geocoded_address',
        'subscribed_newsletter', 'newsletter_topics',
        'registration_draft_id', 'registration_source', 'registration_step',
        'registration_started_at', 'registration_last_saved_at', 'registration_submitted_at',
        'terms_accepted_at', 'terms_version', 'instagram_verified_handle',
        'dashboard_config', 'custom_canvas_labels',
        'ms_profile_complete', 'ms_first_quote_received', 'ms_whatsapp_shared',
        'ms_profile_shared', 'ms_first_quote_completed', 'password'
    ]);
    const PUBLIC_SET = new Set(PUBLIC_COLUMNS);

    // Nombres de columna de un select de PostgREST ("a, alias:b, c::text").
    function columnNames(columns) {
        return String(columns == null ? '*' : columns).split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const noCast = part.split('::')[0];
                const colon = noCast.indexOf(':');
                return (colon === -1 ? noCast : noCast.slice(colon + 1)).trim();
            });
    }
    // true si el select pide algo fuera de la lista blanca ('*' incluido).
    function needsPrivate(columns) {
        return columnNames(columns).some((name) => !PUBLIC_SET.has(name));
    }
    // Lecturas sobre OTROS artistas: descarta las columnas privadas ('*' ->
    // lista pública) para que la consulta no falle por privilegios y nunca
    // pida datos personales.
    function publicOnly(columns) {
        const parts = String(columns == null ? '*' : columns).split(',').map((p) => p.trim()).filter(Boolean);
        const names = columnNames(columns);
        if (names.indexOf('*') !== -1) return (typeof window !== 'undefined' && window.ARTIST_PUBLIC_COLUMNS) || PUBLIC_COLUMNS.join(', ');
        const kept = parts.filter((part, i) => PUBLIC_SET.has(names[i]));
        return kept.length ? kept.join(', ') : 'user_id';
    }
    function client() {
        const c = typeof D.getClient === 'function' ? D.getClient() : null;
        if (!c) throw new Error('[artists-repo] Supabase client unavailable');
        return c;
    }
    // Fila completa del artista con sesión (RPC security definer). Admite
    // select/eq/maybeSingle igual que una tabla. Para otro user_id devuelve 0 filas.
    function ownProfile(columns) {
        return client().rpc('get_my_artist_profile').select(columns || '*');
    }
    // Filas completas para soporte (RPC; falla con 42501 si no es soporte).
    function supportRows(userIds, columns) {
        const args = Array.isArray(userIds) && userIds.length ? { p_user_ids: userIds } : {};
        return client().rpc('support_list_artists', args).select(columns || '*');
    }
    // Lectura por user_id: columnas públicas -> tabla; privadas -> RPC propia.
    function byUserId(userId, columns) {
        return needsPrivate(columns)
            ? ownProfile(columns).eq('user_id', userId)
            : from('artists_db').select(columns).eq('user_id', userId);
    }

    // ===================== artists_db =====================
    const Artists = {
        // --- reads por user_id (perfil propio / auth) ---

        // Registro del artista por user_id (auth). columns variable; .maybeSingle().
        // Cubre register.js:1051, studio-spots-directory.js:229, calendar.js:95,
        // archive.js:60, quotations.js:104, reviews.js:332, client-auth.js (varios),
        // job-board-feed.js:287, artist-login.js:107.
        getByUserId(userId, columns = '*') {
            return byUserId(userId, columns).maybeSingle();
        },

        // Igual que getByUserId pero con .single() (rutas que exigen fila, p.ej.
        // calendar/archive/quotations initializeAdmin con select('*')).
        getByUserIdSingle(userId, columns = '*') {
            return byUserId(userId, columns).single();
        },

        // Registro completo del dashboard del artista (loadArtistData).
        // Cubre dashboard.js:693. columns FIJAS (DASHBOARD_SELECT). .maybeSingle().
        getDashboardByUserId(userId) {
            return byUserId(userId, DASHBOARD_SELECT).maybeSingle();
        },

        // Registro del centro de la cuenta (/artist/account). columns FIJAS
        // (ACCOUNT_SELECT). .maybeSingle(). Cubre artist-account.js.
        getAccountByUserId(userId) {
            return byUserId(userId, ACCOUNT_SELECT).maybeSingle();
        },

        // Perfil del artista para auth/onboarding (ARTIST_PROFILE_SELECT, sin
        // password) por user_id. Cubre main.js:181, main.js:687.
        getProfileByUserId(userId) {
            return byUserId(userId, PROFILE_SELECT).maybeSingle();
        },

        // email + whatsapp_number del usuario (enriquecimiento de logging).
        // Cubre logging-service.js:185. .maybeSingle().
        getContactByUserId(userId) {
            return byUserId(userId, 'email, whatsapp_number').maybeSingle();
        },

        // gallery_feed_items existentes del artista (paso de lectura del merge en
        // registro). Cubre register.js:2655. .single().
        getGalleryFeedItems(userId) {
            return from('artists_db').select('gallery_feed_items').eq('user_id', userId).single();
        },

        // --- reads por email ---

        // Perfil incompleto por email para ofrecer reanudar alta (ARTIST_PROFILE_SELECT).
        // Cubre main.js:499. .maybeSingle().
        getProfileByEmail(email) {
            // Solo la fila propia: filtrar por email exige leer la columna privada.
            return ownProfile(PROFILE_SELECT).eq('email', email).maybeSingle();
        },

        // --- reads por username (perfil publico) ---

        // Perfil publico por username (case-insensitive ilike + .single()). columns
        // variable (ARTIST_PUBLIC_COLUMNS). Cubre script.js:546, script.js:1856.
        getPublicByUsername(username, columns = '*') {
            return from('artists_db').select(publicOnly(columns)).ilike('username', username).single();
        },

        // Perfil publico por username con match exacto + .maybeSingle() (pagina
        // publica del artista). columns FIJAS via ARTIST_PUBLIC_FIELDS por defecto,
        // o explicitas. Cubre artist-profile.js:946.
        getPublicByExactUsername(username, columns = '*') {
            return from('artists_db').select(publicOnly(columns)).eq('username', username).maybeSingle();
        },

        // Busqueda de un artista por username para el feed de galeria; exact=true
        // usa eq, exact=false usa ilike (fallback case-insensitive). limit(1).
        // Cubre artist-gallery-feed.js:94 (exact) y :107 (ilike).
        findByUsername(username, columns, { exact = true } = {}) {
            const q = from('artists_db').select(publicOnly(columns));
            return (exact ? q.eq('username', username) : q.ilike('username', username)).limit(1);
        },

        // Disponibilidad de username: filas con ese username tomadas por OTRO
        // usuario. limit(1); el caller interpreta data.length === 0 como disponible.
        // Cubre register.js:812.
        isUsernameAvailable(username, currentUserId) {
            return from('artists_db').select('user_id').eq('username', username).neq('user_id', currentUserId).limit(1);
        },

        // --- listados publicos / batch ---

        // Todos los artistas publicos (RLS acota a finalizados). columns variable
        // (ARTIST_PUBLIC_COLUMNS). Cubre script.js:2154 (fetchAllArtists),
        // marketplace.js:142 (fetchArtists).
        listPublic(columns = '*') {
            return from('artists_db').select(publicOnly(columns));
        },

        // Lista completa de artistas para soporte/backoffice (select('*')).
        // Cubre support-dashboard.js:197.
        listAll(columns = '*') {
            return supportRows(null, columns);
        },

        // Batch fetch de perfiles por user_ids (.in). columns variable. Cubre
        // client-dashboard.js:1569 (tarjetas de postulacion del job board).
        listByUserIds(userIds, columns = '*') {
            return from('artists_db').select(publicOnly(columns)).in('user_id', userIds);
        },

        // Artistas por username/nombre (ilike sobre or) para invitar al roster.
        // Cubre studio-dashboard.js:762. limit configurable.
        searchByUsernameOrName(term, limit = 8) {
            return from('artists_db')
                .select('user_id, username, name, profile_picture, city, country')
                .or(`username.ilike.%${term}%,name.ilike.%${term}%`)
                .limit(limit);
        },

        // Ciudades de perfiles de artistas (ilike) para autocompletado.
        // Cubre dashboard.js:1101, dashboard.js:1368.
        searchCities(query, limit = 10) {
            return from('artists_db').select('city').ilike('city', `%${query}%`).limit(limit);
        },

        // --- mapa / globo (vista artists_with_location + fallback) ---

        // Vista artists_with_location (perfil + direccion COALESCEada del estudio)
        // para los pines del mapa/globo. columns FIJAS (WITH_LOCATION_SELECT).
        // Cubre explore-map.js:208, explore-globe.js:404.
        listWithLocation(columns = WITH_LOCATION_SELECT) {
            return from('artists_with_location').select(columns);
        },

        // Fallback a artists_db cuando la vista no esta desplegada. columns FIJAS
        // (FOR_MAP_SELECT). Cubre explore-map.js:213, explore-globe.js:408.
        listForMap(columns = FOR_MAP_SELECT) {
            return from('artists_db').select(publicOnly(columns));
        },

        // --- count ---

        // Conteo total de artistas (head:true). Cubre config-manager.js:1186,
        // config-manager.js:1220 (canaria), admin.js:470.
        count() {
            return from('artists_db').select('id', { count: 'exact', head: true });
        },

        // --- updates ---

        // Patch arbitrario del artista por user_id. Cubre dashboard.js (bio:2637,
        // perfil:2853, profile_picture:3024/3095, galeria:3247/3253,
        // verification_state:3835, milestones:4018), register.js:2665
        // (gallery_feed_items), support-dashboard.js:1579 (campo dinamico),
        // admin.js:2213 (con .select('user_id')).
        updateByUserId(userId, patch) {
            return from('artists_db').update(patch).eq('user_id', userId);
        },

        // Variante que devuelve user_id para detectar fallos silenciosos de RLS
        // (data:[]/error:null). Cubre admin.js:2213 (saveArtist).
        updateByUserIdReturning(userId, patch) {
            return from('artists_db').update(patch).eq('user_id', userId).select('user_id');
        },

        // --- upsert ---

        // Crea o actualiza el registro principal del artista (wizard de registro).
        // Cubre register.js (envío final). pii-artistas: con privilegios por
        // columna, `INSERT … ON CONFLICT (user_id) DO UPDATE SET birth_date =
        // excluded.birth_date` desde el navegador falla (42501: Postgres exige
        // SELECT sobre las columnas del DO UPDATE). Va por la RPC security
        // definer upsert_my_artist_profile (fuerza user_id = auth.uid() y solo
        // acepta columnas editables por el artista). Devuelve {data, error};
        // data = { id, user_id, username, name, registration_status }.
        upsertProfile(artistData) {
            return client().rpc('upsert_my_artist_profile', { p_profile: artistData || {} });
        },
    };

    // ===================== artist_tattoo_locations =====================
    const ArtistLocations = {
        // Lista todas las ubicaciones de tatuaje del artista. columns variable.
        // Doble order (sort_order asc, start_date asc nullsFirst). Cubre
        // dashboard.js:779, artist-profile.js:1023, explore-globe.js:440
        // (este ultimo sin el order de start_date; ver listSimpleByArtistUserId).
        listByArtistUserId(artistUserId, columns = '*') {
            return from('artist_tattoo_locations')
                .select(columns)
                .eq('artist_user_id', artistUserId)
                .order('sort_order', { ascending: true })
                .order('start_date', { ascending: true, nullsFirst: true });
        },

        // Variante sin orden (solo eq artist_user_id) para el itinerario del globo.
        // Cubre explore-globe.js:440.
        listSimpleByArtistUserId(artistUserId, columns = '*') {
            return from('artist_tattoo_locations').select(columns).eq('artist_user_id', artistUserId);
        },

        // Ciudades de ubicaciones de tatuaje (ilike) para autocompletado.
        // Cubre dashboard.js:1106, dashboard.js:1373.
        searchCities(query, limit = 10) {
            return from('artist_tattoo_locations').select('city').ilike('city', `%${query}%`).limit(limit);
        },

        // Inserta el set completo de ubicaciones (bulk). Cubre dashboard.js:1524
        // (complemento del delete; ver replaceForArtist).
        insertMany(rows) {
            return from('artist_tattoo_locations').insert(rows);
        },

        // Borra todas las ubicaciones previas del artista. Cubre dashboard.js:1516
        // (primer paso del replace-all).
        deleteByArtistUserId(artistUserId) {
            return from('artist_tattoo_locations').delete().eq('artist_user_id', artistUserId);
        },

        // Replace-all: borra las ubicaciones previas del artista y reinserta el set
        // nuevo. Envuelve delete (1516) + insertMany (1524) de dashboard.js. Devuelve
        // el resultado del delete si falla, o el del insert si el delete fue OK.
        async replaceForArtist(artistUserId, rows) {
            const del = await this.deleteByArtistUserId(artistUserId);
            if (del && del.error) return del;
            if (!rows || !rows.length) return del;
            return this.insertMany(rows);
        },

        // Upsert de la ubicacion/estudio actual del artista durante el registro.
        // onConflict (artist_user_id, period_type, sort_order). Cubre register.js:1942.
        upsertCurrentLocation(row) {
            return from('artist_tattoo_locations').upsert(row, { onConflict: 'artist_user_id,period_type,sort_order' });
        },
    };

    // ===================== artist_profile_visits / _daily =====================
    const ArtistVisits = {
        // Conteo de visitas del artista desde una fecha (head:true). Cubre
        // dashboard-redesign.js:390 (espejo de visitantes, ultimos 7 dias).
        countSince(artistId, sinceIso) {
            return from('artist_profile_visits')
                .select('id', { count: 'exact', head: true })
                .eq('artist_id', artistId)
                .gte('created_at', sinceIso);
        },

        // Visitas crudas al perfil de un artista dentro de un rango temporal
        // (today/week/month) para el mapa de visitantes. Cubre visitors-map.js:157.
        listVisitsByArtistSince(artistId, sinceIso, limit) {
            return from('artist_profile_visits')
                .select('id, event_kind, country, city, latitude, longitude, device_type, os, browser, created_at, ip_hash, device_fingerprint, visitor_user_id, visitor_display_name, visitor_type, visitor_city, visitor_interests, artwork_key, artwork_title, requested_quote')
                .eq('artist_id', artistId)
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false })
                .limit(limit);
        },

        listArtworkCounts(artistId, limit = 20) {
            return from('artist_artwork_view_counts')
                .select('artist_id, artwork_key, artwork_title, views_count, last_viewed_at')
                .eq('artist_id', artistId)
                .order('views_count', { ascending: false })
                .limit(limit);
        },

        // Visitas agregadas por dia de un artista (rango 'all'). Cubre
        // visitors-map.js:183. select('*'); limit por defecto 1000.
        listDailyVisitsByArtist(artistId, limit = 1000) {
            return from('artist_profile_visits_daily')
                .select('*')
                .eq('artist_id', artistId)
                .order('day', { ascending: false })
                .limit(limit);
        },
    };

    // Expone la proyeccion del dashboard para el fallback raw-REST de dashboard.js
    // (unica fuente de verdad de estas columnas; evita duplicar la constante).
    Artists.DASHBOARD_SELECT = DASHBOARD_SELECT;
    Artists.PUBLIC_COLUMNS = PUBLIC_COLUMNS;
    Artists.PRIVATE_COLUMNS = PRIVATE_COLUMNS;
    Artists.needsPrivate = needsPrivate;
    Artists.publicOnly = publicOnly;
    Artists.getOwnProfile = (columns) => ownProfile(columns).maybeSingle();
    Artists.listForSupport = (userIds, columns) => supportRows(userIds, columns);
    D.Artists = Artists;
    D.ArtistLocations = ArtistLocations;
    D.ArtistVisits = ArtistVisits;
})();
