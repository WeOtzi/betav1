'use strict';

// ===========================================================================
// Detalle de cotización del artista (ronda 2 · frente cot-detalle) — lógica pura.
// ---------------------------------------------------------------------------
// Sin I/O: la usan lib/routes/cot-detalle.js y tests/r2-cot-detalle*.test.js.
//
//   · [P20/P23] Regla de contacto: el email, WhatsApp, Instagram y la
//     preferencia de contacto del cliente se entregan solo si el artista está
//     verificado (artists_db.verification_state = 'Yes') y el cliente no
//     rechazó la cotización. Las cotizaciones manuales (el contacto lo cargó
//     el propio artista) siempre lo muestran. La misma regla filtra el
//     buscador de clientes de la cotización manual (clientContacts).
//   · [P6] Perfil del cliente registrado visto desde la cotización (sin
//     contacto: eso lo decide la regla anterior).
//   · [P30] Enlace público /cotizacion/<token>: token aleatorio de 256 bits
//     del que solo se guarda el SHA-256, con vencimiento y revocación; "hoja"
//     pública con SOLO lo que el cliente debe ver (propuesta, desglose,
//     términos, artista) y el vínculo de la cotización a la cuenta que se
//     registra desde el enlace.
// ===========================================================================

const crypto = require('node:crypto');
const PublicUrl = require('../public/shared/js/artist-public-url.js');
const { isShortCode, visibleCode } = require('./quote-code');
const VerifiedBadge = require('../public/shared/js/verified-badge.js');

const QUOTE_ID_RE = /^[A-Za-z0-9-]{3,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_BYTES = 32;
const SHARE_PATH = '/cotizacion';
const SHARE_DAYS = Object.freeze([7, 30, 90]);
const DEFAULT_SHARE_DAYS = 30;
const MAX_ACTIVE_LINKS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// Columnas de quotations_db que NUNCA salen por el enlace público ni por la
// hoja exportable (los tests verifican que buildSheet no las filtre).
const PRIVATE_COLUMNS = Object.freeze([
    'client_health_conditions', 'client_allergies', 'client_birth_date', 'client_age',
    'client_email', 'client_whatsapp', 'client_instagram', 'client_contact_preference',
    'notes', 'priority', 'artist_email', 'client_user_id', 'session_id'
]);

function clean(value) {
    return String(value == null ? '' : value).trim();
}

function orNull(value) {
    const text = clean(value);
    return text || null;
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let raw = String(value).trim().replace(/[^0-9,.-]/g, '');
    if (!raw) return null;
    // "410.000" / "1.240,50" → miles con punto; "2.5" → decimal simple.
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
    else raw = raw.replace(',', '.');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function intOrNull(value) {
    const n = parseInt(String(value == null ? '' : value).replace(/[^0-9]/g, ' ').trim().split(/\s+/)[0], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function sameId(left, right) {
    return !!left && !!right && String(left).toLowerCase() === String(right).toLowerCase();
}

function normEmail(value) {
    return clean(value).toLowerCase();
}

function isValidQuoteId(value) {
    return QUOTE_ID_RE.test(String(value == null ? '' : value));
}

// ------------------------------------------------------------ contacto (P20/P23)

function isManual(quote) {
    return !!quote && (quote.source === 'manual' || quote.quotation_medium === 'manual');
}

// Regla de contacto: solo verification_state = 'Yes' (plan KYC 1.5). La
// insignia pública, en cambio, exige además el Instagram validado
// (VerifiedBadge.isBadgeVisible, ver buildSharePayload).
function isVerifiedArtist(artist) {
    return !!artist && String(artist.verification_state || '') === 'Yes';
}

/**
 * ¿El artista de la cotización puede ver el contacto del cliente?
 *   { visible: true,  reason: 'manual' | 'verified' }
 *   { visible: false, reason: 'client_rejected' | 'not_verified' | 'not_found' }
 */
function contactAccess({ quote, artist } = {}) {
    if (!quote) return { visible: false, reason: 'not_found' };
    if (isManual(quote)) return { visible: true, reason: 'manual' };
    if (quote.quote_status === 'client_rejected') return { visible: false, reason: 'client_rejected' };
    if (!isVerifiedArtist(artist)) return { visible: false, reason: 'not_verified' };
    return { visible: true, reason: 'verified' };
}

function contactFields(quote) {
    const q = quote || {};
    return {
        email: orNull(q.client_email),
        whatsapp: orNull(q.client_whatsapp),
        instagram: orNull(q.client_instagram),
        preference: orNull(q.client_contact_preference)
    };
}

/** Respuesta del endpoint de contacto: los datos solo viajan si corresponde. */
function contactResponse({ quote, artist } = {}) {
    const access = contactAccess({ quote, artist });
    const empty = { email: null, whatsapp: null, instagram: null, preference: null };
    return {
        visible: access.visible,
        reason: access.reason,
        verification_state: (artist && artist.verification_state) || 'No',
        ...(access.visible ? contactFields(quote) : empty)
    };
}

/**
 * Clientes de las cotizaciones del artista para el buscador de la cotización
 * manual (/my-quotations/new). Misma regla que el detalle: de cada cotización
 * viajan nombre, ciudad y fecha; el email, WhatsApp e Instagram solo si
 * contactAccess lo permite para ESA cotización (artista verificado y no
 * rechazada, o cotización manual). Un cliente que ya aparece con el contacto
 * visible no se repite como fila sin contacto.
 * Las filas conservan los nombres de columna de quotations_db
 * (client_full_name, client_email…) más contact_visible.
 */
function clientContacts({ rows, artist } = {}) {
    const out = [];
    const visibleNames = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const name = clean(row && row.client_full_name);
        if (!name) continue;
        const visible = contactAccess({ quote: row, artist }).visible;
        if (visible) visibleNames.add(name.toLowerCase());
        out.push({
            client_full_name: name,
            client_city_residence: orNull(row.client_city_residence),
            created_at: row.created_at || null,
            client_email: visible ? orNull(row.client_email) : null,
            client_whatsapp: visible ? orNull(row.client_whatsapp) : null,
            client_instagram: visible ? orNull(row.client_instagram) : null,
            contact_visible: visible
        });
    }
    return out.filter((c) => c.contact_visible || !visibleNames.has(c.client_full_name.toLowerCase()));
}

// ------------------------------------------------------------ perfil del cliente (P6)

const DONE_SESSION = ['completed'];
const OPEN_SESSION = ['scheduled', 'rescheduled'];

function isWizardDraft(q) {
    return !!q && (q.quote_status === 'in_progress' || q.quote_status === 'en_progreso')
        && !q.artist_responded_at && !clean(q.artist_budget_amount) && !clean(q.final_budget_amount);
}

function safeHttpUrl(value) {
    const raw = clean(value);
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (_) {
        return null;
    }
}

/**
 * Perfil del cliente registrado para el modal del detalle. Sin contacto, sin
 * salud: nombre, foto, ciudad, antigüedad, historial con ESTE artista y las
 * reseñas públicas que dejó.
 */
function clientProfile({ client, profile, quote, quotes, sessions, reviews, reviewsCount } = {}) {
    const c = client || {};
    const p = profile || {};
    const q = quote || {};
    const composed = [p.first_name, p.last_name].map(clean).filter(Boolean).join(' ');
    const name = clean(c.full_name) || composed || clean(q.client_full_name) || 'Cliente';
    const sent = (Array.isArray(quotes) ? quotes : []).filter((row) => row && !isWizardDraft(row));
    const ids = new Set(sent.map((row) => String(row.id)));
    const own = (Array.isArray(sessions) ? sessions : []).filter((s) => s && ids.has(String(s.quotation_id)));
    const status = (s) => String(s.status || '').toLowerCase();
    const dates = sent.map((row) => Date.parse(row.created_at)).filter(Number.isFinite);
    const list = (Array.isArray(reviews) ? reviews : []).slice(0, 5).map((r) => ({
        rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))) || null,
        comment: clean(r.comment).slice(0, 600),
        about: clean(r.reviewee_display_name) || (r.reviewee_type === 'studio' ? 'Estudio' : 'Artista'),
        about_type: r.reviewee_type === 'studio' ? 'studio' : 'artist',
        created_at: r.created_at || null
    }));
    return {
        name,
        username: orNull(c.public_username) || orNull(p.username),
        photo_url: safeHttpUrl(c.profile_picture) || safeHttpUrl(p.photo_url),
        city: orNull(c.city_residence) || orNull(q.client_city_residence),
        country: orNull(c.country) || orNull(p.country),
        member_since: c.created_at || null,
        with_artist: {
            quotations: sent.length,
            completed: sent.filter((row) => row.quote_status === 'completed').length,
            sessions_done: own.filter((s) => DONE_SESSION.includes(status(s))).length,
            sessions_scheduled: own.filter((s) => OPEN_SESSION.includes(status(s))).length,
            first_quote_at: dates.length ? new Date(Math.min(...dates)).toISOString() : null
        },
        reviews: list,
        reviews_count: Number.isFinite(Number(reviewsCount)) ? Number(reviewsCount) : list.length
    };
}

// ------------------------------------------------------------ enlaces públicos (P30)

function newShareToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function isValidToken(value) {
    return typeof value === 'string' && TOKEN_RE.test(value);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Días de vigencia pedidos → uno de SHARE_DAYS (30 por defecto). */
function normalizeShareDays(value) {
    const n = Number(value);
    return SHARE_DAYS.includes(n) ? n : DEFAULT_SHARE_DAYS;
}

function shareExpiry(days, now = Date.now()) {
    return new Date(now + normalizeShareDays(days) * DAY_MS).toISOString();
}

function shareUrl(base, token) {
    return `${String(base == null ? '' : base).replace(/\/+$/, '')}${SHARE_PATH}/${token}`;
}

/** 'active' | 'expired' | 'revoked' */
function linkState(link, now = Date.now()) {
    if (!link) return 'revoked';
    if (link.revoked_at) return 'revoked';
    const at = Date.parse(link.expires_at);
    if (!Number.isFinite(at) || at <= now) return 'expired';
    return 'active';
}

/** Lo que el artista ve de un enlace: nunca el token ni su hash. */
function linkSummary(link, now = Date.now()) {
    return {
        id: link.id,
        state: linkState(link, now),
        created_at: link.created_at || null,
        expires_at: link.expires_at || null,
        view_count: Number(link.view_count) || 0,
        last_viewed_at: link.last_viewed_at || null,
        claimed: !!link.claimed_at
    };
}

function activeLinks(links, now = Date.now()) {
    return (Array.isArray(links) ? links : []).filter((l) => linkState(l, now) === 'active');
}

/** ¿Se puede compartir esta cotización? Los borradores del cotizador no. */
function shareVerdict({ user, quote } = {}) {
    if (!user) return { ok: false, status: 401, code: 'auth', error: 'Inicia sesión para compartir la cotización.' };
    if (!quote || !sameId(quote.artist_id, user.id)) {
        return { ok: false, status: 404, code: 'not_found', error: 'No encontramos esa cotización en tu cuenta.' };
    }
    if (isWizardDraft(quote)) {
        return { ok: false, status: 409, code: 'draft', error: 'Esta solicitud todavía es un borrador del cliente: no se puede compartir.' };
    }
    return { ok: true };
}

const STATUS_LABELS = Object.freeze({
    pending: 'Solicitud recibida',
    responded: 'Propuesta enviada',
    client_approved: 'Propuesta aceptada',
    in_progress: 'En curso',
    en_progreso: 'En curso',
    artist_completed: 'Trabajo entregado',
    completed: 'Completada',
    client_rejected: 'Propuesta rechazada',
    cancelled: 'Cancelada por el artista',
    expired: 'Propuesta vencida'
});
// Cotización cerrada por soporte (quotations_db.support_closed_reason, por
// ejemplo al dar de baja el perfil del artista): manda sobre el estado.
const SUPPORT_CLOSED_LABEL = 'Cancelada por soporte';

// tattoo_style es jsonb ({ style_name, substyle_name } | [..] | texto).
function styleName(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const raw = value.trim();
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try { return styleName(JSON.parse(raw)); } catch (_) { return raw; }
        }
        return raw;
    }
    if (Array.isArray(value)) return [...new Set(value.map(styleName).filter(Boolean))].join(' · ');
    if (typeof value === 'object') {
        if (Array.isArray(value.styles) && value.styles.length) return styleName(value.styles);
        return clean(value.substyle_name || value.style_name || value.name || value.label);
    }
    return String(value);
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/** Desglose de la cotización manual (conceptos, descuento, impuestos, total). */
function breakdownFrom(manual) {
    if (!manual) return null;
    const items = (Array.isArray(manual.line_items) ? manual.line_items : [])
        .map((it) => {
            const qty = numberOrNull(it && it.qty);
            const price = numberOrNull(it && it.price);
            const total = numberOrNull(it && it.total);
            return {
                name: clean(it && it.name).slice(0, 160),
                description: orNull(it && it.description) ? clean(it.description).slice(0, 400) : null,
                qty: qty == null ? 1 : qty,
                price: price == null ? 0 : price,
                total: total != null ? total : round2((qty == null ? 1 : qty) * (price || 0))
            };
        })
        .filter((it) => it.name || it.total > 0)
        .slice(0, 40);
    if (!items.length) return null;
    const subtotal = numberOrNull(manual.subtotal) != null ? numberOrNull(manual.subtotal) : round2(items.reduce((sum, it) => sum + it.total, 0));
    const discountPct = numberOrNull(manual.discount_pct) || 0;
    const taxPct = numberOrNull(manual.tax_pct) || 0;
    const discount = round2(subtotal * discountPct / 100);
    const tax = round2((subtotal - discount) * taxPct / 100);
    const total = numberOrNull(manual.total) != null ? numberOrNull(manual.total) : round2(subtotal - discount + tax);
    return {
        items,
        subtotal,
        discount_pct: discountPct,
        discount_amount: discount,
        tax_pct: taxPct,
        tax_amount: tax,
        total,
        currency: clean(manual.currency).toUpperCase() || null
    };
}

function sessionsFrom(sessions) {
    return (Array.isArray(sessions) ? sessions : [])
        .filter((s) => s && s.session_date && !['cancelled', 'canceled', 'no_show'].includes(String(s.status || '').toLowerCase()))
        .sort((a, b) => Date.parse(a.session_date) - Date.parse(b.session_date))
        .slice(0, 6)
        .map((s, index) => ({
            number: intOrNull(s.session_number) || index + 1,
            date: s.session_date,
            done: String(s.status || '').toLowerCase() === 'completed'
        }));
}

/**
 * Hoja de la cotización: lo que ve el cliente en /cotizacion/<token>, en el
 * PDF y en la imagen. Lista blanca explícita: nunca salud, contacto, notas
 * privadas ni correos. `base` es el origen + base path de la app.
 */
function buildSheet({ quote, manual, artist, sessions, link, base, reserved, now = Date.now() } = {}) {
    const q = quote || {};
    const m = manual && typeof manual === 'object' ? manual : null;
    const a = artist || {};
    const project = (m && m.project && typeof m.project === 'object') ? m.project : {};
    const breakdown = breakdownFrom(m);

    const finalAmount = numberOrNull(q.final_budget_amount);
    const artistAmount = numberOrNull(q.artist_budget_amount);
    const amount = finalAmount != null ? finalAmount : (artistAmount != null ? artistAmount : (breakdown ? breakdown.total : null));
    const currency = clean(finalAmount != null ? q.final_budget_currency : '') || clean(q.artist_budget_currency)
        || (breakdown && breakdown.currency) || clean(q.client_budget_currency) || 'USD';

    let depositPct = numberOrNull(q.artist_deposit_pct);
    let depositAmount = numberOrNull(q.artist_deposit_amount);
    if (m && depositPct == null && depositAmount == null && clean(m.cancellation_policy) !== 'sin-sena') {
        depositPct = numberOrNull(m.deposit_pct);
        depositAmount = numberOrNull(m.deposit_amount);
    }
    if (depositPct != null && depositPct <= 0) depositPct = null;
    if (depositAmount != null && depositAmount <= 0) depositAmount = null;
    if (depositAmount == null && depositPct != null && amount != null) depositAmount = round2(amount * depositPct / 100);

    const sessionMinutes = intOrNull(q.artist_session_minutes)
        || (numberOrNull(project.session_hours) ? Math.round(numberOrNull(project.session_hours) * 60) : null);
    const expiryAt = q.quote_expiry_enabled && q.quote_expires_at ? q.quote_expires_at : null;
    const status = clean(q.quote_status) || 'pending';
    const username = clean(a.username) || clean(q.artist_username);

    return {
        quote_id: clean(q.quote_id),
        // Código corto visible: es la referencia que se imprime en la hoja, el PDF
        // y la imagen. El quote_id queda para los enlaces.
        short_code: isShortCode(q.short_code) ? q.short_code : null,
        status,
        status_label: clean(q.support_closed_reason) ? SUPPORT_CLOSED_LABEL : (STATUS_LABELS[status] || STATUS_LABELS.pending),
        support_closed: Boolean(clean(q.support_closed_reason)),
        is_manual: isManual(q),
        created_at: q.created_at || null,
        responded_at: q.artist_responded_at || null,
        valid_until: expiryAt,
        client_name: clean(q.client_full_name).slice(0, 120) || null,
        title: (clean(project.title) || clean(q.project_description)).slice(0, 200) || null,
        idea: (clean(q.tattoo_idea_description) || clean(project.description)).slice(0, 2000) || null,
        facts: {
            style: styleName(q.tattoo_style) || styleName(project.style) || null,
            body_part: [clean(q.tattoo_body_part), clean(q.tattoo_body_side)].filter(Boolean).join(' · ') || null,
            size: orNull(q.tattoo_size),
            color: orNull(q.tattoo_color_type),
            cover_up: q.tattoo_is_cover_up === true ? true : (q.tattoo_is_cover_up === false ? false : null)
        },
        proposal: {
            has_proposal: amount != null,
            agreed: finalAmount != null,
            amount,
            currency,
            sessions: intOrNull(q.final_sessions) || intOrNull(q.tattoo_estimated_sessions) || intOrNull(project.sessions),
            session_minutes: sessionMinutes,
            deposit_pct: depositPct,
            deposit_amount: depositAmount,
            balance: amount != null && depositAmount != null ? round2(amount - depositAmount) : null,
            availability: orNull(q.artist_availability),
            location: orNull(project.location) || orNull(q.artist_studio_name) || orNull(a.city) || orNull(q.artist_current_city)
        },
        breakdown,
        terms: m ? {
            validity_days: expiryAt ? (intOrNull(q.quote_expiry_days) || intOrNull(m.validity_days)) : null,
            policy: orNull(m.cancellation_policy),
            client_notes: orNull(m.client_notes) ? clean(m.client_notes).slice(0, 2000) : null,
            extra_terms: orNull(m.extra_terms) ? clean(m.extra_terms).slice(0, 2000) : null
        } : null,
        sessions: sessionsFrom(sessions),
        artist: {
            name: clean(a.name) || clean(q.artist_name) || 'Tu artista',
            username: username || null,
            profile_url: username ? PublicUrl.publicProfileUrl(username, base || '', { reserved }) : null,
            city: orNull(a.city) || orNull(a.ubicacion) || orNull(q.artist_current_city),
            studio: orNull(q.artist_studio_name) || orNull(a.estudios),
            photo_url: safeHttpUrl(a.profile_picture),
            // Insignia: verificado y con el Instagram validado.
            verified: VerifiedBadge.isBadgeVisible(a)
        },
        link: link ? { expires_at: link.expires_at || null } : null,
        claim: { linked: !!q.client_user_id },
        generated_at: new Date(now).toISOString()
    };
}

// ------------------------------------------------------------ vínculo desde el enlace

// Email verificado de verdad (mismo criterio que lib/cot-cliente.js).
function isEmailVerified(user) {
    const raw = (user && user.raw) || {};
    if (!user || !user.email || !raw.email_confirmed_at) return false;
    for (const meta of [raw.app_metadata, raw.user_metadata]) {
        if (meta && (meta.qa_unverified_email === true || meta.qa_unverified_email === 'true')) return false;
    }
    return true;
}

/**
 * ¿La cuenta puede vincular la cotización abierta desde el enlace?
 *   { ok:false, status, code, error }
 *   { ok:true, already:true }
 *   { ok:true, claim:true, setEmail:boolean }
 * La cuenta tiene que ser la del correo de la cotización, verificado (misma
 * regla que POST /api/client/quotations/claim): vale para las recibidas por el
 * cotizador y también para las manuales en las que el artista cargó el correo
 * de su cliente. Un enlace reenviado no alcanza: quien vincula pasa a leer la
 * fila completa (contacto incluido) y a responder la propuesta.
 * Única excepción: la manual SIN correo cargado se vincula con solo el enlace
 * (no hay contra qué comparar) y, si la cuenta está verificada, su correo
 * queda como el de la cotización (setEmail).
 * Si el artista escribió mal el correo, nadie puede vincular hasta que se
 * corrija (decisión anotada en docs/TECHNICAL.md §7.1).
 */
function claimVerdict({ user, quote, link, isClientAccount, now = Date.now() } = {}) {
    if (!user) return { ok: false, status: 401, code: 'auth', error: 'Inicia sesión para vincular la cotización a tu cuenta.' };
    const state = linkState(link, now);
    if (!quote || state !== 'active' || !sameId(link.quotation_id, quote.id) || !sameId(link.artist_id, quote.artist_id)) {
        return { ok: false, status: 410, code: 'link_' + (state === 'active' ? 'invalid' : state), error: 'Este enlace ya no está disponible. Pídele uno nuevo a tu artista.' };
    }
    if (sameId(quote.artist_id, user.id)) {
        return { ok: false, status: 409, code: 'own', error: 'Esta cotización es tuya: ábrela desde tu panel de artista.' };
    }
    if (quote.client_user_id) {
        if (sameId(quote.client_user_id, user.id)) return { ok: true, already: true };
        return { ok: false, status: 409, code: 'claimed', error: 'Esta cotización ya está vinculada a otra cuenta.' };
    }
    if (!isClientAccount) {
        return { ok: false, status: 409, code: 'not_client', error: 'Necesitas una cuenta de cliente para vincular esta cotización.' };
    }
    const manual = isManual(quote);
    const quoteEmail = normEmail(quote.client_email);
    if (!manual || quoteEmail) {
        if (!isEmailVerified(user)) {
            return { ok: false, status: 403, code: 'email_unverified', error: 'Confirma tu correo para vincular esta cotización a tu cuenta.' };
        }
        if (!quoteEmail || quoteEmail !== normEmail(user.email)) {
            return {
                ok: false, status: 403, code: 'email_mismatch',
                error: manual
                    ? 'Tu artista envió esta cotización a otro correo. Entra con la cuenta de ese correo o pídele que lo actualice.'
                    : 'Esta cotización se pidió con otro correo. Inicia sesión con la cuenta de ese correo para vincularla.'
            };
        }
    }
    return { ok: true, claim: true, setEmail: manual && !quoteEmail && isEmailVerified(user) };
}

module.exports = {
    QUOTE_ID_RE, TOKEN_RE, SHARE_PATH, SHARE_DAYS, DEFAULT_SHARE_DAYS, MAX_ACTIVE_LINKS, PRIVATE_COLUMNS, STATUS_LABELS, SUPPORT_CLOSED_LABEL,
    isValidQuoteId, isManual, isVerifiedArtist, isWizardDraft,
    contactAccess, contactFields, contactResponse, clientContacts,
    clientProfile,
    newShareToken, isValidToken, hashToken, normalizeShareDays, shareExpiry, shareUrl,
    linkState, linkSummary, activeLinks, shareVerdict,
    styleName, breakdownFrom, sessionsFrom, buildSheet, visibleCode,
    isEmailVerified, claimVerdict,
    numberOrNull, intOrNull, safeHttpUrl
};
