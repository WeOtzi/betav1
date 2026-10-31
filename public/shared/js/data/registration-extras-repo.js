/**
 * WE OTZI - Repo del área "acceso": extras del registro de artistas
 * -----------------------------------------------------------------
 * Figma final del flujo de artista (oct 2026), registro 04 y 06:
 *   - artists_db.profile_links    jsonb  { website, behance, other }
 *   - artists_db.newsletter_topics text[] (oportunidades, herramientas,
 *                                          avisos, recursos)
 * Migración: supabase/migrations/20261028100000_acceso_registro_extras.sql
 * (NO aplicada todavía). Hasta que se aplique, PostgREST responde 42703/PGRST204
 * ("column does not exist"): los métodos degradan devolviendo
 * { ok:false, missingColumns:true } sin lanzar, y el registro sigue normal
 * (el sitio web principal sigue viajando en `portafolio` y la preferencia en
 * `subscribed_newsletter`).
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone window.WeotziData.Registration.
 */
(function (root) {
    'use strict';

    const NEWSLETTER_TOPICS = ['oportunidades', 'herramientas', 'avisos', 'recursos'];

    function cleanUrl(value) {
        const text = String(value == null ? '' : value).trim();
        return text ? text.slice(0, 500) : null;
    }

    // Normaliza el patch para que la columna jsonb nunca reciba basura.
    function buildExtrasPatch(input) {
        const data = input || {};
        const links = {
            website: cleanUrl(data.website_url),
            behance: cleanUrl(data.behance_url),
            other: cleanUrl(data.other_url)
        };
        const topics = Array.isArray(data.newsletter_topics)
            ? Array.from(new Set(data.newsletter_topics.filter((t) => NEWSLETTER_TOPICS.includes(t))))
            : [];
        return { profile_links: links, newsletter_topics: topics };
    }

    function isMissingColumnError(error) {
        if (!error) return false;
        const code = String(error.code || '');
        const message = String(error.message || '');
        return code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(message);
    }

    // Node (tests): solo la lógica pura.
    if (typeof module === 'object' && module.exports) {
        module.exports = { buildExtrasPatch, isMissingColumnError, NEWSLETTER_TOPICS };
    }

    const D = root && root.WeotziData;
    if (!D || typeof D.from !== 'function') {
        if (root && root.document) console.error('[registration-extras-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    const Registration = {
        NEWSLETTER_TOPICS,
        buildExtrasPatch,
        isMissingColumnError,

        // Guarda enlaces y temas de novedades del artista recién registrado.
        // Nunca lanza: devuelve { ok, missingColumns?, error? }.
        async saveProfileExtras(userId, input) {
            if (!userId) return { ok: false, error: 'missing-user' };
            try {
                const { error } = await from('artists_db')
                    .update(buildExtrasPatch(input))
                    .eq('user_id', userId);
                if (error) {
                    return { ok: false, missingColumns: isMissingColumnError(error), error };
                }
                return { ok: true };
            } catch (error) {
                return { ok: false, error };
            }
        },

        // Lee los extras para precargar el wizard (reanudar / editar).
        async getProfileExtras(userId) {
            if (!userId) return { data: null, error: null };
            try {
                const { data, error } = await from('artists_db')
                    .select('profile_links, newsletter_topics')
                    .eq('user_id', userId)
                    .maybeSingle();
                if (error) return { data: null, error, missingColumns: isMissingColumnError(error) };
                return { data: data || null, error: null };
            } catch (error) {
                return { data: null, error };
            }
        }
    };

    D.Registration = Registration;
})(typeof window !== 'undefined' ? window : null);
