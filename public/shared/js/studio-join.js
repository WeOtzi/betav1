// ================================================================
// We Ötzi — Enlace de invitación del estudio (beta cerrada · ROSTER-03)
// Ruta: /artist/join-studio?unirse=<token>
//   - Valida el enlace (GET /api/studio-invite/:token, sin datos personales).
//   - Con sesión: "Sumarme a <Estudio>" (POST /api/studio-invite/:token/join).
//   - Sin sesión: "Crear mi perfil" (/registerclosedbeta?unirse=…, el token
//     viaja por el registro y se canjea al crear la cuenta) o "Ingresar"
//     (vuelve acá con returnTo).
// Todo texto que viene del servidor pasa por esc().
// ================================================================

(function () {
    'use strict';

    const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
    const STORAGE_KEY = 'wo:studio-invite-token';
    const ROLE_LABELS = { resident: 'Residente', guest: 'Guest', itinerant: 'Itinerante' };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function basePath() {
        return window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '') : '';
    }
    function appUrl(path) {
        const value = String(path || '/');
        const base = basePath();
        return base && !value.startsWith(base + '/') ? base + value : value;
    }
    function initials(name) {
        return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || 'E';
    }
    function card() { return document.getElementById('wjs-card'); }

    function render({ eyebrow = 'Invitación de estudio', title, lead, body = '', focus = true }) {
        const host = card();
        if (!host) return;
        host.innerHTML = `<p class="wjs-eyebrow">${esc(eyebrow)}</p>
            <h1 class="wjs-title" id="wjs-title" tabindex="-1">${esc(title)}</h1>
            ${lead ? `<p class="wjs-lead">${esc(lead)}</p>` : ''}
            ${body}`;
        if (focus) host.querySelector('#wjs-title')?.focus({ preventScroll: true });
    }

    function readToken() {
        const fromUrl = new URLSearchParams(window.location.search).get('unirse') || '';
        return TOKEN_RE.test(fromUrl) ? fromUrl : '';
    }

    async function resolveClient() {
        const start = Date.now();
        while (Date.now() - start < 6000) {
            const manager = window.ConfigManager;
            const client = (manager && typeof manager.getSupabaseClient === 'function' && manager.getSupabaseClient()) || window._supabase;
            if (client) return client;
            await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return null;
    }

    async function currentSession() {
        const client = await resolveClient();
        if (!client) return null;
        try {
            const { data } = await client.auth.getSession();
            return (data && data.session) || null;
        } catch (_) {
            return null;
        }
    }

    function studioBlock(preview) {
        const studio = preview.studio || {};
        const logo = /^https?:\/\//i.test(String(studio.logo_image || ''))
            ? `<img class="wjs-logo" src="${esc(studio.logo_image)}" alt="" width="56" height="56" loading="lazy">`
            : `<span class="wjs-logo wjs-logo--initials" aria-hidden="true">${esc(initials(studio.name))}</span>`;
        const where = [studio.city, studio.country].filter(Boolean).join(', ');
        const location = preview.location ? [preview.location.label, preview.location.city].filter(Boolean).join(' · ') : 'La que te asigne el estudio';
        return `<div class="wjs-studio">${logo}<div><p class="wjs-studio-name">${esc(studio.name || 'Estudio')}</p>
                ${where ? `<p class="wjs-note wjs-where">${esc(where)}</p>` : ''}</div></div>
            <dl class="wjs-facts">
                <div><dt>Rol</dt><dd>${esc(ROLE_LABELS[preview.role] || 'Artista')}</dd></div>
                <div><dt>Sede</dt><dd>${esc(location)}</dd></div>
                <div><dt>Alta</dt><dd>${preview.requires_approval ? 'El estudio aprueba tu solicitud' : 'Directa al equipo'}</dd></div>
            </dl>`;
    }

    async function joinWithAccount(token, preview, session, button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Sumándote…';
        let result = null;
        try {
            const response = await fetch(appUrl('/api/studio-invite/' + encodeURIComponent(token) + '/join'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
                body: '{}'
            });
            result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(result.error || 'No pudimos sumarte al estudio.');
        } catch (error) {
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
            button.textContent = 'Sumarme a ' + ((preview.studio && preview.studio.name) || 'este estudio');
            const status = card().querySelector('.wjs-status');
            if (status) {
                status.hidden = false;
                status.textContent = error.message || 'No pudimos sumarte al estudio. Probá de nuevo.';
            }
            return;
        }
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        const name = (preview.studio && preview.studio.name) || 'el estudio';
        const pending = result.status === 'requested' || result.status === 'pending_acceptance' || result.status === 'pending_invite';
        render({
            eyebrow: 'Invitación de estudio',
            title: result.already_member
                ? `Ya tenés un vínculo con ${name}`
                : (pending ? `Le enviamos tu solicitud a ${name}` : `Ya sos parte de ${name}`),
            lead: result.already_member
                ? 'Lo ves en tus invitaciones, con su estado actual.'
                : (pending ? 'El estudio la revisa y te avisamos por email cuando responda.' : 'El estudio ya aparece en tu perfil y en tu panel.'),
            body: `<div class="wjs-actions"><a class="wo-btn wo-btn--primary" href="${esc(appUrl('/artist/invitations'))}">Ver mis estudios →</a></div>`
        });
    }

    async function start() {
        const token = readToken();
        if (!token) {
            render({ title: 'Este enlace no es válido', lead: 'Pedile al estudio que te comparta el enlace de nuevo.' });
            return;
        }
        let preview = null;
        let failure = null;
        try {
            const response = await fetch(appUrl('/api/studio-invite/' + encodeURIComponent(token)), { headers: { Accept: 'application/json' } });
            const json = await response.json().catch(() => ({}));
            if (response.ok && json.success) preview = json;
            else failure = json.error || 'Este enlace de invitación ya no sirve. Pedile al estudio uno nuevo.';
        } catch (_) {
            failure = 'No pudimos revisar el enlace. Revisá tu conexión y probá de nuevo.';
        }
        if (!preview) {
            render({ title: 'No pudimos usar este enlace', lead: failure });
            return;
        }
        // El registro lo retoma aunque se pierda el parámetro (borrador, recarga).
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, savedAt: Date.now() })); } catch (_) {}

        const name = (preview.studio && preview.studio.name) || 'este estudio';
        const session = await currentSession();
        const here = '/artist/join-studio?unirse=' + encodeURIComponent(token);
        if (session && session.access_token) {
            render({
                title: `${name} te invita a su equipo`,
                lead: preview.requires_approval
                    ? 'Al sumarte, el estudio recibe tu solicitud con tu perfil y la aprueba.'
                    : 'Al sumarte quedás directamente en el equipo del estudio.',
                body: `${studioBlock(preview)}
                    <div class="wjs-actions">
                        <button type="button" class="wo-btn wo-btn--accent" id="wjs-join">Sumarme a ${esc(name)}</button>
                        <a class="wo-btn wo-btn--secondary" href="${esc(appUrl('/artist/invitations'))}">Ahora no</a>
                    </div>
                    <p class="wo-error-msg wjs-status" role="alert" hidden></p>`
            });
            document.getElementById('wjs-join').addEventListener('click', (event) => joinWithAccount(token, preview, session, event.currentTarget));
            return;
        }
        render({
            title: `${name} te invita a su equipo`,
            lead: 'Creá tu perfil de artista en We Ötzi con este enlace y quedás vinculado al estudio. Si ya tenés cuenta, ingresá y sumate.',
            body: `${studioBlock(preview)}
                <div class="wjs-actions">
                    <a class="wo-btn wo-btn--accent" href="${esc(appUrl('/registerclosedbeta?unirse=' + encodeURIComponent(token)))}">Crear mi perfil →</a>
                    <a class="wo-btn wo-btn--secondary" href="${esc(appUrl('/artist/login?returnTo=' + encodeURIComponent(here)))}">Ya tengo cuenta: ingresar</a>
                </div>
                <p class="wjs-note">El enlace vence el ${esc(new Date(preview.expires_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>`
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
