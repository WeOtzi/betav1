'use strict';

// ===========================================================================
// Repositorio de tendencia del perfil (servidor, service-role), sobre
// lib/postgrest.js. Frente "perfil", ronda 2.
// ---------------------------------------------------------------------------
//   - artist_profile_shares: cada vez que se comparte un perfil.
//   - recalculate_most_wanted(): puntaje y ganadores por zona (RPC).
//   - artist_most_wanted.notified_at: reclamo atómico del aviso al artista.
// Tablas y RPC de la migración 20261116180000_perfil_insignias_most_wanted.sql.
// ===========================================================================

const { pgrest } = require('../postgrest');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = Object.freeze(['copy', 'native', 'whatsapp', 'instagram', 'story', 'facebook', 'x', 'qr', 'other']);

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

function normalizeChannel(value) {
    const channel = String(value || '').trim().toLowerCase();
    return CHANNELS.includes(channel) ? channel : 'other';
}

function createPerfilTrendingRepo({ query = pgrest } = {}) {
    return {
        /** ¿Ya se registró este compartido (misma persona, mismo canal) desde `sinceIso`? */
        async hasRecentShare({ artistId, ipHash, channel, sinceIso }) {
            if (!isUuid(artistId) || !ipHash) return false;
            const rows = await query('artist_profile_shares')
                .select('id')
                .eq('artist_id', artistId)
                .eq('ip_hash', ipHash)
                .eq('channel', normalizeChannel(channel))
                .gte('created_at', sinceIso)
                .limit(1)
                .execute();
            return Array.isArray(rows) && rows.length > 0;
        },

        async insertShare({ artistId, channel, sharerUserId, isOwner, ipHash }) {
            if (!isUuid(artistId)) throw new Error('artistId inválido');
            const rows = await query('artist_profile_shares').insert({
                artist_id: artistId,
                channel: normalizeChannel(channel),
                sharer_user_id: isUuid(sharerUserId) ? sharerUserId : null,
                is_owner: isOwner === true,
                ip_hash: ipHash || null
            });
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        },

        /** Recalcula puntajes y ganadores. Devuelve { scored, zones, winners }. */
        async recalculate({ windowDays = 30, topN = 3 } = {}) {
            const data = await query.raw('rpc/recalculate_most_wanted', {
                method: 'POST',
                body: { p_window_days: windowDays, p_top_n: topN }
            });
            const row = Array.isArray(data) ? data[0] : data;
            return {
                scored: Number(row && row.scored_count) || 0,
                zones: Number(row && row.zone_count) || 0,
                winners: Number(row && row.winner_count) || 0
            };
        },

        /** Ganadores a los que todavía no se les avisó. */
        async listPendingAwards(limit = 25) {
            const rows = await query('artist_most_wanted')
                .select('artist_user_id,zone_label,zone_level,zone_country,rank,awarded_at')
                .is('notified_at', 'null')
                .order('awarded_at', { ascending: true })
                .limit(Math.min(Math.max(Number(limit) || 25, 1), 100))
                .execute();
            return Array.isArray(rows) ? rows : [];
        },

        /** Marca el aviso como tomado; true solo para quien gana la carrera. */
        async claimAward(artistUserId, nowIso = new Date().toISOString()) {
            if (!isUuid(artistUserId)) return false;
            const rows = await query('artist_most_wanted')
                .eq('artist_user_id', artistUserId)
                .is('notified_at', 'null')
                .patch({ notified_at: nowIso });
            return Array.isArray(rows) && rows.length === 1;
        },

        /** Devuelve el aviso a pendiente (el correo no salió). */
        async releaseAward(artistUserId) {
            if (!isUuid(artistUserId)) return;
            await query('artist_most_wanted').eq('artist_user_id', artistUserId).patch({ notified_at: null }, { returning: false });
        },

        /** Contacto del artista para el aviso (columnas privadas: solo servidor). */
        async getArtistContact(artistUserId) {
            if (!isUuid(artistUserId)) return null;
            const rows = await query('artists_db')
                .select('user_id,email,name,username')
                .eq('user_id', artistUserId)
                .limit(1)
                .execute();
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        }
    };
}

module.exports = {
    createPerfilTrendingRepo,
    PerfilTrendingRepo: createPerfilTrendingRepo(),
    CHANNELS,
    normalizeChannel,
    isUuid
};
