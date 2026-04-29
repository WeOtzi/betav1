// ============================================
// WE ÖTZI - EMAIL EVENT MAPPING
// Maps eventId -> {recipient resolver, attribs builder, template ref, channel default}
// Used by services/email-service.js to translate any payload coming from the
// frontend or backend into the format BillionMail and n8n expect.
// ============================================

/**
 * Each event entry has:
 *   - name:         Human-readable event label.
 *   - recipient:    function(payload) -> email address (string) | null
 *                   When null, the dispatcher logs and skips. Some events fan out to
 *                   multiple recipients (cc/bcc); use `recipients` instead in that case.
 *   - recipients:   function(payload) -> string[]      (optional; takes priority over recipient)
 *   - attribs:      function(payload) -> Object        (template variables for BillionMail)
 *                   Defaults to a flattened pass-through if omitted.
 *   - templateHint: BillionMail template tag (e.g. "artist-welcome"). Pure metadata for now;
 *                   the dispatcher uses event-specific BillionMail API keys instead, but the
 *                   hint helps map this codebase entry to the BillionMail panel template.
 *   - description:  Short explanation, surfaced in the backoffice UI.
 *
 * Add new events here as the codebase grows. A unit test in tests/email-events.test.js
 * verifies that every eventId used via emailService.sendEmail exists in this map.
 */

const EVENTS = {
    // ===== Registration =====
    artist_registration_completed: {
        name: 'Artista: registro completado',
        templateHint: 'artist-welcome',
        description: 'Bienvenida + credenciales al artista cuando completa su perfil.',
        recipient: p => p.email,
        attribs: p => ({
            email: p.email,
            username: p.username,
            password: p.password,
            name: p.name,
            artistic_name: p.artistic_name,
            city: p.city,
            country: p.country,
            studio: p.studio,
            session_price: p.session_price,
            years_experience: p.years_experience,
            bio: p.bio,
            portfolio_url: p.portfolio_url,
            dashboard_url: p.dashboard_url,
            profile_url: p.profile_url
        })
    },
    client_registration_completed: {
        name: 'Cliente: registro completado',
        templateHint: 'client-welcome',
        description: 'Bienvenida + credenciales al cliente.',
        recipient: p => p.email,
        attribs: p => ({
            email: p.email,
            password: p.password,
            full_name: p.full_name,
            whatsapp: p.whatsapp || 'No proporcionado',
            birth_date: p.birth_date || 'No proporcionado',
            age: p.age != null ? p.age : 'No proporcionado',
            instagram: p.instagram || 'No proporcionado',
            city: p.city || 'No proporcionado',
            quote_id: p.quote_id || '-',
            artist_name: p.artist_name || '-',
            dashboard_url: p.dashboard_url || 'https://weotzi.chat/client/dashboard',
            login_url: p.login_url || 'https://weotzi.chat/client/login'
        })
    },

    // ===== Auth =====
    password_reset_temp: {
        name: 'Reset de contraseña temporal',
        templateHint: 'password-reset',
        description: 'Envía contraseña temporal al usuario que solicitó reset.',
        recipient: p => p.email,
        attribs: p => ({
            email: p.email,
            temp_password: p.temp_password,
            user_type: p.user_type,
            login_url: p.login_url
        })
    },

    // ===== Quotations (cliente -> artista, ida y vuelta) =====
    client_quotation_submitted: {
        name: 'Cliente: cotización enviada',
        templateHint: 'quotation-confirmation-client',
        description: 'Confirmación al cliente de que su cotización fue enviada al artista.',
        recipient: p => p.client_email,
        attribs: p => ({
            client_name: p.client_name,
            client_email: p.client_email,
            client_whatsapp: p.client_whatsapp,
            client_age: p.client_age,
            quote_id: p.quote_id,
            artist_name: p.artist_name,
            artist_email: p.artist_email,
            tattoo_description: p.tattoo_description,
            tattoo_location: p.tattoo_location,
            tattoo_size: p.tattoo_size,
            tattoo_style: p.tattoo_style,
            tattoo_references: p.tattoo_references,
            client_budget: p.client_budget,
            client_preferred_date: p.client_preferred_date,
            has_medical_conditions: p.has_medical_conditions,
            medical_details: p.medical_details,
            register_url: p.register_url,
            login_url: p.login_url
        })
    },
    artist_responded_quotation: {
        name: 'Artista respondió cotización',
        templateHint: 'artist-responded',
        recipient: p => p.client_email,
        attribs: p => ({ ...p })
    },
    client_approved_quotation: {
        name: 'Cliente aprobó cotización',
        templateHint: 'quotation-approved',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },
    client_rejected_quotation: {
        name: 'Cliente rechazó cotización',
        templateHint: 'quotation-rejected',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },
    quotation_completed_summary: {
        name: 'Cotización completada (resumen)',
        templateHint: 'quotation-completed',
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        attribs: p => ({ ...p })
    },
    client_left_rating: {
        name: 'Cliente dejó valoración',
        templateHint: 'client-rating',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },

    // ===== Job board =====
    job_board_request_created: {
        name: 'Job Board: solicitud creada',
        templateHint: 'job-board-application',
        description: 'Confirmación al cliente y notificación a artistas relevantes.',
        recipient: p => p.client_email,
        attribs: p => ({ ...p })
    },
    job_board_application_received: {
        name: 'Job Board: postulación recibida',
        templateHint: 'application-accepted',
        recipient: p => p.client_email,
        attribs: p => ({ ...p })
    },
    job_board_application_accepted: {
        name: 'Job Board: postulación aceptada',
        templateHint: 'application-accepted',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },
    job_board_application_rejected: {
        name: 'Job Board: postulación rechazada',
        templateHint: 'application-rejected',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },

    // ===== Chat =====
    chat_message_to_artist: {
        name: 'Chat: mensaje al artista',
        templateHint: 'chat-message-artist',
        recipient: p => p.artist_email,
        attribs: p => ({ ...p })
    },
    chat_message_to_client: {
        name: 'Chat: mensaje al cliente',
        templateHint: 'chat-message-client',
        recipient: p => p.client_email,
        attribs: p => ({ ...p })
    },

    // ===== Sessions =====
    session_scheduled: {
        name: 'Sesión: agendada',
        templateHint: 'session-scheduled',
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        attribs: p => ({ ...p })
    },
    session_rescheduled: {
        name: 'Sesión: reprogramada',
        templateHint: 'session-rescheduled',
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        attribs: p => ({ ...p })
    },
    session_completed: {
        name: 'Sesión: completada',
        templateHint: 'session-completed',
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        attribs: p => ({ ...p })
    },
    session_cancelled: {
        name: 'Sesión: cancelada',
        templateHint: 'session-cancelled',
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        attribs: p => ({ ...p })
    },

    // ===== Verification =====
    profile_verified: {
        name: 'Perfil verificado',
        templateHint: 'profile-verified',
        recipient: p => p.artist_email || p.email,
        attribs: p => ({ ...p })
    },
    profile_verification_denied: {
        name: 'Perfil verificación denegada',
        templateHint: 'verification-denied',
        recipient: p => p.artist_email || p.email,
        attribs: p => ({ ...p })
    },

    // ===== Surveys =====
    client_survey_submitted: {
        name: 'Encuesta: cliente envió respuestas',
        templateHint: 'admin-new-feedback',
        recipient: p => p.admin_email || 'admin@weotzi.com',
        attribs: p => ({ ...p })
    },
    client_survey_skipped: {
        name: 'Encuesta: cliente omitió',
        templateHint: 'admin-new-feedback',
        recipient: p => p.admin_email || 'admin@weotzi.com',
        attribs: p => ({ ...p })
    }
};

/**
 * Get the configuration for an event id.
 * @param {string} eventId
 * @returns {Object|null}
 */
function getEvent(eventId) {
    return EVENTS[eventId] || null;
}

/**
 * Resolve recipients (one or many) from a payload.
 * @returns {string[]}
 */
function resolveRecipients(eventId, payload) {
    const event = getEvent(eventId);
    if (!event) return [];
    let list;
    if (typeof event.recipients === 'function') {
        list = event.recipients(payload || {});
    } else if (typeof event.recipient === 'function') {
        const r = event.recipient(payload || {});
        list = r ? [r] : [];
    } else {
        list = [];
    }
    return list.filter(x => typeof x === 'string' && x.includes('@'));
}

/**
 * Build the BillionMail attribs object from a payload.
 * Coerces every value to a string. undefined / null become empty strings so the template
 * substitution never produces literal "undefined" or breaks when a field is missing.
 * BillionMail (and most mail template engines) cannot evaluate JS-style `||` fallbacks
 * inside a `{{var}}` placeholder, so any default text MUST be expressed in the attribs
 * function for that event (see e.g. client_registration_completed below).
 */
function buildAttribs(eventId, payload) {
    const event = getEvent(eventId);
    if (!event) return {};
    const raw = typeof event.attribs === 'function' ? event.attribs(payload || {}) : (payload || {});
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v === undefined || v === null) {
            out[k] = '';
        } else if (typeof v === 'object') {
            try {
                out[k] = JSON.stringify(v);
            } catch (_) {
                out[k] = '';
            }
        } else {
            out[k] = String(v);
        }
    }
    return out;
}

function listEvents() {
    return Object.keys(EVENTS).map(id => ({
        id,
        name: EVENTS[id].name,
        templateHint: EVENTS[id].templateHint,
        description: EVENTS[id].description || ''
    }));
}

module.exports = {
    getEvent,
    resolveRecipients,
    buildAttribs,
    listEvents,
    EVENTS
};
