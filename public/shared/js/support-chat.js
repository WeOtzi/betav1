// ============================================
// WE ÖTZI - SUPPORT CHAT WIDGET
// Widget flotante universal (OpenAI GPT + handoff humano)
// Usa Supabase Realtime para recibir respuestas del bot/humano.
// ============================================

(function () {
    'use strict';

    const STORAGE_ANON_KEY = 'weotzi_support_anon_id';
    const STORAGE_CONV_KEY = 'weotzi_support_conversation_id';
    const STORAGE_OPEN_KEY = 'weotzi_support_open';

    const SupportChat = {
        state: {
            anonymousId: null,
            conversationId: null,
            status: 'bot',
            assignedAgentName: null,
            messages: [],
            isSending: false,
            pollTimer: null,
            pollInFlight: false,
            lastMessageAt: null,
            supabase: null,
            panelOpen: false,
            mounted: false,
            lastSeenAt: null,
            unreadCount: 0
        },

        // ========== Mount & init ==========
        async init() {
            if (this.state.mounted) return;

            // Wait for ConfigManager
            if (window.ConfigManager && ConfigManager.ready) {
                await ConfigManager.ready();
            }

            const enabled = window.ConfigManager?.getValue?.('supportChat.enabled', true);
            if (enabled === false) {
                console.log('[support-chat] disabled via config');
                return;
            }

            this._ensureAnonymousId();
            this._mountDOM();
            await this._connectSupabase();
            await this._ensureConversation();
            this._startPolling();
            this._bindAuthListener();
            this.state.mounted = true;

            // Restaurar estado de panel
            try {
                if (sessionStorage.getItem(STORAGE_OPEN_KEY) === '1') {
                    this.openPanel();
                }
            } catch {}
        },

        _ensureAnonymousId() {
            try {
                let id = localStorage.getItem(STORAGE_ANON_KEY);
                if (!this._isUuid(id)) {
                    id = this._uuid();
                    localStorage.setItem(STORAGE_ANON_KEY, id);
                }
                this.state.anonymousId = id;
            } catch {
                this.state.anonymousId = this._uuid();
            }
        },

        _isUuid(value) {
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
        },

        _uuid() {
            if (window.crypto?.randomUUID) return crypto.randomUUID();
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        async _connectSupabase() {
            try {
                if (window.ConfigManager?.getSupabaseClient) {
                    this.state.supabase = ConfigManager.getSupabaseClient();
                }
            } catch (e) {
                console.warn('[support-chat] supabase client unavailable:', e.message);
            }
        },

        async _authHeaders() {
            try {
                if (this.state.supabase) {
                    const { data } = await this.state.supabase.auth.getSession();
                    const token = data?.session?.access_token;
                    if (token) return { 'Authorization': `Bearer ${token}` };
                }
            } catch {}
            return {};
        },

        // ========== DOM ==========
        _mountDOM() {
            if (document.getElementById('sc-fab')) return;

            // FAB
            const fab = document.createElement('button');
            fab.id = 'sc-fab';
            fab.className = 'sc-fab';
            fab.setAttribute('aria-label', 'Abrir soporte We Otzi');
            fab.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1-5v-6a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8z"/></svg>
                <span class="sc-fab-badge" id="sc-fab-badge">0</span>
            `;
            fab.addEventListener('click', () => this.togglePanel());
            document.body.appendChild(fab);

            // Panel
            const panel = document.createElement('div');
            panel.id = 'sc-panel';
            panel.className = 'sc-panel';
            panel.innerHTML = `
                <div class="sc-header">
                    <div class="sc-header-title">
                        <span class="sc-avatar" id="sc-avatar">W</span>
                        <span>Soporte WeOtzi</span>
                        <span class="sc-status-pill" id="sc-status">BOT</span>
                    </div>
                    <div class="sc-header-actions">
                        <button class="sc-icon-btn" id="sc-close" aria-label="Cerrar">
                            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="sc-banner hidden" id="sc-banner"></div>
                <div class="sc-messages" id="sc-messages">
                    <div class="sc-typing" id="sc-typing"><span></span><span></span><span></span></div>
                </div>
                <div class="sc-quick" id="sc-quick">
                    <button class="sc-quick-btn" data-action="human">Hablar con humano</button>
                    <button class="sc-quick-btn" data-action="bug">Reportar bug</button>
                    <button class="sc-quick-btn" data-action="status">Estado cotización</button>
                </div>
                <div class="sc-footer">
                    <textarea class="sc-input" id="sc-input" rows="1" placeholder="Escribí tu mensaje…"></textarea>
                    <button class="sc-send" id="sc-send">Enviar</button>
                </div>
            `;
            document.body.appendChild(panel);

            // Wire up
            document.getElementById('sc-close').addEventListener('click', () => this.closePanel());
            const input = document.getElementById('sc-input');
            const sendBtn = document.getElementById('sc-send');

            sendBtn.addEventListener('click', () => this.sendMessage());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });

            document.querySelectorAll('.sc-quick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    if (action === 'human') {
                        input.value = 'Necesito hablar con un humano';
                    } else if (action === 'bug') {
                        input.value = 'Quiero reportar un bug: ';
                    } else if (action === 'status') {
                        input.value = '¿En qué estado está mi cotización?';
                    }
                    input.focus();
                });
            });
        },

        // ========== Conversación ==========
        async _ensureConversation() {
            try {
                const headers = { 'Content-Type': 'application/json', ...(await this._authHeaders()) };
                const res = await fetch('/api/support-chat/conversation', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        anonymous_id: this.state.anonymousId,
                        page_context: window.location.pathname + window.location.search
                    })
                });
                if (!res.ok) {
                    console.warn('[support-chat] conversation endpoint failed', res.status);
                    return;
                }
                const data = await res.json();
                if (!data.success) return;

                this.state.conversationId = data.conversation.id;
                this.state.status = data.conversation.status || 'bot';
                this.state.messages = (data.messages || []).map(m => ({
                    role: m.role,
                    content: m.content,
                    created_at: m.created_at || new Date().toISOString()
                }));

                try { sessionStorage.setItem(STORAGE_CONV_KEY, this.state.conversationId); } catch {}

                this._renderAllMessages();
                this._updateStatusUI();
            } catch (err) {
                console.warn('[support-chat] ensureConversation:', err);
            }
        },

        // El widget recibia respuestas via Supabase Realtime, pero eso exigia
        // lectura publica de support_messages/support_conversations (cualquiera
        // podia leer todos los chats). Ahora RLS restringe esas tablas a
        // soporte y el widget consulta el servidor (service role) por polling.
        _startPolling() {
            if (!this.state.conversationId) return;
            this._stopPolling();
            this.state.pollTimer = setInterval(() => this._pollMessages(), 5000);
            this._pollMessages();
        },

        _stopPolling() {
            if (this.state.pollTimer) {
                clearInterval(this.state.pollTimer);
                this.state.pollTimer = null;
            }
        },

        async _pollMessages() {
            if (!this.state.conversationId) return;
            if (document.visibilityState === 'hidden') return;
            if (this.state.pollInFlight) return;
            this.state.pollInFlight = true;
            try {
                const since = this.state.lastMessageAt
                    ? `&since=${encodeURIComponent(this.state.lastMessageAt)}`
                    : '';
                const res = await fetch(
                    `/api/support-chat/poll?conversationId=${encodeURIComponent(this.state.conversationId)}${since}`
                );
                if (!res.ok) return;
                const data = await res.json();
                if (!data?.success) return;
                (data.messages || []).forEach((row) => {
                    if (row.created_at && (!this.state.lastMessageAt || row.created_at > this.state.lastMessageAt)) {
                        this.state.lastMessageAt = row.created_at;
                    }
                    this._onRealtimeMessage(row);
                });
                if (data.conversation) this._onConversationUpdate(data.conversation);
            } catch (err) {
                // silencioso: el siguiente tick reintenta
            } finally {
                this.state.pollInFlight = false;
            }
        },

        _onRealtimeMessage(row) {
            // Evitar duplicar el eco del propio usuario
            const exists = this.state.messages.some(m =>
                m.role === row.role && m.content === row.content
            );
            if (exists) return;

            this.state.messages.push({
                role: row.role,
                content: row.content,
                created_at: row.created_at
            });
            this._renderMessage(row);

            if (!this.state.panelOpen && (row.role === 'assistant' || row.role === 'human_agent' || row.role === 'system')) {
                this.state.unreadCount++;
                this._updateBadge();
            }
        },

        _onConversationUpdate(row) {
            const prev = this.state.status;
            this.state.status = row.status;
            if (prev !== row.status) {
                this._updateStatusUI();
            }
        },

        // ========== Envío ==========
        async sendMessage() {
            const input = document.getElementById('sc-input');
            const text = (input.value || '').trim();
            if (!text || this.state.isSending) return;
            if (!this.state.conversationId) {
                await this._ensureConversation();
                if (!this.state.conversationId) return;
                this._startPolling();
            }

            this.state.isSending = true;
            document.getElementById('sc-send').disabled = true;
            input.value = '';
            input.style.height = 'auto';

            // Render local optimista
            const optimistic = { role: 'user', content: text, created_at: new Date().toISOString() };
            this.state.messages.push(optimistic);
            this._renderMessage(optimistic);
            this._showTyping(this.state.status === 'bot');

            try {
                const headers = { 'Content-Type': 'application/json', ...(await this._authHeaders()) };
                const res = await fetch('/api/support-chat/message', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        conversation_id: this.state.conversationId,
                        anonymous_id: this.state.anonymousId,
                        content: text,
                        page_context: window.location.pathname
                    })
                });
                const data = await res.json();
                if (!res.ok) {
                    this._showSystemError(data?.error || 'Error al enviar el mensaje.');
                } else if (data.status) {
                    this.state.status = data.status;
                    this._updateStatusUI();
                    if (data.response) {
                        const assistantMessage = {
                            role: 'assistant',
                            content: data.response,
                            created_at: new Date().toISOString()
                        };
                        const exists = this.state.messages.some(m =>
                            m.role === assistantMessage.role && m.content === assistantMessage.content
                        );
                        if (!exists) {
                            this.state.messages.push(assistantMessage);
                            this._renderMessage(assistantMessage);
                        }
                    }
                }
            } catch (err) {
                this._showSystemError(err.message);
            } finally {
                this._showTyping(false);
                this.state.isSending = false;
                document.getElementById('sc-send').disabled = false;
                input.focus();
            }
        },

        // ========== Rendering ==========
        _renderAllMessages() {
            const box = document.getElementById('sc-messages');
            if (!box) return;
            // Preservar typing indicator
            const typing = box.querySelector('#sc-typing');
            box.innerHTML = '';
            this.state.messages.forEach(m => this._renderMessage(m, false));
            if (typing) box.appendChild(typing);
            this._scrollBottom();
        },

        _renderMessage(m, scroll = true) {
            const box = document.getElementById('sc-messages');
            if (!box) return;
            const typing = box.querySelector('#sc-typing');

            const div = document.createElement('div');
            div.className = `sc-msg ${m.role}`;
            div.textContent = m.content;

            if (typing) box.insertBefore(div, typing);
            else box.appendChild(div);

            if (scroll) this._scrollBottom();
        },

        _showSystemError(text) {
            this._renderMessage({ role: 'system', content: `⚠️ ${text}` });
        },

        _showTyping(show) {
            const el = document.getElementById('sc-typing');
            if (!el) return;
            el.classList.toggle('visible', !!show);
            if (show) this._scrollBottom();
        },

        _scrollBottom() {
            const box = document.getElementById('sc-messages');
            if (box) box.scrollTop = box.scrollHeight;
        },

        _updateStatusUI() {
            const pill = document.getElementById('sc-status');
            const banner = document.getElementById('sc-banner');
            const avatar = document.getElementById('sc-avatar');
            const input = document.getElementById('sc-input');
            const send = document.getElementById('sc-send');
            if (!pill) return;

            const labels = { bot: 'BOT', awaiting_human: 'EN COLA', human: 'HUMANO', closed: 'CERRADA' };
            pill.textContent = labels[this.state.status] || this.state.status;
            pill.className = 'sc-status-pill';
            if (this.state.status === 'human') pill.classList.add('human');
            else if (this.state.status === 'awaiting_human') pill.classList.add('awaiting');
            else if (this.state.status === 'closed') pill.classList.add('closed');

            // Avatar
            avatar.classList.toggle('human', this.state.status === 'human');
            avatar.textContent = this.state.status === 'human' ? '👤' : 'W';

            // Banner
            if (this.state.status === 'awaiting_human') {
                banner.textContent = 'Esperando agente humano…';
                banner.className = 'sc-banner';
            } else if (this.state.status === 'human') {
                banner.textContent = 'Conectado con un agente humano';
                banner.className = 'sc-banner human';
            } else if (this.state.status === 'closed') {
                banner.textContent = 'Conversación cerrada';
                banner.className = 'sc-banner closed';
            } else {
                banner.className = 'sc-banner hidden';
            }

            // Input
            if (this.state.status === 'closed') {
                input.disabled = true;
                input.placeholder = 'Conversación cerrada';
                send.disabled = true;
            } else {
                input.disabled = false;
                input.placeholder = 'Escribí tu mensaje…';
                send.disabled = false;
            }
        },

        _updateBadge() {
            const badge = document.getElementById('sc-fab-badge');
            if (!badge) return;
            if (this.state.unreadCount > 0) {
                badge.textContent = String(this.state.unreadCount);
                badge.classList.add('visible');
            } else {
                badge.classList.remove('visible');
            }
        },

        // ========== Panel open/close ==========
        togglePanel() {
            if (this.state.panelOpen) this.closePanel();
            else this.openPanel();
        },

        openPanel() {
            const panel = document.getElementById('sc-panel');
            if (!panel) return;
            panel.classList.add('open');
            this.state.panelOpen = true;
            this.state.unreadCount = 0;
            this._updateBadge();
            try { sessionStorage.setItem(STORAGE_OPEN_KEY, '1'); } catch {}
            setTimeout(() => {
                this._scrollBottom();
                document.getElementById('sc-input')?.focus();
            }, 60);
        },

        closePanel() {
            const panel = document.getElementById('sc-panel');
            if (!panel) return;
            panel.classList.remove('open');
            this.state.panelOpen = false;
            try { sessionStorage.removeItem(STORAGE_OPEN_KEY); } catch {}
        },

        // ========== Auth binding ==========
        _bindAuthListener() {
            if (!this.state.supabase) return;
            try {
                this.state.supabase.auth.onAuthStateChange(async (event) => {
                    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                        await this._linkAnonymous();
                    }
                });
            } catch {}
        },

        async _linkAnonymous() {
            if (!this.state.anonymousId) return;
            try {
                const headers = { 'Content-Type': 'application/json', ...(await this._authHeaders()) };
                await fetch('/api/support-chat/link-anonymous', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ anonymous_id: this.state.anonymousId })
                });
            } catch (err) {
                console.warn('[support-chat] linkAnonymous failed:', err.message);
            }
        }
    };

    // ========== Auto-init ==========
    function start() {
        SupportChat.init().catch(err => console.error('[support-chat] init error:', err));
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Expose
    window.SupportChat = SupportChat;
})();
