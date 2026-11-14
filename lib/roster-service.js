'use strict';

// ===========================================================================
// Servicio del roster de estudios (beta cerrada · frente roster).
// ---------------------------------------------------------------------------
// Reúne la lógica de servidor de las altas de tatuadores en un estudio:
//   - solicitudes del registro (ROSTER-01) y enlace de invitación (ROSTER-03),
//   - invitación por email a quien no tiene cuenta (ROSTER-06),
//   - avisos por email al estudio y al tatuador (ROSTER-02/09, EM-10),
//   - alineación de estudios / work_type / artist_tattoo_locations cuando la
//     membresía residente queda activa (ROSTER-10).
//
// Todo es inyectable (repo, sendEmail, lookup del email del dueño) para
// testear sin red. Los eventos de email están en services/email-events/roster.js.
// ===========================================================================

const studioInvite = require('./studio-invite');

const ROLE_LABELS = studioInvite.ROLE_LABELS;

function text(value) {
    return String(value == null ? '' : value).trim();
}

function upperName(name) {
    return text(name).toUpperCase();
}

function one(value) {
    return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function locationLabel(location) {
    if (!location) return '';
    return [text(location.label), text(location.city)].filter(Boolean).join(' · ');
}

function artistDisplay(artist) {
    const a = artist || {};
    return text(a.name) || (text(a.username) ? `@${text(a.username)}` : 'Un artista');
}

// ---------------------------------------------------------------------------
// Payloads de email (puros). `base` es la URL pública de la app.
// ---------------------------------------------------------------------------
function buildRosterEmailPayload(kind, ctx) {
    const membership = ctx.membership || {};
    const studio = ctx.studio || one(membership.studios) || {};
    const artist = ctx.artist || one(membership.artists_db) || {};
    const location = ctx.location || one(membership.location) || null;
    const base = text(ctx.base).replace(/\/$/, '');
    const owner = ctx.owner || {};
    const studioName = text(studio.name) || 'El estudio';
    const artistName = artistDisplay(artist);
    const roleLabel = ROLE_LABELS[membership.role] || 'Artista';
    const locLabel = locationLabel(location);
    const studioTeamUrl = `${base}/studio/dashboard#roster`;
    const common = {
        studio_name: studioName,
        artist_name: artistName,
        artist_username: text(artist.username),
        role_label: roleLabel,
        location_label: locLabel,
        membership_id: membership.id || null,
        studio_id: studio.id || membership.studio_id || null
    };
    const greeting = (name) => (text(name) ? `Hola ${text(name).split(/\s+/)[0]},` : 'Hola,');

    if (kind === 'studio_membership_request_created') {
        const message = text(ctx.message);
        return {
            ...common,
            to: owner.email || null,
            recipient_name: owner.name || studioName,
            message,
            subject: `${artistName} quiere sumarse a ${studioName}`,
            body_text: `${greeting(owner.name)}\n\n${artistName} pidió sumarse a ${studioName} como ${roleLabel.toLowerCase()}`
                + `${locLabel ? ` en ${locLabel}` : ''}.${message ? `\n\nMensaje: "${message}"` : ''}\n\nRevisá la solicitud en ${studioTeamUrl}.`,
            cta_url: studioTeamUrl,
            cta_label: 'Revisar solicitud'
        };
    }

    if (kind === 'studio_membership_request_decision') {
        const accepted = membership.status === 'active';
        const url = accepted ? `${base}/artist/invitations` : `${base}/artist/invitations?vista=mapa`;
        return {
            ...common,
            to: text(artist.email) || null,
            recipient_name: text(artist.name),
            decision: accepted ? 'accepted' : 'rejected',
            status_label: accepted ? 'Aprobada' : 'No aprobada',
            subject: accepted ? `${studioName} aprobó tu solicitud` : `Novedades de tu solicitud a ${studioName}`,
            body_text: accepted
                ? `${greeting(artist.name)}\n\n${studioName} aprobó tu solicitud. Ya formás parte de su equipo como ${roleLabel.toLowerCase()}${locLabel ? ` en ${locLabel}` : ''}.\n\nMirá tus estudios en ${url}.`
                : `${greeting(artist.name)}\n\n${studioName} no aprobó tu solicitud por ahora. Seguí explorando estudios en ${url}.`,
            cta_url: url,
            cta_label: accepted ? 'Ver mis estudios' : 'Explorar estudios'
        };
    }

    if (kind === 'studio_invite_link_joined') {
        return {
            ...common,
            to: owner.email || null,
            recipient_name: owner.name || studioName,
            subject: `${artistName} se sumó a ${studioName}`,
            body_text: `${greeting(owner.name)}\n\n${artistName} se sumó a ${studioName} con tu enlace de invitación como ${roleLabel.toLowerCase()}`
                + `${locLabel ? ` en ${locLabel}` : ''}.\n\nPodés editar su rol, sede y reparto en ${studioTeamUrl}.`,
            cta_url: studioTeamUrl,
            cta_label: 'Ver equipo'
        };
    }

    if (kind === 'studio_invitation_response') {
        const accepted = membership.status === 'active';
        return {
            ...common,
            to: owner.email || null,
            recipient_name: owner.name || studioName,
            decision: accepted ? 'accepted' : 'rejected',
            status_label: accepted ? 'Aceptada' : 'Rechazada',
            subject: accepted ? `${artistName} aceptó tu invitación` : `${artistName} rechazó tu invitación`,
            body_text: accepted
                ? `${greeting(owner.name)}\n\n${artistName} aceptó tu invitación y ya forma parte de ${studioName} como ${roleLabel.toLowerCase()}.\n\nVer equipo: ${studioTeamUrl}`
                : `${greeting(owner.name)}\n\n${artistName} rechazó tu invitación a ${studioName}.\n\nVer equipo: ${studioTeamUrl}`,
            cta_url: studioTeamUrl,
            cta_label: 'Ver equipo'
        };
    }

    if (kind === 'studio_artist_invite_email') {
        const message = text(ctx.message);
        return {
            ...common,
            artist_name: text(ctx.inviteeName) || 'Artista',
            to: text(ctx.inviteeEmail) || null,
            recipient_name: text(ctx.inviteeName),
            message,
            subject: `${studioName} te invita a su equipo en We Ötzi`,
            body_text: `${greeting(ctx.inviteeName)}\n\n${studioName} te invitó a sumarte a su equipo en We Ötzi como ${roleLabel.toLowerCase()}`
                + `${locLabel ? ` en ${locLabel}` : ''}.${message ? `\n\nMensaje del estudio: "${message}"` : ''}`
                + `\n\nCreá tu perfil de artista (o ingresá si ya tenés cuenta) con este enlace: ${text(ctx.url)}`,
            cta_url: text(ctx.url),
            cta_label: 'Aceptar invitación'
        };
    }

    throw new Error(`Evento de roster desconocido: ${kind}`);
}

// Patch para artists_db y fila de artist_tattoo_locations cuando la
// membresía residente queda activa (ROSTER-10). Puro.
function buildArtistStudioSync({ artist, membership }) {
    if (!membership || membership.status !== 'active' || membership.role !== 'resident') return null;
    const studio = one(membership.studios) || {};
    const location = one(membership.location) || null;
    const name = upperName(studio.name);
    if (!name) return null;
    const currentType = text(artist && artist.work_type);
    const workType = currentType === 'independent' ? 'both' : (currentType === 'studio' || currentType === 'both' ? currentType : 'studio');
    return {
        artistPatch: { estudios: name, work_type: workType },
        tattooLocation: {
            artist_user_id: membership.artist_user_id,
            studio_id: studio.id || membership.studio_id,
            studio_name: name,
            city: text(location && location.city) || text(studio.city) || null,
            country: text(location && location.country) || text(studio.country) || null
        }
    };
}

// Payload de la membresía que crea el registro de un tatuador (ROSTER-01):
// siempre una SOLICITUD que aprueba el estudio (o soporte), nunca 'active'.
function buildRegistrationRequest({ artistUserId, studioId, locationId, now }) {
    if (!artistUserId || !studioId) return null;
    return {
        artist_user_id: artistUserId,
        studio_id: studioId,
        location_id: locationId || null,
        role: 'resident',
        status: 'requested',
        initiated_by: 'artist',
        invited_at: now || new Date().toISOString()
    };
}

function buildRegistrationRequestDetails({ membershipId, formData }) {
    const data = formData || {};
    const portfolio = text(data.portfolio_url);
    const styles = Array.isArray(data.styles) ? data.styles.map(text).filter(Boolean).slice(0, 20) : [];
    return {
        membership_id: membershipId,
        message: 'Solicitud enviada desde el registro de artista.',
        portfolio_url: /^https?:\/\//i.test(portfolio) && portfolio.length <= 500 ? portfolio : null,
        styles
    };
}

function createRosterService({ repo, sendEmail, getAuthUserEmail = null, log = console } = {}) {
    if (!repo) throw new Error('createRosterService: falta repo');

    async function ownerContact(studio) {
        if (!studio || !studio.user_id) return { email: null, name: null };
        // Primero el email de la cuenta del dueño (privado); si no se puede
        // leer, el email de contacto del estudio.
        let email = null;
        if (typeof getAuthUserEmail === 'function') {
            try { email = await getAuthUserEmail(studio.user_id); } catch (error) {
                log.warn('[roster] no se pudo leer el email del dueño:', error.message);
            }
        }
        if (!email) email = text(studio.email).toLowerCase() || null;
        return { email: email || null, name: text(studio.name) || null };
    }

    async function send(kind, payload, idempotencyKey) {
        if (typeof sendEmail !== 'function') return { ok: false, skipped: true, error: 'Sin servicio de email.' };
        if (!payload.to) return { ok: false, skipped: true, error: 'Sin destinatario.' };
        try {
            return await sendEmail(kind, payload, { idempotencyKey });
        } catch (error) {
            log.warn(`[roster] email ${kind} falló:`, error.message);
            return { ok: false, error: error.message };
        }
    }

    async function loadMembership(membershipId) {
        const membership = await repo.getMembershipWithParties(membershipId);
        if (!membership) return null;
        return {
            membership,
            studio: one(membership.studios) || {},
            artist: one(membership.artists_db) || {},
            location: one(membership.location) || null
        };
    }

    async function notify(kind, membershipId, { base, message = null, membership: preloaded = null } = {}) {
        const loaded = preloaded || await loadMembership(membershipId);
        if (!loaded) return { ok: false, status: 404, error: 'No encontramos ese vínculo.' };
        const owner = /^studio_(membership_request_created|invite_link_joined|invitation_response)$/.test(kind)
            ? await ownerContact(loaded.studio)
            : null;
        const payload = buildRosterEmailPayload(kind, { ...loaded, owner, base, message });
        const day = new Date().toISOString().slice(0, 10);
        const key = kind === 'studio_membership_request_created'
            ? `roster:${kind}:${loaded.membership.id}:${day}`
            : `roster:${kind}:${loaded.membership.id}:${loaded.membership.status}`;
        const result = await send(kind, payload, key);
        return { ok: !!result.ok, sent: !!result.ok && !result.skipped, skipped: !!result.skipped, ...result, membership: loaded.membership };
    }

    // ROSTER-10: alinea estudios, work_type y la ubicación actual con la
    // membresía residente activa. Idempotente; nunca toca artists_db.studio_id
    // (lo mantiene el trigger sync_artist_primary_studio_from_membership).
    async function syncArtistStudio(artistUserId) {
        if (!artistUserId) return { synced: false };
        const membership = await repo.getActiveResidentMembership(artistUserId);
        if (!membership) return { synced: false, reason: 'no_active_resident' };
        const artist = await repo.getArtist(artistUserId);
        if (!artist) return { synced: false, reason: 'no_artist' };
        const plan = buildArtistStudioSync({ artist, membership });
        if (!plan) return { synced: false, reason: 'no_studio' };
        await repo.patchArtist(artistUserId, plan.artistPatch);
        await repo.upsertCurrentTattooLocation(plan.tattooLocation);
        return { synced: true, studio_id: plan.tattooLocation.studio_id, work_type: plan.artistPatch.work_type };
    }

    // ----- enlaces de invitación -----
    async function previewInvite(token, { now = Date.now() } = {}) {
        if (!studioInvite.isWellFormedInviteToken(token)) return { status: 'invalid' };
        const link = await repo.getInviteLinkByHash(studioInvite.hashInviteToken(token));
        if (!link) return { status: 'invalid' };
        const studio = await repo.getStudio(link.studio_id);
        const status = studioInvite.inviteLinkStatus(link, studio, now);
        if (status !== 'valid') return { status, studio: studio ? { name: studio.name } : null };
        const location = link.location_id ? await repo.getLocation(link.location_id) : null;
        const usableLocation = location && location.studio_id === link.studio_id && location.is_active !== false ? location : null;
        return {
            status,
            role: link.role,
            role_label: studioInvite.roleLabel(link.role),
            requires_approval: link.requires_approval !== false,
            personal: Boolean(link.invitee_email),
            expires_at: link.expires_at,
            studio: {
                id: studio.id,
                name: studio.name,
                slug: studio.slug || null,
                logo_image: studio.logo_image || null,
                city: studio.city || null,
                country: studio.country || null
            },
            location: usableLocation ? {
                id: usableLocation.id,
                label: usableLocation.label || null,
                city: usableLocation.city || null,
                country: usableLocation.country || null,
                locality: usableLocation.locality || null,
                formatted_address: usableLocation.formatted_address || null,
                street: usableLocation.street || null,
                street_number: usableLocation.street_number || null,
                state_province: usableLocation.state_province || null,
                postal_code: usableLocation.postal_code || null,
                country_code: usableLocation.country_code || null,
                latitude: usableLocation.latitude ?? null,
                longitude: usableLocation.longitude ?? null,
                google_place_id: usableLocation.google_place_id || null
            } : null
        };
    }

    async function issueInviteLink({ studio, createdBy, input, appBase }) {
        const token = studioInvite.generateInviteToken();
        const row = await repo.issueInviteLink({
            studioId: studio.id,
            createdBy,
            tokenHash: studioInvite.hashInviteToken(token),
            locationId: input.locationId,
            role: input.role,
            requiresApproval: input.requiresApproval,
            maxUses: input.maxUses,
            ttlDays: input.ttlDays,
            label: input.label,
            inviteeEmail: input.inviteeEmail || null,
            inviteeName: input.inviteeName || null
        });
        const base = text(appBase).replace(/\/$/, '');
        return {
            id: row && row.id,
            token,
            url: `${base}${studioInvite.buildJoinPath(token)}`,
            register_url: `${base}${studioInvite.buildRegisterPath(token)}`,
            expires_at: row && row.expires_at,
            role: input.role,
            location_id: input.locationId || null,
            requires_approval: input.requiresApproval !== false,
            max_uses: row && row.max_uses != null ? row.max_uses : input.maxUses
        };
    }

    // Invitación por email (ROSTER-06). Con cuenta de artista: invitación
    // pendiente de aceptar + email studio_roster_invite. Sin cuenta: enlace
    // personal de 1 uso + email studio_artist_invite_email. El resultado
    // visible para el estudio es idéntico en los dos casos.
    async function inviteByEmail({ studio, createdBy, input, appBase }) {
        const base = text(appBase).replace(/\/$/, '');
        const existing = await repo.findArtistByEmail(input.email);
        if (existing && existing.user_id) {
            const open = await repo.findOpenMembership(studio.id, existing.user_id);
            if (!open) {
                const created = await repo.insertMembership({
                    studio_id: studio.id,
                    artist_user_id: existing.user_id,
                    location_id: input.locationId || null,
                    role: input.role,
                    status: 'pending_acceptance',
                    initiated_by: 'studio',
                    invited_at: new Date().toISOString(),
                    invited_by_user_id: createdBy
                });
                if (created && created.id && input.message) {
                    await repo.upsertInvitationDetails({ membership_id: created.id, message: input.message });
                }
                if (created && created.id) {
                    const location = input.locationId ? await repo.getLocation(input.locationId) : null;
                    const url = `${base}/artist/invitations?invitacion=${encodeURIComponent(created.id)}`;
                    const studioName = text(studio.name) || 'El estudio';
                    const roleLabel = (ROLE_LABELS[input.role] || 'artista').toLowerCase();
                    await send('studio_roster_invite', {
                        kind: 'studio_roster_invite',
                        to: existing.email,
                        artist_email: existing.email,
                        to_name: existing.name || existing.username || '',
                        recipient_name: existing.name || existing.username || '',
                        from_name: studioName,
                        studio_name: studioName,
                        subject: `${studioName} te invitó a su roster`,
                        body_text: `Hola${existing.name ? ' ' + existing.name : ''},\n\n${studioName} te invitó como ${roleLabel} a su roster en We Ötzi`
                            + `${location ? ` (${locationLabel(location)})` : ''}.${input.message ? `\n\nMensaje: "${input.message}"` : ''}`
                            + `\n\nPara aceptar o rechazar la invitación, ingresá a ${url}.`,
                        links: { invitations: url },
                        dashboard_url: url,
                        meta: { membership_id: created.id, studio_id: studio.id, role: input.role }
                    }, `roster:studio_roster_invite:${created.id}:invite`);
                }
            }
            return { ok: true };
        }

        const link = await issueInviteLink({
            studio,
            createdBy,
            appBase,
            input: {
                role: input.role,
                locationId: input.locationId,
                requiresApproval: false,
                maxUses: 1,
                ttlDays: 30,
                label: input.name ? `Invitación a ${input.name}` : 'Invitación por email',
                inviteeEmail: input.email,
                inviteeName: input.name
            }
        });
        const location = input.locationId ? await repo.getLocation(input.locationId) : null;
        const payload = buildRosterEmailPayload('studio_artist_invite_email', {
            membership: { role: input.role, studio_id: studio.id },
            studio,
            location,
            base,
            url: link.url,
            message: input.message,
            inviteeEmail: input.email,
            inviteeName: input.name
        });
        await send('studio_artist_invite_email', payload, `roster:studio_artist_invite_email:${link.id}`);
        return { ok: true };
    }

    async function redeemInvite(token, artistUserId) {
        if (!studioInvite.isWellFormedInviteToken(token)) return { status: 'invalid' };
        return repo.redeemInviteLink(studioInvite.hashInviteToken(token), artistUserId);
    }

    // Después de un canje: avisa al dueño y alinea el perfil si quedó activo.
    async function afterRedeem(result, { base, artistUserId = null } = {}) {
        if (!result || !result.membership_id || result.already_member) return;
        if (result.status === 'active') {
            await syncArtistStudio(artistUserId).catch((error) => log.warn('[roster] sync tras el canje falló:', error.message));
            await notify('studio_invite_link_joined', result.membership_id, { base });
        } else if (result.status === 'requested') {
            await notify('studio_membership_request_created', result.membership_id, { base, message: 'Se sumó con el enlace de invitación del estudio.' });
        }
    }

    // ----- registro de tatuadores (ROSTER-01 / ROSTER-03) -----

    // El studio_id que manda el cliente solo se usa si el estudio existe y
    // está activo; si no, el registro cae al find-or-create por nombre.
    async function validateRegistrationStudio(studioId) {
        if (!studioInvite.isUuid(String(studioId || ''))) return null;
        const studio = await repo.getStudio(studioId);
        if (!studio || studio.is_active === false) return null;
        return studio;
    }

    // Token del enlace en el registro: si es válido, fuerza estudio y sede.
    async function resolveRegistrationInvite(token) {
        if (!token) return { ok: false, status: null };
        const preview = await previewInvite(String(token));
        if (preview.status !== 'valid') return { ok: false, status: preview.status, token: String(token) };
        return {
            ok: true,
            status: 'valid',
            token: String(token),
            preview,
            formPatch: {
                studio_id: preview.studio.id,
                studio_name: preview.studio.name,
                studio_location_id: preview.location ? preview.location.id : null
            }
        };
    }

    function applyInviteToFormData(formData, invite) {
        if (!invite || !invite.ok) return formData;
        const data = { ...(formData || {}) };
        const workType = text(data.work_type);
        data.work_type = workType === 'both' ? 'both' : 'studio';
        data.studio_id = invite.formPatch.studio_id;
        data.studio_name = invite.formPatch.studio_name;
        data.studio_location_id = invite.formPatch.studio_location_id;
        return data;
    }

    // Membresía del registro. Con enlace válido: canje (puede quedar 'active'
    // si el estudio no pide aprobación). Sin enlace o si el canje falla:
    // solicitud 'requested' (nunca 'active'). Devuelve { membership, status }.
    async function persistRegistrationMembership({ upsertOpenStudioMembership, fetchRest, artistUserId, studioId, locationId, formData, invite }) {
        if (invite && invite.ok) {
            const redeemed = await redeemInvite(invite.token, artistUserId);
            if (redeemed && redeemed.membership_id && (redeemed.status === 'active' || redeemed.status === 'requested')) {
                return {
                    membershipId: redeemed.membership_id,
                    status: redeemed.status,
                    viaInvite: true,
                    alreadyMember: !!redeemed.already_member
                };
            }
            log.warn('[roster] el canje del enlace en el registro no prosperó:', redeemed && redeemed.status);
        }
        const membership = buildRegistrationRequest({ artistUserId, studioId, locationId });
        if (!membership) return { membershipId: null, status: null };
        const { row, created } = await upsertOpenStudioMembership(fetchRest, membership);
        const membershipId = row && row.id;
        if (membershipId && (created || row.status === 'requested')) {
            await repo.upsertRequestDetails(buildRegistrationRequestDetails({ membershipId, formData }));
        }
        return {
            membershipId: membershipId || null,
            status: (row && row.status) || 'requested',
            viaInvite: false,
            inviteFailed: Boolean(invite && invite.ok)
        };
    }

    return {
        afterRedeem,
        applyInviteToFormData,
        inviteByEmail,
        issueInviteLink,
        notify,
        ownerContact,
        persistRegistrationMembership,
        previewInvite,
        redeemInvite,
        resolveRegistrationInvite,
        syncArtistStudio,
        validateRegistrationStudio
    };
}

module.exports = {
    buildArtistStudioSync,
    buildRegistrationRequest,
    buildRegistrationRequestDetails,
    buildRosterEmailPayload,
    createRosterService,
    locationLabel
};
