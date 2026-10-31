// ============================================
// WE OTZI - Resumen lateral de una solicitud (/my-quotations)
// Figma final "We Otzi Pantallas final" · 801:564 Cotizaciones - Resumen
// lateral de solicitud. Se abre al tocar una fila del listado (o con
// ?resumen=<quote_id>) y concentra: estado, prioridad, resumen del tatuaje,
// resumen económico, timeline, última nota privada, últimos mensajes y las
// acciones Aceptar / Agendar / Contactar / Rechazar + Ver detalle completo.
// Datos: capa PostgREST (WeotziData.Quotations / Notes / Chat / Sessions).
// ============================================
(function () {
    'use strict';

    const VM = window.WoQuotationsViewModel;
    const page = () => window.QuotationsPage;

    let current = null;
    let extras = { notes: [], messages: [], sessions: [] };
    let lastFocus = null;
    let loadToken = 0;
    let busy = false;

    const $ = (id) => document.getElementById(id);
    const esc = (v) => (page() ? page().escapeHtml(v) : String(v == null ? '' : v));

    // ---------- posición bajo la barra de navegación ----------
    function navBottom() {
        const nav = document.querySelector('weotzi-product-nav');
        const target = nav && (nav.querySelector('header, nav, .wo-topbar') || nav.firstElementChild || nav);
        if (!target) return 0;
        return Math.max(0, Math.round(target.getBoundingClientRect().bottom));
    }

    function syncTop() {
        document.documentElement.style.setProperty('--qs-top', navBottom() + 'px');
    }

    // ---------- texto de la última nota ----------
    function noteText(note) {
        if (!note) return '';
        let content = note.content;
        if (typeof content === 'string') {
            try { content = JSON.parse(content); } catch (e) { return content.replace(/<[^>]+>/g, '').trim(); }
        }
        if (content && Array.isArray(content.blocks)) {
            const text = content.blocks.map((b) => {
                const d = b && b.data || {};
                if (typeof d.text === 'string') return d.text;
                if (Array.isArray(d.items)) return d.items.map((it) => (typeof it === 'string' ? it : it && (it.text || it.content) || '')).join(' ');
                return '';
            }).join(' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
            if (text) return text;
        }
        return String(note.title || '').trim();
    }

    function lastPrivateNote(quote) {
        if (quote.notes && String(quote.notes).trim()) return String(quote.notes).trim();
        const sorted = (extras.notes || []).slice().sort((a, b) => new Date(b.note_date || b.created_at) - new Date(a.note_date || a.created_at));
        return noteText(sorted[0]);
    }

    // ---------- piezas del panel ----------
    function sectionTitle(text) {
        return `<div class="qs-section-title"><span>${esc(text)}</span></div>`;
    }

    function priceTile(quote) {
        const entry = VM.amountEntry(quote);
        const money = page().moneyFor(entry.amount, entry.currency);
        return money && money.amount > 0 ? VM.formatCompactMoney(money.amount, money.currency) : '—';
    }

    function durationTile(quote) {
        const hours = (extras.sessions || []).reduce((sum, s) => sum + (parseFloat(s.duration_hours) || 0), 0);
        if (hours > 0) return (Number.isInteger(hours) ? hours : String(Math.round(hours * 10) / 10).replace('.', ',')) + 'h';
        const minutes = parseFloat(quote.artist_session_minutes);
        if (minutes > 0) {
            const perSession = minutes / 60;
            return (Number.isInteger(perSession) ? perSession : String(Math.round(perSession * 10) / 10).replace('.', ',')) + 'h';
        }
        return '—';
    }

    // "$185K" entra a 40px en el tile de 160px; "US$1,2K" necesita achicarse.
    function valueSizeClass(text) {
        const len = String(text || '').length;
        return len > 6 ? ' qs-econ-value--xlong' : len > 5 ? ' qs-econ-value--long' : '';
    }

    function sessionsTile(quote) {
        return quote.final_sessions || quote.tattoo_estimated_sessions || (extras.sessions || []).length || '—';
    }

    function statusSelect(quote) {
        const options = quote.is_archived
            ? [{ value: quote.quote_status, label: VM.statusView(quote.quote_status).label }]
            : VM.statusOptions(quote.quote_status);
        const tone = VM.statusView(quote.quote_status).tone;
        return `
            <label class="qs-select-field">
                <span class="qs-select-label">Estado</span>
                <span class="qs-select qs-select--${esc(tone)}">
                    <select id="qs-status" ${options.length < 2 ? 'disabled' : ''} aria-label="Estado de la cotización">
                        ${options.map((o) => `<option value="${esc(o.value)}"${o.value === quote.quote_status ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
                    </select>
                    <i data-wo-icon="chevron-down" aria-hidden="true"></i>
                </span>
            </label>`;
    }

    function prioritySelect(quote) {
        const value = quote.priority || 'medium';
        return `
            <label class="qs-select-field">
                <span class="qs-select-label">Prioridad</span>
                <span class="qs-select qs-select--prio-${esc(value)}">
                    <select id="qs-priority" aria-label="Prioridad"${quote.is_archived ? ' disabled' : ''}>
                        ${['high', 'medium', 'low'].map((p) => `<option value="${p}"${p === value ? ' selected' : ''}>${esc(VM.priorityView(p).label)}</option>`).join('')}
                    </select>
                    <i data-wo-icon="chevron-down" aria-hidden="true"></i>
                </span>
            </label>`;
    }

    function timelineHtml(quote) {
        const steps = VM.timelineSteps(quote, extras.sessions);
        const closing = ['client_rejected', 'cancelled'].includes(quote.quote_status)
            ? '<p class="qs-timeline-end qs-timeline-end--rejected">Solicitud rechazada</p>'
            : quote.quote_status === 'expired' ? '<p class="qs-timeline-end">Cotización vencida</p>' : '';
        return `
            <ol class="qs-timeline">
                ${steps.map((s) => `
                    <li class="qs-step qs-step--${s.state}"${s.state === 'current' ? ' aria-current="step"' : ''}>
                        <span class="qs-step-box" aria-hidden="true"></span>
                        <span class="qs-step-label">${esc(s.label)}</span>
                    </li>`).join('')}
            </ol>${closing}`;
    }

    function messagesHtml() {
        const messages = (extras.messages || []).slice(-2);
        if (!messages.length) return '<p class="qs-muted">Todavía no hay mensajes con este cliente.</p>';
        return `<div class="qs-messages">${messages.map((m) => {
            const mine = m.sender_type === 'artist';
            return `
                <div class="qs-msg${mine ? ' qs-msg--mine' : ''}">
                    <span class="qs-msg-meta">${mine ? 'Vos' : 'Cliente'} · ${esc(VM.timeLabel(m.created_at))}</span>
                    <p class="qs-msg-bubble">${esc(m.message || '')}</p>
                </div>`;
        }).join('')}</div>`;
    }

    function actionsHtml(quote) {
        const actions = VM.summaryActions(quote);
        const detail = esc(page().appUrl(VM.detailUrl(quote)));
        if (actions.archived) {
            return `
                <div class="qs-actions">
                    <button type="button" class="qs-btn qs-btn--ink" data-qs-action="unarchive"><i data-wo-icon="rotate-ccw" aria-hidden="true"></i>Desarchivar</button>
                    <button type="button" class="qs-btn qs-btn--danger" data-qs-action="delete"><i data-wo-icon="trash-2" aria-hidden="true"></i>Eliminar</button>
                </div>
                <a class="qs-btn qs-btn--outline qs-btn--block" href="${detail}">Ver detalle completo<i data-wo-icon="arrow-right" aria-hidden="true"></i></a>`;
        }
        const canContact = !!(quote.client_user_id || quote.client_email || quote.client_whatsapp);
        return `
            <div class="qs-actions">
                <button type="button" class="qs-btn qs-btn--ink" data-qs-action="accept"${actions.accept ? '' : ' disabled'}><i data-wo-icon="check" aria-hidden="true"></i>${esc(actions.accept && actions.accept.label !== 'Aceptar' ? actions.accept.label : 'Aceptar')}</button>
                <button type="button" class="qs-btn qs-btn--accent" data-qs-action="schedule"><i data-wo-icon="calendar" aria-hidden="true"></i>Agendar</button>
                <button type="button" class="qs-btn qs-btn--direct" data-qs-action="contact"${canContact ? '' : ' disabled'}><i data-wo-icon="message-circle" aria-hidden="true"></i>Contactar</button>
                <button type="button" class="qs-btn qs-btn--danger" data-qs-action="reject"${actions.reject ? '' : ' disabled'}><i data-wo-icon="x" aria-hidden="true"></i>Rechazar</button>
            </div>
            <a class="qs-btn qs-btn--outline qs-btn--block" href="${detail}">Ver detalle completo<i data-wo-icon="arrow-right" aria-hidden="true"></i></a>`;
    }

    function render(loading) {
        const panel = $('quote-summary');
        if (!panel || !current) return;
        const quote = current;
        const badge = VM.stageBadge(quote, extras.sessions);
        const city = quote.client_city_residence;
        const note = lastPrivateNote(quote);
        const tattoo = [
            ['Zona', quote.tattoo_body_part],
            ['Estilo', VM.styleName(quote.tattoo_style)],
            ['Tamaño', quote.tattoo_size]
        ];

        panel.setAttribute('aria-busy', loading ? 'true' : 'false');
        panel.innerHTML = `
            <div class="qs-scroll">
                <header class="qs-head">
                    <span class="qs-avatar" aria-hidden="true">${esc(VM.initials(quote.client_full_name))}</span>
                    <div class="qs-head-main">
                        <h2 class="qs-name" id="qs-name">${esc(quote.client_full_name || 'Sin nombre')}</h2>
                        ${city ? `<p class="qs-place"><i data-wo-icon="map-pin" aria-hidden="true"></i>${esc(city)}</p>` : ''}
                        <div class="qs-badges">
                            <span class="qs-badge qs-badge--${esc(badge.tone)}">${esc(badge.label)}</span>
                            <span class="qs-date">${esc(VM.shortDate(quote.created_at))}</span>
                        </div>
                    </div>
                    <button type="button" class="qs-close" data-qs-action="close" aria-label="Cerrar resumen"><i data-wo-icon="x" aria-hidden="true"></i></button>
                </header>

                <div class="qs-controls">
                    <p class="qs-ref">${esc(VM.shortRef(quote))} · ${esc(VM.shortDate(quote.created_at))}${quote.is_archived ? ' · Archivada' : ''}</p>
                    <div class="qs-selects">
                        ${statusSelect(quote)}
                        ${prioritySelect(quote)}
                    </div>
                </div>

                <div class="qs-body">
                    <section class="qs-section">
                        ${sectionTitle('Resumen del tatuaje')}
                        <dl class="qs-tattoo">
                            ${tattoo.map(([label, value]) => `
                                <div class="qs-tattoo-cell">
                                    <dt>${esc(label)}</dt>
                                    <dd>${esc(value || '—')}</dd>
                                </div>`).join('')}
                        </dl>
                        <p class="qs-desc">${esc(quote.tattoo_idea_description || quote.project_description || 'Sin descripción')}</p>
                    </section>

                    <section class="qs-section">
                        ${sectionTitle('Resumen económico')}
                        <div class="qs-econ">
                            <div class="qs-econ-tile"><span class="qs-econ-value${valueSizeClass(priceTile(quote))}">${esc(priceTile(quote))}</span><span class="qs-econ-label">Precio</span></div>
                            <div class="qs-econ-tile"><span class="qs-econ-value">${esc(durationTile(quote))}</span><span class="qs-econ-label">Duración</span></div>
                            <div class="qs-econ-tile"><span class="qs-econ-value">${esc(sessionsTile(quote))}</span><span class="qs-econ-label">Sesiones</span></div>
                        </div>
                    </section>

                    <section class="qs-section">
                        ${sectionTitle('Timeline · Estado')}
                        ${timelineHtml(quote)}
                    </section>

                    <section class="qs-section qs-section--tight">
                        ${sectionTitle('Última nota privada')}
                        ${note
                            ? `<p class="qs-note"><i data-wo-icon="edit" aria-hidden="true"></i><span>${esc(note)}</span></p>`
                            : `<p class="qs-muted">${loading ? 'Cargando…' : 'Todavía no dejaste notas privadas.'}</p>`}
                    </section>

                    <section class="qs-section qs-section--tight">
                        ${sectionTitle('Últimos mensajes')}
                        ${loading && !(extras.messages || []).length ? '<p class="qs-muted">Cargando…</p>' : messagesHtml()}
                    </section>
                </div>
            </div>

            <footer class="qs-foot">
                ${actionsHtml(quote)}
            </footer>`;
    }

    // ---------- datos ----------
    async function loadExtras(quote, token) {
        const D = window.WeotziData;
        const safe = (p) => p.catch((err) => { console.warn('[quotations-summary]', err && err.message); return []; });
        const numericId = Number(quote.id);
        const [notes, messages, sessions] = await Promise.all([
            Number.isFinite(numericId) && D.Notes ? safe(D.Notes.listForQuote(numericId)) : Promise.resolve([]),
            quote.quote_id && D.Chat ? safe(D.Chat.listByQuote(quote.quote_id)) : Promise.resolve([]),
            Number.isFinite(numericId) && D.Sessions ? safe(D.Sessions.listForQuote(numericId)) : Promise.resolve([])
        ]);
        if (token !== loadToken) return;
        extras = { notes: notes || [], messages: messages || [], sessions: sessions || [] };
        render(false);
    }

    // ---------- abrir / cerrar ----------
    function setUrl(ref) {
        try {
            const url = new URL(window.location.href);
            if (ref) url.searchParams.set('resumen', ref);
            else url.searchParams.delete('resumen');
            window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        } catch (e) { /* sin URL API */ }
    }

    function open(quoteId, opts) {
        opts = opts || {};
        const quote = page() && page().findQuote(quoteId);
        if (!quote) return;
        if (window.QuotationNew && window.QuotationNew.isOpen && window.QuotationNew.isOpen()) return;
        const panel = $('quote-summary');
        const overlay = $('quote-summary-overlay');
        if (!panel || !overlay) return;

        if (!current) lastFocus = document.activeElement;
        current = quote;
        extras = { notes: [], messages: [], sessions: [] };
        const token = ++loadToken;

        syncTop();
        render(true);
        panel.hidden = false;
        overlay.hidden = false;
        document.documentElement.classList.add('qs-open');
        page().selectCard(quote.id);
        if (!opts.keepUrl) setUrl(quote.quote_id || String(quote.id));
        void panel.offsetWidth; // estilo inicial aplicado: la transición corre sin depender de rAF
        panel.classList.add('is-open');
        overlay.classList.add('is-open');
        panel.focus({ preventScroll: true });
        loadExtras(quote, token);
    }

    function close() {
        const panel = $('quote-summary');
        const overlay = $('quote-summary-overlay');
        if (!panel || !current) return;
        current = null;
        loadToken++;
        panel.classList.remove('is-open');
        overlay.classList.remove('is-open');
        panel.hidden = true;
        overlay.hidden = true;
        panel.innerHTML = '';
        document.documentElement.classList.remove('qs-open');
        page().selectCard(null);
        setUrl(null);
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
        lastFocus = null;
    }

    // ---------- acciones ----------
    async function patchQuote(patch, okMessage) {
        if (!current || busy) return;
        const quote = current;
        busy = true;
        try {
            await window.WeotziData.Quotations.updateById(quote.id, patch);
            page().applyChange(quote, patch);
            page().toast(okMessage, 'success');
            if (current === quote) render(false);
        } catch (err) {
            console.error('[quotations-summary] update', err);
            page().toast('No pudimos actualizar la cotización.', 'error');
            if (current === quote) render(false);
        } finally {
            busy = false;
        }
    }

    function responsePatch(quote) {
        return {
            quote_status: 'responded',
            artist_budget_amount: quote.artist_budget_amount || quote.client_budget_amount || null,
            artist_budget_currency: quote.artist_budget_currency || quote.client_budget_currency || 'USD',
            artist_responded_at: new Date().toISOString()
        };
    }

    async function onAction(action) {
        const quote = current;
        if (!quote) return;
        const pg = page();
        if (action === 'close') return close();
        if (action === 'accept') {
            const a = VM.summaryActions(quote).accept;
            if (!a) return;
            const patch = a.patch.quote_status === 'responded' ? responsePatch(quote) : a.patch;
            return patchQuote(patch, patch.quote_status === 'responded' ? 'Cotización aceptada y enviada al cliente.' : 'Trabajo iniciado.');
        }
        if (action === 'reject') {
            const r = VM.summaryActions(quote).reject;
            if (!r) return;
            if (!window.confirm('¿Querés rechazar esta solicitud? Esta acción quedará en el historial.')) return;
            return patchQuote(r.patch, 'Solicitud rechazada.');
        }
        if (action === 'schedule') {
            window.location.href = pg.appUrl(`/calendar?quote=${encodeURIComponent(quote.quote_id || quote.id)}&new=appointment`);
            return;
        }
        if (action === 'contact') {
            if (quote.client_user_id) {
                window.location.href = pg.appUrl(`/artist/inbox?quote=${encodeURIComponent(quote.quote_id || quote.id)}`);
            } else if (quote.client_email) {
                window.location.href = `mailto:${encodeURIComponent(quote.client_email)}?subject=${encodeURIComponent('Tu cotización ' + (quote.quote_id || ''))}`;
            } else if (quote.client_whatsapp) {
                window.open(`https://wa.me/${String(quote.client_whatsapp).replace(/\D/g, '')}`, '_blank', 'noopener');
            }
            return;
        }
        if (action === 'unarchive') {
            return patchQuote({ is_archived: false }, 'La cotización volvió al listado.');
        }
        if (action === 'delete') {
            if (!window.confirm('¿Querés eliminar esta cotización para siempre? No se puede deshacer.')) return;
            try {
                await window.WeotziData.Quotations.hardDeleteById(quote.id);
                close();
                pg.removeQuote(quote);
                pg.toast('Cotización eliminada.', 'success');
            } catch (err) {
                console.error('[quotations-summary] delete', err);
                pg.toast('No pudimos eliminar la cotización.', 'error');
            }
        }
    }

    async function onStatusChange(value) {
        const quote = current;
        if (!quote || value === quote.quote_status) return;
        const allowed = VM.STATUS_TRANSITIONS[quote.quote_status] || [];
        if (!allowed.includes(value)) {
            page().toast('Ese cambio de estado no está permitido.', 'error');
            return render(false);
        }
        const patch = value === 'responded' ? responsePatch(quote) : { quote_status: value };
        if (value === 'artist_completed') patch.artist_completed_at = new Date().toISOString();
        return patchQuote(patch, `Estado actualizado: ${VM.statusView(value).label}.`);
    }

    async function onPriorityChange(value) {
        const quote = current;
        if (!quote || busy) return;
        busy = true;
        try {
            await window.WeotziData.Quotations.updatePriority(quote.id, value);
            page().applyChange(quote, { priority: value });
            if (current === quote) render(false);
        } catch (err) {
            console.error('[quotations-summary] priority', err);
            page().toast('No pudimos actualizar la prioridad.', 'error');
            if (current === quote) render(false);
        } finally {
            busy = false;
        }
    }

    // ---------- eventos ----------
    document.addEventListener('DOMContentLoaded', () => {
        const panel = $('quote-summary');
        const overlay = $('quote-summary-overlay');
        if (!panel || !overlay) return;

        overlay.addEventListener('click', close);
        panel.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-qs-action]');
            if (!btn || btn.disabled) return;
            event.preventDefault();
            onAction(btn.dataset.qsAction);
        });
        panel.addEventListener('change', (event) => {
            if (event.target.id === 'qs-status') onStatusChange(event.target.value);
            if (event.target.id === 'qs-priority') onPriorityChange(event.target.value);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && current) close();
        });
        window.addEventListener('resize', () => { if (current) syncTop(); });
        document.addEventListener('weotzi:quotations-currency', () => { if (current) render(false); });
    });

    window.QuotationSummary = {
        open,
        close,
        currentId: () => (current ? current.id : null),
        isOpen: () => !!current,
        _noteText: noteText
    };
})();
