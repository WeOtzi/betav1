/**
 * WE OTZI - Repositorio del Marketplace (frontend)
 * ------------------------------------------------
 * Métodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para /marketplace (artistas y estudios). Reemplazan los
 * `WeotziData.from('artist_tattoo_locations' | 'public_review_summary' |
 * 'studios')` inline que vivían en marketplace.js (CLAUDE.md: sin CRUD ad-hoc).
 *
 * Igual que artists-repo / studios-repo: WRAPPERS FINOS que devuelven el
 * builder sin resolver ({ data, error }); el llamador maneja el error.
 * Todo es lectura pública (anon puede leerlo): nunca pide columnas privadas.
 *
 * Carga: DESPUÉS de postgrest-client.js, artists-repo.js y studios-repo.js.
 * Expone window.WeotziData.Marketplace.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[marketplace-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    // Columnas de la grilla (lista corta: sin bio ni feed completo). Todas
    // están en la lista blanca de artists_db (pii-artistas, 20261113106000).
    // gallery_images es la columna derivada que ya excluye lo importado de
    // Instagram sin validar (20261030120000): sirve de media de la card.
    const ARTIST_GRID_COLUMNS = [
        'user_id', 'username', 'name', 'profile_picture', 'gallery_images',
        'styles_array', 'city', 'ubicacion', 'country', 'estudios', 'studio_id', 'work_type',
        'session_price', 'session_price_amount_usd', 'artist_index', 'is_recommended',
        'verification_state', 'vacation_start', 'vacation_end'
    ].join(', ');

    // Columnas públicas del estudio para las cards y los filtros del modo
    // Estudios (Figma 2113:9145). Ninguna es privada (pii-studios, 20261115200100).
    const STUDIO_GRID_COLUMNS = [
        'id', 'slug', 'name', 'tagline', 'cover_image', 'logo_image', 'photo_feed_items',
        'is_verified', 'specialty_styles', 'equipment', 'station_count',
        'accepts_guest_spots', 'guest_window_start', 'guest_window_end', 'is_seeking_artists',
        'city', 'country'
    ].join(', ');

    const Marketplace = {
        ARTIST_GRID_COLUMNS,
        STUDIO_GRID_COLUMNS,

        // Artistas públicos para la grilla. RLS acota a registros completos.
        listArtists(columns = ARTIST_GRID_COLUMNS) {
            if (D.Artists && typeof D.Artists.listPublic === 'function') return D.Artists.listPublic(columns);
            return from('artists_db').select(columns);
        },

        // Agenda pública (artist_tattoo_locations: policy "Public can view
        // tattoo locations"). Solo lo que define disponibilidad / guest / viaje.
        listAgenda() {
            return from('artist_tattoo_locations')
                .select('artist_user_id, period_type, agenda_status, start_date, end_date, city, country');
        },

        // Viajes vigentes de Travel (vista public_artist_trips, 20261115200000).
        // Si la vista todavía no existe el llamador recibe el error y sigue sin ella.
        listUpcomingTrips() {
            return from('public_artist_trips')
                .select('artist_user_id, city, country, start_date, end_date, trip_type');
        },

        // Promedios de reseñas aprobadas (vista pública). type: 'artist' | 'studio'.
        // Para estudios reviewee_user_id es studios.id.
        listReviewSummaries(type) {
            return from('public_review_summary')
                .select('reviewee_user_id, average_rating, review_count')
                .eq('reviewee_type', type);
        },

        // Estudios activos para el modo Estudios.
        listStudios(columns = STUDIO_GRID_COLUMNS) {
            return from('studios')
                .select(columns)
                .eq('is_active', true)
                .order('name', { ascending: true });
        },

        // Sedes activas de un set de estudios (ciudad/país de TODAS las sedes,
        // no solo la principal: el filtro Ubicación las usa).
        listStudioLocations(studioIds) {
            return from('studio_locations')
                .select('studio_id, city, country, is_primary')
                .in('studio_id', studioIds)
                .eq('is_active', true);
        },

        // Nombre/slug de los estudios a los que están afiliados los artistas
        // (filtro Estudio por studio_id real, no por el texto libre `estudios`).
        listStudioNames(studioIds) {
            return from('studios')
                .select('id, name, slug, is_active')
                .in('id', studioIds);
        },
    };

    D.Marketplace = Marketplace;
})();
