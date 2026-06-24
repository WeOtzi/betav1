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
        'profile_picture, gallery_images, gallery_feed_items, embajador, nivel, ' +
        'verification_state, ms_profile_complete, ms_first_quote_received, ' +
        'ms_first_quote_completed, ms_whatsapp_shared, ms_profile_shared, profile_completeness';

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
    const FOR_MAP_SELECT =
        'user_id, username, name, profile_picture, styles_array, city, country, ubicacion, ' +
        'session_price, years_experience, languages, bio_description, is_recommended, ' +
        'latitude, longitude, formatted_address, locality, street, street_number, ' +
        'postal_code, work_type, studio_id, location_source, studio_name';

    // ===================== artists_db =====================
    const Artists = {
        // --- reads por user_id (perfil propio / auth) ---

        // Registro del artista por user_id (auth). columns variable; .maybeSingle().
        // Cubre register.js:1051, studio-spots-directory.js:229, calendar.js:95,
        // archive.js:60, quotations.js:104, reviews.js:332, client-auth.js (varios),
        // job-board-feed.js:287, artist-login.js:107.
        getByUserId(userId, columns = '*') {
            return from('artists_db').select(columns).eq('user_id', userId).maybeSingle();
        },

        // Igual que getByUserId pero con .single() (rutas que exigen fila, p.ej.
        // calendar/archive/quotations initializeAdmin con select('*')).
        getByUserIdSingle(userId, columns = '*') {
            return from('artists_db').select(columns).eq('user_id', userId).single();
        },

        // Registro completo del dashboard del artista (loadArtistData).
        // Cubre dashboard.js:693. columns FIJAS (DASHBOARD_SELECT). .maybeSingle().
        getDashboardByUserId(userId) {
            return from('artists_db').select(DASHBOARD_SELECT).eq('user_id', userId).maybeSingle();
        },

        // Perfil del artista para auth/onboarding (ARTIST_PROFILE_SELECT, sin
        // password) por user_id. Cubre main.js:181, main.js:687.
        getProfileByUserId(userId) {
            return from('artists_db').select(PROFILE_SELECT).eq('user_id', userId).maybeSingle();
        },

        // email + whatsapp_number del usuario (enriquecimiento de logging).
        // Cubre logging-service.js:185. .maybeSingle().
        getContactByUserId(userId) {
            return from('artists_db').select('email, whatsapp_number').eq('user_id', userId).maybeSingle();
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
            return from('artists_db').select(PROFILE_SELECT).eq('email', email).maybeSingle();
        },

        // --- reads por username (perfil publico) ---

        // Perfil publico por username (case-insensitive ilike + .single()). columns
        // variable (ARTIST_PUBLIC_COLUMNS). Cubre script.js:546, script.js:1856.
        getPublicByUsername(username, columns = '*') {
            return from('artists_db').select(columns).ilike('username', username).single();
        },

        // Perfil publico por username con match exacto + .maybeSingle() (pagina
        // publica del artista). columns FIJAS via ARTIST_PUBLIC_FIELDS por defecto,
        // o explicitas. Cubre artist-profile.js:946.
        getPublicByExactUsername(username, columns = '*') {
            return from('artists_db').select(columns).eq('username', username).maybeSingle();
        },

        // Busqueda de un artista por username para el feed de galeria; exact=true
        // usa eq, exact=false usa ilike (fallback case-insensitive). limit(1).
        // Cubre artist-gallery-feed.js:94 (exact) y :107 (ilike).
        findByUsername(username, columns, { exact = true } = {}) {
            const q = from('artists_db').select(columns);
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
            return from('artists_db').select(columns);
        },

        // Lista completa de artistas para soporte/backoffice (select('*')).
        // Cubre support-dashboard.js:197.
        listAll(columns = '*') {
            return from('artists_db').select(columns);
        },

        // Batch fetch de perfiles por user_ids (.in). columns variable. Cubre
        // client-dashboard.js:1569 (tarjetas de postulacion del job board).
        listByUserIds(userIds, columns = '*') {
            return from('artists_db').select(columns).in('user_id', userIds);
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
            return from('artists_db').select(columns);
        },

        // --- count ---

        // Conteo total de artistas (head:true). Cubre config-manager.js:1186,
        // config-manager.js:1220 (canaria), admin.js:470.
        count() {
            return from('artists_db').select('*', { count: 'exact', head: true });
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
        // onConflict 'user_id'; .select(). Cubre register.js:4166.
        upsertProfile(artistData) {
            return from('artists_db').upsert(artistData, { onConflict: 'user_id' }).select();
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
                .select('id, country, city, latitude, longitude, device_type, os, browser, created_at, ip_hash, device_fingerprint')
                .eq('artist_id', artistId)
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false })
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

    D.Artists = Artists;
    D.ArtistLocations = ArtistLocations;
    D.ArtistVisits = ArtistVisits;
})();
