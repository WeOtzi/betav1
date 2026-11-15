/**
 * Ronda 2 · Inbox — lógica pura de mensajes de voz, mensajes rápidos,
 * respuestas automáticas y conversación cerrada. Sin DOM ni red: el navegador
 * la expone como window.WeotziInboxExtras y los tests la requieren con Node.
 *
 *  - Voz [P8]: formatos y topes (los mismos que valida la base en
 *    20261116160000), elección del formato de grabación, nombre de archivo,
 *    duración legible y mensajes de error del micrófono.
 *  - Mensajes rápidos [P9]: validación, orden y reordenamiento de plantillas
 *    (artist_message_templates kind = 'chat' / client_message_templates).
 *  - Automáticos [P9]: validación de la configuración del artista
 *    (artist_inbox_automations) y texto del estado actual
 *    (get_inbox_automation_status).
 *  - Mensajes automáticos en la lista: si lo último del hilo fue un automático,
 *    el artista todavía no respondió.
 *  - Conversación cerrada: motivo visible según el estado de la cotización.
 */
(function exposeInboxExtrasModel(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeotziInboxExtras = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInboxExtrasModel() {
    'use strict';

    /* ------------------------------------------------------------------ voz */

    const VOICE_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
    // Orden de preferencia al grabar: MP4/AAC se reproduce en todos los
    // navegadores (incluido Safari viejo); WebM/Opus es el respaldo de Chrome
    // y Firefox; OGG el de Firefox.
    const VOICE_RECORDER_TYPES = [
        'audio/mp4;codecs=mp4a.40.2', 'audio/mp4',
        'audio/webm;codecs=opus', 'audio/webm',
        'audio/ogg;codecs=opus', 'audio/ogg',
        'audio/mpeg',
    ];
    const VOICE_EXTENSIONS = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
    const VOICE_MAX_MS = 180000;          // 3 minutos (CHECK de la base)
    const VOICE_MIN_MS = 1000;            // menos de 1 s es un toque accidental
    const VOICE_MAX_BYTES = 6 * 1024 * 1024;
    const VOICE_LABEL = 'Mensaje de voz';
    const VOICE_UNSUPPORTED = 'Tu navegador no permite grabar audio aquí. Puedes escribir tu mensaje o adjuntar un archivo.';

    function baseMime(type) {
        return String(type || '').split(';')[0].trim().toLowerCase();
    }

    function isVoiceMime(type) {
        return VOICE_MIMES.includes(baseMime(type));
    }

    // Primer formato que el navegador puede grabar (y que el servidor acepta).
    function pickRecorderMime(isTypeSupported) {
        if (typeof isTypeSupported !== 'function') return '';
        for (const type of VOICE_RECORDER_TYPES) {
            let ok = false;
            try { ok = Boolean(isTypeSupported(type)); } catch (_) { ok = false; }
            if (ok) return type;
        }
        return '';
    }

    function voiceFileName(mime, now) {
        const ext = VOICE_EXTENSIONS[baseMime(mime)] || 'webm';
        const stamp = Number.isFinite(now) ? now : Date.now();
        return 'voz-' + stamp + '.' + ext;
    }

    function clampVoiceDuration(ms) {
        const value = Math.round(Number(ms));
        if (!Number.isFinite(value) || value <= 0) return 0;
        return Math.min(value, VOICE_MAX_MS);
    }

    function validateVoice(voice) {
        if (!voice) return { ok: false, error: 'No hay ninguna grabación para enviar.' };
        if (!isVoiceMime(voice.type)) {
            return { ok: false, error: 'Tu navegador grabó en un formato que no podemos enviar. Prueba con otro navegador.' };
        }
        const size = Number(voice.size);
        if (!(size > 0)) return { ok: false, error: 'La grabación quedó vacía. Revisa tu micrófono y vuelve a intentarlo.' };
        if (size > VOICE_MAX_BYTES) return { ok: false, error: 'El mensaje de voz supera el límite de 6 MB. Graba uno más corto.' };
        const duration = Number(voice.durationMs);
        if (!(duration >= VOICE_MIN_MS)) return { ok: false, error: 'La grabación es muy corta. Mantén pulsado o graba al menos un segundo.' };
        if (duration > VOICE_MAX_MS) return { ok: false, error: 'El mensaje de voz no puede durar más de 3 minutos.' };
        return { ok: true, error: null };
    }

    // 83000 → "1:23". Valores inválidos → "0:00".
    function formatDuration(ms) {
        const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return minutes + ':' + String(seconds).padStart(2, '0');
    }

    // Texto para lectores de pantalla: "1 minuto y 23 segundos".
    function spokenDuration(ms) {
        const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        const parts = [];
        if (minutes) parts.push(minutes === 1 ? '1 minuto' : minutes + ' minutos');
        if (seconds || !minutes) parts.push(seconds === 1 ? '1 segundo' : seconds + ' segundos');
        return parts.join(' y ');
    }

    // Error de getUserMedia / MediaRecorder → mensaje para la persona.
    function recorderErrorMessage(error) {
        const name = String((error && error.name) || '');
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
            return 'No tenemos permiso para usar tu micrófono. Actívalo en los permisos del navegador para este sitio y vuelve a intentarlo.';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
            return 'No encontramos un micrófono en este dispositivo.';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
            return 'Otra aplicación está usando tu micrófono. Ciérrala y vuelve a intentarlo.';
        }
        if (name === 'NotSupportedError') return VOICE_UNSUPPORTED;
        return 'No pudimos empezar a grabar. Vuelve a intentarlo.';
    }

    function isAudioAttachment(mime) {
        return baseMime(mime).startsWith('audio/');
    }

    /* ------------------------------------------------------ mensajes rápidos */

    const QUICK_LIMITS = { title: 60, body: 1000, max: 30 };
    const QUICK_ROLES = {
        artist: { table: 'artist_message_templates', kind: 'chat' },
        client: { table: 'client_message_templates', kind: null },
    };

    function quickSource(role) {
        return QUICK_ROLES[role === 'client' ? 'client' : 'artist'];
    }

    // El campo del chat es de una sola línea: los saltos se guardan como espacio.
    function singleLine(text) {
        return String(text == null ? '' : text).replace(/\s*[\r\n]+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
    }

    function normalizeQuickReply(input) {
        const src = input || {};
        const title = singleLine(src.title);
        const body = singleLine(src.body);
        const errors = {};
        if (!title) errors.title = 'Ponle un nombre corto para reconocerlo.';
        else if (title.length > QUICK_LIMITS.title) errors.title = 'El nombre admite hasta ' + QUICK_LIMITS.title + ' caracteres.';
        if (!body) errors.body = 'Escribe el mensaje que quieres guardar.';
        else if (body.length > QUICK_LIMITS.body) errors.body = 'El mensaje admite hasta ' + QUICK_LIMITS.body + ' caracteres.';
        return { ok: Object.keys(errors).length === 0, errors, value: { title, body } };
    }

    function sortQuickReplies(list) {
        return (list || []).filter(Boolean).slice().sort((a, b) => {
            const bySort = (Number(a.sort) || 0) - (Number(b.sort) || 0);
            if (bySort) return bySort;
            return String(a.created_at || '').localeCompare(String(b.created_at || ''));
        });
    }

    function nextQuickSort(list) {
        return (list || []).reduce((max, item) => Math.max(max, (Number(item && item.sort) || 0) + 1), 0);
    }

    /**
     * Mueve una plantilla un lugar ('up' | 'down'). Devuelve la lista en su
     * orden nuevo (con sort 0..n-1) y solo las filas cuyo sort cambió, para
     * guardar lo mínimo.
     */
    function moveQuickReply(list, id, direction) {
        const ordered = sortQuickReplies(list);
        const index = ordered.findIndex((item) => item.id === id);
        const target = direction === 'up' ? index - 1 : index + 1;
        if (index === -1 || target < 0 || target >= ordered.length) return { list: ordered, changes: [], moved: false };
        const next = ordered.slice();
        const moving = next[index];
        next[index] = next[target];
        next[target] = moving;
        const changes = [];
        const renumbered = next.map((item, position) => {
            if ((Number(item.sort) || 0) !== position || item.sort == null) changes.push({ id: item.id, sort: position });
            return Object.assign({}, item, { sort: position });
        });
        return { list: renumbered, changes, moved: true };
    }

    // Texto del campo después de insertar una plantilla: se agrega al final
    // de lo ya escrito y nunca supera el máximo del campo.
    function insertQuickReply(current, body, maxLength) {
        const existing = String(current || '');
        const addition = singleLine(body);
        const max = Number(maxLength) > 0 ? Number(maxLength) : 2000;
        if (!addition) return existing;
        const joined = existing.trim() ? existing.replace(/\s+$/, '') + ' ' + addition : addition;
        return joined.slice(0, max);
    }

    function quickRepliesError(error) {
        const text = String((error && (error.message || error)) || '');
        if (text.indexOf('quick_replies_limit') !== -1) return 'Llegaste al máximo de ' + QUICK_LIMITS.max + ' mensajes rápidos. Borra alguno para crear otro.';
        return 'No pudimos guardar el mensaje rápido. Vuelve a intentarlo.';
    }

    /* ------------------------------------------------------------ automáticos */

    const AUTO_LIMITS = { body: 600 };
    const AUTO_LABEL = 'Mensaje automático';
    const AUTO_DEFAULTS = Object.freeze({
        greeting_enabled: false,
        greeting_body: '¡Hola! Gracias por escribirme. Recibí tu mensaje y te respondo lo antes posible.',
        away_enabled: false,
        away_off_hours: true,
        away_vacation: true,
        away_body: 'Gracias por tu mensaje. En este momento estoy fuera de mi horario de atención; te respondo en cuanto vuelva.',
        away_vacation_body: '',
    });

    function autoText(value) {
        return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // Fila guardada (o null) → valores del formulario, con los textos sugeridos.
    function automationsFromRow(row) {
        const src = row || {};
        const out = Object.assign({}, AUTO_DEFAULTS);
        ['greeting_enabled', 'away_enabled'].forEach((key) => { out[key] = src[key] === true; });
        ['away_off_hours', 'away_vacation'].forEach((key) => { out[key] = src[key] !== false; });
        if (autoText(src.greeting_body)) out.greeting_body = autoText(src.greeting_body);
        if (autoText(src.away_body)) out.away_body = autoText(src.away_body);
        out.away_vacation_body = autoText(src.away_vacation_body);
        return out;
    }

    function normalizeAutomations(input) {
        const src = input || {};
        const value = {
            greeting_enabled: src.greeting_enabled === true,
            greeting_body: autoText(src.greeting_body),
            away_enabled: src.away_enabled === true,
            away_off_hours: src.away_off_hours !== false,
            away_vacation: src.away_vacation !== false,
            away_body: autoText(src.away_body),
            away_vacation_body: autoText(src.away_vacation_body),
        };
        const errors = {};
        const tooLong = 'El mensaje admite hasta ' + AUTO_LIMITS.body + ' caracteres.';
        if (value.greeting_body.length > AUTO_LIMITS.body) errors.greeting_body = tooLong;
        else if (value.greeting_enabled && !value.greeting_body) errors.greeting_body = 'Escribe el saludo o desactívalo.';
        if (value.away_body.length > AUTO_LIMITS.body) errors.away_body = tooLong;
        else if (value.away_enabled && !value.away_body) errors.away_body = 'Escribe la respuesta de ausencia o desactívala.';
        if (value.away_vacation_body.length > AUTO_LIMITS.body) errors.away_vacation_body = tooLong;
        if (value.away_enabled && !value.away_off_hours && !value.away_vacation) {
            errors.away_scope = 'Elige al menos un momento: fuera de tu horario o durante tus vacaciones.';
        }
        return { ok: Object.keys(errors).length === 0, errors, value };
    }

    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];

    function longDay(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return '';
        return Number(match[3]) + ' de ' + MONTHS[Number(match[2]) - 1];
    }

    function zonedWhen(iso, timeZone) {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('es', {
                weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || undefined,
            }).format(date);
        } catch (_) {
            return '';
        }
    }

    /**
     * Estado actual según get_inbox_automation_status():
     * { tone: 'open' | 'away' | 'info', text }. Lo ve el artista en la
     * configuración para entender cuándo sale la respuesta de ausencia.
     */
    function awayStatus(status) {
        const src = status && typeof status === 'object' ? status : null;
        if (!src) return { tone: 'info', text: '' };
        if (src.reason === 'vacation') {
            const until = longDay(src.vacation_end);
            return { tone: 'away', text: 'Ahora: de vacaciones' + (until ? ' hasta el ' + until : '') + '.' };
        }
        if (src.reason === 'off_hours') {
            const when = src.next_open ? zonedWhen(src.next_open, src.timezone) : '';
            return { tone: 'away', text: 'Ahora: fuera de tu horario' + (when ? ' (vuelves el ' + when + ')' : '') + '.' };
        }
        if (src.reason === 'open') {
            return { tone: 'open', text: 'Ahora: dentro de tu horario' + (src.open_until ? ' (hasta las ' + src.open_until + ')' : '') + '.' };
        }
        if (src.reason === 'no_schedule') {
            return { tone: 'info', text: 'Todavía no guardaste tu horario: la respuesta de ausencia solo se enviará durante tus vacaciones.' };
        }
        return { tone: 'info', text: '' };
    }

    /* ------------------------------------- último mensaje automático del hilo */

    // rows: [{ <keyField>, created_at }] de los mensajes automáticos recientes.
    // Devuelve Map(clave del hilo → ms del automático más nuevo).
    function autoTailIndex(rows, keyField) {
        const index = new Map();
        (rows || []).forEach((row) => {
            if (!row) return;
            const key = row[keyField];
            const at = Date.parse(row.created_at);
            if (key == null || !Number.isFinite(at)) return;
            const id = String(key);
            if (!index.has(id) || index.get(id) < at) index.set(id, at);
        });
        return index;
    }

    // ¿Lo último del hilo (lastAt) es un mensaje automático?
    function isAutoTail(index, key, lastAt) {
        if (!index || key == null || !lastAt) return false;
        const at = Date.parse(lastAt);
        return Number.isFinite(at) && index.get(String(key)) === at;
    }

    /* ---------------------------------------------------- conversación cerrada */

    const CLIENT_REJECTED_REASON = 'El cliente rechazó la cotización: la conversación está cerrada.';

    // Motivo visible de un hilo en solo lectura (el artista no puede escribir).
    function closedReason(status) {
        const value = String(status || '').trim().toLowerCase();
        if (value === 'client_rejected') return CLIENT_REJECTED_REASON;
        if (value === 'expired') return 'La cotización venció: la conversación está cerrada.';
        if (value === 'completed') return 'El trabajo se completó: la conversación está cerrada.';
        if (value === 'cancelled' || value === 'canceled') return 'La cotización se canceló: la conversación está cerrada.';
        return 'Esta conversación está cerrada.';
    }

    return {
        VOICE_MIMES,
        VOICE_RECORDER_TYPES,
        VOICE_MAX_MS,
        VOICE_MIN_MS,
        VOICE_MAX_BYTES,
        VOICE_LABEL,
        VOICE_UNSUPPORTED,
        baseMime,
        isVoiceMime,
        isAudioAttachment,
        pickRecorderMime,
        voiceFileName,
        clampVoiceDuration,
        validateVoice,
        formatDuration,
        spokenDuration,
        recorderErrorMessage,
        QUICK_LIMITS,
        quickSource,
        singleLine,
        normalizeQuickReply,
        sortQuickReplies,
        nextQuickSort,
        moveQuickReply,
        insertQuickReply,
        quickRepliesError,
        AUTO_LIMITS,
        AUTO_LABEL,
        AUTO_DEFAULTS,
        automationsFromRow,
        normalizeAutomations,
        awayStatus,
        autoTailIndex,
        isAutoTail,
        CLIENT_REJECTED_REASON,
        closedReason,
    };
}));
