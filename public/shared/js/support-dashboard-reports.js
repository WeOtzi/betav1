// ============================================
// WE ÖTZI - Support Dashboard · pestaña DENUNCIAS (ronda 2 · frente "denuncias")
// Cola de tickets de denuncia (support_tickets kind='denuncia') con el
// expediente completo: denuncia y evidencia, denunciante, denunciado y, si es
// una cotización, sus referencias y mensajes. Cambio de estado, resolución y
// notas internas. Datos SOLO por WeotziData.SupportReports
// (/api/support/reports…, lib/routes/denuncias.js): el servidor autoriza al
// agente y firma los archivos privados.
// Módulo aparte, mismo patrón que BAJAS DE CUENTA: envuelve window.switchTab,
// pinta #rpq-panel y usa el drawer de la página. Estilos en
// /shared/css/support-dashboard-reports.css. /support/dashboard#denuncias
// abre la pestaña (enlace del email a soporte).
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'denuncias';
    const STATUS_FILTERS = ['active', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed', 'all'];
    const STATUS_FILTER_LABELS = {
        active: 'Activas', open: 'Abiertas', in_progress: 'En revisión', waiting_user: 'Esperando al denunciante',
        resolved: 'Resueltas', closed: 'Cerradas', all: 'Todas'
    };
    const STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
    const STATUS_LABELS = {
        open: 'Abierta', in_progress: 'En revisión', waiting_user: 'Esperando al denunciante', resolved: 'Resuelta', closed: 'Cerrada'
    };
    const KIND_FILTERS = ['all', 'quotation', 'artist', 'studio'];
    const KIND_FILTER_LABELS = { all: 'Todos los tipos', quotation: 'Cotizaciones', artist: 'Artistas', studio: 'Estudios' };
    const KIND_LABELS = { quotation: 'Cotización', artist: 'Artista', studio: 'Estudio' };
    const PRIORITY_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
    const OUTCOME_LABELS = { resuelto: 'Se tomó acción', sin_accion: 'Sin acción' };
    const SENDER_LABELS = { artist: 'Artista', client: 'Cliente' };
    const NOTE_MAX = 4000;
    const RESOLUTION_MAX = 4000;
    // Aviso al denunciado (2.7.0): solo perfiles, una vez por ticket, 5 días hábiles.
    const NOTICE_KINDS = ['artist', 'studio'];
    const NOTICE_NOTE_MAX = 1000;
    const RESPONSE_BUSINESS_DAYS = 5;
    const MSG = {
        loading: 'Cargando…',
        empty: 'No hay denuncias en este estado.',
        emptySearch: 'Nada coincide con la búsqueda.',
        unavailable: 'No pudimos leer las denuncias. Revisa que tu usuario tenga acceso de soporte.',
        migration: 'Las denuncias todavía no están disponibles: falta aplicar la migración 20261116210000.',
        generic: 'No pudimos completar la acción. Inténtalo de nuevo.',
        noteRequired: 'Escribe la nota antes de guardarla.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        outcomeRequired: 'Indica si se tomó acción o si la denuncia queda sin acción.',
        resolutionRequired: 'Escribe qué se resolvió (mínimo 5 caracteres).',
        resolutionLong: 'La resolución puede tener hasta ' + RESOLUTION_MAX + ' caracteres.',
        noticeLong: 'El mensaje puede tener hasta ' + NOTICE_NOTE_MAX + ' caracteres.',
        noticeConfirm: '¿Avisar al denunciado? Le llega un correo con el motivo y el plazo para responder. No se puede deshacer.',
        noticeSent: 'Aviso enviado. El denunciado tiene ' + RESPONSE_BUSINESS_DAYS + ' días hábiles para responder.',
        noticeAlready: 'El denunciado ya había sido avisado.'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Solo http(s): nunca javascript:, data: ni rutas relativas en un href externo.
    function safeUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
        } catch (_) { return ''; }
    }

    // Ruta interna de un perfil público ("/artist/profile?artist=…"): misma web, sin "//" ni esquema.
    function profileHref(path, base) {
        const p = String(path || '');
        if (!/^\/[A-Za-z0-9]/.test(p) || p.indexOf('//') >= 0 || p.indexOf('\\') >= 0) return '';
        return String(base || '') + p;
    }

    function fmtDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // 'YYYY-MM-DD' → "miércoles, 25 de noviembre de 2026" (fecha de calendario, sin zona).
    function fmtDeadline(date) {
        const raw = String(date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
        const d = new Date(raw + 'T12:00:00Z');
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    function yesNo(value) { return value === true ? 'Sí' : value === false ? 'No' : ''; }

    function matchesSearch(item, term) {
        const t = String(term || '').trim().toLowerCase();
        if (!t) return true;
        const i = item || {};
        const reporter = i.reporter || {};
        const reported = i.reported || {};
        return [i.code, i.subject, i.reason_label, i.quote_id, reporter.name, reporter.email, reported.name, reported.email]
            .some((v) => String(v || '').toLowerCase().indexOf(t) >= 0);
    }

    // { payload } | { error, field }
    function buildStatusPayload(status, outcome, resolution) {
        const s = String(status || '');
        if (STATUSES.indexOf(s) < 0) return { error: MSG.generic, field: 'status' };
        const closing = s === 'resolved' || s === 'closed';
        const text = String(resolution == null ? '' : resolution).trim();
        const out = String(outcome || '');
        if (!closing) return { payload: { status: s } };
        if (text.length > RESOLUTION_MAX) return { error: MSG.resolutionLong, field: 'resolution' };
        if (out && !OUTCOME_LABELS[out]) return { error: MSG.outcomeRequired, field: 'outcome' };
        if (s === 'resolved' && !out) return { error: MSG.outcomeRequired, field: 'outcome' };
        if (s === 'resolved' && text.length < 5) return { error: MSG.resolutionRequired, field: 'resolution' };
        const payload = { status: s };
        if (out) payload.outcome = out;
        if (text) payload.resolution = text;
        return { payload };
    }

    // { note } | { error }
    function buildNote(text) {
        const note = String(text == null ? '' : text).trim();
        if (!note) return { error: MSG.noteRequired };
        if (note.length > NOTE_MAX) return { error: MSG.noteLong };
        return { note };
    }

    // { payload } | { error }: mensaje opcional de soporte para el denunciado.
    function buildNoticePayload(text) {
        const note = String(text == null ? '' : text).trim();
        if (note.length > NOTICE_NOTE_MAX) return { error: MSG.noticeLong };
        return { payload: note ? { note: note } : {} };
    }

    function badge(status) {
        const s = STATUSES.indexOf(status) >= 0 ? status : 'open';
        return '<span class="rpq-badge rpq-badge--' + s + '">' + esc(STATUS_LABELS[s]) + '</span>';
    }

    // Urgente y alta llevan etiqueta (2.7.0: estafa y titular validado entran como urgentes).
    function priorityTag(priority) {
        if (priority !== 'urgent' && priority !== 'high') return '';
        return '<span class="rpq-badge rpq-badge--' + priority + '">' + esc(PRIORITY_LABELS[priority]) + '</span>';
    }

    const VALIDATED_VIA_LABELS = {
        artist_instagram: 'código de Instagram del artista',
        studio_instagram: 'código de Instagram del estudio',
        instagram_code: 'código de Instagram',
        support: 'confirmado por soporte'
    };

    function igLink(handle) {
        const h = String(handle || '').trim().replace(/^@+/, '');
        if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return esc(handle || '');
        return '<a class="rpq-a" href="https://www.instagram.com/' + esc(h) + '/" target="_blank" rel="noopener noreferrer">@' + esc(h) + '</a>';
    }

    // «Reclamo del titular»: quien denuncia dice ser la persona o el estudio suplantado.
    function claimHtml(claim) {
        const c = claim && typeof claim === 'object' && claim.is_victim ? claim : null;
        if (!c) return '';
        const validated = c.instagram_validated === true;
        const via = validated && VALIDATED_VIA_LABELS[c.validated_via] ? ' (' + VALIDATED_VIA_LABELS[c.validated_via] + ')' : '';
        return '<div class="drawer-section rpq-section rpq-section--claim">'
            + '<p class="rpq-section-title">Reclamo del titular</p>'
            + '<dl class="rpq-facts">'
            + factHtml('Instagram', igLink(c.instagram))
            + factHtml('Enlace de prueba', externalLink(c.proof_link, c.proof_link))
            + fact('Validado', (validated ? 'Sí' : 'No') + via)
            + (c.confirmed_at ? fact('Confirmado', fmtDateTime(c.confirmed_at)) : '')
            + '</dl>'
            + (validated ? ''
                : '<p class="rpq-help">Confirma al titular solo después de comprobar que controla ese Instagram (por ejemplo, con un mensaje desde esa cuenta). La denuncia pasa a urgente.</p>'
                + '<p id="rpq-claim-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                + '<div class="rpq-actions"><button type="button" class="action-btn rpq-btn" data-rpq-claim>CONFIRMAR TITULAR</button></div>')
            + '</div>';
    }

    // «Imagen denunciada»: fotos del portafolio que el denunciante marcó (ya verificadas en el servidor).
    function referenceItemsHtml(evidence) {
        const e = evidence && typeof evidence === 'object' ? evidence : {};
        const list = Array.isArray(e.reference_items) ? e.reference_items : (e.reference_item ? [e.reference_item] : []);
        const items = list.filter((r) => r && safeUrl(r.image_url));
        if (!items.length) return '';
        return '<div class="drawer-section rpq-section">'
            + '<p class="rpq-section-title">' + (items.length > 1 ? 'Imágenes denunciadas' : 'Imagen denunciada') + '</p>'
            + '<ul class="rpq-thumbs">' + items.map((r, i) => {
                const href = safeUrl(r.image_url);
                const name = (r.category === 'flash' ? 'Flash' : 'Trabajo') + ' ' + (i + 1) + (r.key ? ' · ' + r.key : '');
                return '<li class="rpq-thumb"><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir ' + esc(name) + '">'
                    + '<img src="' + esc(href) + '" alt="" loading="lazy" decoding="async"><span>' + esc(name) + '</span></a></li>';
            }).join('') + '</ul>'
            + '<p class="rpq-help">Imágenes del perfil denunciado: el servidor comprobó que están en su portafolio.</p>'
            + '</div>';
    }

    // «Aviso al denunciado»: antes de sancionar, el artista o el estudio denunciado
    // recibe el motivo (nunca quién denunció ni la evidencia) y tiene 5 días
    // hábiles para responder. Una sola vez por ticket; después queda la fecha y el plazo.
    function reportedNoticeHtml(report) {
        const r = report || {};
        if (NOTICE_KINDS.indexOf(r.target_kind) < 0) return '';
        const dossier = r.dossier && typeof r.dossier === 'object' ? r.dossier : {};
        const n = dossier.reported_notice && typeof dossier.reported_notice === 'object' && dossier.reported_notice.sent_at
            ? dossier.reported_notice : null;
        const head = '<div class="drawer-section rpq-section" data-rpq-notice>'
            + '<p class="rpq-section-title">Aviso al denunciado</p>';
        if (n) {
            const deadline = fmtDeadline(n.deadline);
            return head
                + '<dl class="rpq-facts">'
                + fact('Avisado', fmtDateTime(n.sent_at))
                + fact('Plazo para responder', deadline ? deadline + ' (' + (Number(n.business_days) || RESPONSE_BUSINESS_DAYS) + ' días hábiles)' : '')
                + fact('Lo que se le pidió', n.note)
                + '</dl>'
                + (n.email_status === 'uncertain' || n.email_status === 'sending'
                    ? '<p class="rpq-help">No pudimos confirmar la entrega del correo. Revisa el registro de envíos antes de volver a escribirle.</p>' : '')
                + '</div>';
        }
        if (r.status === 'resolved' || r.status === 'closed') {
            return head + '<p class="rpq-help">La denuncia está cerrada. Para avisar al denunciado, reábrela cambiando el estado.</p></div>';
        }
        return head
            + '<p class="rpq-help">Le llega un correo con el motivo y el número de ticket, y tiene ' + RESPONSE_BUSINESS_DAYS
            + ' días hábiles para responder a soporte. No ve quién denunció ni la evidencia. Se envía una sola vez.</p>'
            + '<div class="rpq-field"><label for="rpq-notice-note">Qué tiene que responder (opcional)</label>'
            + '<textarea id="rpq-notice-note" class="rpq-input" rows="3" maxlength="' + NOTICE_NOTE_MAX + '" aria-describedby="rpq-notice-help"></textarea>'
            + '<p class="rpq-help" id="rpq-notice-help">Va en el correo tal cual. Por ejemplo: «Envíanos los archivos originales del diseño». Sin datos del denunciante.</p></div>'
            + '<p id="rpq-notice-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="button" class="action-btn rpq-btn" data-rpq-notify-reported>AVISAR AL DENUNCIADO</button></div>'
            + '</div>';
    }

    // «Proponer sanción» (contrato con la pestaña Sanciones, T3). Sin el módulo, no hay botón.
    function sanctionHtml(report, hasQueue) {
        const r = report || {};
        const reported = (r.dossier && r.dossier.reported) || r.reported || {};
        if (!hasQueue || !reported.user_id) return '';
        return '<div class="drawer-section rpq-section">'
            + '<p class="rpq-section-title">Sanción</p>'
            + '<p class="rpq-help">Abre la pestaña Sanciones con el formulario completo. Otro agente tiene que confirmarla.</p>'
            + '<div class="rpq-actions"><button type="button" class="action-btn rpq-btn rpq-btn--danger" data-rpq-propose-sanction>PROPONER SANCIÓN</button></div>'
            + '</div>';
    }

    // Lo que recibe window.SupportSanctionsQueue.propose (contrato T1 → T3).
    function sanctionPayload(report) {
        const r = report || {};
        const reported = (r.dossier && r.dossier.reported) || r.reported || {};
        if (!reported.user_id) return null;
        const who = [reported.name, reported.role_label].filter(Boolean).join(' · ');
        return {
            user_id: reported.user_id,
            ticket_id: r.ticket_id || null,
            reason_code: r.reason || null,
            summary: ('Denuncia ' + (r.code || '') + ': ' + (r.reason_label || r.reason || '') + (who ? ' · ' + who : '')).replace(/\s+/g, ' ').trim().slice(0, 300)
        };
    }

    function fact(label, value) {
        if (value == null || value === '') return '';
        return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function factHtml(label, html) {
        return html ? '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>' : '';
    }

    function mailLink(email) {
        const e = String(email || '').trim();
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e)) return esc(e);
        return '<a class="rpq-a" href="mailto:' + esc(e) + '">' + esc(e) + '</a>';
    }

    function externalLink(url, label) {
        const href = safeUrl(url);
        if (!href) return '';
        return '<a class="rpq-a" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label || href) + '</a>';
    }

    function place(a, b) { return [a, b].filter(Boolean).join(', '); }

    // Ficha de una persona del expediente (denunciante o denunciado).
    function personHtml(person, opts) {
        const p = person && typeof person === 'object' ? person : {};
        const o = opts || {};
        const artist = p.artist && typeof p.artist === 'object' ? p.artist : null;
        const client = p.client && typeof p.client === 'object' ? p.client : null;
        const studio = p.studio && typeof p.studio === 'object' ? p.studio : null;
        const facts = [
            fact('Nombre', p.name),
            fact('Rol', p.role_label),
            factHtml('Email', p.email ? mailLink(p.email) : ''),
            p.contact_name && p.contact_name !== p.name ? fact('Persona de contacto', p.contact_name) : '',
            o.reporter ? fact('Email confirmado', yesNo(p.email_confirmed)) : fact('Tiene cuenta', yesNo(p.has_account)),
            fact('ID de usuario', p.user_id)
        ];
        if (artist) {
            facts.push(
                fact('Usuario', artist.username ? '@' + artist.username : ''),
                fact('Ciudad', place(artist.city, artist.country)),
                fact('Instagram', artist.instagram),
                fact('WhatsApp', artist.whatsapp),
                fact('Verificación', artist.verification_state),
                fact('Estudio declarado', artist.studio_text)
            );
        }
        if (client) {
            facts.push(
                fact('Usuario', client.username ? '@' + client.username : ''),
                fact('Ciudad', place(client.city, client.country)),
                fact('Instagram', client.instagram),
                fact('WhatsApp', client.whatsapp)
            );
        }
        if (studio) {
            facts.push(
                fact('Estudio', studio.name),
                fact('Ciudad', place(studio.city, studio.country)),
                fact('Dirección', studio.address),
                factHtml('Email del estudio', studio.email ? mailLink(studio.email) : ''),
                fact('Teléfono', studio.phone),
                fact('WhatsApp', studio.whatsapp),
                fact('Instagram', studio.instagram),
                factHtml('Sitio web', externalLink(studio.website, studio.website)),
                fact('Estudio verificado', yesNo(studio.is_verified)),
                fact('ID del estudio', studio.id)
            );
        }
        const href = profileHref(p.profile_path, o.base);
        const links = href
            ? '<p class="rpq-links"><a class="rpq-a" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Ver perfil público →</a></p>'
            : '';
        return '<dl class="rpq-facts">' + facts.join('') + '</dl>' + links;
    }

    function evidenceHtml(evidence) {
        const e = evidence && typeof evidence === 'object' ? evidence : {};
        const links = (Array.isArray(e.links) ? e.links : []).map((l) => externalLink(l, l)).filter(Boolean);
        const files = Array.isArray(e.attachments) ? e.attachments : [];
        let html = '';
        if (links.length) html += '<p class="rpq-label">Enlaces</p><ul class="rpq-list">' + links.map((l) => '<li>' + l + '</li>').join('') + '</ul>';
        if (files.length) {
            html += '<p class="rpq-label">Imágenes</p><ul class="rpq-thumbs">' + files.map((f, i) => {
                const href = safeUrl(f && f.url);
                const name = (f && f.name) || ('Imagen ' + (i + 1));
                if (!href) return '<li class="rpq-thumb rpq-thumb--missing">' + esc(name) + ' · no disponible</li>';
                return '<li class="rpq-thumb"><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir ' + esc(name) + '">'
                    + '<img src="' + esc(href) + '" alt="" loading="lazy" decoding="async"><span>' + esc(name) + '</span></a></li>';
            }).join('') + '</ul>';
        }
        return html || '<p class="rpq-text rpq-muted">Sin evidencia adjunta.</p>';
    }

    function quotationHtml(quotation) {
        const q = quotation && typeof quotation === 'object' ? quotation : null;
        if (!q) return '';
        const tattoo = q.tattoo || {};
        const client = q.client || {};
        const refs = (Array.isArray(q.reference_images) ? q.reference_images : [])
            .map((url, i) => externalLink(url, 'Referencia ' + (i + 1))).filter(Boolean);
        const files = (Array.isArray(q.attachments) ? q.attachments : [])
            .map((a) => (safeUrl(a && a.url) ? externalLink(a.url, a.name || 'Archivo') : esc((a && a.name) || ''))).filter(Boolean);
        const messages = Array.isArray(q.messages) ? q.messages : [];
        const total = Number(q.messages_total) || messages.length;
        const thread = messages.length
            ? '<ol class="rpq-thread">' + messages.map((m) => {
                const attachment = m.attachment_url
                    ? externalLink(m.attachment_url, m.attachment_name || 'Adjunto')
                    : (m.has_attachment ? '<span class="rpq-muted">' + esc(m.attachment_name || 'Adjunto') + ' · no disponible</span>' : '');
                return '<li class="rpq-msg rpq-msg--' + (m.sender_type === 'artist' ? 'artist' : 'client') + '">'
                    + '<span class="rpq-muted">' + esc(SENDER_LABELS[m.sender_type] || 'Mensaje') + ' · ' + esc(fmtDateTime(m.created_at)) + '</span>'
                    + (m.message ? '<p class="rpq-text">' + esc(m.message) + '</p>' : '')
                    + (attachment ? '<p class="rpq-text">' + attachment + '</p>' : '') + '</li>';
            }).join('') + '</ol>'
            : '<p class="rpq-text rpq-muted">La cotización no tiene mensajes de chat.</p>';
        return '<div class="drawer-section rpq-section">'
            + '<p class="rpq-section-title">Cotización denunciada</p>'
            + '<dl class="rpq-facts">'
            + fact('Código', q.quote_id) + fact('Estado', q.status) + fact('Origen', q.source) + fact('Creada', fmtDateTime(q.created_at))
            + fact('Cliente', client.name) + factHtml('Email del cliente', client.email ? mailLink(client.email) : '')
            + fact('Instagram del cliente', client.instagram) + fact('WhatsApp del cliente', client.whatsapp)
            + fact('Zona', tattoo.body_part) + fact('Tamaño', tattoo.size)
            + '</dl>'
            + (tattoo.idea ? '<p class="rpq-label">Idea del tatuaje</p><p class="rpq-text rpq-pre">' + esc(tattoo.idea) + '</p>' : '')
            + (tattoo.project ? '<p class="rpq-label">Descripción del proyecto</p><p class="rpq-text rpq-pre">' + esc(tattoo.project) + '</p>' : '')
            + (tattoo.references_text ? '<p class="rpq-label">Referencias (texto)</p><p class="rpq-text rpq-pre">' + esc(tattoo.references_text) + '</p>' : '')
            + (refs.length ? '<p class="rpq-label">Imágenes de referencia</p><ul class="rpq-list rpq-list--inline">' + refs.map((r) => '<li>' + r + '</li>').join('') + '</ul>' : '')
            + (files.length ? '<p class="rpq-label">Archivos de la cotización</p><ul class="rpq-list">' + files.map((f) => '<li>' + f + '</li>').join('') + '</ul>' : '')
            + (safeUrl(q.drive_folder_url) ? '<p class="rpq-links">' + externalLink(q.drive_folder_url, 'Abrir carpeta de Drive →') + '</p>' : '')
            + '<p class="rpq-label">Mensajes' + (total > messages.length ? ' · últimos ' + messages.length + ' de ' + total : '') + '</p>'
            + thread
            + '</div>';
    }

    function logHtml(messages) {
        const list = Array.isArray(messages) ? messages : [];
        if (!list.length) return '<p class="rpq-text rpq-muted">Todavía no hay notas ni actividad.</p>';
        return '<ul class="rpq-log">' + list.map((m) => {
            const who = m.author_role === 'support'
                ? 'Soporte' + (m.author_name ? ' · ' + m.author_name : '') + (m.mine ? ' (tú)' : '')
                : m.author_role === 'system' ? 'Sistema' : 'Denunciante';
            return '<li><span class="rpq-muted">' + esc(fmtDateTime(m.created_at)) + ' · ' + esc(who)
                + (m.is_internal ? ' · nota interna' : '') + '</span><p class="rpq-text rpq-pre">' + esc(m.body) + '</p></li>';
        }).join('') + '</ul>';
    }

    function statusFormHtml(report) {
        const current = STATUSES.indexOf(report.status) >= 0 ? report.status : 'open';
        const closing = current === 'resolved' || current === 'closed';
        const options = STATUSES.map((s) => '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + esc(STATUS_LABELS[s]) + '</option>').join('');
        const outcomes = '<option value="">Elige un resultado</option>' + Object.keys(OUTCOME_LABELS).map((o) =>
            '<option value="' + o + '"' + (report.resolution_outcome === o ? ' selected' : '') + '>' + esc(OUTCOME_LABELS[o]) + '</option>').join('');
        return '<form class="drawer-section rpq-section" data-rpq-status-form novalidate>'
            + '<p class="rpq-section-title">Gestión</p>'
            + '<div class="rpq-field"><label for="rpq-new-status">Estado</label>'
            + '<select id="rpq-new-status" class="rpq-select rpq-select--block">' + options + '</select></div>'
            + '<div class="rpq-field" id="rpq-outcome-field"' + (closing ? '' : ' hidden') + '><label for="rpq-outcome">Resultado</label>'
            + '<select id="rpq-outcome" class="rpq-select rpq-select--block">' + outcomes + '</select></div>'
            + '<div class="rpq-field" id="rpq-resolution-field"' + (closing ? '' : ' hidden') + '><label for="rpq-resolution">Resolución</label>'
            + '<textarea id="rpq-resolution" class="rpq-input" rows="3" maxlength="' + RESOLUTION_MAX + '" aria-describedby="rpq-resolution-help">'
            + esc(report.resolution || '') + '</textarea>'
            + '<p class="rpq-help" id="rpq-resolution-help">Qué se decidió y qué medidas se tomaron. Queda guardado en el ticket.</p></div>'
            + '<p id="rpq-status-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent">GUARDAR ESTADO</button></div>'
            + '</form>';
    }

    function detailHtml(report, opts) {
        const r = report && typeof report === 'object' ? report : {};
        const o = opts || {};
        const dossier = r.dossier && typeof r.dossier === 'object' ? r.dossier : {};
        const kind = KIND_LABELS[r.target_kind] || 'Denuncia';
        return '<div id="rpq-detail" class="rpq-detail" data-rpq-ticket="' + esc(r.ticket_id) + '">'
            + '<p class="rpq-eyebrow">Denuncia · ' + esc(kind) + (r.code ? ' · ' + esc(r.code) : '') + '</p>'
            + '<h2 id="rpq-detail-title" class="rpq-title" tabindex="-1">' + esc(r.reason_label || r.subject || 'Denuncia') + '</h2>'
            + '<p class="rpq-sub">' + badge(r.status) + priorityTag(r.priority)
            + '<span>Recibida ' + esc(fmtDateTime(r.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section">'
            + '<p class="rpq-section-title">Denuncia</p>'
            + '<dl class="rpq-facts">'
            + fact('Ticket', r.code) + fact('Tipo', kind) + fact('Motivo', r.reason_label)
            + fact('Prioridad', PRIORITY_LABELS[r.priority] || '') + fact('Cotización', r.quote_id) + fact('Enviada desde', r.page_context)
            + (r.resolved_at ? fact('Resuelta', fmtDateTime(r.resolved_at)) : '')
            + (r.resolution_outcome ? fact('Resultado', OUTCOME_LABELS[r.resolution_outcome] || r.resolution_outcome) : '')
            + '</dl>'
            + '<p class="rpq-label">Descripción</p><p class="rpq-text rpq-pre">' + esc(r.description || '') + '</p>'
            + evidenceHtml(dossier.evidence)
            + '</div>'
            + referenceItemsHtml(dossier.evidence)
            + claimHtml(dossier.claim)
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Denunciante</p>'
            + personHtml(dossier.reporter || r.reporter, { reporter: true, base: o.base }) + '</div>'
            + '<div class="drawer-section rpq-section rpq-section--reported"><p class="rpq-section-title">Denunciado</p>'
            + personHtml(dossier.reported || r.reported, { base: o.base }) + '</div>'
            + reportedNoticeHtml(r)
            + quotationHtml(dossier.quotation)
            + sanctionHtml(r, o.sanctions === true)
            + statusFormHtml(r)
            + '<form class="drawer-section rpq-section" data-rpq-note-form novalidate>'
            + '<p class="rpq-section-title">Notas internas y actividad</p>'
            + logHtml(r.messages)
            + '<div class="rpq-field"><label for="rpq-note">Nueva nota interna</label>'
            + '<textarea id="rpq-note" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '" aria-describedby="rpq-note-help"></textarea>'
            + '<p class="rpq-help" id="rpq-note-help">Solo la ve el equipo de soporte. Ni el denunciante ni el denunciado la reciben.</p></div>'
            + '<p id="rpq-note-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn">GUARDAR NOTA</button></div>'
            + '</form>'
            + '</div>';
    }

    function rowHtml(item) {
        const i = item || {};
        const reporter = i.reporter || {};
        const reported = i.reported || {};
        return '<div class="rpq-row" role="row" tabindex="0" data-rpq-id="' + esc(i.ticket_id) + '" aria-label="Abrir denuncia ' + esc(i.code || '') + '">'
            + '<div class="rpq-cell rpq-ticket" role="cell"><span class="rpq-name">' + esc(i.code || '-') + '</span>' + priorityTag(i.priority) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Motivo"><span class="rpq-name">' + esc(i.reason_label || '-') + '</span>'
            + '<span class="rpq-muted">' + esc(KIND_LABELS[i.target_kind] || '') + (i.quote_id ? ' · ' + esc(i.quote_id) : '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Denunciante"><span class="rpq-name">' + esc(reporter.name || 'Sin nombre') + '</span>'
            + '<span class="rpq-muted">' + esc(reporter.role_label || '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Denunciado"><span class="rpq-name">' + esc(reported.name || 'Sin nombre') + '</span>'
            + '<span class="rpq-muted">' + esc(reported.role_label || '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Estado">' + badge(i.status) + '</div>'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Recibida">' + esc(fmtDateTime(i.created_at)) + '</div>'
            + '</div>';
    }

    const pure = {
        TAB, MSG, STATUSES, STATUS_LABELS, STATUS_FILTERS, KIND_FILTERS, KIND_LABELS, OUTCOME_LABELS,
        PRIORITY_LABELS,
        esc, safeUrl, profileHref, fmtDateTime, matchesSearch, buildStatusPayload, buildNote,
        personHtml, evidenceHtml, quotationHtml, logHtml, detailHtml, rowHtml,
        priorityTag, claimHtml, referenceItemsHtml, sanctionHtml, sanctionPayload,
        NOTICE_KINDS, NOTICE_NOTE_MAX, fmtDeadline, buildNoticePayload, reportedNoticeHtml
    };

    if (!root || !root.document) return { boot() {}, _internal: pure };

    // ---------------- estado ----------------

    const state = { status: 'active', kind: 'all', search: '', items: [], loaded: false, loading: false, error: null, migration: false, seq: 0, detail: null, busy: false };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportReports; }

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    // ---------------- panel ----------------

    function panelHtml() {
        const statusOpts = STATUS_FILTERS.map((f) => '<option value="' + f + '"' + (f === state.status ? ' selected' : '') + '>' + esc(STATUS_FILTER_LABELS[f]) + '</option>').join('');
        const kindOpts = KIND_FILTERS.map((f) => '<option value="' + f + '"' + (f === state.kind ? ' selected' : '') + '>' + esc(KIND_FILTER_LABELS[f]) + '</option>').join('');
        return '<div class="rpq-toolbar">'
            + '<label class="rpq-sr" for="rpq-status">Estado</label><select id="rpq-status" class="rpq-select">' + statusOpts + '</select>'
            + '<label class="rpq-sr" for="rpq-kind">Tipo</label><select id="rpq-kind" class="rpq-select">' + kindOpts + '</select>'
            + '<div class="rpq-search"><label class="rpq-sr" for="rpq-search">Buscar</label>'
            + '<input type="search" id="rpq-search" class="rpq-input" placeholder="Buscar por ticket, nombre, email o cotización" autocomplete="off"></div>'
            + '<button type="button" class="action-btn rpq-btn" id="rpq-refresh">ACTUALIZAR</button>'
            + '</div>'
            + '<p class="rpq-intro">Cada denuncia abre un ticket con el expediente del denunciante y del denunciado. El denunciado no ve la denuncia: cualquier contacto con esa persona lo decide soporte.</p>'
            + '<div class="rpq-table" role="table" aria-label="Denuncias">'
            + '<div class="rpq-head" role="row">'
            + ['Ticket', 'Motivo', 'Denunciante', 'Denunciado', 'Estado', 'Recibida'].map((h) => '<span role="columnheader">' + h + '</span>').join('')
            + '</div>'
            + '<div id="rpq-body" aria-live="polite" aria-busy="true"><div class="rpq-empty">' + MSG.loading + '</div></div>'
            + '</div>';
    }

    function ensurePanel() {
        let panel = $('rpq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'rpq-panel';
        panel.className = 'rpq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Denuncias');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        $('rpq-status').addEventListener('change', (e) => {
            state.status = STATUS_FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'active';
            state.items = []; state.loaded = false; load();
        });
        $('rpq-kind').addEventListener('change', (e) => {
            state.kind = KIND_FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'all';
            state.items = []; state.loaded = false; load();
        });
        $('rpq-search').addEventListener('input', (e) => { state.search = e.target.value || ''; renderRows(); });
        $('rpq-refresh').addEventListener('click', () => load());
        const body = $('rpq-body');
        body.addEventListener('click', (e) => {
            const row = e.target.closest('[data-rpq-id]');
            if (row) openDetail(row.dataset.rpqId);
        });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-rpq-id]');
            if (!row) return;
            e.preventDefault();
            openDetail(row.dataset.rpqId);
        });
        return panel;
    }

    function renderRows() {
        const body = $('rpq-body');
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.items.length) { body.innerHTML = '<div class="rpq-empty">' + MSG.loading + '</div>'; return; }
        if (state.error) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(state.error) + '</div>'; return; }
        if (state.migration) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(MSG.migration) + '</div>'; return; }
        const rows = state.items.filter((i) => matchesSearch(i, state.search));
        if (!rows.length) { body.innerHTML = '<div class="rpq-empty">' + (state.items.length ? MSG.emptySearch : MSG.empty) + '</div>'; return; }
        body.innerHTML = rows.map(rowHtml).join('');
    }

    function siblingsAfterTabs() {
        const nav = root.document.querySelector('.tab-navigation');
        const out = [];
        let el = nav ? nav.nextElementSibling : null;
        while (el) { out.push(el); el = el.nextElementSibling; }
        return out;
    }

    function markActive() {
        root.document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === TAB));
        root.document.querySelectorAll('.nav-menu-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === TAB));
    }

    function enter() {
        const panel = ensurePanel();
        if (!panel) return;
        // Las otras pestañas modulares ocultan sus paneles al salir.
        siblingsAfterTabs().forEach((el) => {
            if (el === panel) return;
            if (!hiddenSiblings.has(el)) hiddenSiblings.set(el, el.style.display || '');
            el.style.display = 'none';
        });
        panel.hidden = false;
        active = true;
        markActive();
        if (!state.loaded && !state.loading) load(); else renderRows();
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('rpq-panel');
        if (panel) panel.hidden = true;
        hiddenSiblings.forEach((display, el) => { el.style.display = display; });
        hiddenSiblings.clear();
    }

    function switchTab(tabName) {
        if (tabName === TAB) {
            const tickets = root.SupportDashboardTickets;
            if (tickets && typeof tickets.hide === 'function') tickets.hide();
            enter();
            return undefined;
        }
        leave();
        return previousSwitch ? previousSwitch.apply(this, arguments) : undefined;
    }

    function onTabClick(e) {
        const trigger = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!trigger || !trigger.classList) return;
        if (!trigger.classList.contains('tab-btn') && !trigger.classList.contains('nav-menu-item')) return;
        if (trigger.dataset.tab === TAB) {
            e.preventDefault();
            // Después de que las otras pestañas modulares terminen de salir.
            root.setTimeout(() => root.switchTab(TAB), 0);
        } else {
            // Captura en window: sale ANTES de que otra pestaña modular entre.
            leave();
        }
    }

    // ---------------- datos ----------------

    function setBadge(n) {
        const count = Number(n) || 0;
        root.document.querySelectorAll('.rpq-count').forEach((el) => {
            el.textContent = String(count);
            el.hidden = !count;
            el.setAttribute('aria-label', count + ' denuncias activas');
        });
    }

    async function load() {
        const R = repo();
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        let res = null;
        try { res = R ? await R.list({ status: state.status, kind: state.kind }) : null; } catch (_) { res = null; }
        if (seq !== state.seq) return;
        state.loading = false;
        state.loaded = true;
        if (res && res.ok) {
            state.items = Array.isArray(res.json.reports) ? res.json.reports : [];
            state.error = null;
            state.migration = res.json.migration_pending === true;
            if (res.json.active_count != null) setBadge(res.json.active_count);
        } else {
            state.items = [];
            state.migration = false;
            state.error = (res && res.json && res.json.error && res.status !== 0 && res.status !== 500) ? res.json.error : MSG.unavailable;
        }
        renderRows();
    }

    // ---------------- detalle ----------------

    function paint(keepFocus) {
        const content = $('drawer-content');
        if (!content || !state.detail) return;
        content.innerHTML = state.detail.report
            ? detailHtml(state.detail.report, { base: basePath(), sanctions: hasSanctionsQueue() })
            : '<div id="rpq-detail" class="rpq-detail"><p class="rpq-eyebrow">Denuncia</p>'
                + '<h2 id="rpq-detail-title" class="rpq-title" tabindex="-1">' + esc(state.detail.code || 'Denuncia') + '</h2>'
                + '<p class="rpq-text' + (state.detail.error ? ' is-error" role="alert' : '') + '">' + esc(state.detail.error || MSG.loading) + '</p></div>';
        if (!keepFocus) {
            const title = $('rpq-detail-title');
            if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
        }
    }

    async function openDetail(ticketId) {
        const toggle = $('drawer-toggle');
        const item = state.items.find((i) => String(i.ticket_id) === String(ticketId));
        if (!toggle || !ticketId) return;
        const detail = { ticketId: String(ticketId), code: item ? item.code : '', report: null, error: null };
        state.detail = detail;
        paint();
        toggle.checked = true;
        const res = await repo().get(detail.ticketId);
        if (state.detail !== detail) return;
        if (res && res.ok && res.json.report) detail.report = res.json.report;
        else detail.error = (res && res.json && res.json.error) || MSG.generic;
        paint(true);
    }

    function feedback(id, kind, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'rpq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function toggleClosingFields() {
        const select = $('rpq-new-status');
        if (!select) return;
        const closing = select.value === 'resolved' || select.value === 'closed';
        ['rpq-outcome-field', 'rpq-resolution-field'].forEach((id) => { const el = $(id); if (el) el.hidden = !closing; });
    }

    async function saveStatus() {
        const d = state.detail;
        if (!d || !d.report || state.busy) return;
        const built = buildStatusPayload($('rpq-new-status').value, $('rpq-outcome').value, $('rpq-resolution').value);
        if (built.error) {
            const field = { outcome: 'rpq-outcome', resolution: 'rpq-resolution', status: 'rpq-new-status' }[built.field];
            const el = field && $(field);
            if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
            feedback('rpq-status-feedback', 'error', built.error);
            return;
        }
        state.busy = true;
        feedback('rpq-status-feedback', 'info', 'Guardando…');
        const res = await repo().setStatus(d.ticketId, built.payload);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            feedback('rpq-status-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        const fresh = await repo().get(d.ticketId);
        if (state.detail !== d) return;
        if (fresh && fresh.ok && fresh.json.report) d.report = fresh.json.report;
        else Object.assign(d.report, { status: res.json.ticket.status, resolution: res.json.ticket.resolution, resolution_outcome: res.json.ticket.resolution_outcome });
        paint(true);
        feedback('rpq-status-feedback', 'success', 'Estado guardado: ' + (STATUS_LABELS[d.report.status] || d.report.status) + '.');
        load();
    }

    async function saveNote() {
        const d = state.detail;
        if (!d || !d.report || state.busy) return;
        const input = $('rpq-note');
        const built = buildNote(input ? input.value : '');
        if (built.error) {
            if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
            feedback('rpq-note-feedback', 'error', built.error);
            return;
        }
        state.busy = true;
        feedback('rpq-note-feedback', 'info', 'Guardando…');
        const res = await repo().addNote(d.ticketId, built.note);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            feedback('rpq-note-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        if (res.json.message) d.report.messages = (d.report.messages || []).concat(res.json.message);
        paint(true);
        feedback('rpq-note-feedback', 'success', 'Nota guardada.');
    }

    function hasSanctionsQueue() {
        const q = root.SupportSanctionsQueue;
        return !!(q && typeof q.propose === 'function');
    }

    async function confirmClaim() {
        const d = state.detail;
        if (!d || !d.report || state.busy) return;
        const R = repo();
        if (!R || typeof R.confirmClaim !== 'function') { feedback('rpq-claim-feedback', 'error', MSG.generic); return; }
        state.busy = true;
        feedback('rpq-claim-feedback', 'info', 'Confirmando…');
        const res = await R.confirmClaim(d.ticketId);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            feedback('rpq-claim-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        const fresh = await R.get(d.ticketId);
        if (state.detail !== d) return;
        if (fresh && fresh.ok && fresh.json.report) d.report = fresh.json.report;
        paint(true);
        load();
    }

    async function notifyReported() {
        const d = state.detail;
        if (!d || !d.report || state.busy) return;
        const R = repo();
        if (!R || typeof R.notifyReported !== 'function') { feedback('rpq-notice-feedback', 'error', MSG.generic); return; }
        const input = $('rpq-notice-note');
        const built = buildNoticePayload(input ? input.value : '');
        if (built.error) {
            if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
            feedback('rpq-notice-feedback', 'error', built.error);
            return;
        }
        if (typeof root.confirm === 'function' && !root.confirm(MSG.noticeConfirm)) return;
        const button = root.document.querySelector('[data-rpq-notify-reported]');
        if (button) button.disabled = true;
        state.busy = true;
        feedback('rpq-notice-feedback', 'info', 'Enviando…');
        const res = await R.notifyReported(d.ticketId, built.payload.note);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            if (button) button.disabled = false;
            feedback('rpq-notice-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        const fresh = await R.get(d.ticketId);
        if (state.detail !== d) return;
        if (fresh && fresh.ok && fresh.json.report) d.report = fresh.json.report;
        else if (res.json.notice) d.report.dossier = Object.assign({}, d.report.dossier, { reported_notice: res.json.notice });
        paint(true);
        feedback('rpq-notice-feedback', 'success', res.json.already_sent ? MSG.noticeAlready : MSG.noticeSent);
    }

    function proposeSanction() {
        const d = state.detail;
        const payload = d && d.report ? sanctionPayload(d.report) : null;
        if (!payload || !hasSanctionsQueue()) return;
        try { root.SupportSanctionsQueue.propose(payload); } catch (err) { console.warn('[denuncias] proponer sanción:', err && err.message); }
    }

    function onDrawerClick(e) {
        if (!$('rpq-detail') || !e.target || !e.target.closest) return;
        if (e.target.closest('[data-rpq-claim]')) { e.preventDefault(); confirmClaim(); return; }
        if (e.target.closest('[data-rpq-notify-reported]')) { e.preventDefault(); notifyReported(); return; }
        if (e.target.closest('[data-rpq-propose-sanction]')) { e.preventDefault(); proposeSanction(); }
    }

    function onDrawerSubmit(e) {
        if (!$('rpq-detail')) return;
        if (e.target.closest('[data-rpq-status-form]')) { e.preventDefault(); saveStatus(); return; }
        if (e.target.closest('[data-rpq-note-form]')) { e.preventDefault(); saveNote(); }
    }

    function onDrawerChange(e) {
        if (!$('rpq-detail') || !e.target) return;
        if (e.target.id === 'rpq-new-status') toggleClosingFields();
        if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
    }

    // ---------------- arranque ----------------

    // /support/dashboard#denuncias (enlace del email a soporte): abre la pestaña
    // cuando el panel ya validó la sesión del agente.
    function openFromHash() {
        if (String(root.location.hash || '').toLowerCase() !== '#' + TAB) return;
        let tries = 0;
        const timer = root.setInterval(async () => {
            tries += 1;
            const R = repo();
            const ready = R && typeof root.switchTab === 'function' && $('table-container') && await R.hasSession();
            if (ready) { root.clearInterval(timer); if (!active) root.switchTab(TAB); } else if (tries >= 40) root.clearInterval(timer);
        }, 300);
    }

    function boot() {
        const doc = root.document;
        if (!doc || root.__rpqBooted) return;
        root.__rpqBooted = true;
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        root.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('submit', onDrawerSubmit);
            drawer.addEventListener('click', onDrawerClick);
            drawer.addEventListener('change', onDrawerChange);
            drawer.addEventListener('input', (e) => { if ($('rpq-detail') && e.target && e.target.removeAttribute) e.target.removeAttribute('aria-invalid'); });
        }
        const start = () => {
            openFromHash();
            // Contador de la pestaña: una lectura liviana cuando ya hay sesión.
            root.setTimeout(async () => {
                const R = repo();
                if (state.loaded || state.loading || !R || !(await R.hasSession())) return;
                const res = await R.list({ status: 'active', kind: 'all' });
                if (res && res.ok && res.json.active_count != null) setBadge(res.json.active_count);
            }, 2200);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
        root.SupportReportsQueue = { refresh: load, open: openDetail, isActive: () => active };
    }

    return { boot, _internal: pure };
}));
