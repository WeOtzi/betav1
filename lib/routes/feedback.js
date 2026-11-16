'use strict';

// ===========================================================================
// Rutas del feedback de la beta cerrada.
// ---------------------------------------------------------------------------
// Se registran desde server.js con una línea:
//   require('./lib/routes/feedback').register(app);
//
// Persona con sesión (Bearer) y cuenta de tatuador, cliente o estudio:
//   POST /api/feedback                          { kind, message, rating?, attachments[], survey_key?, mode?, page_path, page_title, context }
//        Botón "Comentarios" (bug | idea | comment) o respuesta de encuesta
//        (survey + survey_key). El rol se detecta aquí; el `mode` del front
//        solo elige entre los tipos de cuenta propios. Tope: 20 por día.
//        La misma encuesta dos veces responde idempotente (duplicate: true).
//   GET  /api/feedback/surveys                  claves ya respondidas o descartadas + roles
//   POST /api/feedback/surveys/:key/dismiss     "Ahora no": no se vuelve a preguntar
//
// Soporte (agente activo de support_users_db o superadmin del backoffice,
// mismo control que /api/support/reports):
//   GET  /api/support/feedback                  lista con filtros y paginado
//   GET  /api/support/feedback/summary          conteos y promedios por encuesta
//   GET  /api/support/feedback/export.csv       CSV con los mismos filtros (sin correos)
//   GET  /api/support/feedback/:id              detalle: capturas firmadas, contexto y correo
//   POST /api/support/feedback/:id              { status?, support_note? }
//
// Lógica pura en lib/feedback.js; datos en lib/repos/feedback.js.
// ===========================================================================

const rateLimit = require('express-rate-limit');
const F = require('../feedback');

const MIGRATION_PENDING_ERROR = 'El feedback todavía no está disponible (falta aplicar una migración).';
const NO_ROLE_ERROR = 'El feedback de la beta es para cuentas de tatuador, cliente o estudio.';
const THANKS = '¡Gracias! Leemos todo lo que nos mandas para mejorar We Ötzi.';

// Dependencias por defecto, cargadas solo si el llamador no las inyecta (tests).
const DEFAULTS = {
    resolveBearerUser: () => require('../auth/supabase-auth').resolveBearerUser,
    isSuperadminEmail: () => require('../auth/supabase-auth').isSuperadminEmail,
    repo: () => require('../repos/feedback').FeedbackRepo,
    isMissingSchemaError: () => require('../repos/feedback').isMissingSchemaError,
    pgErrorCode: () => require('../repos/feedback').pgErrorCode,
    logger: () => console,
    now: () => () => Date.now()
};

function createHandlers(overrides = {}) {
    const deps = {};
    for (const key of Object.keys(DEFAULTS)) deps[key] = overrides[key] !== undefined ? overrides[key] : DEFAULTS[key]();
    const log = deps.logger || console;
    const missingSchema = (err) => Boolean(deps.isMissingSchemaError && deps.isMissingSchemaError(err));
    const isUniqueViolation = (err) => {
        const code = deps.pgErrorCode ? deps.pgErrorCode(err) : (err && err.code);
        return code === '23505' || /23505|duplicate key/i.test(String(err && err.message || ''));
    };

    function short(err) {
        return String((err && err.message) || err || '').slice(0, 300);
    }

    async function currentUser(req, res, message) {
        const user = await deps.resolveBearerUser(req);
        if (!user || !user.id) {
            res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: message || 'Inicia sesión para enviarnos tu opinión.' });
            return null;
        }
        return user;
    }

    // --- Persona -------------------------------------------------------------------

    async function submit(req, res) {
        res.set('Cache-Control', 'no-store');
        const user = await currentUser(req, res);
        if (!user) return undefined;
        const parsed = F.parseFeedbackInput(req.body, { userId: user.id, userAgent: req.get ? req.get('user-agent') : '' });
        if (!parsed.ok) return res.status(parsed.status).json({ success: false, code: 'INVALID_INPUT', field: parsed.field, error: parsed.error });
        const input = parsed.value;
        try {
            const roles = await deps.repo.resolveRoles(user.id);
            let role = F.pickRole(roles, input.mode);
            if (!role) return res.status(403).json({ success: false, code: 'NO_ROLE', error: NO_ROLE_ERROR });

            if (input.kind === 'survey') {
                // Cada encuesta es de un tipo de cuenta: se guarda con ese rol y
                // solo si la persona lo tiene.
                role = F.surveyRole(roles, input.survey_key);
                if (!role) return res.status(400).json({ success: false, code: 'SURVEY_ROLE_MISMATCH', field: 'survey_key', error: F.SURVEY_ROLE_ERROR });

                const existing = await deps.repo.findSurvey(user.id, input.survey_key);
                if (existing) {
                    return res.json({ success: true, duplicate: true, id: existing.id, survey_key: input.survey_key, message: THANKS });
                }
            }

            const count = await deps.repo.countSince(user.id, F.dailyWindowStart(deps.now()));
            if (F.overDailyLimit(count)) {
                return res.status(429).json({ success: false, code: 'FEEDBACK_DAILY_LIMIT', error: 'Llegaste al máximo de ' + F.DAILY_LIMIT + ' envíos por hoy. Mañana puedes seguir contándonos.' });
            }

            let saved;
            try {
                saved = await deps.repo.insert(F.buildRow(input, { userId: user.id, role }));
            } catch (err) {
                // Dos pestañas respondiendo la misma encuesta: gana la primera.
                if (input.kind === 'survey' && isUniqueViolation(err)) {
                    const again = await deps.repo.findSurvey(user.id, input.survey_key).catch(() => null);
                    return res.json({ success: true, duplicate: true, id: again ? again.id : null, survey_key: input.survey_key, message: THANKS });
                }
                throw err;
            }
            log.log(`[feedback] ${input.kind}${input.survey_key ? ':' + input.survey_key : ''} de ${role} ${user.id}`);
            return res.status(201).json({ success: true, duplicate: false, id: saved ? saved.id : null, role, survey_key: input.survey_key, message: THANKS });
        } catch (err) {
            if (missingSchema(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
            log.error('[feedback] submit:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos guardar tu mensaje. Inténtalo de nuevo en unos minutos.' });
        }
    }

    async function surveys(req, res) {
        res.set('Cache-Control', 'no-store');
        const user = await currentUser(req, res);
        if (!user) return undefined;
        let roles = { artist: false, client: false, studio: false };
        try {
            roles = await deps.repo.resolveRoles(user.id);
            const rows = await deps.repo.listSurveyKeys(user.id);
            const answered = [];
            const dismissed = [];
            for (const row of rows) {
                if (!row || !row.survey_key) continue;
                (row.dismissed ? dismissed : answered).push(row.survey_key);
            }
            return res.json({ success: true, roles: F.ownRoles(roles), keys: answered.concat(dismissed), answered, dismissed });
        } catch (err) {
            if (missingSchema(err)) {
                return res.json({ success: true, roles: F.ownRoles(roles), keys: [], answered: [], dismissed: [], migration_pending: true });
            }
            log.error('[feedback] surveys:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos leer tus encuestas.' });
        }
    }

    async function dismiss(req, res) {
        res.set('Cache-Control', 'no-store');
        const user = await currentUser(req, res);
        if (!user) return undefined;
        const key = String((req.params && req.params.key) || '');
        if (!F.isSurveyKey(key)) return res.status(400).json({ success: false, code: 'INVALID_INPUT', field: 'survey_key', error: 'No reconocemos esa encuesta.' });
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        try {
            const existing = await deps.repo.findSurvey(user.id, key);
            if (existing) return res.json({ success: true, already: true, survey_key: key });
            const roles = await deps.repo.resolveRoles(user.id);
            if (!F.pickRole(roles, null)) return res.status(403).json({ success: false, code: 'NO_ROLE', error: NO_ROLE_ERROR });
            const role = F.surveyRole(roles, key);
            if (!role) return res.status(400).json({ success: false, code: 'SURVEY_ROLE_MISMATCH', field: 'survey_key', error: F.SURVEY_ROLE_ERROR });
            try {
                await deps.repo.insert(F.buildDismissRow({ userId: user.id, role, key, pagePath: body.page_path }));
            } catch (err) {
                if (!isUniqueViolation(err)) throw err;
            }
            return res.json({ success: true, already: false, survey_key: key });
        } catch (err) {
            if (missingSchema(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
            log.error('[feedback] dismiss:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos guardar tu respuesta.' });
        }
    }

    // --- Soporte -------------------------------------------------------------------

    async function authorizeSupport(req) {
        const user = await deps.resolveBearerUser(req);
        if (!user || !user.id) return { ok: false, status: 401, error: 'Inicia sesión con tu usuario de soporte.' };
        if (deps.isSuperadminEmail(user.email)) return { ok: true, role: 'superadmin', userId: user.id };
        try {
            const agent = await deps.repo.getActiveSupportUser(user.id);
            if (agent) return { ok: true, role: 'support', userId: user.id };
        } catch (err) {
            log.warn('[feedback] support lookup failed:', short(err));
            return { ok: false, status: 500, error: 'No pudimos verificar tu acceso. Inténtalo de nuevo.' };
        }
        return { ok: false, status: 403, error: 'Solo el equipo de soporte de We Ötzi ve el feedback de la beta.' };
    }

    async function guard(req, res) {
        res.set('Cache-Control', 'no-store');
        const auth = await authorizeSupport(req);
        if (!auth.ok) {
            res.status(auth.status).json({ success: false, error: auth.error });
            return null;
        }
        return auth;
    }

    async function supportList(req, res) {
        const auth = await guard(req, res);
        if (!auth) return undefined;
        const parsed = F.parseListQuery(req.query);
        if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
        const f = parsed.value;
        try {
            const { rows, total } = await deps.repo.list(f);
            const names = await deps.repo.namesFor(rows.map((r) => r.user_id)).catch(() => new Map());
            return res.json({
                success: true,
                page: f.page,
                page_size: f.page_size,
                total: total == null ? rows.length : total,
                items: rows.map((row) => F.summarizeRow(row, names))
            });
        } catch (err) {
            if (missingSchema(err)) return res.json({ success: true, page: 1, page_size: f.page_size, total: 0, items: [], migration_pending: true });
            log.error('[feedback] support list:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos cargar el feedback.' });
        }
    }

    async function supportSummary(req, res) {
        const auth = await guard(req, res);
        if (!auth) return undefined;
        try {
            const rows = await deps.repo.summaryRows();
            return res.json({ success: true, summary: F.buildSummary(rows) });
        } catch (err) {
            if (missingSchema(err)) return res.json({ success: true, summary: F.buildSummary([]), migration_pending: true });
            log.error('[feedback] support summary:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos calcular el resumen.' });
        }
    }

    async function supportExport(req, res) {
        const auth = await guard(req, res);
        if (!auth) return undefined;
        const parsed = F.parseListQuery(req.query);
        if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
        try {
            const rows = await deps.repo.listForExport(parsed.value);
            const names = await deps.repo.namesFor(rows.map((r) => r.user_id)).catch(() => new Map());
            const stamp = new Date(deps.now()).toISOString().slice(0, 10);
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="feedback-beta-${stamp}.csv"`);
            return res.send(F.toCsv(rows, names));
        } catch (err) {
            if (missingSchema(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
            log.error('[feedback] export:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos exportar el feedback.' });
        }
    }

    // Capturas con URL firmada; la ruta de Storage no sale del servidor.
    async function signAttachments(row) {
        const list = Array.isArray(row.attachments) ? row.attachments : [];
        const prefix = `${row.user_id}/${F.ATTACHMENTS_FOLDER}/`;
        return Promise.all(list
            .filter((a) => a && typeof a.path === 'string' && a.path.startsWith(prefix) && !a.path.includes('..'))
            .map(async (a) => ({
                name: F.cleanLine(a.name, 120) || 'captura',
                type: F.cleanLine(a.type, 80),
                size: Number(a.size) || 0,
                url: await deps.repo.signObject(a.path)
            })));
    }

    async function supportDetail(req, res) {
        const auth = await guard(req, res);
        if (!auth) return undefined;
        const id = String((req.params && req.params.id) || '');
        if (!F.isUuid(id)) return res.status(400).json({ success: false, error: 'ID de feedback inválido.' });
        try {
            const row = await deps.repo.getById(id);
            if (!row) return res.status(404).json({ success: false, error: 'No encontramos ese feedback.' });
            const [names, attachments, contact] = await Promise.all([
                deps.repo.namesFor([row.user_id]).catch(() => new Map()),
                signAttachments(row),
                Promise.resolve(deps.repo.getAuthUserContact(row.user_id)).catch(() => null)
            ]);
            const ctx = row.context && typeof row.context === 'object' ? row.context : {};
            const item = F.summarizeRow(row, names);
            // El correo solo lo ve el personal de soporte, y solo en el detalle.
            item.user.email = contact && contact.email ? String(contact.email).toLowerCase() : '';
            item.context = { lang: ctx.lang || '', viewport: ctx.viewport || null, ua: ctx.ua || '' };
            item.attachments = attachments;
            item.handled_by_me = Boolean(row.handled_by && row.handled_by === auth.userId);
            return res.json({ success: true, item });
        } catch (err) {
            if (missingSchema(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
            log.error('[feedback] detail:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos abrir el feedback.' });
        }
    }

    async function supportUpdate(req, res) {
        const auth = await guard(req, res);
        if (!auth) return undefined;
        const id = String((req.params && req.params.id) || '');
        if (!F.isUuid(id)) return res.status(400).json({ success: false, error: 'ID de feedback inválido.' });
        const parsed = F.parseStatusInput(req.body);
        if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
        try {
            const updated = await deps.repo.update(id, { ...parsed.value, handled_by: auth.userId });
            if (!updated) return res.status(404).json({ success: false, error: 'No encontramos ese feedback.' });
            return res.json({
                success: true,
                item: {
                    id: updated.id,
                    status: updated.status,
                    status_label: F.STATUS_LABELS[updated.status] || '',
                    support_note: updated.support_note || '',
                    updated_at: updated.updated_at || null
                }
            });
        } catch (err) {
            if (missingSchema(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
            log.error('[feedback] update:', short(err));
            return res.status(500).json({ success: false, error: 'No pudimos guardar el cambio.' });
        }
    }

    return { submit, surveys, dismiss, authorizeSupport, supportList, supportSummary, supportExport, supportDetail, supportUpdate };
}

// Tope por IP además del tope diario por persona.
const submitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'FEEDBACK_RATE_LIMITED', error: 'Enviaste varios mensajes seguidos. Espera un rato y vuelve a intentarlo.' }
});

function register(app, overrides) {
    if (!app) throw new Error('[feedback] falta la app de Express');
    const h = createHandlers(overrides);
    const noLimit = (req, res, next) => next();
    const limiter = overrides && overrides.limiter === false ? noLimit : submitLimiter;
    app.post('/api/feedback', limiter, h.submit);
    app.get('/api/feedback/surveys', h.surveys);
    app.post('/api/feedback/surveys/:key/dismiss', limiter, h.dismiss);

    // Rutas fijas antes de /:id.
    app.get('/api/support/feedback', h.supportList);
    app.get('/api/support/feedback/summary', h.supportSummary);
    app.get('/api/support/feedback/export.csv', h.supportExport);
    app.get('/api/support/feedback/:id', h.supportDetail);
    app.post('/api/support/feedback/:id', h.supportUpdate);
    return h;
}

module.exports = { register, createHandlers, THANKS, NO_ROLE_ERROR };
