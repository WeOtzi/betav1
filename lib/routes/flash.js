'use strict';

// ===========================================================================
// Rutas de Flash Tattoos.
// ---------------------------------------------------------------------------
//   POST /api/flash/request   el cliente reserva un flash de la galería
//
// El servidor valida que el flash exista en la galería de ESE artista, que
// esté disponible, que tenga precio y que no sea del propio cliente; toma
// título, precio, moneda, tamaño e imagen de la galería (nunca del navegador)
// y crea la cotización por el camino del cotizador web (services/quotation-
// intake.submitIntake): mismas validaciones, mismo vínculo de cuenta (solo con
// el correo verificado), mismo apartado de turno de 72 h y mismos avisos al
// artista y al cliente. Origen: quotations_db.source = 'flash' + instantánea
// del flash en quotations_db.flash_snapshot.
//
// Lógica pura: lib/flash.js · datos: lib/repos/flash.js.
// ===========================================================================

const Flash = require('../../public/shared/js/flash-model.js');
const flash = require('../flash');
const intake = require('../../services/quotation-intake');
const { resolveBearerUser } = require('../auth/supabase-auth');

const RATE_MESSAGE = 'Estás haciendo muchas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.';

function createLimiter(erl) {
    const rateLimit = erl.rateLimit || erl;
    const ipKey = (req) => (erl.ipKeyGenerator ? erl.ipKeyGenerator(req.ip || '') : String(req.ip || ''));
    return rateLimit({
        windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: ipKey,
        message: { success: false, error: RATE_MESSAGE, rate_limited: true }
    });
}

/**
 * deps (tests): repo, resolveUser, submit (intake.submitIntake), env, now
 */
function createRequestHandler(deps = {}) {
    const repo = deps.repo || require('../repos/flash').FlashRepo;
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const submit = deps.submit || intake.submitIntake;
    const env = deps.env || process.env;
    const inFlight = new Set();

    return async function handleFlashRequest(req, res) {
        res.set('Cache-Control', 'no-store');
        let key = null;
        try {
            const input = flash.normalizeRequest(req.body, deps.now ? deps.now() : new Date());
            if (inFlight.has(input.submissionKey)) {
                return res.status(409).json({ success: false, error: 'Ya estamos enviando tu solicitud. Espera unos segundos.' });
            }
            key = input.submissionKey;
            inFlight.add(key);

            const user = await resolveUser(req);
            const sessionExpired = !!(req.headers && req.headers.authorization && !user);
            const artist = await repo.getArtistByUsername(input.artist);
            const { item, view } = flash.resolveFlash(artist, input.flashId, { user });
            if (view.unique && await repo.hasReservedRequest(artist.user_id, view.id)) {
                return res.status(409).json({ success: false, code: 'flash_reserved',
                    error: 'Este flash ya está reservado por otra persona. Mira los otros flashes del artista.' });
            }

            // La imagen del flash viaja como referencia de la cotización (copia en
            // el bucket quotation-references, nota "Flash del artista").
            const quoteId = intake.deriveQuoteId(input.submissionKey);
            const source = flash.gallerySourceOf(view.image, env.SUPABASE_URL);
            const target = source ? flash.referencePathFor(quoteId, source.ext) : null;
            let copied = false;
            if (source && target) {
                try { copied = await repo.copyFlashImage(source, target); }
                catch (error) { console.warn('[flash] copia de la imagen:', String(error.message || '').slice(0, 160)); }
            }

            const snapshot = Flash.snapshotOf(item, {
                slotMinutes: input.slot ? input.slot.minutes : null,
                slotStart: input.slot ? input.slot.start : null,
                referencePath: copied ? target : null
            });
            const body = flash.buildIntakeBody(input, view, artist, copied ? [target] : []);
            // La instantánea viaja dentro de p_quote: save_web_quotation la guarda
            // en el mismo insert (si el guardado falla, falla la solicitud).
            return await submit(req, res, body, user, {
                sessionExpired,
                prepare: { flash: snapshot }
            });
        } catch (error) {
            return intake.sendError(res, error);
        } finally {
            if (key) inFlight.delete(key);
        }
    };
}

function register(app, deps = {}) {
    const limiter = createLimiter(deps.rateLimit || require('express-rate-limit'));
    app.post('/api/flash/request', limiter, createRequestHandler(deps));
}

module.exports = { register, createRequestHandler, createLimiter };
