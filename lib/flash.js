'use strict';

// ===========================================================================
// Flash Tattoos · lógica pura del servidor (POST /api/flash/request).
// ---------------------------------------------------------------------------
// El cliente reserva un flash publicado en la galería del artista. El navegador
// solo manda QUÉ flash quiere (usuario del artista + id del ítem) y sus datos
// de contacto, zona, salud y fecha. Título, precio, moneda, tamaño e imagen
// salen SIEMPRE de artists_db.gallery_feed_items (nunca del navegador).
//
// La cotización se crea por el mismo camino que el cotizador web
// (services/quotation-intake): mismas validaciones, mismo vínculo de cuenta
// (solo con el correo verificado) y, si el cliente eligió turno, el mismo
// apartado de 72 h (save_web_quotation_with_slot).
//
// Modelo del ítem de galería: public/shared/js/flash-model.js.
// ===========================================================================

const Flash = require('../public/shared/js/flash-model.js');
const cotForm = require('./cot-form');
const { isPublicArtist } = require('./artist-visibility');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9._-]{2,60}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_CHIPS = ['Lo antes posible', 'Este mes', 'Próximo mes', 'Sin fecha'];
// Estados en los que un flash único queda tomado (mismo criterio que el trigger
// fn_quotations_flash_availability de 20261117130000_flash_tattoos.sql).
const RESERVED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
// Mensaje del trigger fn_quotations_flash_unique_reservation (misma migración):
// la base no deja aprobar una segunda solicitud del mismo flash único.
const FLASH_TAKEN_MESSAGE = 'Este flash ya se reservó con otra solicitud. Escríbele al artista para elegir otro diseño.';
// Basta con la parte sin tildes (el texto puede llegar con escapes JSON).
const FLASH_TAKEN_RE = /Este flash ya se reserv(ó|\\u00f3|o) con otra solicitud/i;

function isFlashTakenError(error) {
    return FLASH_TAKEN_RE.test(String((error && error.message) || error || ''));
}
// Solo se copian imágenes del bucket público de la galería del artista.
const GALLERY_BUCKETS = ['artist-gallery'];
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
const REFERENCE_NOTE = 'Flash del artista';

const LIMITS = { name: 120, email: 160, phone: 40, bodyPart: 255, health: 2000, allergies: 2000, dateLabel: 120 };

function httpError(message, status = 400, extra = {}) {
    return cotForm.httpError(message, status, extra);
}

function clean(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function boolOrNull(value) {
    if (value === true || value === 'true' || value === 'si' || value === 'sí') return true;
    if (value === false || value === 'false' || value === 'no') return false;
    return null;
}

/**
 * Valida y normaliza el pedido del navegador. Lanza httpError(400) con
 * { field } en el primer dato que falta (la página lo marca en rojo).
 */
function normalizeRequest(body = {}, now = new Date()) {
    const b = body && typeof body === 'object' ? body : {};
    const fail = (message, field, extra = {}) => { throw httpError(message, 400, { field, ...extra }); };
    if (!UUID_V4_RE.test(String(b.submission_key || ''))) fail('La solicitud no es válida. Recarga la página e inténtalo de nuevo.', 'submission_key');
    const artist = String(b.artist || '').replace(/^@+/, '').trim().toLowerCase();
    if (!USERNAME_RE.test(artist)) fail('El enlace del flash no es válido.', 'artist');
    const flashId = String(b.flash_id || '').trim();
    if (!Flash.validId(flashId)) fail('El enlace del flash no es válido.', 'flash_id');

    const name = clean(b.client_full_name, LIMITS.name);
    if (!name) fail('Escribe tu nombre.', 'client_full_name');
    const email = clean(b.client_email, LIMITS.email).toLowerCase();
    if (!EMAIL_RE.test(email)) fail('Escribe un correo válido.', 'client_email');
    const phone = clean(b.client_whatsapp, LIMITS.phone);
    if (phone.replace(/\D/g, '').length < 6) fail('Escribe un teléfono de contacto.', 'client_whatsapp');
    const firstTattoo = boolOrNull(b.tattoo_is_first_tattoo);
    if (firstTattoo === null) fail('Cuéntanos si es tu primer tatuaje.', 'tattoo_is_first_tattoo');

    const bodyPart = clean(b.tattoo_body_part, LIMITS.bodyPart);
    if (!bodyPart) fail('Elige la zona del cuerpo.', 'tattoo_body_part');
    const birth = String(b.client_birth_date || '').trim();
    const age = cotForm.ageStatus(birth, now);
    if (!age.known) fail('Indica tu fecha de nacimiento.', 'client_birth_date');
    if (!age.allowed) fail(`Para reservar un tatuaje necesitas tener al menos ${cotForm.MIN_CLIENT_AGE} años.`, 'client_birth_date', { code: 'under_age' });

    let slot = null;
    if (b.requested_slot && typeof b.requested_slot === 'object') {
        const start = Date.parse(b.requested_slot.start);
        const minutes = Number(b.requested_slot.minutes);
        if (!Number.isFinite(start) || !Number.isInteger(minutes) || minutes < 15 || minutes > 1440) fail('El turno elegido no es válido.', 'requested_slot');
        slot = { start: new Date(start).toISOString(), minutes };
    }
    const range = cotForm.normalizeDateRange(b.preferred_date_from, b.preferred_date_to, now);
    const chip = DATE_CHIPS.includes(b.client_preferred_date) ? b.client_preferred_date : null;
    if (!slot && !range.from && !chip) fail('Elige cuándo te gustaría tatuarte.', 'when');
    if (b.terms_accepted !== true) fail('Acepta los Términos y la Política de privacidad para enviar la solicitud.', 'terms_accepted');

    return {
        submissionKey: String(b.submission_key).toLowerCase(),
        artist,
        flashId,
        name,
        email,
        phone,
        firstTattoo,
        bodyPart,
        birthDate: birth,
        minor: age.minor === true,
        health: clean(b.client_health_conditions, LIMITS.health),
        allergies: clean(b.client_allergies, LIMITS.allergies),
        slot,
        range,
        chip,
        dateLabel: clean(b.client_preferred_date_label || b.client_preferred_date, LIMITS.dateLabel)
    };
}

/**
 * Busca el flash en la galería del artista y decide si se puede pedir.
 * Devuelve { item, view } o lanza el error que ve el cliente.
 */
function resolveFlash(artist, flashId, { user = null } = {}) {
    // Alta sin terminar o cuenta sancionada: el artista no recibe pedidos nuevos.
    if (!artist || !artist.user_id || !artist.username || !isPublicArtist(artist)) {
        throw httpError('No encontramos a ese artista.', 404, { code: 'artist_not_found' });
    }
    const items = Array.isArray(artist.gallery_feed_items) ? artist.gallery_feed_items : [];
    const item = Flash.findItem(items, flashId);
    const view = item ? Flash.flashOf(item) : null;
    if (!view || !view.id) {
        throw httpError('Este flash ya no está en la galería del artista.', 404, { code: 'flash_not_found' });
    }
    if (user && user.id && user.id === artist.user_id) {
        throw httpError('No puedes reservar tu propio flash.', 403, { code: 'own_flash' });
    }
    if (!view.available) {
        throw httpError('Este flash ya está reservado. Mira los otros flashes del artista.', 409, { code: 'flash_reserved' });
    }
    if (!view.hasPrice) {
        throw httpError('Este flash todavía no tiene precio. Pídele una cotización al artista.', 409, { code: 'flash_without_price' });
    }
    if (view.kind !== 'image' || !view.image) {
        throw httpError('Este flash no se puede reservar en línea.', 409, { code: 'flash_not_bookable' });
    }
    return { item, view };
}

/**
 * Ruta de la imagen del flash dentro de Storage (bucket de la galería del
 * artista en ESTE proyecto). null si es externa o no es una imagen.
 */
function gallerySourceOf(url, supabaseUrl) {
    const base = String(supabaseUrl || '').replace(/\/$/, '');
    const value = String(url || '').split('?')[0];
    if (!base || !value.startsWith(`${base}/storage/v1/object/public/`)) return null;
    const rest = value.slice(`${base}/storage/v1/object/public/`.length);
    const slash = rest.indexOf('/');
    if (slash < 1) return null;
    const bucket = rest.slice(0, slash);
    let path;
    try { path = decodeURIComponent(rest.slice(slash + 1)); } catch (_) { return null; }
    if (!GALLERY_BUCKETS.includes(bucket) || !path || path.includes('..') || !IMAGE_EXT_RE.test(path)) return null;
    return { bucket, path, ext: path.split('.').pop().toLowerCase().replace('jpeg', 'jpg') };
}

// Destino de la copia: cumple REFERENCE_PATH_RE (lib/cot-form.js).
function referencePathFor(quoteId, ext, nowMs = Date.now()) {
    const path = `${quoteId}/ref_1_${nowMs}.${ext}`;
    return cotForm.REFERENCE_PATH_RE.test(path) ? path : null;
}

function describe(view) {
    const parts = [`Flash «${view.title}» del artista, para tatuarlo tal cual.`];
    if (view.size) parts.push(`Tamaño aproximado: ${view.size}.`);
    if (view.zones.length) parts.push(`Zonas sugeridas por el artista: ${view.zones.join(', ')}.`);
    parts.push(view.unique ? 'Diseño único: se tatúa una sola vez.' : 'Diseño que se repite.');
    return parts.join(' ');
}

/**
 * Body del intake (services/quotation-intake) para este flash. Precio,
 * moneda, título y tamaño salen de la vista del servidor.
 */
function buildIntakeBody(input, view, artist, references = []) {
    const quotation = {
        artist_id: artist.user_id,
        tattoo_idea_description: describe(view),
        tattoo_size: view.size || 'Según el flash',
        tattoo_style: 'Flash',
        tattoo_body_part: input.bodyPart,
        tattoo_body_side: null,
        tattoo_color_type: null,
        tattoo_is_first_tattoo: input.firstTattoo,
        tattoo_is_cover_up: false,
        reference_images_count: references.length,
        client_full_name: input.name,
        client_email: input.email,
        client_whatsapp: input.phone,
        client_contact_preference: 'WhatsApp',
        client_birth_date: input.birthDate,
        client_health_conditions: input.health || 'Ninguna',
        client_allergies: input.allergies || 'Ninguna',
        client_budget_amount: view.price,
        client_budget_currency: view.currency,
        tattoo_estimated_sessions: '1',
        client_flexible_dates: !input.slot && !input.range.from,
        client_preferred_date: input.slot ? (input.dateLabel || 'Turno elegido')
            : input.range.from ? (input.dateLabel || input.range.from) : input.chip,
        preferred_date_from: input.slot ? input.slot.start.slice(0, 10) : input.range.from,
        preferred_date_to: input.slot ? input.slot.start.slice(0, 10) : input.range.to
    };
    const body = {
        submission_key: input.submissionKey,
        mode: 'submit',
        quotation,
        extras: { idea_mode: 'idea', personalization_level: 'tal_cual', reference_notes: references.map(() => REFERENCE_NOTE) },
        references: references.map((path) => ({ path, note: REFERENCE_NOTE }))
    };
    if (input.slot) body.requested_slot = { start: input.slot.start, minutes: input.slot.minutes };
    return body;
}

module.exports = {
    RESERVED_STATUSES,
    FLASH_TAKEN_MESSAGE,
    isFlashTakenError,
    GALLERY_BUCKETS,
    REFERENCE_NOTE,
    DATE_CHIPS,
    normalizeRequest,
    resolveFlash,
    gallerySourceOf,
    referencePathFor,
    buildIntakeBody,
    describe
};
