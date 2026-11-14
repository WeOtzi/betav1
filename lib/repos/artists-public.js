'use strict';

// ===========================================================================
// Repositorio del perfil público del artista (servidor), sobre lib/postgrest.js.
// ---------------------------------------------------------------------------
// Lo usa lib/routes/perfil.js para renderizar los meta OG del perfil y
// resolver la URL corta. Lee con la anon key para respetar la RLS de
// artists_db (las filas 'incompleto' no son públicas) y además filtra
// registration_status explícitamente, por si el entorno no tiene
// SUPABASE_ANON_KEY y pgrest cae a la service-role.
// ===========================================================================

const { pgrest } = require('../postgrest');
const PublicUrl = require('../../public/shared/js/artist-public-url.js');

const PUBLIC_COLUMNS = [
    'user_id', 'username', 'name', 'bio_description', 'profile_picture',
    'gallery_images', 'city', 'country', 'styles_array', 'verification_state'
].join(',');

// La RLS publica las filas con registration_status distinto de 'incompleto'
// (incluye null). `neq` solo no alcanza: deja afuera los null.
const PUBLISHED = [
    { col: 'registration_status', op: 'is', val: 'null' },
    { col: 'registration_status', op: 'neq', val: 'incompleto' }
];

function createArtistsPublicRepo({ query = pgrest } = {}) {
    function base() {
        return query('artists_db', { key: 'anon' }).select(PUBLIC_COLUMNS).or(PUBLISHED);
    }

    return {
        /** Artista público por username (con o sin @ / .wo, sin distinguir mayúsculas). */
        async findPublicByUsername(value) {
            const username = PublicUrl.normalizeUsername(value);
            if (!username || username.length > 64) return null;
            const rows = await base().eq('username', username).limit(1).execute();
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        },

        async findPublicByUserId(userId) {
            if (!PublicUrl.isUuid(userId)) return null;
            const rows = await base().eq('user_id', String(userId).toLowerCase()).limit(1).execute();
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        },

        /** Preferencias públicas (privacidad, sello verificado); null si fallan. */
        async getPublicPrefs(userId) {
            if (!PublicUrl.isUuid(userId)) return null;
            try {
                const data = await query.raw('rpc/get_artist_public_profile_preferences', {
                    method: 'POST',
                    key: 'anon',
                    body: { p_artist_user_id: userId }
                });
                return data && typeof data === 'object' ? data : null;
            } catch (_) {
                return null;
            }
        }
    };
}

module.exports = { createArtistsPublicRepo, ArtistsPublicRepo: createArtistsPublicRepo(), PUBLIC_COLUMNS };
