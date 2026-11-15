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
        },

        /* ---------- Ronda 2 · insignias y tarjeta para compartir ----------
           Migración 20261116180000_perfil_insignias_most_wanted.sql. Sin ella,
           todo degrada a vacío (el perfil sigue igual que antes). */

        // Insignias públicas del artista (RPC get_artist_public_badges):
        //   { ambassador, most_wanted, most_wanted_rank, most_wanted_zone,
        //     most_wanted_zone_level, most_wanted_since }
        // Nunca trae conteos. null si la RPC no existe o falla.
        async getBadges(artistUserId) {
            if (!artistUserId) return null;
            try {
                const client = typeof D.getClient === 'function' ? D.getClient() : null;
                if (!client || typeof client.rpc !== 'function') return null;
                const { data, error } = await client.rpc('get_artist_public_badges', { p_artist_user_id: artistUserId });
                if (error) throw error;
                return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
            } catch (error) {
                warn('getBadges', error);
                return null;
            }
        },

        // Artistas con la insignia Most Wanted, para grillas y sugerencias
        // (marketplace, cotizador): Map(user_id -> puesto en su zona). Una sola
        // consulta chica (hay pocos ganadores por zona). Vacío si no hay tabla.
        async mostWantedMap() {
            const map = new Map();
            if (typeof D.from !== 'function') return map;
            try {
                const { data, error } = await D.from('artist_most_wanted')
                    .select('artist_user_id, rank')
                    .limit(1000);
                if (error) throw error;
                for (const row of Array.isArray(data) ? data : []) {
                    if (row && row.artist_user_id) map.set(String(row.artist_user_id), Number(row.rank) || 1);
                }
            } catch (error) {
                warn('mostWantedMap', error);
            }
            return map;
        },

        // Tarjeta Open Graph guardada del artista ({ og_path, signature, updated_at }).
        async getShareCard(artistUserId) {
            if (!artistUserId || typeof D.from !== 'function') return null;
            try {
                const { data, error } = await D.from('artist_share_cards')
                    .select('og_path, signature, updated_at')
                    .eq('artist_user_id', artistUserId)
                    .limit(1);
                if (error) throw error;
                return Array.isArray(data) && data[0] ? data[0] : null;
            } catch (error) {
                warn('getShareCard', error);
                return null;
            }
        },

        // Sube la tarjeta OG (Blob JPEG) a la carpeta del artista en el bucket
        // público y registra su ruta. Solo funciona con la sesión del propio
        // artista (política de Storage + RLS). Devuelve la fila o null.
        async saveShareCard(artistUserId, blob, options) {
            const o = options || {};
            const path = String(o.path || '');
            const bucket = o.bucket || 'profile-pictures';
            if (!artistUserId || !blob || !path || path.split('/')[0] !== String(artistUserId).toLowerCase()) return null;
            const client = typeof D.getClient === 'function' ? D.getClient() : null;
            if (!client || !client.storage || typeof D.from !== 'function') return null;
            try {
                const upload = await client.storage.from(bucket)
                    .upload(path, blob, { cacheControl: '31536000', upsert: true, contentType: 'image/jpeg' });
                if (upload.error) throw upload.error;
                const row = {
                    artist_user_id: artistUserId,
                    og_path: path,
                    signature: o.signature ? String(o.signature).slice(0, 64) : null,
                    width: Number(o.width) || 1200,
                    height: Number(o.height) || 630
                };
                const { error } = await D.from('artist_share_cards').upsert(row, { onConflict: 'artist_user_id' });
                if (error) {
                    // Sin fila no sirve el archivo: no se dejan huérfanos.
                    try { await client.storage.from(bucket).remove([path]); } catch (_) { /* limpieza opcional */ }
                    throw error;
                }
                const previous = String(o.previousPath || '');
                if (previous && previous !== path && previous.split('/')[0] === path.split('/')[0] && /\/og-card[^/]*$/.test(previous)) {
                    try { await client.storage.from(bucket).remove([previous]); } catch (_) { /* limpieza opcional */ }
                }
                return row;
            } catch (error) {
                warn('saveShareCard', error);
                return null;
            }
        }
    };

    D.ProfilePublic = ProfilePublic;
})();
