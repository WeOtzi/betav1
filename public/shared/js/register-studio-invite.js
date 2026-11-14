// ================================================================
// We Ötzi — Enlace de invitación del estudio en el registro (ROSTER-03)
// Cargado en /registerclosedbeta y /register-artist.
//   - Toma ?unirse=<token> (o el que guardó /artist/join-studio) y lo
//     conserva en localStorage para que sobreviva al borrador y a recargas.
//   - Valida el enlace (GET /api/studio-invite/:token) y muestra el aviso
//     "Te sumás a <Estudio> · <Sede>". En el wizard precarga el estudio y la
//     sede y bloquea el campo de estudio mientras el enlace está activo.
//   - register.js manda el token en el finalize (el servidor lo revalida y
//     fuerza estudio y sede) y llama a afterFinalize(respuesta).
// Todo texto que viene del servidor pasa por esc() / textContent.
// ================================================================

(function () {
    'use strict';

    const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
    const STORAGE_KEY = 'wo:studio-invite-token';
    const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    let token = '';
    let preview = null;
    let previewPromise = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function appUrl(path) {
        const base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '') : '';
        return base && !String(path).startsWith(base + '/') ? base + path : path;
    }

    function readStored() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (raw && TOKEN_RE.test(String(raw.token || '')) && Date.now() - Number(raw.savedAt || 0) < MAX_AGE_MS) return raw.token;
        } catch (_) {}
        return '';
    }

    function store(value) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: value, savedAt: Date.now() })); } catch (_) {}
    }

    function clear() {
        token = '';
        preview = null;
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        document.querySelectorAll('.wo-studio-invite-banner').forEach((node) => node.remove());
        const input = document.getElementById('studio_name');
        if (input && input.dataset.inviteLocked === 'true') {
            input.readOnly = false;
            input.removeAttribute('aria-describedby');
            delete input.dataset.inviteLocked;
        }
    }

    function init() {
        const fromUrl = new URLSearchParams(window.location.search).get('unirse') || '';
        if (TOKEN_RE.test(fromUrl)) {
            token = fromUrl;
            store(token);
        } else {
            token = readStored();
        }
        if (!token) return;
        previewPromise = fetch(appUrl('/api/studio-invite/' + encodeURIComponent(token)), { headers: { Accept: 'application/json' } })
            .then((response) => response.json().then((json) => ({ ok: response.ok, json })))
            .then(({ ok, json }) => {
                if (!ok || !json.success) {
                    // Vencido, revocado o sin usos: se descarta y el registro
                    // sigue como siempre (solicitud al estudio que elija).
                    clear();
                    showBanner({ invalid: true, message: json.error || 'El enlace de invitación ya no sirve.' });
                    return null;
                }
                preview = json;
                showBanner({ preview });
                applyToForm();
                // El borrador del servidor puede pisar los campos al cargar: se
                // vuelve a aplicar una vez que el wizard terminó de arrancar.
                setTimeout(applyToForm, 1500);
                return preview;
            })
            .catch(() => null);
    }

    function bannerHost() {
        return document.getElementById('beta-form')
            || document.querySelector('.ra-studio-field, #studio_name')?.closest('.form-group, .ra-field, div')
            || document.querySelector('main');
    }

    function showBanner({ preview: data, invalid, message }) {
        document.querySelectorAll('.wo-studio-invite-banner').forEach((node) => node.remove());
        const banner = document.createElement('div');
        banner.className = 'wo-studio-invite-banner' + (invalid ? ' is-invalid' : '');
        banner.id = 'wo-studio-invite-banner';
        banner.setAttribute('role', 'status');
        if (invalid) {
            banner.innerHTML = `<p>${esc(message)} Podés registrarte igual y elegir tu estudio en el formulario.</p>`;
        } else {
            const loc = data.location ? [data.location.label, data.location.city].filter(Boolean).join(' · ') : '';
            banner.innerHTML = `<p><strong>Te sumás a ${esc(data.studio && data.studio.name)}</strong>${loc ? ' · ' + esc(loc) : ''}
                con su enlace de invitación${data.requires_approval ? ': el estudio aprueba tu alta cuando termines.' : '.'}</p>
                <button type="button" class="wo-studio-invite-dismiss">No es mi estudio</button>`;
            banner.querySelector('.wo-studio-invite-dismiss').addEventListener('click', () => {
                clear();
                const input = document.getElementById('studio_name');
                if (input) input.focus();
            });
        }
        const host = bannerHost();
        if (host && host.id === 'beta-form') host.prepend(banner);
        else if (host && host.parentNode) host.parentNode.insertBefore(banner, host);
        else document.body.prepend(banner);
    }

    // Precarga del wizard (/register-artist). formState vive en register.js
    // (const global de script clásico).
    function applyToForm() {
        if (!token || !preview || typeof formState === 'undefined' || !formState || !formState.data) return; // eslint-disable-line no-undef
        const data = formState.data; // eslint-disable-line no-undef
        data.work_type = data.work_type === 'both' ? 'both' : 'studio';
        data.studio_id = preview.studio.id;
        data.studio_name = preview.studio.name;
        if (preview.location) {
            data.studio_location_id = preview.location.id;
            data.studio_location_label = preview.location.label || '';
            if (typeof applyStudioLocation === 'function' && preview.location.formatted_address) { // eslint-disable-line no-undef
                try { applyStudioLocation(preview.location); } catch (_) {} // eslint-disable-line no-undef
            }
        }
        const input = document.getElementById('studio_name');
        if (input) {
            input.value = preview.studio.name;
            input.readOnly = true;
            input.dataset.inviteLocked = 'true';
            input.setAttribute('aria-describedby', 'wo-studio-invite-banner');
        }
        if (typeof prefillFormInputs === 'function') { try { prefillFormInputs(); } catch (_) {} } // eslint-disable-line no-undef
        if (typeof persistRegistrationDraft === 'function') { try { persistRegistrationDraft(); } catch (_) {} } // eslint-disable-line no-undef
    }

    // Pantalla de éxito: estado del vínculo con el estudio (ROSTER-01/03).
    function afterFinalize(result) {
        const data = result || {};
        if (data.studio_invite_status === 'joined' || data.studio_invite_status === 'failed' || data.membership_status) clear();
        const success = document.getElementById('ra-success');
        if (!success || !data.membership_status) return;
        let note = document.getElementById('ra-studio-membership');
        if (!note) {
            note = document.createElement('p');
            note.id = 'ra-studio-membership';
            note.className = 'wo-studio-invite-banner ra-studio-membership';
            note.setAttribute('role', 'status');
            const anchor = document.getElementById('ra-studio-claim');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(note, anchor);
            else success.appendChild(note);
        }
        const name = data.studio_name || 'el estudio';
        if (data.membership_status === 'active') {
            note.textContent = `Ya formás parte del equipo de ${name}.`;
        } else if (data.studio_invite_status === 'failed') {
            note.textContent = `El enlace de invitación ya no servía: enviamos tu solicitud a ${name} y te avisamos cuando responda.`;
        } else {
            note.textContent = `Tu solicitud a ${name} quedó pendiente de aprobación. Te avisamos por email cuando responda.`;
        }
    }

    window.WeOtziStudioInvite = {
        getToken: () => token || '',
        getPreview: () => preview,
        ready: () => previewPromise || Promise.resolve(null),
        clear,
        afterFinalize
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
