/**
 * WE OTZI - Repositorio del área "oportunidades" (Spots, Figma final oct 2026)
 * ---------------------------------------------------------------------------
 * Métodos con nombre sobre la capa PostgREST unificada para el directorio de
 * Spots (/studio-spots) y el seguimiento de postulaciones (/artist/applications).
 *
 * Lee las columnas nuevas de la migración 20261028170000_oportunidades_figma_final
 * (`studio_spots.benefit_tags`, `studio_spots.availability_summary`). Mientras la
 * migración no esté aplicada, PostgREST responde "column does not exist": cada
 * método reintenta con el select previo de WeotziData.StudioSpots, así la página
 * nunca se rompe (solo faltan las etiquetas/resumen nuevos).
 *
 * Contrato: igual que studios-repo.js — devuelve `{ data, error }` sin lanzar.
 * Carga: DESPUÉS de postgrest-client.js y studios-repo.js.
 * Expone window.WeotziData.SpotsOpportunities.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[spots-opportunities-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    const SPOT_COLUMNS = 'id, title, kind, description, styles_wanted, language_requirements, experience_min_years, includes_housing, revenue_split_pct, stipend_amount, stipend_currency, stipend_frequency, start_date, end_date, weeks_minimum, weeks_maximum, application_count, max_applications, expires_at, cover_image, is_featured, featured_rank, directory_rank, studio_includes, artist_expectations, minimum_requirements, contact_name, contact_title, response_sla_label, benefit_tags, availability_summary';
    const DIRECTORY_SELECT = SPOT_COLUMNS + ', attachments:studio_spot_attachments ( id, file_name, file_url, mime_type, sort_order ), studios:studio_id ( id, slug, name, tagline, bio, cover_image, logo_image, photo_feed_items, instagram, website, primary_location_id ), location:location_id ( id, label, city, country, formatted_address, latitude, longitude )';
    const APPLICATIONS_SELECT = 'id, status, message, portfolio_url, requested_dates, created_at, decided_at, studio_spots ( id, title, kind, description, styles_wanted, includes_housing, revenue_split_pct, stipend_amount, stipend_currency, stipend_frequency, start_date, end_date, weeks_minimum, weeks_maximum, status, cover_image, studio_includes, artist_expectations, minimum_requirements, contact_name, contact_title, response_sla_label, benefit_tags, availability_summary, attachments:studio_spot_attachments ( id, file_name, file_url, mime_type, sort_order ), studios:studio_id ( id, name, slug, logo_image, cover_image, photo_feed_items, instagram, website ), location:location_id ( city, country, label ) )';

    // PostgREST/Postgres: columna inexistente (42703) o fuera del schema cache (PGRST204/PGRST200).
    function isMissingColumn(error) {
        if (!error) return false;
        const code = String(error.code || '');
        const msg = String(error.message || error.details || '').toLowerCase();
        return code === '42703' || code === 'PGRST204' || code === 'PGRST200'
            || (msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find')));
    }

    async function withFallback(primary, fallback, label) {
        let result;
        try {
            result = await primary();
        } catch (error) {
            result = { data: null, error };
        }
        if (result && result.error && isMissingColumn(result.error) && typeof fallback === 'function') {
            console.warn('[spots-opportunities-repo] ' + label + ': migración 20261028170000 sin aplicar, uso el select previo.');
            return fallback();
        }
        return result || { data: null, error: null };
    }

    const SpotsOpportunities = {
        isMissingColumn,

        // Directorio público de spots abiertos (estudio + sede + adjuntos embebidos).
        listOpenDirectory() {
            return withFallback(
                () => from('studio_spots')
                    .select(DIRECTORY_SELECT)
                    .eq('status', 'open')
                    .order('directory_rank', { ascending: true, nullsFirst: false })
                    .order('created_at', { ascending: false }),
                () => D.StudioSpots.listOpenWithStudioAndLocation(),
                'listOpenDirectory'
            );
        },

        // Postulaciones a spots enviadas por el artista, con las etiquetas nuevas.
        listApplicationsByArtist(artistUserId) {
            return withFallback(
                () => from('studio_spot_applications')
                    .select(APPLICATIONS_SELECT)
                    .eq('artist_user_id', artistUserId)
                    .order('created_at', { ascending: false }),
                () => D.StudioSpots.listApplicationsByArtist(artistUserId),
                'listApplicationsByArtist'
            );
        },

        // Contador de la pestaña "Invitaciones · N" del directorio de spots.
        async countPendingInvitations(artistUserId) {
            if (!artistUserId || !D.StudioMemberships || typeof D.StudioMemberships.listPendingForArtist !== 'function') {
                return { data: 0, error: null };
            }
            try {
                const { data, error } = await D.StudioMemberships.listPendingForArtist(artistUserId);
                if (error) return { data: 0, error };
                return { data: Array.isArray(data) ? data.length : 0, error: null };
            } catch (error) {
                return { data: 0, error };
            }
        },
    };

    D.SpotsOpportunities = SpotsOpportunities;
})();
