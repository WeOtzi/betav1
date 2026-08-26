// ============================================
// /client/chats — Chats del cliente (DS Bauhaus)
// Refs Figma: 286:11109 (estado vacío) · 333:1540 (conversación activa).
// Datos: WeotziData.Chat (vista chat_threads + chat_messages) y
// WeotziData.Sessions.listByQuotationIds (pestaña Reservas).
// Tiempo real: WeotziData.Realtime.subscribeChatMessages (hilo abierto) +
// subscribeNewChatFromSender (badges de la lista).
// v1: solo mensajes de texto (sin adjuntos ni quote-cards).
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const NUM_FMT = new Intl.NumberFormat('es-AR');
    const DAY_FMT = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });

    // Estado de la cotización → etiqueta y variante de tag (banner del proyecto).
    const STATUS_TAGS = {
        pending:          { label: 'Esperando cotización', cls: 'wo-tag--soft' },
        responded:        { label: 'Cotización recibida',  cls: 'wo-tag--highlight' },
        client_approved:  { label: 'Aprobada',             cls: 'wo-tag--active' },
        in_progress:      { label: 'En proceso',           cls: 'wo-tag--info' },
        artist_completed: { label: 'Por finalizar',        cls: 'wo-tag--info' },
        completed:        { label: 'Completada',           cls: 'wo-tag--active' },
        client_rejected:  { label: 'Rechazada',            cls: 'wo-tag--archived' },
    };

    let uid = null;
    let threads = [];
    let artistsById = {};        // user_id → fila de artists_db (afiliación/ciudad)
    let sessionsByQid = {};      // quotation_id_int → próxima sesión futura
    let sessionsLoaded = false;
    let currentQuoteId = null;
    let activeTab = 'todos';
    let searchTerm = '';
    let threadChannel = null;
    let badgeChannel = null;
    let renderedIds = new Set(); // ids de chat_messages ya pintados (dedupe realtime)
    let pendingOwn = [];         // textos propios pintados en optimista, a la espera del eco realtime
    let lastDayKey = null;       // separadores de día del timeline
    let openSeq = 0;
    let refreshTimer = null;

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
            window.location.href = '/client/login';
            return;
        }
        uid = session.user.id;

        await loadThreads({ initial: true });
        subscribeBadges();
    }

    // ============================================
    // CARGA DE HILOS
    // ============================================

    async function loadThreads({ initial = false } = {}) {
        try {
            threads = await WeotziData.Chat.listThreadsForClient(uid);
        } catch (err) {
            console.error('[chats] error cargando hilos:', err);
            threads = [];
        }
        sortThreads();
        $('cch-loading').classList.add('wo-hidden');

        if (!threads.length) {
            $('cch-empty').classList.remove('wo-hidden');
            $('cch-shell').classList.add('wo-hidden');
            return;
        }
        $('cch-empty').classList.add('wo-hidden');
        $('cch-shell').classList.remove('wo-hidden');
        renderList();

        // Enriquecimientos en paralelo (repintan la lista al llegar).
        enrichArtists();
        loadSessions();

        // En desktop se abre el hilo más reciente; en mobile queda la lista.
        if (initial && window.matchMedia('(min-width: 769px)').matches) {
            openThread(threads[0].quote_id);
        }
    }

    // Refresco liviano de la lista (p. ej. llegó un mensaje de un hilo nuevo).
    function scheduleRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            try {
                threads = await WeotziData.Chat.listThreadsForClient(uid);
                sortThreads();
                if (threads.length) {
                    $('cch-empty').classList.add('wo-hidden');
                    $('cch-shell').classList.remove('wo-hidden');
                }
                renderList();
                enrichArtists();
                loadSessions();
            } catch (err) {
                console.warn('[chats] refresco de hilos falló:', err);
            }
        }, 400);
    }

    async function enrichArtists() {
        const ids = [...new Set(threads.map(t => t.artist_id).filter(Boolean))]
            .filter(id => !artistsById[id]);
        if (!ids.length) return;
        try {
            const { data } = await WeotziData.Artists.listByUserIds(
                ids, 'user_id, username, name, estudios, city, ubicacion, work_type'
            );
            (data || []).forEach(a => { artistsById[a.user_id] = a; });
            renderList();
            const t = findThread(currentQuoteId);
            if (t) paintHead(t);
        } catch (err) {
            console.warn('[chats] no pudimos enriquecer artistas:', err);
        }
    }

    // Reservas: hilos cuya cotización tiene una sesión futura no cancelada.
    async function loadSessions() {
        const qids = [...new Set(threads.map(t => t.quotation_id_int).filter(id => id != null))];
        if (!qids.length) { sessionsLoaded = true; return; }
        try {
            const rows = await WeotziData.Sessions.listByQuotationIds(qids);
            const now = Date.now();
            sessionsByQid = {};
            (rows || []).forEach(s => {
                if (!s.session_date) return;
                const when = new Date(s.session_date).getTime();
                const status = String(s.status || '').toLowerCase();
                if (when < now || status === 'cancelled' || status === 'cancelada') return;
                const cur = sessionsByQid[s.quotation_id];
                if (!cur || new Date(s.session_date) < new Date(cur.session_date)) {
                    sessionsByQid[s.quotation_id] = s;
                }
            });
        } catch (err) {
            // Sin acceso a sesiones: la pestaña Reservas queda vacía y se avisa ahí.
            console.warn('[chats] no pudimos leer sesiones:', err);
            sessionsByQid = {};
        }
        sessionsLoaded = true;
        renderList();
        const t = findThread(currentQuoteId);
        if (t) paintBanner(t);
    }

    // ============================================
    // LISTA DE CONVERSACIONES
    // ============================================

    function findThread(quoteId) {
        return threads.find(t => t.quote_id === quoteId) || null;
    }

    function sortThreads() {
        threads.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    }

    function hasReservation(t) {
        return t.quotation_id_int != null && !!sessionsByQid[t.quotation_id_int];
    }

    function affiliationOf(t) {
        const a = artistsById[t.artist_id];
        if (a) {
            const studio = (a.estudios || '').trim();
            if (studio) return studio;
            return 'Artista independiente';
        }
        return t.artist_username ? '@' + t.artist_username : '';
    }

    function filteredThreads() {
        let list = threads;
        if (activeTab === 'sin-leer') list = list.filter(t => (t.unread_for_client || 0) > 0);
        else if (activeTab === 'reservas') list = list.filter(hasReservation);
        else if (activeTab === 'cotizaciones') list = list.filter(t => !hasReservation(t));
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(t =>
                (t.artist_name || '').toLowerCase().includes(q) ||
                (t.artist_username || '').toLowerCase().includes(q) ||
                affiliationOf(t).toLowerCase().includes(q) ||
                (t.last_message || '').toLowerCase().includes(q)
            );
        }
        return list;
    }

    function renderList() {
        const rowsEl = $('cch-rows');
        const emptyEl = $('cch-list-empty');
        if (!rowsEl) return;
        const list = filteredThreads();

        if (!list.length) {
            rowsEl.innerHTML = '';
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

        rowsEl.innerHTML = list.map(t => {
            const unread = t.unread_for_client || 0;
            const badge = unread > 0
                ? `<span class="cch-unread" aria-label="${unread} mensajes sin leer">${unread > 99 ? '99+' : unread}</span>`
                : '';
            const active = t.quote_id === currentQuoteId ? ' is-active' : '';
            return `
                <button class="cch-row${active}" type="button" data-quote="${escapeAttr(t.quote_id)}">
                    <span class="cch-avatar" aria-hidden="true">${escapeHtml(initialsOf(t))}</span>
                    <span class="cch-row-main">
                        <span class="cch-row-top">
                            <span class="cch-row-name">${escapeHtml(displayNameOf(t))}</span>
                            <span class="cch-row-time">${escapeHtml(relTime(t.last_message_at))}</span>
                        </span>
                        <span class="cch-row-aff">${escapeHtml(affiliationOf(t))}</span>
                        <span class="cch-row-bottom">
                            <span class="cch-row-preview">${escapeHtml(t.last_message || '')}</span>
                            ${badge}
                        </span>
                    </span>
                </button>`;
        }).join('');
    }

    function displayNameOf(t) {
        return t.artist_name || t.artist_username || 'Artista';
    }

    function initialsOf(t) {
        const name = displayNameOf(t).trim();
        const parts = name.split(/\s+/).filter(Boolean);
        if (!parts.length) return '·';
        if (parts.length === 1) return parts[0].slice(0, 2);
        return parts[0][0] + parts[1][0];
    }

    // ============================================
    // HILO ABIERTO
    // ============================================

    async function openThread(quoteId) {
        const t = findThread(quoteId);
        if (!t) return;
        const seq = ++openSeq;
        currentQuoteId = quoteId;
        pendingOwn = [];

        $('cch-shell').classList.add('is-thread-open');
        $('cch-thread-placeholder').classList.add('wo-hidden');
        $('cch-thread-body').classList.remove('wo-hidden');
        $('cch-composer-error').classList.add('wo-hidden');

        paintHead(t);
        paintBanner(t);
        renderList();

        const messagesEl = $('cch-messages');
        messagesEl.innerHTML = '<div class="cch-messages-empty">Cargando mensajes…</div>';

        let msgs = [];
        try {
            msgs = await WeotziData.Chat.listByQuote(quoteId);
        } catch (err) {
            console.error('[chats] error cargando mensajes:', err);
            if (seq === openSeq) {
                messagesEl.innerHTML = '<div class="cch-messages-empty">No pudimos cargar los mensajes. Recargá la página.</div>';
            }
            return;
        }
        if (seq !== openSeq) return;

        renderMessages(msgs);
        subscribeThread(quoteId);

        // Marcar leídos los mensajes del artista y apagar el badge.
        if ((t.unread_for_client || 0) > 0) {
            t.unread_for_client = 0;
            renderList();
        }
        WeotziData.Chat.markRead(quoteId, 'artist').catch(() => {});

        $('cch-input').focus();
    }

    function paintHead(t) {
        $('cch-head-avatar').textContent = initialsOf(t);
        $('cch-head-name').textContent = displayNameOf(t);

        const a = artistsById[t.artist_id];
        const username = t.artist_username || (a && a.username) || '';
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
            profile.href = '/artist/profile?artist=' + encodeURIComponent(username);
            profile.classList.remove('wo-hidden');
        } else {
            profile.classList.add('wo-hidden');
        }

        toggleTurnTag(t.last_message_sender === 'artist');
    }

    function toggleTurnTag(show) {
        $('cch-head-turn').classList.toggle('wo-hidden', !show);
    }

    function styleNameOf(t) {
        const s = t.tattoo_style;
        if (s && typeof s === 'object') return s.style_name || '';
        return s || '';
    }

    function paintBanner(t) {
        const style = String(styleNameOf(t) || '').trim();
        const part = String(t.tattoo_body_part || '').trim();
        let title = 'Proyecto de tatuaje';
        if (style && part) title = `Tatuaje ${style.toLowerCase()} en ${part.toLowerCase()}`;
        else if (part) title = `Tatuaje en ${part.toLowerCase()}`;
        else if (style) title = `Tatuaje ${style.toLowerCase()}`;
        $('cch-banner-title').textContent = title;

        const meta = [];
        if (part) meta.push(part);
        if (style) meta.push(style);
        if (t.tattoo_size) meta.push(String(t.tattoo_size).trim());
        if (t.final_budget_amount != null && Number(t.final_budget_amount) > 0) {
            meta.push(`$${NUM_FMT.format(Number(t.final_budget_amount))} ${t.final_budget_currency || ''}`.trim());
        }
        const session = t.quotation_id_int != null ? sessionsByQid[t.quotation_id_int] : null;
        if (session) meta.push(`próxima sesión ${DAY_FMT.format(new Date(session.session_date))}`);
        $('cch-banner-meta').textContent = meta.join(' · ');

        const info = STATUS_TAGS[t.quote_status] || { label: t.quote_status || 'Sin estado', cls: 'wo-tag--soft' };
        const tag = $('cch-banner-status');
        tag.className = 'wo-tag cch-tag-s ' + info.cls;
        tag.textContent = info.label;
    }

    // ============================================
    // TIMELINE DE MENSAJES
    // ============================================

    function renderMessages(msgs) {
        const el = $('cch-messages');
        el.innerHTML = '';
        renderedIds = new Set();
        lastDayKey = null;
        if (!msgs.length) {
            el.innerHTML = '<div class="cch-messages-empty">Todavía no hay mensajes en esta conversación.</div>';
            return;
        }
        msgs.forEach(m => appendMessage(m, { scroll: false }));
        el.scrollTop = el.scrollHeight;
    }

    function appendMessage(m, { scroll = true } = {}) {
        const el = $('cch-messages');
        const placeholder = el.querySelector('.cch-messages-empty');
        if (placeholder) placeholder.remove();
        if (m.id != null) {
            if (renderedIds.has(m.id)) return;
            renderedIds.add(m.id);
        }

        const when = m.created_at ? new Date(m.created_at) : new Date();
        const dayKey = when.getFullYear() + '-' + when.getMonth() + '-' + when.getDate();
        if (dayKey !== lastDayKey) {
            lastDayKey = dayKey;
            const sep = document.createElement('div');
            sep.className = 'cch-day';
            sep.textContent = dayLabel(when);
            el.appendChild(sep);
        }

        const bubble = document.createElement('div');
        bubble.className = 'cch-msg ' + (m.sender_type === 'client' ? 'cch-msg--out' : 'cch-msg--in');
        bubble.textContent = m.message || '';
        el.appendChild(bubble);
        if (scroll) el.scrollTop = el.scrollHeight;
    }

    // ============================================
    // ENVÍO
    // ============================================

    async function handleSend(event) {
        event.preventDefault();
        const input = $('cch-input');
        const btn = $('cch-send');
        const text = input.value.trim();
        if (!text || !currentQuoteId) return;

        btn.disabled = true;
        $('cch-composer-error').classList.add('wo-hidden');
        try {
            await WeotziData.Chat.sendMessage({
                quoteId: currentQuoteId,
                senderType: 'client',
                senderId: uid,
                message: text,
            });
            pendingOwn.push(text);
            appendMessage({ sender_type: 'client', message: text, created_at: new Date().toISOString() });
            input.value = '';
            toggleTurnTag(false);
            const t = findThread(currentQuoteId);
            if (t) {
                t.last_message = text;
                t.last_message_at = new Date().toISOString();
                t.last_message_sender = 'client';
                sortThreads();
                renderList();
            }
        } catch (err) {
            console.error('[chats] error enviando mensaje:', err);
            $('cch-composer-error').classList.remove('wo-hidden');
        } finally {
            btn.disabled = input.value.trim() === '';
            input.focus();
        }
    }

    // ============================================
    // TIEMPO REAL
    // ============================================

    function subscribeThread(quoteId) {
        if (threadChannel) {
            WeotziData.Realtime.remove(threadChannel);
            threadChannel = null;
        }
        threadChannel = WeotziData.Realtime.subscribeChatMessages(
            'cch-thread-' + quoteId, quoteId, onThreadInsert
        );
    }

    function onThreadInsert(payload) {
        const m = payload && payload.new;
        if (!m || m.quotation_id !== currentQuoteId) return;
        if (m.id != null && renderedIds.has(m.id)) return;

        if (m.sender_type === 'client') {
            // Eco de un mensaje propio ya pintado en optimista.
            const i = pendingOwn.indexOf(m.message);
            if (i > -1) {
                pendingOwn.splice(i, 1);
                if (m.id != null) renderedIds.add(m.id);
                return;
            }
        }

        appendMessage(m);
        if (m.sender_type === 'artist') {
            toggleTurnTag(true);
            WeotziData.Chat.markRead(currentQuoteId, 'artist').catch(() => {});
        }
        const t = findThread(currentQuoteId);
        if (t) {
            t.last_message = m.message;
            t.last_message_at = m.created_at;
            t.last_message_sender = m.sender_type;
            sortThreads();
            renderList();
        }
    }

    function subscribeBadges() {
        badgeChannel = WeotziData.Realtime.subscribeNewChatFromSender(
            'cch-badges-' + uid, 'artist', onBadgeInsert
        );
    }

    function onBadgeInsert(payload) {
        const m = payload && payload.new;
        if (!m) return;
        if (m.quotation_id === currentQuoteId) return; // lo maneja el canal del hilo
        const t = threads.find(x => x.quote_id === m.quotation_id);
        if (!t) {
            scheduleRefresh(); // conversación nueva: refrescar la lista completa
            return;
        }
        t.last_message = m.message;
        t.last_message_at = m.created_at;
        t.last_message_sender = m.sender_type;
        t.unread_for_client = (t.unread_for_client || 0) + 1;
        sortThreads();
        renderList();
    }

    // ============================================
    // EVENTOS ESTÁTICOS
    // ============================================

    function wireStaticEvents() {
        $('cch-rows').addEventListener('click', (e) => {
            const row = e.target.closest('.cch-row');
            if (row) openThread(row.getAttribute('data-quote'));
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
        $('cch-input').addEventListener('input', () => {
            $('cch-send').disabled = $('cch-input').value.trim() === '';
        });

        $('cch-back').addEventListener('click', () => {
            $('cch-shell').classList.remove('is-thread-open');
        });

        $('cch-info-toggle').addEventListener('click', () => {
            const banner = $('cch-banner');
            const collapsed = banner.classList.toggle('is-collapsed');
            $('cch-info-toggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });

        $('cch-logout').addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[chats] logout:', err); }
            window.location.href = '/client/login';
        });
    }

    // ============================================
    // FORMATO
    // ============================================

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

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(s) { return escapeHtml(s); }
})();
