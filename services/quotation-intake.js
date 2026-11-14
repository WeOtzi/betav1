'use strict';
// ===========================================================================
// Intake del cotizador web (/quotation y pre-cotizador).
// ---------------------------------------------------------------------------
// El navegador nunca escribe quotations_db: autosave (mode=draft) y envío
// (mode=submit) pasan por acá con service role. La "llave" del borrador es
// submission_key (UUID v4 secreto del navegador): el quote_id se deriva con
// sha256 y no se puede adivinar ni reutilizar desde afuera.
//
// En el envío final el servidor:
//   - exige un destino: artista (deep link o sugerido) — sin artista responde
//     409 needs_destination y el wizard ofrece sugerencias o el Job Board;
//   - registra las referencias (paths de Storage validados) en
//     quotations_db.reference_images y quotations_attachments;
//   - dispara los avisos por los hooks que registra lib/routes/cot-form.js.
// ===========================================================================
const crypto = require('node:crypto');
const { pgrest } = require('../lib/postgrest');
const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const cotForm = require('../lib/cot-form');

const CLIENT_FIELDS = ['tattoo_body_part','tattoo_body_side','tattoo_idea_description','tattoo_size','tattoo_style','tattoo_color_type','reference_images_count','tattoo_references','tattoo_is_first_tattoo','tattoo_is_cover_up','client_full_name','client_email','client_instagram','client_city_residence','client_travel_willing','city_mismatch_acknowledged','style_mismatch_acknowledged','client_preferred_date','client_flexible_dates','client_budget_amount','client_budget_currency','client_contact_preference','client_whatsapp','client_birth_date','client_age','client_health_conditions','client_allergies','tattoo_estimated_sessions'];
const ARTIST_SELECT = 'user_id,username,name,email,instagram,styles_array,ubicacion,city,estudios,session_price,registration_status';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Hooks post-envío (emails, espejo a Drive). Los registra lib/routes/cot-form.js.
const hooks = { afterSubmit: null };

function invalid(message, status = 400, extra) {
    const e = new Error(message);
    e.status = status;
    if (extra) e.extra = extra;
    throw e;
}

function deriveQuoteId(submissionKey) {
    return 'QN' + crypto.createHash('sha256').update('weotzi-intake:' + submissionKey).digest('hex').slice(0, 32);
}

// quotations_db_source_check (vivo) acepta direct | job_board | recommendation |
// web_chat. El pre-cotizador se marca en quotation_medium para no violar el
// CHECK; 'recommendation' = artista elegido entre las sugerencias del sistema.
function resolveSource(input, artist) {
    if (input.source === 'recommendation' && artist) return { source: 'recommendation', quotation_medium: 'web' };
    if (input.source === 'prequote') return { source: 'web_chat', quotation_medium: 'prequote' };
    return { source: 'web_chat', quotation_medium: 'web' };
}

function normalizeIntake(body, user, artist) {
    if (!UUID_V4_RE.test(body.submission_key || '')) invalid('La clave de la solicitud no es válida.');
    if (!['draft','submit'].includes(body.mode)) invalid('Operación no válida.');
    const input = body.quotation || {};
    if (input.artist_id && (!artist || artist.registration_status === 'incompleto' || !artist.username)) invalid('El artista no está disponible.', 404);
    const q = Object.fromEntries(CLIENT_FIELDS.map(k => [k, input[k] ?? null]));
    q.client_email = String(q.client_email || '').trim().toLowerCase();
    q.tattoo_idea_description = String(q.tattoo_idea_description || '').trim();
    q.client_full_name = String(q.client_full_name || '').trim();
    if (JSON.stringify(q).length > 40000) invalid('La solicitud es demasiado extensa.');
    if (body.mode === 'submit') {
        if (!q.client_full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.client_email)) invalid('Completá nombre y correo válidos.');
        if (!q.tattoo_idea_description || !q.tattoo_style || !q.tattoo_body_part || !q.tattoo_size) invalid('Completá la idea, estilo, zona y tamaño.');
        // Nunca una cotización enviada sin destino: sin artista el wizard ofrece
        // artistas sugeridos o el Job Board (POST /api/quotations/intake/job-board).
        if (!artist) invalid('Elegí un artista o publicá tu idea en el Job Board.', 409, { needs_destination: true });
    }
    if (q.client_budget_amount != null && (!Number.isFinite(Number(q.client_budget_amount)) || Number(q.client_budget_amount) < 0)) invalid('El presupuesto no es válido.');
    if (q.client_birth_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(q.client_birth_date))) q.client_birth_date = null;
    const age = cotForm.ageFromBirthDate(q.client_birth_date);
    q.client_age = age == null ? null : String(age);
    const quoteId = deriveQuoteId(body.submission_key);
    Object.assign(q, {
        quote_id: quoteId,
        quote_status: body.mode === 'submit' ? 'pending' : 'in_progress',
        client_user_id: user && user.email?.toLowerCase() === q.client_email ? user.id : null,
        artist_id: artist?.user_id || null, artist_name: artist?.name || null, artist_email: artist?.email || null,
        artist_instagram: artist?.instagram || null, artist_styles: artist?.styles_array || [],
        artist_current_city: artist?.ubicacion || artist?.city || null, artist_studio_name: artist?.estudios || null,
        artist_session_cost_amount: artist?.session_price || null
    }, resolveSource(input, artist));
    const extra = body.extras || {};
    const extras = { idea_mode: extra.idea_mode === 'explorar' ? 'explorar' : 'idea', personalization_level: ['tal_cual','interpretacion','propuesta'].includes(extra.personalization_level) ? extra.personalization_level : null, reference_notes: Array.isArray(extra.reference_notes) ? extra.reference_notes.slice(0,4).map(n => String(n).slice(0,2000)) : [] };
    const references = body.mode === 'submit' ? cotForm.normalizeReferences(body.references, quoteId) : [];
    return { q, extras, references };
}

async function loadArtist(id) {
    if (!id) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) invalid('Artista no válido.');
    return pgrest('artists_db').select(ARTIST_SELECT).eq('user_id', id).limit(1).single().execute();
}

async function existingDraft(quoteId) {
    return pgrest('quotations_db')
        .select('id,quote_id,quote_status,client_user_id,client_email,job_board_request_id')
        .eq('quote_id', quoteId).limit(1).single().execute();
}

async function callSaveRpc(q, extras) {
    try {
        return await pgrest.raw('rpc/save_web_quotation', { method: 'POST', body: { p_quote: q, p_extras: extras } });
    } catch (error) {
        console.error('[quotation-intake] save_web_quotation:', error.status, String(error.message || '').slice(0, 300));
        invalid('No pudimos guardar la cotización. Intentá nuevamente.', 502);
    }
}

/**
 * Guarda (upsert) la cotización del borrador. Devuelve el estado guardado.
 * Lo usan el intake y la publicación en el Job Board.
 */
async function saveQuotation(body, user, { forceNoArtist = false } = {}) {
    const input = body.quotation || {};
    const artist = forceNoArtist ? null : await loadArtist(input.artist_id);
    if (forceNoArtist && body.quotation) body = { ...body, quotation: { ...input, artist_id: null } };
    const { q, extras, references } = normalizeIntake(body, user, artist);
    const previous = await existingDraft(q.quote_id);
    if (previous && previous.job_board_request_id) {
        return { q, extras, references, artist, previous, result: { quote_id: q.quote_id, status: 'job_board' } };
    }
    // Un autosave sin sesión (o con sesión vencida) no desvincula la cuenta
    // que ya había reclamado la cotización con el mismo correo.
    if (!q.client_user_id && previous && previous.client_user_id
        && String(previous.client_email || '').toLowerCase() === q.client_email) {
        q.client_user_id = previous.client_user_id;
    }
    const result = await callSaveRpc(q, extras);
    return { q, extras, references, artist, previous, result: result || { quote_id: q.quote_id, status: q.quote_status } };
}

// Referencias: Storage es la fuente de verdad. Se registran en la cotización
// (reference_images = URLs públicas, lo que lee el detalle del artista) y en
// quotations_attachments. Idempotente ante reintentos del envío.
async function persistReferences(quoteId, references) {
    if (!references.length) return;
    const supabaseUrl = process.env.SUPABASE_URL;
    const urls = references.map(ref => cotForm.referencePublicUrl(supabaseUrl, ref.path));
    await pgrest('quotations_db').eq('quote_id', quoteId).patch(
        { reference_images: urls, reference_images_count: urls.length }, { returning: false });
    await pgrest('quotations_attachments').eq('quotation_id', quoteId).eq('attachment_type', 'reference')
        .is('google_drive_id', null).delete();
    await pgrest('quotations_attachments').insert(cotForm.attachmentRows(quoteId, references, supabaseUrl), { returning: false });
}

function sendError(res, e) {
    const status = e.status || 500;
    if (!e.status) console.error('[quotation-intake]', e.message);
    res.status(status).json({ success: false, error: e.status ? e.message : 'No pudimos guardar la cotización.', ...(e.extra || {}) });
}

async function handleIntake(req, res) {
    try {
        const user = await resolveBearerUser(req);
        // Sesión vencida: la cotización sigue como anónima (se vincula después
        // por email) en vez de trabar el wizard con un 401.
        const sessionExpired = !!(req.headers.authorization && !user);
        const body = req.body || {};
        const saved = await saveQuotation(body, user);
        const status = saved.result.status;
        if (body.mode === 'submit' && status === 'job_board') {
            invalid('Esta idea ya está publicada en el Job Board.', 409, { job_board_request_id: saved.previous.job_board_request_id });
        }
        let referencesSaved = true;
        if (body.mode === 'submit' && status === 'pending') {
            try { await persistReferences(saved.q.quote_id, saved.references); }
            catch (error) {
                referencesSaved = false;
                console.error('[quotation-intake] referencias de', saved.q.quote_id, error.message);
            }
            // Avisos y copia a Drive solo en la transición real (un reintento
            // del mismo envío no los repite; los emails además son idempotentes).
            const freshlySubmitted = !saved.previous || saved.previous.quote_status === 'in_progress';
            if (freshlySubmitted && typeof hooks.afterSubmit === 'function') {
                Promise.resolve()
                    .then(() => hooks.afterSubmit({ req, quoteId: saved.q.quote_id, quote: saved.q, artist: saved.artist, references: saved.references, user }))
                    .catch(error => console.error('[quotation-intake] avisos post-envío:', error.message));
            }
        }
        res.json({ success: true, quote_id: saved.result.quote_id, status, session_expired: sessionExpired, references_saved: referencesSaved });
    } catch (e) { sendError(res, e); }
}

module.exports = { handleIntake, normalizeIntake, saveQuotation, persistReferences, deriveQuoteId, sendError, hooks, CLIENT_FIELDS };
