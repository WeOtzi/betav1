// ============================================
// /client/chats — Inbox del cliente (DS Bauhaus)
// Refs Figma: 286:11109 (estado vacío) · 333:1540 / 801:1149 (conversación).
//
// Fuentes de conversaciones:
//   · Chats de cotización: WeotziData.Chat (vista chat_threads + chat_messages)
//     + cotizaciones activas sin mensajes (hilo "sintético" para iniciar).
//   · Inbox unificado: WeotziData.Inbox.listClientThreads (p. ej. Job Board),
//     enviar con send_inbox_message (INB-08).
// Reservas: WeotziData.Sessions.listForClient (RPC con columnas seguras).
// Tiempo real: hilo abierto (chat_messages / inbox_messages) + badges de la
// lista (mensajes del artista e inbox_thread_participants).
// Adjuntos: chat-attachments (cotizaciones) e inbox-attachments (inbox).
// Todo texto de usuario se pinta con textContent (sin innerHTML con datos).
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;
    const D = window.WeotziData || {};
    const M = window.WeotziInboxChat;

    const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const DAY_FMT = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });
    const TIME_FMT = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
    const FILE_ACCEPT = IMAGE_ACCEPT + ',application/pdf,text/plain';

    // Estado de la cotización → etiqueta y variante de tag (banner del proyecto).
    const STATUS_TAGS = {
        pending:          { label: 'Esperando cotización', cls: 'wo-tag--soft' },
        responded:        { label: 'Esperando tu respuesta', cls: 'wo-tag--highlight' },
        // Mismas etiquetas que el panel del cliente (client-quote-proposal.js · CC-13).
        client_approved:  { label: 'Aceptada',             cls: 'wo-tag--active' },
        in_progress:      { label: 'En curso',             cls: 'wo-tag--info' },
        en_progreso:      { label: 'En curso',             cls: 'wo-tag--info' },
        artist_completed: { label: 'Por confirmar',        cls: 'wo-tag--info' },
        completed:        { label: 'Completada',           cls: 'wo-tag--active' },
        client_rejected:  { label: 'Rechazada',            cls: 'wo-tag--archived' },
        cancelled:        { label: 'Cancelada',            cls: 'wo-tag--archived' },
        expired:          { label: 'Vencida',              cls: 'wo-tag--archived' },
    };
    const APPLICATION_TAGS = {
        pending:     { label: 'Propuesta recibida', cls: 'wo-tag--highlight' },
        shortlisted: { label: 'Preseleccionada',    cls: 'wo-tag--info' },
        accepted:    { label: 'Propuesta aceptada', cls: 'wo-tag--active' },
        rejected:    { label: 'No elegida',         cls: 'wo-tag--archived' },
        withdrawn:   { label: 'Retirada',           cls: 'wo-tag--archived' },
    };
    const INBOX_CATEGORY_LABELS = { job_board: 'Job Board', clients: 'Artista', quotations: 'Cotización' };

    let uid = null;
    let userEmail = '';
    let rows = [];               // conversaciones normalizadas (cotización + inbox)
    let chatThreads = [];        // filas de chat_threads
    let inboxThreads = [];       // filas de list_client_inbox_threads
    let quotes = [];             // cotizaciones propias (iniciar conversación / tarjeta)
    let deepLinkQuotes = [];     // cotizaciones abiertas por ?quote= sin conversación todavía
    let artistsById = {};        // user_id → fila de artists_db (afiliación/ciudad)
    let sessionsByQid = {};      // quotation_id_int → próxima sesión futura
    let referencesByQuote = {};  // quote_id → referencias (quotations_attachments)
    let currentKey = null;
    let activeTab = 'todos';
    let searchTerm = '';
    let threadChannel = null;
    let badgeChannel = null;
    let listChannel = null;
    let messages = [];           // timeline del hilo abierto (dedupe por id)
    let pendingFiles = [];
    let sending = false;
    let openSeq = 0;
    let refreshTimer = null;
    const signedUrls = new Map();

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireStaticEvents();

        let session = null;
        try {
            const { data } = await _supabase.auth.getSession();
            session = data?.session || null;
        } catch (err) {
            console.warn('[chats] no pudimos leer la sesión:', err);
        }
        if (!session) {
            window.location.href = appHref('/client/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search));
            return;
        }
        uid = session.user.id;
        userEmail = session.user.email || '';

        await loadAll({ initial: true });
        subscribeBadges();
    }

    // ============================================
    // CARGA
    // ============================================

    async function fetchSources() {
        const results = await Promise.allSettled([
            D.Chat.listThreadsForClient(uid),
            D.Inbox && D.Inbox.listClientThreads ? D.Inbox.listClientThreads() : Promise.resolve([]),
            D.Quotations && D.Quotations.listForClient
                ? D.Quotations.listForClient(uid, userEmail, D.Quotations.CHAT_COLUMNS || '*')
                : Promise.resolve([]),
        ]);
        const value = (r, fallback) => {
            if (r.status === 'fulfilled') return r.value || fallback;
            console.warn('[chats] fuente no disponible:', r.reason);
            return fallback;
        };
        chatThreads = value(results[0], []);
        inboxThreads = value(results[1], []);
        quotes = value(results[2], []).filter(q => q.client_user_id === uid);
        rows = buildRows();
    }

    async function loadAll({ initial = false } = {}) {
        await fetchSources();
        $('cch-loading').classList.add('wo-hidden');
        showShell(rows.length > 0);
        if (!rows.length) {
            // Deep link a una cotización propia sin conversación: igual se abre.
            await openFromQuery();
            return;
        }
        renderList();

        // Enriquecimientos en paralelo (repintan la lista al llegar).
        enrichArtists();
        loadSessions();

        if (await openFromQuery()) return;
        // En desktop se abre el hilo más reciente; en mobile queda la lista.
        if (initial && window.matchMedia('(min-width: 769px)').matches) {
            const first = rows.find(r => !r.synthetic) || rows[0];
            if (first) openThread(first.key);
        }
    }

    function showShell(hasRows) {
        $('cch-empty').classList.toggle('wo-hidden', hasRows);
        $('cch-shell').classList.toggle('wo-hidden', !hasRows);
    }

    function buildRows() {
        const quoteById = {};
        quotes.forEach(q => { quoteById[q.quote_id] = q; });
        const quoteRows = chatThreads.map(t => quoteRow(Object.assign({}, quoteById[t.quote_id] || {}, t)));
        const startable = M ? M.startableQuotes(quotes, chatThreads) : [];
        // Un hilo abierto por enlace profundo (aunque su estado no esté entre
        // los "para iniciar") sobrevive a los refrescos de la lista hasta que
        // la vista chat_threads trae el real.
        const withThread = new Set(chatThreads.map(t => t.quote_id));
        deepLinkQuotes = deepLinkQuotes.filter(q => !withThread.has(q.quote_id));
        const startableIds = new Set(startable.map(q => q.quote_id));
        startable.concat(deepLinkQuotes.filter(q => !startableIds.has(q.quote_id))).forEach(q => {
            const synthetic = M.syntheticQuoteThread(q);
            if (synthetic) quoteRows.push(quoteRow(Object.assign({}, q, synthetic)));
        });
        const inboxRows = inboxThreads.filter(t => !t.is_archived).map(inboxRow);
        const all = quoteRows.concat(inboxRows);
        all.forEach(r => { if (r.key === currentKey) r.unread = 0; });
        return all.sort((a, b) => {
            if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
            return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });
    }

    function quoteRow(t) {
        const name = t.artist_name || t.artist_username || 'Artista';
        return {
            key: 'quote:' + t.quote_id,
            source: 'quote',
            id: t.quote_id,
            synthetic: Boolean(t.synthetic),
            name,
            username: t.artist_username || '',
            artistId: t.artist_id || null,
            preview: t.last_message || (t.synthetic ? 'Todavía no hay mensajes · Escribí el primero' : ''),
            lastAt: t.last_message_at,
            lastFromArtist: t.last_message_sender === 'artist',
            unread: Number(t.unread_for_client) || 0,
            closed: false,
            quote: t,
        };
    }

    function inboxRow(t) {
        return {
            key: 'inbox:' + t.id,
            source: 'inbox',
            id: t.id,
            synthetic: false,
            name: t.artist_name || 'Artista',
            username: t.artist_username || '',
            artistId: t.artist_user_id || null,
            preview: t.last_message || t.subject || '',
            lastAt: t.last_message_at,
            lastFromArtist: Boolean(t.last_sender_user_id && t.last_sender_user_id !== uid),
            unread: Number(t.unread_count) || 0,
            closed: t.status === 'closed',
            category: t.category,
            inbox: t,
        };
    }

    // Refresco liviano de la lista (mensaje nuevo en otro hilo, hilo nuevo).
    function scheduleRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            try {
                await fetchSources();
                if (rows.length) showShell(true);
                renderList();
                enrichArtists();
                loadSessions();
                const row = findRow(currentKey);
                if (row) { paintHead(row); paintBanner(row); }
            } catch (err) {
                console.warn('[chats] refresco de hilos falló:', err);
            }
        }, 400);
    }

    async function enrichArtists() {
        const ids = [...new Set(rows.map(r => r.artistId).filter(Boolean))].filter(id => !artistsById[id]);
        if (!ids.length || !D.Artists || !D.Artists.listByUserIds) return;
        try {
            const { data } = await D.Artists.listByUserIds(ids, 'user_id, username, name, estudios, city, ubicacion, work_type');
            (data || []).forEach(a => { artistsById[a.user_id] = a; });
            renderList();
            const row = findRow(currentKey);
            if (row) paintHead(row);
        } catch (err) {
            console.warn('[chats] no pudimos enriquecer artistas:', err);
        }
    }

    // Reservas: hilos cuya cotización tiene una sesión futura no cancelada.
    // INB-10: RPC list_client_quotation_sessions (la tabla es solo del artista).
    async function loadSessions() {
        const qids = [...new Set(rows.filter(r => r.source === 'quote').map(r => r.quote.quotation_id_int).filter(id => id != null))];
        if (!qids.length) return;
        try {
            const list = D.Sessions.listForClient ? await D.Sessions.listForClient(qids) : [];
            const now = Date.now();
            sessionsByQid = {};
            (list || []).forEach(s => {
                if (!s.session_date) return;
                const when = new Date(s.session_date).getTime();
                const status = String(s.status || '').toLowerCase();
                if (when < now || ['cancelled', 'canceled', 'cancelada'].includes(status)) return;
                const cur = sessionsByQid[s.quotation_id];
                if (!cur || new Date(s.session_date) < new Date(cur.session_date)) sessionsByQid[s.quotation_id] = s;
            });
        } catch (err) {
            console.warn('[chats] no pudimos leer sesiones:', err);
            sessionsByQid = {};
        }
        renderList();
        const row = findRow(currentKey);
        if (row) paintBanner(row);
    }

    // ============================================
    // LISTA
    // ============================================

    function findRow(key) {
        return rows.find(r => r.key === key) || null;
    }

    function hasReservation(r) {
        return r.source === 'quote' && r.quote.quotation_id_int != null && !!sessionsByQid[r.quote.quotation_id_int];
    }

    function affiliationOf(r) {
        const a = artistsById[r.artistId];
        if (r.source === 'inbox') return (INBOX_CATEGORY_LABELS[r.category] || 'Mensaje') + (a && a.estudios ? ' · ' + a.estudios.trim() : '');
        if (a) return (a.estudios || '').trim() || 'Artista independiente';
        return r.username ? '@' + r.username : '';
    }

    function filteredRows() {
        let list = rows;
        if (activeTab === 'sin-leer') list = list.filter(r => r.unread > 0);
        else if (activeTab === 'reservas') list = list.filter(hasReservation);
        else if (activeTab === 'cotizaciones') list = list.filter(r => r.source === 'quote' && !hasReservation(r));
        if (searchTerm) {
            const q = searchTerm.toLocaleLowerCase('es');
            list = list.filter(r => [r.name, r.username, affiliationOf(r), r.preview]
                .filter(Boolean).join(' ').toLocaleLowerCase('es').includes(q));
        }
        return list;
    }

    function renderList() {
        const rowsEl = $('cch-rows');
        const emptyEl = $('cch-list-empty');
        if (!rowsEl) return;
        const list = filteredRows();
        rowsEl.textContent = '';

        if (!list.length) {
            emptyEl.classList.remove('wo-hidden');
            const copy = $('cch-list-empty-copy');
            if (copy) {
                if (searchTerm) copy.textContent = 'No encontramos conversaciones para tu búsqueda.';
                else if (activeTab === 'sin-leer') copy.textContent = 'No tenés mensajes sin leer.';
                else if (activeTab === 'reservas') copy.textContent = 'Todavía no tenés reservas con sesión programada.';
                else if (activeTab === 'cotizaciones') copy.textContent = 'No hay conversaciones de cotizaciones.';
                else copy.textContent = 'No hay conversaciones que coincidan con este filtro.';
            }
            return;
        }
        emptyEl.classList.add('wo-hidden');

        const frag = document.createDocumentFragment();
        list.forEach(r => frag.appendChild(rowEl(r)));
        rowsEl.appendChild(frag);
    }

    function rowEl(r) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cch-row' + (r.key === currentKey ? ' is-active' : '') + (r.unread > 0 ? ' is-unread' : '') + (r.synthetic ? ' is-new' : '');
        button.dataset.key = r.key;
        if (r.key === currentKey) button.setAttribute('aria-current', 'true');

        const avatar = el('span', 'cch-avatar', initialsOf(r));
        avatar.setAttribute('aria-hidden', 'true');
        const main = el('span', 'cch-row-main');
        const top = el('span', 'cch-row-top');
        top.appendChild(el('span', 'cch-row-name', r.name));
        top.appendChild(el('span', 'cch-row-time', r.synthetic ? '' : relTime(r.lastAt)));
        main.appendChild(top);
        main.appendChild(el('span', 'cch-row-aff', affiliationOf(r)));
        const bottom = el('span', 'cch-row-bottom');
        bottom.appendChild(el('span', 'cch-row-preview', r.preview || ''));
        if (r.unread > 0) {
            const badge = el('span', 'cch-unread', r.unread > 99 ? '99+' : String(r.unread));
            badge.setAttribute('aria-label', r.unread + (r.unread === 1 ? ' mensaje sin leer' : ' mensajes sin leer'));
            bottom.appendChild(badge);
        } else if (r.synthetic) {
            bottom.appendChild(el('span', 'cch-row-start', 'Iniciar'));
        }
        main.appendChild(bottom);
        button.appendChild(avatar);
        button.appendChild(main);
        return button;
    }

    function initialsOf(r) {
        return M ? M.initials(r.name) : String(r.name || '·').slice(0, 2).toUpperCase();
    }

    // ============================================
    // HILO ABIERTO
    // ============================================

    async function openThread(key) {
        const row = findRow(key);
        if (!row) return;
        const seq = ++openSeq;
        currentKey = key;
        messages = [];
        clearPendingFiles();
        removeThreadChannel();
        updateUrl(row);

        $('cch-shell').classList.add('is-thread-open');
        $('cch-thread-placeholder').classList.add('wo-hidden');
        $('cch-thread-body').classList.remove('wo-hidden');
        $('cch-composer-error').classList.add('wo-hidden');

        paintHead(row);
        paintBanner(row);
        setComposerEnabled(!row.closed);
        renderList();

        const messagesEl = $('cch-messages');
        messagesEl.textContent = '';
        messagesEl.appendChild(el('div', 'cch-messages-empty', 'Cargando mensajes…'));

        let list = [];
        try {
            if (row.source === 'quote') {
                list = row.synthetic ? [] : (await D.Chat.listByQuote(row.id)).map(adaptQuoteMessage);
                loadReferences(row);
            } else {
                list = (await D.Inbox.listMessages(row.id)).map(adaptInboxMessage);
            }
        } catch (err) {
            console.error('[chats] error cargando mensajes:', err);
            if (seq === openSeq) {
                messagesEl.textContent = '';
                messagesEl.appendChild(el('div', 'cch-messages-empty', 'No pudimos cargar los mensajes. Recargá la página.'));
            }
            return;
        }
        if (seq !== openSeq) return;

        messages = [];
        list.forEach(addMessage);
        renderMessages();
        subscribeThread(row);

        // Marcar leídos los mensajes del artista y apagar el badge.
        if (row.unread > 0) {
            row.unread = 0;
            if (row.quote) row.quote.unread_for_client = 0;
            if (row.inbox) row.inbox.unread_count = 0;
            renderList();
        }
        markRead(row);
        if (window.matchMedia('(min-width: 769px)').matches) $('cch-input').focus();
    }

    function markRead(row) {
        if (row.synthetic) return;
        const job = row.source === 'quote' ? D.Chat.markRead(row.id, 'artist') : D.Inbox.markRead(row.id);
        Promise.resolve(job).catch(() => {});
    }

    function updateUrl(row) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('quote');
            url.searchParams.delete('thread');
            url.searchParams.set(row.source === 'quote' ? 'quote' : 'thread', row.id);
            window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch (_) { /* sin History API */ }
    }

    function paintHead(r) {
        $('cch-head-avatar').textContent = initialsOf(r);
        $('cch-head-name').textContent = r.name;

        const a = artistsById[r.artistId];
        const username = r.username || (a && a.username) || '';
        const parts = [];
        if (username) parts.push('@' + username);
        if (a) {
            parts.push((a.estudios || '').trim() || 'Artista independiente');
            const city = (a.city || a.ubicacion || '').trim();
            if (city) parts.push(city);
        }
        $('cch-head-sub').textContent = parts.join(' · ');

        const profile = $('cch-head-profile');
        if (username) {
            profile.href = appHref('/artist/profile?artist=' + encodeURIComponent(username));
            profile.classList.remove('wo-hidden');
        } else {
            profile.classList.add('wo-hidden');
        }
        toggleTurnTag(r.lastFromArtist && !r.synthetic);
    }

    function toggleTurnTag(show) {
        $('cch-head-turn').classList.toggle('wo-hidden', !show);
    }

    function paintBanner(r) {
        const eyebrow = $('cch-banner-eyebrow');
        const tag = $('cch-banner-status');
        if (r.source === 'inbox') {
            const t = r.inbox;
            const ctx = t.context || {};
            if (eyebrow) eyebrow.textContent = INBOX_CATEGORY_LABELS[t.category] || 'Conversación';
            $('cch-banner-title').textContent = t.subject || 'Conversación';
            const meta = [];
            if (ctx.request_code) meta.push(ctx.request_code);
            const min = M ? M.formatMoney(ctx.budget_min, ctx.currency) : '';
            const max = M ? M.formatMoney(ctx.budget_max, ctx.currency) : '';
            if (min && max) meta.push(min.replace(/\s\S+$/, '') + ' – ' + max);
            else if (min || max) meta.push(min || max);
            $('cch-banner-meta').textContent = meta.join(' · ');
            const info = APPLICATION_TAGS[ctx.application_status] || null;
            tag.className = 'wo-tag cch-tag-s ' + (info ? info.cls : 'wo-hidden');
            tag.textContent = info ? info.label : '';
            renderReferences([]);
            return;
        }

        const t = r.quote;
        if (eyebrow) eyebrow.textContent = 'Proyecto de tatuaje';
        $('cch-banner-title').textContent = M ? M.quoteTitle(t) : 'Proyecto de tatuaje';
        const style = styleNameOf(t);
        const part = String(t.tattoo_body_part || '').trim();
        const meta = [];
        if (part) meta.push(part);
        if (style) meta.push(style);
        if (t.tattoo_size) meta.push(String(t.tattoo_size).trim());
        const price = M ? M.formatMoney(t.final_budget_amount, t.final_budget_currency) : '';
        if (price) meta.push(price);
        const session = t.quotation_id_int != null ? sessionsByQid[t.quotation_id_int] : null;
        if (session) meta.push('próxima sesión ' + DAY_FMT.format(new Date(session.session_date)));
        $('cch-banner-meta').textContent = meta.join(' · ');

        const info = STATUS_TAGS[t.quote_status] || { label: 'En revisión', cls: 'wo-tag--soft' };
        tag.className = 'wo-tag cch-tag-s ' + info.cls;
        tag.textContent = info.label;

        // cot-cliente: la propuesta se ve y se responde en el panel del cliente.
        const link = $('cch-banner-link');
        if (link) {
            link.href = '/client/dashboard?quote=' + encodeURIComponent(t.quote_id || '');
            link.textContent = t.quote_status === 'responded' ? 'Ver propuesta →' : 'Ver cotización →';
        }
        renderReferences(referencesByQuote[r.id] || []);
    }

    function styleNameOf(t) {
        const s = t.tattoo_style;
        if (s && typeof s === 'object') return String(s.style_name || '').trim();
        return String(s || '').trim();
    }

    // Referencias que el cliente subió con la cotización (Figma 801:1149:
    // "Referencia 1/2/3"). Miniatura de Drive; abre el original.
    async function loadReferences(row) {
        if (referencesByQuote[row.id] || !D.Attachments || !D.Attachments.listByQuoteIds) return;
        try {
            const list = await D.Attachments.listByQuoteIds([row.id]);
            referencesByQuote[row.id] = (list || []).filter(a => /^https?:\/\//i.test(String(a.google_drive_url || '')))
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            if (currentKey === row.key) renderReferences(referencesByQuote[row.id]);
        } catch (err) {
            console.warn('[chats] referencias:', err);
            referencesByQuote[row.id] = [];
        }
    }

    function renderReferences(list) {
        const host = $('cch-banner-refs');
        if (!host) return;
        host.textContent = '';
        // N11 (ronda 2 · cot-form): el cliente puede mandar hasta 4 referencias; se muestran todas.
        const refs = (list || []).slice(0, 4);
        host.classList.toggle('wo-hidden', !refs.length);
        refs.forEach((ref, index) => {
            const link = document.createElement('a');
            link.className = 'cch-ref';
            link.href = ref.google_drive_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const label = 'Referencia ' + (index + 1);
            link.setAttribute('aria-label', 'Abrir ' + label + (ref.file_name ? ' (' + ref.file_name + ')' : ''));
            const thumb = M ? M.referenceThumb(ref.google_drive_url) : '';
            if (thumb) {
                const img = document.createElement('img');
                img.src = thumb;
                img.alt = '';
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.addEventListener('error', () => { img.remove(); link.classList.add('is-empty'); });
                link.appendChild(img);
            } else {
                link.classList.add('is-empty');
            }
            link.appendChild(el('span', 'cch-ref-label', label));
            host.appendChild(link);
        });
    }

    // ============================================
    // TIMELINE
    // ============================================

    function adaptQuoteMessage(m) {
        return {
            id: m.id,
            mine: m.sender_type === 'client',
            body: m.message || '',
            at: m.created_at,
            attachment: m.attachment_path ? {
                source: 'chat', path: m.attachment_path, name: m.attachment_name, mime: m.attachment_mime,
            } : null,
        };
    }

    function adaptInboxMessage(m) {
        const system = m.sender_role === 'system' || m.message_kind === 'system';
        return {
            id: m.id,
            mine: m.sender_user_id === uid,
            system,
            body: m.body || '',
            at: m.created_at,
            attachment: m.attachment_path ? {
                source: 'inbox', path: m.attachment_path, name: m.attachment_name, mime: m.attachment_mime,
            } : null,
        };
    }

    function addMessage(m) {
        if (!m) return false;
        if (M) return M.addUnique(messages, m);
        if (m.id != null && messages.some(x => x.id === m.id)) return false;
        messages.push(m);
        return true;
    }

    function timeline() {
        const items = messages.slice();
        const row = findRow(currentKey);
        if (row && row.source === 'quote' && M) {
            const card = M.quoteCard(row.quote);
            if (card) {
                items.push({ id: 'quote-card', card, at: card.at || (items[0] && items[0].at) || new Date().toISOString() });
                items.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
            }
        }
        return items;
    }

    function renderMessages() {
        const host = $('cch-messages');
        host.textContent = '';
        const items = timeline();
        if (!items.length) {
            const row = findRow(currentKey);
            host.appendChild(el('div', 'cch-messages-empty', row && row.synthetic
                ? 'Todavía no hay mensajes. Escribile al artista para empezar la conversación.'
                : 'Todavía no hay mensajes en esta conversación.'));
            return;
        }
        let lastDay = null;
        const frag = document.createDocumentFragment();
        items.forEach(item => {
            const when = item.at ? new Date(item.at) : new Date();
            const dayKey = when.getFullYear() + '-' + when.getMonth() + '-' + when.getDate();
            if (dayKey !== lastDay) {
                lastDay = dayKey;
                frag.appendChild(el('div', 'cch-day', dayLabel(when)));
            }
            frag.appendChild(item.card ? quoteCardEl(item.card) : messageEl(item));
        });
        host.appendChild(frag);
        host.scrollTop = host.scrollHeight;
        hydrateThumbs(host);
    }

    function messageEl(m) {
        if (m.system) return el('div', 'cch-system', m.body);
        const wrap = el('div', 'cch-msg-wrap ' + (m.mine ? 'cch-msg-wrap--out' : 'cch-msg-wrap--in'));
        if (m.attachment) wrap.appendChild(attachmentEl(m.attachment));
        if (m.body) wrap.appendChild(el('div', 'cch-msg ' + (m.mine ? 'cch-msg--out' : 'cch-msg--in'), m.body));
        const time = el('time', 'cch-msg-time', m.at ? TIME_FMT.format(new Date(m.at)) : '');
        if (m.at) time.dateTime = m.at;
        wrap.appendChild(time);
        return wrap;
    }

    function attachmentEl(a) {
        const isImage = String(a.mime || '').startsWith('image/');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cch-attachment' + (isImage ? ' is-image' : '');
        button.dataset.source = a.source;
        button.dataset.path = a.path;
        button.setAttribute('aria-label', 'Abrir ' + (a.name || 'adjunto'));
        if (isImage) button.appendChild(el('span', 'cch-attachment-thumb'));
        const icon = document.createElement('i');
        icon.setAttribute('data-wo-icon', isImage ? 'image' : 'paperclip');
        icon.setAttribute('aria-hidden', 'true');
        icon.className = 'wo-icon-18';
        button.appendChild(icon);
        button.appendChild(el('span', 'cch-attachment-name', a.name || 'Adjunto'));
        return button;
    }

    function quoteCardEl(card) {
        const article = el('article', 'cch-quote-card');
        article.setAttribute('aria-label', 'Cotización del artista');
        article.appendChild(el('p', 'cch-quote-eyebrow', 'Cotización'));
        article.appendChild(el('h3', 'cch-quote-title', card.title));
        article.appendChild(el('p', 'cch-quote-price', card.price));
        if (card.duration) article.appendChild(el('p', 'cch-quote-meta', 'Duración estimada: ' + card.duration));
        const link = el('a', 'cch-quote-link', 'Ver cotización →');
        link.href = appHref('/client/dashboard?quote=' + encodeURIComponent(card.quoteId || ''));
        article.appendChild(link);
        return article;
    }

    function signedUrl(source, path) {
        const key = source + ':' + path;
        const cached = signedUrls.get(key);
        if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.promise;
        const repo = source === 'chat' ? D.Chat : D.Inbox;
        const promise = repo && repo.signedAttachmentUrl
            ? repo.signedAttachmentUrl(path).catch(err => { signedUrls.delete(key); throw err; })
            : Promise.resolve(null);
        signedUrls.set(key, { promise, at: Date.now() });
        return promise;
    }

    function hydrateThumbs(host) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(host);
        host.querySelectorAll('.cch-attachment.is-image').forEach(button => {
            const thumb = button.querySelector('.cch-attachment-thumb');
            if (!thumb || thumb.dataset.loaded) return;
            thumb.dataset.loaded = '1';
            signedUrl(button.dataset.source, button.dataset.path).then(url => {
                if (!url || !/^https:\/\//i.test(url)) return;
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                img.src = url;
                thumb.appendChild(img);
                button.classList.add('has-thumb');
            }).catch(() => { /* queda el ícono */ });
        });
    }

    async function openAttachment(button) {
        const popup = window.open('', '_blank');
        try {
            const url = await signedUrl(button.dataset.source, button.dataset.path);
            if (!url) throw new Error('sin URL');
            if (popup) { popup.opener = null; popup.location.href = url; }
            else window.location.assign(url);
        } catch (err) {
            if (popup) popup.close();
            console.error('[chats] adjunto:', err);
            showComposerError('No pudimos abrir el archivo.');
        }
    }

    // ============================================
    // ADJUNTOS PENDIENTES
    // ============================================

    function openPicker(accept) {
        const input = $('cch-file');
        if (!input || sending) return;
        input.accept = accept;
        input.value = '';
        input.click();
    }

    function onFilesChosen(event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        const invalid = files.map(f => (M ? M.validateAttachment(f) : { ok: true })).find(r => !r.ok);
        const valid = files.filter(f => (M ? M.validateAttachment(f).ok : true));
        if (invalid) showComposerError(invalid.error);
        else $('cch-composer-error').classList.add('wo-hidden');
        pendingFiles = pendingFiles.concat(valid).slice(0, 6);
        renderPending();
        syncSend();
    }

    function renderPending() {
        const host = $('cch-pending');
        host.textContent = '';
        host.classList.toggle('wo-hidden', !pendingFiles.length);
        pendingFiles.forEach((file, index) => {
            const chip = el('span', 'cch-pending-chip');
            chip.appendChild(el('span', 'cch-pending-name', file.name));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'cch-pending-remove';
            remove.dataset.index = String(index);
            remove.setAttribute('aria-label', 'Quitar ' + file.name);
            remove.textContent = '×';
            chip.appendChild(remove);
            host.appendChild(chip);
        });
    }

    function clearPendingFiles() {
        pendingFiles = [];
        if ($('cch-pending')) renderPending();
        syncSend();
    }

    // ============================================
    // ENVÍO
    // ============================================

    function setComposerEnabled(enabled) {
        $('cch-input').disabled = !enabled;
        $('cch-attach').disabled = !enabled;
        $('cch-reference').disabled = !enabled;
        $('cch-input').placeholder = enabled ? 'Escribí un mensaje…' : 'Esta conversación está cerrada.';
        syncSend();
    }

    function syncSend() {
        const row = findRow(currentKey);
        const hasContent = $('cch-input').value.trim() !== '' || pendingFiles.length > 0;
        $('cch-send').disabled = sending || !row || row.closed || !hasContent;
    }

    function showComposerError(text) {
        const box = $('cch-composer-error');
        box.textContent = text;
        box.classList.remove('wo-hidden');
    }

    async function handleSend(event) {
        event.preventDefault();
        const row = findRow(currentKey);
        const input = $('cch-input');
        const text = input.value.trim();
        const files = pendingFiles.slice();
        if (!row || row.closed || sending || (!text && !files.length)) return;

        sending = true;
        syncSend();
        $('cch-composer-error').classList.add('wo-hidden');
        try {
            if (row.source === 'quote') {
                // INB-04: se pinta la fila guardada (id real); el eco realtime
                // del mismo INSERT se descarta por id.
                if (files.length) {
                    for (let i = 0; i < files.length; i += 1) {
                        const attachment = await D.Chat.uploadAttachment(row.id, uid, files[i]);
                        const saved = await D.Chat.sendMessage({
                            quoteId: row.id, senderType: 'client', senderId: uid,
                            message: i === 0 ? text : '', attachment,
                        });
                        addMessage(adaptQuoteMessage(firstRow(saved)));
                        pendingFiles = pendingFiles.filter(f => f !== files[i]);
                        if (i === 0) input.value = '';
                        renderPending();
                    }
                } else {
                    const saved = await D.Chat.sendMessage({ quoteId: row.id, senderType: 'client', senderId: uid, message: text });
                    const m = firstRow(saved);
                    addMessage(m && m.id ? adaptQuoteMessage(m)
                        : { id: 'local-' + Date.now(), mine: true, body: text, at: new Date().toISOString(), attachment: null });
                    input.value = '';
                }
                touchRow(row, text || 'Archivo adjunto');
                if (row.synthetic) {
                    // El primer mensaje convierte la cotización en conversación.
                    row.synthetic = false;
                    row.quote.synthetic = false;
                    scheduleRefresh();
                }
            } else {
                if (files.length) {
                    for (let i = 0; i < files.length; i += 1) {
                        const attachment = await D.Inbox.uploadAttachment(row.id, uid, files[i]);
                        const saved = await D.Inbox.sendMessage({ threadId: row.id, body: i === 0 ? text : null, attachment });
                        addMessage(adaptInboxMessage(firstRow(saved)));
                        pendingFiles = pendingFiles.filter(f => f !== files[i]);
                        if (i === 0) input.value = '';
                        renderPending();
                    }
                } else {
                    const saved = await D.Inbox.sendMessage({ threadId: row.id, body: text });
                    addMessage(adaptInboxMessage(firstRow(saved)));
                    input.value = '';
                }
                touchRow(row, text || 'Archivo adjunto');
            }
            clearPendingFiles();
            renderMessages();
            toggleTurnTag(false);
        } catch (err) {
            console.error('[chats] error enviando mensaje:', err);
            renderMessages();
            showComposerError(files.length
                ? 'No pudimos enviar todos los adjuntos. Los pendientes siguen acá para reintentar.'
                : 'No pudimos enviar el mensaje. Probá de nuevo.');
        } finally {
            sending = false;
            syncSend();
            if (!input.disabled) input.focus();
        }
    }

    function firstRow(saved) {
        return M ? M.firstRow(saved) : (Array.isArray(saved) ? saved[0] : saved);
    }

    function touchRow(row, preview) {
        row.preview = preview;
        row.lastAt = new Date().toISOString();
        row.lastFromArtist = false;
        rows.sort((a, b) => {
            if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
            return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });
        renderList();
    }

    // ============================================
    // TIEMPO REAL
    // ============================================

    function removeThreadChannel() {
        if (!threadChannel) return;
        if (D.Realtime && D.Realtime.remove) D.Realtime.remove(threadChannel);
        else if (D.removeChannel) D.removeChannel(threadChannel);
        threadChannel = null;
    }

    function subscribeThread(row) {
        removeThreadChannel();
        if (row.source === 'quote') {
            threadChannel = D.Realtime.subscribeChatMessages('cch-thread-' + row.id, row.id, (payload) => {
                const m = payload && payload.new;
                if (!m || m.quotation_id !== row.id || currentKey !== row.key) return;
                onIncoming(row, adaptQuoteMessage(m), m.sender_type === 'artist', m.message);
            });
        } else if (D.Inbox && D.Inbox.subscribeThread) {
            threadChannel = D.Inbox.subscribeThread(row.id, (payload) => {
                const m = payload && payload.new;
                if (!m || currentKey !== row.key) return;
                onIncoming(row, adaptInboxMessage(m), m.sender_user_id !== uid, m.body);
            }, 'client-inbox-thread');
        }
    }

    function onIncoming(row, message, fromArtist, preview) {
        if (!addMessage(message)) return;
        renderMessages();
        if (fromArtist) {
            toggleTurnTag(true);
            markRead(row);
            row.lastFromArtist = true;
        }
        row.preview = preview || (message.attachment ? 'Archivo adjunto' : row.preview);
        row.lastAt = message.at;
        renderList();
    }

    function subscribeBadges() {
        // Mensajes del artista en chats de cotización (RLS clients_select_chat).
        badgeChannel = D.Realtime.subscribeNewChatFromSender('cch-badges-' + uid, 'artist', onBadgeInsert);
        // Inbox unificado: participantes / hilos del cliente.
        if (D.Inbox && D.Inbox.subscribeList) listChannel = D.Inbox.subscribeList(uid, scheduleRefresh, 'client-inbox-list');
        window.addEventListener('beforeunload', () => {
            removeThreadChannel();
            [badgeChannel, listChannel].forEach(ch => { if (ch && D.Realtime) D.Realtime.remove(ch); });
        });
    }

    function onBadgeInsert(payload) {
        const m = payload && payload.new;
        if (!m) return;
        const key = 'quote:' + m.quotation_id;
        if (key === currentKey) return; // lo maneja el canal del hilo
        const r = findRow(key);
        if (!r || r.synthetic) {
            scheduleRefresh(); // conversación nueva: refrescar la lista completa
            return;
        }
        r.preview = m.message || 'Archivo adjunto';
        r.lastAt = m.created_at;
        r.lastFromArtist = true;
        r.unread += 1;
        r.quote.unread_for_client = r.unread;
        rows.sort((a, b) => {
            if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
            return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });
        renderList();
    }

    // ============================================
    // ENLACES PROFUNDOS
    //   ?quote=<quote_id>   chat de una cotización (aunque no tenga mensajes)
    //   ?thread=<id>        hilo del inbox unificado
    // ============================================

    async function openFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const quoteId = (params.get('quote') || '').trim();
        const threadId = (params.get('thread') || '').trim();
        if (threadId && findRow('inbox:' + threadId)) {
            await openThread('inbox:' + threadId);
            return true;
        }
        if (!quoteId) return false;
        if (!findRow('quote:' + quoteId)) {
            let quote = quotes.find(q => q.quote_id === quoteId) || null;
            if (!quote && D.Quotations && D.Quotations.getForClientByQuoteId) {
                quote = await D.Quotations.getForClientByQuoteId(quoteId).catch(() => null);
            }
            if (!quote || quote.client_user_id !== uid || !M) return false;
            deepLinkQuotes.push(quote);
            rows = buildRows();
            if (!findRow('quote:' + quoteId)) return false;
            showShell(true);
            renderList();
            enrichArtists();
        }
        await openThread('quote:' + quoteId);
        return true;
    }

    // ============================================
    // EVENTOS ESTÁTICOS
    // ============================================

    function wireStaticEvents() {
        $('cch-rows').addEventListener('click', (e) => {
            const row = e.target.closest('.cch-row');
            if (row) openThread(row.dataset.key);
        });

        document.querySelectorAll('.cch-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activeTab = tab.getAttribute('data-tab');
                document.querySelectorAll('.cch-tab').forEach(b => {
                    const on = b === tab;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                renderList();
            });
        });

        $('cch-search-input').addEventListener('input', (e) => {
            searchTerm = e.target.value.trim();
            renderList();
        });

        $('cch-composer').addEventListener('submit', handleSend);
        $('cch-input').addEventListener('input', syncSend);
        $('cch-attach').addEventListener('click', () => openPicker(FILE_ACCEPT));
        $('cch-reference').addEventListener('click', () => openPicker(IMAGE_ACCEPT));
        $('cch-file').addEventListener('change', onFilesChosen);
        $('cch-pending').addEventListener('click', (e) => {
            const remove = e.target.closest('.cch-pending-remove');
            if (!remove) return;
            pendingFiles.splice(Number(remove.dataset.index), 1);
            renderPending();
            syncSend();
        });
        $('cch-messages').addEventListener('click', (e) => {
            const button = e.target.closest('.cch-attachment');
            if (button) openAttachment(button);
        });

        $('cch-back').addEventListener('click', () => {
            $('cch-shell').classList.remove('is-thread-open');
            const active = document.querySelector('.cch-row.is-active');
            if (active) active.focus();
        });

        $('cch-info-toggle').addEventListener('click', () => {
            const banner = $('cch-banner');
            const collapsed = banner.classList.toggle('is-collapsed');
            $('cch-info-toggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });

        $('cch-logout').addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[chats] logout:', err); }
            window.location.href = appHref('/client/login');
        });
    }

    // ============================================
    // FORMATO / DOM
    // ============================================

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function appHref(path) {
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : ((window.location.pathname || '').startsWith('/beta/') ? '/beta' : '');
        return base && !String(path).startsWith(base + '/') ? base + path : path;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function relTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const now = new Date();
        const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
        if (days <= 0) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (days === 1) return 'ayer';
        if (days < 7) return WEEKDAYS[d.getDay()];
        if (days < 35) {
            const w = Math.max(1, Math.round(days / 7));
            return w === 1 ? 'hace 1 semana' : `hace ${w} semanas`;
        }
        if (days < 365) {
            const mo = Math.max(1, Math.round(days / 30));
            return mo === 1 ? 'hace 1 mes' : `hace ${mo} meses`;
        }
        const y = Math.max(1, Math.round(days / 365));
        return y === 1 ? 'hace 1 año' : `hace ${y} años`;
    }

    function dayLabel(d) {
        const now = new Date();
        const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
        if (days <= 0) return 'hoy';
        if (days === 1) return 'ayer';
        return DAY_FMT.format(d);
    }
})();
