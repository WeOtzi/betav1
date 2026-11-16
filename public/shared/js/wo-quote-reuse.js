/**
 * WE ÖTZI · "Cotizar con otro artista" (ronda 2 · frente cot-form · P32)
 * ---------------------------------------------------------------------------
 * Panel del cliente: reutiliza una solicitud ya creada para cotizar con otro
 * artista sin volver a llenar los datos.
 *
 *   WoQuoteReuse.buttonHtml(quotation)   botón para la tarjeta de la solicitud
 *   WoQuoteReuse.start(quoteId, button)  clona en el servidor y abre /quotation
 *   WoQuoteReuse.canReuse(quotation)     solo solicitudes enviadas (no borradores)
 *
 * El servidor (POST /api/quotations/:quoteId/reuse, con la sesión del cliente)
 * clona idea, datos y referencias a un borrador nuevo sin artista y devuelve su
 * llave. El borrador viaja a /quotation por localStorage (misma pestaña, mismo
 * navegador, vence en 10 minutos) y el cotizador lo abre en el paso de elegir
 * artista: /quotation?source=reuse.
 */
(function () {
    'use strict';

    var REUSE_KEY = 'weotzi_quotation_reuse';
    var DRAFT_KEY = 'weotzi_quotation_draft';
    var TTL_MS = 10 * 60 * 1000;
    var busy = false;

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function appUrl(path) {
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base + path;
    }

    // Un borrador del cotizador todavía no se envió: no hay nada que reutilizar.
    function canReuse(q) {
        if (!q || !q.quote_id) return false;
        var draft = q.quote_status === 'in_progress' && !q.artist_responded_at && !q.artist_budget_amount && !q.final_budget_amount;
        return !draft;
    }

    function buttonHtml(q) {
        if (!canReuse(q)) return '';
        return '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s wo-quote-reuse" data-quote-id="' + esc(q.quote_id) + '"' +
            ' onclick="WoQuoteReuse.start(this.dataset.quoteId, this)"' +
            ' title="Usa esta misma solicitud para cotizar con otro artista, sin volver a llenar tus datos">Cotizar con otro artista</button>';
    }

    async function accessToken() {
        try {
            var client = (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient()) || window._supabase;
            if (!client || !client.auth) return null;
            var result = await client.auth.getSession();
            return (result && result.data && result.data.session && result.data.session.access_token) || null;
        } catch (_) {
            return null;
        }
    }

    function notify(button, message) {
        var host = button && button.closest ? button.closest('.quotation-card, .modal-content, .modal') : null;
        var note = host && host.querySelector('.wo-quote-reuse-note');
        if (host && !note) {
            note = document.createElement('p');
            note.className = 'wo-quote-reuse-note';
            note.setAttribute('role', 'alert');
            note.style.cssText = 'margin:0;padding:var(--space-3) var(--space-6);font-size:var(--body-s-size);color:var(--text-danger);';
            host.appendChild(note);
        }
        if (note) note.textContent = message;
        else if (typeof window.showToast === 'function') window.showToast(message, 'error');
        else console.warn('[reuse]', message);
    }

    async function start(quoteId, button) {
        if (busy || !quoteId) return;
        busy = true;
        var label = button ? button.textContent : '';
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Preparando…'; }
        try {
            var token = await accessToken();
            if (!token) throw new Error('Tu sesión venció. Vuelve a iniciar sesión para reutilizar la solicitud.');
            var response = await fetch(appUrl('/api/quotations/' + encodeURIComponent(quoteId) + '/reuse'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: '{}'
            });
            var data = {};
            try { data = await response.json(); } catch (_) { data = {}; }
            if (!response.ok || !data.success || !data.draft) {
                throw new Error(data.error || 'No pudimos preparar la solicitud. Inténtalo de nuevo.');
            }
            try {
                // El borrador clonado reemplaza a cualquier otro sin enviar de este navegador.
                localStorage.removeItem(DRAFT_KEY);
                localStorage.setItem(REUSE_KEY, JSON.stringify({ draft: data.draft, expiresAt: Date.now() + TTL_MS }));
            } catch (_) {
                throw new Error('Tu navegador no permite guardar el borrador. Desactiva el modo privado e inténtalo de nuevo.');
            }
            window.location.href = appUrl('/quotation?source=reuse');
        } catch (error) {
            notify(button, (error && error.message) || 'No pudimos preparar la solicitud. Inténtalo de nuevo.');
            if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
        } finally {
            busy = false;
        }
    }

    window.WoQuoteReuse = { REUSE_KEY: REUSE_KEY, canReuse: canReuse, buttonHtml: buttonHtml, start: start };
})();
