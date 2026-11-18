// ============================================
// WE ÖTZI - Support Dashboard · pestaña SANCIONES (2.7.0)
// Advertencias, suspensiones y cierres permanentes de cuentas, sus apelaciones
// y las alertas de seguridad (reingreso bloqueado, devolución de anticipo,
// imagen duplicada). Sub-vistas: Propuestas / Activas / Apeladas /
// Levantadas / Alertas. Un cierre lo propone un agente y lo confirma OTRO
// (el botón Confirmar queda deshabilitado para quien lo propuso; la base lo
// impide igual). Datos SOLO por WeotziData.SupportSanctions
// (/api/support/sanctions…, lib/routes/sanciones.js).
// Mismo patrón que FEEDBACK: envuelve window.switchTab, pinta #snq-panel y usa
// el drawer de la página. Estilos: support-dashboard-reports.css (rpq-*) y
// /shared/css/support-dashboard-sanctions.css.
// /support/dashboard#sanciones abre la pestaña.
// Contrato con la pestaña DENUNCIAS: window.SupportSanctionsQueue.propose({
//   user_id, ticket_id, reason_code, summary }) abre esta pestaña con el
// formulario de propuesta precargado.
// Fase 2 · alertas image_duplicate (lib/routes/disenos.js): las dos imágenes
// lado a lado, dueños, fechas, distancia y confianza, con tres acciones:
// Legítimo / Retirar (nota obligatoria, avisa por correo a quien la subió) /
// Abrir denuncia (cierra la alerta y abre «Proponer sanción» precargado).
// Nada se oculta solo: la imagen sigue publicada hasta que soporte decide.
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'sanciones';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const VIEWS = ['proposed', 'active', 'appealed', 'lifted', 'alerts'];
    const VIEW_LABELS = { proposed: 'Propuestas', active: 'Activas', appealed: 'Apeladas', lifted: 'Levantadas', alerts: 'Alertas' };
    const KINDS = ['warning', 'suspension', 'ban'];
    const KIND_LABELS = { warning: 'Advertencia', suspension: 'Suspensión', ban: 'Cierre permanente' };
    const KIND_HELP = {
        warning: 'Queda registrada y se avisa por correo. Se aplica en el acto.',
        suspension: 'Oculta el perfil y bloquea cotizaciones nuevas hasta la fecha de fin. No cancela cotizaciones ni bloquea el ingreso.',
        ban: 'Cierra la cuenta: perfil oculto, cotizaciones abiertas canceladas, saldo retenido, ingreso bloqueado y huellas para impedir el reingreso. Lo confirma otro agente.'
    };
    const STATUS_LABELS = { proposed: 'Propuesta', active: 'Activa', appealed: 'Apelada', lifted: 'Levantada', rejected: 'Descartada' };
    const REASON_CODES = ['suplantacion_identidad', 'plagio_diseno', 'robo_propiedad_intelectual', 'difamacion', 'estafa', 'denuncia_mala_fe', 'otro'];
    const REASON_LABELS = {
        suplantacion_identidad: 'Suplantación de identidad',
        plagio_diseno: 'Plagio de diseños',
        robo_propiedad_intelectual: 'Robo de propiedad intelectual',
        difamacion: 'Difamación',
        estafa: 'Estafa',
        denuncia_mala_fe: 'Denuncia de mala fe',
        otro: 'Otro motivo'
    };
    const ALERT_KIND_LABELS = { reentry_blocked: 'Reingreso bloqueado', image_duplicate: 'Posible copia de imagen', refund_needed: 'Devolución de anticipo' };
    const ALERT_STATUS_LABELS = { open: 'Abierta', handled: 'Gestionada', dismissed: 'Descartada' };
    const ROLE_LABELS = { artist: 'Artista', client: 'Cliente', studio: 'Estudio' };
    const MATCH_KIND_LABELS = { email: 'correo', phone: 'teléfono', instagram: 'Instagram', document: 'documento', face: 'rostro' };
    const CONFIDENCE_LABELS = { casi_segura: 'Casi segura', posible: 'Posible', parecida: 'Parecida' };
    const SOURCE_LABELS = {
        artist_gallery: 'Galería del artista', artist_feed: 'Feed del artista', flash: 'Flash',
        studio_feed: 'Fotos del estudio', store_preview: 'Vista previa de la Store', store_design: 'Diseño de la Store'
    };
    // Solo estas fuentes se retiran desde la alerta (igual que lib/routes/disenos.js).
    const RETIRABLE_KINDS = ['artist_gallery', 'flash', 'studio_feed'];

    function canRetire(payload) {
        const nw = payload && payload.new && typeof payload.new === 'object' ? payload.new : {};
        return RETIRABLE_KINDS.indexOf(String(nw.source_kind || '')) >= 0;
    }

    // Copia de lo retirado (payload.removal): para volver a publicarlo si corresponde.
    function removalHtml(removal) {
        const r = removal && typeof removal === 'object' ? removal : null;
        if (!r) return '';
        const items = Array.isArray(r.items) ? r.items : [];
        const list = items.map(function (it) {
            const url = safeImage(it && typeof it === 'object' ? it.url : it);
            const caption = it && typeof it === 'object' ? (it.title || it.caption || it.category || '') : '';
            return '<li>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(caption || 'Ver imagen') + '</a>' : esc(caption || 'Ítem sin URL')) + '</li>';
        }).join('');
        return '<p class="rpq-label">Copia de lo retirado</p>'
            + '<p class="rpq-text rpq-muted">Retirado el ' + esc(fmtDateTime(r.at)) + ' de ' + esc(r.source || 'el portafolio')
            + '. Si corresponde volver a publicarlo, estos son los datos originales:</p>'
            + (list ? '<ul class="snq-removed">' + list + '</ul>' : '')
            + '<details class="snq-removed-raw"><summary>Ver datos completos</summary><pre class="rpq-text rpq-pre">' + esc(JSON.stringify(items, null, 2)) + '</pre></details>';
    }
    const OWNER_KIND_LABELS = { artist: 'Artista', studio: 'Estudio' };
    const IMAGE_ACTIONS = ['legitimo', 'retirar', 'denuncia'];
    const IMAGE_ACTION_LABELS = { legitimo: 'Legítimo', retirar: 'Retirar', denuncia: 'Abrir denuncia' };
    const RETIRE_NOTE_MIN = 3;
    const SUMMARY_MIN = 10;
    const SUMMARY_MAX = 2000;
    const NOTE_MIN = 10;
    const NOTE_MAX = 2000;
    const MSG = {
        loading: 'Cargando…',
        empty: 'No hay sanciones en esta vista.',
        emptyAlerts: 'No hay alertas abiertas.',
        unavailable: 'No pudimos leer las sanciones. Revisa que tu usuario tenga acceso de soporte.',
        migration: 'Las sanciones todavía no están disponibles: falta aplicar la migración 20261118130000.',
        generic: 'No pudimos completar la acción. Inténtalo de nuevo.'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function shortId(id) {
        const s = String(id || '');
        return s.length > 8 ? s.slice(0, 8) + '…' : s;
    }

    function excerpt(text, max) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
    }

    // Fecha local del <input type="datetime-local"> → ISO (o '').
    function localToIso(value) {
        const v = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return '';
        const d = new Date(v);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    }

    // Lo que manda la pestaña DENUNCIAS → valores válidos del formulario.
    function cleanPrefill(prefill) {
        const p = prefill && typeof prefill === 'object' ? prefill : {};
        return {
            user_id: UUID_RE.test(String(p.user_id || '')) ? String(p.user_id) : '',
            ticket_id: UUID_RE.test(String(p.ticket_id || '')) ? String(p.ticket_id) : '',
            reason_code: REASON_CODES.indexOf(p.reason_code) >= 0 ? p.reason_code : (p.reason_code ? 'otro' : ''),
            kind: KINDS.indexOf(p.kind) >= 0 ? p.kind : '',
            summary: String(p.summary || '').trim().slice(0, SUMMARY_MAX)
        };
    }

    // { payload } | { error, field }
    function buildPropose(values, now) {
        const v = values || {};
        const userId = String(v.user_id || '').trim();
        if (!UUID_RE.test(userId)) return { error: 'Elige la cuenta: búscala o pega su ID de usuario.', field: 'user_id' };
        if (KINDS.indexOf(v.kind) < 0) return { error: 'Elige el tipo de sanción.', field: 'kind' };
        if (REASON_CODES.indexOf(v.reason_code) < 0) return { error: 'Elige el motivo.', field: 'reason_code' };
        const summary = String(v.summary || '').trim();
        if (summary.length < SUMMARY_MIN) return { error: 'Resume el caso en al menos ' + SUMMARY_MIN + ' caracteres.', field: 'summary' };
        if (summary.length > SUMMARY_MAX) return { error: 'El resumen puede tener hasta ' + SUMMARY_MAX + ' caracteres.', field: 'summary' };
        const ticket = String(v.ticket_id || '').trim();
        if (ticket && !UUID_RE.test(ticket)) return { error: 'El ID del ticket de la denuncia no es válido.', field: 'ticket_id' };
        const payload = { user_id: userId, kind: v.kind, reason_code: v.reason_code, summary: summary };
        if (ticket) payload.ticket_id = ticket;
        if (v.kind === 'suspension') {
            const iso = localToIso(v.ends_at);
            if (!iso) return { error: 'Indica hasta cuándo dura la suspensión.', field: 'ends_at' };
            const ref = now instanceof Date ? now : new Date();
            if (new Date(iso).getTime() <= ref.getTime() + 60 * 60 * 1000) return { error: 'La suspensión tiene que terminar al menos una hora después de ahora.', field: 'ends_at' };
            payload.ends_at = iso;
        }
        return { payload: payload };
    }

    function buildNote(note, min) {
        const text = String(note || '').trim();
        if (text.length < (min || 0)) return { error: 'Escribe al menos ' + min + ' caracteres.' };
        if (text.length > NOTE_MAX) return { error: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.' };
        return { note: text };
    }

    function buildAppealDecision(outcome, note) {
        if (outcome !== 'upheld' && outcome !== 'lifted') return { error: 'Elige si la sanción se mantiene o se levanta.' };
        const n = buildNote(note, NOTE_MIN);
        return n.error ? n : { outcome: outcome, note: n.note };
    }

    // Acción sobre una alerta de imagen duplicada → { action, note } | { error, field? }
    function buildImageAction(action, note) {
        if (IMAGE_ACTIONS.indexOf(action) < 0) return { error: 'Elige qué hacer: legítimo, retirar o abrir denuncia.' };
        const text = String(note || '').trim();
        if (text.length > NOTE_MAX) return { error: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.', field: 'note' };
        if (action === 'retirar' && text.length < RETIRE_NOTE_MIN) {
            return { error: 'Escribe el motivo del retiro (al menos ' + RETIRE_NOTE_MIN + ' caracteres). Le llega a quien subió la foto.', field: 'note' };
        }
        return { action: action, note: text };
    }

    function buildAlertUpdate(status, resolution) {
        if (status !== 'handled' && status !== 'dismissed') return { error: 'Elige si la alerta quedó gestionada o descartada.' };
        const text = String(resolution || '').trim();
        if (text.length < 3) return { error: 'Anota qué se hizo con la alerta.' };
        if (text.length > NOTE_MAX) return { error: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.' };
        return { payload: { status: status, resolution: text } };
    }

    // Vista → filtro de estado del servidor.
    function statusForView(view) {
        return view === 'alerts' ? null : (VIEWS.indexOf(view) >= 0 ? view : 'proposed');
    }

    function badge(status) {
        const s = STATUS_LABELS[status] ? status : 'proposed';
        return '<span class="snq-badge snq-badge--' + s + '">' + esc(STATUS_LABELS[s]) + '</span>';
    }

    function kindTag(kind) {
        const k = KIND_LABELS[kind] ? kind : 'warning';
        return '<span class="snq-kind snq-kind--' + k + '">' + esc(KIND_LABELS[k]) + '</span>';
    }

    function rowHtml(item) {
        const i = item || {};
        return '<div class="rpq-row snq-row" role="row" tabindex="0" data-snq-id="' + esc(i.id) + '" aria-label="Abrir sanción ' + esc(KIND_LABELS[i.kind] || '') + ' de la cuenta ' + esc(shortId(i.user_id)) + '">'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Creada">' + esc(fmtDateTime(i.created_at)) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Tipo">' + kindTag(i.kind) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Motivo"><span class="rpq-name">' + esc(i.reason_label || REASON_LABELS[i.reason_code] || '') + '</span>'
            + '<span class="rpq-muted">' + esc(excerpt(i.summary, 90)) + '</span></div>'
            + '<div class="rpq-cell snq-mono" role="cell" data-label="Cuenta">' + esc(shortId(i.user_id)) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Propuso">' + esc(i.proposed_by_name || (i.proposed_by ? shortId(i.proposed_by) : 'Sistema'))
            + (i.mine ? '<span class="rpq-muted"> · tú</span>' : '') + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Estado">' + badge(i.status)
            + (i.last_error ? '<span class="snq-warn">Pasos pendientes</span>' : '') + '</div>'
            + '</div>';
    }

    // Qué hacer con un reingreso bloqueado que fue un error. Con cuenta: la
    // excepción sale de levantar su cierre automático o de descartar la alerta.
    // Sin cuenta (el registro se frenó antes): solo levantar la sanción original.
    function reentryAlertHelp(a) {
        if (a && a.subject_user_id) {
            return 'Si fue un error (la cuenta no es de la persona sancionada): si tiene un cierre automático, búscalo en Activas y levántalo; si no lo tiene (por ejemplo, una validación de Instagram frenada), marca esta alerta como descartada. En los dos casos la cuenta queda revisada y no se vuelve a bloquear. Las huellas de la cuenta sancionada siguen bloqueando a cualquier otra cuenta.';
        }
        return 'El registro se frenó antes de crear la cuenta: no hay cierre que levantar ni excepción posible. Si la persona escribe a soporte, la única forma de dejarla registrarse es levantar la sanción original de la cuenta relacionada, y solo si esa sanción fue un error. Si la sanción es correcta, el bloqueo se mantiene.';
    }

    function alertSummary(a) {
        const p = (a && a.payload) || {};
        if (a.kind === 'reentry_blocked') {
            const kinds = (Array.isArray(p.match_kinds) ? p.match_kinds : []).map((k) => MATCH_KIND_LABELS[k] || k).join(', ');
            return 'Coincide por ' + (kinds || 'un dato') + (p.flow ? ' · ' + p.flow : '');
        }
        if (a.kind === 'refund_needed') {
            const quotes = Array.isArray(p.quotes) ? p.quotes : [];
            const totals = (Array.isArray(p.totals) ? p.totals : []).map((t) => t.amount + ' ' + t.currency).join(' + ');
            return (p.client_name || 'Cliente') + ' · ' + quotes.length + (quotes.length === 1 ? ' cotización' : ' cotizaciones') + (totals ? ' · ' + totals : '');
        }
        if (a.kind === 'image_duplicate') {
            const nw = p.new && typeof p.new === 'object' ? p.new : {};
            return ['Distancia ' + (p.distance == null ? '?' : p.distance), CONFIDENCE_LABELS[p.confidence] || '', SOURCE_LABELS[nw.source_kind] || '']
                .filter(Boolean).join(' · ');
        }
        return excerpt(p.summary || p.note || '', 90);
    }

    // Solo https (las URL vienen del payload de la alerta).
    function safeImage(url) {
        try {
            const u = new URL(String(url || '').trim());
            return u.protocol === 'https:' ? u.href : '';
        } catch (_) {
            return '';
        }
    }

    function ownerLabel(side, owner) {
        if (owner && owner.name) {
            const handle = owner.username ? ' (@' + owner.username + ')' : (owner.slug ? ' (' + owner.slug + ')' : '');
            return owner.name + handle;
        }
        return (OWNER_KIND_LABELS[side.owner_kind] || 'Cuenta') + ' ' + shortId(side.owner_id || '');
    }

    function imageSideHtml(title, side, owner, base) {
        const s = side && typeof side === 'object' ? side : {};
        const img = safeImage(s.image_url);
        const who = ownerLabel(s, owner);
        const sanctioned = owner && owner.sanction_state && owner.sanction_state !== 'none';
        return '<figure class="snq-shot">'
            + '<figcaption class="snq-shot-title">' + esc(title) + '</figcaption>'
            + (img
                ? '<a class="snq-shot-img" href="' + esc(img) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(img) + '" alt="' + esc(title + ' · ' + who) + '" loading="lazy" referrerpolicy="no-referrer"></a>'
                : '<div class="snq-shot-img snq-shot-img--empty">Sin vista previa</div>')
            + '<dl class="rpq-facts">'
            + fact(OWNER_KIND_LABELS[owner && owner.kind] || OWNER_KIND_LABELS[s.owner_kind] || 'Dueño', who)
            + fact('Dónde', SOURCE_LABELS[s.source_kind] || '')
            + fact('Vista por primera vez', s.first_seen_at ? fmtDateTime(s.first_seen_at) : '')
            + fact('Sanción', sanctioned ? (owner.sanction_state === 'banned' ? 'Cuenta cerrada' : 'Suspendida') : '')
            + '</dl>'
            + (owner && owner.profile_url ? '<a class="snq-shot-link" href="' + esc((base || '') + owner.profile_url) + '" target="_blank" rel="noopener">Ver perfil</a>' : '')
            + '</figure>';
    }

    function imageAlertDetailHtml(alert, owners, base) {
        const a = alert || {};
        const p = a.payload || {};
        const o = owners || {};
        const conf = CONFIDENCE_LABELS[p.confidence] || '';
        return '<div id="snq-detail" class="rpq-detail" data-snq-alert-item="' + esc(a.id) + '" data-snq-alert-kind="image_duplicate">'
            + '<p class="rpq-eyebrow">Sanciones · Alerta</p>'
            + '<h2 id="snq-detail-title" class="rpq-title" tabindex="-1">' + esc(ALERT_KIND_LABELS.image_duplicate) + '</h2>'
            + '<p class="rpq-sub"><span class="snq-badge snq-badge--' + esc(a.status || 'open') + '">' + esc(ALERT_STATUS_LABELS[a.status] || '') + '</span>'
            + (conf ? '<span class="snq-conf snq-conf--' + esc(p.confidence) + '">' + esc(conf) + '</span>' : '')
            + '<span>Creada ' + esc(fmtDateTime(a.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section"><dl class="rpq-facts">'
            + fact('Distancia', p.distance == null ? '' : p.distance + ' de 64 (0 es idéntica)')
            + fact('Confianza', conf)
            + '</dl>'
            + '<div class="snq-pair">'
            + imageSideHtml('Imagen nueva', p.new, o.new, base)
            + imageSideHtml('Imagen anterior', p.existing, o.existing, base)
            + '</div>'
            + (a.resolution ? '<p class="rpq-label">Resolución</p><p class="rpq-text rpq-pre">' + esc(a.resolution) + '</p>' : '')
            + removalHtml(p.removal)
            + '</div>'
            + (a.status === 'open'
                ? '<form class="drawer-section rpq-section" data-snq-image-form novalidate>'
                    + '<p class="rpq-section-title">Decisión</p>'
                    + '<p class="rpq-text rpq-muted">Nada se ocultó solo: la imagen sigue publicada hasta que decidas. Que se parezcan no prueba un plagio.</p>'
                    + '<div class="rpq-field"><label for="snq-image-note">Nota</label>'
                    + '<textarea id="snq-image-note" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '" aria-describedby="snq-image-note-help"></textarea>'
                    + '<p class="rpq-help" id="snq-image-note-help">Obligatoria para retirar: le llega por correo a quien subió la foto.</p></div>'
                    + (canRetire(p) ? '' : '<p class="rpq-help" id="snq-image-store-help">Esta imagen no es de un portafolio (por ejemplo, de la Store): retírala desde su propia gestión.</p>')
                    + '<p id="snq-image-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                    + '<div class="rpq-actions snq-image-actions">'
                    + '<button type="submit" class="action-btn rpq-btn" data-snq-image-action="legitimo">LEGÍTIMO</button>'
                    + (canRetire(p)
                        ? '<button type="submit" class="action-btn rpq-btn snq-btn--danger" data-snq-image-action="retirar">RETIRAR</button>'
                        : '<button type="button" class="action-btn rpq-btn snq-btn--danger" disabled aria-describedby="snq-image-store-help">RETIRAR</button>')
                    + '<button type="submit" class="action-btn rpq-btn rpq-btn--accent" data-snq-image-action="denuncia">ABRIR DENUNCIA</button>'
                    + '</div></form>'
                : '')
            + '</div>';
    }

    function alertRowHtml(alert) {
        const a = alert || {};
        return '<div class="rpq-row snq-row snq-row--alert" role="row" tabindex="0" data-snq-alert="' + esc(a.id) + '" aria-label="Abrir alerta ' + esc(ALERT_KIND_LABELS[a.kind] || '') + '">'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Creada">' + esc(fmtDateTime(a.created_at)) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Tipo"><span class="snq-kind snq-kind--alert">' + esc(ALERT_KIND_LABELS[a.kind] || a.kind || '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Detalle">' + esc(alertSummary(a)) + '</div>'
            + '<div class="rpq-cell snq-mono" role="cell" data-label="Cuenta">' + esc(shortId(a.subject_user_id) || '—') + '</div>'
            + '<div class="rpq-cell snq-mono" role="cell" data-label="Relacionada">' + esc(shortId(a.related_user_id) || '—') + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Estado"><span class="snq-badge snq-badge--' + esc(a.status || 'open') + '">' + esc(ALERT_STATUS_LABELS[a.status] || '') + '</span></div>'
            + '</div>';
    }

    function fact(label, value) {
        if (value == null || value === '') return '';
        return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function options(values, labels, selected, placeholder) {
        return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '')
            + values.map((v) => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(labels[v]) + '</option>').join('');
    }

    function proposeFormHtml(prefill) {
        const p = cleanPrefill(prefill);
        return '<div id="snq-detail" class="rpq-detail" data-snq-mode="propose">'
            + '<p class="rpq-eyebrow">Sanciones · Nueva propuesta</p>'
            + '<h2 id="snq-detail-title" class="rpq-title" tabindex="-1">Proponer una sanción</h2>'
            + '<p class="rpq-text rpq-muted">Un cierre permanente lo confirma otro agente. La advertencia se aplica al guardarla.</p>'
            + '<form class="drawer-section rpq-section" data-snq-search-form novalidate>'
            + '<p class="rpq-section-title">Cuenta</p>'
            + '<div class="rpq-field"><label for="snq-search">Buscar por correo, usuario o nombre</label>'
            + '<div class="snq-inline"><input type="search" id="snq-search" class="rpq-input" autocomplete="off" minlength="3" maxlength="80">'
            + '<button type="submit" class="action-btn rpq-btn">BUSCAR</button></div></div>'
            + '<ul id="snq-search-results" class="snq-results" aria-live="polite"></ul>'
            + '</form>'
            + '<form class="drawer-section rpq-section" data-snq-propose-form novalidate>'
            + '<div class="rpq-field"><label for="snq-user">ID de usuario</label>'
            + '<input type="text" id="snq-user" class="rpq-input snq-mono" value="' + esc(p.user_id) + '" autocomplete="off" spellcheck="false" required aria-describedby="snq-user-help">'
            + '<p class="rpq-help" id="snq-user-help">Lo completa el buscador, o lo traes desde la denuncia.</p></div>'
            + '<div class="rpq-field"><label for="snq-kind">Tipo de sanción</label>'
            + '<select id="snq-kind" class="rpq-select rpq-select--block" required aria-describedby="snq-kind-help">' + options(KINDS, KIND_LABELS, p.kind, 'Elige un tipo') + '</select>'
            + '<p class="rpq-help" id="snq-kind-help">' + esc(p.kind ? KIND_HELP[p.kind] : 'Elige un tipo para ver qué hace.') + '</p></div>'
            + '<div class="rpq-field" id="snq-ends-field"' + (p.kind === 'suspension' ? '' : ' hidden') + '><label for="snq-ends">Fin de la suspensión</label>'
            + '<input type="datetime-local" id="snq-ends" class="rpq-input"></div>'
            + '<div class="rpq-field"><label for="snq-reason">Motivo</label>'
            + '<select id="snq-reason" class="rpq-select rpq-select--block" required>' + options(REASON_CODES, REASON_LABELS, p.reason_code, 'Elige un motivo') + '</select></div>'
            + '<div class="rpq-field"><label for="snq-summary">Resumen del caso</label>'
            + '<textarea id="snq-summary" class="rpq-input" rows="4" maxlength="' + SUMMARY_MAX + '" required aria-describedby="snq-summary-help">' + esc(p.summary) + '</textarea>'
            + '<p class="rpq-help" id="snq-summary-help">Lo ven los agentes. Al sancionado le llega solo el tipo y el motivo.</p></div>'
            + '<div class="rpq-field"><label for="snq-ticket">Ticket de la denuncia (opcional)</label>'
            + '<input type="text" id="snq-ticket" class="rpq-input snq-mono" value="' + esc(p.ticket_id) + '" autocomplete="off" spellcheck="false"></div>'
            + '<p id="snq-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent">PROPONER</button></div>'
            + '</form></div>';
    }

    function effectsHtml(e) {
        const x = e || {};
        const items = [];
        if (x.source === 'reentry') items.push('Bloqueo automático por reingreso');
        if (x.reentry_cleared) items.push('Cuenta marcada como revisada: ya no se bloquea por coincidir con otra cuenta sancionada');
        if (x.reentry_pending) items.push('La cuenta todavía no quedó marcada como revisada (faltaba aplicar una migración): vuelve a levantar la sanción para que no se bloquee de nuevo al iniciar sesión');
        if (x.artist_hidden) items.push('Perfil de artista oculto');
        if (x.studios_hidden) items.push(x.studios_hidden + (x.studios_hidden === 1 ? ' estudio desactivado' : ' estudios desactivados'));
        if (x.quotations_cancelled) items.push(x.quotations_cancelled + ' cotizaciones canceladas (' + (x.client_notices_sent || 0) + ' clientes avisados)');
        if (x.wallet_movements_blocked) items.push(x.wallet_movements_blocked + ' movimientos de la billetera retenidos');
        if (x.store_orders_held) items.push(x.store_orders_held + ' pedidos de la Store retenidos');
        if (x.refund_alerts) items.push(x.refund_alerts + ' alertas de devolución de anticipo');
        if (x.identifiers) items.push(x.identifiers === 'sin clave' ? 'Sin huellas: falta BAN_HMAC_KEY en el servidor' : x.identifiers + ' huellas guardadas');
        if (x.auth_banned) items.push('Ingreso bloqueado en Auth');
        if (x.sessions_revoked != null) items.push('Sesiones cerradas');
        if (x.notice_sent === true) items.push('Aviso enviado por correo');
        if (x.notice_sent === false) items.push('El aviso por correo no salió');
        if (!items.length) return '<p class="rpq-text rpq-muted">Todavía no se aplicó.</p>';
        return '<ul class="rpq-list">' + items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>'
            + (x.error ? '<p class="rpq-text is-error" role="alert">Un paso falló (' + esc(x.error.step) + '). Vuelve a confirmar para terminar.</p>' : '');
    }

    function detailHtml(item, me) {
        const s = item || {};
        const acc = s.account || {};
        const fx = s.effects || {};
        const isBan = s.kind === 'ban';
        const sameAgent = isBan && s.proposed_by && s.proposed_by === me;
        const canRetry = (s.status === 'active' || s.status === 'appealed') && Array.isArray(s.pending_steps) && s.pending_steps.length > 0;
        let html = '<div id="snq-detail" class="rpq-detail" data-snq-item="' + esc(s.id) + '">'
            + '<p class="rpq-eyebrow">Sanciones · ' + esc(KIND_LABELS[s.kind] || '') + '</p>'
            + '<h2 id="snq-detail-title" class="rpq-title" tabindex="-1">' + esc(s.reason_label || REASON_LABELS[s.reason_code] || 'Sanción') + '</h2>'
            + '<p class="rpq-sub">' + badge(s.status) + kindTag(s.kind) + '<span>Creada ' + esc(fmtDateTime(s.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Caso</p>'
            + '<p class="rpq-text rpq-pre">' + esc(s.summary || '') + '</p><dl class="rpq-facts">'
            + fact('Propuso', s.proposed_by_name || (s.proposed_by ? shortId(s.proposed_by) : 'Sistema'))
            + fact('Confirmó', s.confirmed_by_name || (s.confirmed_by ? shortId(s.confirmed_by) : ''))
            + fact('Desde', s.status === 'proposed' ? '' : fmtDateTime(s.starts_at))
            + fact('Hasta', s.ends_at ? fmtDateTime(s.ends_at) : (s.kind === 'warning' ? '' : 'Permanente'))
            + fact('Ticket', s.ticket_id || '')
            + fact('Nota al confirmar', fx.confirm_note || '')
            + fact('Nota al levantar', fx.lift_note || '')
            + '</dl></div>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Cuenta</p><dl class="rpq-facts">'
            + fact('ID de usuario', acc.user_id || s.user_id)
            + fact('Correo', acc.email || (acc.exists === false ? 'La cuenta ya no existe' : ''))
            + fact('Artista', acc.artist ? (acc.artist.name || '') + (acc.artist.username ? ' (@' + acc.artist.username + ')' : '') : '')
            + fact('Cliente', acc.client ? acc.client.name || 'Sí' : '')
            + fact('Estudios', (acc.studios || []).map((st) => st.name + (st.is_active ? '' : ' (inactivo)')).join(', '))
            + '</dl>'
            + (Array.isArray(s.history) && s.history.length ? '<p class="rpq-label">Otras sanciones</p><ul class="rpq-list">'
                + s.history.map((h) => '<li>' + esc(h.kind_label) + ' · ' + esc(h.status_label) + ' · ' + esc(fmtDateTime(h.created_at)) + '</li>').join('') + '</ul>' : '')
            + '</div>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Qué hizo</p>' + effectsHtml(fx) + '</div>';

        if (s.appeal_submitted_at || s.appeal_text) {
            html += '<div class="drawer-section rpq-section snq-appeal"><p class="rpq-section-title">Apelación</p>'
                + '<p class="rpq-text rpq-muted">Enviada ' + esc(fmtDateTime(s.appeal_submitted_at)) + '</p>'
                + '<p class="rpq-text rpq-pre">' + esc(s.appeal_text || '') + '</p>'
                + (s.appeal_outcome ? '<p class="rpq-text"><strong>' + esc(s.appeal_outcome_label || '') + '</strong> · ' + esc(s.appeal_decided_by_name || '') + ' · ' + esc(fmtDateTime(s.appeal_decided_at)) + '</p>' : '')
                + (fx.appeal_decision_note ? '<p class="rpq-text rpq-pre">' + esc(fx.appeal_decision_note) + '</p>' : '')
                + '</div>';
        }

        if (s.status === 'proposed' || canRetry) {
            const disabled = s.status === 'proposed' ? !s.can_confirm : false;
            html += '<form class="drawer-section rpq-section" data-snq-confirm-form novalidate>'
                + '<p class="rpq-section-title">' + (s.status === 'proposed' ? 'Confirmar y aplicar' : 'Terminar de aplicar') + '</p>'
                + (s.status === 'proposed' ? '<p class="rpq-text">' + esc(KIND_HELP[s.kind] || '') + '</p>' : '<p class="rpq-text">Faltan pasos: ' + esc((s.pending_steps || []).join(', ')) + '.</p>')
                + '<div class="rpq-field"><label for="snq-confirm-note">Nota (opcional)</label>'
                + '<textarea id="snq-confirm-note" class="rpq-input" rows="2" maxlength="' + NOTE_MAX + '"></textarea></div>'
                + (sameAgent && s.status === 'proposed' ? '<p class="rpq-help" id="snq-confirm-help">Tú propusiste este cierre: lo tiene que confirmar otro agente.</p>' : '')
                + '<p id="snq-confirm-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent"' + (disabled ? ' disabled aria-describedby="snq-confirm-help"' : '') + '>'
                + (s.status === 'proposed' ? 'CONFIRMAR' : 'REINTENTAR') + '</button></div></form>';
        }

        if (s.status === 'appealed') {
            html += '<form class="drawer-section rpq-section" data-snq-appeal-form novalidate>'
                + '<p class="rpq-section-title">Decidir la apelación</p>'
                + (s.can_decide_appeal ? '' : '<p class="rpq-help">La decide un agente que no propuso ni confirmó la sanción.</p>')
                + '<fieldset class="snq-radios"' + (s.can_decide_appeal ? '' : ' disabled') + '><legend class="rpq-sr">Decisión</legend>'
                + '<label><input type="radio" name="snq-outcome" value="upheld"> Se mantiene</label>'
                + '<label><input type="radio" name="snq-outcome" value="lifted"> Se levanta</label></fieldset>'
                + '<div class="rpq-field"><label for="snq-appeal-note">Fundamento</label>'
                + '<textarea id="snq-appeal-note" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '"' + (s.can_decide_appeal ? '' : ' disabled') + '></textarea></div>'
                + '<p id="snq-appeal-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent"' + (s.can_decide_appeal ? '' : ' disabled') + '>GUARDAR DECISIÓN</button></div></form>';
        }

        if (s.can_lift) {
            const discard = s.status === 'proposed';
            const resume = s.status === 'lifted';
            html += '<form class="drawer-section rpq-section" data-snq-lift-form novalidate>'
                + '<p class="rpq-section-title">' + (discard ? 'Descartar la propuesta' : (resume ? 'Terminar de levantar' : 'Levantar la sanción')) + '</p>'
                + (discard ? '' : (resume
                    ? '<p class="rpq-text">La sanción ya está levantada, pero quedaron pasos sin terminar. Vuelve a levantarla para completarlos.</p>'
                    : '<p class="rpq-text">Revierte lo que hizo la sanción. Las cotizaciones canceladas no se reabren.</p>'))
                + (!discard && isBan ? '<p class="rpq-help">La cuenta queda marcada como revisada: no se vuelve a bloquear al iniciar sesión ni al validar su Instagram por coincidir con otra cuenta sancionada. Las huellas de esa otra cuenta siguen bloqueando a cualquier otra cuenta.</p>' : '')
                + '<div class="rpq-field"><label for="snq-lift-note">Motivo</label>'
                + '<textarea id="snq-lift-note" class="rpq-input" rows="2" maxlength="' + NOTE_MAX + '"></textarea></div>'
                + '<p id="snq-lift-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn">' + (discard ? 'DESCARTAR' : 'LEVANTAR') + '</button></div></form>';
        }
        return html + '</div>';
    }

    function alertDetailHtml(alert, owners, base) {
        const a = alert || {};
        if (a.kind === 'image_duplicate') return imageAlertDetailHtml(a, owners, base);
        const p = a.payload || {};
        const quotes = Array.isArray(p.quotes) ? p.quotes : [];
        return '<div id="snq-detail" class="rpq-detail" data-snq-alert-item="' + esc(a.id) + '">'
            + '<p class="rpq-eyebrow">Sanciones · Alerta</p>'
            + '<h2 id="snq-detail-title" class="rpq-title" tabindex="-1">' + esc(ALERT_KIND_LABELS[a.kind] || 'Alerta') + '</h2>'
            + '<p class="rpq-sub"><span class="snq-badge snq-badge--' + esc(a.status || 'open') + '">' + esc(ALERT_STATUS_LABELS[a.status] || '') + '</span><span>Creada ' + esc(fmtDateTime(a.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section"><dl class="rpq-facts">'
            + fact('Resumen', alertSummary(a))
            + fact('Cuenta', a.subject_user_id || '')
            + fact('Cuenta relacionada', a.related_user_id || '')
            + fact('Sanción', p.sanction_id || '')
            + '</dl>'
            + (quotes.length ? '<p class="rpq-label">Cotizaciones</p><ul class="rpq-list">' + quotes.map((q) => '<li>' + esc(q.quote_id) + ' · ' + esc(q.amount) + ' ' + esc(q.currency) + (q.paid_on ? ' · ' + esc(q.paid_on) : '') + '</li>').join('') + '</ul>' : '')
            + (a.kind === 'reentry_blocked' ? '<p class="rpq-help">' + esc(reentryAlertHelp(a)) + '</p>' : '')
            + (a.resolution ? '<p class="rpq-label">Resolución</p><p class="rpq-text rpq-pre">' + esc(a.resolution) + '</p>' : '')
            + '</div>'
            + (a.status === 'open'
                ? '<form class="drawer-section rpq-section" data-snq-alert-form novalidate>'
                    + '<p class="rpq-section-title">Gestión</p>'
                    + '<div class="rpq-field"><label for="snq-alert-status">Estado</label><select id="snq-alert-status" class="rpq-select rpq-select--block">'
                    + '<option value="handled">Gestionada</option><option value="dismissed">'
                    + (a.kind === 'reentry_blocked' && a.subject_user_id ? 'Descartada (falso positivo: la cuenta queda revisada)' : 'Descartada')
                    + '</option></select></div>'
                    + '<div class="rpq-field"><label for="snq-alert-resolution">Qué se hizo</label>'
                    + '<textarea id="snq-alert-resolution" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '"></textarea></div>'
                    + '<p id="snq-alert-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
                    + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent">GUARDAR</button></div></form>'
                : '')
            + '</div>';
    }

    function searchResultsHtml(accounts) {
        const list = Array.isArray(accounts) ? accounts : [];
        if (!list.length) return '<li class="rpq-muted">Sin resultados.</li>';
        return list.map((a) => '<li><button type="button" class="snq-pick" data-snq-pick="' + esc(a.user_id) + '">'
            + '<span class="rpq-name">' + esc(a.name || a.username || a.email || shortId(a.user_id)) + '</span>'
            + '<span class="rpq-muted">' + esc([ROLE_LABELS[a.role] || '', a.username ? '@' + a.username : '', a.email].filter(Boolean).join(' · ')) + '</span>'
            + '</button></li>').join('');
    }

    const pure = {
        TAB, VIEWS, VIEW_LABELS, KINDS, KIND_LABELS, STATUS_LABELS, REASON_CODES, REASON_LABELS, ALERT_KIND_LABELS, MSG,
        CONFIDENCE_LABELS, SOURCE_LABELS, IMAGE_ACTIONS, IMAGE_ACTION_LABELS, RETIRABLE_KINDS, canRetire, removalHtml,
        esc, fmtDateTime, shortId, localToIso, cleanPrefill, buildPropose, buildNote, buildAppealDecision, buildAlertUpdate,
        buildImageAction, safeImage, imageSideHtml, imageAlertDetailHtml,
        statusForView, rowHtml, alertRowHtml, alertSummary, proposeFormHtml, detailHtml, alertDetailHtml, searchResultsHtml
    };

    if (!root || !root.document) return { boot() {}, _internal: pure };

    // ---------------- estado ----------------

    const state = {
        view: 'proposed', items: [], alerts: [], loaded: false, loading: false, error: null, migration: false, seq: 0,
        me: null, counts: null, detail: null, busy: false, pendingPrefill: null, imageAction: null
    };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportSanctions; }
    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    // ---------------- panel ----------------

    function panelHtml() {
        return '<p class="rpq-intro">Advertencias, suspensiones y cierres de cuentas. Un cierre permanente lo propone un agente y lo confirma otro; la apelación la decide un tercero.</p>'
            + '<div class="rpq-toolbar snq-toolbar">'
            + '<div class="snq-views" role="group" aria-label="Vista">'
            + VIEWS.map((v) => '<button type="button" class="action-btn rpq-btn snq-view" data-snq-view="' + v + '" aria-pressed="' + (v === state.view) + '">'
                + esc(VIEW_LABELS[v].toUpperCase()) + ' <span class="snq-view-count" data-snq-view-count="' + v + '" hidden></span></button>').join('')
            + '</div>'
            + '<button type="button" class="action-btn rpq-btn" id="snq-refresh">ACTUALIZAR</button>'
            + '<button type="button" class="action-btn rpq-btn rpq-btn--accent" id="snq-new">PROPONER SANCIÓN</button>'
            + '</div>'
            + '<div class="rpq-table" role="table" aria-label="Sanciones">'
            + '<div class="rpq-head snq-head" role="row" id="snq-head"></div>'
            + '<div id="snq-body" aria-live="polite" aria-busy="true"><div class="rpq-empty">' + MSG.loading + '</div></div>'
            + '</div>';
    }

    function headHtml() {
        const cols = state.view === 'alerts'
            ? ['Creada', 'Tipo', 'Detalle', 'Cuenta', 'Relacionada', 'Estado']
            : ['Creada', 'Tipo', 'Motivo', 'Cuenta', 'Propuso', 'Estado'];
        return cols.map((h) => '<span role="columnheader">' + h + '</span>').join('');
    }

    function ensurePanel() {
        let panel = $('snq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'snq-panel';
        panel.className = 'rpq-panel snq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Sanciones');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        panel.querySelectorAll('[data-snq-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.snqView)));
        $('snq-refresh').addEventListener('click', () => load());
        $('snq-new').addEventListener('click', () => openPropose({}));
        const body = $('snq-body');
        const openRow = (target) => {
            const row = target.closest('[data-snq-id],[data-snq-alert]');
            if (!row) return false;
            if (row.dataset.snqAlert) openAlert(row.dataset.snqAlert); else openDetail(row.dataset.snqId);
            return true;
        };
        body.addEventListener('click', (e) => { openRow(e.target); });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (openRow(e.target)) e.preventDefault();
        });
        return panel;
    }

    function setView(view) {
        if (VIEWS.indexOf(view) < 0 || view === state.view) return;
        state.view = view;
        root.document.querySelectorAll('[data-snq-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snqView === view)));
        state.items = [];
        state.alerts = [];
        load();
    }

    function renderRows() {
        const body = $('snq-body');
        const head = $('snq-head');
        if (head) { head.innerHTML = headHtml(); head.classList.toggle('snq-head--alerts', state.view === 'alerts'); }
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        const list = state.view === 'alerts' ? state.alerts : state.items;
        if (state.loading && !list.length) { body.innerHTML = '<div class="rpq-empty">' + MSG.loading + '</div>'; return; }
        if (state.error) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(state.error) + '</div>'; return; }
        if (state.migration) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(MSG.migration) + '</div>'; return; }
        if (!list.length) { body.innerHTML = '<div class="rpq-empty">' + (state.view === 'alerts' ? MSG.emptyAlerts : MSG.empty) + '</div>'; return; }
        body.innerHTML = state.view === 'alerts' ? list.map(alertRowHtml).join('') : list.map(rowHtml).join('');
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
        siblingsAfterTabs().forEach((el) => {
            if (el === panel) return;
            if (!hiddenSiblings.has(el)) hiddenSiblings.set(el, el.style.display || '');
            el.style.display = 'none';
        });
        panel.hidden = false;
        active = true;
        markActive();
        if (!state.loaded && !state.loading) load(); else renderRows();
        if (state.pendingPrefill) {
            const prefill = state.pendingPrefill;
            state.pendingPrefill = null;
            openPropose(prefill);
        }
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('snq-panel');
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
            root.setTimeout(() => root.switchTab(TAB), 0);
        } else {
            leave();
        }
    }

    // ---------------- datos ----------------

    function setBadges(counts) {
        const c = counts || {};
        const pending = (Number(c.proposed) || 0) + (Number(c.appealed) || 0) + (Number(c.open_alerts) || 0);
        root.document.querySelectorAll('.snq-count').forEach((el) => {
            el.textContent = String(pending);
            el.hidden = !pending;
            el.setAttribute('aria-label', pending + ' pendientes');
        });
        [['proposed', c.proposed], ['appealed', c.appealed], ['alerts', c.open_alerts]].forEach(([view, n]) => {
            const el = root.document.querySelector('[data-snq-view-count="' + view + '"]');
            if (!el) return;
            el.textContent = String(Number(n) || 0);
            el.hidden = !Number(n);
        });
    }

    async function load() {
        const R = repo();
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        let res = null;
        try {
            res = R ? (state.view === 'alerts' ? await R.alerts({ status: 'open' }) : await R.list({ status: statusForView(state.view) })) : null;
        } catch (_) { res = null; }
        if (seq !== state.seq) return;
        state.loading = false;
        state.loaded = true;
        if (res && res.ok) {
            state.error = null;
            state.migration = res.json.migration_pending === true;
            if (state.view === 'alerts') state.alerts = Array.isArray(res.json.alerts) ? res.json.alerts : [];
            else {
                state.items = Array.isArray(res.json.sanctions) ? res.json.sanctions : [];
                if (res.json.reviewer) state.me = res.json.reviewer.user_id || state.me;
                if (res.json.counts) { state.counts = res.json.counts; setBadges(state.counts); }
            }
        } else {
            state.items = [];
            state.alerts = [];
            state.migration = false;
            state.error = (res && res.json && res.json.error && res.status !== 0 && res.status !== 500) ? res.json.error : MSG.unavailable;
        }
        renderRows();
    }

    // ---------------- drawer ----------------

    function focusTitle() {
        const title = $('snq-detail-title');
        if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
    }

    function openDrawer(html) {
        const toggle = $('drawer-toggle');
        const content = $('drawer-content');
        if (!toggle || !content) return false;
        content.innerHTML = html;
        toggle.checked = true;
        focusTitle();
        return true;
    }

    function placeholder(title, text, isError) {
        return '<div id="snq-detail" class="rpq-detail"><p class="rpq-eyebrow">Sanciones</p>'
            + '<h2 id="snq-detail-title" class="rpq-title" tabindex="-1">' + esc(title) + '</h2>'
            + '<p class="rpq-text' + (isError ? ' is-error" role="alert' : '') + '">' + esc(text) + '</p></div>';
    }

    function openPropose(prefill) {
        state.detail = { mode: 'propose' };
        openDrawer(proposeFormHtml(prefill));
        const kind = $('snq-kind');
        if (kind) kind.addEventListener('change', onKindChange);
    }

    function onKindChange() {
        const kind = $('snq-kind').value;
        const help = $('snq-kind-help');
        if (help) help.textContent = KIND_HELP[kind] || 'Elige un tipo para ver qué hace.';
        const ends = $('snq-ends-field');
        if (ends) ends.hidden = kind !== 'suspension';
    }

    async function openDetail(id) {
        if (!UUID_RE.test(String(id || ''))) return;
        const detail = { mode: 'sanction', id: String(id), item: null };
        state.detail = detail;
        openDrawer(placeholder('Sanción', MSG.loading));
        const res = await repo().get(detail.id);
        if (state.detail !== detail) return;
        if (res && res.ok && res.json.sanction) {
            detail.item = res.json.sanction;
            $('drawer-content').innerHTML = detailHtml(detail.item, state.me);
        } else {
            $('drawer-content').innerHTML = placeholder('Sanción', (res && res.json && res.json.error) || MSG.generic, true);
        }
        focusTitle();
    }

    function openAlert(id) {
        const alert = state.alerts.find((a) => a.id === id);
        if (!alert) return;
        const detail = { mode: 'alert', id, item: alert, owners: null };
        state.detail = detail;
        openDrawer(alertDetailHtml(alert, null, basePath()));
        if (alert.kind === 'image_duplicate') loadImageOwners(detail);
    }

    // Dueños de las dos imágenes (nombre, usuario, perfil); se pinta primero con el payload.
    async function loadImageOwners(detail) {
        const R = repo();
        if (!R || typeof R.imageAlert !== 'function') return;
        const res = await R.imageAlert(detail.id).catch(() => null);
        if (state.detail !== detail || !res || !res.ok) return;
        detail.owners = res.json.owners || null;
        if (res.json.alert) detail.item = res.json.alert;
        const note = $('snq-image-note');
        const draft = note ? note.value : '';
        $('drawer-content').innerHTML = alertDetailHtml(detail.item, detail.owners, basePath());
        const again = $('snq-image-note');
        if (again && draft) again.value = draft;
    }

    async function submitImageAction(action) {
        const d = state.detail;
        if (!d || d.mode !== 'alert' || state.busy) return;
        const noteEl = $('snq-image-note');
        const built = buildImageAction(action, noteEl ? noteEl.value : '');
        if (built.error) {
            feedback('snq-image-feedback', 'error', built.error);
            if (noteEl && built.field === 'note') { noteEl.setAttribute('aria-invalid', 'true'); noteEl.focus(); }
            return;
        }
        if (noteEl) noteEl.removeAttribute('aria-invalid');
        state.busy = true;
        feedback('snq-image-feedback', 'info', 'Guardando…');
        const res = await repo().imageAlertAction(d.id, built.action, built.note);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) { feedback('snq-image-feedback', 'error', (res && res.json && res.json.error) || MSG.generic); return; }
        if (res.json.alert) d.item = res.json.alert;
        load();
        if (built.action === 'denuncia') {
            propose(res.json.prefill || { user_id: d.item.subject_user_id, reason_code: 'plagio_diseno' });
            return;
        }
        $('drawer-content').innerHTML = alertDetailHtml(d.item, d.owners, basePath());
        focusTitle();
        const ok = built.action === 'retirar'
            ? 'Foto retirada del portafolio.' + (res.json.email_sent ? ' Le avisamos por correo a quien la subió.' : ' El aviso por correo no salió: escríbele desde soporte.')
            : 'Alerta marcada como legítima.';
        const title = $('snq-detail-title');
        if (title) title.insertAdjacentHTML('afterend', '<p class="rpq-feedback is-success" role="status">' + esc(ok) + '</p>');
    }

    function feedback(id, kind, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'rpq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function markInvalid(field) {
        const map = { user_id: 'snq-user', kind: 'snq-kind', reason_code: 'snq-reason', summary: 'snq-summary', ticket_id: 'snq-ticket', ends_at: 'snq-ends' };
        Object.keys(map).forEach((k) => { const el = $(map[k]); if (el) el.removeAttribute('aria-invalid'); });
        const el = field && $(map[field]);
        if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    }

    async function submitSearch() {
        const box = $('snq-search-results');
        const q = ($('snq-search') && $('snq-search').value) || '';
        if (!box) return;
        box.innerHTML = '<li class="rpq-muted">' + MSG.loading + '</li>';
        const res = await repo().searchAccounts(q);
        box.innerHTML = res && res.ok ? searchResultsHtml(res.json.accounts) : '<li class="is-error" role="alert">' + esc((res && res.json && res.json.error) || MSG.generic) + '</li>';
    }

    async function submitPropose() {
        if (state.busy) return;
        const built = buildPropose({
            user_id: $('snq-user').value, kind: $('snq-kind').value, reason_code: $('snq-reason').value,
            summary: $('snq-summary').value, ticket_id: $('snq-ticket').value, ends_at: $('snq-ends') && $('snq-ends').value
        });
        if (built.error) { feedback('snq-feedback', 'error', built.error); markInvalid(built.field); return; }
        markInvalid(null);
        state.busy = true;
        feedback('snq-feedback', 'info', 'Guardando…');
        const res = await repo().propose(built.payload);
        state.busy = false;
        if (!res || !res.ok) {
            feedback('snq-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            if (res && res.json && res.json.field) markInvalid(res.json.field);
            return;
        }
        const s = res.json.sanction;
        state.view = res.json.applied ? 'active' : 'proposed';
        root.document.querySelectorAll('[data-snq-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snqView === state.view)));
        load();
        if (s && s.id) await openDetail(s.id);
    }

    async function runAction(formFeedbackId, action, okText) {
        const d = state.detail;
        if (!d || !d.item || state.busy) return;
        state.busy = true;
        feedback(formFeedbackId, 'info', 'Guardando…');
        const res = await action(d.item);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) { feedback(formFeedbackId, 'error', (res && res.json && res.json.error) || MSG.generic); return; }
        load();
        await openDetail(d.item.id);
        const el = $('snq-detail-title');
        if (el && okText) el.insertAdjacentHTML('afterend', '<p class="rpq-feedback is-success" role="status">' + esc(okText) + '</p>');
    }

    async function submitAlert() {
        const d = state.detail;
        if (!d || d.mode !== 'alert' || state.busy) return;
        const built = buildAlertUpdate($('snq-alert-status').value, $('snq-alert-resolution').value);
        if (built.error) { feedback('snq-alert-feedback', 'error', built.error); return; }
        state.busy = true;
        feedback('snq-alert-feedback', 'info', 'Guardando…');
        const res = await repo().updateAlert(d.id, built.payload);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) { feedback('snq-alert-feedback', 'error', (res && res.json && res.json.error) || MSG.generic); return; }
        d.item = res.json.alert;
        $('drawer-content').innerHTML = alertDetailHtml(d.item, d.owners, basePath());
        focusTitle();
        load();
    }

    function onDrawerSubmit(e) {
        if (!$('snq-detail')) return;
        const form = e.target;
        if (form.closest('[data-snq-search-form]')) { e.preventDefault(); submitSearch(); return; }
        if (form.closest('[data-snq-propose-form]')) { e.preventDefault(); submitPropose(); return; }
        if (form.closest('[data-snq-alert-form]')) { e.preventDefault(); submitAlert(); return; }
        if (form.closest('[data-snq-image-form]')) {
            e.preventDefault();
            const btn = e.submitter && e.submitter.dataset ? e.submitter : null;
            const action = (btn && btn.dataset.snqImageAction) || state.imageAction || '';
            state.imageAction = null;
            submitImageAction(action);
            return;
        }
        if (form.closest('[data-snq-confirm-form]')) {
            e.preventDefault();
            const n = buildNote($('snq-confirm-note').value, 0);
            if (n.error) { feedback('snq-confirm-feedback', 'error', n.error); return; }
            runAction('snq-confirm-feedback', (item) => repo().confirm(item.id, n.note), 'Sanción aplicada.');
            return;
        }
        if (form.closest('[data-snq-lift-form]')) {
            e.preventDefault();
            const n = buildNote($('snq-lift-note').value, NOTE_MIN);
            if (n.error) { feedback('snq-lift-feedback', 'error', n.error); return; }
            runAction('snq-lift-feedback', (item) => repo().lift(item.id, n.note), 'Listo.');
            return;
        }
        if (form.closest('[data-snq-appeal-form]')) {
            e.preventDefault();
            const picked = form.querySelector('input[name="snq-outcome"]:checked');
            const built = buildAppealDecision(picked ? picked.value : '', $('snq-appeal-note').value);
            if (built.error) { feedback('snq-appeal-feedback', 'error', built.error); return; }
            runAction('snq-appeal-feedback', (item) => repo().decideAppeal(item.id, built.outcome, built.note), 'Decisión guardada.');
        }
    }

    function onDrawerClick(e) {
        // Respaldo de e.submitter: recuerda qué botón de la alerta de imagen se tocó.
        const imageBtn = e.target && e.target.closest ? e.target.closest('[data-snq-image-action]') : null;
        if (imageBtn) { state.imageAction = imageBtn.dataset.snqImageAction; return; }
        const pick = e.target && e.target.closest ? e.target.closest('[data-snq-pick]') : null;
        if (!pick || !$('snq-user')) return;
        $('snq-user').value = pick.dataset.snqPick;
        $('snq-user').removeAttribute('aria-invalid');
        const kind = $('snq-kind');
        if (kind) kind.focus();
    }

    // ---------------- arranque ----------------

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

    // Contrato con DENUNCIAS: abre la pestaña con el formulario precargado.
    function propose(prefill) {
        const clean = cleanPrefill(prefill);
        if (active) { openPropose(clean); return true; }
        state.pendingPrefill = clean;
        // Un clic en la pestaña avisa a los demás módulos (cada uno cierra su panel).
        const btn = root.document.querySelector('.tab-btn[data-tab="' + TAB + '"]');
        if (btn && typeof btn.click === 'function') btn.click();
        else if (typeof root.switchTab === 'function') root.switchTab(TAB);
        return true;
    }

    function boot() {
        const doc = root.document;
        if (!doc || root.__snqBooted) return;
        root.__snqBooted = true;
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        root.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('submit', onDrawerSubmit);
            drawer.addEventListener('click', onDrawerClick);
        }
        const start = () => {
            openFromHash();
            // Contador de la pestaña (propuestas, apelaciones y alertas abiertas).
            root.setTimeout(async () => {
                const R = repo();
                if (state.loaded || !R || !(await R.hasSession())) return;
                const res = await R.list({ status: 'proposed' });
                if (res && res.ok && res.json.counts) setBadges(res.json.counts);
            }, 2800);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
        root.SupportSanctionsQueue = { refresh: load, open: openDetail, isActive: () => active, propose };
    }

    return { boot, _internal: pure };
}));
