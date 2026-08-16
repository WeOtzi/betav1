// ============================================
// Client Dashboard Module
// Handles quotation display, chat, and profile management
// ============================================

// Supabase Configuration
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

// ============================================
// Global Variables
// ============================================

let currentClient = null;
let currentQuotations = [];
let currentFilter = 'all';
let currentQuotationId = null;
let chatChannel = null;
// Total de mensajes del artista sin leer (contador "Mensajes nuevos" del Figma)
let unreadMessagesTotal = 0;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    await checkDashboardAuth();

    // Load data
    await loadClientProfile();
    await loadQuotations();

    // Job board: alimenta "Publicaciones activas" / "Propuestas recibidas"
    // aunque el panel de solicitudes esté colapsado.
    await loadJobBoardRequests();
    updateStats();

    // Feed de actividad + artistas sugeridos (bloques del Figma del dashboard)
    loadActivityFeed();
    loadSuggestedArtists();

    // Setup realtime subscriptions
    setupRealtimeSubscriptions();
});

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
        const { data: client, error } = await WeotziData.Clients.getByUserId(session.user.id);

        if (!client) {
            // Check if user is an artist first - artists should not access client dashboard
            const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id');

            if (artist) {
                // User is an artist, redirect to artist dashboard
                window.location.href = '/artist/dashboard';
                return;
            }
            
            // Not an artist - maybe they logged in via OAuth and need a profile
            const { error: createError } = await WeotziData.Clients.insert({
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
        const quotations = await WeotziData.Quotations.findUnclaimedByEmail(email);

        if (quotations && quotations.length > 0) {
            const quoteIds = quotations.map(q => q.quote_id);
            await WeotziData.Quotations.claimByQuoteIds(userId, quoteIds);
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

    // El Figma del dashboard no tiene card de "Centro de cuenta": el acceso es el
    // tile Ö de la topbar. Acá sólo se pintan el saludo del hero y ese tile.

    // Saludo del hero (voseo, según hora local)
    const greetingEl = document.getElementById('hero-greeting');
    if (greetingEl) {
        const hour = new Date().getHours();
        const saludo = hour < 13 ? 'Buen día' : (hour < 20 ? 'Buenas tardes' : 'Buenas noches');
        const firstName = (currentClient.full_name || '').trim().split(/\s+/)[0];
        greetingEl.textContent = firstName ? `${saludo}, ${firstName}` : saludo;
    }

    // Tile de perfil en la topbar
    const tileEl = document.getElementById('topbar-avatar');
    if (tileEl) {
        if (currentClient.profile_picture) {
            tileEl.innerHTML = `<img src="${currentClient.profile_picture}" alt="">`;
        } else {
            tileEl.textContent = getInitials(currentClient.full_name || currentClient.email);
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
    listContainer.innerHTML = '<div class="loading-skeleton"></div>'.repeat(3);
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        // Get quotations by client_user_id or by email, excluding client-hidden ones
        let quotations;
        try {
            quotations = await WeotziData.Quotations.listForClient(session.user.id, currentClient.email);
        } catch (error) {
            console.error('Error loading quotations:', error);
            listContainer.innerHTML = '<div class="empty-state"><i data-wo-icon="alert-triangle"></i><h3>Error al cargar</h3><p>No pudimos cargar tus cotizaciones</p></div>';
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

// Los 4 contadores del Figma cruzan los dominios del cliente:
// cotizaciones · chat · publicaciones del job board · propuestas recibidas.
function updateStats() {
    const pendingQuotesEl = document.getElementById('stat-pending-quotes');
    const newMessagesEl = document.getElementById('stat-new-messages');
    const activePostsEl = document.getElementById('stat-active-posts');
    const proposalsEl = document.getElementById('stat-proposals');

    const pendingQuotes = currentQuotations.filter(q => q.quote_status === 'pending').length;
    const activePosts = jbRequests.filter(r => r.status === 'open' || r.status === 'in_review').length;
    const proposals = jbRequests.reduce((sum, r) => sum + ((r.job_board_applications || []).length), 0);

    if (pendingQuotesEl) pendingQuotesEl.textContent = pendingQuotes;
    if (newMessagesEl) newMessagesEl.textContent = unreadMessagesTotal;
    if (activePostsEl) activePostsEl.textContent = activePosts;
    if (proposalsEl) proposalsEl.textContent = proposals;
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
            filtered = currentQuotations.filter(q => ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed'].includes(q.quote_status));
        } else {
            filtered = currentQuotations.filter(q => q.quote_status === currentFilter);
        }
    }
    
    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i data-wo-icon="file-text"></i>
                <h3>Sin cotizaciones</h3>
                <p>Todavía no tenés cotizaciones${currentFilter !== 'all' ? ' en este estado' : ''}</p>
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
        'client_approved': 'Aprobada',
        'client_rejected': 'Rechazada',
        'artist_completed': 'Por finalizar',
        'completed': 'Completada',
        'in_progress': 'En proceso'
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
                        <div class="detail-value">${quotation.tattoo_body_part || '–'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Estilo</div>
                        <div class="detail-value">${styleInfo || '–'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Fecha</div>
                        <div class="detail-value">${formatDate(quotation.created_at)}</div>
                    </div>
                </div>
            </div>
            <div class="quotation-footer">
                <button class="wo-btn wo-btn--s" onclick="openChat('${quotation.quote_id}')">
                    Chat <span class="unread-badge" id="unread-${quotation.quote_id}" style="display: none;">0</span>
                </button>
                <button class="wo-btn wo-btn--ghost wo-btn--s" onclick="viewQuotationDetail('${quotation.quote_id}')">
                    Ver detalle
                </button>
                <button class="wo-btn wo-btn--ghost wo-btn--s btn-borrar" onclick="hideQuotation('${quotation.quote_id}')">
                    Borrar
                </button>
            </div>
        </div>
    `;
}

// ============================================
// Hide Quotation (client-only soft delete)
// ============================================

async function hideQuotation(quoteId) {
    if (!confirm('¿Seguro que querés borrar esta cotización?')) {
        return;
    }

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;

        await WeotziData.Api.hideForClient(quoteId, session.access_token);

        currentQuotations = currentQuotations.filter(q => q.quote_id !== quoteId);
        updateStats();
        renderQuotations();

        if (currentQuotationId === quoteId) {
            closeModal();
        }

    } catch (error) {
        console.error('Error hiding quotation:', error);
        alert('No se pudo borrar la cotización: ' + error.message);
    }
}

// ============================================
// Load Unread Message Counts
// ============================================

async function loadUnreadCounts() {
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        // Get unread counts for all quotations in a single batched query
        const quoteIds = currentQuotations.map(q => q.quote_id);
        const counts = await WeotziData.Chat.countUnreadByQuotationIds(quoteIds, 'artist');

        unreadMessagesTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);

        for (const quotation of currentQuotations) {
            const count = counts[quotation.quote_id] || 0;
            const badge = document.getElementById(`unread-${quotation.quote_id}`);
            if (badge && count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-flex';
            }
        }

        updateStats();
    } catch (error) {
        console.error('Error loading unread counts:', error);
    }
}

// ============================================
// Feed de actividad (columna izquierda de "Tu actividad")
// Eventos reales: historial de estado de cotizaciones + mensajes del artista
// sin leer + postulaciones recibidas en el job board. Sin tabla de
// notificaciones, el feed se deriva de esas tres fuentes.
// ============================================

const FEED_MAX_ROWS = 4;

function escapeFeedHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// "Hace 2h" / "Hace 1d" — formato mono del Figma.
function formatRelative(dateStr) {
    if (!dateStr) return '';
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return 'Recién';
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `Hace ${days}d`;
    const months = Math.round(days / 30);
    return `Hace ${months}me`;
}

const FEED_STATUS_EVENTS = {
    responded: { icon: 'message-square', text: (artist) => `${artist} te respondió tu cotización` },
    client_approved: { icon: 'check-circle', text: (artist) => `Tu cotización con ${artist} quedó confirmada` },
    in_progress: { icon: 'check-circle', text: (artist) => `Tu cotización con ${artist} quedó confirmada` },
    artist_completed: { icon: 'check-circle', text: (artist) => `${artist} marcó tu tatuaje como terminado` },
    completed: { icon: 'check-circle', text: (artist) => `Tu tatuaje con ${artist} quedó finalizado` }
};

async function loadActivityFeed() {
    const container = document.getElementById('activity-feed');
    if (!container) return;

    try {
        const events = [];
        const quoteIds = currentQuotations.map(q => q.quote_id).filter(Boolean);
        const artistByQuote = {};
        currentQuotations.forEach(q => { artistByQuote[q.quote_id] = q.artist_name || 'El artista'; });

        if (quoteIds.length) {
            // Cambios de estado (quotation_status_history)
            const { data: history } = await WeotziData
                .from('quotation_status_history')
                .select('quote_id, new_status, changed_at')
                .in('quote_id', quoteIds)
                .order('changed_at', { ascending: false })
                .limit(30);

            (history || []).forEach(row => {
                const spec = FEED_STATUS_EVENTS[row.new_status];
                if (!spec) return;
                events.push({
                    at: row.changed_at,
                    icon: spec.icon,
                    text: spec.text(artistByQuote[row.quote_id] || 'El artista')
                });
            });

            // Mensajes del artista sin leer (chat_messages)
            const { data: messages } = await WeotziData
                .from('chat_messages')
                .select('quotation_id, created_at')
                .in('quotation_id', quoteIds)
                .eq('sender_type', 'artist')
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(20);

            const seenQuote = new Set();
            (messages || []).forEach(row => {
                if (seenQuote.has(row.quotation_id)) return;
                seenQuote.add(row.quotation_id);
                events.push({
                    at: row.created_at,
                    icon: 'mail',
                    text: `Nuevo mensaje de ${artistByQuote[row.quotation_id] || 'un artista'}`
                });
            });
        }

        // Postulaciones recibidas en el job board
        jbRequests.forEach(req => {
            (req.job_board_applications || []).forEach(app => {
                events.push({
                    at: app.created_at,
                    icon: 'briefcase',
                    text: 'Recibiste una propuesta en tu publicación'
                });
            });
        });

        renderActivityFeed(events);
    } catch (error) {
        console.error('Error loading activity feed:', error);
        renderActivityFeed([]);
    }
}

function renderActivityFeed(events) {
    const container = document.getElementById('activity-feed');
    if (!container) return;

    const rows = events
        .filter(e => e.at)
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, FEED_MAX_ROWS);

    if (rows.length === 0) {
        container.innerHTML = '<p class="client-feed-empty">Todavía no hay movimientos. Cuando un artista te responda o recibas una propuesta, lo vas a ver acá.</p>';
        return;
    }

    container.innerHTML = rows.map(row => `
        <div class="client-feed-row">
            <span class="client-feed-icon"><i data-wo-icon="${row.icon}"></i></span>
            <span class="client-feed-text">${escapeFeedHtml(row.text)}</span>
            <span class="client-feed-time">${escapeFeedHtml(formatRelative(row.at))}</span>
        </div>
    `).join('');
}

// ============================================
// Artistas para vos
// Orden real por artist_index (el mismo ranking que usa el marketplace).
// Badges derivados de datos reales: cercanía por ciudad/país del cliente,
// guest activo en artist_tattoo_locations y el flag is_recommended.
// Rating desde public_review_summary (se omite si el artista no tiene reseñas).
// ============================================

const SUGGESTED_ARTISTS_COUNT = 3;
const SUGGESTED_SELECT = 'user_id, username, name, profile_picture, styles_array, ' +
    'city, country, ubicacion, is_recommended, artist_index';

function normalizePlace(value) {
    return String(value || '').trim().toLowerCase();
}

function parseArtistStyles(styles) {
    if (!styles) return [];
    if (Array.isArray(styles)) return styles;
    if (typeof styles === 'string') {
        try {
            if (styles.trim().startsWith('[')) return JSON.parse(styles);
        } catch (e) { /* cae al split */ }
        return styles.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

async function loadSuggestedArtists() {
    const section = document.getElementById('artistas-para-vos');
    const grid = document.getElementById('suggested-artists');
    if (!section || !grid) return;

    try {
        const { data: artists, error } = await WeotziData.Artists.listPublic(SUGGESTED_SELECT);
        if (error) throw error;
        if (!artists || artists.length === 0) return;

        const ranked = artists
            .slice()
            .sort((a, b) => (b.artist_index || 0) - (a.artist_index || 0))
            .slice(0, SUGGESTED_ARTISTS_COUNT);
        if (ranked.length === 0) return;

        const userIds = ranked.map(a => a.user_id).filter(Boolean);

        // Guests activos hoy (period_type = 'upcoming' con el rango en curso)
        const today = new Date().toISOString().slice(0, 10);
        const guestNow = new Set();
        if (userIds.length) {
            const { data: locations } = await WeotziData
                .from('artist_tattoo_locations')
                .select('artist_user_id, start_date, end_date')
                .in('artist_user_id', userIds)
                .eq('period_type', 'upcoming')
                .lte('start_date', today)
                .gte('end_date', today);
            (locations || []).forEach(l => guestNow.add(l.artist_user_id));
        }

        // Rating público agregado
        const ratings = {};
        if (userIds.length) {
            const { data: summaries } = await WeotziData
                .from('public_review_summary')
                .select('reviewee_user_id, average_rating, review_count')
                .eq('reviewee_type', 'artist')
                .in('reviewee_user_id', userIds);
            (summaries || []).forEach(s => { ratings[s.reviewee_user_id] = s; });
        }

        const clientCity = normalizePlace(currentClient && currentClient.city_residence);
        const clientCountry = normalizePlace(currentClient && currentClient.country);

        grid.innerHTML = ranked.map(artist => {
            const city = (artist.city || (artist.ubicacion || '').split(',')[0] || '').trim();
            const place = [city, artist.country].filter(Boolean).join(', ');
            const isNear = (clientCity && normalizePlace(city) === clientCity) ||
                (clientCountry && normalizePlace(artist.country) === clientCountry);

            let badge = '';
            if (isNear) badge = '<span class="client-suggested-badge client-suggested-badge--near">Cerca de vos</span>';
            else if (guestNow.has(artist.user_id)) badge = '<span class="client-suggested-badge client-suggested-badge--guest">Guest artist</span>';
            else if (artist.is_recommended) badge = '<span class="client-suggested-badge client-suggested-badge--reco">Recomendado</span>';

            const summary = ratings[artist.user_id];
            const rating = summary && summary.average_rating
                ? `<span class="client-suggested-rating"><i data-wo-icon="star"></i>${Number(summary.average_rating).toFixed(1)}</span>`
                : '';

            const styles = parseArtistStyles(artist.styles_array).slice(0, 2)
                .map(s => `<span class="client-suggested-style">${escapeFeedHtml(s)}</span>`).join('');

            const href = `/artist/profile?artist=${encodeURIComponent(artist.username || '')}`;
            const name = escapeFeedHtml(artist.name || artist.username || 'Artista');

            return `
                <a class="client-suggested-card" href="${href}">
                    <div class="client-suggested-media">
                        <i data-wo-icon="image" class="client-suggested-ph" aria-hidden="true"></i>
                        ${artist.profile_picture ? `<img src="${escapeFeedHtml(artist.profile_picture)}" alt="${name}" loading="lazy" onerror="this.remove();">` : ''}
                        ${badge}
                    </div>
                    <div class="client-suggested-head">
                        <h3 class="client-suggested-name">${name}</h3>
                        ${rating}
                    </div>
                    ${place ? `<p class="client-suggested-place"><i data-wo-icon="map-pin"></i>${escapeFeedHtml(place)}</p>` : ''}
                    ${styles ? `<div class="client-suggested-styles">${styles}</div>` : ''}
                </a>
            `;
        }).join('');

        section.hidden = false;
    } catch (error) {
        console.error('Error loading suggested artists:', error);
    }
}

// Abre el widget de soporte (links "Soporte" / "Centro de ayuda" del footer)
function openSupportChat() {
    if (window.SupportChat && typeof window.SupportChat.openPanel === 'function') {
        window.SupportChat.openPanel();
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
            <h3 class="detail-section-title">Información del tatuaje</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Zona del cuerpo</label>
                    <span>${quotation.tattoo_body_part || '–'} ${quotation.tattoo_body_side ? `(${quotation.tattoo_body_side})` : ''}</span>
                </div>
                <div class="detail-field">
                    <label>Tamaño</label>
                    <span>${quotation.tattoo_size || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Estilo</label>
                    <span>${styleInfo || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Color</label>
                    <span>${quotation.tattoo_color_type || '–'}</span>
                </div>
            </div>
            <div class="detail-field" style="margin-top: var(--space-4);">
                <label>Descripción de la idea</label>
                <span>${quotation.tattoo_idea_description || 'Sin descripción'}</span>
            </div>
            ${quotation.tattoo_references ? `
                <div class="detail-field" style="margin-top: var(--space-4);">
                    <label>Referencias</label>
                    <a href="${quotation.tattoo_references}" target="_blank" class="detail-link">Ver imágenes de referencia →</a>
                </div>
            ` : ''}
        </div>

        <div class="detail-section">
            <h3 class="detail-section-title">Información del artista</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Nombre</label>
                    <span>${quotation.artist_name || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Estudio</label>
                    <span>${quotation.artist_studio_name || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Ciudad</label>
                    <span>${quotation.artist_current_city || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Costo por sesión</label>
                    <span>${quotation.artist_session_cost_amount || '–'}</span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <h3 class="detail-section-title">Preferencias</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Fecha preferida</label>
                    <span>${quotation.client_preferred_date || 'Flexible'}</span>
                </div>
                <div class="detail-field">
                    <label>Presupuesto</label>
                    <span>${quotation.client_budget_amount ? `${quotation.client_budget_amount} ${quotation.client_budget_currency || 'USD'}` : '–'}</span>
                </div>
            </div>
        </div>

        <button class="expand-info-btn" onclick="toggleAdditionalInfo()" id="expand-info-btn">
            Ampliar información
        </button>

        ${renderReviewWorkflowPanel(quotation)}

        <div class="detail-section additional-info-section" id="additional-info-section" style="display: none;">
            <h3 class="detail-section-title">Información adicional</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Disponibilidad para viajar</label>
                    <span>${quotation.client_travel_willing ? 'Sí' : 'No'}</span>
                </div>
                <div class="detail-field">
                    <label>Alergias</label>
                    <span>${quotation.client_allergies || 'Ninguna'}</span>
                </div>
                <div class="detail-field">
                    <label>Condiciones de salud</label>
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

function getQuotationDisputeStatus(quotation) {
    return quotation.dispute_status || 'none';
}

function renderReviewWorkflowPanel(quotation) {
    const disputeStatus = getQuotationDisputeStatus(quotation);
    if (disputeStatus === 'open') {
        return `
            <div class="review-completion-panel">
                <p>Esta cotización tiene un reclamo abierto. No se puede finalizar ni reseñar hasta que soporte lo resuelva.</p>
            </div>
        `;
    }

    if (quotation.quote_status === 'artist_completed') {
        return `
            <div class="review-completion-panel">
                <p>El artista marcó el trabajo como terminado. Confirmá el cierre si el servicio se entregó correctamente.</p>
                <div class="review-completion-actions">
                    <button type="button" class="review-finalize-btn" onclick="acceptQuotationCompletion('${quotation.quote_id}')">Aceptar finalización</button>
                </div>
            </div>
        `;
    }

    if (quotation.quote_status === 'completed') {
        const studioId = quotation.studio_id || quotation.artist_studio_id || quotation.artist_studio_user_id || '';
        return `
            <div class="review-completion-panel">
                <p>Trabajo finalizado. Podés dejar reseñas verificadas de esta experiencia.</p>
                <div class="review-completion-actions">
                    ${quotation.artist_id ? `<button type="button" class="review-write-btn" onclick="openQuotationArtistReview('${quotation.quote_id}')">Reseñar artista</button>` : ''}
                    ${studioId ? `<button type="button" class="review-write-btn" onclick="openQuotationStudioReview('${quotation.quote_id}')">Reseñar estudio</button>` : ''}
                </div>
            </div>
        `;
    }

    return '';
}

async function acceptQuotationCompletion(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation) return;

    if (!confirm('¿Confirmás que el trabajo se finalizó correctamente?')) return;

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            window.location.href = '/client/login';
            return;
        }

        const result = await WeotziData.Api.confirmCompletionByClient(quoteId, session.access_token);

        quotation.quote_status = 'completed';
        quotation.client_completed_at = result.client_completed_at || new Date().toISOString();
        quotation.completed_by_client_user_id = session.user.id;
        updateStats();
        renderQuotations();
        await viewQuotationDetail(quoteId);
    } catch (error) {
        console.error('Error accepting completion:', error);
        alert(error.message || 'No se pudo finalizar la cotización');
    }
}

function openQuotationArtistReview(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation || !window.WeOtziReviews) return;
    if (getQuotationDisputeStatus(quotation) === 'open') {
        alert('No se puede reseñar mientras exista un reclamo abierto.');
        return;
    }
    if (!quotation.id || !quotation.artist_id) {
        alert('Esta cotización no tiene datos suficientes para crear una reseña verificada.');
        return;
    }

    window.WeOtziReviews.openReviewModal({
        title: `Calificar a ${quotation.artist_name || 'artista'}`,
        contextType: 'quotation',
        contextId: quotation.id,
        revieweeType: 'artist',
        revieweeUserId: quotation.artist_id,
        revieweeDisplayName: quotation.artist_name || 'Artista'
    });
}

function openQuotationStudioReview(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation || !window.WeOtziReviews) return;
    const studioId = quotation.studio_id || quotation.artist_studio_id || quotation.artist_studio_user_id;
    if (!studioId) {
        alert('Esta cotización no tiene un estudio vinculado para reseñar.');
        return;
    }

    window.WeOtziReviews.openReviewModal({
        title: `Calificar a ${quotation.artist_studio_name || 'estudio'}`,
        contextType: 'quotation',
        contextId: quotation.id,
        revieweeType: 'studio',
        revieweeUserId: studioId,
        revieweeDisplayName: quotation.artist_studio_name || 'Estudio'
    });
}

// ============================================
// Chat Functions
// ============================================

async function loadChatMessages(quoteId) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    
    try {
        let messages;
        try {
            messages = await WeotziData.Chat.listByQuote(quoteId);
        } catch (error) {
            console.error('Error loading messages:', error);
            return;
        }

        if (!messages || messages.length === 0) {
            chatContainer.innerHTML = `
                <div class="chat-empty">
                    <p>Iniciá la conversación con el artista</p>
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
        await WeotziData.Chat.markRead(quoteId, 'artist');

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
        
        await WeotziData.Chat.sendMessage({
            quoteId: currentQuotationId,
            senderType: 'client',
            senderId: session.user.id,
            message: message
        });

        // Clear input
        input.value = '';
        
        try {
            const currentQuote = currentQuotations.find(q => q.quote_id === currentQuotationId);
            window.ConfigManager.sendN8NEvent('chat_message_to_artist', {
                quote_id: currentQuotationId,
                artist_name: currentQuote ? (currentQuote.artist_name || '') : '',
                artist_email: currentQuote ? (currentQuote.artist_email || '') : '',
                client_name: currentClient ? (currentClient.full_name || '') : '',
                message_preview: message.substring(0, 100)
            });
        } catch (e) { /* n8n notification failure should not break main flow */ }
        
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
        WeotziData.Realtime.remove(chatChannel);
    }

    // Subscribe to new messages
    chatChannel = WeotziData.Realtime.subscribeChatMessages(`chat:${quoteId}`, quoteId, (payload) => {
        addMessageToChat(payload.new);
    });
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
        btn.textContent = 'Ocultar información';
    } else {
        section.style.display = 'none';
        btn.textContent = 'Ampliar información';
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
        WeotziData.removeChannel(chatChannel);
        chatChannel = null;
    }
}

// ============================================
// Setup Realtime Subscriptions
// ============================================

function setupRealtimeSubscriptions() {
    // Subscribe to quotation updates
    WeotziData.Realtime.subscribeQuotationUpdates('quotations-updates', (payload) => {
        // Update local data
        const index = currentQuotations.findIndex(q => q.quote_id === payload.new.quote_id);
        if (index !== -1) {
            currentQuotations[index] = payload.new;
            updateStats();
            renderQuotations();
        }
    });

    // Subscribe to new messages for notifications
    WeotziData.Realtime.subscribeNewChatFromSender('new-messages', 'artist', async (payload) => {
        // Update unread count
        const badge = document.getElementById(`unread-${payload.new.quotation_id}`);
        if (badge && payload.new.quotation_id !== currentQuotationId) {
            const current = parseInt(badge.textContent) || 0;
            badge.textContent = current + 1;
            badge.style.display = 'inline-flex';
        }
    });
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

function normalizePublicUsername(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 32);
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
// Esquema de color — paleta fija del Design System
// Los esquemas personalizados guardados en perfiles viejos se ignoran:
// el DS Bauhaus define los colores por token y no se customiza por usuario.
// ============================================

let pendingAvatarFile = null;

function applyColorScheme() { /* no-op: el DS aplica siempre su paleta fija */ }
function restoreColorScheme() { /* no-op: se ignoran esquemas guardados */ }
function selectColorSwatch() { /* legacy no-op */ }

// ============================================
// Edit Profile Modal
// ============================================

function openEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    
    // Populate form with current data
    const fullNameInput = document.getElementById('edit-full-name');
    const publicUsernameInput = document.getElementById('edit-public-username');
    const countryInput = document.getElementById('edit-country');
    const whatsappInput = document.getElementById('edit-whatsapp');
    const cityInput = document.getElementById('edit-city');
    const avatarPreview = document.getElementById('avatar-preview');
    const placeholder = document.getElementById('avatar-preview-placeholder');
    
    if (fullNameInput && currentClient) {
        fullNameInput.value = currentClient.full_name || '';
    }
    if (publicUsernameInput && currentClient) {
        publicUsernameInput.value = currentClient.public_username || '';
    }
    if (countryInput && currentClient) {
        countryInput.value = currentClient.country || '';
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
        alert('Elegí una imagen.');
        return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('La imagen es muy grande. Máximo 5MB.');
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
    saveBtn.textContent = 'Guardando…';
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            alert('Sesión expirada. Iniciá sesión de nuevo.');
            window.location.href = '/client/login';
            return;
        }
        
        const fullName = document.getElementById('edit-full-name').value.trim();
        const publicUsername = normalizePublicUsername(document.getElementById('edit-public-username')?.value || '');
        const country = document.getElementById('edit-country')?.value.trim() || '';
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
            public_username: publicUsername || null,
            country: country || null,
            public_profile_enabled: true,
            whatsapp: whatsapp || null,
            city_residence: city || null
        };

        if ((fullName || currentClient.full_name) && publicUsername && country) {
            updateData.profile_completed_at = currentClient.profile_completed_at || new Date().toISOString();
        }
        
        if (profilePictureUrl) {
            updateData.profile_picture = profilePictureUrl;
        }
        
        const { error: updateError } = await WeotziData.Clients.updateByUserId(session.user.id, updateData);
        
        if (updateError) {
            console.error('Update error:', updateError);
            throw updateError;
        }
        
        // Update local state
        currentClient = {
            ...currentClient,
            ...updateData
        };

        // Update UI
        loadClientProfile();

        // Close modal
        closeEditProfileModal();

        // Show success message (brief visual feedback)
        saveBtn.textContent = 'Guardado';
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }, 1000);

    } catch (error) {
        console.error('Error updating profile:', error);
        alert('No se pudieron guardar los cambios. Probá de nuevo.');
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

// ============================================
// JOB BOARD - CLIENT REQUESTS & APPLICATIONS
// ============================================

let jbRequests = [];
let jbCurrentRequest = null;

// El Figma del dashboard no embebe la lista de cotizaciones: se llega desde el
// nav (COTIZACIONES / JOB BOARD) y desde los contadores. Este helper revela el
// panel y lo trae a la vista.
function revealQuotationsPanel() {
    const panel = document.getElementById('mis-cotizaciones');
    if (!panel) return;
    panel.classList.remove('is-collapsed');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Switch to Job Board tab
function switchToJobBoard() {
    revealQuotationsPanel();

    // Update tab active states
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const jbTab = document.querySelector('[data-filter="job-board"]');
    if (jbTab) jbTab.classList.add('active');

    // Hide quotations, show JB
    const list = document.getElementById('quotations-list');
    const jbList = document.getElementById('jb-requests-list');
    if (list) list.style.display = 'none';
    if (jbList) jbList.style.display = 'block';

    loadJobBoardRequests();
}

// Switch back to quotations
function switchToQuotations(filter) {
    revealQuotationsPanel();
    const list = document.getElementById('quotations-list');
    const jbList = document.getElementById('jb-requests-list');
    if (list) list.style.display = 'block';
    if (jbList) jbList.style.display = 'none';
    filterQuotations(filter);
}

// Override filterQuotations to handle JB tab switching
const _originalFilterQuotations = typeof filterQuotations === 'function' ? filterQuotations : null;
function filterQuotationsOverride(filter) {
    if (filter === 'job-board') {
        switchToJobBoard();
        return;
    }
    // Show quotations, hide JB
    document.getElementById('quotations-list').style.display = 'block';
    document.getElementById('jb-requests-list').style.display = 'none';
    if (_originalFilterQuotations) _originalFilterQuotations(filter);
}
// Re-wire if original exists
if (_originalFilterQuotations) {
    window.filterQuotations = filterQuotationsOverride;
}

async function loadJobBoardRequests() {
    if (!_supabase) return;

    const container = document.getElementById('jb-requests-list');
    container.innerHTML = '<div class="loading-skeleton"></div>';

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;

        const { data, error } = await WeotziData
            .from('job_board_requests')
            .select('*, job_board_applications(id, artist_id, status, message, estimated_price, estimated_sessions, availability_note, created_at), job_board_attachments(id, file_url)')
            .eq('client_user_id', session.user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        jbRequests = data || [];

        // Update badge
        const badge = document.getElementById('jb-requests-count');
        if (badge && jbRequests.length > 0) {
            badge.textContent = jbRequests.length;
            badge.style.display = 'inline-flex';
        }

        updateStats();
        renderJobBoardRequests();
    } catch (err) {
        console.error('Error loading JB requests:', err);
        container.innerHTML = '<div class="empty-state"><i data-wo-icon="alert-triangle"></i><p>Error al cargar solicitudes</p></div>';
    }
}

function renderJobBoardRequests() {
    const container = document.getElementById('jb-requests-list');

    if (jbRequests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-wo-icon="radio"></i>
                <h3>Sin solicitudes</h3>
                <p>Todavía no publicaste solicitudes en el Job Board</p>
                <a href="/job-board/request" class="wo-btn wo-btn--hard">Publicar idea <i data-wo-icon="arrow-right" class="wo-icon-18"></i></a>
            </div>`;
        return;
    }

    container.innerHTML = jbRequests.map(req => {
        const statusLabels = {
            'draft': 'Borrador',
            'open': 'Abierta',
            'in_review': 'En revisión',
            'accepted': 'Aceptada',
            'closed': 'Cerrada',
            'expired': 'Expirada'
        };
        const pendingApps = (req.job_board_applications || []).filter(a => a.status === 'pending' || a.status === 'viewed').length;
        const totalApps = (req.job_board_applications || []).length;
        const thumbnail = req.job_board_attachments?.[0]?.file_url;
        const styles = req.tattoo_style ? (Array.isArray(req.tattoo_style) ? req.tattoo_style.join(', ') : String(req.tattoo_style)) : '';

        return `
        <div class="quotation-card" data-request-id="${req.id}" onclick="viewJBRequestDetail('${req.id}')">
            <div class="quotation-header">
                <span class="quotation-id">${req.request_code}</span>
                <span class="quotation-status jb-${req.status}">${statusLabels[req.status] || req.status}</span>
            </div>
            <div class="quotation-body">
                <div class="quotation-artist">
                    ${thumbnail ? `<img src="${thumbnail}" alt="">` : '<div class="artist-avatar">JB</div>'}
                    <div class="artist-info">
                        <h4>${req.tattoo_idea_description ? req.tattoo_idea_description.substring(0, 60) + (req.tattoo_idea_description.length > 60 ? '…' : '') : 'Sin descripción'}</h4>
                        <p>${req.tattoo_body_part || ''} ${styles ? '· ' + styles : ''}</p>
                    </div>
                </div>
                <div class="quotation-details">
                    <div class="detail-item">
                        <div class="detail-label">Zona</div>
                        <div class="detail-value">${req.tattoo_body_part || '–'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Presupuesto</div>
                        <div class="detail-value">${req.client_budget_min && req.client_budget_max ? '$' + req.client_budget_min + ' – $' + req.client_budget_max + ' ' + (req.client_budget_currency || 'USD') : 'Sin definir'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Postulaciones</div>
                        <div class="detail-value">${totalApps} (${pendingApps} nuevas)</div>
                    </div>
                </div>
            </div>
            <div class="quotation-footer">
                <button class="wo-btn wo-btn--ghost wo-btn--s" onclick="event.stopPropagation(); viewJBRequestDetail('${req.id}')">
                    Ver postulaciones
                </button>
            </div>
        </div>`;
    }).join('');
}

async function viewJBRequestDetail(requestId) {
    const req = jbRequests.find(r => r.id === requestId);
    if (!req) return;
    jbCurrentRequest = req;

    const modal = document.getElementById('jb-applications-modal');
    const codeEl = document.getElementById('jb-modal-code');
    const contentEl = document.getElementById('jb-applications-content');

    codeEl.textContent = req.request_code;

    const applications = req.job_board_applications || [];

    if (applications.length === 0) {
        contentEl.innerHTML = '<div class="jb-modal-empty"><p>Todavía no hay postulaciones para esta solicitud.</p><p class="hint">Compartí el enlace del Job Board para atraer más artistas.</p></div>';
        modal.style.display = 'flex';
        return;
    }

    // Fetch artist data for all applications
    const artistIds = applications.map(a => a.artist_id);
    let artistsMap = {};
    try {
        const { data: artists } = await WeotziData.Artists.listByUserIds(artistIds, 'user_id, username, name, profile_picture, styles_array, ubicacion, session_price, years_experience');
        if (artists) {
            artists.forEach(a => { artistsMap[a.user_id] = a; });
        }
    } catch (e) {
        console.error('Error fetching artists:', e);
    }

    contentEl.innerHTML = applications.map(app => {
        const artist = artistsMap[app.artist_id] || {};
        const statusLabels = { pending: 'Pendiente', viewed: 'Vista', accepted: 'Aceptada', rejected: 'Rechazada', withdrawn: 'Retirada' };
        const isPending = app.status === 'pending' || app.status === 'viewed';
        const styles = artist.styles_array ? artist.styles_array.slice(0, 3).join(', ') : '';

        return `
        <div class="jb-app">
            <div class="jb-app-head">
                <div class="jb-app-avatar">${artist.profile_picture ? `<img src="${artist.profile_picture}" alt="">` : (artist.name || 'A').charAt(0).toUpperCase()}</div>
                <div class="jb-app-info">
                    <div class="jb-app-name">${artist.name || artist.username || 'Artista'}</div>
                    <div class="jb-app-meta">${artist.ubicacion || ''} ${styles ? '· ' + styles : ''}</div>
                </div>
                <span class="jb-app-status st-${app.status}">${statusLabels[app.status]}</span>
            </div>
            <div class="jb-app-body">
                <p class="jb-app-msg">${app.message || 'Sin mensaje'}</p>
                <div class="jb-app-facts">
                    ${app.estimated_price ? '<span>Precio est. · ' + app.estimated_price + '</span>' : ''}
                    ${app.estimated_sessions ? '<span>Sesiones · ' + app.estimated_sessions + '</span>' : ''}
                    ${app.availability_note ? '<span>Disponibilidad · ' + app.availability_note + '</span>' : ''}
                </div>
                ${artist.username ? '<a href="/artist/profile?u=' + artist.username + '" target="_blank" class="jb-app-link">Ver perfil del artista →</a>' : ''}
            </div>
            ${isPending ? `
            <div class="jb-app-actions">
                <button class="wo-btn wo-btn--s" onclick="acceptApplication('${app.id}', '${req.id}')">Aceptar</button>
                <button class="wo-btn wo-btn--ghost wo-btn--s btn-borrar" onclick="rejectApplication('${app.id}', '${req.id}')">Rechazar</button>
            </div>` : ''}
            ${app.status === 'accepted' && req.resulting_quote_id ? '<div class="jb-app-quote-link"><a href="/my-quotations">Ver cotización creada →</a></div>' : ''}
        </div>`;
    }).join('');

    modal.style.display = 'flex';
}

async function acceptApplication(applicationId, requestId) {
    if (!confirm('¿Aceptás esta postulación? Se crea una cotización con este artista y las demás postulaciones se rechazan.')) return;

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session?.access_token) {
            alert('Tu sesión expiró. Recargá la página e iniciá sesión de nuevo.');
            return;
        }

        const response = await fetch('/api/job-board/accept-application', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                applicationId,
                requestId
            })
        });

        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        try {
            const request = jbRequests.find(r => r.id === requestId) || jbCurrentRequest;
            const application = request ? (request.job_board_applications || []).find(a => a.id === applicationId) : null;
            window.ConfigManager.sendN8NEvent('job_board_application_accepted', {
                artist_name: application ? (application.artist_name || '') : '',
                artist_email: application ? (application.artist_email || '') : '',
                client_name: currentClient ? (currentClient.full_name || '') : '',
                request_code: request ? (request.request_code || '') : '',
                quote_id: result.quote_id || '',
                tattoo_style: request ? (request.tattoo_style || '') : '',
                tattoo_size: request ? (request.tattoo_size || '') : '',
                tattoo_body_part: request ? (request.tattoo_body_part || '') : ''
            });
        } catch (e) { /* n8n notification failure should not break main flow */ }

        alert('Artista aceptado. Se creó una cotización.');
        closeJBModal();
        loadJobBoardRequests();
    } catch (err) {
        console.error('Error accepting application:', err);
        alert('Error al aceptar: ' + err.message);
    }
}

async function rejectApplication(applicationId, requestId) {
    if (!confirm('¿Rechazás esta postulación?')) return;

    try {
        const { error } = await WeotziData
            .from('job_board_applications')
            .update({ status: 'rejected', decided_at: new Date().toISOString() })
            .eq('id', applicationId);

        if (error) throw error;

        try {
            const request = jbRequests.find(r => r.id === requestId) || jbCurrentRequest;
            const application = request ? (request.job_board_applications || []).find(a => a.id === applicationId) : null;
            window.ConfigManager.sendN8NEvent('job_board_application_rejected', {
                artist_name: application ? (application.artist_name || '') : '',
                artist_email: application ? (application.artist_email || '') : '',
                request_code: request ? (request.request_code || '') : ''
            });
        } catch (e) { /* n8n notification failure should not break main flow */ }

        // Refresh
        await loadJobBoardRequests();
        viewJBRequestDetail(requestId);
    } catch (err) {
        console.error('Error rejecting:', err);
        alert('Error al rechazar: ' + err.message);
    }
}

function closeJBModal() {
    document.getElementById('jb-applications-modal').style.display = 'none';
}

// Load JB count on init (after quotations load)
(async function initJobBoardTab() {
    // Wait for supabase to be ready
    let tries = 0;
    while (!_supabase && tries < 50) {
        await new Promise(r => setTimeout(r, 100));
        tries++;
    }
    if (!_supabase) return;

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;

        const { count, error } = await WeotziData
            .from('job_board_requests')
            .select('*', { count: 'exact', head: true })
            .eq('client_user_id', session.user.id);

        if (!error && count > 0) {
            const badge = document.getElementById('jb-requests-count');
            if (badge) {
                badge.textContent = count;
                badge.style.display = 'inline-flex';
            }
        }

        // Check URL params for tab switching
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === 'solicitudes') {
            switchToJobBoard();
        }
    } catch (e) {
        console.error('Error init JB tab:', e);
    }
})();

// Setup Realtime subscription for new applications
(async function setupJBRealtime() {
    let tries = 0;
    while (!_supabase && tries < 50) {
        await new Promise(r => setTimeout(r, 100));
        tries++;
    }
    if (!_supabase) return;

    WeotziData
        .channel('jb-applications-updates')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'job_board_applications'
        }, () => {
            // Refresh JB requests if on that tab
            const jbList = document.getElementById('jb-requests-list');
            if (jbList && jbList.style.display !== 'none') {
                loadJobBoardRequests();
            }
        })
        .subscribe();
})();
