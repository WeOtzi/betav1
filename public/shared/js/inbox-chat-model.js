/**
 * Lógica pura compartida por los chats de cotización y el inbox
 * (/artist/inbox y /client/chats). Sin DOM ni red: el navegador la expone
 * como window.WeotziInboxChat y los tests la requieren con Node.
 *
 *  - Adjuntos de chat (bucket chat-attachments): validación y ruta
 *    <quote_id>/<user_id>/<timestamp>-<nombre> (la RLS y el trigger exigen ese
 *    prefijo; ver migración 20261115170000).
 *  - Deduplicación de mensajes (eco realtime vs. respuesta del POST).
 *  - Tarjeta de cotización del timeline (Figma 801:1149).
 *  - Hilos sintéticos para cotizaciones sin mensajes (deep link ?quote=).
 *  - Categoría del inbox del artista según el estado de la cotización.
 */
(function exposeInboxChatModel(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeotziInboxChat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInboxChatModel() {
    'use strict';

    const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
    const ATTACHMENT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];
    const IMAGE_MIMES = ATTACHMENT_MIMES.filter((mime) => mime.startsWith('image/'));
    const MAX_MESSAGE_LENGTH = 2000;

    // Estados con precio enviado por el artista: la tarjeta de cotización
    // aparece en el chat (Figma 801:1149, "Cotización recibida").
    const QUOTE_CARD_STATUSES = ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed'];
    // Cliente que ya aceptó: la conversación pasa a "Clientes" en el inbox.
    const CLIENT_STAGE_STATUSES = ['client_approved', 'in_progress', 'artist_completed', 'completed'];
    // Cotizaciones donde ya no tiene sentido abrir una conversación nueva.
    const CLOSED_STATUSES = ['completed', 'client_rejected', 'expired', 'cancelled', 'canceled', 'rejected'];

    function safeFileName(name) {
        const clean = String(name || 'archivo')
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/\.{2,}/g, '.')
            .replace(/^[_.]+|[_.]+$/g, '');
        return (clean || 'archivo').slice(0, 120);
    }

    function chatAttachmentPath(quoteId, userId, fileName, now) {
        const stamp = Number.isFinite(now) ? now : Date.now();
        return String(quoteId) + '/' + String(userId) + '/' + stamp + '-' + safeFileName(fileName);
    }

    function validateAttachment(file) {
        if (!file) return { ok: false, error: 'Elegí un archivo.' };
        const type = String(file.type || '').toLowerCase();
        if (!ATTACHMENT_MIMES.includes(type)) {
            return { ok: false, error: 'Formato no admitido. Usá JPG, PNG, WEBP, GIF, PDF o TXT.' };
        }
        if (!(Number(file.size) >= 0) || Number(file.size) > MAX_ATTACHMENT_BYTES) {
            return { ok: false, error: 'El archivo supera el límite de 15 MB.' };
        }
        return { ok: true, error: null };
    }

    function messageKind(mime) {
        if (!mime) return 'text';
        return String(mime).toLowerCase().startsWith('image/') ? 'image' : 'file';
    }

    // Agrega `message` a `list` solo si su id no está. Devuelve true si lo agregó.
    function addUnique(list, message) {
        if (!message) return false;
        const id = message.id;
        if (id != null && list.some((item) => item && item.id === id)) return false;
        list.push(message);
        return true;
    }

    function firstRow(saved) {
        return Array.isArray(saved) ? (saved[0] || null) : (saved || null);
    }

    function hasAmount(value) {
        if (value === null || value === undefined || value === '') return false;
        const number = Number(String(value).replace(',', '.'));
        return Number.isFinite(number) && number > 0;
    }

    function formatMoney(amount, currency) {
        if (!hasAmount(amount)) return '';
        const number = Number(String(amount).replace(',', '.'));
        return '$' + Math.round(number).toLocaleString('es-AR') + (currency ? ' ' + String(currency).toUpperCase() : '');
    }

    function styleName(value) {
        if (value && typeof value === 'object') return value.style_name || value.name || '';
        return value ? String(value) : '';
    }

    function quoteTitle(quote) {
        const style = styleName(quote.tattoo_style).trim();
        const part = String(quote.tattoo_body_part || '').trim();
        if (style && part) return 'Tatuaje ' + style.toLowerCase() + ' en ' + part.toLowerCase();
        if (part) return 'Tatuaje en ' + part.toLowerCase();
        if (style) return 'Tatuaje ' + style.toLowerCase();
        return 'Proyecto de tatuaje';
    }

    function durationLabel(quote) {
        const sessions = Number(String(quote.final_sessions || quote.tattoo_estimated_sessions || '').replace(/[^\d.]/g, ''));
        const minutes = Number(quote.artist_session_minutes);
        const parts = [];
        if (Number.isFinite(sessions) && sessions > 0) parts.push(sessions === 1 ? '1 sesión' : sessions + ' sesiones');
        if (Number.isFinite(minutes) && minutes > 0) {
            const hours = Math.round((minutes / 60) * 10) / 10;
            parts.push(String(hours).replace('.', ',') + (hours === 1 ? ' hora' : ' horas') + ' por sesión');
        }
        return parts.join(' · ');
    }

    /**
     * Datos de la tarjeta "Cotización" del timeline, o null si todavía no hay
     * precio enviado. `quote` puede ser una fila de chat_threads o de
     * quotations_db (se combinan las dos si están).
     */
    function quoteCard(quote) {
        if (!quote) return null;
        const status = String(quote.quote_status || '').toLowerCase();
        if (!QUOTE_CARD_STATUSES.includes(status)) return null;
        const amount = hasAmount(quote.final_budget_amount) ? quote.final_budget_amount : quote.artist_budget_amount;
        const currency = hasAmount(quote.final_budget_amount) ? quote.final_budget_currency : quote.artist_budget_currency;
        const price = formatMoney(amount, currency || quote.final_budget_currency);
        if (!price) return null;
        return {
            quoteId: quote.quote_id || null,
            title: quoteTitle(quote),
            price: price,
            duration: durationLabel(quote),
            status: status,
            at: quote.artist_responded_at || quote.updated_at || quote.created_at || null,
        };
    }

    function artistCategoryForQuote(status) {
        return CLIENT_STAGE_STATUSES.includes(String(status || '').toLowerCase()) ? 'clients' : 'quotations';
    }

    // Fila con la forma de chat_threads para una cotización que todavía no
    // tiene mensajes (la vista solo devuelve hilos con al menos uno).
    function syntheticQuoteThread(quote) {
        if (!quote || !quote.quote_id) return null;
        return {
            quote_id: quote.quote_id,
            quotation_id_int: quote.id != null ? quote.id : (quote.quotation_id_int != null ? quote.quotation_id_int : null),
            artist_id: quote.artist_id || null,
            artist_name: quote.artist_name || null,
            artist_username: quote.artist_username || null,
            client_user_id: quote.client_user_id || null,
            client_full_name: quote.client_full_name || null,
            quote_status: quote.quote_status || null,
            tattoo_body_part: quote.tattoo_body_part || null,
            tattoo_style: quote.tattoo_style || null,
            tattoo_size: quote.tattoo_size || null,
            final_budget_amount: quote.final_budget_amount != null ? quote.final_budget_amount : null,
            final_budget_currency: quote.final_budget_currency || null,
            last_message: null,
            last_message_sender: null,
            last_message_at: quote.updated_at || quote.created_at || null,
            unread_for_artist: 0,
            unread_for_client: 0,
            synthetic: true,
        };
    }

    // Cotizaciones activas del cliente que todavía no tienen conversación:
    // se ofrecen como "Iniciar conversación".
    function startableQuotes(quotes, threads) {
        const withThread = new Set((threads || []).map((thread) => thread && thread.quote_id).filter(Boolean));
        return (quotes || []).filter((quote) => {
            if (!quote || !quote.quote_id || withThread.has(quote.quote_id)) return false;
            if (!quote.artist_id || !quote.client_user_id) return false;
            const status = String(quote.quote_status || '').toLowerCase();
            if (status === 'in_progress' || CLOSED_STATUSES.includes(status)) return false;
            if (quote.client_deleted_at) return false;
            return true;
        });
    }

    // El artista ve una fila "Soporte" aunque nunca haya escrito: sin hilo
    // unificado de soporte y sin conversación legacy abierta.
    function needsSupportStarter(unifiedRows, legacySupport) {
        const hasUnified = (unifiedRows || []).some((row) => row && row.category === 'support');
        if (hasUnified) return false;
        return !legacySupport || legacySupport.status === 'closed';
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/)
            .map((part) => part.replace(/[^\p{L}]/gu, ''))
            .filter(Boolean);
        if (!parts.length) return '·';
        if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('es');
        return (parts[0][0] + parts[1][0]).toLocaleUpperCase('es');
    }

    // URL de miniatura para una referencia de Drive (o la URL tal cual si ya
    // es una imagen). Solo http(s): nada de javascript:/data:.
    function referenceThumb(url) {
        const value = String(url || '').trim();
        if (!/^https?:\/\//i.test(value)) return '';
        if (value.indexOf('drive.google.com') === -1) return value;
        let fileId = '';
        if (value.indexOf('/d/') !== -1) fileId = value.split('/d/')[1].split(/[/?#]/)[0];
        else if (value.indexOf('id=') !== -1) fileId = value.split('id=')[1].split('&')[0];
        return /^[A-Za-z0-9_-]+$/.test(fileId) ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400' : '';
    }

    return {
        MAX_ATTACHMENT_BYTES,
        ATTACHMENT_MIMES,
        IMAGE_MIMES,
        MAX_MESSAGE_LENGTH,
        QUOTE_CARD_STATUSES,
        CLIENT_STAGE_STATUSES,
        CLOSED_STATUSES,
        safeFileName,
        chatAttachmentPath,
        validateAttachment,
        messageKind,
        addUnique,
        firstRow,
        formatMoney,
        quoteTitle,
        quoteCard,
        artistCategoryForQuote,
        syntheticQuoteThread,
        startableQuotes,
        needsSupportStarter,
        initials,
        referenceThumb,
    };
}));
