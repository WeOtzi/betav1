// ============================================
// Inbox del artista (DS Bauhaus) — ref Figma 144:1250
// 3 zonas + sidebar de filtros:
//   · Hilos de cotización: vista chat_threads + chat_messages via
//     WeotziData.Chat (Realtime de chat_messages activo).
//   · Hilo fijo "Soporte": support_conversations/support_messages via
//     WeotziData.SupportInbox (lectura RLS propia + envío por endpoint);
//     polling de 5s SOLO mientras el hilo de soporte está abierto.
// Filtros Spots/Invitaciones/Estudios/Viajes/Archivados/Favoritas: sin
// backend de inbox aún — atenuados "próximamente".
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const SUPPORT_ID = 'support';
    const SUPPORT_POLL_MS = 5000;

    // Vocabulario de estado de cotización (mismo del módulo de cotizaciones).
    const QUOTE_STATUS_VIEW = {
        pending:          { label: 'Pendiente',          tag: 'wo-tag--highlight' },
        responded:        { label: 'Respondida',         tag: 'wo-tag--info' },
        client_approved:  { label: 'Confirmada',         tag: 'wo-tag--active' },
        in_progress:      { label: 'En progreso',        tag: 'wo-tag--active' },
        artist_completed: { label: 'Lista para cliente', tag: 'wo-tag--active' },
        completed:        { label: 'Completada',         tag: 'wo-tag--active' },
        client_rejected:  { label: 'Rechazada',          tag: 'wo-tag--urgent' },
        expired:          { label: 'Vencida',            tag: 'wo-tag--archived' },
    };
    const CLOSED_QUOTE_STATUSES = ['completed', 'client_rejected', 'expired'];

    const SUPPORT_STATUS_VIEW = {
        bot:            { label: 'Asistente',        tag: 'wo-tag--info' },
        awaiting_human: { label: 'Esperando agente', tag: 'wo-tag--highlight' },
        human:          { label: 'Con agente',       tag: 'wo-tag--active' },
        closed:         { label: 'Cerrada',          tag: 'wo-tag--archived' },
    };

    let session = null;
    let uid = null;
    let threads = [];        // hilos de cotización (filas de chat_threads)
    let supportConv = null;  // conversación de soporte propia (o null)
    let supportMsgs = [];
    let filter = 'all';      // all | quotes | support
    let search = '';
    let activeId = null;     // quote_id (text) | 'support' | null
    let chatChannel = null;
    let badgeChannel = null;
    let supportPollTimer = null;
    let supportPollInFlight = false;
    let refreshTimer = null;
    let pendingEcho = [];    // dedupe del eco realtime de mensajes propios

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireStaticUI();
        const ok = await resolveSession();
        if (!ok) return;
        await Promise.all([loadThreads(), loadSupport()]);
        renderAll();
        subscribeBadges();
        openFromQuery();
    }

    // ============================================
    // SESIÓN / CHROME
    // ============================================

    async function resolveSession() {
        try {
            const { data } = await _supabase.auth.getSession();
            session = data?.session || null;
        } catch (err) {
            console.warn('[inbox] no pudimos leer la sesión:', err);
            session = null;
        }
        if (!session) {
            window.location.href = '/artist/login?returnTo=%2Fartist%2Finbox';
            return false;
        }
        uid = session.user.id;
        return true;
    }

    function wireStaticUI() {
        const toggle = $('ai-menu-toggle');
        const menu = $('ai-mobile-menu');
        if (toggle && menu) {
            toggle.addEventListener('click', () => {
                const open = !menu.hidden;
                menu.hidden = open;
                toggle.setAttribute('aria-expanded', String(!open));
            });
        }

        $('ai-logout')?.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch { /* igual salimos */ }
            window.location.href = '/artist/login';
        });

        document.querySelectorAll('button.ai-side-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                filter = btn.dataset.filter || 'all';
                document.querySelectorAll('button.ai-side-item').forEach((b) =>
                    b.classList.toggle('is-active', b === btn));
                renderList();
            });
        });

        $('ai-search')?.addEventListener('input', (e) => {
            search = String(e.target.value || '').trim().toLowerCase();
            renderList();
        });

        const input = $('ai-input');
        const send = $('ai-send');
        input?.addEventListener('input', () => { send.disabled = !input.value.trim(); });
        $('ai-composer')?.addEventListener('submit', (e) => {
            e.preventDefault();
            sendCurrent();
        });

        // CTA del estado vacío de soporte: solo si el widget está inyectado.
        const cta = $('ai-support-cta');
        if (cta) {
            cta.addEventListener('click', () => {
                const widget = window.WeotziSupportChat || window.SupportChat;
                if (widget && typeof widget.openPanel === 'function') widget.openPanel();
            });
        }

        // Back móvil (el header del hilo se re-renderiza: delegación).
        $('ai-thread-head')?.addEventListener('click', (e) => {
            if (e.target.closest('.ai-back')) closeThread();
        });

        $('ai-list')?.addEventListener('click', (e) => {
            const row = e.target.closest('.ai-row');
            if (row && row.dataset.id) openThread(row.dataset.id);
        });
    }

    // ============================================
    // CARGA DE DATOS
    // ============================================

    async function loadThreads() {
        try {
            threads = await WeotziData.Chat.listThreadsForArtist(uid);
        } catch (err) {
            console.error('[inbox] error cargando hilos:', err);
            threads = [];
        }
    }

    async function loadSupport() {
        try {
            supportConv = await WeotziData.SupportInbox.getOwnConversation(uid);
            supportMsgs = supportConv
                ? await WeotziData.SupportInbox.listMessages(supportConv.id)
                : [];
        } catch (err) {
            console.warn('[inbox] soporte no disponible:', err);
            supportConv = null;
            supportMsgs = [];
        }
    }

    // ============================================
    // DERIVADOS
    // ============================================

    function threadStatusView(t) {
        if (CLOSED_QUOTE_STATUSES.includes(t.quote_status)) return { label: 'Cerrado', cls: 'is-closed' };
        if (t.last_message_sender === 'client') return { label: 'Esperando respuesta', cls: 'is-waiting' };
        return { label: 'Respondido', cls: 'is-replied' };
    }

    function supportStatusLine() {
        if (!supportConv) return null;
        if (supportConv.status === 'closed') return { label: 'Cerrado', cls: 'is-closed' };
        const last = supportMsgs[supportMsgs.length - 1];
        if (last && last.role !== 'user') return { label: 'Esperando respuesta', cls: 'is-waiting' };
        return { label: 'Respondido', cls: 'is-replied' };
    }

    function totalUnread() {
        return threads.reduce((acc, t) => acc + (Number(t.unread_for_artist) || 0), 0);
    }

    function matchesSearch(text) {
        if (!search) return true;
        return String(text || '').toLowerCase().includes(search);
    }

    function visibleQuoteThreads() {
        if (filter === 'support') return [];
        return threads.filter((t) => matchesSearch(
            [t.client_full_name, t.last_message, t.tattoo_style, t.tattoo_body_part].join(' ')
        ));
    }

    function supportVisible() {
        if (filter === 'quotes') return false;
        const last = supportMsgs[supportMsgs.length - 1];
        return matchesSearch(['soporte we ötzi', last ? last.content : ''].join(' '));
    }

    // ============================================
    // RENDER · SIDEBAR + BADGES + LISTA
    // ============================================

    function renderAll() {
        renderSidebarCounts();
        renderTopbarBadge();
        renderList();
    }

    function renderSidebarCounts() {
        setText('ai-count-all', threads.length + 1);
        setText('ai-count-quotes', threads.length);
        setText('ai-count-support', 1);
        setText('ai-sum-unread', threads.filter((t) => Number(t.unread_for_artist) > 0).length);
        setText('ai-sum-replied', threads.filter((t) => t.last_message_sender === 'artist').length);
        setText('ai-sum-waiting', threads.filter((t) => t.last_message_sender === 'client').length);
    }

    function renderTopbarBadge() {
        const el = $('ai-nav-unread');
        if (!el) return;
        const n = totalUnread();
        el.textContent = String(n);
        el.hidden = n <= 0;
    }

    function renderList() {
        const list = $('ai-list');
        if (!list) return;

        const rows = visibleQuoteThreads();
        const showSupport = supportVisible();

        const cap = $('ai-list-cap');
        if (cap) {
            const label = filter === 'quotes' ? 'Cotizaciones' : filter === 'support' ? 'Soporte' : 'Todas';
            const n = rows.length + (showSupport ? 1 : 0);
            cap.textContent = `${label} · ${n}`;
        }

        let html = '';
        if (showSupport) html += supportRowHtml();
        html += rows.map(quoteRowHtml).join('');

        if (!rows.length && filter !== 'support') {
            html += `
                <div class="wo-empty">
                    <i data-wo-icon="inbox" aria-hidden="true"></i>
                    <span class="wo-empty-title">Sin conversaciones todavía</span>
                    <p>Cuando un cliente te escriba por una cotización, el hilo aparece acá.</p>
                </div>`;
        }
        list.innerHTML = html;
    }

    function quoteRowHtml(t) {
        const st = threadStatusView(t);
        const unread = Number(t.unread_for_artist) || 0;
        const active = activeId === t.quote_id;
        return `
            <button type="button" role="listitem" class="ai-row${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}" data-id="${esc(t.quote_id)}">
                <span class="ai-avatar" aria-hidden="true">${esc(initialsOf(t.client_full_name))}</span>
                <span class="ai-row-body">
                    <span class="ai-row-top">
                        <span class="ai-row-name">${esc(t.client_full_name || 'Cliente')}</span>
                        <span class="ai-row-time">${esc(fmtListTime(t.last_message_at))}</span>
                    </span>
                    <span class="ai-row-tags"><span class="wo-tag wo-tag--highlight">Cotización</span></span>
                    <span class="ai-row-prev">
                        <span class="ai-row-preview">${esc(t.last_message || '')}</span>
                        ${unread ? `<span class="wo-badge wo-badge--s wo-badge--accent wo-badge--pill wo-mono-num ai-row-unread">${unread}</span>` : ''}
                    </span>
                    <span class="ai-row-status ${st.cls}">${esc(st.label)}</span>
                </span>
            </button>`;
    }

    function supportRowHtml() {
        const last = supportMsgs[supportMsgs.length - 1];
        const st = supportStatusLine();
        const active = activeId === SUPPORT_ID;
        const preview = last ? last.content : 'Escribinos si necesitás ayuda';
        const time = supportConv ? fmtListTime(supportConv.last_message_at) : '';
        return `
            <button type="button" role="listitem" class="ai-row${active ? ' is-active' : ''}" data-id="${SUPPORT_ID}">
                <span class="ai-avatar ai-avatar--org" aria-hidden="true">WÖ</span>
                <span class="ai-row-body">
                    <span class="ai-row-top">
                        <span class="ai-row-name">Soporte We Ötzi</span>
                        <span class="ai-row-time">${esc(time)}</span>
                    </span>
                    <span class="ai-row-tags"><span class="wo-tag wo-tag--info">Soporte</span></span>
                    <span class="ai-row-prev"><span class="ai-row-preview">${esc(preview)}</span></span>
                    ${st ? `<span class="ai-row-status ${st.cls}">${esc(st.label)}</span>` : ''}
                </span>
            </button>`;
    }

    // ============================================
    // HILO ABIERTO
    // ============================================

    async function openThread(id) {
        activeId = id;
        stopSupportPolling();
        removeChatChannel();

        $('ai-thread-placeholder').hidden = true;
        $('ai-thread').hidden = false;
        $('ai-shell').classList.add('is-thread-open');
        renderList();

        if (id === SUPPORT_ID) {
            await openSupportThread();
        } else {
            await openQuoteThread(id);
        }
    }

    function closeThread() {
        activeId = null;
        stopSupportPolling();
        removeChatChannel();
        $('ai-thread').hidden = true;
        $('ai-thread-placeholder').hidden = false;
        $('ai-shell').classList.remove('is-thread-open');
        $('ai-context').hidden = true;
        renderList();
    }

    async function openQuoteThread(quoteId) {
        const t = threads.find((x) => x.quote_id === quoteId);
        if (!t) return;

        renderQuoteHead(t);
        renderQuoteContext(t);
        setComposerState({ enabled: true });
        $('ai-support-empty').hidden = true;
        $('ai-messages').hidden = false;
        renderMessagesLoading();

        let msgs = [];
        try {
            msgs = await WeotziData.Chat.listByQuote(quoteId);
        } catch (err) {
            console.error('[inbox] error cargando mensajes:', err);
        }
        if (activeId !== quoteId) return; // cambió de hilo mientras cargaba
        renderQuoteMessages(msgs);

        // Marcar leídos los mensajes del cliente y limpiar badges locales.
        if (Number(t.unread_for_artist) > 0) {
            WeotziData.Chat.markRead(quoteId, 'client').catch(() => {});
            t.unread_for_artist = 0;
            renderSidebarCounts();
            renderTopbarBadge();
            renderList();
        }

        chatChannel = WeotziData.Realtime.subscribeChatMessages(`inbox-chat-${quoteId}`, quoteId, (payload) => {
            const m = payload?.new;
            if (!m || activeId !== quoteId) return;
            if (m.sender_type === 'artist') {
                const i = pendingEcho.indexOf(m.message);
                if (i !== -1) { pendingEcho.splice(i, 1); return; } // eco propio
            }
            appendMessage(quoteBubble(m), m.created_at);
            t.last_message = m.message;
            t.last_message_sender = m.sender_type;
            t.last_message_at = m.created_at;
            if (m.sender_type === 'client') {
                WeotziData.Chat.markRead(quoteId, 'client').catch(() => {});
            }
            renderSidebarCounts();
            renderList();
        });
    }

    async function openSupportThread() {
        renderSupportHead();
        renderSupportContext();

        if (!supportConv) {
            // Reintento por si el widget acaba de crear la conversación.
            try { supportConv = await WeotziData.SupportInbox.getOwnConversation(uid); } catch { /* sigue vacío */ }
        }

        if (!supportConv) {
            $('ai-messages').hidden = true;
            $('ai-support-empty').hidden = false;
            const widget = window.WeotziSupportChat || window.SupportChat;
            $('ai-support-cta').hidden = !(widget && typeof widget.openPanel === 'function');
            setComposerState({ enabled: false, hidden: true });
        } else {
            $('ai-support-empty').hidden = true;
            $('ai-messages').hidden = false;
            renderMessagesLoading();
            try {
                supportMsgs = await WeotziData.SupportInbox.listMessages(supportConv.id);
            } catch (err) {
                console.warn('[inbox] error cargando soporte:', err);
            }
            if (activeId !== SUPPORT_ID) return;
            renderSupportMessages();
            const closed = supportConv.status === 'closed';
            setComposerState({ enabled: !closed, placeholder: closed ? 'Conversación cerrada' : undefined });
        }

        startSupportPolling();
    }

    // ---------- Polling de soporte (solo con el hilo abierto) ----------

    function startSupportPolling() {
        stopSupportPolling();
        supportPollTimer = setInterval(supportPollTick, SUPPORT_POLL_MS);
    }

    function stopSupportPolling() {
        if (supportPollTimer) { clearInterval(supportPollTimer); supportPollTimer = null; }
    }

    async function supportPollTick() {
        if (activeId !== SUPPORT_ID) { stopSupportPolling(); return; }
        if (document.visibilityState === 'hidden' || supportPollInFlight) return;
        supportPollInFlight = true;
        try {
            if (!supportConv) {
                supportConv = await WeotziData.SupportInbox.getOwnConversation(uid);
                if (supportConv && activeId === SUPPORT_ID) await openSupportThread();
                return;
            }
            const lastAt = supportMsgs.length ? supportMsgs[supportMsgs.length - 1].created_at : null;
            const fresh = await WeotziData.SupportInbox.listMessages(supportConv.id, { since: lastAt });
            if (fresh.length && activeId === SUPPORT_ID) {
                fresh.forEach((m) => {
                    // El polling también trae el eco de lo que enviamos optimista.
                    if (m.role === 'user' && pendingEcho.includes(m.content)) {
                        pendingEcho.splice(pendingEcho.indexOf(m.content), 1);
                        supportMsgs.push(m);
                        return;
                    }
                    supportMsgs.push(m);
                    appendMessage(supportBubble(m), m.created_at);
                });
                renderList();
            }
        } catch { /* el siguiente tick reintenta */ } finally {
            supportPollInFlight = false;
        }
    }

    // ============================================
    // RENDER · HILO
    // ============================================

    function renderQuoteHead(t) {
        const sv = QUOTE_STATUS_VIEW[t.quote_status];
        const sub = ['Cotización', t.tattoo_body_part, t.tattoo_style].filter(Boolean).join(' · ');
        $('ai-thread-head').innerHTML = `
            <button type="button" class="ai-back" aria-label="Volver a la lista"><i data-wo-icon="chevron-left" aria-hidden="true"></i></button>
            <span class="ai-avatar" aria-hidden="true">${esc(initialsOf(t.client_full_name))}</span>
            <span class="ai-head-who">
                <span class="ai-head-name">${esc(t.client_full_name || 'Cliente')}</span>
                <span class="ai-head-sub">${esc(sub)}</span>
            </span>
            ${sv ? `<span class="ai-head-tag"><span class="wo-tag ${sv.tag}">${esc(sv.label)}</span></span>` : ''}`;
    }

    function renderSupportHead() {
        const sv = supportConv ? SUPPORT_STATUS_VIEW[supportConv.status] : null;
        $('ai-thread-head').innerHTML = `
            <button type="button" class="ai-back" aria-label="Volver a la lista"><i data-wo-icon="chevron-left" aria-hidden="true"></i></button>
            <span class="ai-avatar ai-avatar--org" aria-hidden="true">WÖ</span>
            <span class="ai-head-who">
                <span class="ai-head-name">Soporte We Ötzi</span>
                <span class="ai-head-sub">Equipo de soporte · respuesta en horario hábil</span>
            </span>
            ${sv ? `<span class="ai-head-tag"><span class="wo-tag ${sv.tag}">${esc(sv.label)}</span></span>` : ''}`;
    }

    function renderMessagesLoading() {
        $('ai-messages').dataset.lastDay = '';
        $('ai-messages').innerHTML = `
            <div class="ai-list-loading">
                <span class="wo-spinner" aria-hidden="true"></span>
                <span class="wo-meta-s">Cargando mensajes</span>
            </div>`;
    }

    function renderQuoteMessages(msgs) {
        renderMessageItems(msgs.map((m) => ({ html: quoteBubble(m), at: m.created_at })));
    }

    function renderSupportMessages() {
        renderMessageItems(supportMsgs.map((m) => ({ html: supportBubble(m), at: m.created_at })));
    }

    function renderMessageItems(items) {
        const box = $('ai-messages');
        box.innerHTML = withDaySeparators(items);
        const lastWithDate = [...items].reverse().find((i) => i.at);
        box.dataset.lastDay = lastWithDate ? new Date(lastWithDate.at).toDateString() : '';
        box.scrollTop = box.scrollHeight;
    }

    function quoteBubble(m) {
        const dir = m.sender_type === 'artist' ? 'ai-msg--out' : 'ai-msg--in';
        return bubbleHtml(dir, m.message, m.created_at);
    }

    function supportBubble(m) {
        const dir = m.role === 'user' ? 'ai-msg--out' : m.role === 'system' ? 'ai-msg--system ai-msg--in' : 'ai-msg--in';
        return bubbleHtml(dir, m.content, m.created_at);
    }

    function bubbleHtml(dirClass, text, at) {
        return `
            <div class="ai-msg ${dirClass}">
                <div class="ai-bubble">${esc(text || '')}</div>
                <span class="ai-msg-time">${esc(fmtMsgTime(at))}</span>
            </div>`;
    }

    function withDaySeparators(items) {
        let html = '';
        let lastDay = null;
        items.forEach(({ html: h, at }) => {
            const day = at ? new Date(at).toDateString() : null;
            if (day && day !== lastDay) {
                html += `<span class="ai-day">${esc(fmtDayLabel(at))}</span>`;
                lastDay = day;
            }
            html += h;
        });
        return html;
    }

    function appendMessage(html, at) {
        const box = $('ai-messages');
        if (!box || box.hidden) return;
        const lastDay = box.dataset.lastDay || null;
        const day = at ? new Date(at).toDateString() : null;
        let chunk = '';
        if (day && day !== lastDay) {
            chunk += `<span class="ai-day">${esc(fmtDayLabel(at))}</span>`;
            box.dataset.lastDay = day;
        }
        chunk += html;
        box.insertAdjacentHTML('beforeend', chunk);
        box.scrollTop = box.scrollHeight;
    }

    function setComposerState({ enabled, hidden = false, placeholder }) {
        const composer = $('ai-composer');
        const input = $('ai-input');
        const send = $('ai-send');
        composer.hidden = hidden;
        input.disabled = !enabled;
        input.placeholder = placeholder || 'Escribí un mensaje…';
        send.disabled = true;
        if (enabled) send.disabled = !input.value.trim();
    }

    // ============================================
    // RENDER · PANEL DE CONTEXTO
    // ============================================

    function renderQuoteContext(t) {
        const ctx = $('ai-context');
        const sv = QUOTE_STATUS_VIEW[t.quote_status];
        const blocks = [];
        blocks.push(ctxBlock('Cliente', esc(t.client_full_name || '—')));
        if (t.tattoo_body_part) blocks.push(ctxBlock('Zona', esc(t.tattoo_body_part)));
        if (t.tattoo_style) blocks.push(ctxBlock('Estilo', esc(t.tattoo_style)));
        if (t.tattoo_size) blocks.push(ctxBlock('Tamaño', esc(t.tattoo_size)));
        if (sv) {
            blocks.push(`
                <div class="ai-ctx-block">
                    <span class="ai-ctx-label">Estado</span>
                    <span><span class="wo-tag ${sv.tag}">${esc(sv.label)}</span></span>
                </div>`);
        }
        if (t.final_budget_amount != null) {
            blocks.push(ctxBlock('Presupuesto final', esc(fmtMoney(t.final_budget_amount, t.final_budget_currency)), true));
        }
        ctx.innerHTML = `
            <p class="wo-eyebrow ai-ctx-eyebrow">Cotización</p>
            ${blocks.join('')}
            <a class="wo-btn wo-btn--ghost wo-btn--mono wo-btn--s ai-ctx-link" href="/my-quotations">Ver cotización →</a>`;
        ctx.hidden = false;
    }

    function renderSupportContext() {
        const ctx = $('ai-context');
        const sv = supportConv ? SUPPORT_STATUS_VIEW[supportConv.status] : null;
        ctx.innerHTML = `
            <p class="wo-eyebrow ai-ctx-eyebrow">Soporte</p>
            ${ctxBlock('Canal', 'Chat con el equipo We Ötzi')}
            ${sv ? `
                <div class="ai-ctx-block">
                    <span class="ai-ctx-label">Estado</span>
                    <span><span class="wo-tag ${sv.tag}">${esc(sv.label)}</span></span>
                </div>` : ''}
            <p class="ai-ctx-note">Te respondemos por acá, en horario hábil.</p>`;
        ctx.hidden = false;
    }

    function ctxBlock(label, valueHtml, mono = false) {
        return `
            <div class="ai-ctx-block">
                <span class="ai-ctx-label">${esc(label)}</span>
                <span class="ai-ctx-value${mono ? ' wo-mono-num' : ''}">${valueHtml}</span>
            </div>`;
    }

    // ============================================
    // ENVÍO
    // ============================================

    async function sendCurrent() {
        const input = $('ai-input');
        const send = $('ai-send');
        const text = input.value.trim();
        if (!text || !activeId) return;

        input.value = '';
        send.disabled = true;

        if (activeId === SUPPORT_ID) {
            await sendSupportMessage(text);
        } else {
            await sendQuoteMessage(activeId, text);
        }
        input.focus();
    }

    async function sendQuoteMessage(quoteId, text) {
        const t = threads.find((x) => x.quote_id === quoteId);
        const now = new Date().toISOString();
        pendingEcho.push(text);
        appendMessage(bubbleHtml('ai-msg--out', text, now), now);
        try {
            await WeotziData.Chat.sendMessage({ quoteId, senderType: 'artist', senderId: uid, message: text });
            try {
                window.ConfigManager?.sendN8NEvent?.('chat_message_to_client', {
                    quote_id: quoteId,
                    client_name: t?.client_full_name || '',
                    client_email: t?.client_email || '',
                    artist_name: t?.artist_name || '',
                    message_preview: text.substring(0, 100),
                });
            } catch { /* la notificación no bloquea el envío */ }
            if (t) {
                t.last_message = text;
                t.last_message_sender = 'artist';
                t.last_message_at = now;
                renderSidebarCounts();
                renderList();
            }
        } catch (err) {
            console.error('[inbox] error enviando mensaje:', err);
            const i = pendingEcho.indexOf(text);
            if (i !== -1) pendingEcho.splice(i, 1);
            appendMessage(bubbleHtml('ai-msg--system ai-msg--in', 'No pudimos enviar el mensaje. Probá de nuevo.', new Date().toISOString()), null);
            $('ai-input').value = text;
            $('ai-send').disabled = false;
        }
    }

    async function sendSupportMessage(text) {
        if (!supportConv) return;
        const now = new Date().toISOString();
        pendingEcho.push(text);
        supportMsgs.push({ role: 'user', content: text, created_at: now });
        appendMessage(bubbleHtml('ai-msg--out', text, now), now);
        try {
            const body = await WeotziData.SupportInbox.sendMessage({ conversationId: supportConv.id, content: text });
            if (body?.status && body.status !== supportConv.status) {
                supportConv.status = body.status;
                renderSupportHead();
                renderSupportContext();
            }
            if (body?.response) {
                const at = new Date().toISOString();
                supportMsgs.push({ role: 'assistant', content: body.response, created_at: at });
                appendMessage(bubbleHtml('ai-msg--in', body.response, at), at);
            }
            renderList();
        } catch (err) {
            console.error('[inbox] error enviando a soporte:', err);
            const i = pendingEcho.indexOf(text);
            if (i !== -1) pendingEcho.splice(i, 1);
            appendMessage(bubbleHtml('ai-msg--system ai-msg--in', 'No pudimos enviar el mensaje. Probá de nuevo.', new Date().toISOString()), null);
            $('ai-input').value = text;
            $('ai-send').disabled = false;
        }
    }

    // ============================================
    // REALTIME (badges de la lista)
    // ============================================

    function subscribeBadges() {
        badgeChannel = WeotziData.Realtime.subscribeNewChatFromSender('inbox-new-from-client', 'client', (payload) => {
            const q = payload?.new?.quotation_id;
            if (q && q === activeId) return; // el canal del hilo abierto ya lo maneja
            scheduleRefresh();
        });
    }

    function scheduleRefresh() {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            await loadThreads();
            renderAll();
        }, 700);
    }

    function removeChatChannel() {
        if (chatChannel) { WeotziData.Realtime.remove(chatChannel); chatChannel = null; }
    }

    window.addEventListener('beforeunload', () => {
        removeChatChannel();
        if (badgeChannel) WeotziData.Realtime.remove(badgeChannel);
        stopSupportPolling();
    });

    // ============================================
    // DEEP LINK · ?thread=<quote_id> | ?thread=soporte
    // ============================================

    function openFromQuery() {
        const wanted = new URLSearchParams(window.location.search).get('thread');
        if (!wanted) return;
        if (wanted === 'soporte' || wanted === SUPPORT_ID) { openThread(SUPPORT_ID); return; }
        if (threads.some((t) => t.quote_id === wanted)) openThread(wanted);
    }

    // ============================================
    // HELPERS
    // ============================================

    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = String(value);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initialsOf(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'C';
        return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
    }

    function fmtListTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'ayer';
        const diffDays = (now - d) / 86400000;
        if (diffDays < 7) return d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
        if (d.getFullYear() === now.getFullYear()) {
            return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '');
        }
        return d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }).replace('.', '');
    }

    function fmtMsgTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function fmtDayLabel(iso) {
        const d = new Date(iso);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return 'hoy';
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'ayer';
        return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    }

    function fmtMoney(amount, currency) {
        const n = Number(amount);
        if (Number.isNaN(n)) return String(amount);
        return `$${n.toLocaleString('es-AR')}${currency ? ` ${currency}` : ''}`;
    }
})();
