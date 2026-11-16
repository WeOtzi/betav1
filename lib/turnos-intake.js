'use strict';

// Envío final de una cotización con turno elegido (frente "turnos").
// services/quotation-intake.js delega aquí SOLO cuando el body trae
// requested_slot y el modo es 'submit' (los autosaves de borrador nunca crean
// apartados). Flujo:
//   1) el servidor confirma que el turno sigue ofrecido (lib/booking-slots);
//   2) save_web_quotation_with_slot guarda la cotización y crea el apartado de
//      forma atómica, con advisory lock por artista (dos clientes, mismo turno:
//      uno gana y el otro recibe 409 slot_taken con turnos alternativos);
//   3) aviso por email al artista (booking_slot_requested).

const Model = require('../public/shared/js/booking-slots-model.js');
const { defaultService, alternativesFrom } = require('./booking-slots');
const notify = require('./turnos-notify');

// Extrae y valida la forma del turno pedido (o null si no corresponde).
function requestedSlot(body) {
    if (!body || body.mode !== 'submit' || !body.requested_slot || typeof body.requested_slot !== 'object') return null;
    const start = Date.parse(body.requested_slot.start);
    const minutes = Number(body.requested_slot.minutes);
    if (!Number.isFinite(start) || !Number.isInteger(minutes) || minutes < 15 || minutes > 1440) return { invalid: true };
    return { start: new Date(start).toISOString(), minutes };
}

function slotError(res, status, code, message, extra = {}) {
    return res.status(status).json(Object.assign({ success: false, code, error: message }, extra));
}

async function alternativesFor(service, artistId, startIso) {
    try {
        const start = Date.parse(startIso);
        const { ctx, result } = await service.getSlots(artistId, {
            from: new Date(start - 3 * 86400000).toISOString(),
            to: new Date(start + 10 * 86400000).toISOString(),
        });
        return alternativesFrom(result.days, startIso).map((s) => ({
            start: s.start, end: s.end, label: Model.slotLabel(s.start, ctx.tz, s.end),
        }));
    } catch (_) {
        return [];
    }
}

/**
 * deps: { repo, service, sendEmail, baseUrl, log }
 * Devuelve la respuesta HTTP ya enviada.
 */
async function handleSlotIntake(res, input, deps = {}) {
    try {
        return await slotIntake(res, input, deps);
    } catch (error) {
        // Nunca se devuelve el error crudo de la base (PostgREST trae detalles internos).
        (deps.log || console).error('[turnos] envío con turno falló:', error && (error.code || error.message));
        if (res.headersSent) return res;
        return slotError(res, 502, 'quote_error', 'No pudimos guardar la cotización. Intenta nuevamente.');
    }
}

async function slotIntake(res, { q, extras, slot, artist }, deps = {}) {
    const service = deps.service || defaultService();
    const repo = deps.repo || require('./repos/booking').BookingRepo;
    const log = deps.log || console;
    if (!slot || slot.invalid) return slotError(res, 400, 'invalid_slot', 'El turno elegido no es válido.');
    if (!artist || !artist.user_id) return slotError(res, 400, 'invalid_slot', 'Elige un artista para pedir un turno.');

    const check = await service.validateRequestedSlot(artist.user_id, slot);
    if (!check.ok && check.code === 'slot_taken' && typeof repo.findActiveHoldByQuoteId === 'function') {
        // El mismo envío ya apartó este turno (se perdió la respuesta): idempotente.
        const prior = await repo.findActiveHoldByQuoteId(q.quote_id).catch(() => null);
        if (prior && Date.parse(prior.hold.starts_at) === Date.parse(slot.start)) {
            const tz = check.ctx ? check.ctx.tz : Model.DEFAULT_TZ;
            return res.json({
                success: true, quote_id: prior.quote.quote_id, status: prior.quote.quote_status,
                slot: { status: 'held', hold_id: prior.hold.id, expires_at: prior.hold.expires_at, start: prior.hold.starts_at,
                    end: prior.hold.ends_at, label: Model.slotLabel(prior.hold.starts_at, tz, prior.hold.ends_at), timezone: tz },
            });
        }
    }
    if (!check.ok) {
        if (check.code === 'booking_disabled') {
            return slotError(res, 409, 'booking_disabled', 'Este artista no está tomando reservas online. Envía la solicitud sin turno y te propone una fecha.');
        }
        if (check.code === 'slot_taken') {
            return slotError(res, 409, 'slot_taken', 'Ese turno ya no está disponible.', {
                alternatives: await alternativesFor(service, artist.user_id, slot.start),
            });
        }
        return slotError(res, 400, 'invalid_slot', 'El turno elegido no es válido.');
    }

    let result;
    try {
        result = await repo.saveWithSlot(q, extras, { start: check.start, minutes: check.minutes });
    } catch (error) {
        if (notify.isMissingRpcError(error)) {
            log.error('[turnos] falta la migración', notify.MIGRATION);
            return slotError(res, 503, 'booking_unavailable', 'Las reservas online no están disponibles en este momento. Envía la solicitud sin turno.');
        }
        throw error;
    }
    service.invalidate(artist.user_id);

    if (result && result.slot_status === 'taken') {
        return slotError(res, 409, 'slot_taken', 'Ese turno se acaba de reservar.', {
            quote_id: result.quote_id || null,
            alternatives: await alternativesFor(service, artist.user_id, slot.start),
        });
    }
    if (result && result.slot_status === 'disabled') {
        return slotError(res, 409, 'booking_disabled', 'Este artista no está tomando reservas online. Envía la solicitud sin turno y te propone una fecha.');
    }

    const tz = check.ctx.tz;
    const endIso = new Date(Date.parse(check.start) + check.minutes * 60000).toISOString();
    if (result && result.slot_status === 'held' && result.hold_id && typeof deps.sendEmail === 'function') {
        const hold = { id: result.hold_id, starts_at: check.start, ends_at: endIso, expires_at: result.expires_at };
        // Flash Tattoos: el aviso dice que es un flash (flash_snapshot lo arma el servidor).
        const flash = q.flash_snapshot && typeof q.flash_snapshot === 'object' ? q.flash_snapshot : null;
        const quote = { id: result.id, quote_id: result.quote_id, client_full_name: q.client_full_name, flash_title: flash ? flash.title : null };
        Promise.resolve()
            .then(() => deps.sendEmail('booking_slot_requested',
                notify.requestedPayload({ artist, quote, hold, tz, baseUrl: deps.baseUrl }),
                { idempotencyKey: `booking_slot_requested:${result.hold_id}` }))
            .catch((err) => log.warn('[turnos] aviso al artista falló:', err && err.message));
    }

    return res.json({
        success: true,
        quote_id: result && result.quote_id,
        status: result && result.status,
        slot: {
            status: (result && result.slot_status) || 'none',
            hold_id: (result && result.hold_id) || null,
            expires_at: (result && result.expires_at) || null,
            start: check.start,
            end: endIso,
            label: Model.slotLabel(check.start, tz, endIso),
            timezone: tz,
        },
    });
}

module.exports = { requestedSlot, handleSlotIntake };
