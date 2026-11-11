/**
 * WE OTZI - Repositorio de Invitaciones · estudios (frontend)
 * -----------------------------------------------------------
 * Métodos con nombre para el mapa de estudios, el detalle de estudio ampliado
 * y "Escribir al estudio" de /artist/invitations (Figma 2007:5792–5795).
 * Las invitaciones en sí siguen en WeotziData.StudioMemberships
 * (studios-repo.js); acá vive lo que agrega el Figma final.
 *
 * Contrato: como studios-repo.js, cada método resuelve a `{ data, error }`
 * (nunca lanza) para que la página degrade sin romperse.
 *
 * Backend: las columnas del perfil de trabajo y la RPC contact_studio_as_artist
 * llegan con supabase/migrations/20261028180000_invitaciones_estudios_contacto.sql.
 * Si la migración todavía no está aplicada, los reads reintentan con las
 * columnas base y `contactStudio` devuelve `error.unavailable = true`.
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone window.WeotziData.Invitations.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[invitations-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;
    const client = () => D.getClient();

    const STUDIO_BASE_COLS =
        'id, slug, name, tagline, bio, cover_image, logo_image, photo_feed_items, instagram, website, ' +
        'city, country, locality, formatted_address, latitude, longitude, languages, is_seeking_artists, is_active, user_id';
    const STUDIO_WORK_COLS =
        'specialty_styles, station_count, equipment, artist_requirements, default_revenue_split_pct, ' +
        'accepts_guest_spots, guest_window_start, guest_window_end, accepts_artist_inquiries';
    const LOCATION_COLS = 'id, studio_id, label, is_primary, latitude, longitude, formatted_address, locality, city, country';
    const SPOT_COLS = 'id, studio_id, kind, status, start_date, end_date, revenue_split_pct, minimum_requirements';

    // 42703 = columna inexistente (Postgres); PGRST204 = columna fuera del schema cache.
    function isMissingColumn(error) {
        if (!error) return false;
        return error.code === '42703' || error.code === 'PGRST204'
            || /column .* does not exist|could not find .* column/i.test(String(error.message || ''));
    }

    // PGRST202 / 42883 = la función RPC no existe en este backend.
    function isMissingFunction(error) {
        if (!error) return false;
        return error.code === 'PGRST202' || error.code === '42883'
            || /could not find the function|function .* does not exist/i.test(String(error.message || ''));
    }

    async function safe(builder) {
        try {
            const result = await builder();
            return { data: result && result.data != null ? result.data : null, error: (result && result.error) || null };
        } catch (error) {
            return { data: null, error };
        }
    }

    // Reintenta con las columnas base si las del perfil de trabajo no existen.
    async function withStudioColumns(build) {
        const full = await safe(() => build(`${STUDIO_BASE_COLS}, ${STUDIO_WORK_COLS}`));
        if (!full.error || !isMissingColumn(full.error)) return full;
        return safe(() => build(STUDIO_BASE_COLS));
    }

    const Invitations = {
        STUDIO_BASE_COLS,
        STUDIO_WORK_COLS,
        isMissingColumn,
        isMissingFunction,

        // Sedes principales activas con coordenadas + estudio embebido (mapa).
        listMapLocations() {
            return withStudioColumns((cols) => from('studio_locations')
                .select(`${LOCATION_COLS}, studios:studio_id ( ${cols} )`)
                .eq('is_active', true)
                .eq('is_primary', true)
                .not('latitude', 'is', null)
                .limit(1000));
        },

        // Spots abiertos (todas las oportunidades publicadas) para marcar
        // guest spot / residencia en el mapa.
        listOpenSpots() {
            return safe(() => from('studio_spots').select(SPOT_COLS).eq('status', 'open').limit(1000));
        },

        // Spots abiertos de un estudio (detalle ampliado).
        listOpenSpotsByStudio(studioId) {
            return safe(() => from('studio_spots').select(SPOT_COLS).eq('studio_id', studioId).eq('status', 'open'));
        },

        // Estudio completo para el detalle ampliado. .maybeSingle().
        getStudio(studioId) {
            return withStudioColumns((cols) => from('studios').select(cols).eq('id', studioId).maybeSingle());
        },

        // Sedes activas del estudio (principal primero) para dirección y mapa.
        listStudioLocations(studioId) {
            return safe(() => from('studio_locations')
                .select(LOCATION_COLS)
                .eq('studio_id', studioId)
                .eq('is_active', true)
                .order('is_primary', { ascending: false })
                .order('sort_order', { ascending: true }));
        },

        // Equipo del estudio (roster activo con artista embebido).
        async listStudioRoster(studioId) {
            const memberships = D.StudioMemberships;
            if (!memberships || typeof memberships.listActiveRosterWithArtists !== 'function') {
                return { data: [], error: null };
            }
            const result = await safe(() => memberships.listActiveRosterWithArtists(studioId));
            const rows = (result.data || []).map((row) => row && row.artists_db).filter(Boolean);
            return { data: rows, error: result.error };
        },

        // Hilos "Escribir al estudio" del artista (Inbox unificado).
        async listStudioContacts() {
            const result = await safe(() => client().rpc('list_artist_inbox_threads'));
            if (result.error) return { data: [], error: result.error };
            const rows = Array.isArray(result.data) ? result.data : [];
            return { data: rows.filter((row) => row && row.context_type === 'studio_contact'), error: null };
        },

        // Envía el mensaje del artista al estudio. reason: guest_spot | resident | other.
        async contactStudio({ studioId, reason, message, startDate = null, endDate = null, includePortfolio = true }) {
            const result = await safe(() => client().rpc('contact_studio_as_artist', {
                p_studio_id: studioId,
                p_reason: reason,
                p_message: message,
                p_start_date: startDate || null,
                p_end_date: endDate || null,
                p_include_portfolio: !!includePortfolio,
            }));
            if (result.error && isMissingFunction(result.error)) {
                result.error = Object.assign(new Error('La mensajería con estudios todavía no está disponible.'), {
                    unavailable: true, cause: result.error,
                });
            }
            return result;
        },
    };

    D.Invitations = Invitations;
})();
