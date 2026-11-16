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
    // Lógica pura compartida (inbox-chat-model.js): adjuntos, dedupe,
    // tarjeta de cotización, hilos sintéticos y categoría por estado.
    const M = window.WeotziInboxChat || null;
    // Ronda 2 (inbox-extras-model.js): voz, mensajes rápidos, automáticos y
    // motivo de la conversación cerrada.
    const X = window.WeotziInboxExtras || null;
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
    const MAX_VISIBLE_ATTACHMENTS = 5;
    const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
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
        pendingFiles: [],
        attachmentDrag: null,
        listChannel: null,
        chatChannel: null,
        threadChannel: null,
        refreshTimer: null,
        // Cotizaciones abiertas por deep link (?quote=) que todavía no tienen
        // mensajes: la vista chat_threads no las devuelve (INB-06).
        syntheticQuotes: [],
        // Datos de quotations_db por quote_id (tarjeta y referencias del hilo).
        quoteDetails: {},
        attachmentUrls: new Map(),
        sending: false,
        // Ronda 2: último automático por hilo (para no contarlo como respuesta
        // del artista) y controles de voz / mensajes rápidos del composer.
        autoTails: { inbox: null, chat: null },
        voice: null,
        quick: null,
        quoteChannel: null,
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
                // Conserva ?quote= / ?thread= (CTA del correo) para volver al hilo.
                window.location.replace('/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search));
                return;
            }
            state.userId = session.user.id;
            await reloadRows({ preserveSelection: false });
            subscribeList();
            openFromQuery();
        } catch (error) {
            console.error('[artist-inbox] init', error);
            renderFatal('No pudimos cargar tu inbox. Reintenta en unos segundos.');
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
        el('ai-context') && el('ai-context').addEventListener('click', function (event) {
            if (event.target.closest('[data-context-close]')) setContextSheet(false);
        });
        el('ai-context-scrim') && el('ai-context-scrim').addEventListener('click', function () { setContextSheet(false); });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && el('ai-shell') && el('ai-shell').classList.contains('is-context-open')) {
                setContextSheet(false);
            }
        });
        el('ai-support-cta') && el('ai-support-cta').addEventListener('click', function () { startSupportConversation(''); });
        el('ai-composer') && el('ai-composer').addEventListener('submit', onComposerSubmit);
        el('ai-input') && el('ai-input').addEventListener('input', syncSendState);
        el('ai-attach') && el('ai-attach').addEventListener('click', function () { openFilePicker(FILE_ACCEPT); });
        el('ai-image') && el('ai-image').addEventListener('click', function () { openFilePicker(IMAGE_ACCEPT); });
        el('ai-emoji') && el('ai-emoji').addEventListener('click', insertComposerEmoji);
        el('ai-file') && el('ai-file').addEventListener('change', onFileChosen);
        const attachmentPreview = el('ai-attachment-preview');
        attachmentPreview && attachmentPreview.addEventListener('click', onAttachmentPreviewClick);
        attachmentPreview && attachmentPreview.addEventListener('pointerdown', onAttachmentDragStart);
        attachmentPreview && attachmentPreview.addEventListener('pointermove', onAttachmentDragMove);
        attachmentPreview && attachmentPreview.addEventListener('pointerup', onAttachmentDragEnd);
        attachmentPreview && attachmentPreview.addEventListener('pointercancel', onAttachmentDragEnd);
        el('ai-messages') && el('ai-messages').addEventListener('click', onMessageClick);
        wireExtras();
        // Ronda 2: al volver a la pestaña se refresca la lista (estados de
        // cotización y cierres que no llegan por realtime).
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && state.userId) scheduleRefresh();
        });
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
            // Ronda 2: automáticos recientes (un saludo o una ausencia automática
            // no cuentan como "Respondido").
            D.Inbox && D.Inbox.listRecentAuto ? D.Inbox.listRecentAuto() : Promise.resolve([]),
            D.Chat && D.Chat.listRecentAuto ? D.Chat.listRecentAuto() : Promise.resolve([]),
        ]);

        state.unified = resultValue(results[0], []);
        state.legacyQuotes = resultValue(results[1], []);
        state.legacySupport = resultValue(results[2], null);
        state.autoTails = X ? {
            inbox: X.autoTailIndex(resultValue(results[3], []), 'thread_id'),
            chat: X.autoTailIndex(resultValue(results[4], []), 'quotation_id'),
        } : { inbox: null, chat: null };
        state.rows = buildRows();
        renderSidebarCounts();
        renderList();

        if (active && state.rows.some(function (row) { return row.key === active; })) {
            state.activeKey = active;
            // El hilo abierto pudo cerrarse mientras se miraba (p. ej. el
            // cliente rechazó la cotización): pasa a solo lectura.
            const activeRow = findRow(active);
            if (activeRow && !state.sending && Boolean(activeRow.closed) !== el('ai-composer').hidden) {
                if (activeRow.closed) resetThreadExtras();
                applyThreadAccess(activeRow);
            }
        } else if (active) {
            closeThread();
        }
    }

    function buildRows() {
        const unifiedRows = state.unified.map(adaptUnified);
        const domainKeys = new Set(unifiedRows.map(function (row) {
            return row.contextType && row.contextId ? row.contextType + ':' + row.contextId : '';
        }).filter(Boolean));

        const realQuoteIds = new Set(state.legacyQuotes.map(function (item) { return item.quote_id; }));
        // Un hilo sintético deja de hacer falta cuando la vista ya trae el real.
        state.syntheticQuotes = state.syntheticQuotes.filter(function (item) { return !realQuoteIds.has(item.quote_id); });
        const quoteRows = state.legacyQuotes.concat(state.syntheticQuotes)
            .filter(function (item) {
                return !domainKeys.has('quotation:' + item.quote_id) &&
                    !domainKeys.has('quote:' + item.quote_id);
            })
            .map(adaptLegacyQuote);

        const hasUnifiedSupport = unifiedRows.some(function (row) { return row.category === 'support'; });
        const supportRows = !hasUnifiedSupport && state.legacySupport
            ? [adaptLegacySupport(state.legacySupport)]
            : [];
        // INB-11: sin conversación de soporte (o con la última cerrada) igual
        // hay una fila para escribir; la conversación se crea al primer envío.
        const needsStarter = M ? M.needsSupportStarter(unifiedRows, state.legacySupport)
            : (!hasUnifiedSupport && (!state.legacySupport || state.legacySupport.status === 'closed'));
        if (needsStarter) supportRows.push(supportStarterRow());

        const rows = unifiedRows.concat(quoteRows, supportRows);
        // El hilo abierto ya se marcó leído: que un refresco realtime que llegó
        // antes del markRead no vuelva a pintar el contador.
        rows.forEach(function (row) { if (row.key === state.activeKey) row.unread = 0; });
        return rows.sort(function (a, b) {
            if (a.starter !== b.starter) return a.starter ? 1 : -1;
            return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });
    }

    function supportStarterRow() {
        return {
            key: 'support:new',
            source: 'support',
            id: null,
            starter: true,
            category: 'support',
            name: 'Soporte We Ötzi',
            initials: 'WÖ',
            subject: 'Ayuda con tu cuenta',
            preview: 'Escríbenos si necesitas ayuda',
            lastAt: null,
            lastSenderUserId: null,
            unread: 0,
            favorite: false,
            archived: false,
            closed: false,
            priority: false,
            context: { channel: 'support' },
            raw: {},
        };
    }

    function adaptUnified(item) {
        // Ronda 2: si lo último del hilo fue un automático, el artista todavía
        // no respondió; y un hilo de cotización rechazada queda en solo lectura.
        const auto = Boolean(X && X.isAutoTail(state.autoTails.inbox, item.id, item.last_message_at));
        const rejected = String((item.context && item.context.quote_status) || '').toLowerCase() === 'client_rejected';
        return Object.assign({
            key: 'unified:' + item.id,
            source: 'unified',
            id: item.id,
            category: item.category,
            name: item.counterparty_name || 'Conversación',
            initials: cleanInitials(item.counterparty_initials) || initials(item.counterparty_name),
            subject: item.subject || '',
            preview: item.last_message || item.subject || 'Conversación iniciada',
            lastAt: item.last_message_at,
            lastSenderUserId: item.last_sender_user_id,
            // Sin remitente = mensaje de sistema del dominio (ensure_domain_inbox_thread).
            lastSenderRole: item.last_sender_user_id ? 'user' : (item.last_message ? 'system' : null),
            unread: Number(item.unread_count) || 0,
            favorite: Boolean(item.is_favorite),
            archived: Boolean(item.is_archived),
            closed: item.status === 'closed' || rejected,
            priority: Boolean(item.is_priority),
            context: item.context || {},
            contextType: item.context_type,
            contextId: item.context_id,
            raw: item,
            lastAuto: auto,
            closedReason: rejected && X ? X.closedReason('client_rejected') : '',
        }, auto ? { lastSenderUserId: null, lastSenderRole: 'auto' } : null);
    }

    function adaptLegacyQuote(item) {
        const quote = item.quote || {};
        const name = item.client_full_name || item.client_name || quote.client_full_name || quote.client_name || 'Cliente';
        const status = quote.status || item.quote_status || item.quotation_status;
        const style = styleLabel(quote.tattoo_style || item.tattoo_style);
        // Ronda 2: un automático como último mensaje no es una respuesta del artista.
        const auto = Boolean(X && X.isAutoTail(state.autoTails.chat, item.quote_id, item.last_message_at));
        return {
            lastAuto: auto,
            closedReason: X && CLOSED_QUOTE_STATUSES.includes(status) ? X.closedReason(status) : '',
            key: 'quote:' + item.quote_id,
            source: 'quote',
            id: item.quote_id,
            synthetic: Boolean(item.synthetic),
            // INB-13: con la cotización aceptada la conversación pasa a "Clientes".
            category: M ? M.artistCategoryForQuote(status) : 'quotations',
            name: name,
            initials: initials(name),
            subject: style || 'Cotización',
            preview: item.last_message || (item.synthetic ? 'Todavía no hay mensajes' : 'Cotización en curso'),
            lastAt: item.last_message_at || quote.updated_at,
            lastSenderUserId: item.last_message_sender === 'artist' && !auto ? state.userId : null,
            unread: Number(item.unread_for_artist) || 0,
            favorite: false,
            archived: false,
            closed: CLOSED_QUOTE_STATUSES.includes(status),
            priority: false,
            context: {
                budget: fmtMoney(quote.budget || item.budget || item.final_budget_amount, quote.currency || item.currency || item.final_budget_currency),
                style: style,
                body_part: quote.tattoo_body_part || item.tattoo_body_part,
                quote_status: status,
                quote_id: item.quote_id,
            },
            raw: item,
        };
    }

    // tattoo_style es jsonb ({ style_name }) en quotations_db.
    function styleLabel(value) {
        if (value && typeof value === 'object') return value.style_name || value.name || '';
        return value ? String(value) : '';
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
        // La fila "Soporte" para iniciar una conversación no cuenta como hilo.
        const activeRows = state.rows.filter(function (row) { return !row.archived && !row.starter; });
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
        setText('ai-sum-replied', activeRows.filter(function (row) { return responseState(row).key === 'replied'; }).length);
        setText('ai-sum-waiting', activeRows.filter(function (row) { return responseState(row).key === 'waiting'; }).length);
    }

    // El contador global vive en el tile Ö (wo-artist-menu.js). Al leer un
    // hilo se le avisa para que recalcule sin esperar al refresco de 60 s.
    function announceInboxRead() {
        try { document.dispatchEvent(new CustomEvent('weotzi:inbox-read')); } catch (_) { /* navegadores viejos */ }
    }

    function renderList() {
        const list = visibleRows();
        setText('ai-list-cap', (CATEGORY_LABELS[state.filter] || 'TODAS') + ' · ' + list.length);
        const host = el('ai-list');
        if (!list.length) {
            host.innerHTML = '<div class="wo-empty ai-list-empty">' +
                '<i data-wo-icon="message-circle" aria-hidden="true"></i>' +
                '<span class="wo-empty-title">No hay conversaciones</span>' +
                '<p>Prueba con otra categoría o búsqueda.</p></div>';
            refreshIcons();
            return;
        }
        host.innerHTML = list.map(rowHtml).join('');
        refreshIcons();
    }

    function rowHtml(row) {
        const meta = CATEGORY_META[row.category] || { label: row.category || 'Mensaje', tone: 'default' };
        let status = responseState(row);
        if (row.starter) status = { key: 'new', label: 'Nueva conversación', cls: 'is-replied' };
        else if (row.synthetic) status = { key: 'new', label: 'Sin mensajes todavía', cls: 'is-closed' };
        const active = row.key === state.activeKey ? ' is-active' : '';
        const unread = row.unread > 0 ? ' is-unread' : '';
        const avatarTone = ' ai-avatar--' + meta.tone;
        const favoriteButton = row.source === 'unified'
            ? '<button type="button" class="ai-row-star' + (row.favorite ? ' is-active' : '') + '" data-row-flag="favorite" data-key="' + esc(row.key) + '" aria-label="' + (row.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '"><i data-wo-icon="star" class="wo-icon-16" aria-hidden="true"></i></button>'
            : '';
        return '<article class="ai-row' + active + unread + '" data-row-key="' + esc(row.key) + '">' +
            '<button type="button" class="ai-row-open" data-open-thread="' + esc(row.key) + '" aria-label="Abrir conversación con ' + esc(row.name) + '">' +
                '<span class="ai-avatar' + avatarTone + '">' + esc(row.initials) + '</span>' +
                '<span class="ai-row-body">' +
                    '<span class="ai-row-top"><span class="ai-row-name">' + esc(row.name) + '</span><time class="ai-row-time">' + esc(fmtListTime(row.lastAt)) + '</time></span>' +
                    '<span class="ai-row-tags"><span class="wo-tag ai-category-tag is-' + esc(meta.tone) + '">' + esc(meta.label) + '</span>' +
                        (row.priority ? '<span class="ai-priority-tag">Prioritario</span>' : '') + '</span>' +
                    '<span class="ai-row-prev"><span class="ai-row-preview">' + (row.lastAuto ? '<span class="ai-row-auto">Automático · </span>' : '') + esc(row.preview) + '</span>' +
                        (row.unread ? '<span class="wo-badge ai-row-unread">' + row.unread + '</span>' : '') + '</span>' +
                    '<span class="ai-row-status ' + status.cls + '">' + status.label + '</span>' +
                '</span>' +
            '</button>' + favoriteButton +
        '</article>';
    }

    function responseState(row) {
        // Lógica compartida (inbox-response-state.js): un mensaje de sistema que
        // cierra la acción (invitación aceptada, etc.) no queda "Esperando respuesta".
        if (window.InboxResponseState) return window.InboxResponseState.responseState(row, state.userId);
        if (row.closed) return { key: 'closed', label: 'Cerrado', cls: 'is-closed' };
        const explicit = row.context && row.context.reply_status;
        if (explicit === 'replied') return { key: 'replied', label: 'Respondido', cls: 'is-replied' };
        if (explicit === 'waiting') return { key: 'waiting', label: 'Esperando respuesta', cls: 'is-waiting' };
        return row.lastSenderUserId === state.userId
            ? { key: 'replied', label: 'Respondido', cls: 'is-replied' }
            : { key: 'waiting', label: 'Esperando respuesta', cls: 'is-waiting' };
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
            else if (state.activeKey === key) renderThreadHead(findRow(key) || row);
        } catch (error) {
            console.error('[artist-inbox] flags', error);
            notify('No pudimos actualizar la conversación.', 'error');
        }
    }

    // CF-10: la dirección sigue al hilo abierto (igual que /client/chats).
    // wo-notify.js compara ?quote= / ?thread= con el aviso que llega para no
    // mostrar el toast de la conversación que ya está en pantalla.
    function syncThreadUrl(row) {
        const links = window.ArtistInboxDeepLink;
        if (!links || typeof links.threadLocation !== 'function') return;
        try {
            const next = links.threadLocation(row, window.location.href);
            const current = window.location.pathname + window.location.search + window.location.hash;
            if (next && next !== current) window.history.replaceState(window.history.state, '', next);
        } catch (_) { /* sin History API */ }
    }

    async function openThread(key) {
        const row = findRow(key);
        if (!row) return;
        state.activeKey = key;
        syncThreadUrl(row);
        state.activeMessages = [];
        clearPendingFiles();
        resetThreadExtras();
        removeThreadChannel();

        el('ai-thread-placeholder').hidden = true;
        el('ai-thread').hidden = false;
        el('ai-support-empty').hidden = true;
        el('ai-messages').hidden = false;
        el('ai-shell').classList.add('is-thread-open');
        setContextSheet(false);
        renderList();
        renderThreadHead(row);
        renderContext(row);
        renderMessagesLoading();
        applyThreadAccess(row);

        try {
            if (row.source === 'unified') {
                const messages = await D.Inbox.listMessages(row.id);
                if (state.activeKey !== key) return;
                state.activeMessages = messages.map(adaptUnifiedMessage);
                const hadUnread = row.unread > 0;
                await D.Inbox.markRead(row.id).catch(function () {});
                row.raw.unread_count = 0;
                row.unread = 0;
                if (hadUnread) announceInboxRead();
                state.threadChannel = D.Inbox.subscribeThread(row.id, function (payload) {
                    const message = payload && payload.new;
                    if (!message || state.activeKey !== key) return;
                    if (addMessage(adaptUnifiedMessage(message))) renderMessages();
                    D.Inbox.markRead(row.id).catch(function () {});
                    scheduleRefresh();
                });
            } else if (row.source === 'quote') {
                // Ronda 2: al abrir se relee la cotización (estado fresco).
                delete state.quoteDetails[row.id];
                const results = await Promise.all([
                    row.synthetic ? Promise.resolve([]) : D.Chat.listByQuote(row.id),
                    loadQuoteDetails(row.id),
                ]);
                if (state.activeKey !== key) return;
                syncQuoteClosure(row, results[1]);
                state.activeMessages = results[0].map(adaptQuoteMessage);
                renderContext(row);
                const hadUnread = row.unread > 0;
                if (!row.synthetic) await D.Chat.markRead(row.id, 'client').catch(function () {});
                row.raw.unread_for_artist = 0;
                row.unread = 0;
                if (hadUnread) announceInboxRead();
                if (D.Realtime && D.Realtime.subscribeChatMessages) {
                    state.threadChannel = D.Realtime.subscribeChatMessages('artist-inbox-quote-' + row.id, row.id, function (payload) {
                        const message = payload && payload.new;
                        if (!message || state.activeKey !== key) return;
                        if (addMessage(adaptQuoteMessage(message))) renderMessages();
                        if (message.sender_type === 'client') D.Chat.markRead(row.id, 'client').catch(function () {});
                    });
                }
            } else if (row.starter) {
                // INB-11: todavía no hay conversación; se crea al escribir.
                state.activeMessages = [];
                el('ai-messages').hidden = true;
                el('ai-support-empty').hidden = false;
                el('ai-support-cta').hidden = false;
            } else {
                const messages = await D.SupportInbox.listMessages(row.id);
                if (state.activeKey !== key) return;
                state.legacySupportMessages = messages;
                state.activeMessages = messages.map(adaptSupportMessage);
                subscribeSupport(row.id, key);
            }

            renderMessages();
            renderSidebarCounts();
            renderList();
        } catch (error) {
            console.error('[artist-inbox] abrir hilo', error);
            renderMessagesError();
        }
    }

    // Agrega un mensaje al hilo abierto sin duplicar (eco realtime vs. POST).
    function addMessage(message) {
        if (M) return M.addUnique(state.activeMessages, message);
        if (message && state.activeMessages.some(function (item) { return item.id === message.id; })) return false;
        state.activeMessages.push(message);
        return true;
    }

    // quotations_db de la cotización del hilo (tarjeta y estado). Cacheada.
    async function loadQuoteDetails(quoteId) {
        if (state.quoteDetails[quoteId]) return state.quoteDetails[quoteId];
        if (!D.Quotations || !D.Quotations.getForArtistByQuoteId) return null;
        try {
            const quote = await D.Quotations.getForArtistByQuoteId(quoteId);
            if (quote) state.quoteDetails[quoteId] = quote;
            return quote;
        } catch (error) {
            console.warn('[artist-inbox] cotización del hilo', error);
            return null;
        }
    }

    function subscribeSupport(conversationId, key) {
        if (!D.SupportInbox || !D.SupportInbox.subscribeMessages) return;
        state.threadChannel = D.SupportInbox.subscribeMessages(conversationId, function (payload) {
            const message = payload && payload.new;
            if (!message || state.activeKey !== key) return;
            if (addMessage(adaptSupportMessage(message))) renderMessages();
        });
    }

    // Crea (o recupera) la conversación de soporte y, si hay texto, lo envía.
    async function startSupportConversation(firstMessage) {
        if (!D.SupportInbox || !D.SupportInbox.openConversation) {
            notify('El soporte no está disponible en este momento.', 'error');
            return false;
        }
        const cta = el('ai-support-cta');
        if (cta) cta.disabled = true;
        try {
            const opened = await D.SupportInbox.openConversation('artist_inbox');
            const conversation = opened.conversation;
            if (firstMessage) {
                await D.SupportInbox.sendMessage({ conversationId: conversation.id, content: firstMessage, pageContext: 'artist_inbox' });
            }
            state.legacySupport = conversation;
            await reloadRows({ preserveSelection: false });
            await openThread('support:' + conversation.id);
            return true;
        } catch (error) {
            console.error('[artist-inbox] soporte', error);
            notify('No pudimos abrir el chat de soporte. Prueba de nuevo en unos minutos.', 'error');
            return false;
        } finally {
            if (cta) cta.disabled = false;
        }
    }

    function closeThread() {
        state.activeKey = null;
        syncThreadUrl(null);
        state.activeMessages = [];
        removeThreadChannel();
        clearPendingFiles();
        resetThreadExtras();
        el('ai-thread').hidden = true;
        el('ai-thread-placeholder').hidden = false;
        el('ai-context').hidden = true;
        el('ai-shell').classList.remove('is-thread-open');
        setContextSheet(false);
        renderList();
    }

    function closeMobileThread() {
        setContextSheet(false);
        el('ai-shell').classList.remove('is-thread-open');
        // En móvil volver a la lista saca el hilo de la pantalla: sus avisos
        // vuelven a mostrarse. En escritorio el hilo sigue a la vista.
        const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 769px)').matches;
        if (!wide) syncThreadUrl(null);
    }

    // INB-12: debajo de 1281px el panel de contexto se abre como hoja lateral
    // desde el botón "Info" del encabezado del hilo (en escritorio ancho es
    // una columna fija y el botón no se muestra).
    function setContextSheet(open) {
        const shell = el('ai-shell');
        if (!shell) return;
        const wasOpen = shell.classList.contains('is-context-open');
        shell.classList.toggle('is-context-open', Boolean(open));
        const scrim = el('ai-context-scrim');
        if (scrim) scrim.hidden = !open;
        const toggle = document.querySelector('[data-thread-info]');
        if (toggle) toggle.setAttribute('aria-expanded', String(Boolean(open)));
        const context = el('ai-context');
        if (open && context) {
            context.setAttribute('tabindex', '-1');
            window.setTimeout(function () { try { context.focus(); } catch (_) { /* noop */ } }, 20);
        } else if (wasOpen && toggle) {
            try { toggle.focus(); } catch (_) { /* noop */ }
        }
    }

    function renderThreadHead(row) {
        const meta = CATEGORY_META[row.category] || { label: row.category || 'Mensaje' };
        const persistentTools = row.source === 'unified'
            ? '<div class="ai-thread-tools">' +
                '<button type="button" class="wo-iconbtn' + (row.favorite ? ' is-active' : '') + '" data-head-flag="favorite" aria-label="' + (row.favorite ? 'Quitar de favoritas' : 'Marcar como favorita') + '" title="Favorita"><i data-wo-icon="star" class="wo-icon-16" aria-hidden="true"></i></button>' +
                '<button type="button" class="wo-iconbtn" data-head-flag="archived" aria-label="' + (row.archived ? 'Restaurar conversación' : 'Archivar conversación') + '" title="' + (row.archived ? 'Restaurar' : 'Archivar') + '"><i data-wo-icon="archive" class="wo-icon-16" aria-hidden="true"></i></button>' +
            '</div>'
            : '';
        el('ai-thread-head').innerHTML =
            '<button type="button" class="wo-iconbtn ai-back" data-thread-back aria-label="Volver a conversaciones"><i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i></button>' +
            '<span class="ai-avatar ai-head-avatar">' + esc(row.initials) + '</span>' +
            '<div class="ai-head-copy"><strong>' + esc(row.name) + '</strong><span>' + esc(meta.label) + (row.subject ? ' · ' + esc(row.subject) : '') + '</span></div>' +
            persistentTools +
            '<button type="button" class="wo-iconbtn ai-info-toggle" data-thread-info aria-controls="ai-context" aria-expanded="false" aria-label="Ver detalles de la conversación" title="Detalles"><i data-wo-icon="info" class="wo-icon-16" aria-hidden="true"></i></button>';
        refreshIcons();
    }

    async function onThreadHeadClick(event) {
        if (event.target.closest('[data-thread-back]')) {
            closeMobileThread();
            return;
        }
        if (event.target.closest('[data-thread-info]')) {
            setContextSheet(!el('ai-shell').classList.contains('is-context-open'));
            return;
        }
        const flag = event.target.closest('[data-head-flag]');
        if (flag) await toggleFlag(state.activeKey, flag.dataset.headFlag);
    }

    function renderMessagesLoading() {
        el('ai-messages').innerHTML = '<div class="ai-msg-loading"><span class="wo-spinner" aria-hidden="true"></span><span class="wo-meta-s">Cargando mensajes</span></div>';
    }

    function renderMessagesError() {
        el('ai-messages').innerHTML = '<div class="wo-empty"><span class="wo-empty-title">No pudimos cargar los mensajes</span><p>Vuelve a abrir esta conversación para reintentar.</p></div>';
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
            durationMs: message.attachment_duration_ms || null,
            autoKind: message.auto_kind || null,
        };
    }

    function adaptQuoteMessage(message) {
        return {
            id: message.id || String(message.created_at) + ':' + message.message,
            mine: message.sender_type === 'artist',
            body: message.message || '',
            at: message.created_at,
            kind: message.message_kind || 'text',
            attachmentSource: 'chat',
            attachmentPath: message.attachment_path || null,
            attachmentName: message.attachment_name || null,
            attachmentMime: message.attachment_mime || null,
            durationMs: message.attachment_duration_ms || null,
            autoKind: message.auto_kind || null,
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

    // Timeline del hilo: mensajes + (en cotizaciones) la tarjeta "Cotización"
    // ubicada en el momento en que el artista envió el precio (Figma 801:1149).
    function timelineItems() {
        const items = state.activeMessages.slice();
        const row = findRow(state.activeKey);
        if (row && row.source === 'quote' && M) {
            const card = M.quoteCard(Object.assign({}, row.raw, state.quoteDetails[row.id] || {}));
            if (card) {
                items.push({ id: 'quote-card:' + row.id, kind: 'quote_card', card: card, at: card.at || (items[0] && items[0].at) || new Date().toISOString() });
                items.sort(function (a, b) { return new Date(a.at || 0) - new Date(b.at || 0); });
            }
        }
        return items;
    }

    function renderMessages() {
        const host = el('ai-messages');
        const items = timelineItems();
        if (!items.length) {
            const row = findRow(state.activeKey);
            const copy = row && row.synthetic
                ? 'Todavía no hay mensajes con este cliente. Escribe el primero.'
                : 'Escribe un mensaje para continuar.';
            host.innerHTML = '<div class="wo-empty ai-msg-empty"><i data-wo-icon="message-circle" aria-hidden="true"></i><span class="wo-empty-title">Empieza la conversación</span><p>' + esc(copy) + '</p></div>';
            refreshIcons();
            return;
        }
        let lastDay = '';
        host.innerHTML = items.map(function (message) {
            const day = fmtDayKey(message.at);
            const separator = day !== lastDay
                ? '<div class="ai-day"><span>' + esc(fmtDayLabel(message.at)) + '</span></div>'
                : '';
            lastDay = day;
            return separator + (message.kind === 'quote_card' ? quoteCardHtml(message.card) : messageHtml(message));
        }).join('');
        // Los reproductores de voz se montan antes de bajar el scroll (ocupan alto).
        if (window.WoVoice) window.WoVoice.hydrate(host, signedUrlFor);
        host.scrollTop = host.scrollHeight;
        refreshIcons();
        hydrateAttachmentThumbs(host);
    }

    function quoteCardHtml(card) {
        const href = appHref('/my-quotations/detail?quote=' + encodeURIComponent(card.quoteId || ''));
        return '<article class="ai-quote-card" aria-label="Cotización enviada">' +
            '<p class="ai-quote-card-eyebrow">Cotización</p>' +
            '<h3 class="ai-quote-card-title">' + esc(card.title) + '</h3>' +
            '<p class="ai-quote-card-price wo-mono-num">' + esc(card.price) + '</p>' +
            (card.duration ? '<p class="ai-quote-card-meta">Duración estimada: ' + esc(card.duration) + '</p>' : '') +
            '<a class="ai-quote-card-link" href="' + esc(href) + '">Ver cotización <span aria-hidden="true">→</span></a>' +
        '</article>';
    }

    function messageHtml(message) {
        const direction = message.mine ? ' ai-msg--out' : ' ai-msg--in';
        const isImage = String(message.attachmentMime || '').startsWith('image/');
        const source = message.attachmentSource === 'chat' ? 'chat' : 'inbox';
        // Ronda 2: un adjunto de audio es un mensaje de voz (reproductor inline
        // que monta wo-voice.js) y los automáticos llevan su marca.
        const isVoice = Boolean(message.attachmentPath && window.WoVoice && X && X.isAudioAttachment(message.attachmentMime));
        const autoTag = message.autoKind ? '<span class="wo-auto-tag">' + esc(X ? X.AUTO_LABEL : 'Mensaje automático') + '</span>' : '';
        const attachment = isVoice
            ? '<div class="wo-voice-slot" data-wo-voice-path="' + esc(message.attachmentPath) + '" data-wo-voice-source="' + source + '" data-wo-voice-ms="' + (Number(message.durationMs) || 0) + '"></div>'
            : message.attachmentPath
            ? '<button type="button" class="ai-msg-attachment' + (isImage ? ' is-image' : '') + '" data-attachment-path="' + esc(message.attachmentPath) + '" data-attachment-source="' + source + '"' +
                (isImage ? ' data-attachment-image' : '') + ' aria-label="Abrir ' + esc(message.attachmentName || 'adjunto') + '">' +
                (isImage ? '<span class="ai-msg-thumb" aria-hidden="true"></span>' : '') +
                '<i data-wo-icon="' + (isImage ? 'image' : 'paperclip') + '" class="wo-icon-18" aria-hidden="true"></i>' +
                '<span>' + esc(message.attachmentName || 'Abrir adjunto') + '</span>' +
                '<i data-wo-icon="external-link" class="wo-icon-16" aria-hidden="true"></i></button>'
            : '';
        return '<div class="ai-msg' + direction + '"><div class="ai-bubble">' + autoTag +
            (message.body ? '<p>' + linkify(message.body) + '</p>' : '') + attachment +
            '<time>' + esc(fmtMsgTime(message.at)) + '</time></div></div>';
    }

    function signedUrlFor(source, path) {
        const cacheKey = source + ':' + path;
        const cached = state.attachmentUrls.get(cacheKey);
        // Las URL firmadas duran 1 h: se renuevan a los 50 min.
        if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.promise;
        const repo = source === 'chat' ? D.Chat : D.Inbox;
        if (!repo || !repo.signedAttachmentUrl) return Promise.resolve(null);
        const pending = repo.signedAttachmentUrl(path).catch(function (error) {
            state.attachmentUrls.delete(cacheKey);
            throw error;
        });
        state.attachmentUrls.set(cacheKey, { promise: pending, at: Date.now() });
        return pending;
    }

    // Miniaturas de imágenes adjuntas (URL firmada, bucket privado).
    function hydrateAttachmentThumbs(host) {
        host.querySelectorAll('[data-attachment-image]').forEach(function (button) {
            const thumb = button.querySelector('.ai-msg-thumb');
            if (!thumb || thumb.dataset.loaded) return;
            thumb.dataset.loaded = '1';
            signedUrlFor(button.dataset.attachmentSource, button.dataset.attachmentPath).then(function (url) {
                if (!url || !/^https:\/\//i.test(url)) return;
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = url;
                thumb.appendChild(img);
                button.classList.add('has-thumb');
            }).catch(function () { /* queda el ícono */ });
        });
    }

    async function onMessageClick(event) {
        const attachment = event.target.closest('[data-attachment-path]');
        if (!attachment) return;
        // Abrir la pestaña en el gesto del usuario (los bloqueadores de pop-ups
        // cortan window.open después de un await).
        const popup = window.open('', '_blank');
        try {
            const url = await signedUrlFor(attachment.dataset.attachmentSource, attachment.dataset.attachmentPath);
            if (!url) throw new Error('sin URL');
            if (popup) {
                popup.opener = null;
                popup.location.href = url;
            } else {
                window.location.assign(url);
            }
        } catch (error) {
            if (popup) popup.close();
            console.error('[artist-inbox] adjunto', error);
            notify('No pudimos abrir el archivo.', 'error');
        }
    }

    function renderContext(row) {
        let context = row.context || {};
        const details = row.source === 'quote' ? state.quoteDetails[row.id] : null;
        if (details && !context.budget && M) {
            const card = M.quoteCard(Object.assign({}, row.raw, details));
            if (card) context = Object.assign({}, context, { budget: card.price });
        }
        const meta = CATEGORY_META[row.category] || { label: 'Conversación' };
        // Figma 801:1085: el panel de seguimiento muestra la categoría y los
        // datos del dominio (estudio, fechas, estado). Contacto/asunto solo
        // aparecen cuando la conversación no trae contexto propio.
        const domainBlocks = [];
        if (context.client && context.client !== row.name) domainBlocks.push(ctxBlock('Cliente', context.client));
        // En la categoría Estudios el eyebrow ya dice "ESTUDIO": el nombre va sin etiqueta repetida.
        if (context.studio || context.studio_name) {
            domainBlocks.push(ctxBlock(row.category === 'studios' ? '' : 'Estudio', context.studio || context.studio_name));
        }
        if (context.reason_label) domainBlocks.push(ctxBlock('Motivo', context.reason_label));
        if (context.city || context.country) domainBlocks.push(ctxBlock('Destino', [context.city, context.country].filter(Boolean).join(', ')));
        const dates = context.start_date || context.end_date
            ? formatDateRange(context.start_date, context.end_date)
            : formatLooseDates(context.dates);
        if (dates) domainBlocks.push(ctxBlock('Fechas', dates));
        if (context.appointment) domainBlocks.push(ctxBlock('Turno', context.appointment));
        if (context.budget) domainBlocks.push(ctxBlock('Presupuesto', context.budget, true));
        if (context.style) domainBlocks.push(ctxBlock('Estilo', context.style));
        if (context.body_part) domainBlocks.push(ctxBlock('Zona', context.body_part));
        if (context.request_code) domainBlocks.push(ctxBlock('Solicitud', context.request_code, true));
        const blocks = domainBlocks.filter(Boolean).length
            ? domainBlocks
            : [ctxBlock('Contacto', row.name), row.subject ? ctxBlock('Asunto', row.subject) : ''];

        const domainStatus = context.application_status || context.invitation_status || context.membership_status || context.link_status || context.quote_status;
        if (domainStatus) blocks.push(ctxStatus(domainStatus, row.category));
        else if (row.closed) blocks.push(ctxStatus('closed', row.category));

        const link = contextLink(row);
        const host = el('ai-context');
        host.hidden = false;
        host.innerHTML = '<div class="ai-ctx-sheet-head"><p class="wo-eyebrow ai-ctx-eyebrow">' + esc(meta.label.toUpperCase()) + '</p>' +
            '<button type="button" class="wo-iconbtn ai-ctx-close" data-context-close aria-label="Cerrar detalles"><i data-wo-icon="x" class="wo-icon-16" aria-hidden="true"></i></button></div>' +
            blocks.join('') + (link ? '<a class="wo-btn wo-btn--ghost wo-btn--s ai-ctx-link" href="' + esc(link.href) + '">' + esc(link.label) + '<i data-wo-icon="arrow-right" class="wo-icon-16" aria-hidden="true"></i></a>' : '');
        refreshIcons();
    }

    function ctxBlock(label, value, mono) {
        if (value === null || value === undefined || value === '') return '';
        return '<div class="ai-ctx-block">' + (label ? '<span class="ai-ctx-label">' + esc(label) + '</span>' : '') +
            '<span class="ai-ctx-value' + (mono ? ' wo-mono-num' : '') + '">' + esc(value) + '</span></div>';
    }

    const STATUS_TONES = {
        accepted: 'success', confirmada: 'success', confirmed: 'success', active: 'success', completed: 'success',
        client_approved: 'success', in_progress: 'success', artist_completed: 'success', responded: 'warning',
        pending: 'warning', pending_acceptance: 'warning', shortlisted: 'warning', esperando_confirmacion: 'warning',
        viewed: 'warning', open: 'success',
        closed: 'muted', expired: 'muted', client_rejected: 'muted', rechazada: 'muted', rejected: 'muted', cancelada: 'muted',
    };

    function ctxStatus(status, category) {
        const applicationLike = category === 'spots' || category === 'job_board';
        const label = applicationLike && status === 'accepted'
            ? 'Postulación aceptada'
            : applicationLike && status === 'shortlisted'
                ? 'Postulación preseleccionada'
                : humanStatus(status);
        const tone = STATUS_TONES[status] || 'success';
        return '<span class="ai-ctx-status is-' + tone + '">' + esc(label) + '</span>';
    }

    // Rutas canónicas del flujo de artista (BRIEF). El enlace aparece al
    // pasar por el panel; no forma parte del estado estático del Figma.
    function contextLink(row) {
        const context = row.context || {};
        const quoteId = row.source === 'quote' ? row.id : (context.quote_id || (row.contextType === 'quotation' ? row.contextId : null));
        const tripId = context.trip_id || (row.contextType === 'artist_trip' ? row.contextId : null);
        if ((row.category === 'quotations' || row.category === 'clients') && quoteId) {
            return { href: appHref('/my-quotations/detail?quote=' + encodeURIComponent(quoteId)), label: 'Ver cotización' };
        }
        if (row.category === 'trips' && tripId) {
            return { href: appHref('/artist/travel/?trip=' + encodeURIComponent(tripId)), label: 'Ver viaje' };
        }
        const studioRef = context.studio_slug || context.studio_id || (row.contextType === 'studio_contact' ? row.contextId : null);
        if (row.category === 'studios' && studioRef) {
            return { href: appHref('/studio/profile?studio=' + encodeURIComponent(studioRef)), label: 'Ver perfil del estudio' };
        }
        const links = {
            quotations: { href: '/my-quotations', label: 'Ver cotizaciones' },
            clients: { href: '/my-quotations', label: 'Ver cotizaciones' },
            invitations: { href: '/artist/invitations', label: 'Ver invitaciones' },
            spots: { href: '/artist/applications', label: 'Ver postulaciones' },
            job_board: { href: '/artist/applications', label: 'Ver postulaciones' },
            studios: { href: '/artist/invitations', label: 'Ver invitaciones' },
            trips: { href: '/artist/travel/', label: 'Ver Travel' },
        };
        const link = links[row.category];
        return link ? { href: appHref(link.href), label: link.label } : null;
    }

    // Prefijo de montaje de la app (/beta, preview local) igual que appUrl() de config-manager.
    function appBasePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const pathname = window.location.pathname || '';
        const index = pathname.indexOf('/artist/inbox');
        if (index > 0) return pathname.slice(0, index);
        return pathname === '/beta' || pathname.startsWith('/beta/') ? '/beta' : '';
    }

    function appHref(path) {
        const normalized = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
        const base = appBasePath();
        return base && !normalized.startsWith(base + '/') ? base + normalized : normalized;
    }

    // Soporte no admite adjuntos (el endpoint solo recibe texto); cotizaciones
    // e hilos unificados sí (chat-attachments / inbox-attachments).
    function attachmentsAllowed(row) {
        return Boolean(row && !row.closed && row.source !== 'support');
    }

    function setComposer(placeholder, enabled) {
        const input = el('ai-input');
        input.disabled = !enabled;
        const row = findRow(state.activeKey);
        const canAttach = enabled && attachmentsAllowed(row);
        ['ai-attach', 'ai-image', 'ai-voice'].forEach(function (id) {
            const button = el(id);
            if (!button) return;
            button.disabled = !canAttach;
            button.hidden = Boolean(row && row.source === 'support') || (id === 'ai-voice' && !window.WoVoice);
        });
        if (el('ai-emoji')) el('ai-emoji').disabled = !enabled;
        if (el('ai-quick')) el('ai-quick').disabled = !enabled;
        input.placeholder = placeholder;
        syncSendState();
    }

    function restoreComposerTools(row) {
        const open = Boolean(row && !row.closed);
        if (el('ai-input')) el('ai-input').disabled = !open;
        ['ai-attach', 'ai-image', 'ai-voice'].forEach(function (id) {
            if (el(id)) el(id).disabled = !(open && attachmentsAllowed(row));
        });
        if (el('ai-emoji')) el('ai-emoji').disabled = !open;
        if (el('ai-quick')) el('ai-quick').disabled = !open;
    }

    // Ronda 2 · [Chat cerrado]: un hilo cerrado se ve en solo lectura, con el
    // motivo en lugar del campo de mensaje. Si la cotización fue rechazada por
    // el cliente, el artista no puede volver a escribirle (la base también lo
    // impide).
    function applyThreadAccess(row) {
        const closed = Boolean(row && row.closed);
        const note = el('ai-closed-note');
        if (note) {
            note.textContent = closed ? (row.closedReason || (X ? X.closedReason('') : 'Esta conversación está cerrada.')) : '';
            note.hidden = !closed;
        }
        if (el('ai-composer')) el('ai-composer').hidden = closed;
        setComposer(closed ? 'Esta conversación está cerrada.' : (row && row.starter ? 'Escribe tu consulta para soporte…' : 'Escribe un mensaje…'), !closed);
    }

    // El estado de la cotización que se lee al abrir el hilo es el más fresco:
    // si el cliente la rechazó después de cargar la lista, abre en solo lectura.
    function syncQuoteClosure(row, quote) {
        const status = quote && quote.quote_status;
        if (!status || row.closed || !CLOSED_QUOTE_STATUSES.includes(status)) return;
        row.closed = true;
        row.closedReason = X ? X.closedReason(status) : '';
        if (row.context) row.context.quote_status = status;
        resetThreadExtras();
        applyThreadAccess(row);
        renderList();
    }

    // Al cambiar de hilo: se corta una grabación en curso, se frena el audio
    // que estuviera sonando y se cierra el panel de mensajes rápidos.
    function resetThreadExtras() {
        if (state.voice) state.voice.reset();
        if (state.quick) state.quick.close();
        if (window.WoVoice) window.WoVoice.resetPlayers();
    }

    // Ronda 2 · P8/P9: micrófono, mensajes rápidos y respuestas automáticas.
    function wireExtras() {
        const composer = el('ai-composer');
        if (window.WoVoice && composer && el('ai-voice')) {
            state.voice = window.WoVoice.attachRecorder({
                form: composer,
                button: el('ai-voice'),
                canRecord: function () {
                    return Boolean(attachmentsAllowed(findRow(state.activeKey)) && !state.sending);
                },
                onSend: sendVoiceMessage,
                onError: function (message) { notify(message, 'error'); },
            });
        } else if (el('ai-voice')) {
            el('ai-voice').hidden = true;
        }
        if (window.WoQuickReplies && composer && el('ai-quick')) {
            state.quick = window.WoQuickReplies.attach({
                role: 'artist',
                getUserId: function () { return state.userId; },
                button: el('ai-quick'),
                form: composer,
                input: el('ai-input'),
                canUse: function () {
                    const row = findRow(state.activeKey);
                    return Boolean(row && !row.closed && !state.sending);
                },
                notify: notify,
                onOpenAutomations: openAutomations,
            });
        } else if (el('ai-quick')) {
            el('ai-quick').hidden = true;
        }
        const autoButton = el('ai-auto-open');
        if (autoButton && window.WoInboxAutomations) autoButton.addEventListener('click', openAutomations);
        else if (autoButton) autoButton.hidden = true;
    }

    function openAutomations() {
        if (!window.WoInboxAutomations || !state.userId) return;
        window.WoInboxAutomations.open({
            getUserId: function () { return state.userId; },
            notify: notify,
            accountHref: appHref('/artist/account#disponibilidad'),
        });
    }

    // Mensaje de voz: sube el audio al bucket del hilo y guarda el mensaje.
    // Si la base lo rechaza, el archivo subido se borra. Los errores vuelven
    // al grabador (wo-voice.js), que conserva la grabación para reintentar.
    async function sendVoiceMessage(voice) {
        const row = findRow(state.activeKey);
        if (!row || state.sending || !attachmentsAllowed(row)) throw new Error('conversación no disponible');
        const key = row.key;
        const unified = row.source === 'unified';
        const repo = unified ? D.Inbox : D.Chat;
        let uploaded = null;
        state.sending = true;
        syncSendState();
        try {
            uploaded = await repo.uploadAttachment(row.id, state.userId, voice.file);
            const saved = unified
                ? await D.Inbox.sendVoiceMessage({ threadId: row.id, attachment: uploaded, durationMs: voice.durationMs })
                : await D.Chat.sendMessage({
                    quoteId: row.id, senderType: 'artist', senderId: state.userId, message: '',
                    attachment: Object.assign({}, uploaded, { durationMs: voice.durationMs }),
                });
            const message = Array.isArray(saved) ? saved[0] : saved;
            if (message && state.activeKey === key) {
                addMessage(unified ? adaptUnifiedMessage(message) : adaptQuoteMessage(message));
                if (row.synthetic) {
                    row.synthetic = false;
                    row.raw.synthetic = false;
                }
                renderMessages();
            }
            scheduleRefresh();
        } catch (error) {
            // Solo se limpia si la base respondió con un rechazo (con un corte
            // de red el mensaje pudo haberse guardado).
            if (uploaded && uploaded.path && error && error.code && repo.removeAttachment) repo.removeAttachment(uploaded.path);
            scheduleRefresh();
            throw error;
        } finally {
            state.sending = false;
            syncSendState();
        }
    }

    function onFileChosen(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        const row = findRow(state.activeKey);
        if (!attachmentsAllowed(row)) {
            event.target.value = '';
            notify('En esta conversación no se pueden enviar adjuntos.', 'info');
            return;
        }
        const validFiles = files.filter(function (file) {
            return M ? M.validateAttachment(file).ok : file.size <= MAX_ATTACHMENT_BYTES;
        });
        if (validFiles.length !== files.length) {
            const invalid = files.find(function (file) { return validFiles.indexOf(file) === -1; });
            notify(M && invalid ? M.validateAttachment(invalid).error : 'El archivo supera el límite de 15 MB.', 'error');
        }
        state.pendingFiles.push.apply(state.pendingFiles, validFiles);
        event.target.value = '';
        renderPendingFiles();
        syncSendState();
    }

    function renderPendingFiles() {
        const host = el('ai-attachment-preview');
        if (!state.pendingFiles.length) {
            host.hidden = true;
            host.innerHTML = '';
            host.style.removeProperty('--ai-attachment-slots');
            host.scrollLeft = 0;
            return;
        }
        host.hidden = false;
        host.style.setProperty('--ai-attachment-slots', String(Math.min(state.pendingFiles.length, MAX_VISIBLE_ATTACHMENTS)));
        host.innerHTML = state.pendingFiles.map(function (file, index) {
            return '<div class="ai-attachment-card" role="group" aria-label="Adjunto ' + (index + 1) + ' de ' + state.pendingFiles.length + '">' +
                '<i data-wo-icon="' + (String(file.type).startsWith('image/') ? 'image' : 'paperclip') + '" class="wo-icon-16" aria-hidden="true"></i>' +
                '<span class="ai-attachment-name" title="' + esc(file.name) + '">' + esc(file.name) + '</span>' +
                '<button type="button" class="wo-iconbtn ai-attachment-remove" data-remove-attachment="' + index + '" aria-label="Quitar ' + esc(file.name) + '"><i data-wo-icon="x" class="wo-icon-16" aria-hidden="true"></i></button>' +
            '</div>';
        }).join('');
        refreshIcons();
    }

    function onAttachmentPreviewClick(event) {
        const remove = event.target.closest('[data-remove-attachment]');
        if (!remove || (state.attachmentDrag && state.attachmentDrag.moved)) return;
        const index = Number(remove.dataset.removeAttachment);
        if (!Number.isInteger(index)) return;
        state.pendingFiles.splice(index, 1);
        renderPendingFiles();
        syncSendState();
    }

    function onAttachmentDragStart(event) {
        const host = el('ai-attachment-preview');
        if (!host || host.scrollWidth <= host.clientWidth || event.button !== 0 || event.target.closest('button')) return;
        state.attachmentDrag = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: host.scrollLeft, moved: false };
        host.classList.add('is-dragging');
        host.setPointerCapture(event.pointerId);
    }

    function onAttachmentDragMove(event) {
        const host = el('ai-attachment-preview');
        const drag = state.attachmentDrag;
        if (!host || !drag || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        if (Math.abs(delta) > 3) drag.moved = true;
        host.scrollLeft = drag.scrollLeft - delta;
    }

    function onAttachmentDragEnd(event) {
        const host = el('ai-attachment-preview');
        const drag = state.attachmentDrag;
        if (!host || !drag || drag.pointerId !== event.pointerId) return;
        if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
        host.classList.remove('is-dragging');
        state.attachmentDrag = null;
    }

    function clearPendingFiles() {
        state.pendingFiles = [];
        state.attachmentDrag = null;
        if (el('ai-file')) el('ai-file').value = '';
        if (el('ai-attachment-preview')) {
            el('ai-attachment-preview').classList.remove('is-dragging');
            renderPendingFiles();
        }
        syncSendState();
    }

    function syncSendState() {
        const row = findRow(state.activeKey);
        const enabled = Boolean(row && !row.closed && !state.sending && (el('ai-input').value.trim() || state.pendingFiles.length));
        el('ai-send').disabled = !enabled;
    }

    async function onComposerSubmit(event) {
        event.preventDefault();
        const row = findRow(state.activeKey);
        if (!row || row.closed || state.sending) return;
        const input = el('ai-input');
        const body = input.value.trim();
        const files = attachmentsAllowed(row) ? state.pendingFiles.slice() : [];
        if (!body && !files.length) return;
        state.sending = true;
        input.disabled = true;
        el('ai-send').disabled = true;
        document.querySelectorAll('.ai-composer-tools .ai-attach').forEach(function (button) { button.disabled = true; });

        try {
            if (row.source === 'unified') {
                if (files.length) {
                    for (let index = 0; index < files.length; index += 1) {
                        const file = files[index];
                        const attachment = await D.Inbox.uploadAttachment(row.id, state.userId, file);
                        const saved = await D.Inbox.sendMessage({ threadId: row.id, body: index === 0 ? body : null, attachment: attachment });
                        const message = Array.isArray(saved) ? saved[0] : saved;
                        if (message) addMessage(adaptUnifiedMessage(message));
                        state.pendingFiles = state.pendingFiles.filter(function (pending) { return pending !== file; });
                        if (index === 0) input.value = '';
                        renderPendingFiles();
                    }
                } else {
                    const saved = await D.Inbox.sendMessage({ threadId: row.id, body: body });
                    const message = Array.isArray(saved) ? saved[0] : saved;
                    if (message) addMessage(adaptUnifiedMessage(message));
                    input.value = '';
                }
            } else if (row.source === 'quote') {
                // INB-04: se usa la fila guardada (id real) para que el eco
                // realtime del mismo INSERT no la pinte dos veces.
                if (files.length) {
                    for (let index = 0; index < files.length; index += 1) {
                        const file = files[index];
                        const attachment = await D.Chat.uploadAttachment(row.id, state.userId, file);
                        const saved = await D.Chat.sendMessage({
                            quoteId: row.id, senderType: 'artist', senderId: state.userId,
                            message: index === 0 ? body : '', attachment: attachment,
                        });
                        const message = Array.isArray(saved) ? saved[0] : saved;
                        if (message) addMessage(adaptQuoteMessage(message));
                        state.pendingFiles = state.pendingFiles.filter(function (pending) { return pending !== file; });
                        if (index === 0) input.value = '';
                        renderPendingFiles();
                    }
                } else {
                    const saved = await D.Chat.sendMessage({ quoteId: row.id, senderType: 'artist', senderId: state.userId, message: body });
                    const message = Array.isArray(saved) ? saved[0] : saved;
                    addMessage(adaptQuoteMessage(message && message.id ? message : {
                        id: 'local-' + Date.now(), sender_type: 'artist', message: body, created_at: new Date().toISOString(),
                    }));
                    input.value = '';
                }
                if (row.synthetic) {
                    // El primer mensaje convierte el hilo sintético en real.
                    row.synthetic = false;
                    row.raw.synthetic = false;
                }
            } else if (row.starter) {
                input.value = '';
                const ok = await startSupportConversation(body);
                if (!ok) input.value = body;
                return;
            } else {
                await D.SupportInbox.sendMessage({ conversationId: row.id, content: body, pageContext: 'artist_inbox' });
                input.value = '';
                // El servidor guarda el mensaje y la respuesta del bot: se
                // recarga el historial real (sin ids locales que dupliquen el eco).
                const messages = await D.SupportInbox.listMessages(row.id);
                if (state.activeKey === row.key) {
                    state.activeMessages = [];
                    messages.map(adaptSupportMessage).forEach(addMessage);
                }
            }
            input.value = '';
            clearPendingFiles();
            renderMessages();
            scheduleRefresh();
        } catch (error) {
            console.error('[artist-inbox] enviar', error);
            renderPendingFiles();
            renderMessages();
            // Si la base rechazó el envío porque la conversación se cerró (el
            // cliente rechazó la cotización), el refresco la pasa a solo lectura.
            scheduleRefresh();
            notify(files.length ? 'No pudimos enviar todos los adjuntos. Los pendientes siguen aquí para reintentar.' : 'No pudimos enviar el mensaje. Tu texto sigue aquí para reintentar.', 'error');
        } finally {
            state.sending = false;
            restoreComposerTools(findRow(state.activeKey) || row);
            syncSendState();
            if (!input.disabled) input.focus();
        }
    }

    function subscribeList() {
        if (D.Inbox && D.Inbox.subscribeList) {
            state.listChannel = D.Inbox.subscribeList(state.userId, scheduleRefresh);
        }
        // INB-05: mensajes nuevos de clientes en chats de cotización (la RLS
        // artists_select_chat acota a las cotizaciones del artista). Actualiza
        // lista, contadores y "Esperando respuesta" en tiempo real.
        if (D.Realtime && D.Realtime.subscribeNewChatFromSender) {
            state.chatChannel = D.Realtime.subscribeNewChatFromSender('artist-inbox-chat-' + state.userId, 'client', scheduleRefresh);
        }
        // Ronda 2: cambios de estado de las cotizaciones del artista (RLS). Si
        // el cliente rechaza la cotización, el hilo abierto pasa a solo lectura.
        // Solo llega si quotations_db está en la publicación de realtime; si
        // no, el cierre se detecta al abrir el hilo, al volver a la pestaña o
        // cuando la base rechaza un envío.
        if (D.Realtime && D.Realtime.subscribeQuotationUpdates) {
            state.quoteChannel = D.Realtime.subscribeQuotationUpdates('artist-inbox-quotes-' + state.userId, function (payload) {
                const quote = payload && payload.new;
                if (quote && quote.quote_id) delete state.quoteDetails[quote.quote_id];
                scheduleRefresh();
            });
        }
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
        if (state.chatChannel) {
            if (D.Realtime && D.Realtime.remove) D.Realtime.remove(state.chatChannel);
            else if (D.removeChannel) D.removeChannel(state.chatChannel);
            state.chatChannel = null;
        }
        if (state.quoteChannel) {
            if (D.Realtime && D.Realtime.remove) D.Realtime.remove(state.quoteChannel);
            else if (D.removeChannel) D.removeChannel(state.quoteChannel);
            state.quoteChannel = null;
        }
    }

    // Enlaces profundos desde otras áreas (ver resolveDeepLink):
    //   ?thread=<inbox_thread_id | key | context_id>
    //   ?quote=<quote_id>                      (detalle de cotización)
    //   ?opportunity=jobboard|spot&application=<id>[&quote=<quote_id>] (postulaciones)
    //   ?trip=<trip_id>                         (viaje)
    //   ?filter=<categoría>                     (abre el inbox filtrado)
    async function openFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const resolver = window.ArtistInboxDeepLink;
        let target = resolver ? resolver.resolveDeepLink(state.rows, params) : null;
        if (!target) return;
        // INB-06: "Contactar cliente" / "Ver chat completo" de una cotización
        // sin mensajes todavía. La vista no la trae: se arma el hilo con la
        // cotización (RLS del artista) y se abre para escribir el primero.
        const quoteId = (params.get('quote') || '').trim();
        if (!target.key && quoteId) {
            const key = await ensureQuoteThread(quoteId);
            if (key) target = { key: key, filter: null };
        }
        if (target.filter && target.filter !== state.filter) selectFilter(target.filter);
        if (!target.key) return;
        revealActiveRow(target.key);
        await openThread(target.key);
        revealActiveRow(target.key);
    }

    async function ensureQuoteThread(quoteId) {
        const quote = await loadQuoteDetails(quoteId);
        if (!quote || quote.artist_id !== state.userId) {
            notify('No encontramos esa cotización en tu cuenta.', 'error');
            return null;
        }
        if (!quote.client_user_id) {
            // Sin cuenta del cliente no hay chat: se vincula cuando inicia sesión.
            notify('El chat se habilita cuando el cliente crea su cuenta en We Ötzi.', 'info');
            return null;
        }
        const synthetic = M ? M.syntheticQuoteThread(quote) : null;
        if (!synthetic) return null;
        if (!state.syntheticQuotes.some(function (item) { return item.quote_id === quoteId; })) {
            state.syntheticQuotes.push(synthetic);
        }
        state.rows = buildRows();
        renderSidebarCounts();
        renderList();
        return 'quote:' + quoteId;
    }

    // Enlace profundo: la fila seleccionada queda visible dentro de la lista
    // (Figma 801:1085 la muestra resaltada en la columna de conversaciones).
    function revealActiveRow(key) {
        const list = el('ai-list');
        if (!list) return;
        const row = [...list.querySelectorAll('.ai-row')].find(function (node) { return node.dataset.rowKey === key; });
        if (!row) return;
        if (list.scrollHeight > list.clientHeight + 1) {
            const listRect = list.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) {
                list.scrollTop += rowRect.top - listRect.top - Math.max(0, (list.clientHeight - row.offsetHeight) / 2);
            }
        } else if (typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    function selectFilter(filter) {
        const button = document.querySelector('[data-filter="' + filter + '"]');
        state.filter = filter;
        document.querySelectorAll('[data-filter]').forEach(function (item) {
            const selected = item === button;
            item.classList.toggle('is-active', selected);
            item.setAttribute('aria-pressed', String(selected));
        });
        renderList();
    }

    function renderFatal(message) {
        const host = el('ai-list');
        if (!host) return;
        host.innerHTML = '<div class="wo-empty ai-list-empty"><i data-wo-icon="alert-circle" aria-hidden="true"></i><span class="wo-empty-title">Inbox no disponible</span><p>' + esc(message) + '</p><button class="wo-btn wo-btn--s" type="button" onclick="window.location.reload()">Reintentar</button></div>';
        refreshIcons();
    }

    function notify(message, tone) {
        if (window.WoNeutralEs) message = window.WoNeutralEs.neutralize(message); // la base todavía puede responder en voseo
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

    // URLs absolutas y rutas internas de la app (p. ej. "Portfolio: /artist/profile?…")
    // se muestran como enlaces. El texto se escapa antes de armar cada <a>.
    const LINK_PATTERN = /(https?:\/\/[^\s<>"']+|\/(?:artist|studio|travel|my-quotations|job-board|studio-spots)\/?[^\s<>"']*)/g;

    function linkify(value) {
        const text = String(value || '');
        let html = '';
        let last = 0;
        text.replace(LINK_PATTERN, function (match, url, offset) {
            const clean = match.replace(/[.,;:!?)]+$/, '');
            html += nl2br(text.slice(last, offset));
            const external = /^https?:/i.test(clean);
            const href = external ? clean : appHref(clean);
            html += '<a class="ai-msg-link" href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(clean) + '</a>';
            last = offset + clean.length;
            return match;
        });
        return html + nl2br(text.slice(last));
    }

    // Iniciales solo con letras: "Gòtic 13" → "GÒ", "Valentina · Preview" → "VP".
    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/)
            .map(function (part) { return part.replace(/[^\p{L}]/gu, ''); })
            .filter(Boolean);
        if (!parts.length) return '—';
        if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('es');
        return (parts[0][0] + parts[1][0]).toLocaleUpperCase('es');
    }

    function cleanInitials(value) {
        const text = String(value || '').trim();
        return /^\p{L}{1,3}$/u.test(text) ? text.toLocaleUpperCase('es') : '';
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
        if (date.toDateString() === yesterday.toDateString()) return 'ayer';
        // Figma 801:1085: "lun", "vie", "dom" dentro de la última semana.
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const days = Math.round((startOfToday - startOfDate) / 86400000);
        if (days > 0 && days < 7) return WEEKDAYS_SHORT[date.getDay()];
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '').toLowerCase();
    }

    const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

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

    // Figma 801:1085: "1 – 15 de septiembre". Distinto mes: "28 de agosto – 3 de
    // septiembre"; distinto año agrega el año a cada extremo.
    const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];

    function parseDay(value) {
        if (!value) return null;
        const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
        const date = match
            ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
            : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateRange(start, end) {
        const a = parseDay(start);
        const b = parseDay(end);
        if (!a && !b) return '';
        const one = a || b;
        if (!a || !b) return one.getDate() + ' de ' + MONTHS_LONG[one.getMonth()];
        if (a.getFullYear() !== b.getFullYear()) {
            return a.getDate() + ' de ' + MONTHS_LONG[a.getMonth()] + ' de ' + a.getFullYear() + ' – ' +
                b.getDate() + ' de ' + MONTHS_LONG[b.getMonth()] + ' de ' + b.getFullYear();
        }
        if (a.getMonth() !== b.getMonth()) {
            return a.getDate() + ' de ' + MONTHS_LONG[a.getMonth()] + ' – ' + b.getDate() + ' de ' + MONTHS_LONG[b.getMonth()];
        }
        return a.getDate() + ' – ' + b.getDate() + ' de ' + MONTHS_LONG[a.getMonth()];
    }

    // Contextos heredados guardan "YYYY-MM-DD → YYYY-MM-DD" como texto libre.
    function formatLooseDates(value) {
        if (!value) return '';
        const parts = String(value).match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
        return parts ? formatDateRange(parts[1], parts[2]) : String(value);
    }

    function humanStatus(value) {
        const labels = {
            accepted: 'Aceptada', shortlisted: 'Preseleccionada', pending: 'Pendiente',
            pending_acceptance: 'Esperando tu respuesta', completed: 'Completada',
            client_rejected: 'Rechazada', expired: 'Vencida', open: 'Activa', closed: 'Cerrada',
            esperando_confirmacion: 'Esperando confirmación', confirmada: 'Confirmada',
            rechazada: 'Rechazada', cancelada: 'Cancelada', active: 'Activa',
            client_approved: 'Acuerdo aprobado', responded: 'Respuesta enviada', in_progress: 'En progreso',
            artist_completed: 'Lista para cliente', cancelled: 'Cancelada', viewed: 'Vista', rejected: 'Rechazada',
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
