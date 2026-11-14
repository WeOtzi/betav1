'use strict';

// ===========================================================================
// Rutas del cotizador web (/quotation y pre-cotizador) — frente cot-form.
// ---------------------------------------------------------------------------
//   POST /api/quotations/intake            autosave + envío (services/quotation-intake)
//   POST /api/quotations/suggestions       artistas sugeridos (sin PII)
//   POST /api/quotations/intake/job-board  cotización sin artista → Job Board
//
// Rate limit propio (no el apiLimiter global): un grupo de testers detrás de
// la misma IP no se queda sin cupo. Límite por borrador (submission_key) y un
// techo amplio por IP.
//
// Después de un envío (hook afterSubmit del intake) el servidor manda la
// confirmación al cliente, el aviso al artista elegido entre las sugerencias
// y, si está configurado, copia las referencias a Google Drive (opcional:
// Storage es la fuente de verdad).
// ===========================================================================

const { pgrest } = require('../postgrest');
const { resolveBearerUser } = require('../auth/supabase-auth');
const matching = require('../artist-matching');
const cotForm = require('../cot-form');
const intake = require('../../services/quotation-intake');

const OWN_LIMITED_PATH_RE = /\/api\/quotations\/(intake(\/job-board)?|suggestions)\/?(\?|$)/;
const ARTISTS_CACHE_MS = 60 * 1000;
const RATE_MESSAGE = 'Estás enviando muchas solicitudes seguidas. Esperá un minuto y volvé a intentar.';

// El apiLimiter global de server.js las saltea: tienen limiter propio acá.
function isOwnLimitedPath(req) {
    return OWN_LIMITED_PATH_RE.test(String((req && (req.originalUrl || req.url)) || ''));
}

function createLimiters(erl) {
    const rateLimit = erl.rateLimit || erl;
    const ipKey = (req) => (erl.ipKeyGenerator ? erl.ipKeyGenerator(req.ip || '') : String(req.ip || ''));
    const base = {
        windowMs: 15 * 60 * 1000,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: RATE_MESSAGE, rate_limited: true }
    };
    const draftKey = (req) => {
        const key = req.body && req.body.submission_key;
        return /^[0-9a-f-]{36}$/i.test(String(key || '')) ? `draft:${String(key).toLowerCase()}` : `ip:${ipKey(req)}`;
    };
    return {
        // ~10-15 llamadas por cotización con el debounce del wizard: 1500 por IP
        // alcanzan para ~100 testers en la misma red.
        intakeIp: rateLimit({ ...base, max: 1500, keyGenerator: ipKey }),
        intakeDraft: rateLimit({ ...base, max: 120, keyGenerator: draftKey }),
        suggestions: rateLimit({ ...base, max: 300, keyGenerator: ipKey }),
        jobBoard: rateLimit({ ...base, max: 60, keyGenerator: ipKey })
    };
}

function createArtistSource(deps) {
    const query = deps.pgrest || pgrest;
    let cache = { at: 0, rows: null };
    return async function loadArtists() {
        if (cache.rows && Date.now() - cache.at < ARTISTS_CACHE_MS) return cache.rows;
        const rows = await query('artists_db')
            .select(matching.MATCHING_COLUMNS)
            // neq solo no trae los NULL (perfiles legacy sin estado de alta).
            .or([
                { col: 'registration_status', op: 'is', val: null },
                { col: 'registration_status', op: 'neq', val: 'incompleto' }
            ])
            .limit(2000)
            .execute();
        cache = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
        return cache.rows;
    };
}

function createSuggestionsHandler(deps = {}) {
    const loadArtists = deps.loadArtists || createArtistSource(deps);
    return async function handleSuggestions(req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            const criteria = matching.normalizeCriteria((req.body && req.body.criteria) || req.body || {});
            if (!criteria.styles.length && !criteria.city && !criteria.country && !criteria.coords) {
                return res.status(400).json({ success: false, error: 'Contanos estilo o ciudad para sugerirte artistas.' });
            }
            const limit = Math.min(12, Math.max(1, parseInt(req.body && req.body.limit, 10) || 6));
            const suggestions = matching.rankArtists(await loadArtists(), criteria, { limit });
            return res.json({ success: true, suggestions });
        } catch (error) {
            console.error('[cot-form] sugerencias:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos buscar artistas ahora. Podés publicar tu idea en el Job Board.' });
        }
    };
}

// ---------------------------------------------------------------------------
// Job Board: la idea del cliente sin artista se publica como solicitud.
// Requiere cuenta de cliente (job_board_requests.client_user_id → clients_db).
// ---------------------------------------------------------------------------
function createJobBoardHandler(deps = {}) {
    const query = deps.pgrest || pgrest;
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const saveQuotation = deps.saveQuotation || intake.saveQuotation;
    const notify = deps.notifyJobBoard || (() => {});
    const inFlight = new Map();

    async function publish(req, user, client) {
        const body = { ...(req.body || {}), mode: 'draft' };
        const saved = await saveQuotation(body, user, { forceNoArtist: true });
        const quoteId = saved.q.quote_id;
        const current = await query('quotations_db').select('id,quote_status,job_board_request_id')
            .eq('quote_id', quoteId).limit(1).single().execute();
        if (current && current.job_board_request_id) {
            const existing = await query('job_board_requests').select('id,request_code')
                .eq('id', current.job_board_request_id).limit(1).single().execute();
            if (existing) return { request: existing, reused: true };
        }
        if (current && current.quote_status !== 'in_progress') {
            throw cotForm.httpError('Esta solicitud ya fue enviada a un artista.', 409);
        }
        if (!saved.q.tattoo_idea_description || !saved.q.tattoo_style) {
            throw cotForm.httpError('Completá la idea y el estilo antes de publicar.', 400);
        }
        const references = cotForm.normalizeReferences(req.body && req.body.references, quoteId);
        const rows = await query('job_board_requests').insert(cotForm.buildJobBoardRequest(saved.q, saved.extras, user.id));
        const request = Array.isArray(rows) ? rows[0] : null;
        if (!request) throw new Error('job_board_requests no devolvió la fila creada');
        if (references.length) {
            try {
                await query('job_board_attachments').insert(
                    cotForm.jobBoardAttachmentRows(request.id, references, process.env.SUPABASE_URL), { returning: false });
            } catch (error) {
                console.error('[cot-form] adjuntos del Job Board', request.id, error.message);
            }
        }
        // La cotización queda como rastro del borrador (no aparece en el
        // dashboard del cliente: lo que sigue vive en el Job Board).
        await query('quotations_db').eq('quote_id', quoteId).eq('quote_status', 'in_progress').patch({
            job_board_request_id: request.id,
            source: 'job_board',
            client_user_id: client.user_id,
            client_deleted_at: new Date().toISOString()
        }, { returning: false });
        return { request, reused: false };
    }

    return async function handleJobBoard(req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await resolveUser(req);
            if (!user) {
                return res.status(401).json({ success: false, needs_account: true,
                    error: 'Para publicar en el Job Board iniciá sesión con tu cuenta de cliente.' });
            }
            const client = await query('clients_db').select('user_id,email,full_name')
                .eq('user_id', user.id).limit(1).single().execute();
            if (!client) {
                return res.status(403).json({ success: false, needs_account: true,
                    error: 'El Job Board es para cuentas de cliente. Iniciá sesión con tu cuenta de cliente.' });
            }
            const key = String((req.body && req.body.submission_key) || '');
            if (inFlight.has(key)) {
                return res.status(409).json({ success: false, error: 'Ya estamos publicando tu idea. Esperá unos segundos.' });
            }
            const job = publish(req, user, client);
            inFlight.set(key, job);
            let outcome;
            try { outcome = await job; } finally { inFlight.delete(key); }
            if (!outcome.reused) {
                Promise.resolve().then(() => notify(req, outcome.request))
                    .catch((error) => console.error('[cot-form] aviso del Job Board:', error.message));
            }
            return res.json({
                success: true,
                request_id: outcome.request.id,
                request_code: outcome.request.request_code || null,
                url: `/client/requests?id=${encodeURIComponent(outcome.request.id)}`
            });
        } catch (error) {
            return intake.sendError(res, error);
        }
    };
}

// ---------------------------------------------------------------------------
// Avisos post-envío
// ---------------------------------------------------------------------------
function textOrDash(value) {
    const text = value == null ? '' : String(value).trim();
    return text || '-';
}

function buildClientSubmittedPayload(quote, artist, references) {
    const health = String(quote.client_health_conditions || '').trim();
    const hasMedical = !!health && health.toLowerCase() !== 'ninguna';
    return {
        ...quote,
        quote_id: quote.quote_id,
        quote_status: quote.quote_status,
        client_name: quote.client_full_name,
        client_email: quote.client_email,
        recipient_name: quote.client_full_name,
        recipient_email: quote.client_email,
        artist_name: (artist && artist.name) || quote.artist_name,
        artist_email: (artist && artist.email) || quote.artist_email,
        artist_username: (artist && artist.username) || null,
        tattoo_description: quote.tattoo_idea_description,
        tattoo_location: [quote.tattoo_body_part, quote.tattoo_body_side].filter(Boolean).join(' · '),
        tattoo_style: cotForm.styleNames(quote.tattoo_style).join(' · '),
        tattoo_references: references.length ? `${references.length} imagen(es)` : 'Sin referencias',
        reference_images_count: references.length,
        client_budget: `${quote.client_budget_amount || ''} ${quote.client_budget_currency || ''}`.trim(),
        estimated_sessions: quote.tattoo_estimated_sessions,
        has_medical_conditions: hasMedical,
        medical_details: hasMedical ? health : null
    };
}

function buildArtistSelectedPayload(quote, artist, base) {
    const firstName = String(quote.client_full_name || '').trim().split(/\s+/)[0] || 'Un cliente';
    return {
        artist_email: artist.email,
        artist_user_id: artist.user_id,
        artist_name: artist.name || artist.username,
        artist_username: artist.username,
        quote_id: quote.quote_id,
        client_first_name: firstName,
        tattoo_description: textOrDash(String(quote.tattoo_idea_description || '').slice(0, 280)),
        tattoo_style: textOrDash(cotForm.styleNames(quote.tattoo_style).join(' · ')),
        tattoo_location: textOrDash([quote.tattoo_body_part, quote.tattoo_body_side].filter(Boolean).join(' · ')),
        tattoo_size: textOrDash(quote.tattoo_size),
        client_city: textOrDash(quote.client_city_residence),
        client_budget: textOrDash(`${quote.client_budget_amount || ''} ${quote.client_budget_currency || ''}`.trim()),
        quotation_url: `${base}/my-quotations/detail?quote=${encodeURIComponent(quote.quote_id)}`
    };
}

async function mirrorToN8N(quote, references, deps) {
    const url = process.env.N8N_REFERENCES_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
    if (!url || !references.length) return null;
    const emailService = deps.emailService || require('../../services/email-service');
    const headers = await emailService.getN8NHeaders();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(url, {
            method: 'POST', headers, signal: controller.signal,
            body: JSON.stringify({
                quote_id: quote.quote_id,
                files: references.map((ref) => ({
                    file_name: ref.file_name, public_url: cotForm.referencePublicUrl(process.env.SUPABASE_URL, ref.path), mime_type: ref.mime_type
                })),
                drive_folder_id: process.env.N8N_DRIVE_FOLDER_ID || '',
                timestamp: new Date().toISOString()
            })
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        return data && typeof data.drive_folder_url === 'string' ? data.drive_folder_url : null;
    } finally {
        clearTimeout(timer);
    }
}

function createAfterSubmit(deps = {}) {
    const query = deps.pgrest || pgrest;
    return async function afterSubmit({ req, quoteId, artist, references }) {
        const emailService = deps.emailService || require('../../services/email-service');
        const { applicationBase, withLinks } = deps.emailContext || require('../../services/email-request-context');
        const { shouldNotify } = deps.notificationPrefs || require('../notification-prefs');
        const quote = await query('quotations_db').select('*').eq('quote_id', quoteId).limit(1).single().execute();
        if (!quote || quote.quote_status !== 'pending') return;
        const base = applicationBase(req);
        const tasks = [];

        // Confirmación al cliente. Misma llave que /api/email/:eventId (quote_id):
        // si una pestaña vieja la pide, no sale dos veces.
        if (quote.client_email) {
            tasks.push(emailService.sendEmail('client_quotation_submitted',
                withLinks(buildClientSubmittedPayload(quote, artist, references), base, 'client'),
                { idempotencyKey: quote.quote_id }));
        }

        // Aviso al artista elegido entre las sugerencias del sistema.
        if (quote.source === 'recommendation' && artist && artist.email) {
            const allowed = await shouldNotify({ id: artist.user_id, email: artist.email }, 'cotizaciones', 'email');
            if (allowed) {
                tasks.push(emailService.sendEmail('quotation_artist_selected',
                    buildArtistSelectedPayload(quote, artist, base),
                    { idempotencyKey: `artist-selected:${quote.quote_id}`, ignorePreferences: true }));
            }
        }

        // Copia opcional a Google Drive (Storage sigue siendo la fuente de verdad).
        if (references.length) {
            tasks.push((async () => {
                const files = references.map((ref) => ({
                    url: cotForm.referencePublicUrl(process.env.SUPABASE_URL, ref.path),
                    fileName: ref.file_name, mimeType: ref.mime_type
                }));
                let folderUrl = null;
                if (typeof deps.driveMirror === 'function') {
                    const result = await deps.driveMirror(quote.quote_id, files);
                    folderUrl = result && result.quoteFolderLink ? result.quoteFolderLink : null;
                    if (!folderUrl && !(result && result.skipped)) return;
                }
                if (!folderUrl) folderUrl = await mirrorToN8N(quote, references, deps);
                if (folderUrl) {
                    await query('quotations_db').eq('quote_id', quote.quote_id).patch({ drive_folder_url: folderUrl }, { returning: false });
                }
            })());
        }

        const results = await Promise.allSettled(tasks);
        results.filter((r) => r.status === 'rejected')
            .forEach((r) => console.error('[cot-form] aviso post-envío', quote.quote_id, r.reason && r.reason.message));
    };
}

function createJobBoardNotifier(deps = {}) {
    return async function notifyJobBoard(req, request) {
        const emailService = deps.emailService || require('../../services/email-service');
        const { resolveEmailContext } = deps.emailContext || require('../../services/email-request-context');
        const context = await resolveEmailContext(req, 'job_board_request_created', { request_id: request.id });
        if (!context.ok) return;
        await emailService.sendEmail('job_board_request_created', context.payload, { idempotencyKey: context.idempotencyKey });
    };
}

/**
 * Registra las rutas del cotizador. deps opcionales (tests / server.js):
 *   driveMirror(quoteId, files) → { quoteFolderLink } | { skipped: true }
 *   rateLimit (módulo express-rate-limit), pgrest, emailService, …
 */
function register(app, deps = {}) {
    const limiters = createLimiters(deps.rateLimit || require('express-rate-limit'));
    app.post('/api/quotations/intake', limiters.intakeIp, limiters.intakeDraft, intake.handleIntake);
    app.post('/api/quotations/suggestions', limiters.suggestions, createSuggestionsHandler(deps));
    app.post('/api/quotations/intake/job-board', limiters.jobBoard, createJobBoardHandler({
        ...deps, notifyJobBoard: deps.notifyJobBoard || createJobBoardNotifier(deps)
    }));
    intake.hooks.afterSubmit = createAfterSubmit(deps);
}

module.exports = {
    register,
    isOwnLimitedPath,
    createLimiters,
    createSuggestionsHandler,
    createJobBoardHandler,
    createAfterSubmit,
    buildClientSubmittedPayload,
    buildArtistSelectedPayload
};
