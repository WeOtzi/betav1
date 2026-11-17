'use strict';

// ===========================================================================
// Feedback de la beta cerrada · lógica pura (sin red ni base).
// ---------------------------------------------------------------------------
// Lo usan lib/routes/feedback.js (rutas) y tests/beta-feedback.test.js.
// Tabla: public.beta_feedback (migración 20261117120000). El front
// (public/shared/js/wo-feedback.js) repite los límites y el catálogo de
// encuestas; un test compara ambos.
// ===========================================================================

const ROLES = ['artist', 'client', 'studio'];
// Orden cuando la persona tiene varios tipos de cuenta y el front no manda un
// modo activo que sea suyo.
const ROLE_PRIORITY = ['artist', 'studio', 'client'];
const ROLE_LABELS = { artist: 'Tatuador', client: 'Cliente', studio: 'Estudio' };

// Botón "Comentarios". 'survey' solo llega con survey_key.
const KINDS = ['bug', 'idea', 'comment'];
const ALL_KINDS = ['bug', 'idea', 'comment', 'survey'];
const KIND_LABELS = { bug: 'Error', idea: 'Idea', comment: 'Comentario', survey: 'Encuesta' };

const STATUSES = ['new', 'seen', 'in_progress', 'done', 'wontfix'];
const STATUS_LABELS = { new: 'Nuevo', seen: 'Visto', in_progress: 'En curso', done: 'Resuelto', wontfix: 'No se hará' };

// Encuestas cortas: clave → pregunta por defecto. Clave nueva = una línea aquí
// y en wo-feedback.js (SURVEYS).
const SURVEYS = {
    registro_tatuador: '¿Cómo fue registrarte como tatuador?',
    registro_cliente: '¿Cómo fue crear tu cuenta?',
    registro_estudio: '¿Cómo fue registrar tu estudio?',
    cotizacion_enviada: '¿Cómo fue pedir tu cotización?',
    propuesta_enviada: '¿Cómo fue enviar tu propuesta?',
    primera_sesion_agendada: '¿Cómo fue agendar tu primera sesión?',
    primer_tatuador_equipo: '¿Cómo fue sumar a tu primer tatuador al equipo?'
};
// Tipo de cuenta al que corresponde cada encuesta. El servidor rechaza (400)
// una encuesta que no es del tipo de cuenta de la persona.
const SURVEY_ROLES = {
    registro_tatuador: 'artist',
    propuesta_enviada: 'artist',
    primera_sesion_agendada: 'artist',
    registro_cliente: 'client',
    cotizacion_enviada: 'client',
    registro_estudio: 'studio',
    primer_tatuador_equipo: 'studio'
};
const SURVEY_ROLE_ERROR = 'Esta encuesta no corresponde a tu tipo de cuenta.';
const SURVEY_KEY_RE = /^[a-z0-9_]{3,40}$/;

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const NOTE_MAX = 4000;
const TITLE_MAX = 200;
const PATH_MAX = 300;
const UA_MAX = 300;
const MAX_ATTACHMENTS = 2;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTACHMENTS_BUCKET = 'support-attachments';
const ATTACHMENTS_FOLDER = 'feedback';
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const EXPORT_MAX = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function fail(field, error, status) {
    return { ok: false, status: status || 400, field: field || null, error };
}

// Texto libre: sin caracteres de control (salvo salto de línea y tabulación),
// saltos normalizados y recortado.
function cleanText(value, max) {
    if (value == null) return '';
    // eslint-disable-next-line no-control-regex
    const text = String(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return max ? text.slice(0, max) : text;
}

// Una línea: sin saltos ni controles.
function cleanLine(value, max) {
    if (value == null) return '';
    // eslint-disable-next-line no-control-regex
    const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return max ? text.slice(0, max) : text;
}

// Solo la ruta: sin query ni hash (pueden traer tokens o datos de la persona).
function cleanPagePath(value) {
    const raw = cleanLine(value, 2000);
    if (!raw || raw[0] !== '/' || raw.startsWith('//')) return null;
    const path = raw.split(/[?#]/)[0];
    if (!/^\/[A-Za-z0-9/_.\-~%@]*$/.test(path)) return null;
    return path.slice(0, PATH_MAX);
}

function parseRating(value, { required } = {}) {
    if (value == null || value === '') {
        return required ? fail('rating', 'Elige una calificación del 1 al 5.') : { ok: true, value: null };
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5) return fail('rating', 'La calificación va del 1 al 5.');
    return { ok: true, value: n };
}

function isSurveyKey(key) {
    return typeof key === 'string' && SURVEY_KEY_RE.test(key) && Object.prototype.hasOwnProperty.call(SURVEYS, key);
}

// Contexto técnico: idioma, pantalla y navegador. Nada más.
function parseContext(raw, userAgent) {
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    const lang = cleanLine(c.lang, 35);
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(lang)) out.lang = lang;
    const w = Number(c.viewport && c.viewport.w);
    const h = Number(c.viewport && c.viewport.h);
    if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 20000 && h <= 20000) {
        out.viewport = { w, h };
    }
    const ua = cleanLine(userAgent || c.ua, UA_MAX);
    if (ua) out.ua = ua;
    return out;
}

// Capturas ya subidas por el navegador al bucket privado. Solo se aceptan
// rutas de la carpeta de la persona: `<uid>/feedback/<archivo>`.
function parseAttachments(list, userId) {
    if (list == null) return { ok: true, value: [] };
    if (!Array.isArray(list)) return fail('attachments', 'Las capturas no tienen el formato esperado.');
    if (list.length > MAX_ATTACHMENTS) return fail('attachments', 'Puedes adjuntar hasta ' + MAX_ATTACHMENTS + ' capturas.');
    if (!isUuid(userId)) return fail('attachments', 'No pudimos validar las capturas.');
    const prefix = `${userId}/${ATTACHMENTS_FOLDER}/`;
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const a = item && typeof item === 'object' ? item : {};
        const path = typeof a.path === 'string' ? a.path : '';
        const file = path.slice(prefix.length);
        if (!path.startsWith(prefix) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(file) || file.includes('..')) {
            return fail('attachments', 'Una de las capturas no es tuya o no tiene una ruta válida.', 403);
        }
        const type = cleanLine(a.type, 80).toLowerCase();
        if (!IMAGE_TYPES.includes(type)) return fail('attachments', 'Solo se admiten imágenes JPG, PNG, WEBP o HEIC.');
        const size = Number(a.size);
        if (!Number.isInteger(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
            return fail('attachments', 'Cada captura puede pesar hasta 10 MB.');
        }
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ path, name: cleanLine(a.name, 120) || 'captura', size, type });
    }
    return { ok: true, value: out };
}

// Cuerpo de POST /api/feedback → { ok, value } | { ok:false, status, field, error }
function parseFeedbackInput(body, { userId, userAgent } = {}) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const kind = String(b.kind || '').trim();
    if (!ALL_KINDS.includes(kind)) return fail('kind', 'Elige si es un error, una idea o un comentario.');
    const mode = ROLES.includes(b.mode) ? b.mode : null;
    const pagePath = cleanPagePath(b.page_path);
    const pageTitle = cleanLine(b.page_title, TITLE_MAX) || null;
    const context = parseContext(b.context, userAgent);

    if (kind === 'survey') {
        const key = String(b.survey_key || '').trim();
        if (!isSurveyKey(key)) return fail('survey_key', 'No reconocemos esa encuesta.');
        const rating = parseRating(b.rating, { required: true });
        if (!rating.ok) return rating;
        const message = cleanText(b.message);
        if (message.length > MESSAGE_MAX) return fail('message', 'El comentario puede tener hasta ' + MESSAGE_MAX + ' caracteres.');
        return {
            ok: true,
            value: {
                kind, survey_key: key, rating: rating.value, message: message || null, attachments: [],
                page_path: pagePath, page_title: pageTitle, context, mode
            }
        };
    }

    const message = cleanText(b.message);
    if (message.length < MESSAGE_MIN) return fail('message', 'Cuéntanos un poco más: al menos ' + MESSAGE_MIN + ' caracteres.');
    if (message.length > MESSAGE_MAX) return fail('message', 'El mensaje puede tener hasta ' + MESSAGE_MAX + ' caracteres.');
    const rating = parseRating(b.rating);
    if (!rating.ok) return rating;
    const attachments = parseAttachments(b.attachments, userId);
    if (!attachments.ok) return attachments;
    return {
        ok: true,
        value: {
            kind, survey_key: null, rating: rating.value, message, attachments: attachments.value,
            page_path: pagePath, page_title: pageTitle, context, mode
        }
    };
}

// Tipos de cuenta de la persona → rol del envío. `requested` es el modo activo
// que manda el front; solo cuenta si es uno de los suyos.
function pickRole(roles, requested) {
    const own = ROLE_PRIORITY.filter((r) => roles && roles[r]);
    if (!own.length) return null;
    if (requested && own.includes(requested)) return requested;
    return own[0];
}

function ownRoles(roles) {
    return ROLE_PRIORITY.filter((r) => roles && roles[r]);
}

// Rol de una encuesta: el de la encuesta, si la persona tiene ese tipo de
// cuenta (aunque el front mande otro modo activo). null si no lo tiene.
function surveyRole(roles, key) {
    const role = SURVEY_ROLES[key];
    return role && roles && roles[role] ? role : null;
}

function dailyWindowStart(now) {
    return new Date(Number(now) - DAY_MS).toISOString();
}

function overDailyLimit(count) {
    return Number(count) >= DAILY_LIMIT;
}

// Fila para insertar (sin status: nace en 'new').
function buildRow(input, { userId, role }) {
    return {
        user_id: userId,
        role,
        kind: input.kind,
        survey_key: input.kind === 'survey' ? input.survey_key : null,
        rating: input.rating == null ? null : input.rating,
        dismissed: false,
        message: input.message || null,
        page_path: input.page_path || null,
        page_title: input.page_title || null,
        context: input.context || {},
        attachments: input.attachments || []
    };
}

function buildDismissRow({ userId, role, key, pagePath }) {
    return {
        user_id: userId,
        role,
        kind: 'survey',
        survey_key: key,
        rating: null,
        dismissed: true,
        message: null,
        page_path: cleanPagePath(pagePath),
        page_title: null,
        context: {},
        attachments: []
    };
}

// ---------------------------------------------------------------------------
// Soporte
// ---------------------------------------------------------------------------

// Texto de búsqueda seguro para ilike (sin comodines ni separadores de PostgREST).
function cleanSearch(value) {
    return cleanLine(value, 80).replace(/[%*_,()\\"'.:]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parseDate(value, field) {
    if (value == null || value === '') return { ok: true, value: null };
    const v = String(value);
    if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) return fail(field, 'La fecha debe tener el formato AAAA-MM-DD.');
    return { ok: true, value: v };
}

function parseListQuery(query, { maxPageSize = PAGE_SIZE_MAX } = {}) {
    const q = query && typeof query === 'object' ? query : {};
    const pick = (value, allowed) => {
        const v = String(value == null ? '' : value).trim();
        if (!v || v === 'all') return { ok: true, value: null };
        return allowed.includes(v) ? { ok: true, value: v } : { ok: false };
    };
    const role = pick(q.role, ROLES);
    if (!role.ok) return fail('role', 'Tipo de cuenta no válido.');
    const kind = pick(q.kind, ALL_KINDS);
    if (!kind.ok) return fail('kind', 'Tipo de feedback no válido.');
    const status = pick(q.status, STATUSES);
    if (!status.ok) return fail('status', 'Estado no válido.');
    const surveyKey = pick(q.survey_key, Object.keys(SURVEYS));
    if (!surveyKey.ok) return fail('survey_key', 'Encuesta no válida.');
    const from = parseDate(q.from, 'from');
    if (!from.ok) return from;
    const to = parseDate(q.to, 'to');
    if (!to.ok) return to;
    if (from.value && to.value && from.value > to.value) return fail('from', 'La fecha inicial es posterior a la final.');
    const page = Math.max(1, Math.min(10000, Number.parseInt(q.page, 10) || 1));
    const size = Math.max(1, Math.min(maxPageSize, Number.parseInt(q.page_size, 10) || PAGE_SIZE_DEFAULT));
    return {
        ok: true,
        value: {
            role: role.value,
            kind: kind.value,
            status: status.value,
            survey_key: surveyKey.value,
            // Por defecto la lista no muestra las encuestas descartadas (no traen contenido).
            include_dismissed: q.include_dismissed === '1' || q.include_dismissed === 'true',
            q: cleanSearch(q.q),
            from: from.value,
            to: to.value,
            page,
            page_size: size,
            offset: (page - 1) * size
        }
    };
}

function parseStatusInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const patch = {};
    if (b.status != null && b.status !== '') {
        if (!STATUSES.includes(b.status)) return fail('status', 'Estado no válido.');
        patch.status = b.status;
    }
    if (b.support_note != null) {
        const note = cleanText(b.support_note);
        if (note.length > NOTE_MAX) return fail('support_note', 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.');
        patch.support_note = note || null;
    }
    if (!Object.keys(patch).length) return fail(null, 'No hay cambios para guardar.');
    return { ok: true, value: patch };
}

function round1(n) {
    return Math.round(n * 10) / 10;
}

// Conteos por rol/tipo/estado y, por encuesta, respuestas, descartes y promedio.
function buildSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const byRole = Object.fromEntries(ROLES.map((r) => [r, 0]));
    const byKind = Object.fromEntries(ALL_KINDS.map((k) => [k, 0]));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const surveys = {};
    for (const key of Object.keys(SURVEYS)) surveys[key] = { key, question: SURVEYS[key], answered: 0, dismissed: 0, average: null, distribution: [0, 0, 0, 0, 0], _sum: 0 };
    let total = 0;
    const ratings = { count: 0, sum: 0 };
    for (const row of list) {
        if (!row) continue;
        if (row.kind === 'survey') {
            const s = surveys[row.survey_key];
            if (s) {
                if (row.dismissed) s.dismissed += 1;
                else if (Number.isInteger(row.rating)) {
                    s.answered += 1;
                    s._sum += row.rating;
                    s.distribution[row.rating - 1] += 1;
                }
            }
            if (row.dismissed) continue;
        } else if (Number.isInteger(row.rating)) {
            ratings.count += 1;
            ratings.sum += row.rating;
        }
        total += 1;
        if (byRole[row.role] != null) byRole[row.role] += 1;
        if (byKind[row.kind] != null) byKind[row.kind] += 1;
        if (byStatus[row.status] != null) byStatus[row.status] += 1;
    }
    const surveyList = Object.values(surveys).map((s) => {
        const { _sum, ...rest } = s;
        return { ...rest, average: s.answered ? round1(_sum / s.answered) : null };
    });
    return {
        total,
        by_role: byRole,
        by_kind: byKind,
        by_status: byStatus,
        ease: { count: ratings.count, average: ratings.count ? round1(ratings.sum / ratings.count) : null },
        surveys: surveyList
    };
}

// Nombre visible por rol (nunca correo).
function displayName(row, names) {
    const n = (names && names.get && names.get(row.user_id)) || {};
    if (row.role === 'studio') return n.studio || n.artist || n.client || '';
    if (row.role === 'artist') return n.artist || n.studio || n.client || '';
    return n.client || n.artist || '';
}

function summarizeRow(row, names) {
    const r = row || {};
    const attachments = Array.isArray(r.attachments) ? r.attachments : [];
    return {
        id: r.id,
        created_at: r.created_at,
        updated_at: r.updated_at || null,
        role: r.role,
        role_label: ROLE_LABELS[r.role] || '',
        kind: r.kind,
        kind_label: KIND_LABELS[r.kind] || '',
        survey_key: r.survey_key || null,
        survey_question: r.survey_key ? (SURVEYS[r.survey_key] || '') : '',
        rating: r.rating == null ? null : r.rating,
        dismissed: r.dismissed === true,
        message: r.message || '',
        page_path: r.page_path || '',
        page_title: r.page_title || '',
        status: r.status,
        status_label: STATUS_LABELS[r.status] || '',
        support_note: r.support_note || '',
        attachments_count: attachments.length,
        user: { id: r.user_id, name: displayName(r, names) || 'Sin nombre' }
    };
}

// CSV para Excel/Sheets: BOM, separador coma, todas las celdas entre comillas
// dobles y guardia contra fórmulas (=, +, -, @, tab o CR al inicio). Sin correos.
const CSV_COLUMNS = [
    ['id', 'id'], ['fecha', 'created_at'], ['tipo_de_cuenta', 'role_label'], ['tipo', 'kind_label'], ['encuesta', 'survey_key'],
    ['calificacion', 'rating'], ['descartada', 'dismissed'], ['estado', 'status_label'], ['nombre', 'name'],
    ['pagina', 'page_path'], ['titulo_pagina', 'page_title'], ['mensaje', 'message'], ['idioma', 'lang'],
    ['pantalla', 'viewport'], ['capturas', 'attachments_count'], ['nota_soporte', 'support_note']
];

// Todas las celdas van entre comillas: Excel en español separa por ';', y una
// celda sin comillas como `ok;=1+1` se partiría en dos y la segunda sería una
// fórmula. Entre comillas el separador queda dentro del texto.
function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(rows, names) {
    const lines = [CSV_COLUMNS.map((c) => csvCell(c[0])).join(',')];
    for (const row of Array.isArray(rows) ? rows : []) {
        const s = summarizeRow(row, names);
        const ctx = row && row.context && typeof row.context === 'object' ? row.context : {};
        const flat = {
            ...s,
            name: s.user.name,
            dismissed: s.dismissed ? 'sí' : 'no',
            lang: ctx.lang || '',
            viewport: ctx.viewport ? `${ctx.viewport.w}x${ctx.viewport.h}` : ''
        };
        lines.push(CSV_COLUMNS.map((c) => csvCell(flat[c[1]])).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
    ROLES, ROLE_PRIORITY, ROLE_LABELS, KINDS, ALL_KINDS, KIND_LABELS, STATUSES, STATUS_LABELS, SURVEYS,
    SURVEY_ROLES, SURVEY_ROLE_ERROR, surveyRole,
    MESSAGE_MIN, MESSAGE_MAX, NOTE_MAX, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, IMAGE_TYPES, DAILY_LIMIT,
    ATTACHMENTS_BUCKET, ATTACHMENTS_FOLDER, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, EXPORT_MAX, CSV_COLUMNS,
    isUuid, cleanText, cleanLine, cleanPagePath, cleanSearch, parseRating, isSurveyKey, parseContext,
    parseAttachments, parseFeedbackInput, pickRole, ownRoles, dailyWindowStart, overDailyLimit, buildRow,
    buildDismissRow, parseListQuery, parseStatusInput, buildSummary, displayName, summarizeRow, csvCell, toCsv
};
