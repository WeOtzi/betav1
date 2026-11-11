/**
 * WE OTZI - Expediente de cotización del artista
 * ------------------------------------------------
 * /my-quotations/detail?id=<quote_id>  (alias legacy: ?quote=<quote_id|id>)
 * Figma final (w3JA83CcP5ISKjyOu87mx1) · frames 801:576–584 + notas 801:578/579.
 *
 * El estado del expediente se deriva de la cotización real, sus sesiones y la
 * disputa (QuotationDetailModel.deriveStage). Todas las acciones escriben por
 * la capa PostgREST (WeotziData.QuotationDetail / Sessions / Chat / Quotations).
 *
 * Parámetros de QA (documentados en output/figma-final-artista/reports/cotizaciones-detalle.md):
 *   ?estado=pendiente|respondida|aprobada|en-progreso|listo|completada|disputa
 *       SOLO preview/demo: arma en memoria el estado de cada frame (acciones deshabilitadas;
 *       se avisa con un toast pasajero, no con un bloque en el layout).
 *   ?panel=notas[&nota=nueva|<id>][&plantilla=brief|preparacion|seguimiento|cuidados|pendientes]
 *       (?plantilla= arma la nota sin guardarla: se guarda recién cuando el artista la edita)
 *   ?modal=responder|rechazar|acuerdo|agendar|listo|disputa|responder-disputa|correccion|reabrir
 *
 * Enlaces: "Ver sesión" → /calendar?date=&event=session:<id>&quote=<quote_id>;
 * "Agendar" (pendiente) → /calendar?date=&quote=<quote_id>; "Contactar cliente" y
 * "Ver chat completo" → /artist/inbox?quote=<quote_id>.
 */
(function () {
    'use strict';

    const M = window.QuotationDetailModel;
    const D = () => window.WeotziData || {};
    const params = new URLSearchParams(window.location.search);

    const state = {
        client: null,
        user: null,
        identifier: params.get('id') || params.get('quote') || '',
        quote: null,
        attachments: [],
        sessions: [],
        messages: [],
        history: [],
        disputes: [],
        disputesAvailable: true,
        scenario: null,
        notesTimer: null,
        menuOpen: false,
    };

    /* --------------------------------- utilidades --------------------------------- */
    function appBasePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const path = window.location.pathname || '';
        return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
    }
    function appUrl(path) {
        const normalized = String(path || '').startsWith('/') ? String(path) : `/${path}`;
        return `${appBasePath()}${normalized}`;
    }
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeUrl(value) {
        try {
            const url = new URL(value, window.location.origin);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch (_) {
            return '';
        }
    }
    function driveThumbnail(value) {
        const url = safeUrl(value);
        if (!url || !url.includes('drive.google.com')) return url;
        const match = url.match(/\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
        return match ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w600` : url;
    }
    function isPreviewEnv() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }
    // /calendar acepta ?date=YYYY-MM-DD, ?quote=<quote_id|id> (abre el turno con
    // la cotización vinculada) y ?event=session:<id> (abre esa sesión).
    function realSessionId(id) {
        return id != null && !state.scenario && !(Number(id) < 0) ? String(id) : null;
    }
    function calendarUrl(date, opts = {}) {
        const query = new URLSearchParams();
        query.set('date', M.isoDay(date || new Date()));
        const session = realSessionId(opts.session);
        if (session) query.set('event', `session:${session}`);
        const quote = opts.quote && state.quote ? (state.quote.quote_id || state.quote.id) : null;
        if (quote) query.set('quote', String(quote));
        return appUrl(`/calendar?${query.toString()}`);
    }
    function inboxUrl() {
        const quote = state.quote;
        // El inbox abre la conversación de la cotización con ?quote=<quote_id>.
        return appUrl(quote ? `/artist/inbox?quote=${encodeURIComponent(quote.quote_id || quote.id)}` : '/artist/inbox');
    }
    function notify(eventId, payload) {
        try {
            const pending = window.ConfigManager && window.ConfigManager.sendN8NEvent
                ? window.ConfigManager.sendN8NEvent(eventId, payload) : null;
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        } catch (_) { /* la notificación nunca rompe la acción */ }
    }

    // Íconos Feather 4.29.2 en línea (mismo trazo que data-wo-icon): la preview
    // bloquea el CDN por CSP y así el expediente se ve igual en todos lados.
    const ICONS = {
        'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
        'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
        check: '<polyline points="20 6 9 17 4 12"></polyline>',
        x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
        'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
        send: '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
        paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
        trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
        'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    };
    function svg(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
    }
    function icon(name, size) {
        return `<i class="qd-icon qd-icon--${size || 14}" data-wo-icon="${esc(name)}" data-wo-icon-done="1" aria-hidden="true">${svg(name)}</i>`;
    }
    function hydrateIcons(scope) {
        (scope || document).querySelectorAll('[data-wo-icon]:not([data-wo-icon-done])').forEach((el) => {
            const name = el.getAttribute('data-wo-icon');
            if (!ICONS[name]) return;
            el.setAttribute('data-wo-icon-done', '1');
            el.innerHTML = svg(name);
        });
    }
    window.QuotationDetailIcons = { svg, icon, hydrate: hydrateIcons, ICONS };

    function showToast(message, opts = {}) {
        const toast = document.getElementById('qd-toast');
        if (!toast) return;
        toast.innerHTML = `<span>${esc(message)}</span>${opts.link ? `<a href="${esc(opts.link.href)}">${esc(opts.link.label)}</a>` : ''}`;
        toast.classList.toggle('is-error', !!opts.error);
        toast.hidden = false;
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => { toast.hidden = true; }, opts.link ? 7000 : 4200);
    }
    function setBusy(button, busy) {
        if (!button) return;
        button.disabled = !!busy;
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    /* ---------------------------------- diálogos ---------------------------------- */
    let dialogSeq = 0;
    function closeDialog(overlay) {
        if (!overlay) return;
        overlay.remove();
        document.removeEventListener('keydown', overlay._onKey);
        if (overlay._returnFocus && overlay._returnFocus.focus) overlay._returnFocus.focus();
    }
    // openDialog({ title, intro, body, submitLabel, submitClass, cancelLabel, onSubmit(form, data) })
    // onSubmit puede lanzar Error(mensaje) para mostrarlo dentro del diálogo.
    function openDialog(options) {
        dialogSeq += 1;
        const id = `qd-dialog-${dialogSeq}`;
        const host = document.getElementById('qd-dialog-root') || document.body;
        const overlay = document.createElement('div');
        overlay.className = 'wo-overlay qd-dialog';
        overlay._returnFocus = document.activeElement;
        overlay.innerHTML = `
            <form class="wo-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title" novalidate>
                <h2 class="wo-modal-title" id="${id}-title">${esc(options.title)}</h2>
                ${options.intro ? `<p class="qd-dialog-copy">${esc(options.intro)}</p>` : ''}
                ${options.body || ''}
                <p class="qd-dialog-error" role="alert" hidden></p>
                <div class="wo-modal-actions">
                    <button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-dialog-cancel>${esc(options.cancelLabel || 'Cancelar')}</button>
                    <button class="wo-btn wo-btn--s ${esc(options.submitClass || '')}" type="submit">${esc(options.submitLabel || 'Guardar')}</button>
                </div>
            </form>`;
        host.appendChild(overlay);
        const form = overlay.querySelector('form');
        const errorEl = overlay.querySelector('.qd-dialog-error');
        const submit = form.querySelector('[type="submit"]');
        overlay._onKey = (event) => { if (event.key === 'Escape') closeDialog(overlay); };
        document.addEventListener('keydown', overlay._onKey);
        overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeDialog(overlay); });
        form.querySelector('[data-dialog-cancel]').addEventListener('click', () => closeDialog(overlay));
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorEl.hidden = true;
            setBusy(submit, true);
            try {
                const data = Object.fromEntries(new FormData(form).entries());
                await options.onSubmit(form, data);
                closeDialog(overlay);
            } catch (error) {
                console.error('[quotation-detail] dialog', error);
                errorEl.textContent = error && error.userMessage ? error.userMessage : (error && error.message && !/^\[/.test(error.message) ? error.message : 'No pudimos guardar. Probá nuevamente.');
                errorEl.hidden = false;
                setBusy(submit, false);
            }
        });
        const first = form.querySelector('input:not([type="hidden"]), textarea, select');
        window.setTimeout(() => (first || submit).focus(), 30);
        return overlay;
    }
    function confirmDialog({ title, message, confirmLabel, danger }) {
        return new Promise((resolve) => {
            let accepted = false;
            const overlay = openDialog({
                title,
                intro: message,
                submitLabel: confirmLabel || 'Confirmar',
                submitClass: danger ? 'wo-btn--danger' : '',
                onSubmit: async () => { accepted = true; },
            });
            const observer = new MutationObserver(() => {
                if (!overlay.isConnected) { observer.disconnect(); resolve(accepted); }
            });
            observer.observe(overlay.parentNode, { childList: true });
        });
    }
    function userError(message) { return Object.assign(new Error(message), { userMessage: message }); }
    function field(label, control, wide) {
        return `<label class="wo-field${wide ? ' is-wide' : ''}"><span class="wo-label">${esc(label)}</span>${control}</label>`;
    }
    function durationFields(minutes) {
        const parts = M.splitMinutes(minutes || 0);
        const options = [0, 15, 30, 45].map((m) => `<option value="${m}"${m === parts.m - (parts.m % 15) ? ' selected' : ''}>${m} min</option>`).join('');
        return field('Duración por sesión · horas', `<input class="wo-input" name="hours" type="number" min="0" max="24" step="1" value="${esc(minutes ? parts.h : '')}" required>`)
            + field('Minutos', `<select class="wo-select" name="minutes">${options}</select>`);
    }
    function currencySelect(value) {
        const current = String(value || 'USD').toUpperCase();
        const codes = Array.from(new Set(['USD', 'ARS', 'CLP', 'MXN', 'EUR', current]));
        return `<select class="wo-select" name="currency">${codes.map((c) => `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
    }
    function readMinutes(data) {
        const total = (parseInt(data.hours, 10) || 0) * 60 + (parseInt(data.minutes, 10) || 0);
        return total;
    }
    function readAmount(value) {
        const amount = M.numberFrom(value);
        if (amount == null || amount <= 0) throw userError('Ingresá un monto válido.');
        return amount;
    }
    function readDateTime(value, required) {
        if (!value) {
            if (required) throw userError('Elegí fecha y hora.');
            return null;
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw userError('La fecha no es válida.');
        return date.toISOString();
    }

    /* ------------------------------------ datos ------------------------------------ */
    function view() {
        if (state.scenario) {
            return {
                quote: state.scenario.quote,
                sessions: state.scenario.sessions,
                history: state.scenario.history,
                disputes: state.scenario.disputes,
                stage: state.scenario.stage,
                readOnly: true,
                key: params.get('estado'),
            };
        }
        const quote = state.quote;
        return {
            quote,
            sessions: state.sessions,
            history: state.history,
            disputes: state.disputes,
            stage: M.deriveStage(quote, state.sessions, state.disputes),
            readOnly: false,
        };
    }
    function guardWrite() {
        if (!state.scenario) return true;
        showToast('Vista de estado simulada: las acciones están deshabilitadas. Abrí la cotización sin ?estado= para operar.', { error: true });
        return false;
    }

    async function findQuote() {
        const repo = D().QuotationDetail;
        if (repo && state.identifier) {
            const row = await repo.findForArtist(state.user.id, state.identifier);
            if (row) return row;
        }
        const rows = await D().Quotations.listForArtist(state.user.id, { excludeArchived: false, excludeInProgress: false });
        if (!state.identifier) return rows[0] || null;
        return rows.find((row) => String(row.id) === state.identifier || String(row.quote_id) === state.identifier) || null;
    }

    async function refreshSecondaryData() {
        const quote = state.quote;
        const data = D();
        const disputesTask = data.QuotationDetail
            ? data.QuotationDetail.listDisputes(quote.id).catch(() => ({ available: false, rows: [] }))
            : Promise.resolve({ available: false, rows: [] });
        const [attachments, sessions, messages, history, disputes] = await Promise.all([
            data.Attachments.listByQuoteIds([quote.quote_id]).catch(() => []),
            data.Sessions.listForQuote(quote.id).catch(() => []),
            data.Chat.listByQuote(quote.quote_id).catch(() => []),
            data.StatusHistory ? data.StatusHistory.listForQuotation(quote.id).catch(() => []) : Promise.resolve([]),
            disputesTask,
        ]);
        Object.assign(state, {
            attachments, sessions, messages, history,
            disputes: disputes.rows || [],
            disputesAvailable: disputes.available !== false,
        });
    }

    async function reloadAll() {
        const fresh = await findQuote().catch(() => null);
        if (fresh) state.quote = fresh;
        await refreshSecondaryData();
        buildScenario();
        render();
    }

    function buildScenario() {
        const key = params.get('estado');
        state.scenario = null;
        if (!key || !isPreviewEnv() || !M.PREVIEW_STAGES[key]) return;
        const demoPhotos = [1, 2, 3].map((n) => appUrl(`/shared/assets/demo/ref-0${n}.svg`));
        state.scenario = M.previewScenario(key, state.quote, state.sessions, new Date(), demoPhotos);
    }

    function markViewed() {
        const quote = state.quote;
        if (!quote || state.scenario || quote.artist_viewed_at || quote.quote_status !== 'pending') return;
        const repo = D().QuotationDetail;
        if (!repo) return;
        const at = new Date().toISOString();
        repo.updateQuote(quote.id, { artist_viewed_at: at })
            .then((result) => { if (result.patch.artist_viewed_at) quote.artist_viewed_at = at; })
            .catch((error) => console.warn('[quotation-detail] artist_viewed_at', error));
    }

    /* ----------------------------------- render ----------------------------------- */
    function currencyOf(quote) {
        return quote.final_budget_currency || quote.artist_budget_currency || quote.client_budget_currency || 'USD';
    }
    function placeOf(quote) {
        return quote.artist_studio_name || quote.artist_current_city || 'Lugar a confirmar';
    }

    function renderCommandbar(v) {
        const quote = v.quote;
        const meta = M.stageMeta(v.stage);
        const reference = document.getElementById('qd-reference');
        const status = document.getElementById('qd-status');
        reference.textContent = quote.quote_id || `COT-${quote.id}`;
        status.textContent = meta.tag;
        status.className = `qd-status qd-status--${meta.tone}`;
        const actions = M.commandActions(v.stage);
        const toggle = {
            'qd-accept': actions.includes('accept'),
            'qd-reject': actions.includes('reject'),
            'qd-schedule': actions.includes('schedule'),
            'qd-mark-ready': actions.includes('markReady'),
            'qd-dispute-menu': actions.includes('dispute'),
            'qd-contact': actions.includes('contact'),
        };
        Object.keys(toggle).forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.hidden = !toggle[id];
        });
        const contact = document.getElementById('qd-contact');
        if (contact) contact.href = inboxUrl();
        const back = document.getElementById('qd-back');
        if (back) back.href = appUrl('/my-quotations');
        document.title = `WE ÖTZI | ${quote.client_full_name || 'Cotización'} · ${meta.tag}`;
    }

    function identityHtml(v) {
        const q = v.quote;
        const preferred = M.toDate(q.client_preferred_date);
        const tags = [
            [q.client_city_residence, q.client_country].filter(Boolean).join(', '),
            M.styleName(q.tattoo_style) !== 'Sin definir' ? M.styleName(q.tattoo_style) : '',
            q.tattoo_body_part,
            preferred ? `Deseada · ${M.dayMonthYear(preferred)}` : (M.isFlexible(q.client_flexible_dates) ? 'Fecha flexible' : ''),
        ].filter(Boolean);
        return `
            <section class="qd-identity" aria-labelledby="qd-title">
                <div class="qd-avatar" aria-hidden="true">${esc(M.initials(q.client_full_name))}</div>
                <div>
                    <p class="qd-eyebrow">Expediente de cotización</p>
                    <h1 class="qd-title" id="qd-title">${esc(q.client_full_name || 'Cliente')}</h1>
                    <div class="qd-tags">${tags.map((tag) => `<span class="qd-tag">${esc(tag)}</span>`).join('')}</div>
                </div>
            </section>`;
    }

    function referencesHtml(q) {
        const refs = [];
        const seen = new Set();
        state.attachments.forEach((a, i) => {
            const url = a.google_drive_url || a.file_url || a.url || '';
            if (!url || seen.has(url)) return;
            seen.add(url);
            refs.push({ url, name: a.file_name || `Referencia ${i + 1}` });
        });
        (Array.isArray(q.reference_images) ? q.reference_images : []).forEach((url, i) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            refs.push({ url, name: `Referencia ${refs.length + 1}` });
        });
        return Array.from({ length: 3 }, (_, index) => {
            const ref = refs[index];
            if (!ref) {
                return `<div class="qd-reference-card" aria-label="Referencia ${index + 1} sin archivo">
                    ${icon('image', 16)}<strong>Referencia ${index + 1}</strong><small>sin archivo adjunto</small></div>`;
            }
            const href = safeUrl(ref.url);
            const thumb = driveThumbnail(ref.url) || ref.url;
            const more = index === 2 && refs.length > 3 ? ` · +${refs.length - 3}` : '';
            return `<a class="qd-reference-card has-image" href="${esc(href || '#')}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${esc(ref.name)}">
                    <img src="${esc(thumb)}" alt="${esc(ref.name)}" loading="lazy"><span>${esc(ref.name + more)}</span></a>`;
        }).join('');
    }

    function evaluationHtml(v) {
        const q = v.quote;
        const pre = M.isPreAgreement(v.stage);
        const minutes = M.minutesFrom(q.artist_session_minutes);
        const sessions = pre ? M.intFrom(q.tattoo_estimated_sessions) : M.agreedSessions(q);
        let time = 'A definir';
        if (minutes && v.stage === 'pending') time = M.hoursLabel(minutes * (sessions || 1));
        else if (minutes) time = `${M.durationLong(minutes)}${sessions ? ` x ${sessions}` : ''}`;
        else {
            const hours = v.sessions.reduce((sum, s) => sum + (M.numberFrom(s.duration_hours) || 0), 0);
            if (hours) time = M.hoursLabel(hours * 60);
        }
        const closed = ['rejected', 'cancelled', 'expired', 'draft'].includes(v.stage);
        const budgetBlock = pre ? `
            <div class="qd-eval-block">
                <label class="qd-label" for="qd-budget">Presupuesto del artista</label>
                <div class="qd-budget-row">
                    <div class="qd-budget-control">
                        <span class="qd-budget-currency" aria-hidden="true">${esc(M.money(1, q.artist_budget_currency || q.client_budget_currency).charAt(0))}</span>
                        <input id="qd-budget" inputmode="decimal" autocomplete="off" value="${esc(M.numberFrom(q.artist_budget_amount) != null ? M.groupThousands(M.numberFrom(q.artist_budget_amount)) : '')}" placeholder="Tu presupuesto" ${closed ? 'disabled' : ''}>
                    </div>
                    <button class="qd-budget-save" type="button" data-action="save-budget" ${closed ? 'disabled' : ''}>Guardar</button>
                </div>
            </div>` : `
            <div class="qd-final-budget">
                <div>
                    <span class="qd-label">Presupuesto final acordado</span>
                    <strong>${esc(M.money(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount, currencyOf(q)))}</strong>
                </div>
                <button type="button" data-action="history">Valores anteriores en el historial</button>
            </div>`;
        return `
            <div class="qd-evaluation">
                <p class="qd-section-label">Tu evaluación</p>
                ${budgetBlock}
                <div class="qd-eval-facts">
                    <div class="qd-eval-fact"><span class="qd-label">Tiempo estimado</span><span class="qd-eval-value">${esc(time)}</span></div>
                    <div class="qd-eval-fact"><span class="qd-label">Sesiones</span><span class="qd-eval-value">${esc(sessions || '—')}</span></div>
                    <div class="qd-eval-fact"><span class="qd-label">Disponibilidad</span><span class="qd-eval-copy">${esc(q.artist_availability || 'A coordinar con el cliente')}</span></div>
                    <div class="qd-eval-fact"><span class="qd-label">Fecha deseada</span><span class="qd-eval-copy">${esc(M.preferredDateLabel(q))}</span></div>
                </div>
                <div class="qd-private">
                    <label class="qd-label" for="qd-private-notes">Notas privadas · solo vos</label>
                    <button class="qd-open-notes" type="button" data-action="open-notes">Abrir notas</button>
                    <textarea id="qd-private-notes" placeholder="Agregá contexto privado para esta cotización" ${v.readOnly ? 'readonly' : ''}>${esc(q.notes || '')}</textarea>
                    <p class="qd-private-status" id="qd-private-status" aria-live="polite"></p>
                </div>
            </div>`;
    }

    function dossierHtml(v) {
        const q = v.quote;
        const currency = q.client_budget_currency || 'USD';
        const clientBudget = (q.client_budget_min != null || q.client_budget_max != null)
            ? M.moneyRange(q.client_budget_min, q.client_budget_max, currency)
            : M.money(q.client_budget_amount, currency);
        return `
            <section class="qd-dossier" aria-label="Propuesta y evaluación">
                <div class="qd-proposal">
                    <p class="qd-section-label">La propuesta</p>
                    <div class="qd-proposal-copy">
                        <img class="qd-quote-mark" src="${esc(appUrl('/shared/assets/quotation-detail-quote-mark.svg'))}" alt="" width="16" height="14">
                        <p>${esc(q.tattoo_idea_description || q.project_description || 'Sin descripción')}</p>
                    </div>
                    <div class="qd-facts">
                        <div class="qd-fact"><span class="qd-label">Zona del cuerpo</span><span class="qd-fact-value">${esc(M.bodyZone(q) || '—')}</span></div>
                        <div class="qd-fact"><span class="qd-label">Estilo</span><span class="qd-fact-value">${esc(M.styleName(q.tattoo_style))}</span></div>
                        <div class="qd-fact"><span class="qd-label">Tamaño estimado</span><span class="qd-fact-value">${esc(q.tattoo_size || '—')}</span></div>
                        <div class="qd-fact"><span class="qd-label">Presupuesto del cliente</span><span class="qd-fact-value">${esc(clientBudget)}</span></div>
                    </div>
                    <div class="qd-references">
                        <p class="qd-label">Referencias e imágenes adjuntas</p>
                        <div class="qd-reference-grid">${referencesHtml(q)}</div>
                    </div>
                </div>
                ${evaluationHtml(v)}
            </section>`;
    }

    function agreementHtml(v) {
        if (!M.showsAgreement(v.stage)) return '';
        const q = v.quote;
        const first = M.firstSessionDate(v.sessions);
        const items = [
            ['Presupuesto final', M.money(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount, currencyOf(q)), true],
            ['Sesiones acordadas', M.agreedSessions(q) || '—'],
            ['Duración estimada', M.durationShort(q.artist_session_minutes) || '—'],
            ['Primera sesión', first ? M.dateTime(first) : 'Sin agendar'],
        ];
        return `
            <section class="qd-agreement" aria-label="Acuerdo aprobado">
                <p class="qd-panel-kicker">Acuerdo aprobado</p>
                <div class="qd-agreement-grid">
                    ${items.map(([label, value, xl]) => `
                        <div class="qd-agreement-item"><span class="qd-label">${esc(label)}</span><span class="qd-agreement-value${xl ? ' qd-agreement-value--xl' : ''}">${esc(value)}</span></div>`).join('')}
                    <div class="qd-agreement-item"><span class="qd-label">Estudio</span><span class="qd-agreement-copy">${esc(placeOf(q))}</span></div>
                </div>
                ${q.final_comment ? `<p class="qd-agreement-note">${icon('message-circle', 15)}<span>${esc(q.final_comment)}</span></p>` : ''}
            </section>`;
    }

    function sessionRowHtml(v, slot) {
        const q = v.quote;
        const s = slot.session;
        const actions = M.sessionRowActions(v.stage, slot, new Date());
        const badge = {
            done: ['done', 'Realizada'],
            scheduled: ['scheduled', s && s.status === 'rescheduled' ? 'Reprogramada' : 'Agendada'],
            unscheduled: ['unscheduled', 'Sin agendar'],
        }[slot.state];
        const photos = s && Array.isArray(s.photo_urls) ? s.photo_urls.length : 0;
        const buttons = actions.map((action) => {
            if (action === 'view') return `<a class="qd-btn" href="${esc(calendarUrl(s && s.session_date, { session: s && s.id, quote: true }))}">Ver sesión</a>`;
            if (action === 'plan') return `<button class="qd-btn" type="button" data-action="session-schedule" data-slot="${slot.number}">Ver sesión</button>`;
            if (action === 'reschedule') return `<button class="qd-btn qd-btn--quiet" type="button" data-action="session-reschedule" data-session-id="${esc(s.id)}" data-slot="${slot.number}">Reprogramar</button>`;
            if (action === 'complete') return `<button class="qd-btn qd-btn--success" type="button" data-action="session-complete" data-session-id="${esc(s.id)}" data-slot="${slot.number}">Marcar realizada</button>`;
            if (action === 'schedule') return `<button class="qd-btn qd-btn--info" type="button" data-action="session-schedule" data-slot="${slot.number}">Agendar sesión</button>`;
            return '';
        }).join('');
        const correction = s && /corrección/i.test(s.notes || '');
        return `
            <div class="qd-session is-${slot.state}">
                <span class="qd-session-number" aria-hidden="true">${slot.number}</span>
                <div class="qd-session-copy">
                    <span class="qd-label">Sesión ${slot.number} de ${slot.total}</span>
                    <strong class="qd-session-date">${esc(s && s.session_date ? M.dateTime(s.session_date) : 'Sin fecha asignada')}</strong>
                    <span class="qd-session-place">${esc(placeOf(q))}</span>
                </div>
                <div class="qd-session-side">
                    ${slot.extra || correction ? `<span class="qd-badge qd-badge--extra">${correction ? 'Corrección' : 'Fuera del acuerdo'}</span>` : ''}
                    <span class="qd-badge qd-badge--${badge[0]}">${badge[1]}</span>
                    ${slot.state === 'done' && photos ? `<span class="qd-photos">${icon('image', 13)}${photos} ${photos === 1 ? 'foto' : 'fotos'}</span>` : ''}
                    ${buttons ? `<div class="qd-session-actions">${buttons}</div>` : ''}
                </div>
            </div>`;
    }

    function sessionsHtml(v) {
        if (!M.showsSessions(v.stage)) return '';
        const q = v.quote;
        const slots = M.sessionSlots(q, v.sessions);
        const counts = M.slotCounts(slots);
        const agreed = M.agreedSessions(q) || slots.length;
        const editable = ['approved', 'in_progress', 'ready'].includes(v.stage);
        const bars = slots.map((s) => `<span class="${s.state === 'done' ? 'is-done' : s.state === 'scheduled' ? 'is-scheduled' : ''}"></span>`).join('');
        return `
            <section class="qd-sessions" id="qd-sessions" aria-labelledby="qd-sessions-title">
                <div class="qd-sessions-head">
                    <div>
                        <p class="qd-kicker">Sesiones del proyecto</p>
                        <h2 class="qd-sessions-title" id="qd-sessions-title">${esc(M.sessionsLabel(agreed) || 'Sin sesiones')} ${agreed === 1 ? 'acordada' : 'acordadas'}</h2>
                        <p class="qd-sessions-summary">${counts.done} ${counts.done === 1 ? 'realizada' : 'realizadas'} · ${counts.scheduled} ${counts.scheduled === 1 ? 'agendada' : 'agendadas'} · ${counts.pending} ${counts.pending === 1 ? 'pendiente' : 'pendientes'}</p>
                    </div>
                    <div class="qd-progress" aria-label="Avance ${counts.percent}%">
                        <div class="qd-progress-bars" aria-hidden="true">${bars}</div>
                        <span class="qd-progress-value">${counts.percent}%</span>
                    </div>
                </div>
                <div class="qd-session-list">${slots.map((slot) => sessionRowHtml(v, slot)).join('') || '<p class="qd-empty">Todavía no hay sesiones.</p>'}</div>
                <p class="qd-sessions-note">No podés agendar más de ${esc(M.sessionsLabel(agreed) || '0 sesiones')}: es la cantidad aprobada en el acuerdo. Para cambiarla, ${editable ? '<button class="qd-inline-link" type="button" data-action="edit-agreement">editá el acuerdo</button>' : 'editá el acuerdo'}.</p>
            </section>`;
    }

    function photoTile(label, url) {
        if (!url) return `<div class="qd-photo-tile">${icon('image', 18)}<span>${esc(label)}</span></div>`;
        // Sin href hasta que resolvePhotos() obtenga la URL (firmada o pública).
        return `<a class="qd-photo-tile has-image" data-photo-link target="_blank" rel="noopener noreferrer">
            <img alt="${esc(label)}" data-photo-src="${esc(url)}" loading="lazy">${icon('image', 18)}<span>${esc(label)}</span></a>`;
    }

    function closeoutHtml(v) {
        if (v.stage !== 'completed') return '';
        const q = v.quote;
        const slots = M.sessionSlots(q, v.sessions);
        const done = slots.filter((s) => s.state === 'done');
        const first = done[0] && done[0].session ? done[0].session.session_date : null;
        const last = done.length ? done[done.length - 1].session.session_date : null;
        const tiles = done.map((slot) => photoTile(`Sesión ${slot.number}`, (slot.session.photo_urls || [])[0]));
        const lastPhotos = done.length ? (done[done.length - 1].session.photo_urls || []) : [];
        tiles.push(photoTile('Final', lastPhotos[lastPhotos.length - 1]));
        return `
            <section class="qd-closeout" aria-label="Proyecto completado">
                <p class="qd-panel-kicker qd-panel-kicker--round">Proyecto completado · aprobado por el cliente</p>
                <div class="qd-closeout-grid">
                    <div><span class="qd-label">Presupuesto final</span><strong class="qd-closeout-value qd-closeout-value--accent">${esc(M.money(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount, currencyOf(q)))}</strong></div>
                    <div><span class="qd-label">Sesiones realizadas</span><strong class="qd-closeout-value">${done.length} de ${slots.length || done.length}</strong></div>
                    <div><span class="qd-label">Inicio</span><strong class="qd-closeout-value">${esc(first ? M.dayMonthYear(first) : '—')}</strong></div>
                    <div><span class="qd-label">Finalización</span><strong class="qd-closeout-value">${esc(last ? M.dayMonthYear(last) : '—')}</strong></div>
                    <div><span class="qd-label">Aprobada por el cliente</span><strong class="qd-closeout-value qd-closeout-value--success">${esc(q.client_completed_at ? M.dayMonthYear(q.client_completed_at) : '—')}</strong></div>
                </div>
                <div class="qd-closeout-photos">${tiles.join('')}</div>
                <div class="qd-closeout-actions">
                    <button class="qd-btn qd-btn--accent" type="button" data-action="download-summary">Descargar resumen</button>
                    <button class="qd-btn qd-btn--dark" type="button" data-action="archive">${q.is_archived ? 'Desarchivar' : 'Archivar'}</button>
                </div>
            </section>`;
    }

    function disputeHtml(v) {
        if (v.stage !== 'dispute') return '';
        const d = M.openDispute(v.quote, v.disputes) || {};
        const missing = d.synthetic;
        const evidence = Array.isArray(d.evidence) ? d.evidence : [];
        return `
            <section class="qd-dispute" id="qd-dispute" aria-labelledby="qd-dispute-title">
                <p class="qd-panel-kicker qd-panel-kicker--alert">En disputa${d.created_at ? ` · abierta ${esc(M.dayMonthYear(d.created_at))}` : ''}</p>
                <h2 class="qd-dispute-title" id="qd-dispute-title">${esc(missing ? 'El cliente abrió una disputa sobre la entrega' : d.title)}</h2>
                <p class="qd-dispute-copy">${esc(missing ? 'Soporte está revisando el caso. El detalle todavía no está disponible en esta cuenta.' : d.description)}</p>
                ${evidence.length ? `<div class="qd-evidence">${evidence.map((e) => {
                    const href = safeUrl(e && e.url);
                    const name = (e && e.name) || 'archivo';
                    return href
                        ? `<a class="qd-evidence-chip" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${icon('paperclip', 13)}${esc(name)}</a>`
                        : `<span class="qd-evidence-chip">${icon('paperclip', 13)}${esc(name)}</span>`;
                }).join('')}</div>` : ''}
                ${d.artist_response ? `<div class="qd-dispute-response"><span class="qd-label">Tu respuesta${d.artist_responded_at ? ` · ${esc(M.dayMonthYear(d.artist_responded_at))}` : ''}</span><p>${esc(d.artist_response)}</p></div>` : ''}
                <p class="qd-dispute-foot">La entrega no se marca como completada mientras la disputa esté abierta.</p>
            </section>`;
    }

    function timelineHtml(v) {
        const steps = M.timeline(v.quote, v.history, v.stage, v.sessions);
        const events = M.historyEvents(v.quote, v.history, v.sessions, v.disputes);
        const ruled = M.showsSessions(v.stage);
        return `
            <section class="qd-timeline-section${ruled ? ' has-rule' : ''}" aria-labelledby="qd-timeline-title">
                <p class="qd-kicker" id="qd-timeline-title">Timeline de la cotización</p>
                <ol class="qd-timeline" role="list">
                    ${steps.map((step) => `
                        <li class="qd-timeline-step is-${step.state}${step.alert ? ' is-alert' : ''}"${step.state === 'current' ? ' aria-current="step"' : ''}>
                            <span class="qd-timeline-track" aria-hidden="true"><span class="qd-timeline-mark"></span><span class="qd-timeline-line"></span></span>
                            <span class="qd-timeline-date">${esc(step.date)}</span>
                            <strong class="qd-timeline-status">${esc(step.label)}</strong>
                        </li>`).join('')}
                </ol>
                <div class="qd-history" id="qd-history">
                    <p class="qd-kicker">Historial de cambios</p>
                    ${events.map((e) => `<div class="qd-history-row"><span class="qd-history-date">${esc(e.date)}</span><span class="qd-history-copy">${esc(e.text)}</span></div>`).join('')}
                </div>
            </section>`;
    }

    function messagesListHtml(q) {
        if (!state.messages.length) {
            return q.client_user_id
                ? '<p class="qd-empty">Todavía no hay mensajes. Iniciá la conversación con el cliente.</p>'
                : '<p class="qd-empty">El chat se habilita cuando el cliente crea su cuenta.</p>';
        }
        return state.messages.slice(-6).map((message) => {
            const artist = message.sender_type === 'artist';
            const author = artist ? 'Vos' : (q.client_full_name || 'Cliente');
            return `
                <article class="qd-message${artist ? ' qd-message--artist' : ''}">
                    <span class="qd-message-meta">${esc(author)} · ${esc(M.chatStamp(message.created_at))}</span>
                    <p>${esc(message.message || '')}</p>
                </article>`;
        }).join('');
    }

    function messagesHtml(v) {
        const q = v.quote;
        return `
            <section class="qd-messages" aria-labelledby="qd-messages-title">
                <p class="qd-section-label" id="qd-messages-title">Mensajes con el cliente</p>
                <div class="qd-message-list" id="qd-message-list">${messagesListHtml(q)}</div>
                ${q.client_user_id ? `
                    <form class="qd-compose" id="qd-compose">
                        <input id="qd-message" autocomplete="off" placeholder="Escribí un mensaje..." aria-label="Mensaje al cliente" maxlength="2000">
                        <button type="submit">Enviar ${icon('send', 18)}</button>
                    </form>` : ''}
                <a class="qd-chat-link" href="${esc(inboxUrl())}">Ver chat completo ${icon('arrow-right', 18)}</a>
            </section>`;
    }

    // ?estado= (solo preview): aviso pasajero en lugar de un bloque en el layout,
    // así las capturas por estado quedan iguales al frame.
    function announcePreviewScenario() {
        const v = view();
        if (!v.readOnly) return;
        showToast(`Vista previa del estado "${v.key}": datos simulados en memoria, acciones deshabilitadas.`);
    }

    function render() {
        const v = view();
        renderCommandbar(v);
        const root = document.getElementById('quotation-detail-root');
        root.innerHTML = [
            identityHtml(v),
            dossierHtml(v),
            agreementHtml(v),
            sessionsHtml(v),
            closeoutHtml(v),
            disputeHtml(v),
            timelineHtml(v),
            messagesHtml(v),
        ].join('');
        hydrateIcons(root);
        resolvePhotos(root);
    }

    async function resolvePhotos(root) {
        const repo = D().QuotationDetail;
        const imgs = Array.from(root.querySelectorAll('img[data-photo-src]'));
        await Promise.all(imgs.map(async (img) => {
            const raw = img.getAttribute('data-photo-src');
            const url = repo ? await repo.photoUrl(raw) : (/^(https?:|\/)/.test(raw) ? raw : null);
            const tile = img.closest('.qd-photo-tile');
            if (!url) {
                // Sin URL firmada (bucket sin migración o error): la miniatura deja
                // de ser un enlace para no abrir la misma página en otra pestaña.
                img.remove();
                if (tile) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'qd-photo-tile';
                    placeholder.innerHTML = tile.innerHTML;
                    tile.replaceWith(placeholder);
                }
                return;
            }
            img.src = url;
            if (tile && tile.tagName === 'A') tile.href = url;
        }));
    }

    function renderError(message) {
        const root = document.getElementById('quotation-detail-root');
        root.innerHTML = `<div class="qd-error"><p>${esc(message)}</p><a class="qd-chat-link" href="${esc(appUrl('/my-quotations'))}">Volver a cotizaciones ${icon('arrow-right', 18)}</a></div>`;
        document.querySelectorAll('.qd-commandbar-actions > *').forEach((el) => { el.hidden = true; });
        document.getElementById('qd-reference').textContent = '—';
        document.getElementById('qd-status').hidden = true;
    }

    /* ----------------------------------- acciones ----------------------------------- */
    function nowIso() { return new Date().toISOString(); }
    function privateNotesValue() {
        const el = document.getElementById('qd-private-notes');
        return el ? (el.value.trim() || null) : (state.quote.notes || null);
    }
    async function updateQuote(input) {
        // updated_at acompaña cada cambio de estado (el trigger del backend lo
        // pisa con NOW(); sin trigger, fecha el evento del historial).
        const patch = 'quote_status' in input ? Object.assign({ updated_at: nowIso() }, input) : input;
        const repo = D().QuotationDetail;
        if (repo) return repo.updateQuote(state.quote.id, patch);
        await D().Quotations.updateById(state.quote.id, patch);
        return { patch, dropped: [] };
    }
    function eventBase() {
        const q = state.quote;
        return {
            quote_id: q.quote_id, client_name: q.client_full_name || '', client_email: q.client_email || '',
            artist_name: q.artist_name || '', tattoo_style: M.styleName(q.tattoo_style), tattoo_size: q.tattoo_size || '',
            tattoo_body_part: q.tattoo_body_part || '',
        };
    }

    async function saveBudget(button) {
        if (!guardWrite()) return;
        const input = document.getElementById('qd-budget');
        const raw = input ? input.value.trim() : '';
        const amount = raw ? M.numberFrom(raw) : null;
        if (raw && (amount == null || amount <= 0)) { showToast('Ingresá un monto válido.', { error: true }); return; }
        setBusy(button, true);
        try {
            await updateQuote({
                artist_budget_amount: amount,
                artist_budget_currency: state.quote.artist_budget_currency || state.quote.client_budget_currency || 'USD',
                notes: privateNotesValue(),
            });
            Object.assign(state.quote, { artist_budget_amount: amount, notes: privateNotesValue() });
            if (input && amount != null) input.value = M.groupThousands(amount);
            showToast('Evaluación guardada.');
        } catch (error) {
            console.error('[quotation-detail] save budget', error);
            showToast('No pudimos guardar la evaluación.', { error: true });
        } finally {
            setBusy(button, false);
        }
    }

    function scheduleNotesSave() {
        if (state.scenario) return;
        window.clearTimeout(state.notesTimer);
        const status = document.getElementById('qd-private-status');
        if (status) status.textContent = 'Sin guardar…';
        state.notesTimer = window.setTimeout(savePrivateNotes, 900);
    }
    async function savePrivateNotes() {
        window.clearTimeout(state.notesTimer);
        if (state.scenario || !state.quote) return;
        const value = privateNotesValue();
        if ((value || null) === (state.quote.notes || null)) {
            const status = document.getElementById('qd-private-status');
            if (status && status.textContent === 'Sin guardar…') status.textContent = '';
            return;
        }
        const status = document.getElementById('qd-private-status');
        if (status) status.textContent = 'Guardando…';
        try {
            await updateQuote({ notes: value });
            state.quote.notes = value;
            if (status) status.textContent = 'Nota privada guardada';
        } catch (error) {
            console.error('[quotation-detail] private notes', error);
            if (status) status.textContent = 'No se pudo guardar la nota';
        }
    }

    function openRespondDialog() {
        if (!guardWrite()) return;
        const q = state.quote;
        const budgetInput = document.getElementById('qd-budget');
        const amount = (budgetInput && budgetInput.value.trim()) || (M.numberFrom(q.artist_budget_amount) != null ? M.groupThousands(M.numberFrom(q.artist_budget_amount)) : '');
        openDialog({
            title: 'Aceptar y enviar presupuesto',
            intro: 'El cliente recibe tu presupuesto, las sesiones y la duración estimada. Podés ajustarlo antes del acuerdo final.',
            submitLabel: 'Enviar respuesta',
            submitClass: 'wo-btn--accent',
            body: `<div class="qd-dialog-grid">
                ${field('Presupuesto', `<input class="wo-input" name="amount" inputmode="decimal" value="${esc(amount)}" placeholder="410.000" required>`)}
                ${field('Moneda', currencySelect(q.artist_budget_currency || q.client_budget_currency))}
                ${field('Sesiones', `<input class="wo-input" name="sessions" type="number" min="1" max="30" value="${esc(M.intFrom(q.tattoo_estimated_sessions) || 1)}" required>`)}
                <span></span>
                ${durationFields(M.minutesFrom(q.artist_session_minutes) || 120)}
                ${field('Disponibilidad', `<input class="wo-input" name="availability" maxlength="140" value="${esc(q.artist_availability || '')}" placeholder="Fines de semana, desde agosto">`, true)}
                ${q.client_user_id ? field('Mensaje para el cliente (opcional)', '<textarea class="wo-textarea" name="message" maxlength="2000" placeholder="Contale cómo vas a encarar el diseño."></textarea>', true) : ''}
            </div>`,
            onSubmit: async (form, data) => {
                const value = readAmount(data.amount);
                const sessions = M.intFrom(data.sessions);
                if (!sessions) throw userError('Indicá cuántas sesiones estimás.');
                const minutes = readMinutes(data);
                if (minutes < 15) throw userError('La duración por sesión tiene que ser de al menos 15 minutos.');
                const patch = {
                    quote_status: 'responded',
                    artist_budget_amount: value,
                    artist_budget_currency: data.currency || 'USD',
                    tattoo_estimated_sessions: sessions,
                    artist_session_minutes: minutes,
                    artist_availability: (data.availability || '').trim() || null,
                    artist_responded_at: nowIso(),
                    notes: privateNotesValue(),
                };
                await updateQuote(patch);
                const message = (data.message || '').trim();
                if (message && q.client_user_id) {
                    await D().Chat.sendMessage({ quoteId: q.quote_id, senderType: 'artist', senderId: state.user.id, message })
                        .catch((error) => console.warn('[quotation-detail] respond message', error));
                }
                notify('artist_responded_quotation', Object.assign(eventBase(), {
                    artist_budget_amount: value, artist_budget_currency: patch.artist_budget_currency, estimated_sessions: sessions,
                    client_budget: `${q.client_budget_amount || ''} ${q.client_budget_currency || ''}`.trim(),
                }));
                await reloadAll();
                showToast('Respuesta enviada al cliente.');
            },
        });
    }

    async function rejectQuote() {
        if (!guardWrite()) return;
        const ok = await confirmDialog({
            title: '¿Rechazar esta solicitud?',
            message: 'La solicitud queda rechazada y el cambio se registra en el historial.',
            confirmLabel: 'Rechazar',
            danger: true,
        });
        if (!ok) return;
        try {
            await updateQuote({ quote_status: 'cancelled' });
            await reloadAll();
            showToast('Solicitud rechazada.');
        } catch (error) {
            console.error('[quotation-detail] reject', error);
            showToast('No pudimos rechazar la solicitud.', { error: true });
        }
    }

    function openAgreementDialog(edit) {
        if (!guardWrite()) return;
        const q = state.quote;
        const existing = M.orderedSessions(state.sessions).length;
        const sessions = M.agreedSessions(q) || 1;
        const amount = M.numberFrom(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount);
        openDialog({
            title: edit ? 'Editar acuerdo' : 'Confirmar acuerdo y agendar',
            intro: edit
                ? 'Ajustá lo que acordaste con el cliente. No podés acordar menos sesiones de las que ya agendaste.'
                : 'Registrá lo que acordaste con el cliente. Se agenda la primera sesión y se habilita la gestión del proyecto.',
            submitLabel: edit ? 'Guardar acuerdo' : 'Confirmar acuerdo',
            submitClass: 'wo-btn--accent',
            body: `<div class="qd-dialog-grid">
                ${field('Presupuesto final', `<input class="wo-input" name="amount" inputmode="decimal" value="${esc(amount != null ? M.groupThousands(amount) : '')}" required>`)}
                ${field('Moneda', currencySelect(currencyOf(q)))}
                ${field('Sesiones acordadas', `<input class="wo-input" name="sessions" type="number" min="${Math.max(1, existing)}" max="30" value="${esc(sessions)}" required>`)}
                <span></span>
                ${durationFields(M.minutesFrom(q.artist_session_minutes) || 120)}
                ${edit ? '' : field('Primera sesión', `<input class="wo-input" name="first" type="datetime-local" required>`, true)}
                ${field('Comentario del acuerdo (opcional)', `<textarea class="wo-textarea" name="comment" maxlength="600" placeholder="Va a llevar un amigo. Solicita anestesia.">${esc(q.final_comment || '')}</textarea>`, true)}
            </div>`,
            onSubmit: async (form, data) => {
                const value = readAmount(data.amount);
                const count = M.intFrom(data.sessions);
                if (!count) throw userError('Indicá cuántas sesiones acordaron.');
                if (count < existing) throw userError(`Ya hay ${existing} sesiones cargadas: no podés acordar menos.`);
                const minutes = readMinutes(data);
                if (minutes < 15) throw userError('La duración por sesión tiene que ser de al menos 15 minutos.');
                const first = edit ? null : readDateTime(data.first, true);
                const patch = {
                    final_budget_amount: value,
                    final_budget_currency: data.currency || 'USD',
                    final_sessions: count,
                    final_comment: (data.comment || '').trim() || null,
                    artist_session_minutes: minutes,
                };
                if (!edit) patch.quote_status = 'client_approved';
                await updateQuote(patch);
                let created = null;
                if (!edit) {
                    created = await D().QuotationDetail.createSession({
                        quotation_id: q.id, session_number: null, session_date: first,
                        duration_hours: Math.round((minutes / 60) * 100) / 100, status: 'scheduled', notes: null,
                    });
                    notify('client_approved_quotation', Object.assign(eventBase(), {
                        final_budget_amount: value, final_budget_currency: patch.final_budget_currency, final_sessions: count,
                        first_session_date: first, final_comment: patch.final_comment || '',
                    }));
                    notify('session_scheduled', Object.assign(eventBase(), { session_id: created && created.id, session_date: first, session_number: String((created && created.session_number) || 1), duration_hours: String(minutes / 60) }));
                }
                await reloadAll();
                showToast(edit ? 'Acuerdo actualizado.' : 'Acuerdo confirmado y primera sesión agendada.', edit ? {} : { link: { href: calendarUrl(first, { session: created && created.id, quote: true }), label: 'Ver en el calendario →' } });
            },
        });
    }

    function openScheduleDialog(slotNumber, opts = {}) {
        if (!guardWrite()) return;
        const q = state.quote;
        const slots = M.sessionSlots(q, state.sessions);
        const pending = slots.filter((s) => s.state === 'unscheduled');
        if (!opts.correction && !pending.length) {
            // Sin ?quote=: con la cotización el calendario abre el editor de un turno
            // nuevo, y el acuerdo ya no admite más sesiones.
            const last = slots.map((s) => s.session && s.session.session_date).filter(Boolean).sort().pop();
            showToast(`Ya agendaste ${M.sessionsLabel(M.agreedSessions(q))} del acuerdo. Para sumar otra, editá el acuerdo.`, { error: true, link: { href: calendarUrl(last || null), label: 'Abrir calendario →' } });
            return;
        }
        const slot = opts.correction ? null : (slots.find((s) => s.number === Number(slotNumber) && s.state === 'unscheduled') || pending[0]);
        const minutes = M.minutesFrom(q.artist_session_minutes) || 120;
        openDialog({
            title: opts.correction ? 'Agendar sesión de corrección' : `Agendar sesión ${slot.number} de ${slot.total}`,
            intro: opts.correction
                ? 'La sesión de corrección se suma fuera del acuerdo y queda visible para soporte mientras la disputa siga abierta.'
                : 'La sesión aparece en tu calendario y el cliente recibe la confirmación.',
            submitLabel: 'Agendar sesión',
            submitClass: 'wo-btn--direct',
            body: `<div class="qd-dialog-grid">
                ${field('Fecha y hora', '<input class="wo-input" name="date" type="datetime-local" required>', true)}
                ${field('Duración (horas)', `<input class="wo-input" name="duration" type="number" min="0.25" max="12" step="0.25" value="${esc(Math.round((minutes / 60) * 100) / 100)}">`)}
                <span></span>
                ${field('Nota (opcional)', `<textarea class="wo-textarea" name="note" maxlength="500" placeholder="${opts.correction ? 'Retoque del relleno lumbar.' : 'Traer la crema indicada.'}"></textarea>`, true)}
            </div>`,
            onSubmit: async (form, data) => {
                const date = readDateTime(data.date, true);
                const duration = M.numberFrom(data.duration);
                const note = (data.note || '').trim();
                const created = await D().QuotationDetail.createSession({
                    quotation_id: q.id, session_number: null, session_date: date,
                    duration_hours: duration && duration > 0 ? duration : null, status: 'scheduled',
                    notes: opts.correction ? `Sesión de corrección${note ? ` · ${note}` : ''}` : (note || null),
                });
                notify('session_scheduled', Object.assign(eventBase(), { session_id: created && created.id, session_date: date, session_number: String((created && created.session_number) || (slot ? slot.number : '')), duration_hours: String(duration || '') }));
                await reloadAll();
                showToast('Sesión agendada.', { link: { href: calendarUrl(date, { session: created && created.id, quote: true }), label: 'Ver en el calendario →' } });
            },
        });
    }

    function findSession(id) {
        return state.sessions.find((s) => String(s.id) === String(id)) || null;
    }

    function openRescheduleDialog(sessionId, slotNumber) {
        if (!guardWrite()) return;
        const session = findSession(sessionId);
        if (!session) return;
        const number = slotNumber || session.session_number || '';
        openDialog({
            title: `Reprogramar sesión ${number}`.trim(),
            intro: `Fecha actual: ${M.dateTime(session.session_date)}. El cliente recibe la nueva fecha.`,
            submitLabel: 'Reprogramar',
            body: `<div class="qd-dialog-grid">
                ${field('Nueva fecha y hora', `<input class="wo-input" name="date" type="datetime-local" value="${esc(M.localInputValue(session.session_date))}" required>`, true)}
            </div>`,
            onSubmit: async (form, data) => {
                const date = readDateTime(data.date, true);
                await D().QuotationDetail.updateSession(session.id, { session_date: date, status: 'rescheduled' });
                notify('session_rescheduled', Object.assign(eventBase(), { session_id: session.id, session_date: date, session_number: String(session.session_number || '') }));
                await reloadAll();
                showToast('Sesión reprogramada.', { link: { href: calendarUrl(date, { session: session.id, quote: true }), label: 'Ver en el calendario →' } });
            },
        });
    }

    function openCompleteDialog(sessionId, slotNumber) {
        if (!guardWrite()) return;
        const session = findSession(sessionId);
        if (!session) return;
        const number = slotNumber || session.session_number || '';
        const q = state.quote;
        const hours = M.numberFrom(session.duration_hours) || (M.minutesFrom(q.artist_session_minutes) || 120) / 60;
        // Una sesión agendada para más adelante (otro día o más tarde hoy) que se
        // registra ahora pasó ahora: se guarda con la fecha y hora actuales, así el
        // historial, la fila y el calendario no quedan con horas futuras ni fuera de orden.
        const ahead = new Date(session.session_date).getTime() > Date.now();
        openDialog({
            title: `Marcar sesión ${number} como realizada`.replace(/\s+/g, ' '),
            intro: ahead
                ? `Estaba agendada para el ${M.dateTime(session.session_date)}: queda registrada con la fecha y hora de ahora. Registrá cuánto duró y sumá fotos del avance. Solo vos y soporte ven las fotos.`
                : 'Registrá cuánto duró y sumá fotos del avance. Solo vos y soporte ven las fotos.',
            submitLabel: 'Marcar realizada',
            submitClass: 'wo-btn--accent',
            body: `<div class="qd-dialog-grid">
                ${field('Duración real (horas)', `<input class="wo-input" name="duration" type="number" min="0.25" max="12" step="0.25" value="${esc(Math.round(hours * 100) / 100)}" required>`)}
                ${field('Fotos de avance', '<input class="wo-input" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple>')}
                ${field('Nota de la sesión (opcional)', `<textarea class="wo-textarea" name="note" maxlength="1000">${esc(session.notes || '')}</textarea>`, true)}
            </div>`,
            onSubmit: async (form, data) => {
                const duration = M.numberFrom(data.duration);
                if (!duration || duration <= 0) throw userError('Indicá la duración de la sesión.');
                const files = Array.from((form.querySelector('[name="photos"]') || {}).files || []).slice(0, 12);
                const paths = [];
                let failed = 0;
                for (const file of files) {
                    try {
                        paths.push(await D().QuotationDetail.uploadSessionPhoto(file, { artistId: state.user.id, quotationId: q.id, sessionId: session.id }));
                    } catch (error) {
                        failed += 1;
                        console.warn('[quotation-detail] photo upload', error);
                    }
                }
                const photos = (Array.isArray(session.photo_urls) ? session.photo_urls : []).concat(paths).slice(0, 12);
                const stageBefore = M.deriveStage(q, state.sessions, state.disputes);
                // Primero el inicio del trabajo (historial: "Trabajo iniciado" antes que
                // "Sesión N registrada"). En disputa el estado no cambia.
                if (q.quote_status === 'client_approved') {
                    await updateQuote({ quote_status: 'in_progress' }).catch((error) => console.warn('[quotation-detail] start work', error));
                }
                const sessionPatch = { status: 'completed', duration_hours: duration, notes: (data.note || '').trim() || null, photo_urls: photos };
                if (ahead) sessionPatch.session_date = nowIso();
                await D().QuotationDetail.updateSession(session.id, sessionPatch);
                notify('session_completed', Object.assign(eventBase(), { session_id: session.id, session_number: String(session.session_number || ''), session_date: sessionPatch.session_date || session.session_date || '' }));
                await reloadAll();
                if (failed) {
                    showToast(`Sesión registrada. No pudimos subir ${failed} ${failed === 1 ? 'foto' : 'fotos'}.`, { error: true });
                } else if (stageBefore === 'dispute') {
                    showToast('Corrección registrada. Contale al cliente y a soporte desde "Ver disputa → Responder a la disputa".');
                } else {
                    showToast('Sesión registrada como realizada.');
                }
            },
        });
    }

    async function markReady() {
        if (!guardWrite()) return;
        const ok = await confirmDialog({
            title: '¿Marcar listo para el cliente?',
            message: 'El cliente recibe la entrega para aprobarla. Cuando la apruebe, la cotización se completa.',
            confirmLabel: 'Marcar listo',
        });
        if (!ok) return;
        try {
            await updateQuote({ quote_status: 'artist_completed', artist_completed_at: nowIso() });
            await reloadAll();
            showToast('Entrega enviada al cliente para su aprobación.');
        } catch (error) {
            console.error('[quotation-detail] mark ready', error);
            showToast('No pudimos marcar la entrega.', { error: true });
        }
    }

    async function reopenWork() {
        if (!guardWrite()) return;
        const ok = await confirmDialog({
            title: '¿Reabrir el trabajo?',
            message: 'La entrega vuelve a "En progreso" y el cliente deja de verla como lista para aprobar.',
            confirmLabel: 'Reabrir',
        });
        if (!ok) return;
        try {
            await updateQuote({ quote_status: 'in_progress' });
            await reloadAll();
            showToast('Trabajo reabierto.');
        } catch (error) {
            console.error('[quotation-detail] reopen', error);
            showToast('No pudimos reabrir el trabajo.', { error: true });
        }
    }

    function openDisputeResponse() {
        if (!guardWrite()) return;
        const dispute = M.openDispute(state.quote, state.disputes);
        if (!dispute || dispute.synthetic || !state.disputesAvailable) {
            showToast('La disputa todavía no se puede responder desde acá. Escribile al cliente desde el inbox.', { error: true, link: { href: inboxUrl(), label: 'Abrir inbox →' } });
            return;
        }
        openDialog({
            title: 'Responder a la disputa',
            intro: 'Tu respuesta la ven el cliente y soporte. Contá qué pasó y qué proponés para resolverlo.',
            submitLabel: 'Enviar respuesta',
            body: field('Tu respuesta', `<textarea class="wo-textarea" name="response" maxlength="4000" required>${esc(dispute.artist_response || '')}</textarea>`, true),
            onSubmit: async (form, data) => {
                const response = (data.response || '').trim();
                if (response.length < 10) throw userError('Escribí al menos 10 caracteres.');
                await D().QuotationDetail.respondDispute(dispute.id, response);
                await reloadAll();
                showToast('Respuesta enviada.');
            },
        });
    }

    function setMenu(open) {
        state.menuOpen = open;
        const menu = document.getElementById('qd-dispute-options');
        const toggle = document.getElementById('qd-dispute-toggle');
        if (menu) menu.hidden = !open;
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && menu) { const first = menu.querySelector('[role="menuitem"]'); if (first) first.focus(); }
    }
    function disputeAction(action) {
        setMenu(false);
        if (action === 'detail') {
            const panel = document.getElementById('qd-dispute');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (action === 'respond') openDisputeResponse();
        else if (action === 'correction') openScheduleDialog(null, { correction: true });
        else if (action === 'client') window.location.href = inboxUrl();
    }

    async function toggleArchive(button) {
        if (!guardWrite()) return;
        const next = !state.quote.is_archived;
        setBusy(button, true);
        try {
            await D().Quotations.setArchivedById(state.quote.id, next);
            state.quote.is_archived = next;
            render();
            showToast(next ? 'Cotización archivada.' : 'Cotización restaurada.', { link: { href: appUrl('/my-quotations'), label: 'Volver al listado →' } });
        } catch (error) {
            console.error('[quotation-detail] archive', error);
            showToast('No pudimos archivar la cotización.', { error: true });
            setBusy(button, false);
        }
    }

    function downloadSummary() {
        const v = view();
        const q = v.quote;
        const slots = M.sessionSlots(q, v.sessions);
        const lines = [
            `WE ÖTZI · Resumen de proyecto ${q.quote_id || q.id}`,
            '',
            `Cliente: ${q.client_full_name || '—'}`,
            `Proyecto: ${q.tattoo_idea_description || q.project_description || '—'}`,
            `Zona: ${M.bodyZone(q) || '—'} · Estilo: ${M.styleName(q.tattoo_style)} · Tamaño: ${q.tattoo_size || '—'}`,
            `Presupuesto final: ${M.money(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount, currencyOf(q))}`,
            `Estado: ${M.stageMeta(v.stage).tag}`,
            '',
            'Sesiones',
            ...slots.map((s) => `- Sesión ${s.number} de ${s.total}: ${s.session && s.session.session_date ? M.dateTime(s.session.session_date) : 'sin fecha'} · ${s.state === 'done' ? 'realizada' : s.state === 'scheduled' ? 'agendada' : 'sin agendar'}${s.session && s.session.duration_hours ? ` · ${M.durationShort(M.numberFrom(s.session.duration_hours) * 60)}` : ''}`),
            '',
            'Historial',
            ...M.historyEvents(q, v.history, v.sessions, v.disputes).map((e) => `- ${e.date} · ${e.text}`),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resumen-${q.quote_id || q.id}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Resumen descargado.');
    }

    async function sendMessage(form) {
        if (!guardWrite()) return;
        const input = form.querySelector('#qd-message');
        const button = form.querySelector('button');
        const message = input && input.value.trim();
        if (!message) return;
        setBusy(button, true);
        try {
            await D().Chat.sendMessage({ quoteId: state.quote.quote_id, senderType: 'artist', senderId: state.user.id, message });
            input.value = '';
            state.messages = await D().Chat.listByQuote(state.quote.quote_id).catch(() => state.messages);
            const list = document.getElementById('qd-message-list');
            if (list) list.innerHTML = messagesListHtml(view().quote);
            showToast('Mensaje enviado.');
        } catch (error) {
            console.error('[quotation-detail] send message', error);
            showToast('No pudimos enviar el mensaje.', { error: true });
        } finally {
            setBusy(button, false);
        }
    }

    function openNotes(options = {}) {
        if (!window.WorkNotesDrawer || !state.quote) {
            showToast('Las notas de trabajo no están disponibles.', { error: true });
            return;
        }
        window.WorkNotesDrawer.open(Object.assign({
            quote: state.quote,
            user: state.user,
            confirm: confirmDialog,
            toast: showToast,
            icons: window.QuotationDetailIcons,
        }, options));
    }

    function scheduleFromCommandbar() {
        const v = view();
        if (v.stage === 'pending') {
            // El calendario abre "Turno con cliente" con esta cotización vinculada
            // (sin aprobar → se guarda como reserva pendiente).
            window.location.href = calendarUrl(v.quote.client_preferred_date || new Date(), { quote: true });
            return;
        }
        if (v.stage === 'responded') { openAgreementDialog(false); return; }
        openScheduleDialog(null);
    }

    /* ------------------------------------ eventos ------------------------------------ */
    function bindEvents() {
        document.getElementById('qd-accept')?.addEventListener('click', openRespondDialog);
        document.getElementById('qd-reject')?.addEventListener('click', rejectQuote);
        document.getElementById('qd-schedule')?.addEventListener('click', scheduleFromCommandbar);
        document.getElementById('qd-mark-ready')?.addEventListener('click', markReady);
        document.getElementById('qd-dispute-toggle')?.addEventListener('click', (event) => {
            event.stopPropagation();
            setMenu(!state.menuOpen);
        });
        document.getElementById('qd-dispute-options')?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-dispute-action]');
            if (item) disputeAction(item.dataset.disputeAction);
        });
        document.getElementById('qd-dispute-options')?.addEventListener('keydown', (event) => {
            const items = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
            if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
            if (event.key === 'Escape') { setMenu(false); document.getElementById('qd-dispute-toggle')?.focus(); }
        });
        document.addEventListener('click', (event) => {
            if (state.menuOpen && !event.target.closest('#qd-dispute-menu')) setMenu(false);
        });

        const root = document.getElementById('quotation-detail-root');
        root.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            if (action === 'save-budget') saveBudget(target);
            else if (action === 'open-notes') openNotes();
            else if (action === 'history') document.getElementById('qd-history')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else if (action === 'session-schedule') openScheduleDialog(target.dataset.slot);
            else if (action === 'session-reschedule') openRescheduleDialog(target.dataset.sessionId, target.dataset.slot);
            else if (action === 'session-complete') openCompleteDialog(target.dataset.sessionId, target.dataset.slot);
            else if (action === 'edit-agreement') openAgreementDialog(true);
            else if (action === 'download-summary') downloadSummary();
            else if (action === 'archive') toggleArchive(target);
        });
        root.addEventListener('submit', (event) => {
            if (event.target.id === 'qd-compose') {
                event.preventDefault();
                sendMessage(event.target);
            }
        });
        root.addEventListener('input', (event) => {
            if (event.target.id === 'qd-private-notes') scheduleNotesSave();
        });
        root.addEventListener('focusout', (event) => {
            if (event.target.id === 'qd-private-notes') savePrivateNotes();
        });
        root.addEventListener('keydown', (event) => {
            if (event.target.id === 'qd-budget' && event.key === 'Enter') {
                event.preventDefault();
                saveBudget(root.querySelector('[data-action="save-budget"]'));
            }
        });
        document.getElementById('quotation-detail-logout')?.addEventListener('click', async () => {
            if (state.client) await state.client.auth.signOut();
            window.location.href = appUrl('/artist/login');
        });
        window.addEventListener('beforeunload', () => { if (state.notesTimer) savePrivateNotes(); });
    }

    function openFromParams() {
        if (params.get('panel') === 'notas') {
            const nota = params.get('nota');
            const template = params.get('plantilla');
            openNotes({
                noteId: nota && nota !== 'nueva' ? nota : null,
                isNew: nota === 'nueva' || !!template,
                template: template || null,
            });
        }
        const modal = params.get('modal');
        const map = {
            responder: openRespondDialog,
            rechazar: rejectQuote,
            acuerdo: () => openAgreementDialog(false),
            agendar: () => openScheduleDialog(null),
            listo: markReady,
            disputa: () => setMenu(true),
            'responder-disputa': openDisputeResponse,
            correccion: () => openScheduleDialog(null, { correction: true }),
            // "Lista para cliente" no tiene frame ni botón de reabrir en el Figma:
            // queda solo por URL (soporte/QA) hasta que diseño lo ubique.
            reabrir: () => { if (view().stage === 'delivered') reopenWork(); },
        };
        if (modal && map[modal]) map[modal]();
    }

    async function initialize() {
        hydrateIcons(document);
        bindEvents();
        try {
            if (!M) throw new Error('quotation-detail-model.js no cargó.');
            if (window.ConfigManager?.ready) await window.ConfigManager.ready();
            state.client = window.ConfigManager?.getSupabaseClient?.() || window._supabase;
            if (!state.client) throw new Error('Supabase no está disponible.');

            const { data: { session }, error } = await state.client.auth.getSession();
            if (error || !session) {
                const returnTo = `${window.location.pathname}${window.location.search}`;
                window.location.href = appUrl(`/artist/login?returnTo=${encodeURIComponent(returnTo)}`);
                return;
            }
            state.user = session.user;
            state.quote = await findQuote();
            if (!state.quote) {
                renderError(state.identifier ? 'No encontramos esta cotización o no pertenece a tu cuenta.' : 'Todavía no tenés cotizaciones para mostrar.');
                return;
            }
            await refreshSecondaryData();
            buildScenario();
            if (!state.scenario && M.deriveStage(state.quote, state.sessions, state.disputes) === 'draft') {
                renderError('Esta solicitud todavía es un borrador del cliente: vas a verla cuando la envíe.');
                return;
            }
            render();
            announcePreviewScenario();
            markViewed();
            openFromParams();
        } catch (error) {
            console.error('[quotation-detail] initialization', error);
            renderError('No pudimos cargar el expediente. Probá nuevamente.');
        }
    }

    // Antes que wo-icons.js (defer): los íconos estáticos salen en línea aunque
    // el CDN de Feather no esté disponible.
    hydrateIcons(document);
    document.addEventListener('DOMContentLoaded', initialize);
}());
