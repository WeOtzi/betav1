'use strict';

// ── turnos ── Rutas de turnos disponibles y reservas online.
// Registro: require('./lib/routes/turnos').register(app, { gcalService }) en server.js.
//
// Artista (Bearer del artista):
//   GET  /api/calendar/availability?summary=1[&from&to]  resumen + turnos propios
//   GET  /api/calendar/booking-settings                  reglas de turno
//   PUT  /api/calendar/booking-settings                  guardar reglas / opt-in
//   GET  /api/calendar/booking-holds?from&to             apartados pendientes (calendario)
//   POST /api/turnos/holds/:id/confirm                   aceptar el turno → sesión
// Artista o cliente de la cotización:
//   GET  /api/turnos/quotations/:id/hold                 turno pedido de una cotización
//   POST /api/turnos/holds/:id/release                   liberar un apartado
// Público (sin sesión; solo inicio/fin de turnos libres, nunca eventos ni PII):
//   GET  /api/public/artists/:username/slots?from&to&granularity=day|slot
// Cron:
//   POST /api/turnos/maintenance/expire (X-Cron-Token) + job interno cada 15 min.

const crypto = require('node:crypto');
const Model = require('../../public/shared/js/booking-slots-model.js');
const { resolveBearerUser } = require('../auth/supabase-auth');
const { applicationBase } = require('../../services/email-request-context');
const { BookingRepo } = require('../repos/booking');
const { defaultService } = require('../booking-slots');
const notify = require('../turnos-notify');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.expose = true; // mensaje pensado para el usuario
    if (code) err.code = code;
    return err;
}

// Traduce los errores de las RPC a respuestas legibles.
function mapDbError(err) {
    if (err && err.expose) return err;
    const text = String((err && err.message) || '');
    if (notify.isMissingRpcError(err)) return httpError(503, 'Las reservas online todavía no están disponibles.', 'booking_unavailable');
    if (/23P01|SLOT_TAKEN|CALENDAR_OVERLAP/.test(text)) return httpError(409, 'Ese horario ya está ocupado por otro turno, evento o cita.', 'slot_taken');
    if (/42501|FORBIDDEN/.test(text)) return httpError(403, 'No podés modificar este turno.', 'forbidden');
    if (/P0002|HOLD_NOT_FOUND/.test(text)) return httpError(404, 'No encontramos ese turno.', 'not_found');
    if (/HOLD_RELEASED/.test(text)) return httpError(409, 'Ese turno ya se liberó. Proponé otro horario.', 'hold_released');
    if (/HOLD_CONFIRMED/.test(text)) return httpError(409, 'Ese turno ya está confirmado: para liberarlo, cancelá la sesión.', 'hold_confirmed');
    if (/QUOTE_CLOSED/.test(text)) return httpError(409, 'La cotización ya está cerrada.', 'quote_closed');
    if (/23514|check constraint/i.test(text)) return httpError(400, 'Revisá los valores de la configuración.', 'invalid');
    return err;
}

// Solo los errores propios (expose) llegan al cliente con su texto: un error
// crudo de PostgREST (con detalles de la base) se responde como 500 genérico.
function sendError(res, err, fallback) {
    const mapped = mapDbError(err);
    const exposed = !!(mapped && mapped.expose);
    const status = exposed && mapped.status >= 400 && mapped.status < 600 ? mapped.status : 500;
    if (!exposed || status >= 500 && status !== 503) console.error('[turnos]', fallback, mapped && (mapped.code || mapped.message));
    return res.status(status).json({
        success: false,
        code: exposed && mapped.code ? mapped.code : undefined,
        error: exposed ? mapped.message : fallback,
    });
}

function settingsView(settings) {
    const s = Model.normalizeSettings(settings);
    return {
        enabled: !!s.enabled,
        slot_minutes: s.slot_minutes,
        slot_step_minutes: s.slot_step_minutes,
        buffer_minutes: s.buffer_minutes,
        min_notice_hours: s.min_notice_hours,
        horizon_days: s.horizon_days,
        hold_hours: s.hold_hours,
        public_note: s.public_note || null,
    };
}

function holdView(hold, tz) {
    if (!hold) return null;
    return {
        id: hold.id,
        quotation_id: hold.quotation_id,
        status: hold.status,
        starts_at: hold.starts_at,
        ends_at: hold.ends_at,
        expires_at: hold.expires_at,
        session_id: hold.session_id || null,
        released_reason: hold.released_reason || null,
        confirmed_at: hold.confirmed_at || null,
        label: Model.slotLabel(hold.starts_at, tz, hold.ends_at),
        expires_label: hold.expires_at ? Model.slotLabel(hold.expires_at, tz) : null,
        timezone: tz,
        minutes: Math.round((Date.parse(hold.ends_at) - Date.parse(hold.starts_at)) / 60000),
    };
}

function register(app, deps = {}) {
    const repo = deps.repo || BookingRepo;
    const service = deps.service || defaultService();
    const emailService = deps.emailService || require('../../services/email-service');
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const gcalService = deps.gcalService || null;
    const log = deps.log || console;
    const sendEmail = (eventId, payload, options) => emailService.sendEmail(eventId, payload, options);

    async function requireArtist(req) {
        const user = await resolveUser(req);
        if (!user || !user.id) throw httpError(401, 'Iniciá sesión para continuar.');
        const artist = await repo.getArtistById(user.id);
        if (!artist) throw httpError(403, 'Esta sección es para artistas.');
        return { user, artist };
    }

    function requestGcalSync(artistId) {
        if (!gcalService || typeof gcalService.requestSync !== 'function') return;
        Promise.resolve().then(() => gcalService.requestSync(artistId)).catch(() => null);
    }

    // ---------------------------------------------------------------- artista
    app.get('/api/calendar/availability', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { artist } = await requireArtist(req);
            const { ctx, result, summary } = await service.getSummary(artist.user_id);
            const body = {
                success: true,
                enabled: !!ctx.settings.enabled,
                configured: ctx.configured,
                reason: result.reason,
                timezone: ctx.tz,
                username: artist.username || null,
                settings: settingsView(ctx.settings),
                summary,
                next_slot: summary && summary.nextSlot
                    ? Object.assign({ label: Model.slotLabel(summary.nextSlot.start, ctx.tz, summary.nextSlot.end) }, summary.nextSlot)
                    : null,
            };
            if (req.query.from || req.query.to) {
                const range = await service.getSlots(artist.user_id, { from: req.query.from, to: req.query.to, ignoreEnabled: true });
                body.days = Model.publicDays(range.result.days, ctx.tz);
            }
            return res.json(body);
        } catch (err) {
            return sendError(res, err, 'No pudimos calcular tus turnos disponibles.');
        }
    });

    app.get('/api/calendar/booking-settings', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { artist } = await requireArtist(req);
            const ctx = await service.context(artist.user_id);
            return res.json({
                success: true,
                configured: ctx.configured,
                timezone: ctx.tz,
                has_schedule: Model.hasStoredSchedule(ctx.availability),
                username: artist.username || null,
                defaults: settingsView(Model.DEFAULTS),
                settings: settingsView(ctx.settings),
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos leer tu configuración de turnos.');
        }
    });

    app.put('/api/calendar/booking-settings', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { artist } = await requireArtist(req);
            const checked = Model.validateSettings(req.body || {});
            if (!checked.ok) {
                return res.status(400).json({ success: false, code: 'invalid', error: 'Revisá los valores marcados.', errors: checked.errors });
            }
            if (checked.value.enabled) {
                const ctx = await service.context(artist.user_id);
                if (!Model.hasStoredSchedule(ctx.availability)) {
                    return res.status(400).json({
                        success: false, code: 'no_schedule',
                        error: 'Guardá tu horario semanal en Disponibilidad antes de activar las reservas online.',
                    });
                }
            }
            const saved = await repo.upsertSettings(artist.user_id, checked.value);
            service.invalidate(artist.user_id);
            return res.json({ success: true, settings: settingsView(saved || checked.value) });
        } catch (err) {
            return sendError(res, err, 'No pudimos guardar tu configuración de turnos.');
        }
    });

    app.get('/api/calendar/booking-holds', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { artist } = await requireArtist(req);
            const from = Number.isFinite(Date.parse(req.query.from)) ? new Date(req.query.from).toISOString() : new Date().toISOString();
            const toMs = Number.isFinite(Date.parse(req.query.to)) ? Date.parse(req.query.to) : Date.parse(from) + 62 * 86400000;
            const to = new Date(Math.min(toMs, Date.parse(from) + 400 * 86400000)).toISOString();
            const ctx = await service.context(artist.user_id);
            const holds = (await repo.listPendingHolds(artist.user_id, from, to)) || [];
            const quotes = await repo.listQuotationsByIds([...new Set(holds.map((h) => h.quotation_id))]);
            const byId = new Map((quotes || []).map((q) => [String(q.id), q]));
            return res.json({
                success: true,
                timezone: ctx.tz,
                holds: holds.map((h) => Object.assign(holdView(h, ctx.tz), {
                    quote_id: (byId.get(String(h.quotation_id)) || {}).quote_id || null,
                    client_name: (byId.get(String(h.quotation_id)) || {}).client_full_name || null,
                })),
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos leer tus solicitudes de turno.');
        }
    });

    app.post('/api/turnos/holds/:id/confirm', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const holdId = String(req.params.id || '');
            if (!UUID_RE.test(holdId)) throw httpError(400, 'Turno no válido.');
            const { artist } = await requireArtist(req);
            const body = req.body || {};
            let startsAt = null;
            let minutes = null;
            if (body.starts_at != null && body.starts_at !== '') {
                const t = Date.parse(body.starts_at);
                if (!Number.isFinite(t)) throw httpError(400, 'La fecha del turno no es válida.');
                if (t < Date.now() - 5 * 60000) throw httpError(400, 'Elegí un horario futuro.');
                startsAt = new Date(t).toISOString();
            }
            if (body.minutes != null && body.minutes !== '') {
                minutes = Number(body.minutes);
                if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw httpError(400, 'La duración no es válida.');
            }
            const result = await repo.confirmHold(holdId, artist.user_id, startsAt, minutes);
            service.invalidate(artist.user_id);
            requestGcalSync(artist.user_id);
            const ctx = await service.context(artist.user_id);
            if (result && !result.already) {
                const hold = await repo.getHold(holdId);
                const quote = hold ? await repo.getQuotation(hold.quotation_id) : null;
                if (quote && quote.client_email) {
                    sendEmail('booking_slot_confirmed',
                        notify.confirmedPayload({ artist, quote, startsAt: result.starts_at, endsAt: result.ends_at, tz: ctx.tz, baseUrl: applicationBase(req) }),
                        { idempotencyKey: `booking_slot_confirmed:${holdId}` })
                        .catch((err) => log.warn('[turnos] aviso de turno confirmado falló:', err && err.message));
                }
            }
            return res.json({
                success: true,
                session_id: result && result.session_id,
                session_number: result && result.session_number,
                starts_at: result && result.starts_at,
                ends_at: result && result.ends_at,
                already: !!(result && result.already),
                label: result ? Model.slotLabel(result.starts_at, ctx.tz, result.ends_at) : '',
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos reservar el turno.');
        }
    });

    // --------------------------------------------------- artista o cliente
    async function holdAccess(req, quotationId) {
        const user = await resolveUser(req);
        if (!user || !user.id) throw httpError(401, 'Iniciá sesión para continuar.');
        const quote = await repo.getQuotation(quotationId);
        if (!quote) throw httpError(404, 'No encontramos la cotización.');
        const isArtist = quote.artist_id === user.id;
        const isClient = !!quote.client_user_id && quote.client_user_id === user.id;
        if (!isArtist && !isClient) throw httpError(403, 'No podés ver este turno.');
        return { user, quote, role: isArtist ? 'artist' : 'client' };
    }

    app.get('/api/turnos/quotations/:id/hold', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Cotización no válida.');
            const { quote, role } = await holdAccess(req, id);
            const hold = await repo.getLatestHoldForQuotation(id);
            const ctx = quote.artist_id ? await service.context(quote.artist_id) : { tz: Model.DEFAULT_TZ, settings: Model.DEFAULTS };
            const artist = role === 'client' && quote.artist_id ? await repo.getArtistById(quote.artist_id) : null;
            return res.json({
                success: true,
                role,
                timezone: ctx.tz,
                hold: holdView(hold, ctx.tz),
                requested: quote.requested_slot_start ? {
                    start: quote.requested_slot_start,
                    minutes: quote.requested_slot_minutes,
                    label: Model.slotLabel(quote.requested_slot_start, ctx.tz,
                        new Date(Date.parse(quote.requested_slot_start) + (quote.requested_slot_minutes || 0) * 60000).toISOString()),
                } : null,
                slots_url: artist && artist.username ? `/turnos?artist=${encodeURIComponent(artist.username)}` : null,
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos leer el turno de la cotización.');
        }
    });

    app.post('/api/turnos/holds/:id/release', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const holdId = String(req.params.id || '');
            if (!UUID_RE.test(holdId)) throw httpError(400, 'Turno no válido.');
            const user = await resolveUser(req);
            if (!user || !user.id) throw httpError(401, 'Iniciá sesión para continuar.');
            const reason = String((req.body && req.body.reason) || '').replace(/[^a-z_]/gi, '').slice(0, 40) || null;
            const result = await repo.releaseHold(holdId, user.id, reason);
            const hold = await repo.getHold(holdId).catch(() => null);
            if (hold) {
                service.invalidate(hold.artist_user_id);
                requestGcalSync(hold.artist_user_id);
            }
            return res.json({ success: true, status: result && result.status });
        } catch (err) {
            return sendError(res, err, 'No pudimos liberar el turno.');
        }
    });

    // ------------------------------------------------------------- público
    app.get('/api/public/artists/:username/slots', async (req, res) => {
        try {
            const artist = await repo.getPublicArtistByUsername(req.params.username);
            if (!artist) {
                res.set('Cache-Control', 'no-store');
                return res.status(404).json({ success: false, code: 'not_found', error: 'No encontramos a ese artista.' });
            }
            const ctx = await service.context(artist.user_id);
            const publicArtist = {
                username: artist.username,
                name: artist.name || artist.username,
                avatar: artist.profile_picture || null,
                city: artist.city || artist.ubicacion || null,
            };
            res.set('Cache-Control', 'public, max-age=60');
            if (!ctx.settings.enabled) {
                return res.json({ success: true, enabled: false, artist: publicArtist, timezone: ctx.tz });
            }
            const { result } = await service.getSlots(artist.user_id, { from: req.query.from, to: req.query.to });
            const granularity = req.query.granularity === 'day' ? 'day' : 'slot';
            return res.json({
                success: true,
                enabled: true,
                artist: publicArtist,
                timezone: ctx.tz,
                slot_minutes: ctx.settings.slot_minutes,
                horizon_days: ctx.settings.horizon_days,
                min_notice_hours: ctx.settings.min_notice_hours,
                public_note: ctx.settings.public_note || null,
                reason: result.reason,
                granularity,
                days: granularity === 'day' ? Model.dayCounts(result.days) : Model.publicDays(result.days, ctx.tz),
            });
        } catch (err) {
            res.set('Cache-Control', 'no-store');
            return sendError(res, err, 'No pudimos cargar los turnos del artista.');
        }
    });

    // ---------------------------------------------------------------- cron
    const jobDeps = {
        repo,
        sendEmail,
        invalidate: (artistId) => service.invalidate(artistId),
        baseUrl: applicationBase({ headers: {}, get: () => '' }),
        log,
    };

    function tokenEqual(a, b) {
        const x = Buffer.from(String(a || ''));
        const y = Buffer.from(String(b || ''));
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    }

    app.post('/api/turnos/maintenance/expire', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const expected = process.env.CRON_API_TOKEN;
        if (typeof expected !== 'string' || !expected.trim()) {
            return res.status(503).json({ success: false, error: 'El vencimiento de apartados no está configurado.' });
        }
        if (!tokenEqual(req.headers['x-cron-token'], expected)) {
            return res.status(401).json({ success: false, error: 'El token de cron no es válido.' });
        }
        try {
            return res.json(Object.assign({ success: true }, await notify.runHoldExpiryCycle(jobDeps)));
        } catch (err) {
            return sendError(res, err, 'No pudimos vencer los apartados.');
        }
    });

    let stopJob = null;
    if (deps.startJob !== false && notify.holdJobEnabled()) {
        stopJob = notify.startHoldExpiryJob(jobDeps);
    }
    return { service, stopJob };
}

module.exports = { register, mapDbError, settingsView, holdView };
