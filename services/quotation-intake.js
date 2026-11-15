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
const turnosIntake = require('../lib/turnos-intake');

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
    // Ronda 2 (P15): la edad se valida también acá. Menos de 14 no se envía;
    // entre 14 y 17 la base marca client_is_minor (trigger sobre client_birth_date).
    const ageInfo = cotForm.ageStatus(q.client_birth_date);
    q.client_age = ageInfo.age == null ? null : String(ageInfo.age);
    if (body.mode === 'submit' && !ageInfo.allowed) {
        invalid(`Para cotizar un tatuaje necesitas tener al menos ${cotForm.MIN_CLIENT_AGE} años.`, 400, { code: 'under_age', field: 'client_birth_date' });
    }
    // Sin tatuajes previos no hay nada que cubrir ("Es un cover-up" solo se pregunta si no es el primero).
    if (q.tattoo_is_first_tattoo === true || q.tattoo_is_first_tattoo === 'true') q.tattoo_is_cover_up = false;
    // P14: rango tentativo elegido en el calendario (client_preferred_date sigue siendo el texto visible).
    const dateRange = cotForm.normalizeDateRange(input.preferred_date_from, input.preferred_date_to);
    q.preferred_date_from = dateRange.from;
    q.preferred_date_to = dateRange.to;
    // P27: la sede la resuelve prepareQuotation contra las opciones reales del artista (solo en el envío).
    Object.assign(q, cotForm.preferredLocationColumns(null));
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
    if (body.mode === 'submit') {
        // P13: cada nota queda pegada a SU imagen. Un navegador con el script
        // anterior manda solo paths y las notas en extras, alineadas por índice.
        const legacyPaths = Array.isArray(body.references) && body.references.every(item => typeof item === 'string');
        if (legacyPaths) references.forEach((ref, i) => { ref.note = cotForm.cleanReferenceNote(extras.reference_notes[i]); });
        extras.reference_notes = cotForm.referenceNotes(references);
    }
    return { q, extras, references };
}

// P27: sede elegida por el cliente. El navegador manda solo la llave de la
// opción; los datos que se guardan salen de las opciones reales del artista.
async function resolvePreferredLocation(artistId, requested) {
    const key = typeof requested === 'string' ? requested : requested && requested.key;
    if (!artistId || !key || typeof key !== 'string') return cotForm.preferredLocationColumns(null);
    try {
        const sources = await require('../lib/repos/cot-form').CotFormRepo.locationSources(artistId);
        const options = sources ? cotForm.buildLocationOptions(sources) : [];
        return cotForm.preferredLocationColumns(cotForm.findLocationOption(options, key));
    } catch (error) {
        console.warn('[quotation-intake] sede preferida:', String(error.message || '').slice(0, 200));
        return cotForm.preferredLocationColumns(null);
    }
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

// quotations_db.client_user_id es FK a clients_db: solo se vincula una cuenta
// de cliente. Un artista (u otra cuenta sin perfil de cliente) que cotiza con
// su propio correo queda como anónimo en vez de romper el guardado (23503).
async function isClientAccount(userId) {
    try {
        const row = await pgrest('clients_db').select('user_id').eq('user_id', userId).limit(1).single().execute();
        return !!row;
    } catch (error) {
        console.warn('[quotation-intake] clients_db:', error.status, String(error.message || '').slice(0, 200));
        return false;
    }
}

async function callSaveRpc(q, extras) {
    try {
        return await pgrest.raw('rpc/save_web_quotation', { method: 'POST', body: { p_quote: q, p_extras: extras } });
    } catch (error) {
        console.error('[quotation-intake] save_web_quotation:', error.status, String(error.message || '').slice(0, 300));
        invalid('No pudimos guardar la cotización. Intentá nuevamente.', 502);
    }
}

// Normaliza el borrador y resuelve artista, borrador previo y vínculo de cuenta
// (sin guardar). La usan saveQuotation y el envío con turno (lib/turnos-intake).
async function prepareQuotation(body, user, { forceNoArtist = false, reusedFrom = null } = {}) {
    const input = body.quotation || {};
    const artist = forceNoArtist ? null : await loadArtist(input.artist_id);
    if (forceNoArtist && body.quotation) body = { ...body, quotation: { ...input, artist_id: null } };
    const { q, extras, references } = normalizeIntake(body, user, artist);
    // P32: origen de "Cotizar con otro artista" (solo lo fija el servidor al clonar).
    if (reusedFrom) q.reused_from_quote_id = String(reusedFrom).slice(0, 64);
    if (body.mode === 'submit' && artist && body.preferred_location) {
        Object.assign(q, await resolvePreferredLocation(artist.user_id, body.preferred_location));
    }
    const previous = await existingDraft(q.quote_id);
    if (previous && previous.job_board_request_id) {
        return { q, extras, references, artist, previous, jobBoard: true };
    }
    if (q.client_user_id && !(previous && previous.client_user_id === q.client_user_id)
        && !(await isClientAccount(q.client_user_id))) {
        q.client_user_id = null;
    }
    // Un autosave sin sesión (o con sesión vencida) no desvincula la cuenta
    // que ya había reclamado la cotización con el mismo correo.
    if (!q.client_user_id && previous && previous.client_user_id
        && String(previous.client_email || '').toLowerCase() === q.client_email) {
        q.client_user_id = previous.client_user_id;
    }
    return { q, extras, references, artist, previous };
}

/**
 * Guarda (upsert) la cotización del borrador. Devuelve el estado guardado.
 * Lo usan el intake y la publicación en el Job Board.
 */
async function saveQuotation(body, user, options = {}) {
    const prepared = await prepareQuotation(body, user, options);
    if (prepared.jobBoard) return { ...prepared, result: { quote_id: prepared.q.quote_id, status: 'job_board' } };
    const result = await callSaveRpc(prepared.q, prepared.extras);
    return { ...prepared, result: result || { quote_id: prepared.q.quote_id, status: prepared.q.quote_status } };
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
    // Cada fila lleva la nota de SU imagen (note) y la marca de IA (ai_generated).
    const rows = cotForm.attachmentRows(quoteId, references, supabaseUrl);
    try {
        await pgrest('quotations_attachments').insert(rows, { returning: false });
    } catch (error) {
        // Migración 20261116110000 sin aplicar: se guardan igual las referencias.
        if (!/PGRST204|Could not find the '(note|ai_generated)' column/i.test(String(error.message || ''))) throw error;
        await pgrest('quotations_attachments').insert(cotForm.legacyAttachmentRows(rows), { returning: false });
    }
}

// Código corto visible (quotations_db.short_code). null si la migración no está aplicada.
async function shortCodeOf(quoteId, known) {
    if (cotForm.isShortCode(known)) return known;
    try {
        const row = await pgrest('quotations_db').select('short_code').eq('quote_id', quoteId).limit(1).single().execute();
        return row && cotForm.isShortCode(row.short_code) ? row.short_code : null;
    } catch (_) {
        return null;
    }
}

function sendError(res, e) {
    const status = e.status || 500;
    if (!e.status) console.error('[quotation-intake]', e.message);
    res.status(status).json({ success: false, error: e.status ? e.message : 'No pudimos guardar la cotización.', ...(e.extra || {}) });
}

// Envío con turno: misma normalización que el intake; el apartado y el guardado
// los hace save_web_quotation_with_slot. Después, igual que un envío normal:
// referencias y confirmación al cliente (afterSubmit). El aviso al artista es
// booking_slot_requested (lo manda lib/turnos-intake), no artist_new_quotation.
async function handleSlotSubmit(req, res, body, user, slot, sessionExpired) {
    const prepared = await prepareQuotation(body, user);
    if (prepared.jobBoard) {
        invalid('Esta idea ya está publicada en el Job Board.', 409, { job_board_request_id: prepared.previous.job_board_request_id });
    }
    const captured = { status: 200, body: null };
    const sink = {
        headersSent: false,
        status(code) { captured.status = code; return sink; },
        json(payload) { captured.body = payload; sink.headersSent = true; return sink; }
    };
    const { applicationBase } = require('./email-request-context');
    await turnosIntake.handleSlotIntake(sink, { q: prepared.q, extras: prepared.extras, slot, artist: prepared.artist }, {
        sendEmail: (...args) => require('./email-service').sendEmail(...args),
        baseUrl: applicationBase(req)
    });
    const out = captured.body || { success: false, error: 'No pudimos guardar la cotización.' };
    let referencesSaved = true;
    if (out.success && out.status === 'pending') {
        try { await persistReferences(prepared.q.quote_id, prepared.references); }
        catch (error) {
            referencesSaved = false;
            console.error('[quotation-intake] referencias de', prepared.q.quote_id, error.message);
        }
        const freshlySubmitted = !prepared.previous || prepared.previous.quote_status === 'in_progress';
        if (freshlySubmitted && typeof hooks.afterSubmit === 'function') {
            Promise.resolve()
                .then(() => hooks.afterSubmit({ req, quoteId: prepared.q.quote_id, quote: prepared.q, artist: prepared.artist, references: prepared.references, user }))
                .catch(error => console.error('[quotation-intake] avisos post-envío:', error.message));
        }
    }
    if (!out.success) return res.status(captured.status).json(out);
    // El RPC con turno no devuelve el código corto: se lee de la fila guardada.
    const shortCode = await shortCodeOf(prepared.q.quote_id, out.short_code);
    return res.status(captured.status).json({ ...out, short_code: shortCode, session_expired: sessionExpired, references_saved: referencesSaved });
}

function notifyArtist(quoteId, req) {
    const notices = require('../lib/cot-artista-notices');
    const { applicationBase } = require('./email-request-context');
    notices.inBackground('artist_new_quotation', () => notices.notifyArtistNewQuotation(quoteId, { baseUrl: applicationBase(req) }));
}

async function handleIntake(req, res) {
    try {
        const user = await resolveBearerUser(req);
        // Sesión vencida: la cotización sigue como anónima (se vincula después
        // por email) en vez de trabar el wizard con un 401.
        const sessionExpired = !!(req.headers.authorization && !user);
        const body = req.body || {};
        // ── turnos ── envío final con turno elegido: apartado atómico (lib/turnos-intake.js).
        const slot = turnosIntake.requestedSlot(body);
        if (slot) return await handleSlotSubmit(req, res, body, user, slot, sessionExpired);
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
            // COT-A-03: aviso al artista (artist_new_quotation, idempotente). Las elegidas
            // entre sugerencias ya avisan con quotation_artist_selected (afterSubmit).
            if (freshlySubmitted && saved.q.artist_id && saved.q.source !== 'recommendation') notifyArtist(saved.q.quote_id, req);
            if (freshlySubmitted && typeof hooks.afterSubmit === 'function') {
                Promise.resolve()
                    .then(() => hooks.afterSubmit({ req, quoteId: saved.q.quote_id, quote: saved.q, artist: saved.artist, references: saved.references, user }))
                    .catch(error => console.error('[quotation-intake] avisos post-envío:', error.message));
            }
        }
        res.json({ success: true, quote_id: saved.result.quote_id, short_code: cotForm.isShortCode(saved.result.short_code) ? saved.result.short_code : null, status, session_expired: sessionExpired, references_saved: referencesSaved });
    } catch (e) { sendError(res, e); }
}

module.exports = { handleIntake, normalizeIntake, prepareQuotation, saveQuotation, persistReferences, deriveQuoteId, sendError, shortCodeOf, hooks, CLIENT_FIELDS };
