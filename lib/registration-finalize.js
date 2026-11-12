'use strict';

// ===========================================================================
// Pasos idempotentes y compensacion del finalize del registro de tatuadores
// (POST /api/register/artist-finalize).
// ---------------------------------------------------------------------------
// Bug de beta (12 nov 2026): el upsert de la membresia usaba
// `on_conflict=studio_id,artist_user_id,role,status`, pero en la base viva no
// hay restriccion unica con esas columnas: hay un indice unico PARCIAL
// `studio_memberships_one_open_per_role (studio_id, artist_user_id, role)
// WHERE status in (requested, pending_invite, pending_acceptance, active,
// paused)`. PostgREST no puede inferir un indice parcial (42P10) y el finalize
// devolvia 500. Ademas el rollback borraba el usuario de Auth DESPUES de haber
// pasado la fila de artists_db a "pendiente de validacion": el ON DELETE
// CASCADE de artists_db.user_id se llevaba el borrador entero y el autosave del
// navegador lo recreaba sin cuenta.
//
// Aca vive la logica pura/inyectable para poder testearla sin red:
//   - upsertOpenStudioMembership: busca la membresia abierta y la actualiza o
//     la inserta (con reintento si otra request gana la carrera).
//   - compensateFailedFinalize: deshace en orden seguro lo que el finalize
//     alcanzo a escribir (membresias -> sede del artista -> fila de artista a
//     borrador -> usuario de Auth -> estudio creado en esta request).
//   - isRepairableFinalizedDraft / pickFinalizeDraft: reglas para reutilizar o
//     reparar una fila huerfana con el mismo email.
//
// `fetchRest(path, { method, body, prefer })` es la capa PostgREST unificada
// del servidor (pgrest.raw / _supabaseFetch).
// ===========================================================================

const REGISTRATION_STATUS_INCOMPLETE = 'incompleto';
const REGISTRATION_STATUS_PENDING_VALIDATION = 'pendiente de validacion';

const OPEN_MEMBERSHIP_STATUSES = Object.freeze([
    'requested', 'pending_invite', 'pending_acceptance', 'active', 'paused'
]);

function enc(value) {
    return encodeURIComponent(String(value));
}

function isUniqueViolation(error) {
    return /23505|duplicate key|unique constraint/i.test(String(error && error.message || ''));
}

async function findOpenStudioMembership(fetchRest, { studioId, artistUserId, role }) {
    const rows = await fetchRest(
        `studio_artist_memberships?studio_id=eq.${enc(studioId)}&artist_user_id=eq.${enc(artistUserId)}` +
        `&role=eq.${enc(role)}&status=in.(${OPEN_MEMBERSHIP_STATUSES.join(',')})` +
        '&select=id,status,location_id,started_at&order=created_at.desc&limit=1'
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function membershipPatch(existing, membership) {
    const patch = {};
    if (membership.location_id && membership.location_id !== existing.location_id) {
        patch.location_id = membership.location_id;
    }
    if (membership.status && membership.status !== existing.status) {
        patch.status = membership.status;
        if (membership.status === 'active' && !existing.started_at) {
            patch.started_at = membership.started_at || new Date().toISOString();
        }
    }
    return patch;
}

async function patchMembership(fetchRest, existing, membership) {
    const patch = membershipPatch(existing, membership);
    if (!Object.keys(patch).length) return { row: existing, created: false };
    const rows = await fetchRest(`studio_artist_memberships?id=eq.${enc(existing.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: patch
    });
    return { row: Array.isArray(rows) && rows[0] ? rows[0] : { ...existing, ...patch }, created: false };
}

// Una sola membresia abierta por (estudio, artista, rol): si existe se
// actualiza; si no, se inserta. Reintentar el finalize nunca duplica ni choca.
async function upsertOpenStudioMembership(fetchRest, membership) {
    if (!membership || !membership.studio_id || !membership.artist_user_id || !membership.role) {
        throw new Error('Membresia incompleta');
    }
    const key = {
        studioId: membership.studio_id,
        artistUserId: membership.artist_user_id,
        role: membership.role
    };
    const existing = await findOpenStudioMembership(fetchRest, key);
    if (existing) return patchMembership(fetchRest, existing, membership);

    try {
        const rows = await fetchRest('studio_artist_memberships', {
            method: 'POST',
            prefer: 'return=representation',
            body: membership
        });
        return { row: Array.isArray(rows) && rows[0] ? rows[0] : null, created: true };
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await findOpenStudioMembership(fetchRest, key);
        if (!raced) throw error;
        return patchMembership(fetchRest, raced, membership);
    }
}

// Una fila "pendiente de validacion" sin user_id y sin usuario de Auth para su
// email es un resto de un finalize fallido: no es una cuenta real y se puede
// volver a finalizar.
function isRepairableFinalizedDraft(row, authUsersForEmail) {
    if (!row) return false;
    if (row.user_id) return false;
    if (row.registration_status !== REGISTRATION_STATUS_PENDING_VALIDATION) return false;
    return !Array.isArray(authUsersForEmail) || authUsersForEmail.length === 0;
}

// Fila a finalizar: la del draft pedido; si el navegador perdio el draft-id,
// la fila sin cuenta (user_id null) mas reciente con ese email.
function pickFinalizeDraft({ byDraftId, byEmail }) {
    if (byDraftId) return byDraftId;
    if (byEmail && !byEmail.user_id) return byEmail;
    return null;
}

async function findReusableDraftByEmail(fetchRest, email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return null;
    const rows = await fetchRest(
        `artists_db?email=eq.${enc(clean)}&user_id=is.null&select=*` +
        '&order=registration_last_saved_at.desc.nullslast&limit=1'
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Deshace un finalize que fallo a mitad de camino. Cada paso es best-effort y
// se registra; el orden importa:
//   1. membresias y sede del artista (referencian artists_db.user_id),
//   2. la fila de artista vuelve a borrador (user_id null) ANTES de borrar el
//      usuario de Auth, para que el ON DELETE CASCADE no se lleve el borrador,
//   3. usuario de Auth creado/adoptado por este intento,
//   4. estudio creado en esta request (si nadie mas lo usa).
async function compensateFailedFinalize(fetchRest, ctx) {
    const {
        draftId,
        artistUserId,
        restoreStudioId = null,
        createdStudioId = null,
        deleteAuthUser,
        log = () => {}
    } = ctx || {};
    const failed = [];
    const step = async (name, fn) => {
        try {
            await fn();
        } catch (error) {
            failed.push(name);
            log(`[register finalize] compensacion "${name}" fallo: ${error && error.message}`);
        }
    };

    if (artistUserId) {
        await step('memberships', () => fetchRest(
            `studio_artist_memberships?artist_user_id=eq.${enc(artistUserId)}`,
            { method: 'DELETE', prefer: 'return=minimal' }
        ));
        await step('tattoo_locations', () => fetchRest(
            `artist_tattoo_locations?artist_user_id=eq.${enc(artistUserId)}`,
            { method: 'DELETE', prefer: 'return=minimal' }
        ));
        if (draftId) {
            await step('artist_row', () => fetchRest(
                `artists_db?registration_draft_id=eq.${enc(draftId)}&user_id=eq.${enc(artistUserId)}`,
                {
                    method: 'PATCH',
                    prefer: 'return=minimal',
                    body: {
                        user_id: null,
                        registration_status: REGISTRATION_STATUS_INCOMPLETE,
                        registration_submitted_at: null,
                        studio_id: restoreStudioId && restoreStudioId !== createdStudioId ? restoreStudioId : null
                    }
                }
            ));
        }
        if (typeof deleteAuthUser === 'function') {
            await step('auth_user', () => deleteAuthUser(artistUserId));
        }
    }

    if (createdStudioId) {
        await step('created_studio', () => fetchRest(
            `studios?id=eq.${enc(createdStudioId)}&user_id=is.null`,
            { method: 'DELETE', prefer: 'return=minimal' }
        ));
    }

    return { failed };
}

module.exports = {
    OPEN_MEMBERSHIP_STATUSES,
    REGISTRATION_STATUS_INCOMPLETE,
    REGISTRATION_STATUS_PENDING_VALIDATION,
    compensateFailedFinalize,
    findOpenStudioMembership,
    findReusableDraftByEmail,
    isRepairableFinalizedDraft,
    isUniqueViolation,
    membershipPatch,
    pickFinalizeDraft,
    upsertOpenStudioMembership
};
