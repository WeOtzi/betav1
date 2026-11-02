// ============================================
// We Ötzi — Verificación del estudio (pestaña "verificacion")
//
// Revisión "Estudios v1" (nov 2026). Tres bloques:
//   - Estado: verificado / en revisión / sin verificar / no aprobada, y el
//     aviso de verificación adicional cuando el registro coincidió con otro
//     estudio (studios.verification_required).
//   - Instagram: código WO-XXXXXX al email del dueño para mandarlo por DM a
//     @weotzi desde la cuenta del estudio (POST /api/studio/verification/instagram).
//     Las fotos importadas de Instagram se muestran cuando la cuenta queda validada.
//   - Información para soporte: evidencia, contacto y enlaces
//     (WeotziData.Studios.requestVerification → request_studio_verification).
// Estado completo: GET /api/studio/verification (services/studio-verification.js).
// Sin la migración 20261102120000 el servidor responde 503 y la pestaña lo avisa.
// ============================================

(function () {
    'use strict';

    const TAB = 'verificacion';
    const STATUS = {
        verified: { label: 'Verificado', tone: 'success', text: 'Soporte de We Ötzi verificó tu estudio. El sello aparece en tu perfil público.' },
        pending: { label: 'En revisión', tone: 'info', text: 'Soporte está revisando la información de tu estudio. Te avisamos por email cuando termine.' },
        rejected: { label: 'No aprobada', tone: 'danger', text: 'Soporte no pudo verificar tu estudio con la información enviada. Podés sumar más datos y volver a enviarla.' },
        unverified: { label: 'Sin verificar', tone: 'neutral', text: 'Verificá tu estudio para mostrar el sello en tu perfil y en el mapa.' }
    };
    const REASONS = {
        name_match: 'Al registrarte encontramos un estudio con un nombre parecido.',
        instagram_match: 'Al registrarte encontramos otro estudio con el mismo Instagram.',
        owner_request: 'Pediste la verificación desde el panel.'
    };

    function kit() { return window.WeOtziStudioKit; }
    function esc(v) { return kit().escapeHtml(v); }

    async function token(ctx) {
        try {
            const { data } = await ctx.client.auth.getSession();
            return data?.session?.access_token || null;
        } catch (_) { return null; }
    }
    async function api(ctx, path, opts = {}) {
        const headers = { 'Content-Type': 'application/json' };
        const bearer = await token(ctx);
        if (bearer) headers.Authorization = 'Bearer ' + bearer;
        const res = await fetch(window.WeOtziStudioAuth.appUrl(path), { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, status: res.status, data };
    }

    function linksFrom(text) {
        return String(text || '').split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean);
    }
    function validLink(s) { return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s) && s.length <= 500; }

    // Puro: HTML del estado (tests/studio-dashboard-verification.test.js).
    function statusCardHtml(state) {
        const studio = state?.studio || {};
        const request = state?.request || null;
        const key = STATUS[studio.verification_status] ? studio.verification_status : (studio.is_verified ? 'verified' : 'unverified');
        const info = STATUS[key];
        const reasons = (request?.reasons || []).filter(r => REASONS[r]).map(r => '<li>' + esc(REASONS[r]) + '</li>').join('');
        const note = key === 'rejected' && request?.decision_note
            ? '<p class="sv-note"><strong>Motivo de soporte:</strong> ' + esc(request.decision_note) + '</p>' : '';
        const extra = studio.verification_required && key !== 'verified'
            ? '<div class="sv-alert" role="note"><strong>Verificación adicional</strong><p>Tu estudio se parece a otro que ya está en We Ötzi. Mandanos la información de abajo para confirmar que es un estudio distinto y que sus sedes son propias.</p></div>' : '';
        return '<div class="sv-status sv-status--' + key + '">'
            + '<div class="sv-status-head">' + kit().badge(info.label, info.tone) + '</div>'
            + '<p>' + esc(info.text) + '</p>'
            + (reasons ? '<ul class="sv-reasons">' + reasons + '</ul>' : '')
            + (request?.created_at ? '<p class="wo-help">Solicitud del ' + esc(kit().fmtDate(request.created_at)) + (request.decided_at ? ' · resuelta el ' + esc(kit().fmtDate(request.decided_at)) : '') + '</p>' : '')
            + note + '</div>' + extra;
    }
    function instagramHtml(state) {
        const studio = state?.studio || {};
        const ig = state?.instagram || {};
        const handle = ig.handle || String(studio.instagram || '').replace(/^@+/, '');
        const dm = state?.instructions?.dm_url || 'https://ig.me/m/weotzi';
        if (ig.status === 'verified' || studio.instagram_verified_at) {
            return '<p>' + kit().badge('Validado', 'success') + ' La cuenta <strong>@' + esc(studio.instagram_verified_handle || handle) + '</strong> es del estudio. Las fotos importadas de Instagram ya se muestran en tu perfil.</p>';
        }
        if (!handle) {
            return '<p class="wo-help">Cargá el Instagram del estudio en <a href="#perfil">Perfil</a> para validarlo.</p>';
        }
        const pending = ig.status === 'pending'
            ? '<div class="sv-steps"><p><strong>Te mandamos un código</strong>' + (ig.email_masked ? ' a ' + esc(ig.email_masked) : '') + (ig.expires_at ? ' (vence el ' + esc(kit().fmtDate(ig.expires_at)) + ')' : '') + '.</p>'
                + '<ol><li>Abrí Instagram con la cuenta <strong>@' + esc(handle) + '</strong>.</li><li>Mandá el código por mensaje directo a <strong>@weotzi</strong>.</li><li>Lo validamos automáticamente y te avisamos.</li></ol>'
                + '<a class="wo-btn wo-btn--secondary" href="' + esc(dm) + '" target="_blank" rel="noopener noreferrer">Abrir el chat con @weotzi</a></div>'
            : '';
        return '<p>Validá que <strong>@' + esc(handle) + '</strong> es la cuenta del estudio. Hasta entonces, las fotos importadas de Instagram no se muestran a los clientes.</p>'
            + pending
            + '<div class="studio-actions"><button type="button" class="wo-btn' + (pending ? ' wo-btn--secondary' : '') + '" data-sv-action="ig-code">' + (pending ? 'Enviar un código nuevo' : 'Enviar código a mi email') + '</button></div>';
    }
    function formHtml(state) {
        const studio = state?.studio || {};
        const request = state?.request || {};
        if (studio.verification_status === 'verified' || studio.is_verified) return '';
        const editing = request.status === 'pending' && request.evidence;
        return '<form class="sv-form" data-sv-form novalidate>'
            + '<div class="studio-form-grid">'
            + '<div class="wo-field studio-form-full"><label class="wo-label" for="sv-evidence">¿Cómo verificamos tu estudio?</label>'
            + '<textarea id="sv-evidence" class="wo-textarea" rows="5" maxlength="2000" required placeholder="Ej. Habilitación municipal N° 1234 a nombre del estudio, CUIT, o una foto de la fachada con el cartel. Contanos también tu rol en el estudio.">' + esc(request.evidence || '') + '</textarea>'
            + '<span class="wo-help">Mínimo 10 caracteres. Soporte puede pedirte más datos por email.</span></div>'
            + '<div class="wo-field"><label class="wo-label" for="sv-contact-name">Nombre de contacto</label><input id="sv-contact-name" class="wo-input" maxlength="160" autocomplete="name" value="' + kit().escapeAttr(request.contact_name || '') + '"></div>'
            + '<div class="wo-field"><label class="wo-label" for="sv-contact-phone">Teléfono de contacto</label><input id="sv-contact-phone" class="wo-input" type="tel" maxlength="40" autocomplete="tel" value="' + kit().escapeAttr(request.contact_phone || '') + '"></div>'
            + '<div class="wo-field studio-form-full"><label class="wo-label" for="sv-links">Enlaces (uno por línea, hasta 5)</label>'
            + '<textarea id="sv-links" class="wo-textarea" rows="3" placeholder="https://www.instagram.com/tuestudio&#10;https://tuestudio.com">' + esc((request.links || []).join('\n')) + '</textarea>'
            + '<span class="wo-help">Sitio web, Google Maps, redes o notas de prensa del estudio.</span></div>'
            + '</div><div class="studio-actions"><button type="submit" class="wo-btn">' + (editing ? 'Actualizar la información' : 'Enviar a verificación') + '</button></div></form>';
    }

    function render(root, state) {
        root.innerHTML = '<section class="sv-block" aria-labelledby="sv-status-title"><h3 class="studio-h2" id="sv-status-title">Estado</h3>' + statusCardHtml(state) + '</section>'
            + '<section class="sv-block" aria-labelledby="sv-ig-title"><h3 class="studio-h2" id="sv-ig-title">Instagram del estudio</h3>' + instagramHtml(state) + '</section>'
            + (formHtml(state) ? '<section class="sv-block" aria-labelledby="sv-form-title"><h3 class="studio-h2" id="sv-form-title">Información para soporte</h3>' + formHtml(state) + '</section>' : '');
    }

    async function load(root, ctx) {
        root.innerHTML = '<p class="wo-help" role="status">Cargando la verificación…</p>';
        const res = await api(ctx, '/api/studio/verification');
        if (res.status === 503) {
            root.innerHTML = '<p class="studio-status studio-status-info">La verificación de estudios se habilita pronto.</p>';
            return null;
        }
        if (!res.ok) {
            root.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + esc(res.data?.error || 'No pudimos cargar la verificación. Recargá la página para intentar de nuevo.') + '</p>';
            return null;
        }
        render(root, res.data);
        return res.data;
    }

    function wire(root, ctx) {
        root.addEventListener('click', async event => {
            const button = event.target.closest('[data-sv-action="ig-code"]');
            if (!button) return;
            button.disabled = true;
            const label = button.textContent;
            button.textContent = 'Enviando código…';
            const res = await api(ctx, '/api/studio/verification/instagram', { method: 'POST', body: {} });
            if (res.ok) {
                kit().toast(res.data.email_sent === false ? 'Generamos el código pero no pudimos mandar el email. Probá de nuevo en un rato.' : 'Te mandamos el código a ' + (res.data.email_masked || 'tu email') + '.', res.data.email_sent === false ? 'warning' : 'success');
                await load(root, ctx);
            } else {
                kit().toast(res.data?.error || 'No pudimos enviar el código. Probá de nuevo en un rato.', 'danger');
                button.disabled = false;
                button.textContent = label;
            }
        });
        root.addEventListener('submit', async event => {
            const form = event.target.closest('[data-sv-form]');
            if (!form) return;
            event.preventDefault();
            const evidence = form.querySelector('#sv-evidence').value.trim();
            const links = linksFrom(form.querySelector('#sv-links').value);
            if (evidence.length < 10) { kit().toast('Contanos un poco más sobre cómo verificamos el estudio (mínimo 10 caracteres).', 'danger'); form.querySelector('#sv-evidence').focus(); return; }
            if (links.length > 5) { kit().toast('Podés sumar hasta 5 enlaces.', 'danger'); form.querySelector('#sv-links').focus(); return; }
            if (links.some(l => !validLink(l))) { kit().toast('Los enlaces tienen que empezar con http:// o https://.', 'danger'); form.querySelector('#sv-links').focus(); return; }
            const submit = form.querySelector('[type="submit"]');
            submit.disabled = true;
            const result = await ctx.data.Studios.requestVerification(ctx.studioId, {
                evidence, links,
                contactName: form.querySelector('#sv-contact-name').value.trim(),
                contactPhone: form.querySelector('#sv-contact-phone').value.trim()
            });
            if (result?.error) {
                kit().toast(kit().friendlyError(result.error, 'No pudimos enviar la información.'), 'danger');
                submit.disabled = false;
                return;
            }
            kit().toast('Enviamos la información a soporte. Te avisamos por email cuando la revise.', 'success');
            await load(root, ctx);
        });
    }

    async function mount(root, ctx) {
        root.classList.add('sv-root');
        wire(root, ctx);
    }
    async function show(root, ctx) {
        await load(root, ctx);
    }

    window.WeOtziStudioVerification = { statusCardHtml, instagramHtml, formHtml, linksFrom, validLink };
    const admin = window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
})();
