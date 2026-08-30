/**
 * Inbox unificado del artista — Figma 144:1250.
 *
 * El contrato persistente vive en inbox_threads / inbox_messages. Las fuentes
 * legacy de cotizaciones y soporte siguen cargándose como compatibilidad, sin
 * duplicar conversaciones que ya fueron proyectadas al inbox unificado.
 */
(function () {
    'use strict';

    const D = window.WeotziData || {};
    const CATEGORY_LABELS = {
        all: 'TODAS',
        clients: 'CLIENTES',
        quotations: 'COTIZACIONES',
        support: 'SOPORTE',
        invitations: 'INVITACIONES',
        spots: 'SPOTS',
        job_board: 'JOB BOARD',
        studios: 'ESTUDIOS',
        trips: 'VIAJES',
        archived: 'ARCHIVADOS',
        favorites: 'FAVORITAS',
    };
    const CATEGORY_META = {
        clients: { label: 'Cliente', tone: 'client' },
        quotations: { label: 'Cotización', tone: 'quote' },
        support: { label: 'Soporte', tone: 'support' },
        invitations: { label: 'Invitación', tone: 'invitation' },
        spots: { label: 'Spot', tone: 'spot' },
        job_board: { label: 'Job Board', tone: 'job' },
        studios: { label: 'Estudio', tone: 'studio' },
        trips: { label: 'Viaje', tone: 'trip' },
    };
    const CLOSED_QUOTE_STATUSES = ['completed', 'client_rejected', 'expired'];
    const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain';
    const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
    const state = {
        userId: null,
        unified: [],
        legacyQuotes: [],
        legacySupport: null,
        legacySupportMessages: [],
        rows: [],
        filter: 'all',
        search: '',
        activeKey: null,
        activeMessages: [],
        pendingFile: null,
        listChannel: null,
        threadChannel: null,
        refreshTimer: null,
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireStaticUi();
        try {
            if (window.ConfigManager && typeof window.ConfigManager.init === 'function') {
                await window.ConfigManager.init();
            }
            const client = D.getClient ? D.getClient() : window._supabase;
            const sessionResult = client ? await client.auth.getSession() : null;
            const session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
            if (!session) {
                window.location.replace('/login?returnTo=' + encodeURIComponent(window.location.pathname));
                return;
            }
            state.userId = session.user.id;
            await reloadRows({ preserveSelection: false });
            subscribeList();
            openFromQuery();
        } catch (error) {
            console.error('[artist-inbox] init', error);
            renderFatal('No pudimos cargar tu inbox. Reintentá en unos segundos.');
        }
    }

    function wireStaticUi() {
        const menuToggle = el('ai-menu-toggle');
        menuToggle && menuToggle.addEventListener('click', function () {
            const menu = el('ai-mobile-menu');
            const open = menu.hidden;
            menu.hidden = !open;
            menuToggle.setAttribute('aria-expanded', String(open));
        });

        el('ai-logout') && el('ai-logout').addEventListener('click', async function () {
            const client = D.getClient ? D.getClient() : window._supabase;
            if (client) await client.auth.signOut();
            window.location.replace('/login');
        });

        document.querySelectorAll('[data-filter]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.filter = button.dataset.filter || 'all';
                document.querySelectorAll('[data-filter]').forEach(function (item) {
                    const selected = item === button;
                    item.classList.toggle('is-active', selected);
                    item.setAttribute('aria-pressed', String(selected));
                });
                closeMobileThread();
                renderList();
            });
        });

        el('ai-search') && el('ai-search').addEventListener('input', function (event) {
            state.search = event.target.value.trim().toLocaleLowerCase('es');
            renderList();
        });

        el('ai-list') && el('ai-list').addEventListener('click', onListClick);
        el('ai-list') && el('ai-list').addEventListener('keydown', function (event) {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open-thread]')) {
                event.preventDefault();
                openThread(event.target.dataset.openThread);
            }
        });
        el('ai-thread-head') && el('ai-thread-head').addEventListener('click', onThreadHeadClick);
        el('ai-composer') && el('ai-composer').addEventListener('submit', onComposerSubmit);
        el('ai-input') && el('ai-input').addEventListener('input', syncSendState);
        el('ai-attach') && el('ai-attach').addEventListener('click', function () { openFilePicker(FILE_ACCEPT); });
        el('ai-image') && el('ai-image').addEventListener('click', function () { openFilePicker(IMAGE_ACCEPT); });
        el('ai-emoji') && el('ai-emoji').addEventListener('click', insertComposerEmoji);
        el('ai-file') && el('ai-file').addEventListener('change', onFileChosen);
        el('ai-attachment-preview') && el('ai-attachment-preview').addEventListener('click', function (event) {
            if (event.target.closest('[data-remove-attachment]')) clearPendingFile();
        });
        el('ai-messages') && el('ai-messages').addEventListener('click', onMessageClick);
        window.addEventListener('beforeunload', cleanupChannels);
    }

    function openFilePicker(accept) {
        const input = el('ai-file');
        if (!input) return;
        input.accept = accept;
        input.value = '';
        input.click();
    }

    function insertComposerEmoji() {
        const input = el('ai-input');
        if (!input || input.disabled) return;
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        input.value = input.value.slice(0, start) + '🙂' + input.value.slice(end);
        input.focus();
        input.setSelectionRange(start + 2, start + 2);
        syncSendState();
    }

    async function reloadRows(options) {
        const preserveSelection = !options || options.preserveSelection !== false;
        const active = preserveSelection ? state.activeKey : null;
        const results = await Promise.allSettled([
            D.Inbox && D.Inbox.listThreads ? D.Inbox.listThreads() : Promise.resolve([]),
            D.Chat && D.Chat.listThreadsForArtist ? D.Chat.listThreadsForArtist(state.userId) : Promise.resolve([]),
            D.SupportInbox && D.SupportInbox.getOwnConversation ? D.SupportInbox.getOwnConversation(state.userId) : Promise.resolve(null),
        ]);

        state.unified = resultValue(results[0], []);
        state.legacyQuotes = resultValue(results[1], []);
        state.legacySupport = resultValue(results[2], null);
        state.rows = buildRows();
        renderSidebarCounts();
        renderUnreadBadge();
        renderList();

        if (active && state.rows.some(function (row) { return row.key === active; })) {
            state.activeKey = active;
        } else if (active) {
            closeThread();
        }
    }

    function buildRows() {
        const unifiedRows = state.unified.map(adaptUnified);
        const domainKeys = new Set(unifiedRows.map(function (row) {
            return row.contextType && row.contextId ? row.contextType + ':' + row.contextId : '';
        }).filter(Boolean));

        const quoteRows = state.legacyQuotes
            .filter(function (item) {
                return !domainKeys.has('quotation:' + item.quote_id) &&
                    !domainKeys.has('quote:' + item.quote_id);
            })
            .map(adaptLegacyQuote);

        const hasUnifiedSupport = unifiedRows.some(function (row) { return row.category === 'support'; });
        const supportRows = !hasUnifiedSupport && state.legacySupport
            ? [adaptLegacySupport(state.legacySupport)]
            : [];

        return unifiedRows.concat(quoteRows, supportRows).sort(function (a, b) {
            return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });
    }

    function adaptUnified(item) {
        return {
            key: 'unified:' + item.id,
            source: 'unified',
            id: item.id,
            category: item.category,
            name: item.counterparty_name || 'Conversación',
            initials: item.counterparty_initials || initials(item.counterparty_name),
            subject: item.subject || '',
            preview: item.last_message || item.subject || 'Conversación iniciada',
            lastAt: item.last_message_at,
            lastSenderUserId: item.last_sender_user_id,
            unread: Number(item.unread_count) || 0,
            favorite: Boolean(item.is_favorite),
            archived: Boolean(item.is_archived),
            closed: item.status === 'closed',
            priority: Boolean(item.is_priority),
            context: item.context || {},
            contextType: item.context_type,
            contextId: item.context_id,
            raw: item,
        };
    }

    function adaptLegacyQuote(item) {
        const quote = item.quote || {};
        const name = item.client_full_name || item.client_name || quote.client_full_name || quote.client_name || 'Cliente';
        return {
            key: 'quote:' + item.quote_id,
            source: 'quote',
            id: item.quote_id,
            category: 'quotations',
            name: name,
            initials: initials(name),
            subject: quote.tattoo_style || item.tattoo_style || 'Cotización',
            preview: item.last_message || 'Cotización en curso',
            lastAt: item.last_message_at || quote.updated_at,
            lastSenderUserId: item.last_message_sender === 'artist' ? state.userId : null,
            unread: Number(item.unread_for_artist) || 0,
            favorite: false,
            archived: false,
            closed: CLOSED_QUOTE_STATUSES.includes(quote.status || item.quote_status || item.quotation_status),
            priority: false,
            context: {
                budget: fmtMoney(quote.budget || item.budget, quote.currency || item.currency),
                style: quote.tattoo_style || item.tattoo_style,
                body_part: quote.tattoo_body_part || item.tattoo_body_part,
                quote_status: quote.status || item.quote_status || item.quotation_status,
            },
            raw: item,
        };
    }

    function adaptLegacySupport(item) {
        return {
            key: 'support:' + item.id,
            source: 'support',
            id: item.id,
            category: 'support',
            name: 'Soporte We Ötzi',
            initials: 'WÖ',
            subject: item.subject || 'Ayuda con tu cuenta',
            preview: item.last_message || 'Conversación con soporte',
            lastAt: item.last_message_at || item.updated_at,
            lastSenderUserId: null,
            unread: 0,
            favorite: false,
            archived: false,
            closed: item.status === 'closed',
            priority: false,
            context: { channel: 'support', status: item.status },
            raw: item,
        };
    }

    function resultValue(result, fallback) {
        if (result && result.status === 'fulfilled') return result.value;
        if (result && result.reason) console.warn('[artist-inbox] fuente no disponible', result.reason);
        return fallback;
    }

    function visibleRows() {
        return state.rows.filter(function (row) {
            if (state.filter === 'archived') {
                if (!row.archived) return false;
            } else if (state.filter === 'favorites') {
                if (!row.favorite) return false;
            } else {
                if (row.archived) return false;
                if (state.filter !== 'all' && row.category !== state.filter) return false;
            }

            if (!state.search) return true;
            return [row.name, row.subject, row.preview, row.category]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase('es')
                .includes(state.search);
        });
    }

    function renderSidebarCounts() {
        const activeRows = state.rows.filter(function (row) { return !row.archived; });
        const counts = {};
        Object.keys(CATEGORY_META).forEach(function (category) {
            counts[category] = activeRows.filter(function (row) { return row.category === category; }).length;
        });
        setText('ai-count-all', activeRows.length);
        setText('ai-count-clients', counts.clients || 0);
        setText('ai-count-quotations', counts.quotations || 0);
        setText('ai-count-support', counts.support || 0);
        setText('ai-count-invitations', counts.invitations || 0);
        setText('ai-count-spots', counts.spots || 0);
        setText('ai-count-job-board', counts.job_board || 0);
        setText('ai-count-studios', counts.studios || 0);
        setText('ai-count-trips', counts.trips || 0);
        setText('ai-count-archived', state.rows.filter(function (row) { return row.archived; }).length);
        setText('ai-count-favorites', state.rows.filter(function (row) { return row.favorite; }).length);

        setText('ai-sum-unread', activeRows.filter(function (row) { return row.unread > 0; }).length);
        setText('ai-sum-replied', activeRows.filter(function (row) {
            return row.lastSenderUserId && row.lastSenderUserId === state.userId;
        }).length);
        setText('ai-sum-waiting', activeRows.filter(function (row) {
            return !row.closed && (!row.lastSenderUserId || row.lastSenderUserId !== state.userId);
        }).length);
    }

    function renderUnreadBadge() {
        const unread = state.rows.reduce(function (sum, row) {
            return sum + (row.archived ? 0 : row.unread);
        }, 0);
        const badge = el('ai-nav-unread');
        if (!badge) return;
        badge.hidden = unread === 0;
        badge.textContent = unread > 99 ? '99+' : String(unread);
    }

    function renderList() {
        const list = visibleRows();
        setText('ai-list-cap', (CATEGORY_LABELS[state.filter] || 'TODAS') + ' · ' + list.length);
        const host = el('ai-list');
        if (!list.length) {
            host.innerHTML = '<div class="wo-empty ai-list-empty">' +
                '<i data-wo-icon="message-circle" aria-hidden="true"></i>' +
                '<span class="wo-empty-title">No hay conversaciones</span>' +
                '<p>Probá con otra categoría o búsqueda.</p></div>';
            refreshIcons();
            return;
        }
        host.innerHTML = list.map(rowHtml).join('');
        refreshIcons();
    }

    function rowHtml(row) {
        const meta = CATEGORY_META[row.category] || { label: row.category || 'Mensaje', tone: 'default' };
        const status = row.closed
            ? { label: 'Cerrado', cls: 'is-closed' }
            : row.lastSenderUserId === state.userId
                ? { label: 'Respondida', cls: 'is-replied' }
                : { label: 'Esperando', cls: 'is-waiting' };
        const active = row.key === state.activeKey ? ' is-active' : '';
        const unread = row.unread > 0 ? ' is-unread' : '';
        const org = ['support', 'invitations', 'spots', 'job_board', 'studios', 'trips'].includes(row.category)
            ? ' ai-avatar--org'
            : '';
        const favoriteButton = row.source === 'unified'
            ? '<button type="button" class="ai-row-star' + (row.favorite ? ' is-active' : '') + '" data-row-flag="favorite" data-key="' + esc(row.key) + '" aria-label="' + (row.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '"><i data-wo-icon="star" class="wo-icon-16" aria-hidden="true"></i></button>'
            : '';
        return '<article class="ai-row' + active + unread + '" data-row-key="' + esc(row.key) + '">' +
            '<button type="button" class="ai-row-open" data-open-thread="' + esc(row.key) + '" aria-label="Abrir conversación con ' + esc(row.name) + '">' +
                '<span class="ai-avatar' + org + '">' + esc(row.initials) + '</span>' +
                '<span class="ai-row-body">' +
                    '<span class="ai-row-top"><span class="ai-row-name">' + esc(row.name) + '</span><time class="ai-row-time">' + esc(fmtListTime(row.lastAt)) + '</time></span>' +
                    '<span class="ai-row-tags"><span class="wo-tag ai-category-tag is-' + esc(meta.tone) + '">' + esc(meta.label) + '</span>' +
                        (row.priority ? '<span class="wo-tag wo-tag--warning">Prioridad</span>' : '') +
                        '<span class="ai-row-status ' + status.cls + '">' + status.label + '</span></span>' +
                    '<span class="ai-row-prev"><span class="ai-row-preview">' + esc(row.preview) + '</span>' +
                        (row.unread ? '<span class="wo-badge ai-row-unread">' + row.unread + '</span>' : '') + '</span>' +
                '</span>' +
            '</button>' + favoriteButton +
        '</article>';
    }

    async function onListClick(event) {
        const flag = event.target.closest('[data-row-flag]');
        if (flag) {
            event.stopPropagation();
            await toggleFlag(flag.dataset.key, flag.dataset.rowFlag);
            return;
        }
        const opener = event.target.closest('[data-open-thread]');
        if (opener) await openThread(opener.dataset.openThread);
    }

    async function toggleFlag(key, flag) {
        const row = findRow(key);
        if (!row || row.source !== 'unified') return;
        const favorite = flag === 'favorite' ? !row.favorite : null;
        const archived = flag === 'archived' ? !row.archived : null;
        try {
            await D.Inbox.setFlags(row.id, { favorite: favorite, archived: archived });
            if (favorite !== null) row.raw.is_favorite = favorite;
            if (archived !== null) row.raw.is_archived = archived;
            state.rows = buildRows();
            renderSidebarCounts();
            renderList();
            if (archived === true) closeThread();
            else if (state.activeKey === key) renderThreadHead(row);
        } catch (error) {
            console.error('[artist-inbox] flags', error);
            notify('No pudimos actualizar la conversación.', 'error');
        }
    }

    async function openThread(key) {
        const row = findRow(key);
        if (!row) return;
        state.activeKey = key;
        state.activeMessages = [];
        clearPendingFile();
        removeThreadChannel();

        el('ai-thread-placeholder').hidden = true;
        el('ai-thread').hidden = false;
        el('ai-support-empty').hidden = true;
        el('ai-messages').hidden = false;
        el('ai-shell').classList.add('is-thread-open');
        renderList();
        renderThreadHead(row);
        renderContext(row);
        renderMessagesLoading();
        setComposer(row.closed ? 'Esta conversación está cerrada.' : 'Escribí un mensaje…', !row.closed);

        try {
            if (row.source === 'unified') {
                const messages = await D.Inbox.listMessages(row.id);
                if (state.activeKey !== key) return;
                state.activeMessages = messages.map(adaptUnifiedMessage);
                await D.Inbox.markRead(row.id).catch(function () {});
                row.raw.unread_count = 0;
                row.unread = 0;
                state.threadChannel = D.Inbox.subscribeThread(row.id, function (payload) {
                    const message = payload && payload.new;
                    if (!message || state.activeKey !== key) return;
                    if (!state.activeMessages.some(function (item) { return item.id === message.id; })) {
                        state.activeMessages.push(adaptUnifiedMessage(message));
                        renderMessages();
                    }
                    D.Inbox.markRead(row.id).catch(function () {});
                    scheduleRefresh();
                });
            } else if (row.source === 'quote') {
                const messages = await D.Chat.listByQuote(row.id);
                if (state.activeKey !== key) return;
                state.activeMessages = messages.map(adaptQuoteMessage);
                await D.Chat.markRead(row.id, 'client').catch(function () {});
                row.raw.unread_for_artist = 0;
                row.unread = 0;
                if (D.Realtime && D.Realtime.subscribeChatMessages) {
                    state.threadChannel = D.Realtime.subscribeChatMessages('artist-inbox-quote-' + row.id, row.id, function (payload) {
                        const message = payload && payload.new;
                        if (!message || state.activeKey !== key) return;
                        if (!state.activeMessages.some(function (item) { return item.id === message.id; })) {
                            state.activeMessages.push(adaptQuoteMessage(message));
                            renderMessages();
                        }
                        if (message.sender_type === 'client') D.Chat.markRead(row.id, 'client').catch(function () {});
                    });
                }
            } else {
                const messages = await D.SupportInbox.listMessages(row.id);
                if (state.activeKey !== key) return;
                state.legacySupportMessages = messages;
                state.activeMessages = messages.map(adaptSupportMessage);
            }

            renderMessages();
            renderSidebarCounts();
            renderUnreadBadge();
            renderList();
        } catch (error) {
            console.error('[artist-inbox] abrir hilo', error);
            renderMessagesError();
        }
    }

    function closeThread() {
        state.activeKey = null;
        state.activeMessages = [];
        removeThreadChannel();
        clearPendingFile();
        el('ai-thread').hidden = true;
        el('ai-thread-placeholder').hidden = false;
        el('ai-context').hidden = true;
        el('ai-shell').classList.remove('is-thread-open');
        renderList();
    }

    function closeMobileThread() {
        el('ai-shell').classList.remove('is-thread-open');
    }

    function renderThreadHead(row) {
        const meta = CATEGORY_META[row.category] || { label: row.category || 'Mensaje' };
        const persistentTools = row.source === 'unified'
            ? '<div class="ai-thread-tools">' +
                '<button type="button" class="wo-iconbtn' + (row.favorite ? ' is-active' : '') + '" data-head-flag="favorite" aria-label="' + (row.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '" title="Favorita"><i data-wo-icon="star" class="wo-icon-18" aria-hidden="true"></i></button>' +
                '<button type="button" class="wo-iconbtn" data-head-flag="archived" aria-label="' + (row.archived ? 'Restaurar conversación' : 'Archivar conversación') + '" title="' + (row.archived ? 'Restaurar' : 'Archivar') + '"><i data-wo-icon="archive" class="wo-icon-18" aria-hidden="true"></i></button>' +
            '</div>'
            : '';
        el('ai-thread-head').innerHTML =
            '<button type="button" class="wo-iconbtn ai-back" data-thread-back aria-label="Volver a conversaciones"><i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i></button>' +
            '<span class="ai-avatar ai-head-avatar">' + esc(row.initials) + '</span>' +
            '<div class="ai-head-copy"><strong>' + esc(row.name) + '</strong><span>' + esc(meta.label) + (row.subject ? ' · ' + esc(row.subject) : '') + '</span></div>' +
            persistentTools;
        refreshIcons();
    }

    async function onThreadHeadClick(event) {
        if (event.target.closest('[data-thread-back]')) {
            closeMobileThread();
            return;
        }
        const flag = event.target.closest('[data-head-flag]');
        if (flag) await toggleFlag(state.activeKey, flag.dataset.headFlag);
    }

    function renderMessagesLoading() {
        el('ai-messages').innerHTML = '<div class="ai-msg-loading"><span class="wo-spinner" aria-hidden="true"></span><span class="wo-meta-s">Cargando mensajes</span></div>';
    }

    function renderMessagesError() {
        el('ai-messages').innerHTML = '<div class="wo-empty"><span class="wo-empty-title">No pudimos cargar los mensajes</span><p>Volvé a abrir esta conversación para reintentar.</p></div>';
    }

    function adaptUnifiedMessage(message) {
        return {
            id: message.id,
            mine: message.sender_user_id === state.userId || message.sender_role === 'artist',
            body: message.body || '',
            at: message.created_at,
            kind: message.message_kind || 'text',
            attachmentPath: message.attachment_path,
            attachmentName: message.attachment_name,
            attachmentMime: message.attachment_mime,
        };
    }

    function adaptQuoteMessage(message) {
        return {
            id: message.id || String(message.created_at) + ':' + message.message,
            mine: message.sender_type === 'artist',
            body: message.message || '',
            at: message.created_at,
            kind: 'text',
        };
    }

    function adaptSupportMessage(message) {
        return {
            id: message.id || String(message.created_at) + ':' + message.content,
            mine: message.role === 'user',
            body: message.content || '',
            at: message.created_at,
            kind: 'text',
        };
    }

    function renderMessages() {
        const host = el('ai-messages');
        if (!state.activeMessages.length) {
            host.innerHTML = '<div class="wo-empty ai-msg-empty"><i data-wo-icon="message-circle" aria-hidden="true"></i><span class="wo-empty-title">Empezá la conversación</span><p>Escribí un mensaje para continuar.</p></div>';
            refreshIcons();
            return;
        }
        let lastDay = '';
        host.innerHTML = state.activeMessages.map(function (message) {
            const day = fmtDayKey(message.at);
            const separator = day !== lastDay
                ? '<div class="ai-day"><span>' + esc(fmtDayLabel(message.at)) + '</span></div>'
                : '';
            lastDay = day;
            return separator + messageHtml(message);
        }).join('');
        host.scrollTop = host.scrollHeight;
        refreshIcons();
    }

    function messageHtml(message) {
        const direction = message.mine ? ' ai-msg--out' : ' ai-msg--in';
        const attachment = message.attachmentPath
            ? '<button type="button" class="ai-msg-attachment" data-attachment-path="' + esc(message.attachmentPath) + '">' +
                '<i data-wo-icon="' + (String(message.attachmentMime || '').startsWith('image/') ? 'image' : 'paperclip') + '" class="wo-icon-18" aria-hidden="true"></i>' +
                '<span>' + esc(message.attachmentName || 'Abrir adjunto') + '</span>' +
                '<i data-wo-icon="external-link" class="wo-icon-16" aria-hidden="true"></i></button>'
            : '';
        return '<div class="ai-msg' + direction + '"><div class="ai-bubble">' +
            (message.body ? '<p>' + nl2br(message.body) + '</p>' : '') + attachment +
            '<time>' + esc(fmtMsgTime(message.at)) + '</time></div></div>';
    }

    async function onMessageClick(event) {
        const attachment = event.target.closest('[data-attachment-path]');
        if (!attachment || !D.Inbox || !D.Inbox.signedAttachmentUrl) return;
        try {
            const url = await D.Inbox.signedAttachmentUrl(attachment.dataset.attachmentPath);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            console.error('[artist-inbox] adjunto', error);
            notify('No pudimos abrir el archivo.', 'error');
        }
    }

    function renderContext(row) {
        const context = row.context || {};
        const meta = CATEGORY_META[row.category] || { label: 'Conversación' };
        const blocks = [];
        blocks.push(ctxBlock('Contacto', row.name));
        if (row.subject) blocks.push(ctxBlock('Asunto', row.subject));
        if (context.client) blocks.push(ctxBlock('Cliente', context.client));
        if (context.studio || context.studio_name) blocks.push(ctxBlock('Estudio', context.studio || context.studio_name));
        if (context.city || context.country) blocks.push(ctxBlock('Destino', [context.city, context.country].filter(Boolean).join(', ')));
        if (context.dates) blocks.push(ctxBlock('Fechas', context.dates, true));
        if (context.start_date || context.end_date) {
            blocks.push(ctxBlock('Fechas', formatDateRange(context.start_date, context.end_date), true));
        }
        if (context.appointment) blocks.push(ctxBlock('Turno', context.appointment));
        if (context.budget) blocks.push(ctxBlock('Presupuesto', context.budget, true));
        if (context.style) blocks.push(ctxBlock('Estilo', context.style));
        if (context.body_part) blocks.push(ctxBlock('Zona', context.body_part));
        if (context.request_code) blocks.push(ctxBlock('Solicitud', context.request_code, true));

        const domainStatus = context.application_status || context.invitation_status || context.membership_status || context.link_status || context.quote_status;
        if (domainStatus) blocks.push(ctxBlock('Estado', humanStatus(domainStatus)));
        blocks.push(ctxBlock('Conversación', row.closed ? 'Cerrada' : 'Activa'));

        const link = contextLink(row);
        const host = el('ai-context');
        host.hidden = false;
        host.innerHTML = '<p class="wo-eyebrow ai-ctx-eyebrow">' + esc(meta.label.toUpperCase()) + '</p>' +
            blocks.join('') + (link ? '<a class="wo-btn wo-btn--ghost wo-btn--s ai-ctx-link" href="' + esc(link.href) + '">' + esc(link.label) + '<i data-wo-icon="arrow-right" class="wo-icon-16" aria-hidden="true"></i></a>' : '');
        refreshIcons();
    }

    function ctxBlock(label, value, mono) {
        if (value === null || value === undefined || value === '') return '';
        return '<div class="ai-ctx-block"><span class="ai-ctx-label">' + esc(label) + '</span><span class="ai-ctx-value' + (mono ? ' wo-mono-num' : '') + '">' + esc(value) + '</span></div>';
    }

    function contextLink(row) {
        const id = row.contextId || row.id;
        const links = {
            quotations: { href: '/my-quotations?quote=' + encodeURIComponent(id), label: 'Ver cotización' },
            invitations: { href: '/artist/invitations', label: 'Ver invitaciones' },
            spots: { href: '/studio-spots', label: 'Ver Spot' },
            job_board: { href: '/job-board', label: 'Ver Job Board' },
            studios: { href: '/artist/studios', label: 'Ver estudio' },
            trips: { href: '/artist/travel?trip=' + encodeURIComponent(id), label: 'Ver viaje' },
        };
        return links[row.category] || null;
    }

    function setComposer(placeholder, enabled) {
        const input = el('ai-input');
        const attach = el('ai-attach');
        input.disabled = !enabled;
        attach.disabled = !enabled;
        input.placeholder = placeholder;
        syncSendState();
    }

    function onFileChosen(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const row = findRow(state.activeKey);
        if (!row || row.source !== 'unified') {
            event.target.value = '';
            notify('Los adjuntos están disponibles en las conversaciones unificadas.', 'info');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            event.target.value = '';
            notify('El archivo supera el límite de 15 MB.', 'error');
            return;
        }
        state.pendingFile = file;
        renderPendingFile();
        syncSendState();
    }

    function renderPendingFile() {
        const host = el('ai-attachment-preview');
        if (!state.pendingFile) {
            host.hidden = true;
            host.innerHTML = '';
            return;
        }
        host.hidden = false;
        host.innerHTML = '<span><i data-wo-icon="' + (String(state.pendingFile.type).startsWith('image/') ? 'image' : 'paperclip') + '" class="wo-icon-16" aria-hidden="true"></i>' + esc(state.pendingFile.name) + '</span>' +
            '<button type="button" class="wo-iconbtn" data-remove-attachment aria-label="Quitar adjunto"><i data-wo-icon="x" class="wo-icon-16" aria-hidden="true"></i></button>';
        refreshIcons();
    }

    function clearPendingFile() {
        state.pendingFile = null;
        if (el('ai-file')) el('ai-file').value = '';
        if (el('ai-attachment-preview')) renderPendingFile();
        syncSendState();
    }

    function syncSendState() {
        const row = findRow(state.activeKey);
        const enabled = Boolean(row && !row.closed && (el('ai-input').value.trim() || state.pendingFile));
        el('ai-send').disabled = !enabled;
    }

    async function onComposerSubmit(event) {
        event.preventDefault();
        const row = findRow(state.activeKey);
        if (!row || row.closed) return;
        const input = el('ai-input');
        const body = input.value.trim();
        const file = state.pendingFile;
        if (!body && !file) return;
        input.disabled = true;
        el('ai-send').disabled = true;
        el('ai-attach').disabled = true;

        try {
            if (row.source === 'unified') {
                let attachment = null;
                if (file) attachment = await D.Inbox.uploadAttachment(row.id, state.userId, file);
                const saved = await D.Inbox.sendMessage({ threadId: row.id, body: body, attachment: attachment });
                const message = Array.isArray(saved) ? saved[0] : saved;
                if (message && !state.activeMessages.some(function (item) { return item.id === message.id; })) {
                    state.activeMessages.push(adaptUnifiedMessage(message));
                }
            } else if (row.source === 'quote') {
                await D.Chat.sendMessage({ quoteId: row.id, senderType: 'artist', senderId: state.userId, message: body });
                state.activeMessages.push(adaptQuoteMessage({
                    id: 'local-' + Date.now(), sender_type: 'artist', message: body, created_at: new Date().toISOString(),
                }));
            } else {
                const response = await D.SupportInbox.sendMessage({ conversationId: row.id, content: body });
                state.activeMessages.push(adaptSupportMessage({
                    id: 'local-' + Date.now(), role: 'user', content: body, created_at: new Date().toISOString(),
                }));
                if (response && response.response) {
                    state.activeMessages.push(adaptSupportMessage({
                        id: 'support-' + Date.now(), role: 'assistant', content: response.response, created_at: new Date().toISOString(),
                    }));
                }
            }
            input.value = '';
            clearPendingFile();
            renderMessages();
            scheduleRefresh();
        } catch (error) {
            console.error('[artist-inbox] enviar', error);
            notify('No pudimos enviar el mensaje. Tu texto sigue acá para reintentar.', 'error');
        } finally {
            input.disabled = row.closed;
            el('ai-attach').disabled = row.closed;
            syncSendState();
            input.focus();
        }
    }

    function subscribeList() {
        if (!D.Inbox || !D.Inbox.subscribeList) return;
        state.listChannel = D.Inbox.subscribeList(state.userId, scheduleRefresh);
    }

    function scheduleRefresh() {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(function () {
            reloadRows({ preserveSelection: true }).catch(function (error) {
                console.warn('[artist-inbox] actualización realtime', error);
            });
        }, 180);
    }

    function removeThreadChannel() {
        if (!state.threadChannel) return;
        if (D.Inbox && D.Inbox.removeChannel) D.Inbox.removeChannel(state.threadChannel);
        else if (D.removeChannel) D.removeChannel(state.threadChannel);
        state.threadChannel = null;
    }

    function cleanupChannels() {
        window.clearTimeout(state.refreshTimer);
        removeThreadChannel();
        if (state.listChannel) {
            if (D.Inbox && D.Inbox.removeChannel) D.Inbox.removeChannel(state.listChannel);
            else if (D.removeChannel) D.removeChannel(state.listChannel);
            state.listChannel = null;
        }
    }

    function openFromQuery() {
        const wanted = new URLSearchParams(window.location.search).get('thread');
        if (!wanted) return;
        const row = state.rows.find(function (item) {
            return item.id === wanted || item.key === wanted || item.contextId === wanted;
        });
        if (row) openThread(row.key);
    }

    function renderFatal(message) {
        const host = el('ai-list');
        if (!host) return;
        host.innerHTML = '<div class="wo-empty ai-list-empty"><i data-wo-icon="alert-circle" aria-hidden="true"></i><span class="wo-empty-title">Inbox no disponible</span><p>' + esc(message) + '</p><button class="wo-btn wo-btn--s" type="button" onclick="window.location.reload()">Reintentar</button></div>';
        refreshIcons();
    }

    function notify(message, tone) {
        let toast = document.querySelector('.ai-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'ai-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.className = 'ai-toast is-' + (tone || 'info');
        toast.textContent = message;
        toast.hidden = false;
        window.clearTimeout(toast._hideTimer);
        toast._hideTimer = window.setTimeout(function () { toast.hidden = true; }, 3600);
    }

    function findRow(key) {
        return state.rows.find(function (row) { return row.key === key; }) || null;
    }

    function el(id) { return document.getElementById(id); }

    function setText(id, value) {
        const node = el(id);
        if (node) node.textContent = String(value);
    }

    function refreshIcons() {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            window.WoIcons.hydrate(document);
        }
    }

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function nl2br(value) {
        return esc(value).replace(/\r?\n/g, '<br>');
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '—';
        return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    function fmtListTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'AYER';
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
    }

    function fmtMsgTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function fmtDayKey(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }

    function fmtDayLabel(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return 'HOY';
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'AYER';
        return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }).toUpperCase();
    }

    function formatDateRange(start, end) {
        const format = function (value) {
            if (!value) return '';
            const date = new Date(value + (String(value).length === 10 ? 'T12:00:00' : ''));
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
        };
        return [format(start), format(end)].filter(Boolean).join(' — ');
    }

    function humanStatus(value) {
        const labels = {
            accepted: 'Aceptada', shortlisted: 'Preseleccionada', pending: 'Pendiente',
            pending_acceptance: 'Esperando tu respuesta', completed: 'Completada',
            client_rejected: 'Rechazada', expired: 'Vencida', open: 'Activa', closed: 'Cerrada',
            esperando_confirmacion: 'Esperando confirmación', confirmada: 'Confirmada',
            rechazada: 'Rechazada', cancelada: 'Cancelada', active: 'Activa',
        };
        return labels[value] || String(value).replace(/_/g, ' ');
    }

    function fmtMoney(amount, currency) {
        if (amount === null || amount === undefined || amount === '') return '';
        const number = Number(amount);
        if (Number.isNaN(number)) return String(amount);
        return '$' + number.toLocaleString('es-AR') + (currency ? ' ' + currency : '');
    }
})();
