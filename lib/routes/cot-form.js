'use strict';

// ===========================================================================
// Rutas del cotizador web (/quotation y pre-cotizador) — frente cot-form.
// ---------------------------------------------------------------------------
//   POST /api/quotations/intake            autosave + envío (services/quotation-intake)
//   POST /api/quotations/suggestions       artistas sugeridos (sin PII)
//   POST /api/quotations/intake/job-board  cotización sin artista → Job Board
//   GET  /api/quotations/artist-locations  sedes/ciudades del artista (P27)
//   POST /api/quotations/ai-reference      referencia generada con IA (P7)
//   POST /api/quotations/:quoteId/reuse    "Cotizar con otro artista" (P32)
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

const crypto = require('node:crypto');
const { pgrest } = require('../postgrest');
const { resolveBearerUser } = require('../auth/supabase-auth');
const matching = require('../artist-matching');
const cotForm = require('../cot-form');
const intake = require('../../services/quotation-intake');

const OWN_LIMITED_PATH_RE = /^\/api\/quotations\/(intake(\/job-board)?|suggestions|artist-locations|ai-reference|[a-z0-9_-]{4,64}\/reuse)\/?$/i;
const ARTISTS_CACHE_MS = 60 * 1000;
const RATE_MESSAGE = 'Estás enviando muchas solicitudes seguidas. Esperá un minuto y volvé a intentar.';
// Ronda 2 (textos nuevos en español neutro).
const RATE_MESSAGE_R2 = 'Estás haciendo muchas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.';
const AI_RATE_MESSAGE = 'Llegaste al límite de imágenes generadas por ahora. Puedes subir tus propias referencias o intentarlo más tarde.';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUOTE_REF_RE = /^[A-Za-z0-9_-]{4,64}$/;

// El apiLimiter global de server.js las saltea: tienen limiter propio acá.
// Se evalúa sobre baseUrl + path (sin query string), no sobre originalUrl: si no,
// '/api/gemini/generate-image?x=/api/quotations/intake' salteaba el límite global.
// stripAppBasePath ya sacó el prefijo /beta, así que llega '/api' + '/quotations/intake'.
// Flag i: Express enruta sin distinguir mayúsculas.
function isOwnLimitedPath(req) {
    const p = `${(req && req.baseUrl) || ''}${(req && req.path) || ''}`;
    return OWN_LIMITED_PATH_RE.test(p);
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
        jobBoard: rateLimit({ ...base, max: 60, keyGenerator: ipKey }),
        // Ronda 2. La referencia con IA cuesta dinero: pocas por borrador y por IP.
        locations: rateLimit({ ...base, max: 300, keyGenerator: ipKey, message: { success: false, error: RATE_MESSAGE_R2, rate_limited: true } }),
        reuse: rateLimit({ ...base, max: 30, keyGenerator: ipKey, message: { success: false, error: RATE_MESSAGE_R2, rate_limited: true } }),
        aiIp: rateLimit({ ...base, windowMs: 60 * 60 * 1000, max: 30, keyGenerator: ipKey, message: { success: false, error: AI_RATE_MESSAGE, rate_limited: true, code: 'ai_limit' } }),
        aiDraft: rateLimit({ ...base, windowMs: 60 * 60 * 1000, max: 6, keyGenerator: draftKey, message: { success: false, error: AI_RATE_MESSAGE, rate_limited: true, code: 'ai_limit' } })
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
        // Ronda 2 (P15): misma edad mínima que el envío a un artista.
        if (!cotForm.ageStatus(saved.q.client_birth_date).allowed) {
            throw cotForm.httpError(`Para publicar tu idea necesitas tener al menos ${cotForm.MIN_CLIENT_AGE} años.`, 400, { code: 'under_age', field: 'client_birth_date' });
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
        // Código corto visible (quotations_db.short_code); quote_id sigue siendo la llave de los links.
        quote_code: cotForm.displayCode(quote),
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
        quote_code: cotForm.displayCode(quote),
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
    // P17: con un pgrest inyectado (tests) el vínculo solo corre si también se inyecta.
    const linkContact = deps.linkContact
        || (deps.pgrest ? null : (quoteId) => require('../repos/cot-form').CotFormRepo.linkContact(quoteId));
    return async function afterSubmit({ req, quoteId, artist, references }) {
        const emailService = deps.emailService || require('../../services/email-service');
        const { applicationBase, withLinks } = deps.emailContext || require('../../services/email-request-context');
        const { shouldNotify } = deps.notificationPrefs || require('../notification-prefs');
        // Mismo contacto (email y/o teléfono) que otra cotización: se agrupan; si el
        // email tiene una cuenta de cliente verificada, la cotización queda en esa
        // cuenta. Va antes de leer la fila: la confirmación ya sale con el vínculo.
        if (linkContact) {
            try { await linkContact(quoteId); }
            catch (error) { console.error('[cot-form] vínculo de contacto', quoteId, String(error.message || '').slice(0, 200)); }
        }
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

// ---------------------------------------------------------------------------
// Ronda 2 · P27: sedes / ciudades donde el artista tatúa (datos públicos)
// ---------------------------------------------------------------------------
const LOCATIONS_CACHE_MS = 60 * 1000;
const PUBLIC_LOCATION_FIELDS = ['key', 'type', 'label', 'studio_name', 'city', 'country', 'from', 'to', 'agenda'];

function publicLocationOption(option) {
    return Object.fromEntries(PUBLIC_LOCATION_FIELDS.map((field) => [field, option[field] ?? null]));
}

function createLocationsHandler(deps = {}) {
    const repo = deps.repo || require('../repos/cot-form').CotFormRepo;
    const cache = new Map();
    return async function handleLocations(req, res) {
        res.set('Cache-Control', 'no-store');
        const artistId = String((req.query && req.query.artist_id) || '');
        if (!UUID_RE.test(artistId)) {
            return res.status(400).json({ success: false, error: 'El artista no es válido.' });
        }
        try {
            const hit = cache.get(artistId);
            if (hit && Date.now() - hit.at < LOCATIONS_CACHE_MS) return res.json({ success: true, options: hit.options });
            const sources = await repo.locationSources(artistId);
            if (!sources) return res.status(404).json({ success: false, error: 'El artista no está disponible.' });
            const options = cotForm.buildLocationOptions(sources).map(publicLocationOption);
            if (cache.size > 500) cache.clear();
            cache.set(artistId, { at: Date.now(), options });
            return res.json({ success: true, options });
        } catch (error) {
            console.error('[cot-form] sedes del artista:', String(error.message || '').slice(0, 200));
            return res.status(500).json({ success: false, error: 'No pudimos cargar las sedes del artista.' });
        }
    };
}

// ---------------------------------------------------------------------------
// Ronda 2 · P7: referencia generada con IA (solo referencial)
// ---------------------------------------------------------------------------
// El prompt, el modelo y el tamaño los decide el servidor. Límites: 6 por
// borrador y 30 por IP por hora (createLimiters) + un tope diario del proceso
// (AI_REFERENCE_DAILY_CAP, 300 por defecto) para acotar el gasto.
function createDailyBudget(limit) {
    const state = { day: '', used: 0 };
    return {
        take(now = new Date()) {
            const day = now.toISOString().slice(0, 10);
            if (state.day !== day) { state.day = day; state.used = 0; }
            if (state.used >= limit) return false;
            state.used += 1;
            return true;
        },
        refund() { if (state.used > 0) state.used -= 1; }
    };
}

const AI_ERRORS = {
    not_configured: [503, 'ai_unavailable', 'La generación con IA no está disponible en este momento. Puedes subir tus propias referencias.'],
    blocked: [422, 'ai_blocked', 'No pudimos generar una imagen para esa idea. Prueba describirla de otra forma o sube tus propias referencias.'],
    timeout: [504, 'ai_timeout', 'La imagen tardó demasiado en generarse. Inténtalo de nuevo.'],
    busy: [429, 'ai_busy', 'Hay mucha demanda en este momento. Inténtalo de nuevo en unos minutos.']
};

function createAiReferenceHandler(deps = {}) {
    const generate = deps.generateImage || ((options) => require('../gemini-image').generateImage(options));
    const cap = Math.max(1, parseInt(deps.dailyCap || process.env.AI_REFERENCE_DAILY_CAP, 10) || 300);
    const budget = deps.budget || createDailyBudget(cap);
    return async function handleAiReference(req, res) {
        res.set('Cache-Control', 'no-store');
        const body = req.body || {};
        const fail = (key) => res.status(AI_ERRORS[key][0]).json({ success: false, code: AI_ERRORS[key][1], error: AI_ERRORS[key][2] });
        let charged = false;
        try {
            if (!UUID_V4_RE.test(String(body.submission_key || ''))) {
                throw cotForm.httpError('La solicitud no es válida. Recarga la página e inténtalo de nuevo.', 400);
            }
            const apiKey = deps.apiKey || process.env.GEMINI_API_KEY;
            if (!apiKey) return fail('not_configured');
            const prompt = cotForm.buildAiReferencePrompt(body);
            if (!budget.take()) return fail('busy');
            charged = true;
            const image = await generate({ prompt, model: deps.model || process.env.AI_REFERENCE_MODEL, aspectRatio: '1:1', apiKey });
            return res.json({
                success: true,
                image: `data:${image.mimeType};base64,${image.base64}`,
                mime_type: image.mimeType,
                ai_generated: true,
                label: cotForm.AI_REFERENCE_LABEL
            });
        } catch (error) {
            // Lo que no generó imagen no consume el tope diario.
            if (charged) budget.refund();
            if (error && error.code && AI_ERRORS[error.code]) return fail(error.code);
            if (error && error.status === 429) return fail('busy');
            if (error && error.status === 400 && !error.code) {
                return res.status(400).json({ success: false, error: error.message, ...(error.extra || {}) });
            }
            console.error('[cot-form] referencia con IA:', String((error && (error.detail || error.message)) || '').slice(0, 200));
            return res.status(502).json({ success: false, code: 'ai_error', error: 'No pudimos generar la imagen. Inténtalo de nuevo.' });
        }
    };
}

// ---------------------------------------------------------------------------
// Ronda 2 · guard del endpoint genérico POST /api/gemini/generate-image
// ---------------------------------------------------------------------------
// Revisión de auth y rate limit (P7). El endpoint lo usan el backoffice, el
// avatar con IA del artista y "Inspirarme con AI" del Job Board, que funciona
// ANTES de crear la cuenta: por eso no puede exigir sesión. Sí se acota:
//   - 20 imágenes por hora por IP y un tope diario del proceso
//     (GEMINI_DAILY_CAP, 500 por defecto);
//   - el modelo va en la URL del pedido a Google: solo los de la lista blanca
//     (antes cualquier texto del body terminaba en esa URL);
//   - tamaño 1K salvo superadmin, prompt acotado y filtros de seguridad que
//     solo pueden ser más estrictos que los del proveedor, nunca más laxos.
const SAFE_THRESHOLDS = new Set(['BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE']);
const GEMINI_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9'];

function sanitizeGeminiBody(input, { admin = false } = {}) {
    const body = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
    const { IMAGE_MODELS } = require('../gemini-image');
    if (!IMAGE_MODELS.includes(body.model)) delete body.model;
    if (typeof body.prompt === 'string') body.prompt = body.prompt.slice(0, 4000);
    else delete body.prompt;
    if (!GEMINI_ASPECTS.includes(body.aspectRatio)) delete body.aspectRatio;
    if (!(admin && ['1K', '2K', '4K'].includes(body.imageSize))) body.imageSize = '1K';
    const temperature = Number(body.temperature);
    if (body.temperature != null && Number.isFinite(temperature)) body.temperature = Math.min(2, Math.max(0, temperature));
    else delete body.temperature;
    const safety = Array.isArray(body.safetySettings)
        ? body.safetySettings
            .filter((s) => s && /^HARM_CATEGORY_[A-Z_]{3,40}$/.test(String(s.category)) && SAFE_THRESHOLDS.has(s.threshold))
            .slice(0, 8)
            .map((s) => ({ category: s.category, threshold: s.threshold }))
        : [];
    if (safety.length) body.safetySettings = safety;
    else delete body.safetySettings;
    return body;
}

function createGeminiGuard(deps = {}) {
    const erl = deps.rateLimit || require('express-rate-limit');
    const rateLimit = erl.rateLimit || erl;
    const ipKey = (req) => (erl.ipKeyGenerator ? erl.ipKeyGenerator(req.ip || '') : String(req.ip || ''));
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const isAdmin = deps.isAdmin || require('../auth/supabase-auth').isSuperadminEmail;
    const cap = Math.max(1, parseInt(deps.dailyCap || process.env.GEMINI_DAILY_CAP, 10) || 500);
    const budget = deps.budget || createDailyBudget(cap);
    const limiter = rateLimit({
        windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: ipKey,
        message: { success: false, error: AI_RATE_MESSAGE, rate_limited: true }
    });
    async function sanitize(req, res, next) {
        let admin = false;
        try {
            const user = req.headers && req.headers.authorization ? await resolveUser(req) : null;
            admin = !!(user && isAdmin(user.email));
        } catch (_) { admin = false; }
        req.body = sanitizeGeminiBody(req.body, { admin });
        if (!budget.take()) {
            return res.status(429).json({ success: false, rate_limited: true,
                error: 'Hay mucha demanda en este momento. Inténtalo de nuevo más tarde.' });
        }
        return next();
    }
    return [limiter, sanitize];
}

let defaultGeminiGuard = null;
function geminiGuard() {
    if (!defaultGeminiGuard) defaultGeminiGuard = createGeminiGuard();
    return defaultGeminiGuard;
}

// ---------------------------------------------------------------------------
// Ronda 2 · P32: "Cotizar con otro artista"
// ---------------------------------------------------------------------------
// Clona la idea, los datos del cliente y las referencias de una cotización
// PROPIA a un borrador nuevo sin artista. Devuelve la llave del borrador nuevo
// solo al dueño autenticado; el wizard sigue en el paso de elegir artista.
function createReuseHandler(deps = {}) {
    const repo = deps.repo || require('../repos/cot-form').CotFormRepo;
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const saveQuotation = deps.saveQuotation || intake.saveQuotation;
    const newKey = deps.newKey || (() => crypto.randomUUID());
    const isWizardDraft = deps.isWizardDraft || require('../cot-cliente').isWizardDraft;
    return async function handleReuse(req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await resolveUser(req);
            if (!user) {
                return res.status(401).json({ success: false, needs_account: true,
                    error: 'Inicia sesión con tu cuenta de cliente para reutilizar una solicitud.' });
            }
            const sourceId = String((req.params && req.params.quoteId) || '');
            if (!QUOTE_REF_RE.test(sourceId)) return res.status(400).json({ success: false, error: 'La solicitud no es válida.' });
            const source = await repo.getQuotation(sourceId);
            // Misma respuesta si no existe o si es de otra persona.
            if (!source || !source.client_user_id || source.client_user_id !== user.id || source.client_deleted_at) {
                return res.status(404).json({ success: false, error: 'No encontramos esa solicitud en tu cuenta.' });
            }
            if (isWizardDraft(source)) {
                return res.status(409).json({ success: false, error: 'Esa solicitud todavía no se envió. Continúala desde el cotizador.' });
            }

            const extras = (await repo.getExtras(sourceId)) || {};
            const legacyNotes = Array.isArray(extras.reference_notes) ? extras.reference_notes : [];
            const submissionKey = newKey();
            const newQuoteId = intake.deriveQuoteId(submissionKey);

            // Referencias: cada cotización es dueña de sus archivos (se copian al folder nuevo).
            const attachments = await repo.listReferences(sourceId);
            const references = [];
            for (let i = 0; i < attachments.length && references.length < cotForm.MAX_REFERENCES; i++) {
                const att = attachments[i];
                const from = cotForm.referencePathFromUrl(att.google_drive_url, process.env.SUPABASE_URL, sourceId);
                if (!from) continue;
                const ext = from.split('.').pop().toLowerCase();
                const to = `${newQuoteId}/ref_${references.length + 1}_${Date.now() + references.length}.${ext}`;
                if (!(await repo.copyReference(from, to))) continue;
                references.push({
                    path: to,
                    url: cotForm.referencePublicUrl(process.env.SUPABASE_URL, to),
                    note: cotForm.cleanReferenceNote(att.note || legacyNotes[i] || ''),
                    ai_generated: att.ai_generated === true
                });
            }

            const form = cotForm.quotationToWizardDraft(source, extras);
            form.client_email = String(user.email || source.client_email || '').trim().toLowerCase();
            const quotation = Object.fromEntries(intake.CLIENT_FIELDS.map((field) => [field, source[field] ?? null]));
            Object.assign(quotation, {
                client_email: form.client_email,
                reference_images_count: references.length,
                tattoo_references: null,
                client_preferred_date: form.client_preferred_date,
                client_flexible_dates: form.client_flexible_dates,
                preferred_date_from: form._preferred_date_iso,
                preferred_date_to: form._preferred_date_end_iso || form._preferred_date_iso
            });
            await saveQuotation({
                submission_key: submissionKey,
                mode: 'draft',
                quotation,
                extras: {
                    idea_mode: extras.idea_mode,
                    personalization_level: extras.personalization_level,
                    reference_notes: references.map((ref) => ref.note)
                }
            }, user, { forceNoArtist: true, reusedFrom: source.quote_id });

            return res.json({
                success: true,
                draft: {
                    submission_key: submissionKey,
                    quote_id: newQuoteId,
                    form,
                    references,
                    references_missing: Math.max(0, Math.min(attachments.length, cotForm.MAX_REFERENCES) - references.length),
                    source_code: cotForm.displayCode(source)
                }
            });
        } catch (error) {
            return intake.sendError(res, error);
        }
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
    // Ronda 2
    app.get('/api/quotations/artist-locations', limiters.locations, createLocationsHandler(deps));
    app.post('/api/quotations/ai-reference', limiters.aiIp, limiters.aiDraft, createAiReferenceHandler(deps));
    app.post('/api/quotations/:quoteId/reuse', limiters.reuse, createReuseHandler(deps));
    intake.hooks.afterSubmit = createAfterSubmit(deps);
}

module.exports = {
    register,
    isOwnLimitedPath,
    createLimiters,
    createSuggestionsHandler,
    createJobBoardHandler,
    createLocationsHandler,
    createAiReferenceHandler,
    createReuseHandler,
    createDailyBudget,
    createGeminiGuard,
    sanitizeGeminiBody,
    geminiGuard,
    createAfterSubmit,
    buildClientSubmittedPayload,
    buildArtistSelectedPayload
};
