'use strict';

// ===========================================================================
// Rutas del frente "cotizaciones del artista" (beta cerrada, 15 nov 2026).
// Se registran con UNA línea en server.js: require('./lib/routes/cot-artista').register(app, deps)
//
//   POST /api/cot-artista/quotations/:quoteId/session-notice
//        body { event: session_scheduled|session_rescheduled|session_cancelled|session_completed,
//               session_id }
//        Aviso de sesión a cliente y artista, una copia por rol (COT-A-05/20).
//   POST /api/cot-artista/quotations/:quoteId/agreement-notice
//        Aviso al cliente del acuerdo que registró el artista (COT-A-11).
//
// Ambas exigen la sesión del artista (Bearer) y releen lo guardado; la lógica
// vive en lib/cot-artista-notices.js.
// ===========================================================================

const notices = require('../cot-artista-notices');

function passThrough(req, res, next) { next(); }

function register(app, deps = {}) {
    const limiter = typeof deps.authLimiter === 'function' ? deps.authLimiter : passThrough;
    const noticeDeps = deps.noticeDeps || {};

    app.post('/api/cot-artista/quotations/:quoteId/session-notice', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const result = await notices.handleSessionNotice(req, req.params.quoteId, req.body || {}, noticeDeps);
            if (!result.ok) return res.status(result.status || 400).json({ success: false, error: result.error });
            const sent = Object.values(result.results || {}).some((r) => r && r.ok);
            return res.json({ success: true, sent, results: summarize(result.results) });
        } catch (error) {
            console.error('[cot-artista] session-notice:', error.message);
            return res.status(503).json({ success: false, error: 'No se pudo enviar el aviso. La sesión quedó guardada.' });
        }
    });

    app.post('/api/cot-artista/quotations/:quoteId/agreement-notice', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const result = await notices.handleAgreementNotice(req, req.params.quoteId, noticeDeps);
            if (!result.ok) return res.status(result.status || 400).json({ success: false, error: result.error });
            return res.json({ success: true, skipped: !!result.skipped, results: summarize(result.results) });
        } catch (error) {
            console.error('[cot-artista] agreement-notice:', error.message);
            return res.status(503).json({ success: false, error: 'No se pudo enviar el aviso. El acuerdo quedó guardado.' });
        }
    });
}

// Sin destinatarios ni contenido: solo el resultado de cada copia.
function summarize(results) {
    const out = {};
    for (const [role, r] of Object.entries(results || {})) {
        out[role] = r ? { ok: !!r.ok, skipped: !!r.skipped, deduplicated: !!r.deduplicated } : null;
    }
    return out;
}

module.exports = { register, summarize };
