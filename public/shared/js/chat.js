// ============================================
// Shared Chat Module
// Handles real-time chat between clients and artists
// Can be used in both client dashboard and artist quotations panel
// ============================================

// ============================================
// Chat Manager Class
// ============================================

class ChatManager {
    constructor(supabaseClient, options = {}) {
        this._supabase = supabaseClient;
        this.currentUserId = null;
        this.userType = options.userType || 'client'; // 'client' or 'artist'
        this.currentQuotationId = null;
        this.chatChannel = null;
        this.onNewMessage = options.onNewMessage || null;
        this.onMessageRead = options.onMessageRead || null;
        this.containerSelector = options.containerSelector || '#chat-messages';
        this.inputSelector = options.inputSelector || '#chat-input';
        this.sendButtonSelector = options.sendButtonSelector || '#chat-send-btn';
    }

    // Initialize the chat manager
    async init() {
        const { data: { session } } = await this._supabase.auth.getSession();
        if (session) {
            this.currentUserId = session.user.id;
        }
        return this;
    }

    // Open chat for a specific quotation
    async openChat(quotationId) {
        if (!quotationId) return;
        
        this.currentQuotationId = quotationId;
        
        // Load existing messages
        await this.loadMessages();
        
        // Subscribe to new messages
        this.subscribeToMessages();
        
        // Setup input handlers
        this.setupInputHandlers();
    }

    // Close current chat
    closeChat() {
        if (this.chatChannel) {
            this._supabase.removeChannel(this.chatChannel);
            this.chatChannel = null;
        }
        this.currentQuotationId = null;
    }

    // Load messages for current quotation
    async loadMessages() {
        const container = document.querySelector(this.containerSelector);
        if (!container || !this.currentQuotationId) return;

        try {
            const { data: messages, error } = await this._supabase
                .from('chat_messages')
                .select('*')
                .eq('quotation_id', this.currentQuotationId)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Error loading messages:', error);
                return;
            }

            this.renderMessages(messages || []);
            
            // Mark received messages as read
            await this.markAsRead();

        } catch (error) {
            console.error('Error in loadMessages:', error);
        }
    }

    // Render messages to container
    renderMessages(messages) {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;

        if (!messages || messages.length === 0) {
            container.innerHTML = `
                <div class="chat-empty">
                    <p>${this.userType === 'client' 
                        ? 'Inicia una conversacion con el artista' 
                        : 'Inicia una conversacion con el cliente'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => this.renderMessage(msg)).join('');
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    // Render single message
    renderMessage(message) {
        const isOwn = message.sender_type === this.userType;
        const messageClass = isOwn ? this.userType : (this.userType === 'client' ? 'artist' : 'client');
        
        return `
            <div class="chat-message ${messageClass}" data-message-id="${message.id}">
                <div class="message-content">${this.escapeHtml(message.message)}</div>
                <span class="time">${this.formatTime(message.created_at)}</span>
                ${isOwn && message.is_read ? '<span class="read-indicator">✓✓</span>' : ''}
            </div>
        `;
    }

    // Add new message to chat
    addMessage(message) {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;

        // Remove empty state if present
        const emptyState = container.querySelector('.chat-empty');
        if (emptyState) {
            emptyState.remove();
        }

        const messageEl = document.createElement('div');
        const isOwn = message.sender_type === this.userType;
        const messageClass = isOwn ? this.userType : (this.userType === 'client' ? 'artist' : 'client');
        
        messageEl.className = `chat-message ${messageClass}`;
        messageEl.dataset.messageId = message.id;
        messageEl.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.message)}</div>
            <span class="time">${this.formatTime(message.created_at)}</span>
        `;

        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;

        // If message is from other party, mark as read
        if (!isOwn) {
            this.markAsRead();
        }

        // Callback
        if (this.onNewMessage) {
            this.onNewMessage(message);
        }
    }

    // Subscribe to new messages
    subscribeToMessages() {
        if (this.chatChannel) {
            this._supabase.removeChannel(this.chatChannel);
        }

        this.chatChannel = this._supabase
            .channel(`chat:${this.currentQuotationId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages',
                filter: `quotation_id=eq.${this.currentQuotationId}`
            }, (payload) => {
                this.addMessage(payload.new);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_messages',
                filter: `quotation_id=eq.${this.currentQuotationId}`
            }, (payload) => {
                // Update read status
                if (payload.new.is_read) {
                    const messageEl = document.querySelector(`[data-message-id="${payload.new.id}"]`);
                    if (messageEl && !messageEl.querySelector('.read-indicator')) {
                        const timeEl = messageEl.querySelector('.time');
                        if (timeEl) {
                            timeEl.insertAdjacentHTML('afterend', '<span class="read-indicator">✓✓</span>');
                        }
                    }
                    if (this.onMessageRead) {
                        this.onMessageRead(payload.new);
                    }
                }
            })
            .subscribe();
    }

    // Send a message
    async sendMessage(messageText) {
        if (!messageText || !this.currentQuotationId || !this.currentUserId) return false;

        try {
            const { error } = await this._supabase
                .from('chat_messages')
                .insert({
                    quotation_id: this.currentQuotationId,
                    sender_type: this.userType,
                    sender_id: this.currentUserId,
                    message: messageText.trim()
                });

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    }

    // Mark messages from other party as read
    async markAsRead() {
        if (!this.currentQuotationId || !this.currentUserId) return;

        const otherType = this.userType === 'client' ? 'artist' : 'client';

        try {
            await this._supabase
                .from('chat_messages')
                .update({ is_read: true })
                .eq('quotation_id', this.currentQuotationId)
                .eq('sender_type', otherType)
                .eq('is_read', false);

        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    }

    // Get unread count for a quotation
    async getUnreadCount(quotationId) {
        const otherType = this.userType === 'client' ? 'artist' : 'client';

        try {
            const { count } = await this._supabase
                .from('chat_messages')
                .select('*', { count: 'exact', head: true })
                .eq('quotation_id', quotationId)
                .eq('sender_type', otherType)
                .eq('is_read', false);

            return count || 0;

        } catch (error) {
            console.error('Error getting unread count:', error);
            return 0;
        }
    }

    // Get unread counts for multiple quotations
    async getUnreadCounts(quotationIds) {
        const counts = {};
        
        for (const id of quotationIds) {
            counts[id] = await this.getUnreadCount(id);
        }
        
        return counts;
    }

    // Setup input handlers
    setupInputHandlers() {
        const input = document.querySelector(this.inputSelector);
        const sendBtn = document.querySelector(this.sendButtonSelector);

        if (input) {
            // Remove existing listeners
            const newInput = input.cloneNode(true);
            input.parentNode.replaceChild(newInput, input);

            // Handle Enter key
            newInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    await this.handleSend();
                }
            });
        }

        if (sendBtn) {
            // Remove existing listeners
            const newBtn = sendBtn.cloneNode(true);
            sendBtn.parentNode.replaceChild(newBtn, sendBtn);

            newBtn.addEventListener('click', async () => {
                await this.handleSend();
            });
        }
    }

    // Handle send action
    async handleSend() {
        const input = document.querySelector(this.inputSelector);
        const sendBtn = document.querySelector(this.sendButtonSelector);
        
        if (!input) return;

        const message = input.value.trim();
        if (!message) return;

        // Disable while sending
        if (sendBtn) sendBtn.disabled = true;
        input.disabled = true;

        const success = await this.sendMessage(message);

        if (success) {
            input.value = '';
        } else {
            alert('Error al enviar el mensaje');
        }

        // Re-enable
        if (sendBtn) sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }

    // Utility: Format time
    formatTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    // Utility: Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ============================================
// Chat Notification Manager
// Handles global chat notifications
// ============================================

class ChatNotificationManager {
    constructor(supabaseClient, options = {}) {
        this._supabase = supabaseClient;
        this.userType = options.userType || 'client';
        this.onNotification = options.onNotification || null;
        this.notificationChannel = null;
    }

    // Subscribe to all incoming messages
    async subscribeToNotifications(quotationIds) {
        if (this.notificationChannel) {
            this._supabase.removeChannel(this.notificationChannel);
        }

        const otherType = this.userType === 'client' ? 'artist' : 'client';

        this.notificationChannel = this._supabase
            .channel('chat-notifications')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages',
                filter: `sender_type=eq.${otherType}`
            }, (payload) => {
                // Check if this quotation is in our list
                if (quotationIds.includes(payload.new.quotation_id)) {
                    if (this.onNotification) {
                        this.onNotification(payload.new);
                    }
                    
                    // Show browser notification if permitted
                    this.showBrowserNotification(payload.new);
                }
            })
            .subscribe();
    }

    // Request notification permission
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }

    // Show browser notification
    showBrowserNotification(message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const title = this.userType === 'client' 
                ? 'Nuevo mensaje del artista' 
                : 'Nuevo mensaje del cliente';
            
            new Notification(title, {
                body: message.message.substring(0, 100),
                icon: '/favicon.ico',
                tag: message.quotation_id
            });
        }
    }

    // Unsubscribe
    unsubscribe() {
        if (this.notificationChannel) {
            this._supabase.removeChannel(this.notificationChannel);
            this.notificationChannel = null;
        }
    }
}

// ============================================
// Export for use in other modules
// ============================================

window.ChatManager = ChatManager;
window.ChatNotificationManager = ChatNotificationManager;
