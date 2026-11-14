// ============================================
// We Ötzi — Verificación del estudio (/studio/dashboard#verificacion)
//
// Figma de estudios 91wYIpURj0xn0kzqhybOOt · 05 Verificación del estudio:
//   E-VER-01 (2012:307)  Verificá tu estudio · datos para la revisión
//   E-VER-02 (2012:308)  Verificación en revisión
//   E-VER-02-DOCUMENTS (2014:5245) Documentación enviada
//   E-VER-03 (2012:309)  Necesitamos una corrección
//   E-VER-02-APPROVED (2014:5246) Tu estudio está verificado
// Más un bloque "Instagram del estudio" (código por email → DM a @weotzi).
//
// Datos:
//   GET  /api/studio/verification            estado, sedes, última solicitud
//   GET  /api/studio/verification/documents  URLs firmadas (10 min)
//   POST /api/studio/verification/instagram  código de Instagram
//   WeotziData.StudioVerification.upload / submit (bucket privado + RPC
//   submit_studio_verification, migración 20261115220000).
// Solo el dueño: para un manager la pestaña no existe (studio-dashboard.js
// quita los paneles que no son de manager).
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziStudioVerification = api;
        api.autoInit();
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'verificacion';
    const MAX_SPACE_FILES = 6;
    const KICKER = 'Verificación del estudio / Estudios';

    const REASONS = {
        name_match: 'Al registrarte encontramos un estudio con un nombre parecido.',
        instagram_match: 'Al registrarte encontramos otro estudio con el mismo Instagram.',
        owner_request: 'Pediste la verificación desde el panel.'
    };

    // ---------------------------------------------------------------
    // Helpers puros
    // ---------------------------------------------------------------
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtDate(value) {
        const d = value ? new Date(value) : null;
        if (!d || Number.isNaN(d.getTime())) return '';
        try { return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return d.toISOString().slice(0, 10); }
    }
    function safeHttpUrl(u) {
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : null;
    }
    function locationName(loc) {
        if (!loc) return '';
        return [loc.label || 'Sede', loc.city].filter(Boolean).join(' · ');
    }

    // Qué pantalla del Figma corresponde al estado.
    function viewFor(state) {
        const studio = (state && state.studio) || {};
        const request = (state && state.request) || null;
        if (studio.is_verified || studio.verification_status === 'verified') return 'approved';
        if (request && request.status === 'pending' && hasDocumentRequest(request)) return 'pending';
        if (request && request.status === 'rejected') return 'correction';
        return 'form';
    }
    // Solicitud con los datos del Figma (las abiertas por el registro, sin
    // documentos, todavía piden completar el formulario).
    function hasDocumentRequest(request) {
        return Boolean(request && request.legal_name && Array.isArray(request.documents) && request.documents.length);
    }
    function headingFor(view) {
        return {
            form: 'Verificá tu estudio',
            pending: 'Verificación en revisión',
            correction: 'Necesitamos una corrección',
            approved: 'Tu estudio está verificado'
        }[view] || 'Verificá tu estudio';
    }
    function selectedLocation(state) {
        const locations = (state && state.locations) || [];
        const request = (state && state.request) || {};
        return locations.find(l => l.id === request.location_id)
            || locations.find(l => l.is_primary) || locations[0] || null;
    }
    function subtitleFor(state) {
        const studio = (state && state.studio) || {};
        const loc = selectedLocation(state);
        return [studio.name || 'Tu estudio', loc && (loc.label || loc.city)].filter(Boolean).join(' · ');
    }
    function docsByKind(request, kind) {
        return ((request && request.documents) || []).filter(d => d.kind === kind);
    }

    // Validación del formulario (también la repite la RPC).
    function validateForm(values) {
        const v = values || {};
        const len = s => String(s || '').trim().length;
        if (len(v.legal_name) < 2) return { field: 'sv-legal', error: 'Escribí el nombre legal o comercial del estudio.' };
        if (len(v.responsible_name) < 2) return { field: 'sv-resp', error: 'Escribí el nombre del responsable del estudio.' };
        if (len(v.responsible_role) < 2) return { field: 'sv-role', error: 'Contanos el cargo del responsable.' };
        if (len(v.responsible_contact) < 5) return { field: 'sv-contact', error: 'Dejanos un email o teléfono del responsable.' };
        if (!v.location_id) return { field: 'sv-location', error: 'Elegí la sede a verificar.' };
        if (!v.hasRepresentation) return { field: 'sv-rep-file', error: 'Subí el documento que acredita la representación del estudio.' };
        if (!v.hasSpace) return { field: 'sv-space-file', error: 'Subí al menos una foto del espacio.' };
        if (len(v.note) > 2000) return { field: 'sv-note', error: 'El comentario admite hasta 2000 caracteres.' };
        return null;
    }

    // ---------------------------------------------------------------
    // Render (HTML puro: lo prueban los tests)
    // ---------------------------------------------------------------
    function row(title, meta) {
        return '<li class="sv-row"><strong>' + esc(title) + '</strong>' + (meta ? '<span>' + esc(meta) + '</span>' : '') + '</li>';
    }
    function aside(title, text) {
        return '<aside class="studio-context sv-context"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></aside>';
    }
    function header(state, view) {
        return '<header class="sv-head">'
            + '<p class="sv-kicker">' + esc(KICKER) + '</p>'
            + '<h2 class="studio-h1 sv-title" id="sv-title" tabindex="-1">' + esc(headingFor(view)) + '</h2>'
            + '<p class="sv-sub">' + esc(subtitleFor(state)) + '</p>'
            + (view === 'approved' ? '<span class="sv-tag">Confirmado</span>' : '')
            + '</header>';
    }

    function requiredAlertHtml(state) {
        const studio = (state && state.studio) || {};
        const request = (state && state.request) || {};
        if (!studio.verification_required || studio.is_verified) return '';
        const reasons = (request.reasons || []).filter(r => REASONS[r] && r !== 'owner_request');
        return '<div class="sv-alert" role="note"><strong>Verificación adicional requerida</strong>'
            + '<p>Tu estudio se parece a otro que ya está en We Ötzi. Mandanos los datos y los documentos para confirmar que es un estudio distinto y que la sede es propia.</p>'
            + (reasons.length ? '<ul>' + reasons.map(r => '<li>' + esc(REASONS[r]) + '</li>').join('') + '</ul>' : '')
            + '</div>';
    }

    function fileListHtml(files, kind) {
        if (!files.length) return '';
        return '<ul class="sv-files" data-sv-files="' + kind + '">' + files.map((f, i) => '<li>'
            + '<span class="sv-file-name">' + esc(f.name || 'archivo') + '</span>'
            + '<span class="sv-file-meta">' + esc(f.uploaded ? 'Enviado' : 'Listo para enviar') + '</span>'
            + '<button type="button" class="sv-file-remove" data-sv-remove="' + kind + ':' + i + '" aria-label="Quitar ' + esc(f.name || 'archivo') + '">Quitar</button>'
            + '</li>').join('') + '</ul>';
    }

    function formHtml(state, draft, opts) {
        const o = opts || {};
        const request = (state && state.request) || {};
        const d = draft || {};
        const locations = (state && state.locations) || [];
        const loc = d.location_id || (selectedLocation(state) || {}).id || '';
        const val = (key, fallback) => esc(d[key] != null ? d[key] : (fallback || ''));
        const locationOptions = locations.length
            ? '<option value="">Elegí una sede</option>' + locations.map(l => '<option value="' + esc(l.id) + '"' + (l.id === loc ? ' selected' : '') + '>'
                + esc(locationName(l) + (l.is_primary ? ' (principal)' : '')) + '</option>').join('')
            : '<option value="">Primero cargá una sede</option>';
        const rep = (d.files && d.files.representation) || [];
        const space = (d.files && d.files.space) || [];
        return '<form class="sv-form" data-sv-form novalidate aria-describedby="sv-form-help">'
            + '<h3 class="studio-h2 sv-section-title">' + esc(o.title || 'Datos para la revisión') + '</h3>'
            + (o.correctionNote ? '<div class="sv-observed" role="note"><p class="sv-label-mono">Documento o dato observado</p><p>' + esc(o.correctionNote) + '</p></div>' : '')
            + '<p class="studio-help" id="sv-form-help">Todos los campos son obligatorios salvo el comentario. Los documentos solo los ve el equipo de soporte de We Ötzi.</p>'
            + '<div class="sv-grid">'
            + field('sv-legal', 'Nombre legal o comercial', '<input id="sv-legal" name="legal_name" class="wo-input" maxlength="160" autocomplete="organization" required value="' + val('legal_name', request.legal_name || (state.studio && state.studio.name)) + '">')
            + field('sv-resp', 'Responsable del estudio', '<input id="sv-resp" name="responsible_name" class="wo-input" maxlength="160" autocomplete="name" required value="' + val('responsible_name', request.responsible_name) + '">')
            + field('sv-role', 'Cargo del responsable', '<input id="sv-role" name="responsible_role" class="wo-input" maxlength="120" required placeholder="Ej. Propietaria" value="' + val('responsible_role', request.responsible_role) + '">')
            + field('sv-contact', 'Email/teléfono del responsable', '<input id="sv-contact" name="responsible_contact" class="wo-input" maxlength="160" autocomplete="email" required value="' + val('responsible_contact', request.responsible_contact) + '">')
            + field('sv-location', 'Sede a verificar', '<select id="sv-location" name="location_id" class="wo-input wo-select" required' + (locations.length ? '' : ' disabled') + '>' + locationOptions + '</select>'
                + (locations.length ? '' : '<span class="studio-help">Agregá una sede en <a href="#sedes">Sedes</a> para poder verificarla.</span>'))
            + field('sv-rep-file', 'Documento que acredita representación',
                '<label class="sv-file" for="sv-rep-file"><span data-wo-icon="file-text" aria-hidden="true"></span><span>Seleccionar archivo</span></label>'
                + '<input id="sv-rep-file" class="sv-file-input" type="file" data-sv-kind="representation" accept="application/pdf,image/jpeg,image/png,image/webp">'
                + '<span class="sv-hint">PDF, JPG, PNG o WEBP · hasta 10 MB. Habilitación, contrato o poder a nombre del responsable.</span>'
                + fileListHtml(rep, 'representation'))
            + field('sv-space-file', 'Evidencia del espacio',
                '<label class="sv-file" for="sv-space-file"><span data-wo-icon="image" aria-hidden="true"></span><span>Seleccionar imágenes</span></label>'
                + '<input id="sv-space-file" class="sv-file-input" type="file" multiple data-sv-kind="space" accept="image/jpeg,image/png,image/webp">'
                + '<span class="sv-hint">Hasta ' + MAX_SPACE_FILES + ' fotos de la fachada, el cartel y las estaciones de trabajo.</span>'
                + fileListHtml(space, 'space'))
            + '<div class="sv-field sv-field--full">'
            + '<label class="sv-label-mono" for="sv-note">Comentario para soporte (opcional)</label>'
            + '<textarea id="sv-note" name="note" class="wo-textarea" rows="3" maxlength="2000">' + val('note', request.note) + '</textarea>'
            + '</div>'
            + '</div>'
            + '<p class="sv-error" id="sv-form-error" role="alert" hidden></p>'
            + '<div class="sv-actions">'
            + '<button type="submit" class="wo-btn wo-btn--primary">' + esc(o.submitLabel || 'Enviar a revisión') + '</button>'
            + (o.cancelLabel ? '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="cancel-edit">' + esc(o.cancelLabel) + '</button>' : '')
            + '</div></form>';
    }
    function field(id, label, control) {
        return '<div class="sv-field"><label class="sv-label-mono" for="' + id + '">' + esc(label) + '</label>' + control + '</div>';
    }

    function documentsListHtml(docs) {
        if (!docs) return '';
        if (!docs.length) return '<p class="studio-help">Todavía no hay archivos en tu solicitud.</p>';
        return '<ul class="sv-rows sv-doc-links">' + docs.map(d => {
            const url = safeHttpUrl(d.url);
            const title = d.kind === 'space' ? 'Espacio de trabajo' : 'Representación del estudio';
            const name = esc(d.name || 'archivo');
            return '<li class="sv-row"><strong>' + esc(title) + '</strong><span>'
                + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + name + '</a>' : name)
                + ' · Recibido</span></li>';
        }).join('') + '</ul>';
    }

    function pendingHtml(state, docs) {
        const request = state.request || {};
        const loc = selectedLocation(state);
        const rep = docsByKind(request, 'representation');
        const space = docsByKind(request, 'space');
        return '<h3 class="studio-h2 sv-section-title">' + (docs ? 'Documentación enviada' : 'Tu solicitud') + '</h3>'
            + '<ul class="sv-rows">'
            + row(docs ? [request.legal_name, loc && loc.label].filter(Boolean).join(' · ') : 'Solicitud recibida',
                docs ? 'Solicitud enviada el ' + fmtDate(request.created_at) : [request.legal_name || (state.studio && state.studio.name), locationName(loc)].filter(Boolean).join(' · '))
            + (docs ? '' : row('Representación del estudio', rep.length ? 'Documento recibido' : 'Sin documento'))
            + (docs ? '' : row('Espacio de trabajo', space.length === 1 ? '1 foto recibida' : space.length + ' fotos recibidas'))
            + (docs ? '' : row('Responsable', [request.responsible_name, request.responsible_role].filter(Boolean).join(' · ')))
            + row('Estado actual', 'En revisión')
            + '</ul>'
            + (docs ? documentsListHtml(docs) : '')
            + '<div class="sv-actions">'
            + (docs
                ? '<button type="button" class="wo-btn wo-btn--primary" data-sv-action="refresh">Revisar estado</button>'
                    + '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="hide-docs">Atrás</button>'
                : '<button type="button" class="wo-btn wo-btn--primary" data-sv-action="show-docs">Ver documentación</button>'
                    + '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="support">Contactar soporte</button>'
                    + '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="refresh">Revisar estado</button>'
                    + '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="edit">Corregir datos</button>')
            + '</div>';
    }

    function approvedHtml(state, docs) {
        const studio = state.studio || {};
        const request = state.request || {};
        const loc = selectedLocation(state);
        const name = [studio.name, loc && (loc.label || loc.city)].filter(Boolean).join(' · ');
        const profileRef = studio.slug || studio.id;
        return '<h3 class="studio-h2 sv-section-title">' + esc(name || 'Tu estudio') + '</h3>'
            + '<ul class="sv-rows">'
            + row('Estado', 'Verificado')
            + (request.responsible_name ? row('Responsable', request.responsible_name) : '')
            + (loc && request.location_id ? row('Sede revisada', locationName(loc)) : '')
            + row('Fecha de revisión', fmtDate(studio.verified_at || request.decided_at) || '—')
            + '</ul>'
            + (docs ? documentsListHtml(docs) : '')
            + '<div class="sv-actions">'
            + (profileRef ? '<a class="wo-btn wo-btn--primary" href="/studio/profile?studio=' + encodeURIComponent(profileRef) + '" target="_blank" rel="noopener">Ver perfil público</a>' : '')
            + (hasDocumentRequest(request) && !docs ? '<button type="button" class="wo-btn wo-btn--secondary" data-sv-action="show-docs">Ver documentación</button>' : '')
            + '<a class="wo-btn wo-btn--secondary" href="#resumen">Volver al panel</a>'
            + '</div>';
    }

    function instagramHtml(state) {
        const studio = (state && state.studio) || {};
        const ig = (state && state.instagram) || {};
        const handle = ig.handle || String(studio.instagram || '').replace(/^@+/, '');
        const dm = safeHttpUrl(state && state.instructions && state.instructions.dm_url) || 'https://ig.me/m/weotzi';
        let body;
        if (ig.status === 'verified') {
            body = '<p><span class="sv-tag sv-tag--ok">Validado</span> La cuenta <strong>@' + esc(studio.instagram_verified_handle || handle) + '</strong> es del estudio.</p>';
        } else if (!handle) {
            body = '<p class="studio-help">Cargá el Instagram del estudio en <a href="#perfil">Perfil</a> para validarlo.</p>';
        } else {
            const pending = ig.status === 'pending'
                ? '<div class="sv-steps"><p><strong>Te mandamos un código</strong>' + (ig.email_masked ? ' a ' + esc(ig.email_masked) : '') + (ig.expires_at ? ' (vence el ' + esc(fmtDate(ig.expires_at)) + ')' : '') + '.</p>'
                    + '<ol><li>Abrí Instagram con la cuenta <strong>@' + esc(handle) + '</strong>.</li><li>Mandá el código por mensaje directo a <strong>@weotzi</strong>.</li><li>Lo validamos automáticamente.</li></ol>'
                    + '<a class="wo-btn wo-btn--secondary" href="' + esc(dm) + '" target="_blank" rel="noopener noreferrer">Abrir el chat con @weotzi</a></div>'
                : '';
            body = '<p>Validá que <strong>@' + esc(handle) + '</strong> es la cuenta del estudio. Soporte también puede confirmarla al revisar tu solicitud.</p>'
                + pending
                + '<div class="sv-actions"><button type="button" class="wo-btn wo-btn--secondary" data-sv-action="ig-code">' + (pending ? 'Enviar un código nuevo' : 'Enviar código a mi email') + '</button></div>';
        }
        return '<section class="sv-ig" aria-labelledby="sv-ig-title"><h3 class="studio-h2 sv-section-title" id="sv-ig-title">Instagram del estudio</h3>' + body + '</section>';
    }

    // HTML completo del panel según la vista. `ui`: { editing, docs, draft }.
    function panelHtml(state, ui) {
        const u = ui || {};
        let view = viewFor(state);
        if (u.editing && view === 'pending') view = 'form';
        let main;
        let side;
        if (view === 'approved') {
            main = approvedHtml(state, u.docs);
            side = aside('Información para vos', 'La insignia corresponde a la información y a la sede revisadas. Si cambia el responsable o la ubicación, actualizá los datos del estudio.');
        } else if (view === 'pending') {
            main = pendingHtml(state, u.docs);
            side = u.docs
                ? aside('Información para vos', 'Podés consultar los archivos de tu solicitud. Si necesitamos una corrección, te indicaremos qué documento actualizar.')
                : aside('Estamos revisando tu solicitud', 'Te avisaremos por email si necesitamos información adicional. Mientras tanto podés seguir configurando el estudio.');
        } else if (view === 'correction') {
            const note = (state.request && state.request.decision_note) || 'Revisá los datos y los documentos de tu solicitud.';
            main = formHtml(state, u.draft, { title: 'Documento observado', correctionNote: note, submitLabel: 'Reenviar documentación' });
            side = aside('Revisá lo que te pedimos', 'El nombre del responsable y el documento completo deben verse con claridad. Podés conservar los archivos que no te observamos.');
        } else {
            const editingPending = u.editing && state.request && state.request.status === 'pending';
            main = requiredAlertHtml(state) + formHtml(state, u.draft, editingPending ? { submitLabel: 'Actualizar la solicitud', cancelLabel: 'Atrás' } : {});
            side = aside('Una referencia para tu comunidad', 'Revisaremos los datos enviados antes de mostrar la verificación en el perfil. Te avisaremos si necesitamos una corrección.');
        }
        return header(state, view)
            + '<div class="studio-panel-grid sv-grid-layout"><div class="studio-panel-content sv-main">' + main + instagramHtml(state) + '</div>' + side + '</div>';
    }

    // ---------------------------------------------------------------
    // Navegador
    // ---------------------------------------------------------------
    const ui = { state: null, editing: false, docs: null, draft: null, loading: false, mounted: false };

    function panel() { return root.document && root.document.querySelector('.studio-dash-panel[data-panel="' + TAB + '"]'); }
    function mount() { const p = panel(); return p && p.querySelector('[data-sv-root]'); }
    function statusEl() { const p = panel(); return p && p.querySelector('[data-sv-status]'); }

    function setStatus(kind, text) {
        const el = statusEl();
        if (!el) return;
        if (!text) { el.hidden = true; el.textContent = ''; return; }
        el.className = 'studio-status studio-status-' + kind;
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text;
        el.hidden = false;
    }

    async function token() {
        try {
            const client = root.WeOtziStudioAuth.getSupabase();
            const { data } = await client.auth.getSession();
            return (data && data.session && data.session.access_token) || null;
        } catch (_) { return null; }
    }
    async function api(path, opts) {
        const o = opts || {};
        const headers = { 'Content-Type': 'application/json' };
        const bearer = await token();
        if (bearer) headers.Authorization = 'Bearer ' + bearer;
        const appUrl = root.WeOtziStudioAuth && root.WeOtziStudioAuth.appUrl ? root.WeOtziStudioAuth.appUrl : (p => p);
        try {
            const res = await root.fetch(appUrl(path), { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
            const data = await res.json().catch(() => ({}));
            return { ok: res.ok && data.success !== false, status: res.status, data };
        } catch (_) {
            return { ok: false, status: 0, data: { error: 'No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.' } };
        }
    }

    function hydrateIcons(el) {
        if (root.WoIcons && typeof root.WoIcons.hydrate === 'function') root.WoIcons.hydrate(el);
    }

    function render() {
        const el = mount();
        if (!el || !ui.state) return;
        el.innerHTML = panelHtml(ui.state, ui);
        hydrateIcons(el);
    }

    function seedDraft() {
        const request = (ui.state && ui.state.request) || {};
        const existing = Array.isArray(request.documents) ? request.documents : [];
        ui.draft = {
            files: {
                representation: existing.filter(d => d.kind === 'representation' && d.path).map(d => ({ ...d, uploaded: true })),
                space: existing.filter(d => d.kind === 'space' && d.path).map(d => ({ ...d, uploaded: true }))
            }
        };
    }

    async function load({ keepStatus } = {}) {
        const el = mount();
        if (!el || ui.loading) return;
        ui.loading = true;
        if (!keepStatus) setStatus(null, '');
        if (!ui.state) el.innerHTML = '<p class="studio-help" role="status">Cargando la verificación…</p>';
        const res = await api('/api/studio/verification');
        ui.loading = false;
        if (res.status === 503) {
            el.innerHTML = '<p class="studio-status studio-status-info">La verificación de estudios se habilita pronto.</p>';
            return;
        }
        if (!res.ok) {
            el.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + esc((res.data && res.data.error) || 'No pudimos cargar la verificación. Recargá la página para intentar de nuevo.') + '</p>'
                + '<div class="sv-actions"><button type="button" class="wo-btn wo-btn--secondary" data-sv-action="refresh">Reintentar</button></div>';
            return;
        }
        ui.state = res.data;
        ui.docs = null;
        ui.editing = false;
        seedDraft();
        render();
    }

    // Lee los valores del formulario al draft (para no perderlos al re-render).
    function readForm(form) {
        const get = name => { const input = form.querySelector('[name="' + name + '"]'); return input ? input.value : ''; };
        Object.assign(ui.draft, {
            legal_name: get('legal_name'),
            responsible_name: get('responsible_name'),
            responsible_role: get('responsible_role'),
            responsible_contact: get('responsible_contact'),
            location_id: get('location_id'),
            note: get('note')
        });
    }

    function showFormError(form, problem) {
        const el = form.querySelector('#sv-form-error');
        if (el) { el.textContent = problem.error; el.hidden = false; }
        const input = problem.field && form.querySelector('#' + problem.field);
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }
    }

    async function onFiles(input) {
        const form = input.closest('[data-sv-form]');
        const kind = input.dataset.svKind;
        const repo = root.WeotziData && root.WeotziData.StudioVerification;
        const files = Array.from(input.files || []);
        if (!form || !repo || !files.length) return;
        readForm(form);
        const list = ui.draft.files[kind];
        const room = kind === 'space' ? MAX_SPACE_FILES - list.length : 3 - list.length;
        if (room <= 0) {
            showFormError(form, { field: input.id, error: kind === 'space' ? 'Ya sumaste ' + MAX_SPACE_FILES + ' fotos. Quitá alguna para agregar otra.' : 'Quitá el documento anterior para subir otro.' });
            input.value = '';
            return;
        }
        for (const file of files.slice(0, room)) {
            const problem = repo.validate(file, kind);
            if (problem) { showFormError(form, { field: input.id, error: problem + ' (' + file.name + ')' }); input.value = ''; return; }
        }
        input.disabled = true;
        setStatus('info', 'Subiendo ' + (files.length > 1 ? 'archivos' : 'archivo') + '…');
        try {
            for (const file of files.slice(0, room)) {
                const doc = await repo.upload(file, { studioId: ui.state.studio.id, kind });
                list.push({ ...doc, uploaded: false });
            }
            setStatus('success', files.length > room ? 'Subimos los primeros ' + room + ' archivos.' : 'Archivo listo para enviar.');
        } catch (error) {
            setStatus('error', error.message || 'No pudimos subir el archivo.');
        }
        render();
        const again = mount() && mount().querySelector('#' + input.id);
        if (again) again.focus();
    }

    async function onSubmit(form) {
        readForm(form);
        const d = ui.draft;
        const values = {
            ...d,
            hasRepresentation: d.files.representation.length > 0,
            hasSpace: d.files.space.length > 0
        };
        form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
        const problem = validateForm(values);
        if (problem) { showFormError(form, problem); return; }
        const repo = root.WeotziData && root.WeotziData.StudioVerification;
        if (!repo) { showFormError(form, { error: 'No pudimos cargar la verificación. Recargá la página.' }); return; }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        const documents = d.files.representation.concat(d.files.space)
            .map(f => ({ kind: f.kind, path: f.path, name: f.name, mime: f.mime || '', size: f.size || null }));
        const { error } = await repo.submit(ui.state.studio.id, {
            legal_name: d.legal_name.trim(),
            responsible_name: d.responsible_name.trim(),
            responsible_role: d.responsible_role.trim(),
            responsible_contact: d.responsible_contact.trim(),
            location_id: d.location_id,
            note: (d.note || '').trim(),
            documents
        });
        if (error) {
            submit.disabled = false;
            submit.removeAttribute('aria-busy');
            showFormError(form, { error: error.message || 'No pudimos enviar la solicitud. Probá de nuevo.' });
            return;
        }
        setStatus('success', 'Enviamos tu solicitud a soporte. Te avisamos por email cuando la revisemos.');
        await load({ keepStatus: true });
        const title = mount() && mount().querySelector('#sv-title');
        if (title) title.focus();
    }

    async function onAction(button) {
        const action = button.dataset.svAction;
        if (action === 'refresh') return load();
        if (action === 'edit') { ui.editing = true; seedDraft(); render(); return; }
        if (action === 'cancel-edit') { ui.editing = false; render(); return; }
        if (action === 'hide-docs') { ui.docs = null; render(); return; }
        if (action === 'support') {
            if (root.SupportChat && typeof root.SupportChat.openPanel === 'function') root.SupportChat.openPanel();
            else root.open('https://weotzi.com/faqs/', '_blank', 'noopener');
            return;
        }
        if (action === 'show-docs') {
            button.disabled = true;
            const res = await api('/api/studio/verification/documents');
            button.disabled = false;
            if (!res.ok) { setStatus('error', (res.data && res.data.error) || 'No pudimos abrir los documentos.'); return; }
            ui.docs = res.data.documents || [];
            render();
            return;
        }
        if (action === 'ig-code') {
            button.disabled = true;
            const label = button.textContent;
            button.textContent = 'Enviando código…';
            const res = await api('/api/studio/verification/instagram', { method: 'POST', body: {} });
            if (res.ok) {
                setStatus(res.data.email_sent === false ? 'error' : 'success', res.data.email_sent === false
                    ? 'Generamos el código pero no pudimos mandar el email. Probá de nuevo en un rato.'
                    : 'Te mandamos el código a ' + (res.data.email_masked || 'tu email') + '.');
                await load({ keepStatus: true });
            } else {
                setStatus('error', (res.data && res.data.error) || 'No pudimos enviar el código. Probá de nuevo en un rato.');
                button.disabled = false;
                button.textContent = label;
            }
        }
    }

    function wire(el) {
        el.addEventListener('click', event => {
            const remove = event.target.closest('[data-sv-remove]');
            if (remove) {
                const form = remove.closest('[data-sv-form]');
                if (form) readForm(form);
                const [kind, index] = remove.dataset.svRemove.split(':');
                const list = ui.draft && ui.draft.files[kind];
                if (list) list.splice(Number(index), 1);
                render();
                return;
            }
            const button = event.target.closest('[data-sv-action]');
            if (button) { event.preventDefault(); onAction(button); }
        });
        el.addEventListener('change', event => {
            const input = event.target.closest('.sv-file-input');
            if (input) onFiles(input);
        });
        el.addEventListener('submit', event => {
            const form = event.target.closest('[data-sv-form]');
            if (!form) return;
            event.preventDefault();
            onSubmit(form);
        });
    }

    async function init() {
        const auth = root.WeOtziStudioAuth;
        const el = mount();
        if (!auth || !el || ui.mounted) return;
        await auth.ready();
        const studio = auth.getCurrent() || await auth.check();
        if (!studio || studio.access === 'manager' || !mount()) return;
        ui.mounted = true;
        wire(el);
        const active = () => (root.location.hash || '').slice(1) === TAB;
        root.addEventListener('studio:tabchange', event => {
            if (event.detail && event.detail.tab === TAB && !ui.state) load();
        });
        if (active()) load();
    }

    function autoInit() {
        if (!root.document) return;
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
        else init();
    }

    return {
        autoInit,
        viewFor,
        headingFor,
        subtitleFor,
        validateForm,
        panelHtml,
        formHtml,
        instagramHtml,
        requiredAlertHtml,
        documentsListHtml,
        hasDocumentRequest,
        _ui: ui
    };
});
