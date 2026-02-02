// ============================================
// Client Dashboard Module
// Handles quotation display, chat, and profile management
// ============================================

// Supabase Configuration
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// ============================================
// Global Variables
// ============================================

let currentClient = null;
let currentQuotations = [];
let currentFilter = 'all';
let currentQuotationId = null;
let chatChannel = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Restore preferences
    restoreZoomPreference();
    restoreThemePreference();
    restoreColorScheme();
    
    // Check authentication
    await checkDashboardAuth();
    
    // Load data
    await loadClientProfile();
    await loadQuotations();
    
    // Setup realtime subscriptions
    setupRealtimeSubscriptions();

    // Bauhaus enhancements
    initMouseTracking();
    initEntranceAnimations();
});

// ============================================
// Bauhaus Interactive Enhancements
// ============================================

function initMouseTracking() {
    const shapes = document.querySelectorAll('.bauhaus-shape');
    
    document.addEventListener('mousemove', (e) => {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        
        shapes.forEach((shape, index) => {
            const speed = (index + 1) * 20;
            const xOffset = (x - 0.5) * speed;
            const yOffset = (y - 0.5) * speed;
            
            // Get original rotation if any
            let rotation = 0;
            if (shape.classList.contains('shape-square')) rotation = 15;
            
            shape.style.transform = `translate(${xOffset}px, ${yOffset}px) rotate(${rotation}deg)`;
        });
    });
}

function initEntranceAnimations() {
    const profileBlocks = [
        '.profile-avatar-block',
        '.profile-name-block',
        '.profile-email-block',
        '.stat-item',
        '.btn-edit-profile',
        '.quick-actions-card',
        '.quotations-section'
    ];
    
    profileBlocks.forEach((selector, index) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = el.style.transform + ' translateY(20px)';
            el.style.transition = 'all 0.6s cubic-bezier(0.23, 1, 0.32, 1)';
            
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = el.style.transform.replace('translateY(20px)', 'translateY(0)');
            }, 100 * (index + 1));
        });
    });
}

// ============================================
// Authentication Check
// ============================================

async function checkDashboardAuth() {
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        
        if (!session) {
            window.location.href = '/client/login';
            return;
        }
        
        // Check if user is a client
        const { data: client, error } = await _supabase
            .from('clients_db')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();
        
        if (!client) {
            // Maybe they logged in via OAuth and need a profile
            const { error: createError } = await _supabase
                .from('clients_db')
                .insert({
                    user_id: session.user.id,
                    email: session.user.email,
                    full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0],
                    profile_picture: session.user.user_metadata?.avatar_url || null,
                    email_verified: session.user.email_confirmed_at ? true : false
                });
            
            if (createError) {
                console.error('Error creating client profile:', createError);
            }
            
            // Link quotations by email
            await linkQuotationsByEmail(session.user.id, session.user.email);
        }
        
        currentClient = client || {
            user_id: session.user.id,
            email: session.user.email,
            full_name: session.user.user_metadata?.full_name || session.user.email.split('@')[0]
        };
        
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/client/login';
    }
}

// ============================================
// Link Quotations by Email
// ============================================

async function linkQuotationsByEmail(userId, email) {
    try {
        const { data: quotations } = await _supabase
            .from('quotations_db')
            .select('quote_id')
            .ilike('client_email', email)
            .is('client_user_id', null);
        
        if (quotations && quotations.length > 0) {
            const quoteIds = quotations.map(q => q.quote_id);
            await _supabase
                .from('quotations_db')
                .update({ client_user_id: userId })
                .in('quote_id', quoteIds);
        }
    } catch (error) {
        console.error('Error linking quotations:', error);
    }
}

// ============================================
// Load Client Profile
// ============================================

async function loadClientProfile() {
    if (!currentClient) return;
    
    // Update profile display
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const avatarEl = document.getElementById('profile-avatar');
    
    if (nameEl) nameEl.textContent = currentClient.full_name || 'Cliente';
    if (emailEl) emailEl.textContent = currentClient.email || '';
    
    if (avatarEl) {
        if (currentClient.profile_picture) {
            avatarEl.innerHTML = `<img src="${currentClient.profile_picture}" alt="Avatar">`;
        } else {
            const initials = getInitials(currentClient.full_name || currentClient.email);
            avatarEl.innerHTML = `<span class="profile-avatar-placeholder">${initials}</span>`;
        }
    }
}

// ============================================
// Load Quotations
// ============================================

async function loadQuotations() {
    const listContainer = document.getElementById('quotations-list');
    if (!listContainer) return;
    
    // Show loading state
    listContainer.innerHTML = '<div class="loading-skeleton" style="height: 150px; margin-bottom: 1rem;"></div>'.repeat(3);
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        // Get quotations by client_user_id or by email
        const { data: quotations, error } = await _supabase
            .from('quotations_db')
            .select('*')
            .or(`client_user_id.eq.${session.user.id},client_email.ilike.${currentClient.email}`)
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('Error loading quotations:', error);
            listContainer.innerHTML = '<div class="empty-state"><h3>Error al cargar</h3><p>No pudimos cargar tus cotizaciones</p></div>';
            return;
        }
        
        currentQuotations = quotations || [];
        
        // Update stats
        updateStats();
        
        // Render quotations
        renderQuotations();
        
        // Load unread message counts
        await loadUnreadCounts();
        
    } catch (error) {
        console.error('Error loading quotations:', error);
    }
}

// ============================================
// Update Stats
// ============================================

function updateStats() {
    const totalEl = document.getElementById('stat-total');
    const activeEl = document.getElementById('stat-active');
    const pendingEl = document.getElementById('stat-pending');
    const completedEl = document.getElementById('stat-completed');
    
    const total = currentQuotations.length;
    const active = currentQuotations.filter(q => ['pending', 'responded'].includes(q.quote_status)).length;
    const pending = currentQuotations.filter(q => q.quote_status === 'pending').length;
    const completed = currentQuotations.filter(q => q.quote_status === 'completed').length;
    
    if (totalEl) totalEl.textContent = total;
    if (activeEl) activeEl.textContent = active;
    if (pendingEl) pendingEl.textContent = pending;
    if (completedEl) completedEl.textContent = completed;
}

// ============================================
// Render Quotations
// ============================================

function renderQuotations() {
    const listContainer = document.getElementById('quotations-list');
    if (!listContainer) return;
    
    // Filter quotations
    let filtered = currentQuotations;
    if (currentFilter !== 'all') {
        if (currentFilter === 'active') {
            filtered = currentQuotations.filter(q => ['pending', 'responded'].includes(q.quote_status));
        } else {
            filtered = currentQuotations.filter(q => q.quote_status === currentFilter);
        }
    }
    
    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <h3>Sin cotizaciones</h3>
                <p>Aun no tienes cotizaciones ${currentFilter !== 'all' ? 'en este estado' : ''}</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = filtered.map(q => renderQuotationCard(q)).join('');
}

function renderQuotationCard(quotation) {
    const statusLabels = {
        'pending': 'Pendiente',
        'responded': 'Respondida',
        'completed': 'Completada',
        'in_progress': 'En Proceso'
    };
    
    const artistInitials = getInitials(quotation.artist_name || 'AR');
    const styleInfo = typeof quotation.tattoo_style === 'object' 
        ? quotation.tattoo_style?.style_name 
        : quotation.tattoo_style;
    
    return `
        <div class="quotation-card" data-quote-id="${quotation.quote_id}">
            <div class="quotation-header">
                <span class="quotation-id">${quotation.quote_id}</span>
                <span class="quotation-status ${quotation.quote_status}">${statusLabels[quotation.quote_status] || quotation.quote_status}</span>
            </div>
            <div class="quotation-body">
                <div class="quotation-artist">
                    <div class="artist-avatar">${artistInitials}</div>
                    <div class="artist-info">
                        <h4>${quotation.artist_name || 'Artista'}</h4>
                        <p>${quotation.artist_studio_name || quotation.artist_current_city || 'Sin estudio'}</p>
                    </div>
                </div>
                <div class="quotation-details">
                    <div class="detail-item">
                        <div class="detail-label">Zona</div>
                        <div class="detail-value">${quotation.tattoo_body_part || '-'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Estilo</div>
                        <div class="detail-value">${styleInfo || '-'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Fecha</div>
                        <div class="detail-value">${formatDate(quotation.created_at)}</div>
                    </div>
                </div>
            </div>
            <div class="quotation-footer">
                <button class="quotation-btn" onclick="viewQuotationDetail('${quotation.quote_id}')">
                    Ver Detalle
                </button>
                <button class="quotation-btn chat" onclick="openChat('${quotation.quote_id}')">
                    Chat <span class="unread-badge" id="unread-${quotation.quote_id}" style="display: none;">0</span>
                </button>
            </div>
        </div>
    `;
}

// ============================================
// Load Unread Message Counts
// ============================================

async function loadUnreadCounts() {
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        // Get unread counts for each quotation
        for (const quotation of currentQuotations) {
            const { count } = await _supabase
                .from('chat_messages')
                .select('*', { count: 'exact', head: true })
                .eq('quotation_id', quotation.quote_id)
                .eq('sender_type', 'artist')
                .eq('is_read', false);
            
            const badge = document.getElementById(`unread-${quotation.quote_id}`);
            if (badge && count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-flex';
            }
        }
    } catch (error) {
        console.error('Error loading unread counts:', error);
    }
}

// ============================================
// Filter Quotations
// ============================================

function filterQuotations(filter) {
    currentFilter = filter;
    
    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    
    renderQuotations();
}

// ============================================
// View Quotation Detail
// ============================================

async function viewQuotationDetail(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation) return;
    
    currentQuotationId = quoteId;
    
    const modal = document.getElementById('quotation-modal');
    const detailContent = document.getElementById('quotation-detail-content');
    
    // Render detail content
    const styleInfo = typeof quotation.tattoo_style === 'object' 
        ? `${quotation.tattoo_style?.style_name}${quotation.tattoo_style?.substyle_name ? ' - ' + quotation.tattoo_style.substyle_name : ''}`
        : quotation.tattoo_style;
    
    detailContent.innerHTML = `
        <div class="detail-section">
            <h3 class="detail-section-title">Informacion del Tatuaje</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Zona del Cuerpo</label>
                    <span>${quotation.tattoo_body_part || '-'} ${quotation.tattoo_body_side ? `(${quotation.tattoo_body_side})` : ''}</span>
                </div>
                <div class="detail-field">
                    <label>Tamano</label>
                    <span>${quotation.tattoo_size || '-'}</span>
                </div>
                <div class="detail-field">
                    <label>Estilo</label>
                    <span>${styleInfo || '-'}</span>
                </div>
                <div class="detail-field">
                    <label>Color</label>
                    <span>${quotation.tattoo_color_type || '-'}</span>
                </div>
            </div>
            <div class="detail-field" style="margin-top: 1rem;">
                <label>Descripcion de la Idea</label>
                <span>${quotation.tattoo_idea_description || 'Sin descripcion'}</span>
            </div>
            ${quotation.tattoo_references ? `
                <div class="detail-field" style="margin-top: 1rem;">
                    <label>Referencias</label>
                    <a href="${quotation.tattoo_references}" target="_blank" style="color: var(--bauhaus-green);">Ver imagenes de referencia</a>
                </div>
            ` : ''}
        </div>
        
        <div class="detail-section">
            <h3 class="detail-section-title">Informacion del Artista</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Nombre</label>
                    <span>${quotation.artist_name || '-'}</span>
                </div>
                <div class="detail-field">
                    <label>Estudio</label>
                    <span>${quotation.artist_studio_name || '-'}</span>
                </div>
                <div class="detail-field">
                    <label>Ciudad</label>
                    <span>${quotation.artist_current_city || '-'}</span>
                </div>
                <div class="detail-field">
                    <label>Costo por Sesion</label>
                    <span>${quotation.artist_session_cost_amount || '-'}</span>
                </div>
            </div>
        </div>
        
        <div class="detail-section">
            <h3 class="detail-section-title">Preferencias</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Fecha Preferida</label>
                    <span>${quotation.client_preferred_date || 'Flexible'}</span>
                </div>
                <div class="detail-field">
                    <label>Presupuesto</label>
                    <span>${quotation.client_budget_amount ? `${quotation.client_budget_amount} ${quotation.client_budget_currency || 'USD'}` : '-'}</span>
                </div>
            </div>
        </div>
        
        <button class="expand-info-btn" onclick="toggleAdditionalInfo()" id="expand-info-btn">
            Ampliar informacion
        </button>
        
        <div class="detail-section additional-info-section" id="additional-info-section" style="display: none;">
            <h3 class="detail-section-title">Informacion Adicional</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Disponibilidad para Viajar</label>
                    <span>${quotation.client_travel_willing ? 'Si' : 'No'}</span>
                </div>
                <div class="detail-field">
                    <label>Alergias</label>
                    <span>${quotation.client_allergies || 'Ninguna'}</span>
                </div>
                <div class="detail-field">
                    <label>Condiciones de Salud</label>
                    <span>${quotation.client_health_conditions || 'Ninguna'}</span>
                </div>
            </div>
        </div>
    `;
    
    // Update modal title
    document.getElementById('modal-quote-id').textContent = quoteId;
    
    // Load chat messages
    await loadChatMessages(quoteId);
    
    // Show modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Subscribe to chat for this quotation
    subscribeToChatMessages(quoteId);
}

// ============================================
// Chat Functions
// ============================================

async function loadChatMessages(quoteId) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    
    try {
        const { data: messages, error } = await _supabase
            .from('chat_messages')
            .select('*')
            .eq('quotation_id', quoteId)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('Error loading messages:', error);
            return;
        }
        
        if (!messages || messages.length === 0) {
            chatContainer.innerHTML = `
                <div class="chat-empty">
                    <p>Inicia una conversacion con el artista</p>
                </div>
            `;
            return;
        }
        
        chatContainer.innerHTML = messages.map(msg => `
            <div class="chat-message ${msg.sender_type}">
                ${msg.message}
                <span class="time">${formatTime(msg.created_at)}</span>
            </div>
        `).join('');
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Mark messages as read
        await markMessagesAsRead(quoteId);
        
    } catch (error) {
        console.error('Error loading chat:', error);
    }
}

async function markMessagesAsRead(quoteId) {
    try {
        await _supabase
            .from('chat_messages')
            .update({ is_read: true })
            .eq('quotation_id', quoteId)
            .eq('sender_type', 'artist')
            .eq('is_read', false);
        
        // Update unread badge
        const badge = document.getElementById(`unread-${quoteId}`);
        if (badge) {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message || !currentQuotationId) return;
    
    const sendBtn = document.getElementById('chat-send-btn');
    sendBtn.disabled = true;
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        const { error } = await _supabase
            .from('chat_messages')
            .insert({
                quotation_id: currentQuotationId,
                sender_type: 'client',
                sender_id: session.user.id,
                message: message
            });
        
        if (error) throw error;
        
        // Clear input
        input.value = '';
        
        // The realtime subscription will handle adding the message to the UI
        
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Error al enviar el mensaje');
    } finally {
        sendBtn.disabled = false;
    }
}

function subscribeToChatMessages(quoteId) {
    // Unsubscribe from previous channel
    if (chatChannel) {
        _supabase.removeChannel(chatChannel);
    }
    
    // Subscribe to new messages
    chatChannel = _supabase
        .channel(`chat:${quoteId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `quotation_id=eq.${quoteId}`
        }, (payload) => {
            addMessageToChat(payload.new);
        })
        .subscribe();
}

function addMessageToChat(message) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    
    // Remove empty state if present
    const emptyState = chatContainer.querySelector('.chat-empty');
    if (emptyState) {
        emptyState.remove();
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.sender_type}`;
    messageEl.innerHTML = `
        ${message.message}
        <span class="time">${formatTime(message.created_at)}</span>
    `;
    
    chatContainer.appendChild(messageEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Mark as read if from artist
    if (message.sender_type === 'artist') {
        markMessagesAsRead(message.quotation_id);
    }
}

function openChat(quoteId) {
    viewQuotationDetail(quoteId);
    
    // Focus chat input after modal opens
    setTimeout(() => {
        const input = document.getElementById('chat-input');
        if (input) input.focus();
    }, 300);
}

// ============================================
// Toggle Additional Info
// ============================================

function toggleAdditionalInfo() {
    const section = document.getElementById('additional-info-section');
    const btn = document.getElementById('expand-info-btn');
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        btn.textContent = 'Ocultar informacion';
    } else {
        section.style.display = 'none';
        btn.textContent = 'Ampliar informacion';
    }
}

// ============================================
// Close Modal
// ============================================

function closeModal() {
    const modal = document.getElementById('quotation-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    currentQuotationId = null;
    
    // Unsubscribe from chat
    if (chatChannel) {
        _supabase.removeChannel(chatChannel);
        chatChannel = null;
    }
}

// ============================================
// Setup Realtime Subscriptions
// ============================================

function setupRealtimeSubscriptions() {
    // Subscribe to quotation updates
    _supabase
        .channel('quotations-updates')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'quotations_db'
        }, (payload) => {
            // Update local data
            const index = currentQuotations.findIndex(q => q.quote_id === payload.new.quote_id);
            if (index !== -1) {
                currentQuotations[index] = payload.new;
                updateStats();
                renderQuotations();
            }
        })
        .subscribe();
    
    // Subscribe to new messages for notifications
    _supabase
        .channel('new-messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `sender_type=eq.artist`
        }, async (payload) => {
            // Update unread count
            const badge = document.getElementById(`unread-${payload.new.quotation_id}`);
            if (badge && payload.new.quotation_id !== currentQuotationId) {
                const current = parseInt(badge.textContent) || 0;
                badge.textContent = current + 1;
                badge.style.display = 'inline-flex';
            }
        })
        .subscribe();
}

// ============================================
// Logout Handler
// ============================================

async function handleLogout() {
    try {
        await _supabase.auth.signOut();
        window.location.href = '/client/login';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ============================================
// Utility Functions
// ============================================

function getInitials(name) {
    if (!name) return '??';
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// Theme & Zoom
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
}

function restoreThemePreference() {
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.85;
}

function setZoom(factor) {
    const clampedFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clampedFactor);
    localStorage.setItem('weotzi-zoom', clampedFactor);
}

function zoomIn() {
    setZoom(getCurrentZoom() + ZOOM_STEP);
}

function zoomOut() {
    setZoom(getCurrentZoom() - ZOOM_STEP);
}

function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// Advanced Color Scheme Management
// ============================================

let currentColorScheme = {
    type: 'preset', // 'preset' or 'custom'
    scheme: 'bauhaus',
    primary: '#E23E28',
    secondary: '#1A4B8E',
    tertiary: '#F4B942',
    useTertiary: true
};
let pendingAvatarFile = null;

// Preset scheme definitions
const COLOR_PRESETS = {
    bauhaus: { primary: '#E23E28', secondary: '#1A4B8E', tertiary: '#F4B942' },
    mondrian: { primary: '#DD1C1A', secondary: '#034078', tertiary: '#FECB00' },
    ocean: { primary: '#0077B6', secondary: '#00B4D8', tertiary: '#90E0EF' },
    sunset: { primary: '#E63946', secondary: '#F77F00', tertiary: '#FCBF49' },
    forest: { primary: '#2D6A4F', secondary: '#40916C', tertiary: '#95D5B2' },
    minimal: { primary: '#1A1A1A', secondary: '#6B6B6B', tertiary: '#EBEBEB' }
};

function applyColorScheme(scheme, animate = true) {
    const root = document.documentElement;
    
    // Add transition for smooth color changes
    if (animate) {
        root.style.transition = 'all 0.4s cubic-bezier(0.19, 1, 0.22, 1)';
        document.querySelectorAll('.stat-item, .profile-avatar-block, .profile-decor-block, .profile-email-block, .bauhaus-shape').forEach(el => {
            el.style.transition = 'all 0.4s cubic-bezier(0.19, 1, 0.22, 1)';
        });
    }
    
    root.style.setProperty('--color-primary', scheme.primary);
    root.style.setProperty('--color-secondary', scheme.secondary);
    root.style.setProperty('--color-tertiary', scheme.useTertiary !== false ? scheme.tertiary : scheme.secondary);
    
    if (scheme.type === 'preset') {
        root.setAttribute('data-scheme', scheme.scheme);
    } else {
        root.removeAttribute('data-scheme');
    }
    
    currentColorScheme = { ...scheme };
    updateColorPreview();
    
    // Remove transition after animation completes
    if (animate) {
        setTimeout(() => {
            root.style.transition = '';
        }, 400);
    }
}

function restoreColorScheme() {
    const saved = localStorage.getItem('weotzi-color-scheme');
    if (saved) {
        try {
            const scheme = JSON.parse(saved);
            applyColorScheme(scheme, false); // No animation on page load
        } catch (e) {
            // Fallback to default
            applyColorScheme(currentColorScheme, false);
        }
    } else {
        applyColorScheme(currentColorScheme, false);
    }
}

function saveColorScheme() {
    localStorage.setItem('weotzi-color-scheme', JSON.stringify(currentColorScheme));
    applyColorScheme(currentColorScheme);
}

function selectPresetScheme(schemeName) {
    const preset = COLOR_PRESETS[schemeName];
    if (!preset) return;
    
    // Update scheme
    currentColorScheme = {
        type: 'preset',
        scheme: schemeName,
        primary: preset.primary,
        secondary: preset.secondary,
        tertiary: preset.tertiary,
        useTertiary: true
    };
    
    // Update UI
    document.querySelectorAll('.scheme-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scheme === schemeName);
    });
    
    // Update color pickers to match
    updateColorPickerInputs();
    applyColorScheme(currentColorScheme);
}

function updateCustomColor(colorType, value) {
    // Switch to custom mode
    currentColorScheme.type = 'custom';
    currentColorScheme.scheme = 'custom';
    currentColorScheme[colorType] = value;
    
    // Update hex display
    const hexEl = document.getElementById(`hex-${colorType}`);
    if (hexEl) hexEl.textContent = value.toUpperCase();
    
    // Remove active state from presets
    document.querySelectorAll('.scheme-preset').forEach(btn => {
        btn.classList.remove('active');
    });
    
    applyColorScheme(currentColorScheme);
}

function toggleTertiaryColor() {
    const checkbox = document.getElementById('use-tertiary');
    currentColorScheme.useTertiary = checkbox ? checkbox.checked : true;
    applyColorScheme(currentColorScheme);
}

function updateColorPickerInputs() {
    const primaryInput = document.getElementById('color-primary');
    const secondaryInput = document.getElementById('color-secondary');
    const tertiaryInput = document.getElementById('color-tertiary');
    const hexPrimary = document.getElementById('hex-primary');
    const hexSecondary = document.getElementById('hex-secondary');
    const hexTertiary = document.getElementById('hex-tertiary');
    const useTertiaryCheckbox = document.getElementById('use-tertiary');
    
    if (primaryInput) primaryInput.value = currentColorScheme.primary;
    if (secondaryInput) secondaryInput.value = currentColorScheme.secondary;
    if (tertiaryInput) tertiaryInput.value = currentColorScheme.tertiary;
    if (hexPrimary) hexPrimary.textContent = currentColorScheme.primary.toUpperCase();
    if (hexSecondary) hexSecondary.textContent = currentColorScheme.secondary.toUpperCase();
    if (hexTertiary) hexTertiary.textContent = currentColorScheme.tertiary.toUpperCase();
    if (useTertiaryCheckbox) useTertiaryCheckbox.checked = currentColorScheme.useTertiary !== false;
}

function updateColorPreview() {
    const primaryPreview = document.querySelector('.primary-preview');
    const secondaryPreview = document.querySelector('.secondary-preview');
    const tertiaryPreview = document.querySelector('.tertiary-preview');
    
    if (primaryPreview) primaryPreview.style.background = currentColorScheme.primary;
    if (secondaryPreview) secondaryPreview.style.background = currentColorScheme.secondary;
    if (tertiaryPreview) {
        tertiaryPreview.style.background = currentColorScheme.useTertiary !== false 
            ? currentColorScheme.tertiary 
            : currentColorScheme.secondary;
    }
}

function initializeColorPickers() {
    // Set active preset if applicable
    if (currentColorScheme.type === 'preset') {
        document.querySelectorAll('.scheme-preset').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.scheme === currentColorScheme.scheme);
        });
    }
    
    // Update color picker inputs
    updateColorPickerInputs();
    updateColorPreview();
}

// Legacy function for compatibility
function selectColorSwatch(color) {
    // Map old colors to new presets
    const colorMap = {
        'green': 'forest',
        'red': 'sunset',
        'blue': 'ocean',
        'yellow': 'bauhaus'
    };
    selectPresetScheme(colorMap[color] || 'bauhaus');
}

// ============================================
// Edit Profile Modal
// ============================================

function openEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    
    // Populate form with current data
    const fullNameInput = document.getElementById('edit-full-name');
    const whatsappInput = document.getElementById('edit-whatsapp');
    const cityInput = document.getElementById('edit-city');
    const avatarPreview = document.getElementById('avatar-preview');
    const placeholder = document.getElementById('avatar-preview-placeholder');
    
    if (fullNameInput && currentClient) {
        fullNameInput.value = currentClient.full_name || '';
    }
    if (whatsappInput && currentClient) {
        whatsappInput.value = currentClient.whatsapp || '';
    }
    if (cityInput && currentClient) {
        cityInput.value = currentClient.city_residence || '';
    }
    
    // Set avatar preview
    if (avatarPreview && currentClient) {
        if (currentClient.profile_picture) {
            avatarPreview.innerHTML = `
                <img src="${currentClient.profile_picture}" alt="Avatar">
                <div class="avatar-loading" id="avatar-loading"><div class="spinner"></div></div>
            `;
        } else {
            const initials = getInitials(currentClient.full_name || currentClient.email);
            avatarPreview.innerHTML = `
                <span class="avatar-preview-placeholder">${initials}</span>
                <div class="avatar-loading" id="avatar-loading"><div class="spinner"></div></div>
            `;
        }
    }
    
    // Initialize color pickers with current scheme
    initializeColorPickers();
    
    // Reset pending avatar
    pendingAvatarFile = null;
    
    // Show modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    pendingAvatarFile = null;
    
    // Reset file input
    const fileInput = document.getElementById('avatar-input');
    if (fileInput) fileInput.value = '';
}

function handleAvatarPreview(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Por favor selecciona una imagen.');
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('La imagen es muy grande. Maximo 5MB.');
        return;
    }
    
    // Store for later upload
    pendingAvatarFile = file;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatarPreview = document.getElementById('avatar-preview');
        avatarPreview.innerHTML = `
            <img src="${e.target.result}" alt="Preview">
            <div class="avatar-loading" id="avatar-loading"><div class="spinner"></div></div>
        `;
    };
    reader.readAsDataURL(file);
}

async function handleProfileUpdate(event) {
    event.preventDefault();
    
    const saveBtn = document.getElementById('btn-save-profile');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            alert('Sesion expirada. Por favor inicia sesion nuevamente.');
            window.location.href = '/client/login';
            return;
        }
        
        const fullName = document.getElementById('edit-full-name').value.trim();
        const whatsapp = document.getElementById('edit-whatsapp').value.trim();
        const city = document.getElementById('edit-city').value.trim();
        
        let profilePictureUrl = currentClient.profile_picture;
        
        // Upload avatar if there's a pending file
        if (pendingAvatarFile) {
            const loadingEl = document.getElementById('avatar-loading');
            if (loadingEl) loadingEl.classList.add('active');
            
            try {
                // Generate unique filename
                const fileExt = pendingAvatarFile.name.split('.').pop();
                const fileName = `${Date.now()}.${fileExt}`;
                const filePath = `${session.user.id}/${fileName}`;
                
                // Upload to Supabase Storage
                const { data: uploadData, error: uploadError } = await _supabase.storage
                    .from('profile-pictures')
                    .upload(filePath, pendingAvatarFile, {
                        cacheControl: '3600',
                        upsert: true
                    });
                
                if (uploadError) {
                    console.error('Upload error:', uploadError);
                    if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('not found')) {
                        alert('El almacenamiento de fotos no esta configurado. Contacta al administrador.');
                    } else {
                        throw uploadError;
                    }
                } else {
                    // Get public URL
                    const { data: urlData } = _supabase.storage
                        .from('profile-pictures')
                        .getPublicUrl(filePath);
                    
                    profilePictureUrl = urlData.publicUrl;
                }
            } finally {
                if (loadingEl) loadingEl.classList.remove('active');
            }
        }
        
        // Update client record
        const updateData = {
            full_name: fullName || currentClient.full_name,
            whatsapp: whatsapp || null,
            city_residence: city || null
        };
        
        if (profilePictureUrl) {
            updateData.profile_picture = profilePictureUrl;
        }
        
        const { error: updateError } = await _supabase
            .from('clients_db')
            .update(updateData)
            .eq('user_id', session.user.id);
        
        if (updateError) {
            console.error('Update error:', updateError);
            throw updateError;
        }
        
        // Update local state
        currentClient = {
            ...currentClient,
            ...updateData
        };
        
        // Save color scheme
        saveColorScheme();
        
        // Update UI
        loadClientProfile();
        
        // Close modal
        closeEditProfileModal();
        
        // Show success message (brief visual feedback)
        saveBtn.textContent = 'Guardado!';
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }, 1000);
        
    } catch (error) {
        console.error('Error updating profile:', error);
        alert('Error al guardar los cambios. Por favor intenta de nuevo.');
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

// Handle Enter key in chat input and Escape for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement.id === 'chat-input') {
        e.preventDefault();
        sendChatMessage();
    }
    
    if (e.key === 'Escape') {
        closeModal();
        closeEditProfileModal();
    }
});
