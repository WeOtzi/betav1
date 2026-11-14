'use strict';

// Repositorio del roster de estudios (servidor, service-role). Encapsula el
// acceso a studio_artist_memberships, studio_invite_links y tablas vecinas que
// usan lib/roster-service.js, lib/routes/roster.js y el registro de
// tatuadores. Todo pasa por la capa PostgREST unificada (pgrest.raw); el
// `fetchRest` es inyectable para los tests.

const { pgrest } = require('../postgrest');

const OPEN_STATUSES = ['requested', 'pending_invite', 'pending_acceptance', 'active', 'paused'];
const STUDIO_COLUMNS = 'id,name,slug,user_id,email,is_active,logo_image,city,country,primary_location_id';
const LOCATION_COLUMNS = 'id,studio_id,label,city,country,locality,formatted_address,street,street_number,state_province,postal_code,country_code,latitude,longitude,google_place_id,is_active,is_primary';
const LINK_COLUMNS = 'id,studio_id,location_id,role,requires_approval,label,invitee_email,invitee_name,max_uses,uses_count,expires_at,revoked_at,created_by,created_at';
const MEMBERSHIP_COLUMNS = 'id,studio_id,artist_user_id,location_id,role,status,initiated_by,invited_at,started_at,ended_at,invited_by_user_id';

function enc(value) {
    return encodeURIComponent(String(value));
}

function first(rows) {
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function createStudioRosterRepo(fetchRest = pgrest.raw) {
    const get = (path) => fetchRest(path);
    const rpc = (name, body) => fetchRest(`rpc/${name}`, { method: 'POST', body });

    return {
        async getStudio(studioId) {
            if (!studioId) return null;
            return first(await get(`studios?id=eq.${enc(studioId)}&select=${STUDIO_COLUMNS}&limit=1`));
        },

        async getLocation(locationId) {
            if (!locationId) return null;
            return first(await get(`studio_locations?id=eq.${enc(locationId)}&select=${LOCATION_COLUMNS}&limit=1`));
        },

        async getArtist(userId) {
            if (!userId) return null;
            return first(await get(
                `artists_db?user_id=eq.${enc(userId)}&select=user_id,email,name,username,work_type,estudios,studio_id,city,country,styles_array,portafolio&limit=1`
            ));
        },

        async findArtistByEmail(email) {
            const clean = String(email || '').trim().toLowerCase();
            if (!clean) return null;
            return first(await get(
                `artists_db?email=eq.${enc(clean)}&user_id=not.is.null&select=user_id,email,name,username&limit=1`
            ));
        },

        // Membresía con estudio y artista embebidos (para avisos por email).
        async getMembershipWithParties(membershipId) {
            if (!membershipId) return null;
            return first(await get(
                `studio_artist_memberships?id=eq.${enc(membershipId)}&select=${MEMBERSHIP_COLUMNS},` +
                'studios(id,name,slug,user_id,email,city,country),' +
                'artists_db(user_id,email,name,username),' +
                'location:location_id(id,label,city,country)&limit=1'
            ));
        },

        async findOpenMembership(studioId, artistUserId) {
            return first(await get(
                `studio_artist_memberships?studio_id=eq.${enc(studioId)}&artist_user_id=eq.${enc(artistUserId)}` +
                `&status=in.(${OPEN_STATUSES.join(',')})&select=${MEMBERSHIP_COLUMNS}&order=created_at.desc&limit=1`
            ));
        },

        // Membresía residente activa más reciente del artista (la que define su
        // estudio principal; mismo criterio que el trigger
        // sync_artist_primary_studio_from_membership).
        async getActiveResidentMembership(artistUserId) {
            return first(await get(
                `studio_artist_memberships?artist_user_id=eq.${enc(artistUserId)}&status=eq.active&role=eq.resident` +
                `&select=${MEMBERSHIP_COLUMNS},studios(id,name,city,country),location:location_id(id,label,city,country)` +
                '&order=started_at.desc.nullslast,created_at.desc&limit=1'
            ));
        },

        async patchArtist(userId, patch) {
            return fetchRest(`artists_db?user_id=eq.${enc(userId)}`, {
                method: 'PATCH',
                prefer: 'return=minimal',
                body: patch
            });
        },

        async getCurrentTattooLocation(artistUserId) {
            return first(await get(
                `artist_tattoo_locations?artist_user_id=eq.${enc(artistUserId)}&period_type=eq.current&sort_order=eq.0` +
                '&select=id,studio_id,studio_name,city,country,agenda_status&limit=1'
            ));
        },

        async upsertCurrentTattooLocation(row) {
            return fetchRest('artist_tattoo_locations?on_conflict=artist_user_id,period_type,sort_order', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: { period_type: 'current', sort_order: 0, agenda_status: 'open', ...row }
            });
        },

        async insertMembership(row) {
            return first(await fetchRest('studio_artist_memberships', {
                method: 'POST',
                prefer: 'return=representation',
                body: row
            }));
        },

        async upsertRequestDetails(row) {
            return fetchRest('studio_membership_request_details?on_conflict=membership_id', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: row
            });
        },

        async upsertInvitationDetails(row) {
            return fetchRest('studio_membership_invitation_details?on_conflict=membership_id', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: row
            });
        },

        // ----- enlaces de invitación -----
        async issueInviteLink(params) {
            const result = await rpc('issue_studio_invite_link', {
                p_studio_id: params.studioId,
                p_created_by: params.createdBy,
                p_token_hash: params.tokenHash,
                p_location_id: params.locationId || null,
                p_role: params.role || 'resident',
                p_requires_approval: params.requiresApproval !== false,
                p_max_uses: params.maxUses == null ? null : params.maxUses,
                p_ttl_days: params.ttlDays || 30,
                p_label: params.label || null,
                p_invitee_email: params.inviteeEmail || null,
                p_invitee_name: params.inviteeName || null
            });
            return Array.isArray(result) ? result[0] : result;
        },

        async redeemInviteLink(tokenHash, artistUserId) {
            const result = await rpc('redeem_studio_invite_link', {
                p_token_hash: tokenHash,
                p_artist_user_id: artistUserId
            });
            return (Array.isArray(result) ? result[0] : result) || { status: 'invalid' };
        },

        async getInviteLinkByHash(tokenHash) {
            return first(await get(`studio_invite_links?token_hash=eq.${enc(tokenHash)}&select=${LINK_COLUMNS}&limit=1`));
        },

        async listInviteLinks(studioId, { limit = 50 } = {}) {
            const rows = await get(
                `studio_invite_links?studio_id=eq.${enc(studioId)}&select=${LINK_COLUMNS}&order=created_at.desc&limit=${Number(limit) || 50}`
            );
            return Array.isArray(rows) ? rows : [];
        },

        async revokeInviteLink(linkId, studioId) {
            const rows = await fetchRest(
                `studio_invite_links?id=eq.${enc(linkId)}&studio_id=eq.${enc(studioId)}&revoked_at=is.null`,
                { method: 'PATCH', prefer: 'return=representation', body: { revoked_at: new Date().toISOString() } }
            );
            return first(rows);
        },

        async countRecentEmailInvites(studioId, sinceIso) {
            const rows = await get(
                `studio_invite_links?studio_id=eq.${enc(studioId)}&invitee_email=not.is.null&created_at=gt.${enc(sinceIso)}&select=id`
            );
            return Array.isArray(rows) ? rows.length : 0;
        },

        async isActiveSupportUser(userId) {
            if (!userId) return false;
            const rows = await get(`support_users_db?user_id=eq.${enc(userId)}&is_active=eq.true&select=user_id&limit=1`);
            return Array.isArray(rows) && rows.length > 0;
        }
    };
}

module.exports = { createStudioRosterRepo, OPEN_STATUSES };
