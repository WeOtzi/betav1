'use strict';

// ===========================================================================
// Denuncias → tickets de soporte (ronda 2 · frente "denuncias", P33)
// ---------------------------------------------------------------------------
// Lógica pura, sin red: catálogo de motivos, validación de lo que manda el
// navegador, armado del expediente (denunciante + denunciado + contexto) y
// formas de respuesta para el panel de soporte. La usan
// lib/routes/denuncias.js (servidor) y tests/r2-denuncias*.test.js.
//
// Quién denuncia qué:
//   · artista            → una cotización que recibió (comentarios abusivos,
//                          fotos inapropiadas, violencia, spam)
//   · artista            → el perfil de otro artista
//   · dueño o manager de → otro estudio (suplantación de identidad, robo de
//     estudio              propiedad intelectual, difamación)
//
// El mismo catálogo vive en public/shared/js/wo-report.js (el modal); un test
// verifica que no se desalineen.
// ===========================================================================

const KINDS = ['quotation', 'artist', 'studio'];

const QUOTATION_REASONS = [
    { code: 'comentarios_abusivos', label: 'Comentarios abusivos' },
    { code: 'fotos_inapropiadas', label: 'Fotos inapropiadas' },
    { code: 'violencia', label: 'Violencia' },
    { code: 'spam', label: 'Spam' }
];
const PROFILE_REASONS = [
    { code: 'suplantacion_identidad', label: 'Suplantación de identidad' },
    { code: 'robo_propiedad_intelectual', label: 'Robo de propiedad intelectual' },
    { code: 'difamacion', label: 'Difamación' }
];
const REASONS = { quotation: QUOTATION_REASONS, artist: PROFILE_REASONS, studio: PROFILE_REASONS };

const KIND_LABELS = { quotation: 'Cotización', artist: 'Artista', studio: 'Estudio' };
const REPORTER_ROLE_LABELS = { artist: 'Artista', studio_owner: 'Dueño de estudio', studio_manager: 'Manager de estudio' };
const REPORTED_ROLE_LABELS = { client: 'Cliente', artist: 'Artista', studio: 'Estudio' };

const TICKET_STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const ACTIVE_STATUSES = ['open', 'in_progress', 'waiting_user'];
const STATUS_LABELS = {
    open: 'Abierta', in_progress: 'En revisión', waiting_user: 'Esperando al denunciante', resolved: 'Resuelta', closed: 'Cerrada'
};
const OUTCOMES = ['resuelto', 'sin_accion'];
const OUTCOME_LABELS = { resuelto: 'Se tomó acción', sin_accion: 'Sin acción' };

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 3000;
const MAX_LINKS = 5;
const MAX_LINK_LENGTH = 500;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic)$/i;
const ATTACHMENTS_BUCKET = 'support-attachments';
const ATTACHMENTS_FOLDER = 'denuncias';
const NOTE_MAX = 4000;
const RESOLUTION_MAX = 4000;
const DOSSIER_MESSAGES_MAX = 80;
const DOSSIER_MESSAGE_CHARS = 2000;
const DOSSIER_ATTACHMENTS_MAX = 30;
const DOSSIER_REFERENCES_MAX = 20;
const DOSSIER_VERSION = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUOTE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,59}$/;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,99}$/;
const STORAGE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,399}$/;

function isUuid(value) {
    return UUID_RE.test(String(value == null ? '' : value));
}

// Texto de una sola línea: sin caracteres de control ni < > (los datos se
// escapan al mostrarse; esto evita además basura en asuntos y logs).
function cleanLine(value, max = 200) {
    return String(value == null ? '' : value)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

// Texto de varias líneas: conserva saltos de línea, sin otros controles.
function cleanMultiline(value, max = DESCRIPTION_MAX) {
    return String(value == null ? '' : value)
        .replace(/\r\n?/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max);
}

function reasonsFor(kind) {
    return REASONS[kind] ? REASONS[kind].map((r) => ({ ...r })) : [];
}

function reasonLabel(kind, code) {
    const found = (REASONS[kind] || []).find((r) => r.code === code);
    return found ? found.label : '';
}

function isValidReason(kind, code) {
    return Boolean(reasonLabel(kind, code));
}

function ticketCode(number) {
    const n = Number(number);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `WO-${String(Math.trunc(n)).padStart(5, '0')}`;
}

// Violencia es urgente; el resto de las denuncias entra con prioridad alta.
function priorityFor(reason) {
    return reason === 'violencia' ? 'urgent' : 'high';
}

function targetKey(kind, id) {
    return `${kind}:${String(id)}`;
}

function buildSubject({ kind, reason, targetLabel }) {
    const parts = [`Denuncia de ${(KIND_LABELS[kind] || 'contenido').toLowerCase()}`, reasonLabel(kind, reason), cleanLine(targetLabel, 90)]
        .filter(Boolean);
    return cleanLine(parts.join(' · '), 160);
}

// Referencia del objetivo tal como llega en data-id: se aceptan los ids que
// cualquier pantalla tiene a mano (id numérico o código de cotización; uuid o
// usuario del artista; uuid o slug del estudio).
function parseTargetRef(kind, raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value || value.length > 100) return null;
    if (kind === 'quotation') {
        if (/^\d{1,9}$/.test(value)) return { by: 'id', value: Number(value) };
        return QUOTE_CODE_RE.test(value) ? { by: 'quote_id', value } : null;
    }
    if (kind === 'artist') {
        if (isUuid(value)) return { by: 'uuid', value: value.toLowerCase() };
        const username = value.replace(/^@+/, '');
        return USERNAME_RE.test(username) ? { by: 'username', value: username } : null;
    }
    if (kind === 'studio') {
        if (isUuid(value)) return { by: 'id', value: value.toLowerCase() };
        return SLUG_RE.test(value) ? { by: 'slug', value } : null;
    }
    return null;
}

function normalizeLink(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text || text.length > MAX_LINK_LENGTH) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000- \u007f<>"'`\\]/.test(text)) return null;
    let url;
    try { url = new URL(text); } catch (_) { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname || !url.hostname.includes('.') || url.username || url.password) return null;
    return url.href.length <= MAX_LINK_LENGTH ? url.href : null;
}

// { ok, links } | { ok:false, error }
function parseLinks(input) {
    let list = [];
    if (Array.isArray(input)) list = input;
    else if (typeof input === 'string') list = input.split(/[\s,]+/);
    else if (input != null) return { ok: false, error: 'Los enlaces no tienen un formato válido.' };
    const raw = list.map((item) => String(item == null ? '' : item).trim()).filter(Boolean);
    const out = [];
    for (const item of raw) {
        const link = normalizeLink(item);
        if (!link) return { ok: false, error: 'Revisa los enlaces: cada uno debe ser una dirección completa que empiece con https://' };
        if (!out.includes(link)) out.push(link);
    }
    if (out.length > MAX_LINKS) return { ok: false, error: `Puedes agregar hasta ${MAX_LINKS} enlaces.` };
    return { ok: true, links: out };
}

// Adjuntos ya subidos por el navegador al bucket privado de soporte, bajo
// `<user_id>/denuncias/…`. { ok, attachments } | { ok:false, error }
function parseAttachments(input, userId) {
    if (input == null) return { ok: true, attachments: [] };
    if (!Array.isArray(input)) return { ok: false, error: 'Las imágenes no tienen un formato válido.' };
    if (input.length > MAX_IMAGES) return { ok: false, error: `Puedes adjuntar hasta ${MAX_IMAGES} imágenes.` };
    const prefix = `${String(userId || '').toLowerCase()}/${ATTACHMENTS_FOLDER}/`;
    const out = [];
    for (const item of input) {
        const path = item && typeof item.path === 'string' ? item.path : '';
        if (!isUuid(userId) || !STORAGE_PATH_RE.test(path) || path.includes('..') || path.includes('//')
            || !path.toLowerCase().startsWith(prefix)) {
            return { ok: false, error: 'Una de las imágenes no se subió bien. Quítala y vuelve a subirla.' };
        }
        const type = cleanLine(item.type, 80).toLowerCase();
        const typeOk = type ? IMAGE_TYPES.includes(type) : IMAGE_EXT_RE.test(path);
        if (!typeOk) return { ok: false, error: 'Solo se admiten imágenes JPG, PNG, WEBP o HEIC.' };
        const size = Number(item.size);
        if (Number.isFinite(size) && size > MAX_IMAGE_BYTES) return { ok: false, error: 'Cada imagen puede pesar hasta 10 MB.' };
        if (out.some((a) => a.path === path)) continue;
        out.push({
            name: cleanLine(item.name, 120) || 'imagen',
            path,
            size: Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0,
            type
        });
    }
    return { ok: true, attachments: out };
}

// Cuerpo de POST /api/reports → { ok, value } | { ok:false, status, field, error }
function parseReportInput(body, { userId } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const kind = String(b.kind || '').trim();
    if (!KINDS.includes(kind)) return { ok: false, status: 400, field: 'kind', error: 'No reconocemos qué quieres denunciar.' };
    const target = parseTargetRef(kind, b.target_id != null ? b.target_id : b.id);
    if (!target) return { ok: false, status: 400, field: 'target_id', error: 'No encontramos lo que quieres denunciar.' };
    const reason = String(b.reason || '').trim();
    if (!isValidReason(kind, reason)) return { ok: false, status: 400, field: 'reason', error: 'Elige el motivo de la denuncia.' };
    const description = cleanMultiline(b.description, DESCRIPTION_MAX + 1);
    if (description.length < DESCRIPTION_MIN) {
        return { ok: false, status: 400, field: 'description', error: `Cuéntanos qué pasó con al menos ${DESCRIPTION_MIN} caracteres.` };
    }
    if (description.length > DESCRIPTION_MAX) {
        return { ok: false, status: 400, field: 'description', error: `La descripción puede tener hasta ${DESCRIPTION_MAX} caracteres.` };
    }
    const links = parseLinks(b.links);
    if (!links.ok) return { ok: false, status: 400, field: 'links', error: links.error };
    const attachments = parseAttachments(b.attachments, userId);
    if (!attachments.ok) return { ok: false, status: 400, field: 'attachments', error: attachments.error };
    return {
        ok: true,
        value: {
            kind,
            target,
            reason,
            description,
            links: links.links,
            attachments: attachments.attachments,
            pageContext: cleanLine(b.page_context, 300) || null
        }
    };
}

// ---- Fichas del expediente (listas blancas: nunca salud, alergias ni fecha de nacimiento) ----

function artistProfilePath(username) {
    const u = cleanLine(username, 80);
    return u ? `/artist/profile?artist=${encodeURIComponent(u)}` : '';
}

function studioProfilePath(studio) {
    const ref = studio && (studio.slug || studio.id);
    return ref ? `/studio/profile?studio=${encodeURIComponent(String(ref))}` : '';
}

function pickArtist(row) {
    if (!row || typeof row !== 'object') return null;
    return {
        id: row.id || null,
        user_id: row.user_id || null,
        name: cleanLine(row.name, 160),
        username: cleanLine(row.username, 80),
        email: cleanLine(row.email, 200).toLowerCase(),
        instagram: cleanLine(row.instagram, 120),
        whatsapp: cleanLine(row.whatsapp_number, 60),
        city: cleanLine(row.city, 120),
        country: cleanLine(row.country, 120),
        studio_id: row.studio_id || null,
        studio_text: cleanLine(row.estudios, 160),
        styles: Array.isArray(row.styles_array) ? row.styles_array.slice(0, 12).map((s) => cleanLine(s, 60)).filter(Boolean) : [],
        verification_state: cleanLine(row.verification_state, 40),
        instagram_verified_handle: cleanLine(row.instagram_verified_handle, 80),
        registration_status: cleanLine(row.registration_status, 40),
        profile_picture: cleanLine(row.profile_picture, 500),
        profile_path: artistProfilePath(row.username)
    };
}

function pickClient(row) {
    if (!row || typeof row !== 'object') return null;
    return {
        user_id: row.user_id || null,
        name: cleanLine(row.full_name, 160),
        username: cleanLine(row.public_username, 80),
        email: cleanLine(row.email, 200).toLowerCase(),
        instagram: cleanLine(row.instagram, 120),
        whatsapp: cleanLine(row.whatsapp, 60),
        city: cleanLine(row.city_residence, 120),
        country: cleanLine(row.country, 120),
        email_verified: row.email_verified === true,
        created_at: row.created_at || null
    };
}

function pickStudio(row) {
    if (!row || typeof row !== 'object') return null;
    return {
        id: row.id || null,
        owner_user_id: row.user_id || null,
        name: cleanLine(row.name, 160),
        slug: cleanLine(row.slug, 120),
        email: cleanLine(row.email, 200).toLowerCase(),
        phone: cleanLine(row.contact_phone || row.phone, 60),
        whatsapp: cleanLine(row.whatsapp, 60),
        website: cleanLine(row.website, 300),
        instagram: cleanLine(row.instagram, 120),
        city: cleanLine(row.city, 120),
        country: cleanLine(row.country, 120),
        address: cleanLine(row.formatted_address, 300),
        is_verified: row.is_verified === true,
        verification_status: cleanLine(row.verification_status, 40),
        is_active: row.is_active !== false,
        created_at: row.created_at || null,
        profile_path: studioProfilePath(row)
    };
}

// URLs que ya estaban guardadas (referencias, Drive): se conservan si son
// http(s); `new URL` las normaliza y el panel las escapa al mostrarlas.
function safeHttpUrl(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.length > 2000) return '';
    try {
        const url = new URL(text);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) {
        return '';
    }
}

function pickMessages(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.slice(-DOSSIER_MESSAGES_MAX).map((m) => ({
        id: m.id || null,
        sender_type: cleanLine(m.sender_type, 20),
        sender_id: m.sender_id || null,
        message: cleanMultiline(m.message, DOSSIER_MESSAGE_CHARS),
        kind: cleanLine(m.message_kind, 30),
        attachment_name: cleanLine(m.attachment_name, 160),
        attachment_path: typeof m.attachment_path === 'string' && STORAGE_PATH_RE.test(m.attachment_path) && !m.attachment_path.includes('..')
            ? m.attachment_path : '',
        attachment_mime: cleanLine(m.attachment_mime, 80),
        created_at: m.created_at || null
    }));
}

function pickQuotation(row, { messages = [], attachments = [], messagesTotal = null } = {}) {
    if (!row || typeof row !== 'object') return null;
    const references = (Array.isArray(row.reference_images) ? row.reference_images : [])
        .map((item) => safeHttpUrl(typeof item === 'string' ? item : item && item.url))
        .filter(Boolean)
        .slice(0, DOSSIER_REFERENCES_MAX);
    const files = (Array.isArray(attachments) ? attachments : []).slice(0, DOSSIER_ATTACHMENTS_MAX).map((a) => ({
        id: a.id || null,
        name: cleanLine(a.file_name, 160),
        mime: cleanLine(a.mime_type, 80),
        type: cleanLine(a.attachment_type, 40),
        url: safeHttpUrl(a.google_drive_url),
        created_at: a.created_at || null
    }));
    const picked = pickMessages(messages);
    return {
        id: row.id,
        quote_id: cleanLine(row.quote_id, 60),
        status: cleanLine(row.quote_status, 40),
        source: cleanLine(row.source, 40),
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        artist: {
            user_id: row.artist_id || null,
            name: cleanLine(row.artist_name, 160),
            username: cleanLine(row.artist_username, 80),
            email: cleanLine(row.artist_email, 200).toLowerCase()
        },
        client: {
            user_id: row.client_user_id || null,
            name: cleanLine(row.client_full_name, 160),
            email: cleanLine(row.client_email, 200).toLowerCase(),
            instagram: cleanLine(row.client_instagram, 120),
            whatsapp: cleanLine(row.client_whatsapp, 60),
            city: cleanLine(row.client_city_residence, 120)
        },
        tattoo: {
            idea: cleanMultiline(row.tattoo_idea_description, 4000),
            project: cleanMultiline(row.project_description, 4000),
            references_text: cleanMultiline(row.tattoo_references, 2000),
            body_part: cleanLine(row.tattoo_body_part, 120),
            size: cleanLine(row.tattoo_size, 120)
        },
        reference_images: references,
        drive_folder_url: safeHttpUrl(row.drive_folder_url),
        attachments: files,
        messages: picked,
        messages_total: Number.isFinite(Number(messagesTotal)) && messagesTotal !== null ? Number(messagesTotal) : picked.length
    };
}

// Expediente completo de la denuncia (jsonb de support_ticket_reports.dossier).
function buildDossier({ input, reporter, reported, quotation = null, now = new Date() }) {
    return {
        version: DOSSIER_VERSION,
        created_at: (now instanceof Date ? now : new Date(now)).toISOString(),
        kind: input.kind,
        reason: { code: input.reason, label: reasonLabel(input.kind, input.reason) },
        description: input.description,
        evidence: {
            links: input.links.slice(),
            attachments: input.attachments.map((a) => ({ ...a }))
        },
        page_context: input.pageContext || null,
        reporter,
        reported,
        quotation
    };
}

// ---- Panel de soporte -------------------------------------------------------

function parseListQuery(query) {
    const q = query && typeof query === 'object' ? query : {};
    const status = String(q.status || 'active').trim();
    const kind = String(q.kind || 'all').trim();
    if (status !== 'active' && status !== 'all' && !TICKET_STATUSES.includes(status)) {
        return { ok: false, status: 400, error: 'Estado inválido.' };
    }
    if (kind !== 'all' && !KINDS.includes(kind)) return { ok: false, status: 400, error: 'Tipo inválido.' };
    return { ok: true, value: { status, kind, statuses: status === 'active' ? ACTIVE_STATUSES.slice() : status === 'all' ? null : [status] } };
}

function parseStatusInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const status = String(b.status || '').trim();
    if (!TICKET_STATUSES.includes(status)) return { ok: false, status: 400, field: 'status', error: 'Elige un estado válido.' };
    const closing = status === 'resolved' || status === 'closed';
    const resolution = cleanMultiline(b.resolution, RESOLUTION_MAX + 1);
    if (resolution.length > RESOLUTION_MAX) {
        return { ok: false, status: 400, field: 'resolution', error: `La resolución puede tener hasta ${RESOLUTION_MAX} caracteres.` };
    }
    let outcome = String(b.outcome || '').trim() || null;
    if (outcome && !OUTCOMES.includes(outcome)) return { ok: false, status: 400, field: 'outcome', error: 'Resultado inválido.' };
    if (status === 'resolved' && !outcome) {
        return { ok: false, status: 400, field: 'outcome', error: 'Indica si se tomó acción o si la denuncia queda sin acción.' };
    }
    if (status === 'resolved' && resolution.length < 5) {
        return { ok: false, status: 400, field: 'resolution', error: 'Escribe qué se resolvió (mínimo 5 caracteres).' };
    }
    if (!closing) outcome = null;
    return { ok: true, value: { status, resolution: closing && resolution ? resolution : null, outcome } };
}

function parseNoteInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const note = cleanMultiline(b.note != null ? b.note : b.body, NOTE_MAX + 1);
    if (!note) return { ok: false, status: 400, field: 'note', error: 'Escribe la nota antes de guardarla.' };
    if (note.length > NOTE_MAX) return { ok: false, status: 400, field: 'note', error: `La nota puede tener hasta ${NOTE_MAX} caracteres.` };
    return { ok: true, value: { note } };
}

function personSummary(person, labels) {
    const p = person && typeof person === 'object' ? person : {};
    return {
        user_id: p.user_id || null,
        role: p.role || null,
        role_label: labels[p.role] || '',
        name: cleanLine(p.name, 160),
        email: cleanLine(p.email, 200),
        profile_path: typeof p.profile_path === 'string' && p.profile_path.startsWith('/') ? p.profile_path : ''
    };
}

// Fila de la cola (sin el expediente completo).
function summarizeReport(row) {
    const r = row && typeof row === 'object' ? row : {};
    const ticket = r.ticket || r.support_tickets || {};
    const dossier = r.dossier && typeof r.dossier === 'object' ? r.dossier : {};
    return {
        ticket_id: r.ticket_id || ticket.id || null,
        report_id: r.id || null,
        code: ticketCode(ticket.ticket_number),
        ticket_number: ticket.ticket_number || null,
        status: ticket.status || 'open',
        status_label: STATUS_LABELS[ticket.status] || '',
        priority: ticket.priority || 'high',
        subject: cleanLine(ticket.subject, 160),
        target_kind: r.target_kind || null,
        target_label: KIND_LABELS[r.target_kind] || '',
        reason: r.reason || null,
        reason_label: reasonLabel(r.target_kind, r.reason),
        quote_id: r.quote_id || null,
        reporter: personSummary({ ...(dossier.reporter || {}), user_id: r.reporter_user_id, role: r.reporter_role }, REPORTER_ROLE_LABELS),
        reported: personSummary({ ...(dossier.reported || {}), user_id: r.reported_user_id, role: r.reported_role }, REPORTED_ROLE_LABELS),
        assigned_support_user_id: ticket.assigned_support_user_id || null,
        created_at: r.created_at || ticket.created_at || null,
        last_activity_at: ticket.last_activity_at || null,
        resolved_at: ticket.resolved_at || null
    };
}

module.exports = {
    KINDS,
    REASONS,
    KIND_LABELS,
    REPORTER_ROLE_LABELS,
    REPORTED_ROLE_LABELS,
    TICKET_STATUSES,
    ACTIVE_STATUSES,
    STATUS_LABELS,
    OUTCOMES,
    OUTCOME_LABELS,
    DESCRIPTION_MIN,
    DESCRIPTION_MAX,
    MAX_LINKS,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    IMAGE_TYPES,
    ATTACHMENTS_BUCKET,
    ATTACHMENTS_FOLDER,
    NOTE_MAX,
    RESOLUTION_MAX,
    DOSSIER_MESSAGES_MAX,
    DOSSIER_VERSION,
    isUuid,
    cleanLine,
    cleanMultiline,
    reasonsFor,
    reasonLabel,
    isValidReason,
    ticketCode,
    priorityFor,
    targetKey,
    buildSubject,
    parseTargetRef,
    normalizeLink,
    parseLinks,
    parseAttachments,
    parseReportInput,
    artistProfilePath,
    studioProfilePath,
    pickArtist,
    pickClient,
    pickStudio,
    pickMessages,
    pickQuotation,
    buildDossier,
    parseListQuery,
    parseStatusInput,
    parseNoteInput,
    summarizeReport
};
