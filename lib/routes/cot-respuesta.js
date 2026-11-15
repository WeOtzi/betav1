'use strict';

// ===========================================================================
// Rutas del frente "cot-respuesta" (ronda 2, 16 nov 2026): propuesta del
// artista. Se registran con UNA línea en server.js:
//   require('./lib/routes/cot-respuesta').register(app)
//
// Todas piden la sesión del artista dueño de la cotización (Bearer). :quoteId
// es el quote_id (texto) o el id numérico.
//
//   GET  /api/cot-respuesta/quotations/:quoteId/proposal
//        Contexto del diálogo: si la propuesta se puede enviar, zona horaria
//        del artista y campos de la cotización manual ya guardados.
//   GET  /api/cot-respuesta/quotations/:quoteId/availability?from&to&minutes
//        Agenda real del artista para el calendario (libre / parcial /
//        ocupado por día, turnos sugeridos y lo confirmado).
//   POST /api/cot-respuesta/quotations/:quoteId/proposal
//        Valida y guarda la propuesta. Rechaza (409 slot_conflict) las fechas
//        que chocan con algo confirmado de la agenda. Si la cotización ya
//        estaba respondida, avisa al cliente de la propuesta actualizada.
//   POST /api/cot-respuesta/quotations/:quoteId/agreement-sync
//        Tras el acuerdo, alinea la seña de la fila de la cotización manual.
//
// La lógica vive en lib/cot-respuesta.js (dependencias inyectables).
// ===========================================================================

const logic = require('../cot-respuesta');

function limiter(max) {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiados pedidos seguidos. Intenta de nuevo en unos minutos.' },
    });
}

// Solo lo que el navegador necesita: nunca un error crudo de la base.
function send(res, result, fallback) {
    if (result && result.ok) {
        const { ok, ...rest } = result;
        return res.json(Object.assign({ success: true }, rest));
    }
    const status = result && result.status >= 400 && result.status < 600 ? result.status : 500;
    const body = { success: false, code: (result && result.code) || undefined, error: (result && result.error) || fallback };
    for (const key of ['errors', 'offer_errors', 'conflicts']) {
        if (result && result[key] !== undefined) body[key] = result[key];
    }
    return res.status(status).json(body);
}

function register(app, deps = {}) {
    const readLimiter = typeof deps.readLimiter === 'function' ? deps.readLimiter : limiter(300);
    const writeLimiter = typeof deps.writeLimiter === 'function' ? deps.writeLimiter : limiter(60);
    const logicDeps = deps.logicDeps || {};
    const log = deps.log || console;

    function route(handler, fallback) {
        return async (req, res) => {
            res.set('Cache-Control', 'no-store');
            try {
                return send(res, await handler(req), fallback);
            } catch (error) {
                log.error('[cot-respuesta]', fallback, error && error.message);
                return res.status(500).json({ success: false, error: fallback });
            }
        };
    }

    app.get('/api/cot-respuesta/quotations/:quoteId/proposal', readLimiter, route(
        (req) => logic.handleContext(req, req.params.quoteId, logicDeps),
        'No pudimos cargar la propuesta. Intenta de nuevo.'
    ));

    app.get('/api/cot-respuesta/quotations/:quoteId/availability', readLimiter, route(
        (req) => logic.handleAvailability(req, req.params.quoteId, req.query || {}, logicDeps),
        'No pudimos consultar tu agenda. Intenta de nuevo.'
    ));

    app.post('/api/cot-respuesta/quotations/:quoteId/proposal', writeLimiter, route(
        (req) => logic.handleProposal(req, req.params.quoteId, req.body || {}, logicDeps),
        'No pudimos guardar la propuesta. Intenta de nuevo.'
    ));

    app.post('/api/cot-respuesta/quotations/:quoteId/agreement-sync', writeLimiter, route(
        (req) => logic.handleAgreementSync(req, req.params.quoteId, logicDeps),
        'No pudimos actualizar las condiciones del acuerdo.'
    ));
}

module.exports = { register, send };
