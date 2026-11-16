'use strict';

// ===========================================================================
// Sesiones · confirmación del cliente, cambios acordados, ubicación y registro
// (ronda 2 · frente "sesiones" · P28 y P27-sesión)
// ---------------------------------------------------------------------------
// Lógica pura del servidor: validación de lo que manda el navegador, vista de
// las sesiones por rol, opciones de ubicación y textos de la disputa. Las
// reglas (3 días, acuerdo de las dos partes, sesiones pasadas) son las de
// public/shared/js/wo-session-model.js y se vuelven a validar en la base
// (migración 20261116150000). Sin red: lib/routes/sesiones.js inyecta el repo.
// ===========================================================================

const Model = require('../public/shared/js/wo-session-model.js');
const { visibleCode } = require('./quote-code');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUOTE_ID_RE = /^[A-Za-z0-9-]{3,64}$/;

function httpError(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.expose = true; // mensaje pensado para el usuario
    if (code) err.code = code;
    return err;
}

// Token que levanta la base → respuesta legible. El orden importa (el primero gana).
const DB_ERRORS = [
    [/23P01|CALENDAR_OVERLAP|SLOT_TAKEN/, 409, 'overlap', 'Ese horario ya no está libre en la agenda del artista. Propón otro.'],
    [/SESSION_NOT_FOUND|REQUEST_NOT_FOUND/, 404, 'not_found', 'No encontramos esa sesión.'],
    [/EDIT_WINDOW_CLOSED/, 409, 'edit_window_closed', `Faltan menos de ${Model.EDIT_WINDOW_DAYS} días para la sesión: ya no se puede modificar. Puedes pedir una disputa a soporte.`],
    [/SESSION_PAST/, 409, 'session_past', 'La sesión ya pasó: no se puede modificar. Puedes calificarla o pedir una disputa.'],
    [/SESSION_CLOSED/, 409, 'session_closed', 'La sesión está cancelada o ya se registró.'],
    [/SESSION_NOT_PAST/, 409, 'session_not_past', 'Podrás calificar la sesión cuando haya pasado.'],
    [/QUOTE_CLOSED/, 409, 'quote_closed', 'La cotización está cerrada.'],
    [/REQUEST_PENDING/, 409, 'request_pending', 'La otra parte ya pidió un cambio: respóndelo antes de proponer otro.'],
    [/REQUEST_CLOSED/, 409, 'request_closed', 'Esa solicitud ya fue respondida o retirada.'],
    [/PROPOSAL_EXPIRED/, 409, 'proposal_expired', 'La fecha propuesta ya pasó. Pide un cambio nuevo.'],
    [/DIRECT_EDIT/, 409, 'direct_edit', 'La sesión todavía no está confirmada: edítala directamente y el cliente recibirá la nueva propuesta.'],
    [/INVALID_PROPOSAL/, 400, 'invalid_proposal', 'Revisa la propuesta: indica una fecha futura o un cambio de lugar o duración.'],
    [/INVALID_FEEDBACK/, 400, 'invalid_feedback', 'Elige de 1 a 5 estrellas y una nota de hasta 2000 caracteres.'],
    [/DISPUTE_ACTIVE/, 409, 'dispute_active', 'Ya hay una disputa abierta sobre este trabajo. Síguela desde tu centro de soporte.'],
    [/NOT_DISPUTABLE/, 409, 'not_disputable', 'Solo se puede abrir una disputa sobre un trabajo aprobado, en curso o terminado.'],
    [/TICKET_LIMIT/, 429, 'ticket_limit', 'Llegaste al máximo de pedidos a soporte por hoy.'],
    [/INVALID_DISPUTE/, 400, 'invalid_dispute', 'Elige un motivo y cuéntanos qué pasó (mínimo 10 caracteres).'],
    [/42501|FORBIDDEN/, 403, 'forbidden', 'Esta sesión no corresponde a tu cuenta.'],
];

function isMissingBackend(err) {
    const text = String((err && err.message) || '');
    return /PGRST202|PGRST204|PGRST205|42883|42P01|42703|Could not find the (function|table|relation)|schema cache/i.test(text);
}

function mapDbError(err) {
    if (err && err.expose) return err;
    const text = String((err && err.message) || '');
    if (isMissingBackend(err)) {
        return httpError(503, 'La confirmación de sesiones todavía no está disponible. Prueba de nuevo en unos minutos.', 'sessions_unavailable');
    }
    for (const [pattern, status, code, message] of DB_ERRORS) {
        if (pattern.test(text)) return httpError(status, message, code);
    }
    return err;
}

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

function roleFor(quote, userId) {
    if (!quote || !userId) return null;
    const id = String(userId).toLowerCase();
    if (quote.client_user_id && String(quote.client_user_id).toLowerCase() === id) return 'client';
    if (quote.artist_id && String(quote.artist_id).toLowerCase() === id) return 'artist';
    return null;
}

// ------------------------------------------------------------------ validación

/** Propuesta de cambio. El cliente propone fecha (y nota); el artista, además, duración y lugar. */
function parseChangeBody(body, role, now = Date.now()) {
    const b = body && typeof body === 'object' ? body : {};
    const out = { proposed_date: null, duration_hours: null, location: null, location_kind: null, location_ref: null, location_place_id: null, note: null };
    if (b.proposed_date != null && b.proposed_date !== '') {
        const date = Model.toDate(b.proposed_date);
        if (!date) throw httpError(400, 'La fecha propuesta no es válida.', 'invalid_proposal');
        if (date.getTime() <= now) throw httpError(400, 'La fecha propuesta tiene que ser futura.', 'invalid_proposal');
        if (date.getTime() > now + 730 * 24 * 60 * 60 * 1000) throw httpError(400, 'La fecha propuesta es demasiado lejana.', 'invalid_proposal');
        out.proposed_date = date.toISOString();
    }
    if (role === 'artist') {
        if (b.duration_hours != null && b.duration_hours !== '') {
            const hours = Number(b.duration_hours);
            if (!Number.isFinite(hours) || hours < 0.25 || hours > 24) {
                throw httpError(400, 'La duración tiene que estar entre 15 minutos y 24 horas.', 'invalid_proposal');
            }
            out.duration_hours = Math.round(hours * 100) / 100;
        }
        const location = Model.normalizeLocation(b);
        if (!location.ok) throw httpError(400, location.error, 'invalid_proposal');
        if (location.value) Object.assign(out, location.value);
    }
    const note = Model.clean(b.note);
    if (note.length > Model.NOTE_MAX) throw httpError(400, `La nota no puede superar los ${Model.NOTE_MAX} caracteres.`, 'invalid_proposal');
    out.note = note || null;
    if (!out.proposed_date && out.duration_hours == null && !out.location) {
        throw httpError(400, role === 'artist'
            ? 'Indica qué quieres cambiar: fecha, duración o lugar.'
            : 'Indica la fecha que te queda mejor.', 'invalid_proposal');
    }
    return out;
}

function parseRespondBody(body) {
    const b = body && typeof body === 'object' ? body : {};
    const decision = String(b.decision || '').toLowerCase();
    if (decision !== 'accept' && decision !== 'reject') throw httpError(400, 'Indica si aceptas o rechazas el cambio.', 'invalid_decision');
    const note = Model.clean(b.note);
    if (note.length > Model.NOTE_MAX) throw httpError(400, `La nota no puede superar los ${Model.NOTE_MAX} caracteres.`, 'invalid_decision');
    return { accept: decision === 'accept', note: note || null };
}

function parseFeedbackBody(body) {
    const b = body && typeof body === 'object' ? body : {};
    const rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'Elige de 1 a 5 estrellas.', 'invalid_feedback');
    const note = String(b.note == null ? '' : b.note).trim();
    if (note.length > Model.FEEDBACK_NOTE_MAX) {
        throw httpError(400, `El registro no puede superar los ${Model.FEEDBACK_NOTE_MAX} caracteres.`, 'invalid_feedback');
    }
    return { rating, note: note || null };
}

function parseDisputeBody(body) {
    const b = body && typeof body === 'object' ? body : {};
    const reason = String(b.reason || '');
    if (!Model.disputeReasonLabel(reason)) throw httpError(400, 'Elige el motivo de la disputa.', 'invalid_dispute');
    const description = String(b.description == null ? '' : b.description).trim();
    if (description.length < Model.DISPUTE_MIN) {
        throw httpError(400, `Cuéntanos qué pasó (mínimo ${Model.DISPUTE_MIN} caracteres).`, 'invalid_dispute');
    }
    if (description.length > Model.DISPUTE_MAX) {
        throw httpError(400, `La descripción no puede superar los ${Model.DISPUTE_MAX} caracteres.`, 'invalid_dispute');
    }
    return { reason, description };
}

/** Asunto y descripción del ticket, armados con la sesión GUARDADA. */
function disputeTexts(session, quote, parsed, role) {
    const number = session && session.session_number ? ` ${session.session_number}` : '';
    const reason = Model.disputeReasonLabel(parsed.reason);
    const subject = Model.clean(`Sesión${number}: ${reason}`, 160);
    const date = Model.toDate(session && session.session_date);
    const lines = [
        `Disputa sobre la sesión${number} de la cotización ${quote && quote.quote_id ? quote.quote_id : ''}.`.replace(/\s+\./, '.'),
        `Fecha de la sesión: ${date ? `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'sin fecha'}.`,
        `Estado: ${session && session.status ? session.status : 'scheduled'} · confirmación del cliente: ${Model.confirmationOf(session)}.`,
    ];
    if (session && session.location) lines.push(`Lugar: ${Model.clean(session.location, 300)}.`);
    lines.push(`Abierta por: ${role === 'artist' ? 'el artista' : 'el cliente'}.`, '', parsed.description);
    return { subject, description: lines.join('\n').slice(0, 6000) };
}

// ------------------------------------------------------------------ vistas

function requestView(request, role) {
    if (!request) return null;
    return {
        id: request.id,
        requested_by_role: request.requested_by_role,
        mine: request.requested_by_role === role,
        status: request.status,
        previous_date: request.previous_date || null,
        proposed_date: request.proposed_date || null,
        proposed_duration_hours: request.proposed_duration_hours != null ? Number(request.proposed_duration_hours) : null,
        proposed_location: request.proposed_location || null,
        note: request.note || null,
        response_note: request.response_note || null,
        responded_at: request.responded_at || null,
        created_at: request.created_at || null,
    };
}

function feedbackView(row) {
    if (!row) return null;
    return { rating: Number(row.rating), note: row.note || null, updated_at: row.updated_at || row.created_at || null };
}

function disputeView(row) {
    if (!row) return null;
    const ticket = row.support_tickets || {};
    return {
        ticket_number: ticket.ticket_number != null ? Number(ticket.ticket_number) : null,
        status: ticket.status || 'open',
        active: ['open', 'in_progress', 'waiting_user'].includes(ticket.status || 'open'),
        opened_by_role: row.opened_by_role,
        reason: row.reason,
        created_at: row.created_at || null,
    };
}

/**
 * Vista de una sesión para `role` (sin notas privadas, fotos ni ids de Google).
 * ctx: { role, quote, request, lastRequest, feedback: [filas], dispute, disputeActive, now }
 */
function sessionView(session, ctx) {
    const c = ctx || {};
    const quote = c.quote || {};
    const hasClientAccount = !!quote.client_user_id;
    const request = c.request || null;
    const permissions = Model.permissions(session, {
        role: c.role, hasClientAccount, request, now: c.now,
        quoteStatus: quote.quote_status, disputeActive: !!c.disputeActive,
    });
    const badge = Model.statusBadge(session, { role: c.role, hasClientAccount, request, now: c.now });
    const feedback = Array.isArray(c.feedback) ? c.feedback : [];
    const mine = feedback.find((f) => f.author_role === c.role) || null;
    const other = feedback.find((f) => f.author_role !== c.role) || null;
    const deadline = Model.editDeadline(session);
    return {
        id: session.id,
        quotation_id: session.quotation_id,
        session_number: session.session_number,
        session_date: session.session_date,
        duration_hours: session.duration_hours != null ? Number(session.duration_hours) : null,
        status: session.status,
        phase: Model.phase(session, c.now),
        location: session.location || null,
        location_kind: session.location_kind || null,
        maps_url: session.location ? Model.mapsUrl(session.location, session.location_place_id) : null,
        client_confirmation: Model.confirmationOf(session),
        client_confirmed_at: session.client_confirmed_at || null,
        edit_deadline: deadline ? deadline.toISOString() : null,
        badge,
        request: requestView(request, c.role),
        last_request: requestView(c.lastRequest || null, c.role),
        feedback: { mine: feedbackView(mine), other: feedbackView(other) },
        dispute: disputeView(c.dispute || null),
        can: {
            confirm: permissions.confirm,
            request_change: permissions.requestChange,
            edit_direct: permissions.editDirect,
            respond: permissions.respond,
            withdraw: permissions.withdraw,
            dispute: permissions.dispute,
            rate: permissions.rate,
        },
        locked: permissions.locked,
    };
}

function groupBy(rows, key) {
    const map = new Map();
    for (const row of rows || []) {
        const id = String(row[key]);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(row);
    }
    return map;
}

/** Arma las vistas de varias sesiones de UNA cotización. */
function buildSessionViews({ sessions, pending, recent, feedback, disputes, quote, role, now, disputeActive }) {
    const pendingBySession = new Map((pending || []).map((r) => [String(r.session_id), r]));
    const recentBySession = groupBy(recent, 'session_id');
    const feedbackBySession = groupBy(feedback, 'session_id');
    const disputesBySession = groupBy(disputes, 'session_id');
    return (sessions || []).map((session) => {
        const id = String(session.id);
        return sessionView(session, {
            role, quote, now, disputeActive,
            request: pendingBySession.get(id) || null,
            lastRequest: (recentBySession.get(id) || [])[0] || null,
            feedback: feedbackBySession.get(id) || [],
            dispute: (disputesBySession.get(id) || [])[0] || null,
        });
    });
}

function quoteView(quote, role) {
    const q = quote || {};
    return {
        id: q.id,
        quote_id: q.quote_id,
        quote_status: q.quote_status,
        dispute_status: q.dispute_status || 'none',
        has_client_account: !!q.client_user_id,
        counterpart_name: role === 'client' ? (q.artist_name || 'Tu artista') : (q.client_full_name || 'Tu cliente'),
        artist_name: q.artist_name || '',
        artist_username: q.artist_username || '',
        client_name: role === 'artist' ? (q.client_full_name || '') : '',
        tattoo_body_part: q.tattoo_body_part || '',
    };
}

// ------------------------------------------------------------------ ubicaciones

/**
 * Lugar que eligió el cliente al cotizar (columnas preferred_location_* del
 * frente cot-form, migración 20261116110000). Tolerante: si no existen, null.
 *
 * cot-form guarda la opción elegida en preferred_location_type +
 * preferred_location_ref: 'studio_location' → id de la sede (null si el
 * estudio no tenía sedes), 'artist_location' → id de artist_tattoo_locations,
 * 'trip' → id del viaje, 'artist_base' → sin ref. Devuelve:
 *   id   la SEDE elegida (studio_locations.id) o null
 *   ref  el id de la opción elegida, sea cual sea su tipo, o null
 */
function clientPreferredLocation(quote) {
    const q = quote || {};
    const pick = (...keys) => {
        for (const key of keys) {
            const value = q[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    };
    const label = pick('preferred_location_label', 'preferred_location_name', 'preferred_studio_name');
    const address = pick('preferred_location_address', 'preferred_location_formatted_address', 'preferred_location_text');
    const kind = pick('preferred_location_kind', 'preferred_location_type');
    const ref = pick('preferred_location_ref');
    const explicitId = pick('preferred_location_id', 'preferred_studio_location_id');
    const id = isUuid(explicitId) ? explicitId : (kind === 'studio_location' && isUuid(ref) ? ref : '');
    const studioId = pick('preferred_studio_id', 'preferred_location_studio_id');
    const placeId = pick('preferred_location_place_id', 'preferred_location_google_place_id');
    if (!label && !address && !isUuid(id) && !isUuid(studioId)) return null;
    return {
        label, address, kind,
        id: isUuid(id) ? id.toLowerCase() : null,
        ref: isUuid(ref) ? ref.toLowerCase() : null,
        studio_id: isUuid(studioId) ? studioId.toLowerCase() : null,
        place_id: placeId || null,
        city: pick('preferred_location_city'),
        country: pick('preferred_location_country'),
    };
}

/**
 * Opciones de ubicación para agendar una sesión:
 *   1) la que eligió el cliente al cotizar (si existe),
 *   2) sedes de los estudios donde el artista está en el roster,
 *   3) ubicaciones propias del artista (artist_tattoo_locations),
 *   4) su dirección de perfil.
 * Cada opción: { key, kind, ref, name, address, location, place_id, group }.
 */
function buildLocationOptions({ roster, studios, studioLocations, artistLocations, artist, quote, preferredStudioLocation }) {
    const options = [];
    const seen = new Set();
    const seenRefs = new Set();
    const push = (option) => {
        const location = Model.fullLocation(option.name, option.address);
        if (!location) return;
        const dedupe = location.toLowerCase();
        // Mismo texto o misma fila (la sede o el lugar que eligió el cliente no se
        // repite más abajo entre las sedes del roster o las ubicaciones propias).
        const refKey = option.ref ? String(option.ref).toLowerCase() : '';
        if (seen.has(dedupe) || (refKey && seenRefs.has(refKey))) return;
        seen.add(dedupe);
        if (refKey) seenRefs.add(refKey);
        options.push({
            key: `${option.kind}:${option.ref || options.length}`,
            kind: option.kind,
            ref: option.ref || null,
            name: Model.clean(option.name),
            address: Model.clean(option.address),
            location,
            place_id: option.place_id || null,
            group: option.group,
        });
    };

    const studioById = new Map((studios || []).map((s) => [String(s.id), s]));
    const locationsByStudio = groupBy(studioLocations, 'studio_id');

    // Dirección de un lugar propio del artista (artist_tattoo_locations): la del
    // estudio vinculado si lo tiene; si no, "ciudad, país" de la fila.
    const ownLocationAddress = (row) => {
        const studio = row.studio_id ? studioById.get(String(row.studio_id)) : null;
        const locs = studio ? (locationsByStudio.get(String(studio.id)) || []) : [];
        const primary = locs.find((l) => l.is_primary) || locs[0] || null;
        return {
            address: primary || studio
                ? Model.studioAddress(primary, studio)
                : [Model.clean(row.city), Model.clean(row.country)].filter(Boolean).join(', '),
            place_id: primary && primary.google_place_id ? primary.google_place_id : null,
        };
    };

    const preferred = clientPreferredLocation(quote);
    if (preferred) {
        // "Ciudad, país" guardados con la cotización. Si la etiqueta ya los nombra, no se repiten.
        const cityParts = [Model.clean(preferred.city), Model.clean(preferred.country)].filter(Boolean);
        const labelLower = Model.clean(preferred.label).toLowerCase();
        const cityCountry = cityParts.length && cityParts.every((part) => labelLower.includes(part.toLowerCase()))
            ? '' : cityParts.join(', ');
        let name = preferred.label;
        let address = preferred.address;
        let placeId = preferred.place_id;
        if (preferred.kind === 'artist_location') {
            // Lugar propio del artista: la misma dirección que se arma en "Mis ubicaciones".
            const row = preferred.ref
                ? (artistLocations || []).find((r) => String(r.id).toLowerCase() === preferred.ref) || null
                : null;
            const own = row ? ownLocationAddress(row) : null;
            // Con la fila a mano, el nombre es el del lugar (sin la ciudad que suma la etiqueta
            // del cotizador): queda igual que la opción de "Mis ubicaciones" y no se repite.
            name = (row && Model.clean(row.studio_name)) || name || '';
            address = address || (own && own.address) || cityCountry;
            placeId = placeId || (own && own.place_id) || null;
        } else if (preferred.kind === 'trip' || preferred.kind === 'artist_base') {
            // Viaje publicado o base del perfil: no hay sede, solo ciudad y país.
            address = address || cityCountry;
        } else {
            // Sede de un estudio: la dirección sale de la base.
            const studioKey = (preferredStudioLocation && preferredStudioLocation.studio_id) || preferred.studio_id;
            const studio = studioKey ? studioById.get(String(studioKey)) || null : null;
            const studioLocs = studio ? (locationsByStudio.get(String(studio.id)) || []) : [];
            let loc = preferredStudioLocation
                || (preferred.id ? studioLocs.find((l) => String(l.id).toLowerCase() === preferred.id) : null)
                || null;
            // La sede principal solo vale cuando el cliente eligió el estudio SIN sede. Si eligió
            // una sede y no se pudo cargar, nunca se muestra la dirección de otra (P27): queda
            // "ciudad, país" de la cotización.
            if (!loc && !preferred.id) loc = studioLocs.find((l) => l.is_primary) || studioLocs[0] || null;
            name = name || (studio && studio.name) || (loc && loc.label) || '';
            if (!address) {
                if (loc) address = Model.studioAddress(loc, studio);
                else if (preferred.id) address = cityCountry;
                else address = studio ? Model.studioAddress(null, studio) : cityCountry;
            }
            placeId = placeId || (loc && loc.google_place_id) || null;
        }
        push({
            kind: 'client',
            // location_ref de la sesión: la sede o, si no la hay, la opción que eligió el cliente.
            ref: preferred.id || preferred.ref,
            name,
            address,
            place_id: placeId,
            group: 'Elegida por el cliente',
        });
    }

    for (const membership of roster || []) {
        const studio = studioById.get(String(membership.studio_id));
        if (!studio || studio.is_active === false) continue;
        const locations = locationsByStudio.get(String(studio.id)) || [];
        // Primero la sede del contrato; después el resto de las sedes activas.
        const ordered = locations.slice().sort((a, b) => {
            const am = String(a.id) === String(membership.location_id) ? 0 : 1;
            const bm = String(b.id) === String(membership.location_id) ? 0 : 1;
            return am - bm || (a.is_primary ? 0 : 1) - (b.is_primary ? 0 : 1) || (a.sort_order || 0) - (b.sort_order || 0);
        });
        if (!ordered.length) {
            push({ kind: 'studio', ref: null, name: studio.name, address: Model.studioAddress(null, studio), group: 'Mis estudios' });
            continue;
        }
        for (const loc of ordered) {
            const label = Model.clean(loc.label);
            const name = label && label.toLowerCase() !== Model.clean(studio.name).toLowerCase() && ordered.length > 1
                ? `${studio.name} · ${label}` : studio.name;
            push({
                kind: 'studio', ref: loc.id, name, address: Model.studioAddress(loc, studio),
                place_id: loc.google_place_id || null, group: 'Mis estudios',
            });
        }
    }

    for (const row of artistLocations || []) {
        if (row.period_type === 'upcoming' && row.end_date && String(row.end_date) < new Date().toISOString().slice(0, 10)) continue;
        const own = ownLocationAddress(row);
        push({
            kind: 'own', ref: row.id, name: row.studio_name, address: own.address,
            place_id: own.place_id,
            group: row.period_type === 'upcoming' ? 'Próximas ubicaciones' : 'Mis ubicaciones',
        });
    }

    const a = artist || {};
    const profileAddress = Model.clean(a.formatted_address) || [Model.clean(a.city), Model.clean(a.country)].filter(Boolean).join(', ') || Model.clean(a.ubicacion);
    if (Model.clean(a.estudios) || profileAddress) {
        push({ kind: 'own', ref: null, name: Model.clean(a.estudios) || 'Mi estudio', address: profileAddress, group: 'Mi perfil' });
    }
    return options;
}

// ------------------------------------------------------------------ emails

/** Payload común de los correos de sesión (sin datos privados del cliente). */
function emailPayload(quote, artist, session, extra) {
    const q = quote || {};
    const s = session || {};
    return Object.assign({
        quote_id: q.quote_id,
        // Código que lee la persona (el corto si la cotización lo tiene; CF-03).
        quote_code: visibleCode(q),
        client_email: q.client_email || '',
        client_name: q.client_full_name || '',
        client_user_id: q.client_user_id || null,
        artist_email: (artist && artist.email) || q.artist_email || '',
        artist_name: (artist && artist.name) || q.artist_name || '',
        artist_user_id: q.artist_id || null,
        session_id: s.id,
        session_number: s.session_number,
        session_date: s.session_date,
        duration_hours: s.duration_hours,
        location: s.location || '',
        // Sin sufijo _url: withLinks() descarta del payload toda clave *_url.
        location_maps: s.location ? Model.mapsUrl(s.location, s.location_place_id) : '',
        client_confirmation: Model.confirmationOf(s),
        edit_window_days: Model.EDIT_WINDOW_DAYS,
    }, extra || {});
}

module.exports = {
    Model,
    UUID_RE,
    QUOTE_ID_RE,
    httpError,
    mapDbError,
    isMissingBackend,
    isUuid,
    roleFor,
    parseChangeBody,
    parseRespondBody,
    parseFeedbackBody,
    parseDisputeBody,
    disputeTexts,
    requestView,
    sessionView,
    buildSessionViews,
    quoteView,
    clientPreferredLocation,
    buildLocationOptions,
    emailPayload,
};
