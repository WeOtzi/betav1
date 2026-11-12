/**
 * Inbox del estudio · pestaña "Mensajes" de /studio/dashboard (ronda 3).
 *
 * Lado estudio de "Escribir al estudio" (2007:5795), postulaciones a spots,
 * invitaciones/contratos y vínculos de viaje. Diseño propio sobre el lenguaje
 * del inbox del artista (801:1085): sidebar de categorías, lista de tarjetas,
 * hilo con burbujas y panel de contexto.
 *
 * Autorización real en las RPC (dueño del estudio). Este módulo nunca escribe
 * tablas directo: list/open por WeotziData.StudioInbox y el resto por
 * WeotziData.Inbox (send_inbox_message, mark_inbox_thread_read, flags, adjuntos).
 */
(function () {
    'use strict';

    const D = window.WeotziData || {};
    const M = window.WoStudioInboxModel;
    const state = {
        studio: null, userId: null, threads: [], filter: 'all', query: '',
        activeId: null, messages: [], listChannel: null, threadChannel: null,
        pendingFile: null, loading: false, loadedOnce: false, refreshTimer: null, sending: false,
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const auth = window.WeOtziStudioAuth;
        if (!auth || !D.StudioInbox || !D.Inbox || !M || !el('si-shell')) return;
        await auth.ready();
        state.studio = auth.getCurrent() || await auth.check();
        if (!state.studio) return;
        state.userId = state.studio.user_id || null;
        if (!state.userId) {
            try {
                const { data } = await auth.getSupabase().auth.getUser();
                state.userId = data && data.user ? data.user.id : null;
            } catch (_) { /* sin usuario: las RPC responderán 42501 */ }
        }

        wire();
        await load();
        const wanted = new URLSearchParams(window.location.search).get('thread');
        if (wanted && state.threads.some(t => t.id === wanted)) {
            if (window.location.hash !== '#mensajes') window.location.hash = 'mensajes';
            await openThread(wanted);
        }
        subscribe();
    }

    function wire() {
        el('si-search').addEventListener('input', event => {
            state.query = event.target.value;
            renderList();
        });
        el('si-filters').addEventListener('click', event => {
            const button = event.target.closest('[data-si-filter]');
            if (!button) return;
            state.filter = button.dataset.siFilter;
            renderSidebar();
            renderList();
        });
        el('si-summary').addEventListener('click', event => {
            const button = event.target.closest('[data-si-filter]');
            if (!button) return;
            state.filter = state.filter === button.dataset.siFilter ? 'all' : button.dataset.siFilter;
            renderSidebar();
            renderList();
        });
        el('si-list').addEventListener('click', onListClick);
        el('si-thread-head').addEventListener('click', onHeadClick);
        el('si-context').addEventListener('click', onContextClick);
        el('si-context').addEventListener('keydown', event => {
            if (event.key === 'Escape' && el('si-shell').classList.contains('is-context-open')) {
                event.preventDefault();
                toggleContext(false);
            }
        });
        el('si-messages').addEventListener('click', onMessagesClick);
        el('si-composer').addEventListener('submit', onSend);
        el('si-input').addEventListener('input', syncSend);
        el('si-attach').addEventListener('click', () => el('si-file').click());
        el('si-file').addEventListener('change', onFileChosen);
        el('si-attachment').addEventListener('click', event => {
            if (event.target.closest('[data-si-remove-file]')) clearFile();
        });
        window.addEventListener('studio:tabchange', event => {
            if (event.detail && event.detail.tab === 'mensajes') load();
        });
        window.addEventListener('studio:change-request-resolved', () => scheduleRefresh());
        window.addEventListener('beforeunload', () => {
            D.StudioInbox.removeChannel(state.listChannel);
            D.Inbox.removeChannel(state.threadChannel);
        }, { once: true });
    }

    /* ------------------------------ datos ------------------------------ */

    async function load() {
        if (state.loading || !state.studio) return;
        state.loading = true;
        const list = el('si-list');
        list.setAttribute('aria-busy', 'true');
        try {
            const rows = await D.StudioInbox.listThreads(state.studio.id);
            state.threads = rows.map(M.normalizeThread);
            state.loadedOnce = true;
            renderSidebar();
            renderList();
            renderNavBadge();
            const active = findThread(state.activeId);
            if (active) { renderThreadHead(active); renderContext(active); }
        } catch (error) {
            console.error('[studio-inbox] listar', error);
            if (!state.loadedOnce) {
                list.innerHTML = '<div class="wo-empty si-list-empty" role="alert"><span class="wo-empty-title">No pudimos cargar los mensajes</span><p>Volvé a abrir esta sección para intentar nuevamente.</p></div>';
            } else {
                notify(M.friendlyError(error), 'error');
            }
        } finally {
            state.loading = false;
            list.setAttribute('aria-busy', 'false');
        }
    }

    function scheduleRefresh() {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(load, 400);
    }

    function subscribe() {
        if (!state.userId || typeof D.StudioInbox.subscribeStudio !== 'function') return;
        try { state.listChannel = D.StudioInbox.subscribeStudio(state.userId, scheduleRefresh); }
        catch (error) { console.warn('[studio-inbox] realtime no disponible', error); }
    }

    function findThread(id) { return state.threads.find(t => t.id === id) || null; }

    /* ------------------------------ sidebar ----------------------------- */

    function renderSidebar() {
        const c = M.counts(state.threads);
        el('si-filters').innerHTML = M.FILTERS.map(f => {
            const active = state.filter === f.key;
            return '<button type="button" class="si-side-item' + (active ? ' is-active' : '') + '" data-si-filter="' + f.key + '" aria-pressed="' + active + '">' +
                esc(f.label) + '<span class="si-side-count wo-mono-num">' + (c[f.key] || 0) + '</span></button>';
        }).join('');
        el('si-summary').innerHTML = '<p class="si-summary-cap">RESUMEN</p>' +
            summaryRow('Sin leer', c.unread, 'is-unread') +
            summaryRow('Esperando tu respuesta', c.waiting, 'is-waiting', 'waiting') +
            summaryRow('Respondidas', c.replied) +
            summaryRow('Cambios pedidos', c.changes, c.changes ? 'is-waiting' : '', 'changes') +
            summaryRow('Favoritas', c.favorites, '', 'favorites');
    }

    function summaryRow(label, value, cls, filter) {
        const inner = '<span>' + esc(label) + '</span><span class="si-sum-n wo-mono-num ' + (cls || '') + '">' + value + '</span>';
        if (!filter || filter === 'waiting') return '<div class="si-summary-row">' + inner + '</div>';
        const active = state.filter === filter;
        return '<button type="button" class="si-summary-row si-summary-filter' + (active ? ' is-active' : '') + '" data-si-filter="' + filter + '" aria-pressed="' + active + '">' + inner + '</button>';
    }

    function renderNavBadge() {
        const total = M.unreadTotal(state.threads);
        document.querySelectorAll('.studio-dash-tab[data-tab="mensajes"]').forEach(tab => {
            let badge = tab.querySelector('.si-navcount');
            if (!total) { if (badge) badge.remove(); return; }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'si-navcount';
                tab.appendChild(badge);
            }
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.setAttribute('aria-label', total + ' sin leer');
        });
    }

    /* ------------------------------- lista ------------------------------ */

    function renderList() {
        const rows = M.filterThreads(state.threads, state.filter, state.query);
        el('si-list-cap').textContent = (M.LIST_CAPTIONS[state.filter] || 'TODAS') + ' · ' + rows.length;
        const host = el('si-list');
        if (!rows.length) {
            const empty = !state.threads.length;
            host.innerHTML = '<div class="wo-empty si-list-empty"><i data-wo-icon="message-circle" aria-hidden="true"></i>' +
                '<span class="wo-empty-title">' + (empty ? 'Todavía no hay conversaciones' : 'No hay conversaciones') + '</span>' +
                '<p>' + (empty
                    ? 'Cuando un artista te escriba, se postule a un spot, responda una invitación o pida vincular un viaje, lo vas a ver acá.'
                    : 'Probá con otra categoría o búsqueda.') + '</p></div>';
            refreshIcons();
            return;
        }
        host.innerHTML = rows.map(rowHtml).join('');
        refreshIcons();
    }

    function rowHtml(t) {
        const active = t.id === state.activeId ? ' is-active' : '';
        const unread = t.unread > 0 ? ' is-unread' : '';
        return '<article class="si-row' + active + unread + '" role="listitem">' +
            '<button type="button" class="si-row-open" data-si-open="' + esc(t.id) + '" aria-label="Abrir conversación con ' + esc(t.name) + ' · ' + esc(t.label) + (t.unread ? ' · ' + t.unread + ' sin leer' : '') + '">' +
                '<span class="si-avatar si-avatar--' + esc(t.tone) + '" aria-hidden="true">' + esc(t.initials) + '</span>' +
                '<span class="si-row-body">' +
                    '<span class="si-row-top"><span class="si-row-name">' + esc(t.name) + '</span><time class="si-row-time"' + (t.lastAt ? ' datetime="' + esc(t.lastAt) + '"' : '') + '>' + esc(M.listTime(t.lastAt)) + '</time></span>' +
                    '<span class="si-row-tags"><span class="si-tag is-' + esc(t.tone) + '">' + esc(t.label) + '</span>' +
                        (t.pendingChange ? '<span class="si-tag is-alert">Cambios pedidos</span>' : '') + '</span>' +
                    '<span class="si-row-prev"><span class="si-row-preview">' + esc(t.preview) + '</span>' +
                        (t.unread ? '<span class="si-row-unread" aria-hidden="true">' + (t.unread > 99 ? '99+' : t.unread) + '</span>' : '') + '</span>' +
                    '<span class="si-row-status ' + t.response.cls + '">' + esc(t.response.label) + '</span>' +
                '</span>' +
            '</button>' +
            '<button type="button" class="si-row-star' + (t.favorite ? ' is-active' : '') + '" data-si-flag="favorite" data-id="' + esc(t.id) + '" aria-pressed="' + t.favorite + '" aria-label="' + (t.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '"><i data-wo-icon="star" class="wo-icon-16" aria-hidden="true"></i></button>' +
        '</article>';
    }

    async function onListClick(event) {
        const flag = event.target.closest('[data-si-flag]');
        if (flag) { await toggleFlag(flag.dataset.id, flag.dataset.siFlag); return; }
        const open = event.target.closest('[data-si-open]');
        if (open) await openThread(open.dataset.siOpen);
    }

    /* ------------------------------- hilo ------------------------------- */

    async function ensureParticipant(thread) {
        const opened = await D.StudioInbox.openThread(state.studio.id, thread.id);
        thread.participant = true;
        thread.unread = 0;
        thread.raw.unread_count = 0;
        return opened;
    }

    async function openThread(id) {
        const thread = findThread(id);
        if (!thread) return;
        state.activeId = id;
        state.messages = [];
        clearFile();
        D.Inbox.removeChannel(state.threadChannel);
        state.threadChannel = null;

        el('si-thread-placeholder').hidden = true;
        el('si-thread').hidden = false;
        el('si-shell').classList.add('is-thread-open');
        el('si-shell').classList.remove('is-context-open');
        renderList();
        renderThreadHead(thread);
        renderContext(thread);
        el('si-messages').innerHTML = '<div class="si-msg-loading" role="status"><span class="wo-spinner" aria-hidden="true"></span><span class="wo-meta-s">Cargando mensajes</span></div>';
        setComposer(!thread.closed);

        try {
            await ensureParticipant(thread);
            if (state.activeId !== id) return;
            state.messages = await D.Inbox.listMessages(id);
            if (state.activeId !== id) return;
            renderMessages();
            renderSidebar();
            renderList();
            renderNavBadge();
            state.threadChannel = D.Inbox.subscribeThread(id, payload => {
                const message = payload && payload.new;
                if (!message || state.activeId !== id) return;
                if (!state.messages.some(m => m.id === message.id)) {
                    state.messages.push(message);
                    renderMessages();
                }
                D.Inbox.markRead(id).catch(() => {});
                scheduleRefresh();
            });
        } catch (error) {
            console.error('[studio-inbox] abrir hilo', error);
            el('si-messages').innerHTML = '<div class="wo-empty" role="alert"><span class="wo-empty-title">No pudimos cargar los mensajes</span><p>' + esc(M.friendlyError(error)) + '</p></div>';
        }
    }

    function renderThreadHead(t) {
        el('si-thread-head').innerHTML =
            '<button type="button" class="wo-iconbtn si-back" data-si-back aria-label="Volver a conversaciones"><i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i></button>' +
            '<span class="si-avatar si-avatar--' + esc(t.tone) + '" aria-hidden="true">' + esc(t.initials) + '</span>' +
            '<div class="si-head-copy"><strong>' + esc(t.name) + '</strong><span>' + esc(t.label) + (t.subject ? ' · ' + esc(t.subject) : '') + '</span></div>' +
            '<div class="si-thread-tools">' +
                '<button type="button" class="wo-iconbtn si-info-toggle" data-si-info aria-controls="si-context" aria-expanded="' + el('si-shell').classList.contains('is-context-open') + '" aria-label="Ver detalles de la conversación" title="Detalles"><i data-wo-icon="info" class="wo-icon-16" aria-hidden="true"></i></button>' +
                '<button type="button" class="wo-iconbtn' + (t.favorite ? ' is-active' : '') + '" data-si-head-flag="favorite" aria-pressed="' + t.favorite + '" aria-label="' + (t.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '" title="Favorita"><i data-wo-icon="star" class="wo-icon-16" aria-hidden="true"></i></button>' +
                '<button type="button" class="wo-iconbtn" data-si-head-flag="archived" aria-label="' + (t.archived ? 'Restaurar conversación' : 'Archivar conversación') + '" title="' + (t.archived ? 'Restaurar' : 'Archivar') + '"><i data-wo-icon="archive" class="wo-icon-16" aria-hidden="true"></i></button>' +
            '</div>';
        refreshIcons();
    }

    async function onHeadClick(event) {
        if (event.target.closest('[data-si-back]')) {
            el('si-shell').classList.remove('is-thread-open');
            const opener = el('si-list').querySelector('[data-si-open="' + cssEscape(state.activeId) + '"]');
            if (opener) opener.focus();
            return;
        }
        if (event.target.closest('[data-si-info]')) { toggleContext(); return; }
        const flag = event.target.closest('[data-si-head-flag]');
        if (flag && state.activeId) await toggleFlag(state.activeId, flag.dataset.siHeadFlag);
    }

    // Debajo de 1240px de panel el contexto se abre como hoja sobre el hilo.
    function toggleContext(force) {
        const shell = el('si-shell');
        const open = typeof force === 'boolean' ? force : !shell.classList.contains('is-context-open');
        shell.classList.toggle('is-context-open', open);
        document.querySelectorAll('[data-si-info]').forEach(b => b.setAttribute('aria-expanded', String(open)));
        if (open) {
            const first = el('si-context').querySelector('button, a');
            if (first) first.focus();
        } else {
            const toggle = el('si-thread-head').querySelector('[data-si-info]');
            if (toggle) toggle.focus();
        }
    }

    async function toggleFlag(id, flag) {
        const thread = findThread(id);
        if (!thread) return;
        const favorite = flag === 'favorite' ? !thread.favorite : null;
        const archived = flag === 'archived' ? !thread.archived : null;
        try {
            if (!thread.participant) await ensureParticipant(thread);
            await D.Inbox.setFlags(id, { favorite, archived });
            if (favorite !== null) { thread.favorite = favorite; thread.raw.is_favorite = favorite; }
            if (archived !== null) { thread.archived = archived; thread.raw.is_archived = archived; }
            renderSidebar();
            renderList();
            if (state.activeId === id) {
                renderThreadHead(thread);
                if (archived === true) {
                    notify('Conversación archivada. La encontrás en Archivados.', 'success');
                }
            }
            renderNavBadge();
        } catch (error) {
            console.error('[studio-inbox] flags', error);
            notify(M.friendlyError(error), 'error');
        }
    }

    function renderMessages() {
        const host = el('si-messages');
        if (!state.messages.length) {
            host.innerHTML = '<div class="wo-empty si-msg-empty"><span class="wo-empty-title">Sin mensajes todavía</span><p>Escribile al artista para empezar la conversación.</p></div>';
            return;
        }
        let lastDay = '';
        host.innerHTML = state.messages.map(message => {
            const day = String(message.created_at || '').slice(0, 10);
            const dayLabel = day && day !== lastDay ? '<p class="si-day">' + esc(M.shortDate(day)) + '</p>' : '';
            lastDay = day || lastDay;
            const role = M.messageRole(message, state.userId);
            const time = '<time datetime="' + esc(message.created_at || '') + '">' + esc(M.listTime(message.created_at)) + '</time>';
            if (role === 'system') {
                return dayLabel + '<div class="si-msg si-msg--system"><span class="si-msg-cap">Aviso automático</span><p>' + linkify(message.body || '') + '</p>' + time + '</div>';
            }
            const attachment = message.attachment_path
                ? '<button type="button" class="si-msg-attachment" data-si-attachment="' + esc(message.attachment_path) + '"><i data-wo-icon="' + (message.message_kind === 'image' ? 'image' : 'paperclip') + '" class="wo-icon-16" aria-hidden="true"></i><span>' + esc(message.attachment_name || 'Archivo adjunto') + '</span><i data-wo-icon="download" class="wo-icon-16" aria-hidden="true"></i></button>'
                : '';
            return dayLabel + '<div class="si-msg si-msg--' + role + '">' +
                '<div class="si-bubble">' + (message.body ? '<p>' + linkify(message.body) + '</p>' : '') + attachment + time + '</div>' +
            '</div>';
        }).join('');
        refreshIcons();
        host.scrollTop = host.scrollHeight;
    }

    async function onMessagesClick(event) {
        const button = event.target.closest('[data-si-attachment]');
        if (!button) return;
        button.disabled = true;
        try {
            const url = await D.Inbox.signedAttachmentUrl(button.dataset.siAttachment);
            if (url) window.open(url, '_blank', 'noopener');
        } catch (error) {
            console.error('[studio-inbox] adjunto', error);
            notify('No pudimos abrir el archivo.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    /* ----------------------------- contexto ----------------------------- */

    function renderContext(t) {
        const host = el('si-context');
        const info = M.contextRows(t);
        const action = M.contextAction(t);
        const profile = t.username
            ? '<a class="wo-btn wo-btn--secondary si-ctx-btn" href="' + esc(appUrl('/artist/profile?artist=' + encodeURIComponent(t.username))) + '" target="_blank" rel="noopener">Ver perfil del artista</a>'
            : '';
        const change = t.pendingChange
            ? '<div class="si-ctx-change" role="note"><p class="si-ctx-label">Cambios pedidos por el artista</p><p class="si-ctx-quote">' + esc(t.pendingChange.message || '') + '</p></div>'
            : '';
        host.innerHTML = '<div class="si-ctx-top"><p class="si-ctx-eyebrow">' + esc(info.eyebrow) + '</p>' +
                '<button type="button" class="wo-iconbtn si-ctx-close" data-si-info-close aria-label="Cerrar detalles"><i data-wo-icon="x" class="wo-icon-16" aria-hidden="true"></i></button></div>' +
            '<div class="si-ctx-block"><span class="si-ctx-label">Artista</span><span class="si-ctx-value">' + esc(t.name) + '</span>' +
                (t.username ? '<span class="si-ctx-sub">@' + esc(t.username) + '</span>' : '') + '</div>' +
            info.rows.map(r => '<div class="si-ctx-block"><span class="si-ctx-label">' + esc(r.label) + '</span><span class="si-ctx-value">' + esc(r.value) + '</span></div>').join('') +
            (info.status ? '<span class="si-ctx-status is-' + esc(info.status.tone) + '">' + esc(info.status.label) + '</span>' : '') +
            change +
            '<div class="si-ctx-actions">' +
                (action ? '<button type="button" class="wo-btn si-ctx-btn" data-si-goto="' + esc(action.tab) + '"' + (t.pendingChange ? ' data-si-request="' + esc(t.pendingChange.id) + '"' : '') + '>' + esc(action.label) + '</button>' : '') +
                profile +
            '</div>';
        host.hidden = false;
    }

    function onContextClick(event) {
        if (event.target.closest('[data-si-info-close]')) { toggleContext(false); return; }
        const go = event.target.closest('[data-si-goto]');
        if (!go) return;
        const tab = go.dataset.siGoto;
        const requestId = go.dataset.siRequest;
        el('si-shell').classList.remove('is-context-open');
        window.location.hash = tab;
        if (requestId) {
            window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent('studio:focus-change-request', { detail: { requestId } }));
            }, 60);
        }
    }

    /* ----------------------------- composer ----------------------------- */

    function setComposer(enabled) {
        el('si-input').disabled = !enabled;
        el('si-attach').disabled = !enabled;
        el('si-input').placeholder = enabled ? 'Escribí un mensaje…' : 'Esta conversación está cerrada.';
        el('si-input').value = '';
        syncSend();
    }

    function syncSend() {
        const hasText = !!el('si-input').value.trim();
        el('si-send').disabled = state.sending || el('si-input').disabled || (!hasText && !state.pendingFile);
    }

    function onFileChosen(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { notify('El archivo supera el límite de 15 MB.', 'error'); return; }
        state.pendingFile = file;
        const box = el('si-attachment');
        box.innerHTML = '<span class="si-attachment-card"><i data-wo-icon="paperclip" class="wo-icon-16" aria-hidden="true"></i><span class="si-attachment-name">' + esc(file.name) + '</span>' +
            '<button type="button" class="wo-iconbtn si-attachment-remove" data-si-remove-file aria-label="Quitar ' + esc(file.name) + '"><i data-wo-icon="x" class="wo-icon-16" aria-hidden="true"></i></button></span>';
        box.hidden = false;
        refreshIcons();
        syncSend();
    }

    function clearFile() {
        state.pendingFile = null;
        const box = el('si-attachment');
        if (box) { box.innerHTML = ''; box.hidden = true; }
        if (el('si-input')) syncSend();
    }

    async function onSend(event) {
        event.preventDefault();
        const thread = findThread(state.activeId);
        if (!thread || state.sending) return;
        const body = el('si-input').value.trim();
        if (!state.pendingFile) {
            const problem = M.validateMessage(body);
            if (problem) { notify(problem, 'error'); return; }
        } else if (body.length > M.MESSAGE_MAX) {
            notify(M.validateMessage(body), 'error'); return;
        }
        state.sending = true;
        syncSend();
        try {
            if (!thread.participant) await ensureParticipant(thread);
            let attachment = null;
            if (state.pendingFile) attachment = await D.Inbox.uploadAttachment(thread.id, state.userId, state.pendingFile);
            const message = await D.Inbox.sendMessage({ threadId: thread.id, body: body || null, attachment });
            if (message && message.id && !state.messages.some(m => m.id === message.id)) state.messages.push(message);
            el('si-input').value = '';
            clearFile();
            renderMessages();
            thread.raw.last_sender_role = 'studio';
            thread.raw.last_message = body || (attachment && attachment.name) || thread.raw.last_message;
            thread.raw.last_message_at = (message && message.created_at) || new Date().toISOString();
            Object.assign(thread, M.normalizeThread(thread.raw));
            renderSidebar();
            renderList();
        } catch (error) {
            console.error('[studio-inbox] enviar', error);
            notify(M.friendlyError(error), 'error');
        } finally {
            state.sending = false;
            syncSend();
            el('si-input').focus();
        }
    }

    /* ------------------------------ utilidades -------------------------- */

    function notify(message, kind) {
        const node = el('si-status');
        if (!node) return;
        node.className = 'studio-status studio-status-' + (kind || 'info');
        node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        node.textContent = message;
        node.hidden = false;
        window.clearTimeout(notify.timer);
        notify.timer = window.setTimeout(() => { node.hidden = true; }, 5000);
    }

    function linkify(value) {
        const source = String(value || '');
        const pattern = /(https?:\/\/[^\s<]+|\/(?:artist|studio|travel)\/[^\s<]*)/g;
        let html = '';
        let last = 0;
        source.replace(pattern, (match, _url, offset) => {
            html += esc(source.slice(last, offset));
            const clean = match.replace(/[).,;:]+$/, '');
            const external = /^https?:/i.test(clean);
            const href = external ? clean : appUrl(clean);
            html += '<a class="si-msg-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(clean) + '</a>';
            html += esc(match.slice(clean.length));
            last = offset + match.length;
            return match;
        });
        return html + esc(source.slice(last));
    }

    function appUrl(path) {
        const auth = window.WeOtziStudioAuth;
        return auth && auth.appUrl ? auth.appUrl(path) : path;
    }

    function refreshIcons() {
        // wo-icons.js ya hidrata con un MutationObserver; esto cubre la primera carga.
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(document);
    }

    function cssEscape(value) {
        return window.CSS && CSS.escape ? CSS.escape(String(value || '')) : String(value || '').replace(/"/g, '\\"');
    }

    function el(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    window.WeOtziStudioInbox = { reload: load, open: openThread };
})();
