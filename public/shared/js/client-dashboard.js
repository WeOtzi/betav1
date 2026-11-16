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
// Reference content is explicitly limited to this page in the isolated preview.
const dashboardReference = window.WEOTZI_PREVIEW === true ? window.ClientDashboardReference : null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    await checkDashboardAuth();

    // Load data
    await loadClientProfile();
    await loadQuotations();
    await openQuotationFromUrl();

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
            rememberPendingQuote();
            window.location.href = '/client/login';
            return;
        }
        
        // Check if user is a client
        const { data: client, error } = await WeotziData.Clients.getByUserId(session.user.id);

        if (!client) {
            // Check if user is an artist first - artists should not access client dashboard
            const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id');

            if (artist) {
                const response = await fetch('/api/account/mode',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({mode:'client'})});
                if (!response.ok) throw new Error('No pudimos activar el modo cliente.');
                window.location.reload();
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
            
        }

        // cot-cliente (CC-02 / ACC-12): en cada carga se vinculan las cotizaciones
        // de invitado hechas con el email verificado (también si se confirmó el
        // email en otro dispositivo o si ya tenía cuenta). Idempotente.
        await linkQuotationsByEmail(session.access_token);
        
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

// El servidor valida el email verificado de la sesión y vincula solo las
// cotizaciones sin dueño con ese email (POST /api/client/quotations/claim).
async function linkQuotationsByEmail(accessToken) {
    try {
        if (!accessToken || !WeotziData.Api || typeof WeotziData.Api.claimMine !== 'function') return;
        await WeotziData.Api.claimMine(accessToken);
    } catch (error) {
        // 403 = email todavía sin confirmar: no es un error para el usuario.
        if (error && error.status !== 403) console.warn('No pudimos vincular cotizaciones:', error.message);
    }
}

// ============================================
// Load Client Profile
// ============================================

async function loadClientProfile() {
    if (!currentClient) return;

    // El Figma del dashboard no tiene card de "Centro de cuenta": el acceso es el
    // tile Ö de la topbar. Aquí sólo se pintan el saludo del hero y ese tile.

    // Saludo del hero (según hora local)
    const greetingEl = document.getElementById('hero-greeting');
    if (greetingEl) {
        const hour = new Date().getHours();
        const saludo = hour < 13 ? 'Buen día' : (hour < 20 ? 'Buenas tardes' : 'Buenas noches');
        const firstName = (currentClient.full_name || '').trim().split(/\s+/)[0];
        greetingEl.textContent = firstName ? `${saludo}, ${firstName}` : saludo;
        if (dashboardReference) greetingEl.textContent = dashboardReference.greeting;
    }

    // Tile de perfil en la topbar
    const tileEl = document.getElementById('topbar-avatar');
    if (tileEl) {
        if (dashboardReference) { tileEl.textContent = 'Ö'; return; }
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
        loadNextAppointment();
        if (window.WoClientSessions) window.WoClientSessions.mount({ onOpenQuote: viewQuotationDetail }); // ── sesiones (ronda 2) ── panel "Mis sesiones"
        openQuotationFromQuery();
        loadClientPanelExtras();
        
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
    if (dashboardReference) {
        [pendingQuotesEl, newMessagesEl, activePostsEl, proposalsEl].forEach((el, i) => {
            if (el) el.textContent = dashboardReference.counters[i];
        });
    }
}

// Enlace profundo ?quote=<quote_id> (tarjeta "Ver cotización" del Inbox):
// abre el detalle una sola vez si la cotización es del cliente.
let quoteDeepLinkHandled = false;
function openQuotationFromQuery() {
    if (quoteDeepLinkHandled) return;
    quoteDeepLinkHandled = true;
    try {
        const quoteId = (new URLSearchParams(window.location.search).get('quote') || '').trim();
        if (quoteId && currentQuotations.some(q => q.quote_id === quoteId)) viewQuotationDetail(quoteId);
    } catch (error) {
        console.warn('Deep link de cotización:', error);
    }
}

// Sessions reference quotations_db.id (numeric), not the public quote_id.
async function loadNextAppointment() {
    const card = document.getElementById('next-appointment');
    if (!card) return;
    card.hidden = true;
    card.innerHTML = '';
    try {
        if (dashboardReference && currentQuotations.length) {
            renderNextAppointment({ ...currentQuotations[0], ...dashboardReference.appointment }, dashboardReference.appointment.label);
            return;
        }
        const ids = currentQuotations.map(q => q.id).filter(id => id != null);
        if (!ids.length) return;
        // INB-10: quotation_sessions solo es legible por el artista; el cliente
        // usa la RPC con columnas seguras (list_client_quotation_sessions).
        const sessions = WeotziData.Sessions.listForClient
            ? await WeotziData.Sessions.listForClient(ids)
            : await WeotziData.Sessions.listByQuotationIds(ids);
        const upcoming = sessions.filter(s =>
            !['cancelled', 'canceled', 'completed'].includes(s.status) &&
            new Date(s.session_date).getTime() >= Date.now() &&
            currentQuotations.some(q => q.id === s.quotation_id)
        ).sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];
        if (!upcoming) return;
        const quote = currentQuotations.find(q => q.id === upcoming.quotation_id);
        const date = new Date(upcoming.session_date);
        const day = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
        const time = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
        // La RPC trae client_confirmation desde la migración 20261116150000: una
        // sesión que el cliente todavía no confirmó no se muestra como cita firme.
        const toConfirm = String(upcoming.client_confirmation || '').toLowerCase() === 'pending';
        renderNextAppointment(quote, `${day} · ${time}${quote.studio_name ? ` — ${quote.studio_name}` : ''}${toConfirm ? ' · por confirmar' : ''}`);
    } catch (error) {
        console.error('Error loading next appointment:', error);
    }
}

function renderNextAppointment(quote, label) {
    const card = document.getElementById('next-appointment');
    card.innerHTML = `
        <div class="client-appointment-person">
            <span class="client-appointment-avatar">${quote.artist_profile_picture
                ? `<img src="${escapeFeedHtml(quote.artist_profile_picture)}" alt="">`
                : '<span class="client-photo-placeholder client-photo-placeholder--small" aria-hidden="true"><strong>Foto</strong><span>or<br><u>browse<br>files</u></span></span>'}</span>
            <div class="client-appointment-info"><p class="client-appointment-eyebrow">Próxima cita</p>
                <h3>${escapeFeedHtml(quote.artist_name || 'Artista')}</h3><p>${escapeFeedHtml(label)}</p></div>
        </div>
        <button class="wo-btn client-appointment-detail" type="button" data-quote-id="${escapeFeedHtml(quote.quote_id)}">Ver detalle <i data-wo-icon="arrow-right" class="wo-icon-18"></i></button>`;
    card.hidden = false;
    card.querySelector?.('[data-quote-id]')?.addEventListener('click', () => viewQuotationDetail(quote.quote_id));
}

// ============================================
// Render Quotations
// ============================================

function renderQuotations() {
    const listContainer = document.getElementById('quotations-list');
    if (!listContainer) return;

    // CC-13: los borradores del cotizador (in_progress sin respuesta del
    // artista) no son cotizaciones "En proceso": se muestran aparte.
    const drafts = currentQuotations.filter(isClientWizardDraft);
    // cliente-panel (ronda 2): buscador por código corto, artista, estilo o zona.
    const searchTerm = clientPanelSearchTerm();
    const panel = panelModel();
    const filtered = currentQuotations
        .filter(q => quotationMatchesFilter(q, currentFilter))
        .filter(q => !searchTerm || !panel || panel.matchesSearch(q, searchTerm, clientPanelExtras(q)));
    const draftsHtml = drafts.length && !searchTerm && (currentFilter === 'all' || currentFilter === 'active') ? renderDraftsNotice(drafts) : '';
    const ui = panelUi();
    if (ui && typeof ui.afterRender === 'function') ui.afterRender({ shown: filtered });

    if (filtered.length === 0) {
        const emptyKind = searchTerm ? 'quotations-search' : (currentFilter !== 'all' ? 'quotations-filter' : 'quotations');
        listContainer.innerHTML = draftsHtml + (panel
            ? panel.emptyHtml(panel.emptyState(emptyKind, { term: searchTerm }), { variant: 'dashboard' })
            : `
            <div class="empty-state">
                <i data-wo-icon="file-text"></i>
                <h3>Sin cotizaciones</h3>
                <p>Todavía no tienes cotizaciones${currentFilter !== 'all' ? ' en este estado' : ''}</p>
            </div>
        `);
        return;
    }

    listContainer.innerHTML = draftsHtml + filtered.map(q => renderQuotationCard(q)).join('');
}

// ---- Panel del cliente · ronda 2 (frente cliente-panel) ----
// El modelo puro (client-panel-model.js · WoClientPanel) centraliza etiquetas de
// estado, código corto y buscador; client-panel-ui.js (WoClientPanelUi) guarda
// el término buscado y los datos extra. Todo es opcional: sin esos scripts el
// listado sigue funcionando con el modelo anterior.
function panelModel() {
    return (typeof window !== 'undefined' && window.WoClientPanel) || null;
}

function panelUi() {
    return (typeof window !== 'undefined' && window.WoClientPanelUi) || null;
}

function clientPanelSearchTerm() {
    const ui = panelUi();
    return ui && typeof ui.getSearch === 'function' ? String(ui.getSearch() || '') : '';
}

function clientPanelExtras(q) {
    const ui = panelUi();
    return ui && typeof ui.extrasFor === 'function' ? ui.extrasFor(q) : {};
}

// Código visible de la cotización: el corto si existe, si no el quote_id.
function clientQuoteCode(q) {
    const panel = panelModel();
    if (panel) return panel.quoteCode(q);
    return String((q && (q.short_code || q.quote_id)) || '');
}

// Etiqueta de estado (+ aclaración de a quién le toca) del detalle abierto.
function clientStatusPillHtml(quotation) {
    const status = clientQuotationStatus(quotation);
    return `<span class="quotation-status ${escapeFeedHtml(status.tone)}">${escapeFeedHtml(status.label)}</span>`
        + (status.hint ? `<span class="cpn-status-hint">${escapeFeedHtml(status.hint)}</span>` : '');
}

// Sesiones y propuestas pendientes del cliente para las etiquetas "Sesión por
// confirmar", "Cambios propuestos por ti" y "Cambios al acuerdo pendientes de
// aprobar" (no bloquea). Repinta solo si alguna etiqueta cambió.
function loadClientPanelExtras() {
    const ui = panelUi();
    if (!ui || typeof ui.loadExtras !== 'function') return;
    const openLabel = () => {
        const open = currentQuotationId ? currentQuotations.find(q => q.quote_id === currentQuotationId) : null;
        return open ? clientQuotationStatus(open).label : '';
    };
    const labelBefore = openLabel();
    Promise.resolve(ui.loadExtras(currentQuotations)).then(changed => {
        if (!changed) return;
        renderQuotations();
        // El detalle abierto solo se repinta si cambió SU etiqueta (no se pisa
        // lo que el cliente esté escribiendo por un cambio en otra cotización).
        if (currentQuotationId && openLabel() !== labelBefore) refreshOpenDetail(currentQuotationId);
    }).catch(() => { /* la etiqueta base ya está pintada */ });
}

// ---- Estados del cliente (cot-cliente · CC-13) ----
// La lógica vive en client-quote-proposal.js (WoClientQuoteProposal); aquí hay
// un respaldo mínimo por si el script no cargó.
const CLIENT_STATUS_FALLBACK = {
    draft: 'Borrador sin enviar', pending: 'Esperando al artista', responded: 'Propuesta recibida',
    client_approved: 'Aceptada', client_rejected: 'Rechazada', in_progress: 'En curso',
    artist_completed: 'Por confirmar', completed: 'Completada', cancelled: 'Cancelada', expired: 'Vencida',
    unknown: 'En revisión'
};

function proposalUi() {
    return (typeof window !== 'undefined' && window.WoClientQuoteProposal) || null;
}

function isClientWizardDraft(q) {
    const ui = proposalUi();
    if (ui) return ui.isDraft(q);
    return !!q && q.quote_status === 'in_progress' && !q.artist_responded_at && !q.artist_budget_amount && !q.final_budget_amount;
}

function clientQuotationStatus(q) {
    // cliente-panel (ronda 2): mismo estado que /client/requests y /client/chats
    // (key = estado base; label/tone suman los estados nuevos si hay datos).
    const panel = panelModel();
    if (panel) return panel.statusOf(q, clientPanelExtras(q));
    const ui = proposalUi();
    if (ui) return ui.statusOf(q);
    let key = isClientWizardDraft(q) ? 'draft' : (q && q.quote_status === 'en_progreso' ? 'in_progress' : (q && q.quote_status));
    if (!CLIENT_STATUS_FALLBACK[key]) key = 'unknown';
    return { key, label: CLIENT_STATUS_FALLBACK[key], tone: key === 'unknown' ? 'pending' : key };
}

function quotationMatchesFilter(q, filter) {
    const ui = proposalUi();
    if (ui) return ui.matchesFilter(q, filter);
    const key = clientQuotationStatus(q).key;
    if (key === 'draft') return false;
    if (!filter || filter === 'all') return true;
    if (filter === 'active') return ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed'].includes(key);
    return key === filter;
}

function renderDraftsNotice(drafts) {
    const count = drafts.length;
    return `
        <div class="client-drafts-notice" role="note">
            <p><strong>${count === 1 ? 'Tienes una cotización sin enviar' : `Tienes ${count} cotizaciones sin enviar`}.</strong>
            El artista todavía no la${count === 1 ? '' : 's'} recibió.</p>
            <a class="wo-btn wo-btn--ghost wo-btn--s" href="/quotation">Continuar cotización</a>
        </div>`;
}

function formatClientQuotationStyle(value, includeSubstyle = false) {
    const styles = Array.isArray(value) ? value : [value];
    return styles.map(style => {
        if (typeof style === 'string') return style.trim();
        if (!style || typeof style !== 'object' || Array.isArray(style)) return '';
        const name = typeof style.style_name === 'string' ? style.style_name.trim() : '';
        const substyle = typeof style.substyle_name === 'string' ? style.substyle_name.trim() : '';
        return includeSubstyle ? [name, substyle].filter(Boolean).join(' - ') : name;
    }).filter(Boolean).join(', ');
}

function renderQuotationCard(quotation) {
    const status = clientQuotationStatus(quotation);
    const quoteId = escapeFeedHtml(quotation.quote_id);
    const artistInitials = escapeFeedHtml(getInitials(quotation.artist_name || 'AR'));
    const styleInfo = escapeFeedHtml(formatClientQuotationStyle(quotation.tattoo_style));
    const ui = proposalUi();
    const proposal = ui && ['responded', 'client_approved'].includes(status.key) ? ui.proposalOf(quotation) : null;
    // Si el cliente propuso cambios, le toca al artista: no se le pide respuesta.
    const waiting = !!(ui && ui.canDecide(quotation)) && status.waitingOn !== 'artist';
    // cliente-panel (ronda 2): código corto visible (el quote_id real sigue en
    // data-quote-id) y aviso cuando los cambios o la sesión esperan al cliente.
    const quoteCode = escapeFeedHtml(clientQuoteCode(quotation));
    const needsReview = !waiting && status.waitingOn === 'client';

    return `
        <div class="quotation-card" data-quote-id="${quoteId}">
            <div class="quotation-header">
                <span class="quotation-id">${quoteCode}</span>
                <span class="quotation-status ${escapeFeedHtml(status.tone)}">${escapeFeedHtml(status.label)}</span>
            </div>
            <div class="quotation-body">
                <div class="quotation-artist">
                    <div class="artist-avatar">${artistInitials}</div>
                    <div class="artist-info">
                        <h4>${escapeFeedHtml(quotation.artist_name || 'Artista')}</h4>
                        <p>${escapeFeedHtml(quotation.artist_studio_name || quotation.artist_current_city || 'Sin estudio')}</p>
                    </div>
                </div>
                <div class="quotation-details">
                    <div class="detail-item">
                        <div class="detail-label">Zona</div>
                        <div class="detail-value">${escapeFeedHtml(quotation.tattoo_body_part || '–')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Estilo</div>
                        <div class="detail-value">${styleInfo || '–'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Fecha</div>
                        <div class="detail-value">${escapeFeedHtml(formatDate(quotation.created_at))}</div>
                    </div>
                </div>
                ${proposal && proposal.amountText ? `<p class="quotation-proposal-line">${proposal.isFinal ? 'Total acordado' : 'Propuesta'}: <strong>${escapeFeedHtml(proposal.amountText)}</strong>${waiting ? ' · <span class="quotation-proposal-cta">Esperando tu respuesta</span>' : ''}</p>` : ''}
            </div>
            ${status.hint ? `<p class="cpn-status-hint">${escapeFeedHtml(status.hint)}</p>` : ''}
            <div class="quotation-footer">
                <button type="button" class="wo-btn wo-btn--s" data-quote-id="${quoteId}" onclick="openChat(this.dataset.quoteId)">
                    Chat <span class="unread-badge" id="unread-${quoteId}" style="display: none;">0</span>
                </button>
                <button type="button" class="wo-btn ${waiting || needsReview ? 'wo-btn--accent' : 'wo-btn--ghost'} wo-btn--s" data-quote-id="${quoteId}" onclick="viewQuotationDetail(this.dataset.quoteId)">
                    ${waiting ? 'Ver propuesta' : (needsReview ? 'Revisar' : 'Ver detalle')}
                </button>
                ${window.WoQuoteReuse ? window.WoQuoteReuse.buttonHtml(quotation) : ''}
                <button type="button" class="wo-btn wo-btn--ghost wo-btn--s btn-borrar" data-quote-id="${quoteId}" onclick="hideQuotation(this.dataset.quoteId)">
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
    if (!confirm('¿Seguro que quieres borrar esta cotización?')) {
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
    if (mins < 1) return 'Hace un momento';
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
    completed: { icon: 'check-circle', text: (artist) => `Tu tatuaje con ${artist} quedó finalizado` },
    // Ronda 3 · P8/P10: avisos in-app de rechazo y vencimiento.
    cancelled: { icon: 'x-circle', text: (artist) => `${artist} no va a tomar tu solicitud` },
    expired: { icon: 'clock', text: (artist) => `La propuesta de ${artist} venció` }
};

// Ronda 2 · P26: cada fila de actividad es un enlace al destino exacto
// (cotización, conversación o postulación). Los destinos salen del modelo
// compartido notification-feed-model.js, que se carga bajo demanda: si no
// llega, las filas se muestran igual, sin enlace.
let feedModelPromise = null;
function loadFeedModel() {
    if (window.WoNotificationFeedModel) return Promise.resolve(window.WoNotificationFeedModel);
    if (!feedModelPromise) {
        feedModelPromise = new Promise((resolve) => {
            try {
                const script = document.createElement('script');
                script.src = '/shared/js/notification-feed-model.js';
                script.onload = () => resolve(window.WoNotificationFeedModel || null);
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            } catch (_) {
                resolve(null);
            }
        });
    }
    return feedModelPromise;
}

// EP-08: contrapropuestas, cambios al acuerdo y novedades de sesiones solo
// existían como un aviso de 9 segundos. "Tu actividad" las toma de los avisos
// que el servidor ya guarda (user_notifications, RLS de dueño). El repositorio
// lo carga wo-notify.js; si todavía no llegó, se pide aquí. Sin él, o sin la
// tabla, la actividad se muestra igual con el resto de las filas.
let noticesRepoPromise = null;
function loadNoticesRepo() {
    const ready = () => {
        const repo = typeof WeotziData !== 'undefined' && WeotziData ? WeotziData.Notifications : null;
        return repo && typeof repo.listStored === 'function' ? repo : null;
    };
    if (ready()) return Promise.resolve(ready());
    if (!noticesRepoPromise) {
        noticesRepoPromise = new Promise((resolve) => {
            try {
                const script = document.createElement('script');
                script.src = '/shared/js/data/notifications-repo.js';
                script.onload = () => resolve(ready());
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            } catch (_) {
                resolve(null);
            }
        });
    }
    return noticesRepoPromise;
}

async function storedNoticeEvents(feedModel) {
    if (!feedModel || typeof feedModel.clientNoticeEvents !== 'function' || !currentClient || !currentClient.user_id) return [];
    try {
        const repo = await loadNoticesRepo();
        if (!repo) return [];
        const stored = await repo.listStored(currentClient.user_id, {
            role: 'client', eventIds: feedModel.STORED_NOTICE_EVENTS.client, days: feedModel.STORED_NOTICE_DAYS, limit: 12
        });
        return feedModel.clientNoticeEvents(stored);
    } catch (error) {
        console.warn('No pudimos cargar los avisos guardados:', error && error.message);
        return [];
    }
}

async function loadActivityFeed() {
    const container = document.getElementById('activity-feed');
    if (!container) return;
    if (dashboardReference) { renderActivityFeed(dashboardReference.events); return; }

    try {
        const feedModel = await loadFeedModel();
        const link = (source, data) => (feedModel ? feedModel.clientActivityLink(source, data) : {});
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
                    text: spec.text(artistByQuote[row.quote_id] || 'El artista'),
                    ...link('status', { quoteId: row.quote_id, status: row.new_status, at: row.changed_at })
                });
            });

            // Respuestas del artista a disputas (quotation_disputes, RLS select_parties)
            try {
                const { data: disputes } = await WeotziData
                    .from('quotation_disputes')
                    .select('quote_id, artist_responded_at')
                    .in('quote_id', quoteIds)
                    .not('artist_responded_at', 'is', null)
                    .order('artist_responded_at', { ascending: false })
                    .limit(10);
                (disputes || []).forEach(row => {
                    events.push({
                        at: row.artist_responded_at,
                        icon: 'message-square',
                        text: `${artistByQuote[row.quote_id] || 'El artista'} respondió tu disputa`,
                        ...link('dispute', { quoteId: row.quote_id, at: row.artist_responded_at })
                    });
                });
            } catch (_) { /* sin disputas visibles */ }

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
                    text: `Nuevo mensaje de ${artistByQuote[row.quotation_id] || 'un artista'}`,
                    ...link('message', { quoteId: row.quotation_id, at: row.created_at })
                });
            });
        }

        // EP-08: negociación y sesiones (avisos guardados), aunque no haya cotizaciones cargadas.
        (await storedNoticeEvents(feedModel)).forEach(event => events.push(event));

        // Postulaciones recibidas en el job board
        jbRequests.forEach(req => {
            (req.job_board_applications || []).forEach(app => {
                events.push({
                    at: app.created_at,
                    icon: 'briefcase',
                    text: 'Recibiste una propuesta en tu publicación',
                    ...link('proposal', { requestId: req.id, applicationId: app.id, at: app.created_at })
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
        container.innerHTML = '<p class="client-feed-empty">Todavía no hay movimientos. Cuando un artista te responda o recibas una propuesta, lo vas a ver aquí.</p>';
        return;
    }

    // P26: con destino, la fila es un enlace real (se puede abrir en otra
    // pestaña); sin destino queda como texto.
    container.innerHTML = rows.map(row => {
        const href = typeof row.href === 'string' && /^\/([^/\\]|$)/.test(row.href) ? row.href : '';
        const inner = `
            <span class="client-feed-icon"><i data-wo-icon="${escapeFeedHtml(row.icon)}"></i></span>
            <span class="client-feed-text">${escapeFeedHtml(row.text)}</span>
            <span class="client-feed-time">${escapeFeedHtml(formatRelative(row.at))}</span>`;
        if (!href) return `<div class="client-feed-row">${inner}</div>`;
        return `<a class="client-feed-row" href="${escapeFeedHtml(href)}"${row.quoteId ? ` data-feed-quote="${escapeFeedHtml(row.quoteId)}" data-feed-ver="${escapeFeedHtml(row.ver || '')}"` : ''}${row.noticeId ? ` data-feed-notice="${escapeFeedHtml(row.noticeId)}"` : ''}>${inner}
            <span class="client-feed-go" aria-hidden="true"><i data-wo-icon="arrow-right"></i></span></a>`;
    }).join('');
    if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(container);

    // La cotización se abre en esta misma página (sin recargar) y se resalta
    // la parte que anuncia la fila; el enlace real queda para "abrir en otra pestaña".
    if (container.dataset && !container.dataset.feedLinksBound && typeof container.addEventListener === 'function') {
        container.dataset.feedLinksBound = '1';
        container.addEventListener('click', (event) => {
            // EP-08: abrir un aviso guardado lo marca leído (mejor esfuerzo; no frena el enlace).
            const notice = event.target && event.target.closest ? event.target.closest('a[data-feed-notice]') : null;
            if (notice) {
                try {
                    const repo = typeof WeotziData !== 'undefined' && WeotziData ? WeotziData.Notifications : null;
                    if (repo && typeof repo.markRead === 'function') Promise.resolve(repo.markRead(notice.dataset.feedNotice)).catch(() => {});
                } catch (_) { /* nunca rompe la navegación */ }
            }
            const row = event.target && event.target.closest ? event.target.closest('a[data-feed-quote]') : null;
            if (!row || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const quoteId = row.dataset.feedQuote;
            if (!currentQuotations.some(q => q.quote_id === quoteId)) return;
            event.preventDefault();
            Promise.resolve(viewQuotationDetail(quoteId)).then(() => {
                if (row.dataset.feedVer && window.WoNotify && typeof window.WoNotify.focusArrival === 'function') {
                    window.WoNotify.focusArrival(row.dataset.feedVer);
                }
            });
        });
    }
}

// Un aviso nuevo (wo-notify.js: mensaje, respuesta del artista, propuesta…)
// refresca el feed y los contadores sin recargar la página.
let feedRefreshTimer = null;
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('wo:notify', () => {
        if (dashboardReference || !currentClient) return;
        clearTimeout(feedRefreshTimer);
        feedRefreshTimer = setTimeout(async () => {
            try {
                const { data: { session } } = await _supabase.auth.getSession();
                if (!session) return;
                const openBefore = currentQuotations.find(q => q.quote_id === currentQuotationId) || null;
                const fresh = await WeotziData.Quotations.listForClient(session.user.id, currentClient.email);
                currentQuotations = fresh || currentQuotations;
                updateStats();
                renderQuotations();
                // El aviso puede traer una sesión por confirmar o un cambio al acuerdo.
                loadClientPanelExtras();
                // El detalle abierto solo se repinta si esa cotización cambió (no se
                // pisa lo que el cliente esté escribiendo por un aviso de otra cosa).
                const openAfter = currentQuotations.find(q => q.quote_id === currentQuotationId) || null;
                if (openBefore && openAfter && (openBefore.quote_status !== openAfter.quote_status
                    || openBefore.updated_at !== openAfter.updated_at)) refreshOpenDetail(currentQuotationId);
                await loadUnreadCounts();
                await loadJobBoardRequests();
                updateStats();
                loadActivityFeed();
            } catch (error) {
                console.warn('No pudimos refrescar la actividad:', error && error.message);
            }
        }, 1200);
    });
}

// ============================================
// Artistas para ti
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
        const { data: artists, error } = dashboardReference
            ? { data: dashboardReference.artists }
            : await WeotziData.Artists.listPublic(SUGGESTED_SELECT);
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
            if (artist.badge === 'reco') badge = '<span class="client-suggested-badge client-suggested-badge--reco">Recomendado</span>';
            else if (artist.badge === 'guest') badge = '<span class="client-suggested-badge client-suggested-badge--guest">Guest artist</span>';
            else if (isNear || artist.badge === 'near') badge = '<span class="client-suggested-badge client-suggested-badge--near">Cerca de ti</span>';
            else if (guestNow.has(artist.user_id)) badge = '<span class="client-suggested-badge client-suggested-badge--guest">Guest artist</span>';
            else if (artist.is_recommended) badge = '<span class="client-suggested-badge client-suggested-badge--reco">Recomendado</span>';

            const summary = ratings[artist.user_id] || (artist.rating ? { average_rating: artist.rating } : null);
            const rating = summary && summary.average_rating
                ? `<span class="client-suggested-rating"><i data-wo-icon="star"></i>${Number(summary.average_rating).toFixed(1)}</span>`
                : '';

            const styles = parseArtistStyles(artist.styles_array).slice(0, 2)
                .map(s => `<span class="client-suggested-style">${escapeFeedHtml(s)}</span>`).join('');

            // Reference-only artists use the existing discovery route, not invented profiles.
            const href = dashboardReference ? '/marketplace/' : `/artist/profile?artist=${encodeURIComponent(artist.username || '')}`;
            const name = escapeFeedHtml(artist.name || artist.username || 'Artista');

            // cliente-panel (ronda 2): hueco del corazón de favoritos (lo activa
            // wo-favorites.js; vacío no se ve). Va fuera del <a> de la tarjeta.
            const favorite = !dashboardReference && artist.user_id
                ? `<button type="button" class="cpn-fav cpn-fav--media" data-wo-favorite data-kind="artist" data-id="${escapeFeedHtml(artist.user_id)}" data-label="${name}" data-image="${escapeFeedHtml(artist.profile_picture || '')}"></button>`
                : '';

            return `
                <article class="cpn-suggested-item">
                <a class="client-suggested-card" href="${href}">
                    <div class="client-suggested-media">
                        <span class="client-photo-placeholder" aria-hidden="true"><img src="/shared/assets/client-dashboard/image-placeholder.svg" width="28" height="29.1" alt=""><strong>Foto</strong><span>or <u>browse files</u></span></span>
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
                ${favorite}
                </article>
            `;
        }).join('');

        section.hidden = false;
        const suggestedUi = panelUi();
        if (suggestedUi && typeof suggestedUi.ensureModules === 'function') suggestedUi.ensureModules(grid);
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

    // Render detail content (CC-13: todo lo que viene de datos se escapa)
    const e = escapeFeedHtml;
    const styleInfo = e(formatClientQuotationStyle(quotation.tattoo_style, true));
    const referencesUrl = safeHttpUrl(quotation.tattoo_references);
    const sessionCost = quotation.artist_session_cost_amount
        ? `${quotation.artist_session_cost_amount} ${quotation.artist_session_cost_currency || ''}`.trim() : '–';

    detailContent.innerHTML = `
        <p class="quotation-detail-status"><span class="cpn-status-slot" data-cpn-status>${clientStatusPillHtml(quotation)}</span></p>

        <div id="quote-proposal-slot">${renderProposalBlock(quotation)}</div>

        <div class="detail-section">
            <h3 class="detail-section-title">Información del tatuaje</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Zona del cuerpo</label>
                    <span>${e(quotation.tattoo_body_part || '–')} ${quotation.tattoo_body_side ? `(${e(quotation.tattoo_body_side)})` : ''}</span>
                </div>
                <div class="detail-field">
                    <label>Tamaño</label>
                    <span>${e(quotation.tattoo_size || '–')}</span>
                </div>
                <div class="detail-field">
                    <label>Estilo</label>
                    <span>${styleInfo || '–'}</span>
                </div>
                <div class="detail-field">
                    <label>Color</label>
                    <span>${e(quotation.tattoo_color_type || '–')}</span>
                </div>
            </div>
            <div class="detail-field" style="margin-top: var(--space-4);">
                <label>Descripción de la idea</label>
                <span>${e(quotation.tattoo_idea_description || 'Sin descripción')}</span>
            </div>
            ${referencesUrl ? `
                <div class="detail-field" style="margin-top: var(--space-4);">
                    <label>Referencias</label>
                    <a href="${e(referencesUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link">Ver imágenes de referencia →</a>
                </div>
            ` : ''}
        </div>

        <div class="detail-section">
            <h3 class="detail-section-title">Información del artista</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Nombre</label>
                    <span>${e(quotation.artist_name || '–')}</span>
                </div>
                <div class="detail-field">
                    <label>Estudio</label>
                    <span>${e(quotation.artist_studio_name || '–')}</span>
                </div>
                <div class="detail-field">
                    <label>Ciudad</label>
                    <span>${e(quotation.artist_current_city || '–')}</span>
                </div>
                <div class="detail-field">
                    <label>Costo por sesión</label>
                    <span>${e(sessionCost)}</span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <h3 class="detail-section-title">Preferencias</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Fecha preferida</label>
                    <span>${e(quotation.client_preferred_date || 'Flexible')}</span>
                </div>
                <div class="detail-field">
                    <label>Presupuesto</label>
                    <span>${quotation.client_budget_amount ? e(quotation.client_budget_amount + ' ' + (quotation.client_budget_currency || 'USD')) : '–'}</span>
                </div>
            </div>
        </div>

        <button type="button" class="expand-info-btn" onclick="toggleAdditionalInfo()" id="expand-info-btn">
            Ampliar información
        </button>

        ${renderReviewWorkflowPanel(quotation)}

        <div class="detail-section additional-info-section" id="additional-info-section" style="display: none;">
            <h3 class="detail-section-title">Información adicional</h3>
            <div class="detail-grid">
                <div class="detail-field">
                    <label>Disponibilidad para viajar</label>
                    <span>${travelWillingLabel(quotation.client_travel_willing)}</span>
                </div>
                <div class="detail-field">
                    <label>Alergias</label>
                    <span>${e(quotation.client_allergies || 'Ninguna')}</span>
                </div>
                <div class="detail-field">
                    <label>Condiciones de salud</label>
                    <span>${e(quotation.client_health_conditions || 'Ninguna')}</span>
                </div>
            </div>
        </div>
    `;

    // Update modal title
    document.getElementById('modal-quote-id').textContent = clientQuoteCode(quotation) || quoteId;
    const panelUiRef = panelUi();
    if (panelUiRef && typeof panelUiRef.ensureModules === 'function') panelUiRef.ensureModules(detailContent);

    // Load chat messages
    await loadChatMessages(quoteId);

    // Show modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Subscribe to chat for this quotation
    subscribeToChatMessages(quoteId);
    syncChatComposer(quotation);

    // Desglose manual + anticipo/pagos (lecturas con la RLS del cliente).
    enrichProposal(quotation);
}

// client_travel_willing es varchar en vivo ('true' / 'false'): CC-13.
function travelWillingLabel(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (v === 'true' || v === 'sí' || v === 'si') return 'Sí';
    if (v === 'false' || v === 'no') return 'No';
    return '–';
}

function safeHttpUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) {
        return '';
    }
}

// ============================================
// Propuesta del artista · aceptar / rechazar (cot-cliente · CC-01 / CC-11 / COT-A-10)
// ============================================

// Cache por cotización: { manual, payments } (se recarga al abrir el detalle).
const proposalExtras = {};

function renderProposalBlock(quotation) {
    const ui = proposalUi();
    if (!ui) return '';
    return ui.renderProposal(quotation, proposalExtras[quotation.quote_id] || {});
}

function rerenderProposal(quoteId) {
    if (currentQuotationId !== quoteId) return;
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    const slot = document.getElementById('quote-proposal-slot');
    if (quotation && slot) slot.innerHTML = renderProposalBlock(quotation);
}

// Actualiza la etiqueta de estado y la propuesta del detalle abierto sin
// recargar el chat.
function refreshOpenDetail(quoteId) {
    if (currentQuotationId !== quoteId) return;
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    const detail = document.getElementById('quotation-detail-content');
    const pill = detail && detail.querySelector ? (detail.querySelector('[data-cpn-status]') || detail.querySelector('.quotation-detail-status')) : null;
    if (quotation && pill) pill.innerHTML = clientStatusPillHtml(quotation);
    if (quotation) syncChatComposer(quotation);
    rerenderProposal(quoteId);
}

function paymentsConvertFn() {
    const C = (typeof window !== 'undefined' && (window.WeOtziCurrency || window.CurrencyUtils)) || null;
    return C && typeof C.convert === 'function' ? C.convert : null;
}

async function enrichProposal(quotation) {
    const ui = proposalUi();
    if (!ui || !quotation || ui.isDraft(quotation)) return;
    const extras = {};
    try {
        if (WeotziData.ManualQuotes && typeof WeotziData.ManualQuotes.getByQuoteId === 'function') {
            extras.manual = await WeotziData.ManualQuotes.getByQuoteId(quotation.quote_id);
            if (extras.manual && extras.manual.status !== 'sent') extras.manual = null;
        }
    } catch (error) {
        if (!error || !error.missingSchema) console.warn('No pudimos cargar el desglose:', error && error.message);
    }
    try {
        const P = WeotziData.QuotationPayments;
        const M = typeof window !== 'undefined' ? window.WoPaymentsModel : null;
        if (P && M && quotation.id != null && await P.isAvailable()) {
            const payments = await P.listForQuotation(quotation.id);
            extras.payments = { summary: M.summarize(quotation, extras.manual || null, payments, { convert: paymentsConvertFn() }) };
        }
    } catch (error) {
        console.warn('No pudimos cargar los pagos:', error && error.message);
    }
    proposalExtras[quotation.quote_id] = extras;
    rerenderProposal(quotation.quote_id);
}

function setProposalFeedback(box, message, isError) {
    const el = box && box.querySelector ? box.querySelector('[data-proposal-feedback]') : null;
    if (!el) { if (message && isError) alert(message); return; }
    el.textContent = message || '';
    el.classList.toggle('is-error', !!isError);
}

// Botones del bloque (Aceptar / Rechazar / confirmar / volver). El quote_id
// viaja en data-* (nunca interpolado en JS).
async function handleProposalAction(button) {
    const box = button && button.closest ? button.closest('.cqp-decision') : null;
    const quoteId = (box && box.dataset.quoteId) || (button && button.dataset.quoteId) || currentQuotationId;
    const action = button && button.dataset.proposalAction;
    const ui = proposalUi();
    const confirmBox = box ? box.querySelector('[data-proposal-confirm]') : null;
    const actions = box ? box.querySelector('.cqp-decision-actions') : null;

    if (action === 'approve' || action === 'reject') {
        if (!confirmBox || !ui) return;
        confirmBox.innerHTML = ui.confirmHtml(action, quoteId);
        confirmBox.hidden = false;
        if (actions) actions.hidden = true;
        const focusTarget = confirmBox.querySelector(action === 'reject' ? 'textarea' : 'button');
        if (focusTarget) focusTarget.focus();
        return;
    }
    if (action === 'cancel') {
        if (confirmBox) { confirmBox.hidden = true; confirmBox.innerHTML = ''; }
        if (actions) { actions.hidden = false; const first = actions.querySelector('button'); if (first) first.focus(); }
        setProposalFeedback(box, '');
        return;
    }
    if (action !== 'confirm-approve' && action !== 'confirm-reject') return;

    const decision = action === 'confirm-approve' ? 'approve' : 'reject';
    const reasonEl = confirmBox ? confirmBox.querySelector('textarea') : null;
    const reason = reasonEl ? reasonEl.value.trim() : '';
    const buttons = box ? Array.from(box.querySelectorAll('button')) : [button];
    buttons.forEach(b => { b.disabled = true; });
    setProposalFeedback(box, decision === 'approve' ? 'Enviando tu respuesta…' : 'Enviando tu respuesta…');

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) { window.location.href = '/client/login'; return; }
        const result = await WeotziData.Api.decideByClient(quoteId, decision, reason, session.access_token);
        const index = currentQuotations.findIndex(q => q.quote_id === quoteId);
        if (index !== -1) {
            currentQuotations[index] = Object.assign({}, currentQuotations[index], result.quotation || {}, {
                quote_status: result.quote_status || (decision === 'approve' ? 'client_approved' : 'client_rejected')
            });
        }
        updateStats();
        renderQuotations();
        refreshOpenDetail(quoteId);
        const slot = document.getElementById('quote-proposal-slot');
        const note = slot && slot.querySelector ? slot.querySelector('.cqp') : null;
        if (note) {
            const done = document.createElement('p');
            done.className = 'cqp-feedback is-success';
            done.setAttribute('role', 'status');
            done.textContent = decision === 'approve'
                ? 'Listo: aceptaste la propuesta. Le avisamos al artista; coordina el turno y el anticipo por el chat.'
                : 'Listo: rechazaste la propuesta. Le avisamos al artista.';
            note.appendChild(done);
        }
    } catch (error) {
        console.error('Error deciding quotation:', error);
        buttons.forEach(b => { b.disabled = false; });
        setProposalFeedback(box, error && error.message ? error.message : 'No pudimos guardar tu respuesta. Prueba de nuevo.', true);
        if (error && (error.status === 409 || error.status === 410)) {
            // El estado cambió (o venció): recargamos para mostrar el real y
            // dejamos visible el motivo debajo del bloque actualizado.
            await loadQuotations();
            refreshOpenDetail(quoteId);
            const slot = document.getElementById('quote-proposal-slot');
            const block = slot && slot.querySelector ? slot.querySelector('.cqp') : null;
            if (block) {
                const note = document.createElement('p');
                note.className = 'cqp-feedback is-error';
                note.setAttribute('role', 'alert');
                note.textContent = error.message;
                block.appendChild(note);
            }
        }
    }
}

// Deep link de los emails: /client/dashboard?quote=ID abre esa cotización.
// Si el cliente llega sin sesión, el login lo devuelve a /client/dashboard sin
// el ?quote: lo guardamos en sessionStorage (misma pestaña) y lo retomamos.
const PENDING_QUOTE_KEY = 'wo_client_pending_quote';

function quoteIdFromUrl() {
    try {
        const params = new URLSearchParams((typeof window !== 'undefined' && window.location && window.location.search) || '');
        const quoteId = (params.get('quote') || '').trim();
        return quoteId && quoteId.length <= 64 ? quoteId : '';
    } catch (_) {
        return '';
    }
}

function rememberPendingQuote() {
    const quoteId = quoteIdFromUrl();
    if (!quoteId) return;
    try { window.sessionStorage.setItem(PENDING_QUOTE_KEY, quoteId); } catch (_) { /* sin storage: se pierde el deep link */ }
}

function takePendingQuote() {
    try {
        const value = window.sessionStorage.getItem(PENDING_QUOTE_KEY) || '';
        window.sessionStorage.removeItem(PENDING_QUOTE_KEY);
        return value && value.length <= 64 ? value : '';
    } catch (_) {
        return '';
    }
}

async function openQuotationFromUrl() {
    try {
        // Sin sesión (checkDashboardAuth ya está redirigiendo al login) el
        // pendiente se conserva para la vuelta.
        if (!currentClient) return;
        const pending = takePendingQuote();
        const quoteId = quoteIdFromUrl() || pending;
        if (!quoteId) return;
        if (!currentQuotations.some(q => q.quote_id === quoteId)) return;
        if (typeof revealQuotationsPanel === 'function') revealQuotationsPanel();
        await viewQuotationDetail(quoteId);
    } catch (error) {
        console.warn('No pudimos abrir la cotización del enlace:', error && error.message);
    }
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
                <p>El artista marcó el trabajo como terminado. Confirma el cierre si el servicio se entregó correctamente.</p>
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
                <p>Trabajo finalizado. Puedes dejar reseñas verificadas de esta experiencia.</p>
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

    if (!confirm('¿Confirmas que el trabajo se finalizó correctamente?')) return;

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
                    <p>Inicia la conversación con el artista</p>
                </div>
            `;
            return;
        }
        
        // INB-01: el texto del mensaje es del usuario → siempre textContent.
        chatContainer.textContent = '';
        messages.forEach(msg => chatContainer.appendChild(buildChatMessageEl(msg)));

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

// Rechazar la propuesta cierra la conversación para los dos: el artista ya no
// puede responder y la base tampoco deja escribir (policy
// chat_closed_after_client_rejection, migración 20261116140000).
const CHAT_CLOSED_REJECTED_NOTE = 'Rechazaste esta propuesta y la conversación quedó cerrada. Si quieres retomar la idea, inicia una cotización nueva.';

function isChatClosedForClient(quotation) {
    return !!quotation && String(quotation.quote_status || '').toLowerCase() === 'client_rejected';
}

// Habilita o cierra el redactor del detalle según el estado de la cotización.
function syncChatComposer(quotation) {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (!input || !sendBtn) return;
    const closed = isChatClosedForClient(quotation);
    input.disabled = closed;
    sendBtn.disabled = closed;
    let note = document.getElementById('chat-closed-note');
    if (closed && !note) {
        const container = input.closest ? input.closest('.chat-input-container') : null;
        if (container && container.parentNode) {
            note = document.createElement('p');
            note.id = 'chat-closed-note';
            note.className = 'chat-closed-note';
            note.setAttribute('role', 'status');
            container.parentNode.insertBefore(note, container);
        }
    }
    if (note) {
        note.textContent = closed ? CHAT_CLOSED_REJECTED_NOTE : '';
        note.hidden = !closed;
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message || !currentQuotationId) return;
    const openQuotation = currentQuotations.find(q => q.quote_id === currentQuotationId) || null;
    if (isChatClosedForClient(openQuotation)) {
        syncChatComposer(openQuotation);
        return;
    }
    
    const sendBtn = document.getElementById('chat-send-btn');
    sendBtn.disabled = true;
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        const saved = await WeotziData.Chat.sendMessage({
            quoteId: currentQuotationId,
            senderType: 'client',
            senderId: session.user.id,
            message: message
        });

        // Clear input
        input.value = '';

        // Chat.sendMessage dispatches the persisted message notification.
        // Se pinta la fila guardada (id real) sin esperar al realtime; el eco
        // del mismo INSERT se descarta por data-message-id (INB-04).
        const savedMessage = Array.isArray(saved) ? saved[0] : saved;
        if (savedMessage && savedMessage.id) addMessageToChat(savedMessage);

    } catch (error) {
        console.error('Error sending message:', error);
        alert('Error al enviar el mensaje');
    } finally {
        sendBtn.disabled = isChatClosedForClient(currentQuotations.find(q => q.quote_id === currentQuotationId) || null);
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
    
    // Eco realtime de un mensaje ya pintado (mismo id): no se duplica.
    if (message.id && chatContainer.querySelector(`[data-message-id="${CSS.escape(String(message.id))}"]`)) return;

    chatContainer.appendChild(buildChatMessageEl(message));
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Mark as read if from artist
    if (message.sender_type === 'artist') {
        markMessagesAsRead(message.quotation_id);
    }
}

// Burbuja de chat construida con DOM: el texto y la hora van por textContent
// (nunca innerHTML con datos del usuario). Los adjuntos se abren en el Inbox.
function buildChatMessageEl(msg) {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message ' + (msg.sender_type === 'artist' ? 'artist' : 'client');
    if (msg.id) messageEl.dataset.messageId = String(msg.id);
    const text = String(msg.message || '').trim();
    if (text) messageEl.appendChild(document.createTextNode(text));
    if (msg.attachment_path) {
        const link = document.createElement('a');
        link.className = 'chat-attachment-link';
        link.href = (window.WEOTZI_BASE_PATH || '') + '/client/chats/?quote=' + encodeURIComponent(msg.quotation_id || '');
        link.textContent = (msg.message_kind === 'image' ? 'Imagen adjunta' : 'Archivo adjunto') + (msg.attachment_name ? ': ' + msg.attachment_name : '') + ' · ver en Inbox';
        if (text) messageEl.appendChild(document.createElement('br'));
        messageEl.appendChild(link);
    }
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(msg.created_at);
    messageEl.appendChild(time);
    // Ronda 2 (inbox): saludo o ausencia automática del artista.
    if (msg.auto_kind) time.appendChild(document.createTextNode(' · Mensaje automático'));
    return messageEl;
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
            // Si el detalle está abierto, refrescamos la propuesta (p. ej. el
            // artista respondió o editó el acuerdo mientras el cliente miraba).
            refreshOpenDetail(payload.new.quote_id);
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
        alert('Elige una imagen.');
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
            alert('Sesión expirada. Inicia sesión de nuevo.');
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
                        alert('El almacenamiento de fotos no está configurado. Contacta al administrador.');
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
        alert('No se pudieron guardar los cambios. Prueba de nuevo.');
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
// cliente-panel (ronda 2): contraofertas pendientes de mis postulaciones, para
// que la etiqueta de la solicitud diga lo mismo que en /client/requests.
let jbPendingOffers = [];

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
        loadJbPendingOffers();
    } catch (err) {
        console.error('Error loading JB requests:', err);
        container.innerHTML = '<div class="empty-state"><i data-wo-icon="alert-triangle"></i><p>Error al cargar solicitudes</p></div>';
    }
}

// No bloquea el listado: si hay contraofertas pendientes, repinta las etiquetas.
async function loadJbPendingOffers() {
    const repo = WeotziData.JobBoard && WeotziData.JobBoard.CounterOffers;
    if (!repo || typeof repo.listPendingByApplications !== 'function') return;
    const ids = [];
    jbRequests.forEach(r => {
        if (r.status === 'closed' || r.status === 'expired') return;
        (r.job_board_applications || []).forEach(a => {
            if (a.id && a.status !== 'withdrawn' && a.status !== 'rejected') ids.push(a.id);
        });
    });
    try {
        const before = jbPendingOffers.length;
        jbPendingOffers = ids.length ? await repo.listPendingByApplications(ids) : [];
        if (jbPendingOffers.length || before) renderJobBoardRequests();
    } catch (err) {
        console.warn('No pudimos leer las contraofertas pendientes:', err && err.message);
    }
}

function renderJobBoardRequests() {
    const container = document.getElementById('jb-requests-list');
    // cliente-panel (ronda 2): mismas etiquetas que /client/requests, datos
    // escapados y un solo lugar para ver y elegir postulaciones (/client/requests).
    const panel = panelModel();

    if (jbRequests.length === 0) {
        container.innerHTML = panel
            ? panel.emptyHtml(panel.emptyState('requests'), { variant: 'dashboard' })
            : `
            <div class="empty-state">
                <i data-wo-icon="radio"></i>
                <h3>Sin solicitudes</h3>
                <p>Todavía no publicaste solicitudes en el Job Board</p>
                <a href="/job-board/request" class="wo-btn wo-btn--hard">Publicar idea <i data-wo-icon="arrow-right" class="wo-icon-18"></i></a>
            </div>`;
        return;
    }

    const legacyLabels = { draft: 'Borrador', open: 'Abierta', in_review: 'En revisión', accepted: 'Aceptada', closed: 'Cerrada', expired: 'Expirada' };
    const e = escapeFeedHtml;

    container.innerHTML = jbRequests.map(req => {
        const status = panel
            ? panel.requestStatusOf(req, { pendingOffers: jbPendingOffers })
            : { label: legacyLabels[req.status] || 'En revisión', tone: 'jb-' + String(req.status || '').replace(/[^a-z_]/g, '') };
        const apps = (req.job_board_applications || []).filter(a => a.status !== 'withdrawn');
        const unseen = apps.filter(a => a.status === 'pending').length;
        const thumbnail = safeHttpUrl(req.job_board_attachments?.[0]?.file_url);
        const styles = e(formatClientQuotationStyle(req.tattoo_style));
        const idea = String(req.tattoo_idea_description || '').trim();
        const title = idea ? idea.substring(0, 60) + (idea.length > 60 ? '…' : '') : 'Sin descripción';
        const code = panel ? panel.requestCode(req) : (req.request_code || '');
        const budget = req.client_budget_min && req.client_budget_max
            ? '$' + req.client_budget_min + ' – $' + req.client_budget_max + ' ' + (req.client_budget_currency || 'USD')
            : 'Sin definir';

        return `
        <div class="quotation-card" data-request-id="${e(req.id)}">
            <div class="quotation-header">
                <span class="quotation-id">${e(code)}</span>
                <span class="quotation-status ${e(status.tone)}">${e(status.label)}</span>
            </div>
            <div class="quotation-body">
                <div class="quotation-artist">
                    ${thumbnail ? `<img src="${e(thumbnail)}" alt="">` : '<div class="artist-avatar">JB</div>'}
                    <div class="artist-info">
                        <h4>${e(title)}</h4>
                        <p>${e(req.tattoo_body_part || '')} ${styles ? '· ' + styles : ''}</p>
                    </div>
                </div>
                <div class="quotation-details">
                    <div class="detail-item">
                        <div class="detail-label">Zona</div>
                        <div class="detail-value">${e(req.tattoo_body_part || '–')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Presupuesto</div>
                        <div class="detail-value">${e(budget)}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Postulaciones</div>
                        <div class="detail-value">${apps.length}${unseen ? ` (${unseen} sin ver)` : ''}</div>
                    </div>
                </div>
            </div>
            <div class="quotation-footer">
                <a class="wo-btn wo-btn--ghost wo-btn--s" href="/client/requests?id=${encodeURIComponent(req.id)}">
                    ${apps.length ? 'Ver postulaciones' : 'Ver solicitud'}
                </a>
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
        contentEl.innerHTML = '<div class="jb-modal-empty"><p>Todavía no hay postulaciones para esta solicitud.</p><p class="hint">Comparte el enlace del Job Board para atraer más artistas.</p></div>';
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
                <div class="jb-app-avatar">${artist.profile_picture ? `<img src="${escapeFeedHtml(artist.profile_picture)}" alt="">` : escapeFeedHtml((artist.name || 'A').charAt(0).toUpperCase())}</div>
                <div class="jb-app-info">
                    <div class="jb-app-name">${escapeFeedHtml(artist.name || artist.username || 'Artista')}</div>
                    <div class="jb-app-meta">${escapeFeedHtml(artist.ubicacion || '')} ${styles ? '· ' + escapeFeedHtml(styles) : ''}</div>
                </div>
                <span class="jb-app-status st-${escapeFeedHtml(app.status)}">${escapeFeedHtml(statusLabels[app.status] || app.status)}</span>
            </div>
            <div class="jb-app-body">
                <p class="jb-app-msg">${escapeFeedHtml(app.message || 'Sin mensaje')}</p>
                <div class="jb-app-facts">
                    ${app.estimated_price ? '<span>Precio est. · ' + escapeFeedHtml(app.estimated_price) + '</span>' : ''}
                    ${app.estimated_sessions ? '<span>Sesiones · ' + escapeFeedHtml(app.estimated_sessions) + '</span>' : ''}
                    ${app.availability_note ? '<span>Disponibilidad · ' + escapeFeedHtml(app.availability_note) + '</span>' : ''}
                </div>
                ${artist.username ? '<a href="' + escapeFeedHtml('/artist/profile?artist=' + encodeURIComponent(artist.username)) + '" target="_blank" rel="noopener" class="jb-app-link">Ver perfil del artista →</a>' : ''}
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
    if (!confirm('¿Aceptas esta postulación? Se crea una cotización con este artista y las demás postulaciones se rechazan.')) return;

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session?.access_token) {
            alert('Tu sesión expiró. Recarga la página e inicia sesión de nuevo.');
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
    if (!confirm('¿Rechazas esta postulación?')) return;

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
