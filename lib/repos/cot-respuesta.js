'use strict';

// ===========================================================================
// Repositorio de la propuesta del artista (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Ronda 2 · frente cot-respuesta. Corre con service-role: la autorización
// (artista dueño de la cotización, estado que admite propuesta) la hace
// lib/cot-respuesta.js ANTES de escribir. Es el `repo` de ese módulo.
//
//   quotations_db            la propuesta (presupuesto, sesiones, anticipo,
//                            vencimiento, offered_slots, proposal_message)
//   artist_manual_quotes     campos de la cotización manual que acompañan la
//                            respuesta (la RLS no deja al artista tocar una
//                            fila 'sent': por eso se escribe desde aquí)
//   quotation_status_history rastro de la propuesta reenviada
//   quotation_sessions / artist_calendar_events   lo que ya ocupa ESTA
//                            cotización en la agenda (no choca consigo misma)
// ===========================================================================

const { pgrest } = require('../postgrest');
const { readShortCode } = require('./quote-code');

const QUOTE_SELECT = [
    'id', 'quote_id', 'quote_status', 'is_archived', 'dispute_status', 'source',
    'artist_id', 'artist_name', 'artist_email', 'artist_username', 'artist_studio_name', 'artist_current_city',
    'client_user_id', 'client_email', 'client_full_name',
    'project_description', 'tattoo_idea_description', 'tattoo_style', 'tattoo_body_part', 'tattoo_size',
    'tattoo_estimated_sessions', 'artist_budget_amount', 'artist_budget_currency', 'client_budget_currency',
    'final_budget_amount', 'final_budget_currency', 'final_sessions',
    'artist_session_minutes', 'artist_availability', 'artist_responded_at',
    'artist_deposit_pct', 'artist_deposit_amount', 'quote_expiry_enabled', 'quote_expiry_days', 'quote_expires_at',
].join(',');

// Columnas de 20261116120000 (se piden aparte: si la migración todavía no
// corrió, la lectura principal no falla).
const PROPOSAL_SELECT = 'id,offered_slots,proposal_message';

const MANUAL_SELECT = 'id,artist_id,quote_ref,status,origin,quote_id,project,line_items,currency,discount_pct,tax_pct,deposit_pct,subtotal,total,deposit_amount,validity_days,cancellation_policy,client_notes,extra_terms';

function isMissingColumn(error) {
    const text = String((error && error.message) || '');
    return /PGRST204|42703|Could not find the '[^']+' column|column [^ ]+ does not exist/i.test(text);
}

function byIdentifier(query, identifier) {
    const value = String(identifier || '').trim();
    return /^\d{1,12}$/.test(value) ? query.eq('id', Number(value)) : query.eq('quote_id', value);
}

const CotRespuestaRepo = {
    isMissingColumn,

    // Cotización por id numérico o quote_id (texto), con las columnas de la
    // propuesta si existen.
    async getQuote(identifier) {
        const quote = await byIdentifier(pgrest('quotations_db').select(QUOTE_SELECT), identifier).limit(1).single().execute();
        if (!quote) return null;
        try {
            const extra = await pgrest('quotations_db').select(PROPOSAL_SELECT).eq('id', quote.id).limit(1).single().execute();
            if (extra) Object.assign(quote, { offered_slots: extra.offered_slots, proposal_message: extra.proposal_message });
        } catch (error) {
            if (!isMissingColumn(error)) throw error;
        }
        return quote;
    },

    // Código corto visible (short_code, 20261116110000) para el correo de la
    // propuesta reenviada. Nunca lanza: sin la columna devuelve null.
    getShortCode(id) {
        return readShortCode({ id });
    },

    // Guarda la propuesta solo si la fila sigue siendo del artista y en el
    // estado que vio el servidor (guardia de carrera). Devuelve la fila o null.
    async saveProposal(id, artistId, expectedStatus, patch) {
        const rows = await pgrest('quotations_db').select(QUOTE_SELECT)
            .eq('id', id).eq('artist_id', artistId).eq('quote_status', expectedStatus)
            .patch(patch);
        return rows && rows.length ? rows[0] : null;
    },

    getManualByQuoteId(quoteId) {
        return pgrest('artist_manual_quotes').select(MANUAL_SELECT).eq('quote_id', quoteId).limit(1).single().execute();
    },

    async insertManual(row) {
        const rows = await pgrest('artist_manual_quotes').select(MANUAL_SELECT).insert([row]);
        return (rows && rows[0]) || null;
    },

    async patchManual(id, artistId, patch) {
        const rows = await pgrest('artist_manual_quotes').select(MANUAL_SELECT)
            .eq('id', id).eq('artist_id', artistId).patch(patch);
        return (rows && rows[0]) || null;
    },

    // El trigger fn_quotation_status_change inserta el historial con
    // changed_by null (con service-role no hay JWT): se completa el actor.
    annotateHistory(quotationId, status, sinceIso, { changedBy, notes }) {
        return pgrest('quotation_status_history')
            .eq('quotation_id', quotationId).eq('new_status', status)
            .is('changed_by', null).gte('changed_at', sinceIso)
            .patch({ changed_by: changedBy, notes: notes || null }, { returning: false });
    },

    // Propuesta reenviada (el estado no cambia, así que el trigger no deja rastro).
    insertHistory(row) {
        return pgrest('quotation_status_history').insert([row], { returning: false });
    },

    // Sesiones y eventos del calendario de ESTA cotización: { start, end }.
    async listOwnIntervals(quotationId) {
        const [sessions, events] = await Promise.all([
            pgrest('quotation_sessions').select('id,session_date,duration_hours,status')
                .eq('quotation_id', quotationId).neq('status', 'cancelled').limit(60).execute().catch(() => []),
            pgrest('artist_calendar_events').select('id,starts_at,ends_at,status')
                .eq('quotation_id', quotationId).neq('status', 'cancelled').limit(60).execute().catch(() => []),
        ]);
        const out = [];
        (sessions || []).forEach((s) => {
            const start = Date.parse(s.session_date);
            if (!Number.isFinite(start)) return;
            const hours = Number(s.duration_hours) > 0 ? Number(s.duration_hours) : 1;
            out.push({ start: new Date(start).toISOString(), end: new Date(start + hours * 3600000).toISOString() });
        });
        (events || []).forEach((e) => {
            if (Number.isFinite(Date.parse(e.starts_at))) out.push({ start: e.starts_at, end: e.ends_at });
        });
        return out;
    },

    async listBlocking(artistId, fromIso, toIso) {
        const rows = await pgrest.raw('rpc/list_artist_blocking_intervals', {
            method: 'POST', body: { p_artist: artistId, p_from: fromIso, p_to: toIso },
        });
        return Array.isArray(rows) ? rows : [];
    },

    getArtist(userId) {
        if (!userId) return Promise.resolve(null);
        return pgrest('artists_db').select('user_id,name,email,username').eq('user_id', userId).limit(1).single().execute();
    },
};

module.exports = { CotRespuestaRepo, QUOTE_SELECT, MANUAL_SELECT };
