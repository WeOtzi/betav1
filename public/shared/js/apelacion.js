// ============================================
// WE ÖTZI - Página pública /apelacion (sanciones, 2.7.0)
// Lee ?t= (token firmado del correo), muestra el resumen de la sanción y deja
// escribir la apelación UNA vez, dentro de 30 días. Estados claros: enlace
// inválido, vencido, ya apelada, enviada. Sin sesión: la cuenta sancionada
// puede no poder iniciar sesión. Habla solo con el servidor:
//   GET  /api/sanctions/appeal?t=…
//   POST /api/sanctions/appeal   { t, text }
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const MIN = 20;
    const MAX = 3000;
    const KIND_INTRO = {
        warning: 'Recibiste una advertencia. Tu cuenta sigue funcionando con normalidad.',
        suspension: 'Tu perfil está suspendido: no aparece en el explorador ni recibe cotizaciones nuevas mientras dure la sanción.',
        ban: 'Tu cuenta está cerrada de forma permanente.'
    };
    const STATE_COPY = {
        invalid: { tone: 'error', title: 'El enlace no es válido', text: 'Abre el enlace completo del correo que te enviamos. Si el problema sigue, escribe a soporte.' },
        expired: { tone: 'warning', title: 'El plazo para apelar terminó', text: 'La apelación se puede enviar dentro de los 30 días desde que empezó la sanción, y ese plazo ya pasó.' },
        already_appealed: { tone: 'info', title: 'Ya enviaste tu apelación', text: 'Solo se puede apelar una vez. Un agente que no intervino en la sanción la está revisando y te escribiremos por correo.' },
        closed: { tone: 'info', title: 'Esta sanción ya no admite apelación', text: 'La sanción fue levantada o ya tiene una decisión final.' },
        sent: { tone: 'success', title: 'Recibimos tu apelación', text: 'Un agente que no intervino en la sanción la va a revisar. Te escribiremos por correo con la decisión.' },
        unavailable: { tone: 'error', title: 'No pudimos abrir tu sanción', text: 'Inténtalo de nuevo en unos minutos. Si sigue sin funcionar, escribe a soporte.' }
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function tokenFrom(search) {
        try {
            const t = new URLSearchParams(String(search || '')).get('t');
            return t && /^[A-Za-z0-9_.-]{20,600}$/.test(t) ? t : '';
        } catch (_) { return ''; }
    }

    // Respuesta del servidor → estado de la página.
    function stateFor(status, json) {
        const code = json && json.code;
        if (status === 200 && json && json.success && json.sanction) {
            const s = json.sanction.appeal_state;
            return s === 'open' ? 'open' : (STATE_COPY[s] ? s : 'closed');
        }
        if (code === 'EXPIRED' || status === 410) return 'expired';
        if (code === 'ALREADY_APPEALED') return 'already_appealed';
        if (code === 'CLOSED') return 'closed';
        if (code === 'INVALID' || code === 'NOT_FOUND' || status === 400 || status === 404) return 'invalid';
        return 'unavailable';
    }

    function validateText(text) {
        const t = String(text || '').trim();
        if (t.length < MIN) return 'Cuéntanos tu versión en al menos ' + MIN + ' caracteres.';
        if (t.length > MAX) return 'Tu apelación puede tener hasta ' + MAX + ' caracteres.';
        return '';
    }

    function summaryHtml(s) {
        const x = s || {};
        const rows = [
            ['Sanción', x.kind_label],
            ['Motivo', x.reason_label],
            ['Desde', fmtDate(x.starts_at)],
            ['Hasta', x.ends_at ? fmtDate(x.ends_at) : (x.kind === 'warning' ? '' : 'Permanente')],
            ['Puedes apelar hasta', x.appeal_state === 'open' ? fmtDate(x.appeal_deadline) : '']
        ].filter((r) => r[1]);
        return '<section class="wo-card ap-card" aria-labelledby="ap-summary-title">'
            + '<h2 class="ap-h2" id="ap-summary-title">Tu sanción</h2>'
            + (KIND_INTRO[x.kind] ? '<p class="ap-text">' + esc(KIND_INTRO[x.kind]) + '</p>' : '')
            + '<dl class="ap-facts">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>'
            + '</section>';
    }

    function stateHtml(key) {
        const c = STATE_COPY[key] || STATE_COPY.unavailable;
        return '<div class="wo-alert wo-alert--' + c.tone + ' ap-state" role="' + (c.tone === 'error' ? 'alert' : 'status') + '">'
            + '<div><p class="ap-state-title">' + esc(c.title) + '</p><p class="ap-text">' + esc(c.text) + '</p></div></div>';
    }

    function formHtml() {
        return '<form class="wo-card ap-card ap-form" id="ap-form" novalidate>'
            + '<h2 class="ap-h2">Tu apelación</h2>'
            + '<p class="ap-text">Explica por qué crees que la sanción es un error y suma lo que pueda ayudar: enlaces, fechas o tu Instagram real. '
            + '<strong>Tienes una sola apelación</strong>: no se puede editar después de enviarla.</p>'
            + '<div class="wo-field"><label class="wo-label" for="ap-text">Qué quieres que revisemos <span class="req" aria-hidden="true">*</span></label>'
            + '<textarea class="wo-textarea ap-textarea" id="ap-text" rows="8" minlength="' + MIN + '" maxlength="' + MAX + '" required aria-describedby="ap-count ap-error"></textarea>'
            + '<p class="wo-help ap-count" id="ap-count">0 / ' + MAX + '</p>'
            + '<p class="wo-error-msg ap-error" id="ap-error" role="alert" hidden></p></div>'
            + '<button type="submit" class="wo-btn wo-btn--block ap-submit" id="ap-submit">Enviar apelación</button>'
            + '</form>';
    }

    const pure = { MIN, MAX, STATE_COPY, esc, fmtDate, tokenFrom, stateFor, validateText, summaryHtml, stateHtml, formHtml };

    if (!root || !root.document) return { boot() {}, _internal: pure };

    // ---------------- página ----------------

    const $ = (id) => root.document.getElementById(id);
    let token = '';
    let busy = false;

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        return /^\/beta(?:\/|$)/.test(String((root.location && root.location.pathname) || '')) ? '/beta' : '';
    }

    async function api(method, body) {
        const url = basePath() + '/api/sanctions/appeal' + (method === 'GET' ? '?t=' + encodeURIComponent(token) : '');
        try {
            const res = await root.fetch(url, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            });
            const json = await res.json().catch(() => ({}));
            return { status: res.status, json: json || {} };
        } catch (_) {
            return { status: 0, json: {} };
        }
    }

    function render(html) {
        const box = $('ap-root');
        if (box) box.innerHTML = html;
    }

    function focusTitle() {
        const t = $('ap-title');
        if (t) { try { t.focus({ preventScroll: false }); } catch (_) { t.focus(); } }
    }

    function bindForm() {
        const form = $('ap-form');
        const text = $('ap-text');
        if (!form || !text) return;
        text.addEventListener('input', () => {
            const count = $('ap-count');
            if (count) count.textContent = text.value.trim().length + ' / ' + MAX;
            if (text.getAttribute('aria-invalid') === 'true' && !validateText(text.value)) {
                text.removeAttribute('aria-invalid');
                $('ap-error').hidden = true;
            }
        });
        form.addEventListener('submit', submit);
    }

    function showError(msg) {
        const el = $('ap-error');
        const text = $('ap-text');
        if (el) { el.textContent = msg; el.hidden = !msg; }
        if (text && msg) { text.setAttribute('aria-invalid', 'true'); text.focus(); }
    }

    async function submit(e) {
        e.preventDefault();
        if (busy) return;
        const text = $('ap-text').value;
        const problem = validateText(text);
        if (problem) { showError(problem); return; }
        busy = true;
        const btn = $('ap-submit');
        btn.disabled = true;
        btn.textContent = 'Enviando…';
        const res = await api('POST', { t: token, text: text.trim() });
        busy = false;
        if (res.status === 201 && res.json.success) {
            render((res.json.sanction ? summaryHtml(res.json.sanction) : '') + stateHtml('sent'));
            focusTitle();
            return;
        }
        const state = stateFor(res.status, res.json);
        if (res.json && res.json.field === 'text') {
            btn.disabled = false;
            btn.textContent = 'Enviar apelación';
            showError(res.json.error || validateText(''));
            return;
        }
        if (state === 'unavailable' || res.status === 429) {
            btn.disabled = false;
            btn.textContent = 'Enviar apelación';
            showError((res.json && res.json.error) || STATE_COPY.unavailable.text);
            return;
        }
        render(stateHtml(state));
        focusTitle();
    }

    async function load() {
        token = tokenFrom(root.location.search);
        if (!token) { render(stateHtml('invalid')); return; }
        const res = await api('GET');
        const state = stateFor(res.status, res.json);
        const sanction = res.json && res.json.success ? res.json.sanction : null;
        if (state === 'open') {
            render(summaryHtml(sanction) + formHtml());
            bindForm();
            return;
        }
        render((sanction ? summaryHtml(sanction) : '') + stateHtml(state));
    }

    function boot() {
        const doc = root.document;
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', load); else load();
    }

    return { boot, _internal: pure };
}));
