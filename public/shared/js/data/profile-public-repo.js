/**
 * WE OTZI · Repositorio del perfil público y de estadísticas del artista
 * (área perfil-estadisticas · Figma final oct 2026).
 *
 * Expone `window.WeotziData.ProfilePublic` sobre el cliente singleton de la capa
 * PostgREST (postgrest-client.js). Cargar después de config-manager.js y
 * postgrest-client.js.
 *
 * Todos los métodos DEGRADAN: si la tabla/vista/RPC no existe en el backend
 * (migración sin aplicar, RLS, preview) devuelven un valor vacío y registran un
 * warning; nunca lanzan hacia la página.
 */
(function () {
    'use strict';

    const D = (window.WeotziData = window.WeotziData || {});

    function warn(label, error) {
        if (typeof console !== 'undefined') console.warn(`[ProfilePublic.${label}]`, error?.message || error);
    }

    // Columnas de residencias. `country` llega con la migración
    // 20261028160000_artist_residency_country_waitlist; sin ella se reintenta
    // con el set histórico para no ocultar las residencias.
    const RESIDENCY_COLUMNS = 'id, period_type, studio_name, city, country, agenda_status, start_date, end_date, sort_order';
    const RESIDENCY_COLUMNS_LEGACY = 'id, period_type, studio_name, city, agenda_status, start_date, end_date, sort_order';

    const ProfilePublic = {
        // Preferencias públicas (privacidad, extras de perfil y disponibilidad
        // semanal) vía la RPC security-definer `get_artist_public_profile_preferences`.
        async getPreferences(artistUserId) {
            if (!artistUserId) return null;
            try {
                const client = typeof D.getClient === 'function' ? D.getClient() : null;
                if (!client || typeof client.rpc !== 'function') return null;
                const { data, error } = await client.rpc('get_artist_public_profile_preferences', {
                    p_artist_user_id: artistUserId
                });
                if (error) throw error;
                return data && typeof data === 'object' ? data : null;
            } catch (error) {
                warn('getPreferences', error);
                return null;
            }
        },

        // Residencias del artista (artist_tattoo_locations) con país cuando la
        // columna existe.
        async listResidencies(artistUserId) {
            if (!artistUserId || typeof D.from !== 'function') return [];
            const query = (columns) => D.from('artist_tattoo_locations')
                .select(columns)
                .eq('artist_user_id', artistUserId)
                .order('sort_order', { ascending: true })
                .order('start_date', { ascending: true, nullsFirst: true });
            try {
                let { data, error } = await query(RESIDENCY_COLUMNS);
                if (error) ({ data, error } = await query(RESIDENCY_COLUMNS_LEGACY));
                if (error) throw error;
                return Array.isArray(data) ? data : [];
            } catch (error) {
                warn('listResidencies', error);
                return [];
            }
        },

        // Viajes confirmados de Travel en su proyección pública
        // (`artist_public_travel_presences`): ciudad, país, fechas y estudio.
        async listTravelPresences(artistUserId) {
            if (!artistUserId || typeof D.from !== 'function') return [];
            try {
                const { data, error } = await D.from('artist_public_travel_presences')
                    .select('trip_id, city, country, start_date, end_date, trip_type, event_name, studio_name, studio_slug, studio_city, studio_country')
                    .eq('artist_user_id', artistUserId)
                    .order('start_date', { ascending: true });
                if (error) throw error;
                return Array.isArray(data) ? data : [];
            } catch (error) {
                warn('listTravelPresences', error);
                return [];
            }
        },

        // Postulaciones del artista al job board (para la actividad reciente de
        // estadísticas). Solo columnas de estado y título.
        async listJobBoardApplications(artistUserId) {
            if (!artistUserId || typeof D.from !== 'function') return [];
            try {
                const { data, error } = await D.from('job_board_applications')
                    .select('id, status, created_at, updated_at, decided_at, viewed_at, job_board_requests ( id, display_title, tattoo_idea_title, client_display_name, client_city )')
                    .eq('artist_id', artistUserId)
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (error) throw error;
                return Array.isArray(data) ? data : [];
            } catch (error) {
                warn('listJobBoardApplications', error);
                return [];
            }
        }
    };

    D.ProfilePublic = ProfilePublic;
})();
