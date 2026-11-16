'use strict';

// ===========================================================================
// Propuesta del artista (ronda 2 · frente cot-respuesta)
// ---------------------------------------------------------------------------
// P4   "Aceptar y enviar presupuesto": el artista ofrece varias fechas desde
//      un calendario conectado a su agenda real. El servidor recalcula la
//      agenda (motor de turnos + list_artist_blocking_intervals) y RECHAZA lo
//      que choca con algo confirmado. El mensaje llega ya resuelto.
// P25  Mientras la cotización no esté aprobada por ambas partes, el artista
//      reenvía la propuesta: se guarda, queda en el historial y el cliente
//      recibe artist_updated_quotation_proposal.
// P29  Los campos de la cotización manual (desglose, política, notas,
//      términos, complejidad) se guardan en artist_manual_quotes con estado
//      'sent': es lo que ya lee el panel del cliente.
//
// Todo se valida con el modelo compartido con el navegador
// (public/shared/js/quote-respond-model.js). Las dependencias se inyectan
// (deps) para testear sin red; nada de lo secundario (historial, fila manual,
// correo) rompe la propuesta ya guardada.
// ===========================================================================

const Model = require('../public/shared/js/quote-respond-model.js');
const Slots = require('../public/shared/js/booking-slots-model.js');
const { visibleCode } = require('./quote-code');

const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDAR_DAYS = 62;
const UPDATE_EVENT = 'artist_updated_quotation_proposal';

function fail(status, error, code, extra) {
    return Object.assign({ ok: false, status, error, code: code || null }, extra || {});
}

function same(left, right) {
    return !!left && !!right && String(left).toLowerCase() === String(right).toLowerCase();
}

function defaultDeps() {
    const context = require('../services/email-request-context');
    return {
        repo: require('./repos/cot-respuesta').CotRespuestaRepo,
        booking: require('./booking-slots').defaultService(),
        resolveUser: require('./auth/supabase-auth').resolveBearerUser,
        sendEmail: (eventId, payload, options) => require('../services/email-service').sendEmail(eventId, payload, options),
        applicationBase: context.applicationBase,
        withLinks: context.withLinks,
        now: () => Date.now(),
        log: console,
    };
}

function withDefaults(deps) {
    const base = deps && deps.useDefaults === false ? { now: () => Date.now(), log: console } : defaultDeps();
    return Object.assign({}, base, deps || {});
}

// Artista dueño de la cotización. { ok, user, quote } o un fail().
async function authorize(req, quoteId, d) {
    const id = String(quoteId || '').trim();
    if (!QUOTE_ID_RE.test(id)) return fail(400, 'Cotización no válida.', 'invalid_quote');
    const user = await d.resolveUser(req);
    if (!user || !user.id) return fail(401, 'Inicia sesión para continuar.', 'unauthorized');
    const quote = await d.repo.getQuote(id);
    if (!quote) return fail(404, 'No encontramos la cotización.', 'not_found');
    if (!same(quote.artist_id, user.id)) return fail(403, 'Esta cotización no corresponde a tu cuenta.', 'forbidden');
    return { ok: true, user, quote };
}

// Zona horaria, horario semanal, ubicaciones y reglas de turno del artista.
async function artistContext(d, artistId) {
    try {
        const ctx = await d.booking.context(artistId);
        if (ctx && Slots.validTimeZone(ctx.tz)) return ctx;
    } catch (error) {
        (d.log || console).warn('[cot-respuesta] contexto de agenda:', error && error.message);
    }
    return { tz: Slots.DEFAULT_TZ, settings: Slots.normalizeSettings({}), availability: null, locations: [] };
}

/**
 * Agenda confirmada del artista entre dos fechas locales (inclusive), sin lo
 * que ya ocupa esta misma cotización.
 */
async function loadAgenda(d, artistId, quote, ctx, { from, to, minutes, now }) {
    const tz = ctx.tz;
    const fromMs = Slots.wallToUtc(from, 0, tz) - DAY_MS;
    const toMs = Slots.wallToUtc(Slots.addDays(to, 1), 0, tz) + DAY_MS;
    const [blocking, own] = await Promise.all([
        d.repo.listBlocking(artistId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
        Promise.resolve(d.repo.listOwnIntervals(quote.id)).catch(() => []),
    ]);
    return Model.computeAgenda({
        tz, from, to, now, minutes,
        settings: ctx.settings, availability: ctx.availability, locations: ctx.locations,
        busy: Model.confirmedBusy(blocking, own),
    });
}

function conflictMessage(conflicts) {
    const names = conflicts.slice(0, 3).map((c) => c.label).join('; ');
    const more = conflicts.length > 3 ? ` y ${conflicts.length - 3} más` : '';
    return conflicts.length === 1
        ? `Esa fecha ya está ocupada en tu agenda: ${names}. Quítala o elige otra.`
        : `Estas fechas ya están ocupadas en tu agenda: ${names}${more}. Quítalas o elige otras.`;
}

function without(patch, columns) {
    const copy = Object.assign({}, patch);
    columns.forEach((column) => { delete copy[column]; });
    return copy;
}

// ---------------------------------------------------------------- contexto

/**
 * GET …/proposal · lo que el diálogo necesita para abrirse precargado: si la
 * propuesta se puede enviar, la zona horaria del artista y los campos de la
 * cotización manual ya guardados.
 */
async function handleContext(req, quoteId, deps = {}) {
    const d = withDefaults(deps);
    const auth = await authorize(req, quoteId, d);
    if (!auth.ok) return auth;
    const { user, quote } = auth;
    const can = Model.canPropose(quote);
    const ctx = await artistContext(d, user.id);
    let manual = null;
    try {
        const row = await d.repo.getManualByQuoteId(quote.quote_id);
        if (row && same(row.artist_id, user.id)) manual = row;
    } catch (error) {
        (d.log || console).warn('[cot-respuesta] fila manual:', error && error.message);
    }
    return {
        ok: true,
        editable: can.ok,
        reason: can.ok ? null : can.reason,
        code: can.ok ? null : can.code,
        mode: Model.proposalMode(quote),
        timezone: ctx.tz,
        has_schedule: Slots.hasStoredSchedule(ctx.availability),
        has_manual: !!manual,
        extras: Model.extrasFromManual(manual),
        quotation: {
            quote_id: quote.quote_id,
            quote_status: quote.quote_status,
            offered_slots: Array.isArray(quote.offered_slots) ? quote.offered_slots : [],
            proposal_message: quote.proposal_message || null,
            artist_availability: quote.artist_availability || null,
            artist_responded_at: quote.artist_responded_at || null,
        },
    };
}

// ------------------------------------------------------------ disponibilidad

/**
 * GET …/availability?from=AAAA-MM-DD&to=AAAA-MM-DD&minutes=180 · agenda real
 * del artista para el calendario del diálogo (máx. 62 días por pedido).
 */
async function handleAvailability(req, quoteId, query, deps = {}) {
    const d = withDefaults(deps);
    const auth = await authorize(req, quoteId, d);
    if (!auth.ok) return auth;
    const { user, quote } = auth;
    const now = d.now();
    const ctx = await artistContext(d, user.id);
    const today = Slots.zonedDate(now, ctx.tz);
    const q = query || {};
    let from = DATE_RE.test(String(q.from || '')) ? String(q.from) : today;
    if (from < today) from = today;
    let to = DATE_RE.test(String(q.to || '')) ? String(q.to) : Slots.addDays(from, 41);
    if (to < from) to = from;
    if (Model.daysBetween(from, to) + 1 > MAX_CALENDAR_DAYS) to = Slots.addDays(from, MAX_CALENDAR_DAYS - 1);
    if (Model.daysBetween(today, from) > Model.HORIZON_DAYS + 31) return fail(400, 'Elige fechas dentro de los próximos 12 meses.', 'out_of_range');
    const requested = Math.round(Number(q.minutes));
    const minutes = Number.isFinite(requested) && requested >= 15 && requested <= 1440
        ? requested : (Math.round(Number(quote.artist_session_minutes)) || 180);
    const agenda = await loadAgenda(d, user.id, quote, ctx, { from, to, minutes, now });
    return Object.assign({ ok: true, from, to, today }, Model.publicAgenda(agenda));
}

// ----------------------------------------------------------------- propuesta

function updateEmailPayload(d, req, { quote, value, stored, artist }) {
    const base = d.applicationBase(req);
    const deposit = value.depositPct
        ? `${String(value.depositPct).replace('.', ',')} % · ${Model.formatAmount(value.depositAmount)} ${value.currency}`
        : 'Sin anticipo';
    return d.withLinks({
        quote_id: quote.quote_id,
        quote_code: visibleCode(quote),
        client_email: quote.client_email || '',
        client_name: quote.client_full_name || '',
        client_user_id: quote.client_user_id || null,
        artist_name: (artist && artist.name) || quote.artist_name || '',
        artist_username: (artist && artist.username) || quote.artist_username || '',
        recipient_role: 'client',
        recipient_email: quote.client_email || '',
        recipient_user_id: quote.client_user_id || null,
        recipient_name: quote.client_full_name || '',
        budget_text: `${Model.formatAmount(value.amount)} ${value.currency}`,
        deposit_text: deposit,
        sessions_text: Model.sessionsText(value.sessions),
        duration_text: Model.durationText(value.minutes),
        offered_text: stored.map((s) => s.label).join('; '),
        availability_note: value.availabilityNote || '',
        location: value.location || quote.artist_studio_name || '',
        expiry_text: value.expiry.enabled ? `${value.expiry.days} ${value.expiry.days === 1 ? 'día' : 'días'}` : '',
        message_preview: value.message ? value.message.slice(0, 400) : '',
    }, base, 'client');
}

/**
 * POST …/proposal · valida, cruza las fechas con la agenda y guarda.
 * body: ver Model.validateProposal + { offered: [...], validate_only?: true }.
 * Respuestas: 400 invalid / invalid_offer · 409 slot_conflict (con
 * `conflicts`), approved, race · 200 { quotation, updated, first_response }.
 */
async function handleProposal(req, quoteId, body, deps = {}) {
    const d = withDefaults(deps);
    const log = d.log || console;
    const auth = await authorize(req, quoteId, d);
    if (!auth.ok) return auth;
    const { user, quote } = auth;

    const can = Model.canPropose(quote);
    if (!can.ok) return fail(409, can.reason, can.code);
    if (quote.is_archived) return fail(409, 'Desarchiva la cotización antes de enviar una propuesta.', 'archived');

    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const checked = Model.validateProposal(input);
    if (!checked.ok) return fail(400, checked.firstError.message, 'invalid', { errors: checked.errors });
    const value = checked.value;

    const now = d.now();
    const ctx = await artistContext(d, user.id);
    const offers = Model.normalizeOffers(input.offered, { tz: ctx.tz, now });
    if (!offers.ok) return fail(400, offers.errors[0].error, 'invalid_offer', { offer_errors: offers.errors });

    if (offers.value.length) {
        const span = Model.offersSpan(offers.value, ctx.tz);
        let agenda;
        try {
            agenda = await loadAgenda(d, user.id, quote, ctx, { from: span.from, to: span.to, minutes: value.minutes, now });
        } catch (error) {
            log.error('[cot-respuesta] agenda:', error && error.message);
            return fail(503, 'No pudimos comprobar tu agenda. Intenta de nuevo en un momento.', 'agenda_unavailable');
        }
        const conflicts = Model.findConflicts(offers.value, agenda);
        if (conflicts.length) return fail(409, conflictMessage(conflicts), 'slot_conflict', { conflicts });
    }
    if (input.validate_only === true) return { ok: true, validated: true, mode: can.mode };

    const nowIso = new Date(now).toISOString();
    const startedIso = new Date(now - 60 * 1000).toISOString();
    const stored = Model.storedOffers(offers.value, ctx.tz);
    const summary = Model.offersSummary(stored, value.availabilityNote, ctx.tz);
    const patch = Model.quotePatch(value, { status: quote.quote_status, nowIso, offers: stored, summary });

    let saved = null;
    let degraded = false;
    try {
        try {
            saved = await d.repo.saveProposal(quote.id, user.id, quote.quote_status, patch);
        } catch (error) {
            if (!d.repo.isMissingColumn || !d.repo.isMissingColumn(error)) throw error;
            // Migración 20261116120000 sin aplicar: la propuesta se guarda igual
            // (el resumen de fechas viaja en artist_availability).
            degraded = true;
            saved = await d.repo.saveProposal(quote.id, user.id, quote.quote_status, without(patch, Model.OPTIONAL_QUOTE_COLUMNS));
        }
    } catch (error) {
        if (/Invalid status transition/i.test(String(error && error.message))) {
            return fail(409, 'El estado actual de la cotización no admite una propuesta nueva.', 'transition');
        }
        throw error;
    }
    if (!saved) {
        return fail(409, 'La cotización cambió mientras preparabas la propuesta. Actualiza la página y revisa su estado.', 'race');
    }

    const updated = quote.quote_status === 'responded';

    // Campos de la cotización manual (P29).
    let extrasSaved = true;
    try {
        const existing = await d.repo.getManualByQuoteId(quote.quote_id);
        if (existing && !same(existing.artist_id, user.id)) {
            extrasSaved = !value.hasExtras;
            log.warn(`[cot-respuesta] ${quote.quote_id}: la fila manual pertenece a otra cuenta, no se modifica`);
        } else {
            const record = Model.manualRecord(value, { quote, existing, artistId: user.id, nowIso });
            if (record && record.mode === 'insert') await d.repo.insertManual(record.row);
            else if (record) await d.repo.patchManual(record.id, user.id, record.patch);
        }
    } catch (error) {
        extrasSaved = false;
        log.warn('[cot-respuesta] campos de la cotización manual:', error && error.message);
    }

    // Historial: la respuesta nueva la registra el trigger (se completa el
    // actor); la reenviada no cambia de estado y se anota aquí.
    try {
        if (updated) {
            await d.repo.insertHistory({
                quotation_id: quote.id, quote_id: quote.quote_id, old_status: 'responded', new_status: 'responded',
                changed_by: user.id, notes: 'El artista actualizó la propuesta.',
            });
        } else {
            await d.repo.annotateHistory(quote.id, 'responded', startedIso, { changedBy: user.id, notes: 'El artista envió su propuesta.' });
        }
    } catch (error) {
        log.warn('[cot-respuesta] historial:', error && error.message);
    }

    // Aviso al cliente de la propuesta reenviada (P25). La primera respuesta
    // sigue saliendo por artist_responded_quotation, que dispara el detalle.
    let email = null;
    if (updated && quote.client_email) {
        try {
            // El código corto se pide aparte (la columna puede no existir todavía): el
            // correo muestra ese código y no el quote_id interno (CF-03).
            const [artist, shortCode] = await Promise.all([
                Promise.resolve().then(() => (d.repo.getArtist ? d.repo.getArtist(user.id) : null)).catch(() => null),
                Promise.resolve().then(() => (!quote.short_code && d.repo.getShortCode ? d.repo.getShortCode(quote.id) : null)).catch(() => null),
            ]);
            const coded = shortCode ? { ...quote, short_code: shortCode } : quote;
            const result = await d.sendEmail(UPDATE_EVENT, updateEmailPayload(d, req, { quote: coded, value, stored, artist }), {
                idempotencyKey: `cot-respuesta:update:${quote.quote_id}:${nowIso}`,
            });
            email = { ok: !!(result && result.ok), skipped: !!(result && result.skipped) };
        } catch (error) {
            email = { ok: false };
            log.warn(`[cot-respuesta] ${UPDATE_EVENT}:`, error && error.message);
        }
    }

    log.log(`[cot-respuesta] ${user.id} ${updated ? 'actualizó' : 'envió'} la propuesta de ${quote.quote_id}`);
    return {
        ok: true,
        updated,
        first_response: !updated,
        mode: can.mode,
        degraded,
        extras_saved: extrasSaved,
        email,
        quotation: Object.assign({}, saved, degraded ? {} : { offered_slots: stored, proposal_message: value.message || null }),
    };
}

// -------------------------------------------------------------------- acuerdo

/**
 * POST …/agreement-sync · después de "Confirmar acuerdo" o "Editar acuerdo":
 * el anticipo de la fila manual sigue al acordado (el panel de pagos y el del
 * cliente priorizan esa fila). Sin fila manual no hace nada.
 */
async function handleAgreementSync(req, quoteId, deps = {}) {
    const d = withDefaults(deps);
    const auth = await authorize(req, quoteId, d);
    if (!auth.ok) return auth;
    const { user, quote } = auth;
    const manual = await d.repo.getManualByQuoteId(quote.quote_id);
    if (!manual || !same(manual.artist_id, user.id)) return { ok: true, synced: false };
    const patch = Model.agreementManualPatch(quote, manual);
    if (!patch) return { ok: true, synced: false };
    await d.repo.patchManual(manual.id, user.id, Object.assign({ updated_at: new Date(d.now()).toISOString() }, patch));
    return { ok: true, synced: true };
}

module.exports = {
    UPDATE_EVENT,
    MAX_CALENDAR_DAYS,
    authorize,
    loadAgenda,
    conflictMessage,
    updateEmailPayload,
    handleContext,
    handleAvailability,
    handleProposal,
    handleAgreementSync,
};
