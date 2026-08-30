(function () {
    'use strict';

    const state = {
        client: null,
        user: null,
        quote: null,
        attachments: [],
        sessions: [],
        messages: [],
        history: [],
    };

    const STATUS = {
        pending: { label: 'Pendiente', tone: 'pending' },
        responded: { label: 'Respondida', tone: 'responded' },
        client_approved: { label: 'Confirmada', tone: 'confirmed' },
        in_progress: { label: 'En progreso', tone: 'confirmed' },
        artist_completed: { label: 'Lista para cliente', tone: 'confirmed' },
        completed: { label: 'Completada', tone: 'confirmed' },
        client_rejected: { label: 'Rechazada', tone: 'rejected' },
        cancelled: { label: 'Rechazada', tone: 'rejected' },
        expired: { label: 'Vencida', tone: 'expired' },
    };

    const HISTORY_COPY = {
        pending: 'Solicitud creada por el cliente.',
        responded: 'Cotización enviada al cliente.',
        client_approved: 'El cliente aceptó la cotización.',
        client_rejected: 'El cliente rechazó la cotización.',
        in_progress: 'Trabajo iniciado.',
        artist_completed: 'Trabajo marcado como listo para el cliente.',
        completed: 'Cotización completada.',
        expired: 'Cotización vencida.',
        cancelled: 'Solicitud rechazada por el artista.',
    };

    function appBasePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const path = window.location.pathname || '';
        return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
    }

    function appUrl(path) {
        const normalized = String(path || '').startsWith('/') ? String(path) : `/${path}`;
        return `${appBasePath()}${normalized}`;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function initials(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '··';
        return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
    }

    function styleName(value) {
        if (!value) return 'Sin definir';
        if (typeof value === 'string') return value;
        return value.substyle_name || value.style_name || 'Sin definir';
    }

    function dateLabel(value, includeTime = false) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        const options = { day: '2-digit', month: 'short', year: 'numeric' };
        if (includeTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
        return new Intl.DateTimeFormat('es-AR', options).format(date).replace('.', '').toUpperCase();
    }

    function chatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('es-AR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        }).format(date).replace('.', '').toUpperCase();
    }

    function numberFrom(value) {
        if (value == null || value === '') return null;
        const normalized = String(value).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function amountLabel(value, currency) {
        const amount = numberFrom(value);
        if (amount == null) return 'A definir';
        try {
            return new Intl.NumberFormat('es-AR', {
                style: 'currency', currency: (currency || 'USD').toUpperCase(), maximumFractionDigits: 0,
            }).format(amount);
        } catch (_) {
            return `${amount.toLocaleString('es-AR')} ${currency || ''}`.trim();
        }
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

    function showToast(message, isError = false) {
        const toast = document.getElementById('qd-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.toggle('is-error', isError);
        toast.hidden = false;
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3600);
    }

    function setBusy(button, busy) {
        if (!button) return;
        button.disabled = busy;
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function renderCommandbar() {
        const quote = state.quote;
        if (!quote) return;
        const view = STATUS[quote.quote_status] || { label: quote.quote_status || 'Sin estado', tone: 'expired' };
        const reference = document.getElementById('qd-reference');
        const status = document.getElementById('qd-status');
        const accept = document.getElementById('qd-accept');
        const reject = document.getElementById('qd-reject');

        reference.textContent = quote.quote_id || `COT-${quote.id}`;
        status.textContent = view.label;
        status.className = `qd-status qd-status--${view.tone}`;

        const acceptCopy = {
            pending: '✓ Aceptar',
            responded: '✓ Respondida',
            client_approved: '✓ Iniciar trabajo',
            in_progress: '✓ En progreso',
            artist_completed: '✓ Lista para cliente',
            completed: '✓ Completada',
        };
        accept.textContent = acceptCopy[quote.quote_status] || '✓ Aceptar';
        accept.disabled = ['responded', 'in_progress', 'artist_completed', 'completed', 'client_rejected', 'cancelled', 'expired'].includes(quote.quote_status);
        reject.disabled = !['pending', 'responded'].includes(quote.quote_status);
    }

    function referenceHtml() {
        if (!state.attachments.length) {
            return Array.from({ length: 3 }, (_, index) => `
                <div class="qd-reference-card" aria-label="Referencia ${index + 1} no adjunta">
                    <span aria-hidden="true">▧</span><strong>Referencia ${index + 1}</strong><small>sin archivo</small>
                </div>`).join('');
        }
        return state.attachments.slice(0, 3).map((attachment, index) => {
            const source = attachment.google_drive_url || attachment.file_url || attachment.url || '';
            const safe = safeUrl(source);
            const name = attachment.file_name || `Referencia ${index + 1}`;
            return `
                <button class="qd-reference-card" type="button" data-reference-url="${escapeHtml(safe)}" aria-label="Abrir ${escapeHtml(name)}">
                    ${safe ? `<img src="${escapeHtml(driveThumbnail(safe))}" alt="${escapeHtml(name)}">` : '<span aria-hidden="true">▧</span>'}
                    <strong>${escapeHtml(name)}</strong><small>${safe ? 'abrir archivo' : 'sin archivo'}</small>
                </button>`;
        }).join('');
    }

    function timelineModel() {
        const quote = state.quote;
        const historyByStatus = new Map(state.history.map((row) => [row.new_status, row]));
        const lastClientMessage = [...state.messages].reverse().find((message) => message.sender_type === 'client');
        const current = quote.quote_status;
        const isResponded = Boolean(quote.artist_responded_at || historyByStatus.has('responded') || ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected'].includes(current));
        const clientAnswered = Boolean(lastClientMessage || historyByStatus.has('client_approved') || historyByStatus.has('client_rejected') || ['client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected'].includes(current));
        const currentStatus = STATUS[current]?.label || current || 'Pendiente';
        return [
            { label: 'Solicitud creada', at: quote.created_at, complete: true },
            { label: 'Vista por vos', at: quote.sent_to_artist_at || quote.created_at, complete: true },
            { label: 'Cotización enviada', at: quote.artist_responded_at || historyByStatus.get('responded')?.changed_at, complete: isResponded },
            { label: 'Cliente respondió', at: lastClientMessage?.created_at || historyByStatus.get('client_approved')?.changed_at || historyByStatus.get('client_rejected')?.changed_at, complete: clientAnswered },
            { label: currentStatus === 'Pendiente' ? 'Esperando tu decisión' : currentStatus, at: quote.updated_at, complete: current !== 'pending', current: true },
        ];
    }

    function historyHtml() {
        const rows = [{ new_status: 'pending', changed_at: state.quote.created_at, notes: HISTORY_COPY.pending }, ...state.history]
            .filter((row, index, all) => index === all.findIndex((candidate) => candidate.new_status === row.new_status && candidate.changed_at === row.changed_at));
        return rows.map((row) => `
            <div class="qd-history-row">
                <span class="qd-history-date">${escapeHtml(dateLabel(row.changed_at).replace(/\s+\d{4}$/, ''))}</span>
                <span class="qd-history-copy">${escapeHtml(row.notes || HISTORY_COPY[row.new_status] || `Estado actualizado a ${row.new_status}.`)}</span>
            </div>`).join('');
    }

    function messagesHtml() {
        if (!state.quote.client_user_id) {
            return '<p class="qd-empty">El chat se habilitará cuando el cliente cree su cuenta.</p>';
        }
        if (!state.messages.length) return '<p class="qd-empty">Todavía no hay mensajes. Iniciá la conversación con el cliente.</p>';
        return state.messages.slice(-6).map((message) => {
            const artist = message.sender_type === 'artist';
            const author = artist ? 'Vos' : (state.quote.client_full_name || 'Cliente');
            return `
                <article class="qd-message${artist ? ' qd-message--artist' : ''}">
                    <span class="qd-message-meta">${escapeHtml(author)} · ${escapeHtml(chatDate(message.created_at))}</span>
                    <p>${escapeHtml(message.message || '')}</p>
                </article>`;
        }).join('');
    }

    function render() {
        const quote = state.quote;
        const root = document.getElementById('quotation-detail-root');
        const amount = quote.artist_budget_amount || quote.client_budget_amount || '';
        const currency = quote.artist_budget_currency || quote.client_budget_currency || 'USD';
        const sessionHours = state.sessions.reduce((sum, session) => sum + (numberFrom(session.duration_hours) || 0), 0);
        const sessionCount = quote.final_sessions || quote.tattoo_estimated_sessions || state.sessions.length || '—';
        const proposalBudget = quote.client_budget_amount
            ? amountLabel(quote.client_budget_amount, quote.client_budget_currency || 'USD')
            : 'A definir';
        const preferredDate = quote.client_preferred_date || 'Flexible';
        const tags = [
            quote.client_city_residence,
            styleName(quote.tattoo_style),
            [quote.tattoo_body_part, quote.tattoo_body_side].filter(Boolean).join(' · '),
            `Deseada · ${preferredDate}`,
        ].filter(Boolean);
        const timeline = timelineModel();

        root.innerHTML = `
            <section class="qd-identity" aria-labelledby="qd-title">
                <div class="qd-avatar" aria-hidden="true">${escapeHtml(initials(quote.client_full_name))}</div>
                <div>
                    <p class="qd-eyebrow">Expediente de cotización</p>
                    <h1 class="qd-title" id="qd-title">${escapeHtml(quote.client_full_name || 'Cliente')}</h1>
                    <div class="qd-tags">${tags.map((tag) => `<span class="qd-tag">${escapeHtml(tag)}</span>`).join('')}</div>
                </div>
            </section>

            <section class="qd-dossier" aria-label="Propuesta y evaluación">
                <div class="qd-proposal">
                    <p class="qd-section-label">La propuesta</p>
                    <div class="qd-proposal-copy"><span class="qd-quote-mark" aria-hidden="true">“</span><p>${escapeHtml(quote.tattoo_idea_description || quote.project_description || 'Sin descripción')}</p></div>
                    <div class="qd-facts">
                        <div class="qd-fact"><span class="qd-fact-label">Zona del cuerpo</span><span class="qd-fact-value">${escapeHtml([quote.tattoo_body_part, quote.tattoo_body_side].filter(Boolean).join(' · ') || '—')}</span></div>
                        <div class="qd-fact"><span class="qd-fact-label">Estilo</span><span class="qd-fact-value">${escapeHtml(styleName(quote.tattoo_style))}</span></div>
                        <div class="qd-fact"><span class="qd-fact-label">Tamaño estimado</span><span class="qd-fact-value">${escapeHtml(quote.tattoo_size || '—')}</span></div>
                        <div class="qd-fact"><span class="qd-fact-label">Presupuesto del cliente</span><span class="qd-fact-value">${escapeHtml(proposalBudget)}</span></div>
                    </div>
                    <div class="qd-references">
                        <p class="qd-section-label">Referencias e imágenes adjuntas</p>
                        <div class="qd-reference-grid">${referenceHtml()}</div>
                    </div>
                </div>

                <div class="qd-evaluation">
                    <p class="qd-section-label">Tu evaluación</p>
                    <div class="qd-evaluation-row">
                        <label class="qd-evaluation-label" for="qd-budget">Presupuesto del artista</label>
                        <div class="qd-budget-control">
                            <span class="qd-budget-currency">${escapeHtml(currency === 'USD' ? '$' : currency)}</span>
                            <input id="qd-budget" inputmode="decimal" value="${escapeHtml(amount)}" aria-label="Presupuesto del artista">
                            <button class="qd-budget-save" id="qd-save-evaluation" type="button">Guardar</button>
                        </div>
                    </div>
                    <div class="qd-evaluation-facts">
                        <div><span class="qd-evaluation-label">Tiempo estimado</span><span class="qd-evaluation-value">${sessionHours ? `${escapeHtml(sessionHours)} horas` : 'A definir'}</span></div>
                        <div><span class="qd-evaluation-label">Sesiones</span><span class="qd-evaluation-value">${escapeHtml(sessionCount)}</span></div>
                        <div><span class="qd-evaluation-label">Disponibilidad</span><span class="qd-evaluation-copy">${escapeHtml(quote.artist_availability || 'A coordinar con el cliente')}</span></div>
                        <div><span class="qd-evaluation-label">Fecha deseada</span><span class="qd-evaluation-copy">${escapeHtml(preferredDate)}</span></div>
                    </div>
                    <div class="qd-evaluation-row">
                        <label class="qd-evaluation-label" for="qd-private-notes">Notas privadas · solo vos</label>
                        <textarea id="qd-private-notes" placeholder="Agregá contexto privado para esta cotización">${escapeHtml(quote.notes || '')}</textarea>
                    </div>
                </div>
            </section>

            <section class="qd-timeline-section" aria-labelledby="qd-timeline-title">
                <p class="qd-section-label" id="qd-timeline-title">Timeline de la cotización</p>
                <div class="qd-timeline">
                    ${timeline.map((step) => `
                        <div class="qd-timeline-step${step.complete ? ' is-complete' : ''}${step.current ? ' is-current' : ''}">
                            <span class="qd-timeline-date">${escapeHtml(step.at ? dateLabel(step.at).replace(/\s+\d{4}$/, '') : '—')}</span>
                            <strong class="qd-timeline-status">${escapeHtml(step.label)}</strong>
                        </div>`).join('')}
                </div>
                <div class="qd-history">
                    <p class="qd-section-label qd-history-title">Historial de cambios</p>
                    ${historyHtml()}
                </div>
            </section>

            <section class="qd-messages" aria-labelledby="qd-messages-title">
                <p class="qd-section-label" id="qd-messages-title">Mensajes con el cliente</p>
                <div class="qd-message-list" id="qd-message-list">${messagesHtml()}</div>
                ${quote.client_user_id ? `
                    <form class="qd-compose" id="qd-compose">
                        <input id="qd-message" autocomplete="off" placeholder="Escribí un mensaje…" aria-label="Mensaje al cliente">
                        <button type="submit">Enviar ↗</button>
                    </form>
                    <a class="qd-chat-link" href="${escapeHtml(appUrl(`/artist/inbox?quote=${encodeURIComponent(quote.quote_id || quote.id)}`))}">Ver chat completo →</a>` : ''}
            </section>`;

        bindRenderedEvents();
        renderCommandbar();
    }

    function renderError(message) {
        const root = document.getElementById('quotation-detail-root');
        root.innerHTML = `<div class="qd-error"><p>${escapeHtml(message)}</p><a class="qd-chat-link" href="${escapeHtml(appUrl('/my-quotations'))}">Volver a cotizaciones</a></div>`;
    }

    async function refreshSecondaryData() {
        const quote = state.quote;
        const tasks = [
            window.WeotziData.Attachments.listByQuoteIds([quote.quote_id]).catch(() => []),
            window.WeotziData.Sessions.listForQuote(quote.id).catch(() => []),
            window.WeotziData.Chat.listByQuote(quote.quote_id).catch(() => []),
            window.WeotziData.StatusHistory
                ? window.WeotziData.StatusHistory.listForQuotation(quote.id).catch(() => [])
                : Promise.resolve([]),
        ];
        [state.attachments, state.sessions, state.messages, state.history] = await Promise.all(tasks);
    }

    async function reloadQuote() {
        const rows = await window.WeotziData.Quotations.listForArtist(state.user.id, {
            excludeArchived: false,
            excludeInProgress: false,
        });
        const id = String(state.quote.id);
        state.quote = rows.find((row) => String(row.id) === id) || state.quote;
        await refreshSecondaryData();
        render();
    }

    async function saveEvaluation() {
        const button = document.getElementById('qd-save-evaluation');
        const amount = document.getElementById('qd-budget')?.value.trim() || null;
        const notes = document.getElementById('qd-private-notes')?.value.trim() || null;
        setBusy(button, true);
        try {
            await window.WeotziData.Quotations.updateById(state.quote.id, {
                artist_budget_amount: amount,
                artist_budget_currency: state.quote.artist_budget_currency || state.quote.client_budget_currency || 'USD',
                notes,
            });
            state.quote.artist_budget_amount = amount;
            state.quote.notes = notes;
            showToast('Evaluación guardada.');
        } catch (error) {
            console.error('[quotation-detail] save evaluation', error);
            showToast('No pudimos guardar la evaluación.', true);
        } finally {
            setBusy(button, false);
        }
    }

    async function acceptQuotation() {
        const button = document.getElementById('qd-accept');
        if (!state.quote || button.disabled) return;
        setBusy(button, true);
        try {
            const patch = state.quote.quote_status === 'client_approved'
                ? { quote_status: 'in_progress' }
                : {
                    quote_status: 'responded',
                    artist_budget_amount: document.getElementById('qd-budget')?.value.trim() || state.quote.artist_budget_amount || state.quote.client_budget_amount || null,
                    artist_budget_currency: state.quote.artist_budget_currency || state.quote.client_budget_currency || 'USD',
                    artist_responded_at: new Date().toISOString(),
                    notes: document.getElementById('qd-private-notes')?.value.trim() || null,
                };
            await window.WeotziData.Quotations.updateById(state.quote.id, patch);
            Object.assign(state.quote, patch);
            await reloadQuote();
            showToast(patch.quote_status === 'responded' ? 'Cotización aceptada y enviada al cliente.' : 'Trabajo iniciado.');
        } catch (error) {
            console.error('[quotation-detail] accept', error);
            showToast('No pudimos actualizar la cotización.', true);
            setBusy(button, false);
        }
    }

    async function rejectQuotation() {
        if (!state.quote || !['pending', 'responded'].includes(state.quote.quote_status)) return;
        if (!window.confirm('¿Querés rechazar esta solicitud? Esta acción quedará en el historial.')) return;
        const button = document.getElementById('qd-reject');
        setBusy(button, true);
        try {
            const nextStatus = state.quote.quote_status === 'pending' ? 'cancelled' : 'client_rejected';
            await window.WeotziData.Quotations.updateById(state.quote.id, { quote_status: nextStatus });
            state.quote.quote_status = nextStatus;
            await reloadQuote();
            showToast('Solicitud rechazada.');
        } catch (error) {
            console.error('[quotation-detail] reject', error);
            showToast('No pudimos rechazar la solicitud.', true);
            setBusy(button, false);
        }
    }

    async function sendMessage(event) {
        event.preventDefault();
        const input = document.getElementById('qd-message');
        const button = event.currentTarget.querySelector('button');
        const message = input?.value.trim();
        if (!message) return;
        setBusy(button, true);
        try {
            await window.WeotziData.Chat.sendMessage({
                quoteId: state.quote.quote_id,
                senderType: 'artist',
                senderId: state.user.id,
                message,
            });
            input.value = '';
            state.messages = await window.WeotziData.Chat.listByQuote(state.quote.quote_id);
            const list = document.getElementById('qd-message-list');
            if (list) list.innerHTML = messagesHtml();
            showToast('Mensaje enviado.');
        } catch (error) {
            console.error('[quotation-detail] send message', error);
            showToast('No pudimos enviar el mensaje.', true);
        } finally {
            setBusy(button, false);
        }
    }

    function bindRenderedEvents() {
        document.getElementById('qd-save-evaluation')?.addEventListener('click', saveEvaluation);
        document.getElementById('qd-compose')?.addEventListener('submit', sendMessage);
        document.querySelectorAll('[data-reference-url]').forEach((button) => {
            button.addEventListener('click', () => {
                const url = safeUrl(button.dataset.referenceUrl);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
            });
        });
    }

    async function initialize() {
        try {
            if (window.ConfigManager?.ready) await window.ConfigManager.ready();
            state.client = window.ConfigManager?.getSupabaseClient?.() || window._supabase;
            if (!state.client) throw new Error('Supabase no está disponible.');

            const { data: { session }, error } = await state.client.auth.getSession();
            if (error || !session) {
                const returnTo = `${window.location.pathname}${window.location.search}`;
                window.location.href = appUrl(`/registerclosedbeta?returnTo=${encodeURIComponent(returnTo)}`);
                return;
            }
            state.user = session.user;

            const identifier = new URLSearchParams(window.location.search).get('quote');
            const rows = await window.WeotziData.Quotations.listForArtist(state.user.id, {
                excludeArchived: false,
                excludeInProgress: false,
            });
            state.quote = identifier
                ? rows.find((row) => String(row.id) === identifier || String(row.quote_id) === identifier)
                : rows[0];
            if (!state.quote) {
                renderError(identifier ? 'No encontramos esta cotización o no pertenece a tu cuenta.' : 'Todavía no tenés cotizaciones para mostrar.');
                return;
            }

            await refreshSecondaryData();
            render();
        } catch (error) {
            console.error('[quotation-detail] initialization', error);
            renderError('No pudimos cargar el expediente. Probá nuevamente.');
        }
    }

    document.getElementById('qd-accept')?.addEventListener('click', acceptQuotation);
    document.getElementById('qd-reject')?.addEventListener('click', rejectQuotation);
    document.getElementById('qd-schedule')?.addEventListener('click', () => {
        if (!state.quote) return;
        window.location.href = appUrl(`/calendar?quote=${encodeURIComponent(state.quote.quote_id || state.quote.id)}&new=appointment`);
    });
    document.getElementById('qd-contact')?.addEventListener('click', () => {
        if (!state.quote) return;
        window.location.href = appUrl(`/artist/inbox?quote=${encodeURIComponent(state.quote.quote_id || state.quote.id)}`);
    });
    document.getElementById('quotation-detail-logout')?.addEventListener('click', async () => {
        if (state.client) await state.client.auth.signOut();
        window.location.href = appUrl('/registerclosedbeta');
    });
    document.addEventListener('DOMContentLoaded', initialize);
}());
