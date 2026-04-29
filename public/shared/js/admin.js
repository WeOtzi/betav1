// ============================================
// WE ÖTZI - ADMIN PANEL
// Configuration and management dashboard
// ============================================

// ============ STATE ============
let supabaseClient = null;
let currentQuotations = [];
let selectedQuotations = new Set(); // [NEW] Selection state
let currentArtists = [];
let currentPage = 1;
let currentArtistsPage = 1;
const itemsPerPage = 10; // Quotations
let artistsItemsPerPage = 15; // Artists [NEW]

// Questions configuration
let questionsConfig = [];

// Styles configuration (extracted from questionsConfig)
let currentStyles = [];

// Job Board state
let allJobBoardRequests = [];
let filteredJobBoardRequests = [];
let jobBoardPage = 1;
const jobBoardPerPage = 15;

// Routes state
let currentRoutes = {};
let routeHealthResults = {};

// Tickets state
let allTickets = [];
let filteredTickets = [];
let currentTicketId = null;
let _ticketRealtimeChannels = [];

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
    await initAdmin();
});

async function initAdmin() {
    // Load saved settings
    loadSettings();

    // Setup navigation
    setupNavigation();

    // Wait for ConfigManager to be ready before connecting to Supabase
    await waitForConfigManager();

    // Try to connect to Supabase with saved credentials
    initSupabase();

    // Load questions from Supabase (Centralized source of truth)
    await syncQuestionsFromDB();

    console.log('🔧 Admin Panel initialized');
}

// Helper to wait for ConfigManager to be available
async function waitForConfigManager(timeout = 5000) {
    const startTime = Date.now();
    while (!window.ConfigManager && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.ConfigManager) {
        console.warn('⚠️ ConfigManager not available after timeout');
    }
}

async function syncQuestionsFromDB() {
    if (window.ConfigManager) {
        const dbQuestions = await window.ConfigManager.loadQuestionsFromDB();
        if (dbQuestions && dbQuestions.length > 0) {
            questionsConfig = dbQuestions;
            // Also sync to localStorage for offline fallback
            localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
            console.log('✅ Questions synced from Supabase');
        } else {
            // Fallback to localStorage
            const saved = localStorage.getItem('weotzi_questions_config');
            if (saved) {
                questionsConfig = JSON.parse(saved);
                console.log('ℹ️ Using questions from localStorage');
            }
        }
    }
    renderQuestions();
}

// ============ NAVIGATION ============
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            showSection(section);
        });
    });
}

function showSection(sectionId) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === sectionId) {
            item.classList.add('active');
        }
    });

    // Update content
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`section-${sectionId}`).classList.add('active');

    // Update header title
    const titles = {
        'dashboard': 'Dashboard',
        'quotations': 'Cotizaciones',
        'artists': 'Gestion de Artistas',
        'questions': 'Configurar Preguntas',
        'styles': 'Estilos de Tatuaje',
        'settings': 'Configuracion',
        'content': 'Contenido de la App',
        'analytics': 'Analytics de Usuarios',
        // Super Admin sections
        'apis': 'Gestion de APIs',
        'database': 'Base de Datos',
        'routes': 'Gestion de Rutas',
        'backup': 'Backup y Restauracion',
        'support': 'Usuarios de Soporte',
        'events': 'Eventos y Webhooks',
        'email-routing': 'Email Routing (n8n / BillionMail)',
        'currencies': 'Monedas y Tipos de Cambio',
        'jobboard': 'Job Board',
        'tickets': 'Tickets de Soporte',
        'verifications': 'Centro de Verificaciones'
    };
    document.getElementById('section-title').textContent = titles[sectionId];

    // Load data if needed
    if (sectionId === 'quotations') {
        loadQuotations();
    } else if (sectionId === 'artists') {
        loadArtists();
    } else if (sectionId === 'styles') {
        loadTattooStyles();
    } else if (sectionId === 'content') {
        initContentSection();
    } else if (sectionId === 'apis') {
        loadAPIsSection();
    } else if (sectionId === 'database') {
        loadDatabaseSection();
    } else if (sectionId === 'routes') {
        loadRoutesSection();
    } else if (sectionId === 'backup') {
        loadBackupSection();
    } else if (sectionId === 'support') {
        loadSupportUsers();
    } else if (sectionId === 'events') {
        loadN8NEvents();
    } else if (sectionId === 'email-routing') {
        if (typeof loadEmailRouting === 'function') loadEmailRouting();
    } else if (sectionId === 'currencies') {
        loadCurrenciesAdmin();
    } else if (sectionId === 'analytics') {
        loadAnalyticsData();
    } else if (sectionId === 'jobboard') {
        loadJobBoardAdmin();
    } else if (sectionId === 'tickets') {
        loadSupportTickets();
    } else if (sectionId === 'verifications') {
        loadVerificationQueue();
    }
}

// ============ SETTINGS ============
function loadSettings() {
    const savedSettings = localStorage.getItem('weotzi_admin_settings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);

        // Supabase
        if (settings.supabase) {
            document.getElementById('supabase-url').value = settings.supabase.url || '';
            document.getElementById('supabase-key').value = settings.supabase.key || '';
        }

        // EmailJS
        if (settings.emailjs) {
            document.getElementById('emailjs-service').value = settings.emailjs.serviceId || '';
            document.getElementById('emailjs-template').value = settings.emailjs.templateId || '';
            document.getElementById('emailjs-key').value = settings.emailjs.publicKey || '';
        }

        // App settings
        if (settings.app) {
            document.getElementById('setting-max-images').value = settings.app.maxImages || 4;
            document.getElementById('setting-max-image-size').value = settings.app.maxImageSize || 5;
            document.getElementById('setting-default-currency').value = settings.app.defaultCurrency || 'USD';
        }

        // Demo Mode [NEW]
        if (settings.features) {
            document.getElementById('setting-demo-mode').checked = settings.features.demoMode || false;
        }
    }
}

function saveSettings() {
    const settings = {
        supabase: {
            url: document.getElementById('supabase-url').value,
            key: document.getElementById('supabase-key').value
        },
        emailjs: {
            serviceId: document.getElementById('emailjs-service').value,
            templateId: document.getElementById('emailjs-template').value,
            publicKey: document.getElementById('emailjs-key').value
        },
        app: {
            maxImages: parseInt(document.getElementById('setting-max-images').value),
            maxImageSize: parseInt(document.getElementById('setting-max-image-size').value),
            defaultCurrency: document.getElementById('setting-default-currency').value
        },
        features: {
            demoMode: document.getElementById('setting-demo-mode').checked // [NEW]
        }
    };

    localStorage.setItem('weotzi_admin_settings', JSON.stringify(settings));
    return settings;
}

function saveAppSettings() {
    saveSettings();
    updateConfigFile();
    showToast('Configuración guardada', 'success');
}

function saveEmailJSSettings() {
    saveSettings();
    updateConfigFile();
    showToast('EmailJS configurado', 'success');
}

// Toggle Demo Mode on/off
function toggleDemoMode() {
    const isDemo = document.getElementById('setting-demo-mode').checked;

    // Save the setting immediately
    saveSettings();
    updateConfigFile();

    if (isDemo) {
        // Activating Demo Mode
        updateConnectionStatus(false, true); // Show demo status
        showToast('Modo Demo activado. Usando datos de prueba.', 'info');

        // Refresh artists section if currently viewing it
        const artistsSection = document.getElementById('section-artists');
        if (artistsSection && artistsSection.classList.contains('active')) {
            loadArtists();
        }
    } else {
        // Deactivating Demo Mode
        if (supabaseClient) {
            updateConnectionStatus(true); // Show connected
            loadDashboardStats(); // Refresh with real data
        } else {
            updateConnectionStatus(false); // Show disconnected
        }
        showToast('Modo Demo desactivado. Usando Supabase.', 'info');

        // Refresh current section
        const artistsSection = document.getElementById('section-artists');
        if (artistsSection && artistsSection.classList.contains('active')) {
            loadArtists();
        }
    }
}

// Update the config.js file content (generates downloadable version)
function updateConfigFile() {
    const settings = JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}');

    const configContent = `// ============================================
// WE ÖTZI - QUOTATION APP CONFIGURATION
// Generated by Admin Panel on ${new Date().toLocaleString()}
// ============================================

const CONFIG = {
    // Supabase Configuration
    supabase: {
        url: '${settings.supabase?.url || 'https://YOUR_PROJECT_ID.supabase.co'}',
        key: '${settings.supabase?.key || 'YOUR_SUPABASE_ANON_KEY'}'
    },
    
    // EmailJS Configuration
    emailjs: {
        serviceId: '${settings.emailjs?.serviceId || 'YOUR_SERVICE_ID'}',
        templateId: '${settings.emailjs?.templateId || 'YOUR_TEMPLATE_ID'}',
        publicKey: '${settings.emailjs?.publicKey || 'YOUR_PUBLIC_KEY'}'
    },
    
    // App Settings
    settings: {
        maxImages: ${settings.app?.maxImages || 4},
        maxImageSize: ${(settings.app?.maxImageSize || 5) * 1024 * 1024},
        acceptedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
        totalSteps: 19,
        defaultCurrency: '${settings.app?.defaultCurrency || 'USD'}'
    }
};

// Initialize Supabase Client
supabaseClient = null;

if (typeof window.supabase !== 'undefined' && 
    CONFIG.supabase.url !== 'https://YOUR_PROJECT_ID.supabase.co') {
    supabaseClient = window.supabase.createClient(
        CONFIG.supabase.url, 
        CONFIG.supabase.key
    );
    console.log('✅ Supabase client initialized');
} else {
    console.warn('⚠️ Supabase not configured. Running in demo mode.');
}

// Initialize EmailJS
if (typeof window.emailjs !== 'undefined' && 
    CONFIG.emailjs.publicKey !== 'YOUR_PUBLIC_KEY') {
    emailjs.init(CONFIG.emailjs.publicKey);
    console.log('✅ EmailJS initialized');
} else {
    console.warn('⚠️ EmailJS not configured. Emails will not be sent.');
}

// Export for use in script.js
window.APP_CONFIG = CONFIG;
window.supabaseClient = supabaseClient;
`;

    // Store for export
    window.generatedConfig = configContent;
}

// ============ SUPABASE ============
function initSupabase() {
    const savedSettings = localStorage.getItem('weotzi_admin_settings');
    if (!savedSettings) return;

    const settings = JSON.parse(savedSettings);
    if (settings.supabase?.url && settings.supabase?.key) {
        connectSupabase(settings.supabase.url, settings.supabase.key);
    }
}

async function connectSupabase(url, key) {
    try {
        if (!url || !key) return; // Silent return if empty

        // Ensure ConfigManager is available before proceeding
        if (!window.ConfigManager) {
            console.warn('⚠️ ConfigManager not ready, skipping Supabase connection');
            return;
        }

        // Use singleton from ConfigManager
        supabaseClient = window.ConfigManager.getSupabaseClient();

        if (!supabaseClient) {
            // If URL/Key just changed, we might need to update ConfigManager first
            window.ConfigManager.update({
                supabase: { url, anonKey: key }
            });
            supabaseClient = window.ConfigManager.getSupabaseClient();
        }

        if (!supabaseClient) throw new Error("Could not initialize Supabase client");

        // Test connection
        const { data, error } = await supabaseClient
            .from('quotations_db')
            .select('count')
            .limit(1);

        if (error) throw error;

        updateConnectionStatus(true);
        loadDashboardStats();

    } catch (error) {
        console.error('Supabase connection error:', error);
        updateConnectionStatus(false);
        supabaseClient = null;

        // If in Demo Mode, update status to show Demo active instead of just "Disconnected"
        if (document.getElementById('setting-demo-mode').checked) {
            updateConnectionStatus(false, true); // Show demo status
        }
    }
}

async function testSupabaseConnection() {
    const url = document.getElementById('supabase-url').value.trim();
    const key = document.getElementById('supabase-key').value.trim();

    if (!url || !key) {
        showToast('Por favor ingresa URL y Key', 'error');
        return;
    }

    showToast('Probando conexión...', 'info');

    try {
        const testClient = window.supabase.createClient(url, key);

        // Try to access quotations_db
        const { data, error } = await testClient
            .from('quotations_db')
            .select('quote_id')
            .limit(1);

        if (error) throw error;

        // Save settings
        saveSettings();

        // Connect
        supabaseClient = testClient;
        updateConnectionStatus(true);
        loadDashboardStats();

        showToast('¡Conexión exitosa!', 'success');

    } catch (error) {
        console.error('Connection test failed:', error);
        showToast('Error de conexión: ' + error.message, 'error');
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(connected, isDemo = false) {
    const statusEl = document.getElementById('connection-status');
    const supabaseStatusEl = document.getElementById('supabase-status');

    if (connected) {
        statusEl.classList.add('connected');
        statusEl.classList.remove('demo-mode');
        statusEl.innerHTML = '<i class="fa-solid fa-circle"></i><span>Conectado</span>';
        supabaseStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Conectado';
        supabaseStatusEl.className = 'connection-value success';
    } else if (isDemo) {
        statusEl.classList.remove('connected');
        statusEl.classList.add('demo-mode');
        statusEl.innerHTML = '<i class="fa-solid fa-flask"></i><span>Modo Demo</span>';
        supabaseStatusEl.innerHTML = '<i class="fa-solid fa-flask"></i> Modo Demo Activo';
        supabaseStatusEl.className = 'connection-value warning';
    } else {
        statusEl.classList.remove('connected');
        statusEl.classList.remove('demo-mode');
        statusEl.innerHTML = '<i class="fa-solid fa-circle"></i><span>Desconectado</span>';
        supabaseStatusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> No conectado';
        supabaseStatusEl.className = 'connection-value error';
    }
}

// ============ DASHBOARD ============
async function loadDashboardStats() {
    if (!supabaseClient) return;

    try {
        // Total quotations
        const { count: total } = await supabaseClient
            .from('quotations_db')
            .select('*', { count: 'exact', head: true });

        document.getElementById('stat-total').textContent = total || 0;

        // Pending (Awaiting artist response)
        const { count: pendingCount } = await supabaseClient
            .from('quotations_db')
            .select('*', { count: 'exact', head: true })
            .eq('quote_status', 'pending');

        document.getElementById('stat-pending-artist').textContent = pendingCount || 0;

        // Responded (Addressed by artist)
        const { count: respondedCount } = await supabaseClient
            .from('quotations_db')
            .select('*', { count: 'exact', head: true })
            .eq('quote_status', 'responded');

        document.getElementById('stat-responded').textContent = respondedCount || 0;

        // In progress (Still being filled by client)
        const { count: inProgressCount } = await supabaseClient
            .from('quotations_db')
            .select('*', { count: 'exact', head: true })
            .eq('quote_status', 'in_progress');

        document.getElementById('stat-in-progress').textContent = inProgressCount || 0;

        // Artists
        const { count: artists } = await supabaseClient
            .from('artists_db')
            .select('*', { count: 'exact', head: true });

        document.getElementById('stat-artists').textContent = artists || 0;

        // Recent quotations
        const { data: recent } = await supabaseClient
            .from('quotations_db')
            .select('quote_id, client_full_name, artist_name, created_at, quote_status')
            .order('created_at', { ascending: false })
            .limit(5);

        renderRecentQuotations(recent || []);

        // Load dashboard charts (Centro de Comando)
        loadDashboardCharts();

    } catch (error) {
        console.error('Error loading stats:', error);
        document.querySelectorAll('.stat-value').forEach(el => el.textContent = '—');
        showToast('No se pudieron cargar las estadisticas', 'warning');
    }
}

function renderRecentQuotations(quotations) {
    const container = document.getElementById('recent-quotations');

    if (quotations.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box" style="padding: 24px;">
                <i class="fa-solid fa-inbox"></i>
                <span class="empty-title">No hay cotizaciones recientes</span>
                <span class="empty-desc">Las nuevas solicitudes apareceran aqui.</span>
            </div>
        `;
        return;
    }

    const statusLabels = {
        'in_progress': 'En progreso',
        'pending': 'Pendiente',
        'responded': 'Respondida',
        'client_approved': 'Cliente Acepto',
        'client_rejected': 'Cliente Rechazo',
        'completed': 'Completada'
    };

    container.innerHTML = quotations.map(q => `
        <div class="recent-item">
            <div class="recent-info">
                <span class="recent-id">${q.quote_id}</span>
                <span class="recent-meta">${escapeHtml(q.client_full_name) || 'Prospecto'} → ${escapeHtml(q.artist_name) || 'Sin artista'}</span>
            </div>
            <span class="status-badge ${q.quote_status}">${statusLabels[q.quote_status] || q.quote_status}</span>
        </div>
    `).join('');
}

// ============ DASHBOARD CENTRO DE COMANDO ============
let dashCharts = {};

async function loadDashboardCharts() {
    loadQuotationsTrendChart();
    loadArtistsBreakdown();
    loadTicketsSummary();
    loadQuotationMetrics();
}

// --- Quotations Trend (line chart, last 8 weeks) ---
async function loadQuotationsTrendChart() {
    const container = document.getElementById('quotations-trend-chart');
    if (!container || !supabaseClient) return;
    try {
        const eightWeeksAgo = new Date();
        eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
        const { data, error } = await supabaseClient
            .from('quotations_db')
            .select('created_at, quote_status')
            .gte('created_at', eightWeeksAgo.toISOString());
        if (error) throw error;
        if (!data || data.length === 0) { renderQuotationsTrendEmpty(container); return; }

        const weeks = {};
        for (let i = 7; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i * 7);
            const key = d.toISOString().slice(0, 10);
            weeks[key] = { newCount: 0, completedCount: 0 };
        }
        const weekKeys = Object.keys(weeks);
        data.forEach(q => {
            const qd = q.created_at.slice(0, 10);
            let assigned = weekKeys[0];
            for (const wk of weekKeys) { if (qd >= wk) assigned = wk; }
            if (weeks[assigned]) {
                weeks[assigned].newCount++;
                if (q.quote_status === 'completed') weeks[assigned].completedCount++;
            }
        });
        const labels = weekKeys.map(k => { const d = new Date(k); return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); });
        const newData = weekKeys.map(k => weeks[k].newCount);
        const completedData = weekKeys.map(k => weeks[k].completedCount);
        renderQuotationsTrendChart(container, labels, newData, completedData);
    } catch (err) {
        console.error('Error loading quotations trend:', err);
        renderQuotationsTrendEmpty(container);
    }
}

function renderQuotationsTrendEmpty(canvas) {
    const parent = canvas.parentElement;
    if (parent) parent.innerHTML = '<div class="empty-state-box" style="padding:24px;"><i class="fa-solid fa-chart-line"></i><span class="empty-title">Sin datos de tendencia</span></div>';
}

function renderQuotationsTrendChart(canvas, labels, newData, completedData) {
    if (dashCharts.trend) dashCharts.trend.destroy();
    dashCharts.trend = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Nuevas', data: newData, borderColor: '#6c5ce7', backgroundColor: 'rgba(108,92,231,0.1)', tension: 0.3, fill: true },
                { label: 'Completadas', data: completedData, borderColor: '#00b894', backgroundColor: 'rgba(0,184,148,0.1)', tension: 0.3, fill: true }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#ccc' } } }, scales: { x: { ticks: { color: '#999' }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { beginAtZero: true, ticks: { color: '#999', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
}

// --- Artists Breakdown (doughnut chart) ---
async function loadArtistsBreakdown() {
    const canvas = document.getElementById('artists-doughnut-chart');
    if (!canvas || !supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('artists_db').select('status, is_verified');
        if (error) throw error;
        let active = 0, inactive = 0, verified = 0, pending = 0;
        (data || []).forEach(a => {
            if (a.status === 'active') active++; else inactive++;
            if (a.is_verified) verified++; else pending++;
        });
        renderArtistsDoughnut(canvas, active, inactive, verified, pending);
        const countEl = document.getElementById('artists-breakdown-count');
        if (countEl) countEl.textContent = (data || []).length;
    } catch (err) {
        console.error('Error loading artists breakdown:', err);
    }
}

function renderArtistsDoughnut(canvas, active, inactive, verified, pending) {
    if (dashCharts.artists) dashCharts.artists.destroy();
    dashCharts.artists = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Activos', 'Inactivos', 'Verificados', 'Pendientes'],
            datasets: [{ data: [active, inactive, verified, pending], backgroundColor: ['#00b894', '#636e72', '#6c5ce7', '#fdcb6e'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
    });
    // Update legend text
    const rows = document.querySelectorAll('.breakdown-row');
    const vals = [active, inactive, verified, pending];
    rows.forEach((row, i) => { const ve = row.querySelector('.breakdown-value'); if (ve) ve.textContent = vals[i] || 0; });
}

// --- Tickets Summary ---
async function loadTicketsSummary() {
    const container = document.getElementById('tickets-summary-content');
    if (!container || !supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('feedback_tickets').select('id, subject, ticket_priority, ticket_category, status, created_at').order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        const tickets = data || [];
        let critical = 0, high = 0, medium = 0, low = 0, open = 0;
        tickets.forEach(t => {
            if (t.status === 'open' || t.status === 'in_progress') open++;
            if (t.ticket_priority === 'critical') critical++;
            else if (t.ticket_priority === 'high') high++;
            else if (t.ticket_priority === 'medium') medium++;
            else low++;
        });
        container.innerHTML = `
            <div class="ticket-priority-row"><span class="priority-dot critical"></span><span>Criticos</span><span class="ticket-count">${critical}</span></div>
            <div class="ticket-priority-row"><span class="priority-dot high"></span><span>Alta</span><span class="ticket-count">${high}</span></div>
            <div class="ticket-priority-row"><span class="priority-dot medium"></span><span>Media</span><span class="ticket-count">${medium}</span></div>
            <div class="ticket-priority-row"><span class="priority-dot low"></span><span>Baja</span><span class="ticket-count">${low}</span></div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text-secondary);font-size:0.85rem;">Abiertos</span>
                <span style="color:#fdcb6e;font-weight:600;">${open}</span>
            </div>
            <div class="recent-tickets-list">
                ${tickets.slice(0, 3).map(t => `<div class="recent-ticket-item"><span class="priority-dot ${t.ticket_priority || 'low'}"></span><span style="flex:1;font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(t.subject) || 'Sin asunto'}</span><span class="status-badge ${t.status}">${t.status}</span></div>`).join('')}
            </div>`;
    } catch (err) {
        console.error('Error loading tickets summary:', err);
        container.innerHTML = '<div class="empty-state-box" style="padding:16px;"><span class="empty-title">Error cargando tickets</span></div>';
    }
}

// --- Quotation Metrics (from /api/analytics/quotations) ---
async function loadQuotationMetrics() {
    const kpiRow = document.getElementById('metrics-kpi-row');
    const trendCanvas = document.getElementById('metrics-trend-chart');
    const styleTable = document.getElementById('conversion-style-table');
    const artistTable = document.getElementById('conversion-artist-table');
    if (!kpiRow) return;
    try {
        const resp = await fetch('/api/analytics/quotations?days=90');
        if (!resp.ok) throw new Error('API error');
        const result = await resp.json();
        if (!result.success) throw new Error(result.error);
        const d = result.data;

        // KPIs
        const avgHours = d.avgResponseHours != null ? Math.round(d.avgResponseHours) : '—';
        const total = Object.values(d.byStatus || {}).reduce((s, v) => s + v, 0);
        const completed = (d.byStatus || {}).completed || 0;
        const convRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0';
        kpiRow.innerHTML = `
            <div class="kpi-box"><span class="kpi-value">${avgHours}h</span><span class="kpi-label">Tiempo resp. promedio</span></div>
            <div class="kpi-box"><span class="kpi-value">${convRate}%</span><span class="kpi-label">Tasa de conversion</span></div>
            <div class="kpi-box"><span class="kpi-value">${total}</span><span class="kpi-label">Total (90 dias)</span></div>`;

        // Trend bar chart
        if (trendCanvas && d.trend) renderQuotationMetricsTrend(trendCanvas, d.trend);

        // Conversion tables
        if (styleTable && d.conversionByStyle) renderConversionByStyleTable(styleTable, d.conversionByStyle);
        if (artistTable && d.conversionByArtist) renderConversionByArtistTable(artistTable, d.conversionByArtist);
    } catch (err) {
        console.error('Error loading quotation metrics:', err);
        kpiRow.innerHTML = '<div class="kpi-box"><span class="kpi-value">—</span><span class="kpi-label">Error cargando metricas</span></div>';
    }
}

function renderQuotationMetricsTrend(canvas, trend) {
    if (dashCharts.metricsTrend) dashCharts.metricsTrend.destroy();
    const labels = trend.map(t => t.week || t.date || '');
    const values = trend.map(t => t.count || 0);
    dashCharts.metricsTrend = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Cotizaciones', data: values, backgroundColor: 'rgba(108,92,231,0.6)', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#999' }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#999', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
}

function renderConversionByStyleTable(container, styles) {
    if (!styles.length) { container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Sin datos</p>'; return; }
    const maxTotal = Math.max(...styles.map(s => s.total || 1));
    container.innerHTML = `<table class="mini-table"><thead><tr><th>Estilo</th><th>Conv.</th><th></th></tr></thead><tbody>${styles.slice(0, 8).map(s => {
        const rate = s.total > 0 ? ((s.completed || 0) / s.total * 100).toFixed(0) : 0;
        const width = s.total > 0 ? (s.total / maxTotal * 100).toFixed(0) : 0;
        return `<tr><td>${s.style || 'N/A'}</td><td>${rate}%</td><td><div class="conversion-bar"><div class="conversion-bar-fill" style="width:${width}%"></div></div></td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderConversionByArtistTable(container, artists) {
    if (!artists.length) { container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Sin datos</p>'; return; }
    const maxTotal = Math.max(...artists.map(a => a.total || 1));
    container.innerHTML = `<table class="mini-table"><thead><tr><th>Artista</th><th>Conv.</th><th></th></tr></thead><tbody>${artists.slice(0, 8).map(a => {
        const rate = a.total > 0 ? ((a.completed || 0) / a.total * 100).toFixed(0) : 0;
        const width = a.total > 0 ? (a.total / maxTotal * 100).toFixed(0) : 0;
        return `<tr><td>${escapeHtml(a.artist) || 'N/A'}</td><td>${rate}%</td><td><div class="conversion-bar"><div class="conversion-bar-fill" style="width:${width}%"></div></div></td></tr>`;
    }).join('')}</tbody></table>`;
}

// ============ QUOTATIONS ============
async function loadQuotations() {
    if (!supabaseClient) {
        showTableEmptyState('quotations-tbody', 8, 'fa-plug', 'Sin conexion a Supabase', 'Configura la conexion en la seccion de Configuracion para ver cotizaciones.');
        return;
    }

    const searchTerm = document.getElementById('search-quotations').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;

    showTableLoading('quotations-tbody', 8);

    try {
        let query = supabaseClient
            .from('quotations_db')
            .select('*')
            .order('created_at', { ascending: false });

        if (statusFilter) {
            query = query.eq('quote_status', statusFilter);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Filter by search term
        let filtered = data;
        if (searchTerm) {
            filtered = data.filter(q =>
                q.quote_id?.toLowerCase().includes(searchTerm) ||
                q.client_full_name?.toLowerCase().includes(searchTerm) ||
                q.artist_name?.toLowerCase().includes(searchTerm)
            );
        }

        currentQuotations = filtered;
        renderQuotationsTable();

    } catch (error) {
        console.error('Error loading quotations:', error);
        showTableErrorState('quotations-tbody', 8, 'No se pudieron cargar las cotizaciones. Verifica tu conexion.', 'loadQuotations()');
        showToast('Error cargando cotizaciones', 'error');
    }
}

function renderQuotationsTable() {
    const tbody = document.getElementById('quotations-tbody');
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = currentQuotations.slice(start, end);

    if (pageItems.length === 0) {
        showTableEmptyState('quotations-tbody', 8, 'fa-file-invoice', 'No se encontraron cotizaciones', 'Ajusta los filtros de busqueda o espera nuevas solicitudes.');
        return;
    }

    // Check if all visible items are selected
    const allSelected = pageItems.length > 0 && pageItems.every(q => selectedQuotations.has(q.quote_id));
    document.getElementById('select-all-quotations').checked = allSelected;

    const statusLabels = {
        'in_progress': 'En progreso',
        'pending': 'Pendiente',
        'responded': 'Respondida',
        'client_approved': 'Cliente Acepto',
        'client_rejected': 'Cliente Rechazo',
        'completed': 'Completada'
    };

    tbody.innerHTML = pageItems.map(q => {
        const date = q.created_at ? new Date(q.created_at).toLocaleDateString('es-ES') : '—';
        const isSelected = selectedQuotations.has(q.quote_id);

        return `
            <tr class="${isSelected ? 'selected-row' : ''}">
                <td class="w-checkbox">
                    <input type="checkbox" onchange="toggleSelectQuotation('${q.quote_id}')" ${isSelected ? 'checked' : ''}>
                </td>
                <td>${q.quote_id}</td>
                <td>${date}</td>
                <td>${escapeHtml(q.client_full_name) || '—'}</td>
                <td>${escapeHtml(q.artist_name) || '—'}</td>
                <td>${formatTattooStyleDisplay(q.tattoo_style)}</td>
                <td><span class="status-badge ${q.quote_status}">${statusLabels[q.quote_status] || q.quote_status}</span></td>
                <td>
                    <button class="btn-icon" onclick="viewQuotation('${q.quote_id}')" title="Ver detalle">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="btn-icon" onclick="exportQuotation('${q.quote_id}')" title="Exportar JSON">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="btn-icon danger" onclick="deleteQuotation('${q.quote_id}')" title="Eliminar">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Render pagination
    renderPagination();
    updateBulkActionsUI();
}

// ============ SELECTION LOGIC ============
function toggleSelectQuotation(quoteId) {
    if (selectedQuotations.has(quoteId)) {
        selectedQuotations.delete(quoteId);
    } else {
        selectedQuotations.add(quoteId);
    }
    renderQuotationsTable();
}

function toggleSelectAllQuotations() {
    const checkbox = document.getElementById('select-all-quotations');
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = currentQuotations.slice(start, end);

    if (checkbox.checked) {
        pageItems.forEach(q => selectedQuotations.add(q.quote_id));
    } else {
        pageItems.forEach(q => selectedQuotations.delete(q.quote_id));
    }
    renderQuotationsTable();
}

function updateBulkActionsUI() {
    const toolbar = document.getElementById('quotations-bulk-actions');
    const countSpan = toolbar.querySelector('.selected-count');

    if (selectedQuotations.size > 0) {
        toolbar.classList.remove('hidden');
        countSpan.textContent = `${selectedQuotations.size} seleccionados`;
    } else {
        toolbar.classList.add('hidden');
    }
}

// ============ EXPORT LOGIC ============
function exportQuotation(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation) return;

    const blob = new Blob([JSON.stringify(quotation, null, 2)], { type: 'application/json' });
    saveAs(blob, `cotizacion-${quoteId}.json`);
}

async function exportSelectedQuotations() {
    if (selectedQuotations.size === 0) return;

    const zip = new JSZip();
    const folder = zip.folder("cotizaciones");

    selectedQuotations.forEach(id => {
        const quotation = currentQuotations.find(q => q.quote_id === id);
        if (quotation) {
            folder.file(`cotizacion-${id}.json`, JSON.stringify(quotation, null, 2));
        }
    });

    try {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `cotizaciones-export-${new Date().toISOString().slice(0, 10)}.zip`);
        showToast('Exportación completada', 'success');

        // Clear selection after export? User might want to keep it. Keeping it for now.
    } catch (error) {
        console.error('Error exporting zip:', error);
        showToast('Error al crear ZIP', 'error');
    }
}

// ============ DELETE LOGIC ============
async function deleteQuotation(quoteId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta cotización?')) return;

    try {
        if (!supabaseClient) throw new Error("No hay conexión con Supabase");

        const { error } = await supabaseClient
            .from('quotations_db')
            .delete()
            .eq('quote_id', quoteId);

        if (error) throw error;

        showToast('Cotización eliminada', 'success');

        // Update local state
        currentQuotations = currentQuotations.filter(q => q.quote_id !== quoteId);
        selectedQuotations.delete(quoteId);

        renderQuotationsTable();
        loadDashboardStats(); // Refresh stats

    } catch (error) {
        console.error('Error removing quotation:', error);
        showToast('Error al eliminar: ' + error.message, 'error');
    }
}

async function deleteSelectedQuotations() {
    const count = selectedQuotations.size;
    if (count === 0) return;

    if (!confirm(`¿Estás seguro de que quieres eliminar ${count} cotizaciones seleccionadas? Esta acción no se puede deshacer.`)) return;

    try {
        if (!supabaseClient) throw new Error("No hay conexión con Supabase");

        const idsToDelete = Array.from(selectedQuotations);

        const { error } = await supabaseClient
            .from('quotations_db')
            .delete()
            .in('quote_id', idsToDelete);

        if (error) throw error;

        showToast(`${count} cotizaciones eliminadas`, 'success');

        // Update local state
        currentQuotations = currentQuotations.filter(q => !selectedQuotations.has(q.quote_id));
        selectedQuotations.clear();

        renderQuotationsTable();
        loadDashboardStats();

    } catch (error) {
        console.error('Error removing quotations:', error);
        showToast('Error al eliminar: ' + error.message, 'error');
    }
}

async function bulkChangeStatus() {
    const newStatus = document.getElementById('bulk-status-change')?.value;
    if (!newStatus) { showToast('Selecciona un estado', 'error'); return; }
    if (selectedQuotations.size === 0) { showToast('No hay cotizaciones seleccionadas', 'error'); return; }
    if (!supabaseClient) { showToast('Sin conexion a Supabase', 'error'); return; }

    const count = selectedQuotations.size;
    if (!confirm(`Cambiar estado de ${count} cotizaciones a "${newStatus}"?`)) return;

    try {
        const ids = Array.from(selectedQuotations);
        const { error } = await supabaseClient
            .from('quotations_db')
            .update({ quote_status: newStatus, updated_at: new Date().toISOString() })
            .in('quote_id', ids);
        if (error) throw error;

        // Update local state
        ids.forEach(id => {
            const q = currentQuotations.find(q => q.quote_id === id);
            if (q) q.quote_status = newStatus;
        });

        showToast(`${count} cotizaciones actualizadas a "${newStatus}"`, 'success');
        document.getElementById('bulk-status-change').value = '';
        renderQuotationsTable();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function bulkArchiveQuotations() {
    if (selectedQuotations.size === 0) { showToast('No hay cotizaciones seleccionadas', 'error'); return; }
    if (!supabaseClient) { showToast('Sin conexion a Supabase', 'error'); return; }

    const count = selectedQuotations.size;
    if (!confirm(`Archivar ${count} cotizaciones seleccionadas?`)) return;

    try {
        const ids = Array.from(selectedQuotations);
        const { error } = await supabaseClient
            .from('quotations_db')
            .update({ quote_status: 'archived', updated_at: new Date().toISOString() })
            .in('quote_id', ids);
        if (error) throw error;

        ids.forEach(id => {
            const q = currentQuotations.find(q => q.quote_id === id);
            if (q) q.quote_status = 'archived';
        });

        showToast(`${count} cotizaciones archivadas`, 'success');
        selectedQuotations.clear();
        renderQuotationsTable();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function exportSelectedCSV() {
    if (selectedQuotations.size === 0) { showToast('No hay cotizaciones seleccionadas', 'error'); return; }

    const selected = currentQuotations.filter(q => selectedQuotations.has(q.quote_id));
    if (selected.length === 0) return;

    const columns = Object.keys(selected[0]);
    const csvRows = [columns.join(',')];
    for (const row of selected) {
        csvRows.push(columns.map(col => {
            let val = row[col];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    saveAs(blob, `cotizaciones-seleccionadas-${new Date().toISOString().split('T')[0]}.csv`);
    showToast(`${selected.length} cotizaciones exportadas como CSV`, 'success');
}

function clearQuotationFilters() {
    const ids = ['filter-quote-status', 'filter-artist', 'filter-price-range', 'filter-date-from', 'filter-date-to', 'search-quotations'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    loadQuotations();
}

function renderPagination() {
    const totalPages = Math.ceil(currentQuotations.length / itemsPerPage);
    const container = document.getElementById('quotations-pagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    renderQuotationsTable();
}

function viewQuotation(quoteId) {
    const quotation = currentQuotations.find(q => q.quote_id === quoteId);
    if (!quotation) return;

    // Format references as clickable links if available
    let referencesHtml = '—';
    if (quotation.tattoo_references) {
        if (typeof quotation.tattoo_references === 'string' && quotation.tattoo_references.startsWith('http')) {
            referencesHtml = `<a href="${quotation.tattoo_references}" target="_blank" class="detail-link"><i class="fa-solid fa-external-link"></i> Ver referencias</a>`;
        } else if (quotation.tattoo_references) {
            referencesHtml = quotation.tattoo_references;
        }
    }

    // Format sent_to_artist_at date
    const sentToArtistDate = quotation.sent_to_artist_at
        ? new Date(quotation.sent_to_artist_at).toLocaleString('es-ES')
        : 'No enviado';

    const detailHtml = `
        <div class="detail-section">
            <div class="detail-title">🎫 Información General</div>
            <div class="detail-row">
                <span class="detail-label">ID:</span>
                <span class="detail-value">${quotation.quote_id}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Estado:</span>
                <span class="detail-value"><span class="status-badge ${quotation.quote_status}">${quotation.quote_status}</span></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Fecha creación:</span>
                <span class="detail-value">${quotation.created_at ? new Date(quotation.created_at).toLocaleString('es-ES') : '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Enviado al artista:</span>
                <span class="detail-value">${sentToArtistDate}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-title">🎨 Artista</div>
            <div class="detail-row">
                <span class="detail-label">Nombre:</span>
                <span class="detail-value">${quotation.artist_name || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${quotation.artist_email || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Estudio:</span>
                <span class="detail-value">${quotation.artist_studio_name || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Ciudad:</span>
                <span class="detail-value">${quotation.artist_current_city || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Disponibilidad:</span>
                <span class="detail-value">${quotation.artist_availability || '—'}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-title">✍️ Tatuaje</div>
            <div class="detail-row">
                <span class="detail-label">Ubicación:</span>
                <span class="detail-value">${quotation.tattoo_body_part || '—'} ${quotation.tattoo_body_side ? `(${quotation.tattoo_body_side})` : ''}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Descripción:</span>
                <span class="detail-value">${quotation.tattoo_idea_description || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Tamaño:</span>
                <span class="detail-value">${quotation.tattoo_size || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Estilo:</span>
                <span class="detail-value">${formatTattooStyleDisplay(quotation.tattoo_style)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Color:</span>
                <span class="detail-value">${quotation.tattoo_color_type || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Referencias:</span>
                <span class="detail-value">${referencesHtml}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Primer tatuaje:</span>
                <span class="detail-value">${quotation.tattoo_is_first_tattoo === true ? 'Sí' : 'No'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Cover-up:</span>
                <span class="detail-value">${quotation.tattoo_is_cover_up === true ? 'Sí' : 'No'}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-title">👤 Cliente</div>
            <div class="detail-row">
                <span class="detail-label">Nombre:</span>
                <span class="detail-value">${quotation.client_full_name || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Edad:</span>
                <span class="detail-value">${quotation.client_age || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${quotation.client_email || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Instagram:</span>
                <span class="detail-value">${quotation.client_instagram || 'No tiene'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Ciudad:</span>
                <span class="detail-value">${quotation.client_city_residence || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Dispuesto a viajar:</span>
                <span class="detail-value">${quotation.client_travel_willing === true ? 'Sí' : quotation.client_travel_willing === false ? 'No' : '—'}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-title">🏥 Información de Salud</div>
            <div class="detail-row">
                <span class="detail-label">Condiciones médicas:</span>
                <span class="detail-value">${quotation.client_health_conditions || 'Ninguna'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Alergias:</span>
                <span class="detail-value">${quotation.client_allergies || 'Ninguna'}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <div class="detail-title">📅 Preferencias</div>
            <div class="detail-row">
                <span class="detail-label">Fecha deseada:</span>
                <span class="detail-value">${quotation.client_preferred_date || '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Fechas flexibles:</span>
                <span class="detail-value">${quotation.client_flexible_dates ? 'Sí' : 'No'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Presupuesto:</span>
                <span class="detail-value">${quotation.client_budget_amount ? (window.WeOtziCurrency && window.WeOtziCurrency.isReady() ? window.WeOtziCurrency.formatInline(quotation.client_budget_amount, quotation.client_budget_currency || 'USD') : `${quotation.client_budget_amount} ${quotation.client_budget_currency || ''}`) : '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Contacto:</span>
                <span class="detail-value">${quotation.client_contact_preference || '—'}</span>
            </div>
        </div>
    `;

    document.getElementById('quotation-detail').innerHTML = detailHtml;
    openModal('quotation-modal');
}

// ============ QUESTIONS ============
function renderQuestions() {
    const container = document.getElementById('questions-list');

    container.innerHTML = questionsConfig.map((q, index) => {
        const typeLabels = {
            'display': 'Solo visualización',
            'text': 'Texto',
            'textarea': 'Texto largo',
            'email': 'Email',
            'options': 'Selección única',
            'cards': 'Tarjetas',
            'multi-select': 'Selección múltiple',
            'boolean': 'Sí / No',
            'body-selector': 'Selector de cuerpo',
            'file-upload': 'Subida de archivos',
            'date-range': 'Rango de fechas',
            'currency': 'Monto con moneda'
        };

        const isFirst = index === 0;
        const isLast = index === questionsConfig.length - 1;

        return `
            <div class="question-item">
                <div class="question-number">${index + 1}</div>
                <div class="question-content">
                    <div class="question-title">${escapeHtml(q.title)}</div>
                    <div class="question-type">${typeLabels[q.type] || q.type}${q.optional ? ' (opcional)' : ''}${q.conditional ? ' (condicional)' : ''}</div>
                </div>
                <div class="question-actions">
                    <button class="btn-icon" onclick="moveQuestion(${index}, -1)" title="Subir" ${isFirst ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button class="btn-icon" onclick="moveQuestion(${index}, 1)" title="Bajar" ${isLast ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                    ${(q.editable !== false || q.type === 'body-selector') ? `
                        <button class="btn-icon" onclick="editQuestion(${q.id})" title="Editar">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        ${q.editable !== false ? `
                        <button class="btn-icon danger" onclick="deleteQuestion(${q.id})" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        ` : ''}
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function moveQuestion(index, direction) {
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === questionsConfig.length - 1) return;

    const newIndex = index + direction;

    // Swap
    [questionsConfig[index], questionsConfig[newIndex]] = [questionsConfig[newIndex], questionsConfig[index]];

    // Save to Supabase
    showToast('Sincronizando orden...', 'info');
    const result = await window.ConfigManager.saveQuestionsToDB(questionsConfig);
    
    if (result.error) {
        showToast('Error al sincronizar: ' + result.error, 'error');
    } else {
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        showToast('Orden actualizado', 'success');
    }

    // Re-render
    renderQuestions();
}

let editingQuestionId = null;


// Helper to get step options for partial updates
function getStepOptions() {
    return questionsConfig.map(q => `<option value="${q.step}">${q.id}. ${q.title} (${q.step})</option>`).join('');
}

function editQuestion(id) {
    const question = questionsConfig.find(q => q.id === id);
    if (!question) return;

    editingQuestionId = id;

    const types = [
        { value: 'text', label: 'Texto Corto' },
        { value: 'textarea', label: 'Texto Largo' },
        { value: 'options', label: 'Selección Única (Botones)' },
        { value: 'cards', label: 'Tarjetas (Iconos)' },
        { value: 'multi-select', label: 'Selección Múltiple' },
        { value: 'boolean', label: 'Sí / No' },
        { value: 'date-range', label: 'Rango de Fechas' },
        { value: 'currency', label: 'Moneda' },
        { value: 'file-upload', label: 'Subida de Archivos' },
        { value: 'body-selector', label: 'Selector de Cuerpo' },
        { value: 'display', label: 'Solo Visualización' } // Usually not editable but good to have
    ];

    let formHtml = `
        <div class="form-group">
            <label>Tipo de Pregunta</label>
            <select id="edit-question-type">
                ${types.map(t => `<option value="${t.value}" ${question.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Título de la pregunta</label>
            <input type="text" id="edit-question-title" value="${question.title}">
        </div>
        <div class="form-group">
            <label>Variable interna (ID del campo)</label>
            <input type="text" id="edit-question-field" value="${question.field || ''}" placeholder="ej: tattoo_style">
            <small>Nombre único para guardar la respuesta</small>
        </div>
    `;

    // Options Editor
    if (['options', 'multi-select', 'cards'].includes(question.type)) {
        let optionsText = '';
        if (question.type === 'cards' && Array.isArray(question.options)) {
            // Format: Label | Value | Icon | Subtitle
            optionsText = question.options.map(o => {
                if (typeof o === 'string') return o;
                return `${o.label} | ${o.value} | ${o.icon || ''} | ${o.subtitle || ''}`;
            }).join('\n');
        } else if (Array.isArray(question.options)) {
            optionsText = question.options.join('\n');
        }

        const placeholder = question.type === 'cards'
            ? 'Formato: Etiqueta | valor | icono fa-solid | subtitulo'
            : 'Una opción por línea';

        formHtml += `
            <div class="form-group">
                <label>Opciones</label>
                <textarea id="edit-question-options" rows="6" placeholder="${placeholder}">${optionsText}</textarea>
                <small>${question.type === 'cards' ? 'Usa el formato: Etiqueta | valor | fa-icon | subtitulo' : 'Una opción por línea'}</small>
            </div>
        `;
    } else if (question.type === 'body-selector') {
        formHtml += `
            <div class="form-group">
                <label>Configuración de Zonas</label>
                <button type="button" class="btn btn-outline w-100" onclick="openBodyPartsManager()">
                    <i class="fa-solid fa-list-tree"></i> Gestionar Jerarquía de Cuerpo
                </button>
                <small>Define las zonas principales, subzonas e imágenes.</small>
            </div>
        `;
    }

    // Validation
    formHtml += `
        <div class="form-row">
            <div class="form-group">
                 <label>Longitud Mín.</label>
                 <input type="number" id="edit-question-minlength" value="${question.minLength || ''}" placeholder="0">
            </div>
             <div class="form-group">
                 <label>Longitud Máx.</label>
                 <input type="number" id="edit-question-maxlength" value="${question.maxLength || ''}" placeholder="1000">
            </div>
        </div>
    `;

    // Logic Section
    const hasLogic = !!question.logic;
    const logicTrigger = hasLogic ? question.logic.triggerValue : '';
    const logicTarget = hasLogic ? question.logic.targetStep : '';

    formHtml += `
        <div class="form-section-title">Lógica Condicional</div>
        <div class="form-group">
            <label>
                <input type="checkbox" id="edit-question-has-logic" ${hasLogic ? 'checked' : ''} onchange="toggleLogicInputs(this)">
                Activar salto de pregunta
            </label>
        </div>
        <div id="logic-inputs" class="${hasLogic ? '' : 'hidden'}">
            <div class="form-group">
                <label>Si la respuesta es:</label>
                <input type="text" id="edit-question-logic-trigger" value="${logicTrigger}" placeholder="Valor exacto (ej: true, si, opcion_a)">
            </div>
            <div class="form-group">
                <label>Saltar a:</label>
                <select id="edit-question-logic-target">
                    <option value="">-- Seleccionar destino --</option>
                    ${getStepOptions()}
                </select>
            </div>
        </div>
    `;

    formHtml += `
        <div class="form-group">
            <label>
                <input type="checkbox" id="edit-question-optional" ${question.optional ? 'checked' : ''}>
                Campo opcional
            </label>
        </div>
    `;

    document.getElementById('question-edit-form').innerHTML = formHtml;

    // Set logic target if exists (after HTML insertion)
    if (hasLogic && logicTarget) {
        document.getElementById('edit-question-logic-target').value = logicTarget;
    }

    openModal('question-modal');
}

function toggleLogicInputs(checkbox) {
    const inputs = document.getElementById('logic-inputs');
    if (checkbox.checked) {
        inputs.classList.remove('hidden');
    } else {
        inputs.classList.add('hidden');
    }
}

async function saveQuestion() {
    if (!editingQuestionId) return;

    const question = questionsConfig.find(q => q.id === editingQuestionId);
    if (!question) return;

    // Update basic fields
    const newType = document.getElementById('edit-question-type').value;
    question.type = newType;
    question.title = document.getElementById('edit-question-title').value;
    question.field = document.getElementById('edit-question-field').value;

    // Parse options
    const optionsEl = document.getElementById('edit-question-options');
    if (optionsEl) {
        const rawText = optionsEl.value;
        if (newType === 'cards') {
            question.options = rawText.split('\n').filter(o => o.trim()).map(line => {
                // Parse "Label | Value | Icon | Subtitle"
                const parts = line.split('|').map(p => p.trim());
                return {
                    label: parts[0],
                    value: parts[1] || parts[0].toLowerCase().replace(/\s+/g, '_'),
                    icon: parts[2] || '',
                    subtitle: parts[3] || ''
                };
            });
        } else {
            question.options = rawText.split('\n').filter(o => o.trim());
        }
    } else {
        delete question.options;
    }

    // Validation
    const minLength = document.getElementById('edit-question-minlength').value;
    if (minLength) question.minLength = parseInt(minLength); else delete question.minLength;

    const maxLength = document.getElementById('edit-question-maxlength').value;
    if (maxLength) question.maxLength = parseInt(maxLength); else delete question.maxLength;

    question.optional = document.getElementById('edit-question-optional').checked;

    // Logic
    const hasLogic = document.getElementById('edit-question-has-logic').checked;
    if (hasLogic) {
        const trigger = document.getElementById('edit-question-logic-trigger').value;
        const target = document.getElementById('edit-question-logic-target').value;

        let parsedTrigger = trigger;
        if (trigger === 'true') parsedTrigger = true;
        if (trigger === 'false') parsedTrigger = false;

        question.logic = {
            triggerValue: parsedTrigger,
            action: 'jump',
            targetStep: target
        };
    } else {
        delete question.logic;
    }

    // Save to Supabase
    showToast('Guardando en Supabase...', 'info');
    const result = await window.ConfigManager.saveQuestionsToDB(questionsConfig);

    if (result.error) {
        showToast('Error al guardar: ' + result.error, 'error');
    } else {
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        showToast('Pregunta actualizada', 'success');
        renderQuestions();
        closeModal();
    }

    editingQuestionId = null;
}

async function addQuestion() {
    const newId = Math.max(...questionsConfig.map(q => q.id), 0) + 1;
    const newQuestion = {
        id: newId,
        step: `custom-${newId}`,
        title: 'Nueva Pregunta',
        type: 'text',
        field: `custom_field_${newId}`,
        optional: true
    };

    // Better UX: Insert before the "Summary" step if it exists.
    const summaryIndex = questionsConfig.findIndex(q => q.step === 'summary');
    if (summaryIndex !== -1) {
        questionsConfig.splice(summaryIndex, 0, newQuestion);
    } else {
        questionsConfig.push(newQuestion);
    }

    // Save to Supabase
    showToast('Sincronizando con Supabase...', 'info');
    const result = await window.ConfigManager.saveQuestionsToDB(questionsConfig);
    
    if (result.error) {
        showToast('Error al sincronizar: ' + result.error, 'error');
    } else {
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        renderQuestions();
        editQuestion(newId);
    }
}

async function deleteQuestion(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return;

    const index = questionsConfig.findIndex(q => q.id === id);
    if (index === -1) return;

    const question = questionsConfig[index];
    if (question.editable === false) {
        showToast('Esta pregunta no se puede eliminar', 'error');
        return;
    }

    questionsConfig.splice(index, 1);

    // Save to Supabase
    showToast('Eliminando de Supabase...', 'info');
    const result = await window.ConfigManager.saveQuestionsToDB(questionsConfig);

    if (result.error) {
        showToast('Error al eliminar: ' + result.error, 'error');
    } else {
        localStorage.setItem('weotzi_questions_config', JSON.stringify(questionsConfig));
        renderQuestions();
        showToast('Pregunta eliminada', 'success');
    }
}

// ============ TATTOO STYLES MANAGEMENT (SUPABASE) ============
let currentTattooStyles = []; // Hierarchical structure with substyles
let currentTattooStylesFlat = []; // Flat list for easy lookup
let editingStyleId = null;
let addingSubstyleParentId = null;

async function loadTattooStyles() {
    const container = document.getElementById('tattoo-styles-tree');
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Cargando estilos...</div>';

    try {
        currentTattooStyles = await window.ConfigManager.loadTattooStylesFromDB();
        currentTattooStylesFlat = await window.ConfigManager.loadTattooStylesFlatFromDB();
        renderTattooStylesTree();
    } catch (err) {
        console.error('Error loading tattoo styles:', err);
        container.innerHTML = '<div class="empty-state">Error al cargar estilos</div>';
        showToast('Error al cargar estilos: ' + err.message, 'error');
    }
}

function renderTattooStylesTree() {
    const container = document.getElementById('tattoo-styles-tree');
    const searchTerm = document.getElementById('search-styles')?.value.toLowerCase() || '';

    // Count totals
    let stylesCount = 0;
    let substylesCount = 0;
    currentTattooStylesFlat.forEach(s => {
        if (s.parent_id) substylesCount++;
        else stylesCount++;
    });
    document.getElementById('styles-count').textContent = stylesCount;
    document.getElementById('substyles-count').textContent = substylesCount;

    if (currentTattooStyles.length === 0) {
        container.innerHTML = '<div class="empty-state">No hay estilos configurados. Haz clic en "Nuevo Estilo" para crear uno.</div>';
        return;
    }

    // Filter by search if needed
    let filteredStyles = currentTattooStyles;
    if (searchTerm) {
        filteredStyles = filterStylesTree(currentTattooStyles, searchTerm);
    }

    if (filteredStyles.length === 0) {
        container.innerHTML = '<div class="empty-state">No se encontraron estilos que coincidan con la búsqueda</div>';
        return;
    }

    container.innerHTML = renderStyleLevel(filteredStyles);
}

function filterStylesTree(styles, searchTerm) {
    return styles.filter(style => {
        const matchesSelf = style.name.toLowerCase().includes(searchTerm) ||
                           style.slug.toLowerCase().includes(searchTerm) ||
                           (style.description && style.description.toLowerCase().includes(searchTerm));
        const matchesSubstyle = style.substyles && style.substyles.some(sub =>
            sub.name.toLowerCase().includes(searchTerm) ||
            sub.slug.toLowerCase().includes(searchTerm)
        );
        return matchesSelf || matchesSubstyle;
    }).map(style => {
        // If we matched a substyle, include only matching substyles
        if (style.substyles && style.substyles.length > 0) {
            const filteredSubs = style.substyles.filter(sub =>
                sub.name.toLowerCase().includes(searchTerm) ||
                sub.slug.toLowerCase().includes(searchTerm) ||
                style.name.toLowerCase().includes(searchTerm) // Include all subs if parent matches
            );
            return { ...style, substyles: filteredSubs };
        }
        return style;
    });
}

function renderStyleLevel(styles) {
    if (!styles || styles.length === 0) return '';

    return `<div class="styles-tree-list">` + styles.map(style => {
        const hasSubstyles = style.substyles && style.substyles.length > 0;
        const coverImg = style.cover_image_url
            ? `<img src="${style.cover_image_url}" class="style-thumb" alt="${style.name}">`
            : '<div class="style-thumb-placeholder"><i class="fa-solid fa-palette"></i></div>';

        const displayModeLabel = style.substyles_display_mode === 'related' ? 'Relacionado' : 'Agrupado';

        return `
            <div class="style-tree-item">
                <div class="style-tree-content">
                    <div class="style-tree-info">
                        ${coverImg}
                        <div class="style-tree-details">
                            <div class="style-tree-name">
                                <strong>${style.name}</strong>
                                <code class="style-slug">${style.slug}</code>
                            </div>
                            ${style.description ? `<div class="style-tree-desc">${style.description.substring(0, 80)}${style.description.length > 80 ? '...' : ''}</div>` : ''}
                            <div class="style-tree-meta">
                                ${hasSubstyles ? `<span class="badge-small">${style.substyles.length} subestilos</span>` : ''}
                                ${hasSubstyles ? `<span class="badge-small secondary">${displayModeLabel}</span>` : ''}
                                ${style.reference_images && style.reference_images.length > 0 ? `<span class="badge-small info">${style.reference_images.length} refs</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="style-tree-actions">
                        <button class="btn-icon" onclick="addTattooSubstyle('${style.id}')" title="Agregar Subestilo">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                        <button class="btn-icon" onclick="editTattooStyle('${style.id}')" title="Editar">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="btn-icon danger" onclick="deleteTattooStyle('${style.id}', '${style.name}')" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                ${hasSubstyles ? `
                    <div class="style-substyles-container">
                        ${style.substyles.map(sub => `
                            <div class="substyle-item">
                                <div class="substyle-info">
                                    ${sub.cover_image_url
                                        ? `<img src="${sub.cover_image_url}" class="substyle-thumb" alt="${sub.name}">`
                                        : '<div class="substyle-thumb-placeholder"><i class="fa-solid fa-tag"></i></div>'}
                                    <div>
                                        <span class="substyle-name">${sub.name}</span>
                                        <code class="style-slug small">${sub.slug}</code>
                                    </div>
                                </div>
                                <div class="substyle-actions">
                                    <button class="btn-icon small" onclick="editTattooStyle('${sub.id}')" title="Editar">
                                        <i class="fa-solid fa-pen"></i>
                                    </button>
                                    <button class="btn-icon small danger" onclick="deleteTattooStyle('${sub.id}', '${sub.name}')" title="Eliminar">
                                        <i class="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('') + `</div>`;
}

function addTattooStyle() {
    editingStyleId = null;
    addingSubstyleParentId = null;

    // Reset form
    document.getElementById('style-form').reset();
    document.getElementById('style-id').value = '';
    document.getElementById('style-parent-id').value = '';
    document.getElementById('style-sort-order').value = currentTattooStyles.length;

    // Show display mode (only for parent styles)
    document.getElementById('display-mode-group').style.display = 'block';

    document.getElementById('style-modal-title').textContent = 'Nuevo Estilo de Tatuaje';
    openModal('style-modal');
}

function addTattooSubstyle(parentId) {
    editingStyleId = null;
    addingSubstyleParentId = parentId;

    const parentStyle = currentTattooStylesFlat.find(s => s.id === parentId);

    // Reset form
    document.getElementById('style-form').reset();
    document.getElementById('style-id').value = '';
    document.getElementById('style-parent-id').value = parentId;

    // Count existing substyles for sort order
    const subsCount = currentTattooStylesFlat.filter(s => s.parent_id === parentId).length;
    document.getElementById('style-sort-order').value = subsCount;

    // Hide display mode (not applicable for substyles)
    document.getElementById('display-mode-group').style.display = 'none';

    document.getElementById('style-modal-title').textContent = `Nuevo Subestilo de "${parentStyle?.name || 'Estilo'}"`;
    openModal('style-modal');
}

function editTattooStyle(styleId) {
    const style = currentTattooStylesFlat.find(s => s.id === styleId);
    if (!style) {
        showToast('Estilo no encontrado', 'error');
        return;
    }

    editingStyleId = styleId;
    addingSubstyleParentId = null;

    // Fill form
    document.getElementById('style-id').value = style.id;
    document.getElementById('style-parent-id').value = style.parent_id || '';
    document.getElementById('style-name').value = style.name;
    document.getElementById('style-slug').value = style.slug;
    document.getElementById('style-description').value = style.description || '';
    document.getElementById('style-cover-image').value = style.cover_image_url || '';
    document.getElementById('style-reference-images').value = (style.reference_images || []).join('\n');
    document.getElementById('style-display-mode').value = style.substyles_display_mode || 'grouped';
    document.getElementById('style-sort-order').value = style.sort_order || 0;

    // Show/hide display mode based on whether it's a parent style
    const isSubstyle = !!style.parent_id;
    document.getElementById('display-mode-group').style.display = isSubstyle ? 'none' : 'block';

    document.getElementById('style-modal-title').textContent = isSubstyle ? 'Editar Subestilo' : 'Editar Estilo';
    openModal('style-modal');
}

async function saveTattooStyle(event) {
    event.preventDefault();

    const id = document.getElementById('style-id').value;
    const parentId = document.getElementById('style-parent-id').value || null;
    const name = document.getElementById('style-name').value.trim();
    const slug = document.getElementById('style-slug').value.trim();
    const description = document.getElementById('style-description').value.trim();
    const coverImageUrl = document.getElementById('style-cover-image').value.trim();
    const referenceImagesText = document.getElementById('style-reference-images').value.trim();
    const displayMode = document.getElementById('style-display-mode').value;
    const sortOrder = parseInt(document.getElementById('style-sort-order').value) || 0;

    if (!name) {
        showToast('El nombre del estilo es requerido', 'error');
        return;
    }

    // Parse reference images (one URL per line)
    const referenceImages = referenceImagesText
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0);

    const styleData = {
        name,
        slug: slug || null, // Let the backend generate if empty
        description: description || null,
        cover_image_url: coverImageUrl || null,
        reference_images: referenceImages,
        substyles_display_mode: parentId ? null : displayMode,
        sort_order: sortOrder
    };

    showToast('Guardando...', 'info');

    let result;
    if (id) {
        // Update existing
        result = await window.ConfigManager.updateTattooStyleInDB(id, styleData);
    } else {
        // Create new
        result = await window.ConfigManager.createTattooStyleInDB(styleData, parentId);
    }

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
        return;
    }

    showToast(id ? 'Estilo actualizado' : 'Estilo creado', 'success');
    closeModal();
    await loadTattooStyles();
}

async function deleteTattooStyle(styleId, styleName) {
    // Check if it has substyles
    const subsCount = currentTattooStylesFlat.filter(s => s.parent_id === styleId).length;
    const warningMsg = subsCount > 0
        ? `¿Eliminar "${styleName}" y sus ${subsCount} subestilos? Esta acción no se puede deshacer.`
        : `¿Eliminar el estilo "${styleName}"? Esta acción no se puede deshacer.`;

    if (!confirm(warningMsg)) return;

    showToast('Eliminando...', 'info');

    const result = await window.ConfigManager.deleteTattooStyleFromDB(styleId);

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
        return;
    }

    showToast('Estilo eliminado', 'success');
    await loadTattooStyles();
}

// Setup search listener for styles
document.getElementById('search-styles')?.addEventListener('input', debounce(renderTattooStylesTree, 300));

// ============ EXPORT/IMPORT ============
function exportConfig() {
    updateConfigFile();

    const exportData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        settings: JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}'),
        questions: questionsConfig
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `weotzi-config-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast('Configuración exportada', 'success');
}

function importConfig() {
    document.getElementById('import-file').click();
}

function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (data.settings) {
                localStorage.setItem('weotzi_admin_settings', JSON.stringify(data.settings));
            }

            if (data.questions) {
                localStorage.setItem('weotzi_questions_config', JSON.stringify(data.questions));
            }

            // Reload
            loadSettings();
            initSupabase();
            renderQuestions();

            showToast('Configuración importada', 'success');

        } catch (error) {
            showToast('Error al importar: archivo inválido', 'error');
        }
    };
    reader.readAsText(file);

    // Reset input
    event.target.value = '';
}

// ============ MODALS ============
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// ============ ARTISTS LOGIC ============
let allArtistsUnfiltered = [];

async function loadArtists() {
    const tbody = document.getElementById('artists-tbody');
    const isDemo = document.getElementById('setting-demo-mode').checked;

    if (!supabaseClient && !isDemo) {
        showTableEmptyState('artists-tbody', 8, 'fa-plug', 'Sin conexion a Supabase', 'Configura la conexion o activa el Modo Demo en Configuracion.');
        return;
    }

    showTableLoading('artists-tbody', 8);

    try {
        let artists = [];

        if (isDemo) {
            const demoArtists = window.ConfigManager.getDemoArtists();
            artists = demoArtists.map(a => ({
                id: a.userId,
                username: a.username,
                name: a.name,
                current_city: a.location,
                country: '',
                styles_array: a.styles,
                session_cost: a.sessionPrice,
                artist_index: null,
                verification_state: 'pending'
            }));
        } else {
            const { data, error } = await supabaseClient
                .from('artists_db')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            artists = data.map(a => ({
                id: a.user_id,
                username: a.username,
                name: a.name,
                current_city: a.ubicacion,
                country: a.country || '',
                studio_name: a.estudios,
                email: a.email,
                instagram: a.instagram,
                bio: a.bio || '',
                phone: a.phone || '',
                profile_photo: a.profile_picture || '',
                styles_array: typeof a.styles_array === 'string' ? JSON.parse(a.styles_array) : a.styles_array,
                session_cost: a.session_price,
                artist_index: a.artist_index || null,
                verification_state: a.verification_state || 'pending',
                created_at: a.created_at,
                _raw: a
            }));
        }

        allArtistsUnfiltered = artists;
        populateArtistFilterDropdowns(artists);
        applyArtistFilters();

    } catch (error) {
        console.error('Error loading artists:', error);
        showTableErrorState('artists-tbody', 8, 'No se pudieron cargar los artistas. Verifica tu conexion.', 'loadArtists()');
        showToast('Error cargando artistas', 'error');
    }
}

function populateArtistFilterDropdowns(artists) {
    const countrySelect = document.getElementById('filter-artist-country');
    const styleSelect = document.getElementById('filter-artist-style');
    if (!countrySelect || !styleSelect) return;

    const countries = [...new Set(artists.map(a => a.country).filter(Boolean))].sort();
    countrySelect.innerHTML = '<option value="">Todos los paises</option>' + countries.map(c => `<option value="${c}">${c}</option>`).join('');

    const allStyles = new Set();
    artists.forEach(a => { if (Array.isArray(a.styles_array)) a.styles_array.forEach(s => allStyles.add(s)); });
    const styles = [...allStyles].sort();
    styleSelect.innerHTML = '<option value="">Todos los estilos</option>' + styles.map(s => `<option value="${s}">${s}</option>`).join('');
}

function applyArtistFilters() {
    const searchTerm = (document.getElementById('search-artists')?.value || '').trim().toLowerCase();
    const countryF = document.getElementById('filter-artist-country')?.value || '';
    const styleF = document.getElementById('filter-artist-style')?.value || '';
    const verifF = document.getElementById('filter-artist-verification')?.value || '';
    const indexF = document.getElementById('filter-artist-index')?.value || '';

    let filtered = [...allArtistsUnfiltered];

    if (searchTerm) {
        filtered = filtered.filter(a =>
            (a.name || '').toLowerCase().includes(searchTerm) ||
            (a.username || '').toLowerCase().includes(searchTerm) ||
            (a.current_city || '').toLowerCase().includes(searchTerm)
        );
    }
    if (countryF) filtered = filtered.filter(a => a.country === countryF);
    if (styleF) filtered = filtered.filter(a => Array.isArray(a.styles_array) && a.styles_array.some(s => s.toLowerCase().includes(styleF.toLowerCase())));
    if (verifF) filtered = filtered.filter(a => a.verification_state === verifF);
    if (indexF) {
        filtered = filtered.filter(a => {
            const idx = a.artist_index;
            if (indexF === 'high') return idx !== null && idx >= 75;
            if (indexF === 'medium') return idx !== null && idx >= 50 && idx < 75;
            if (indexF === 'low') return idx !== null && idx > 0 && idx < 50;
            if (indexF === 'none') return idx === null || idx === 0;
            return true;
        });
    }

    currentArtists = filtered;
    currentArtistsPage = 1;
    renderArtistsTable();
}

function clearArtistFilters() {
    const ids = ['search-artists', 'filter-artist-country', 'filter-artist-style', 'filter-artist-verification', 'filter-artist-index'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    applyArtistFilters();
}

function renderArtistsTable() {
    const tbody = document.getElementById('artists-tbody');
    const start = (currentArtistsPage - 1) * artistsItemsPerPage;
    const end = start + parseInt(artistsItemsPerPage);
    const pageItems = currentArtists.slice(start, end);

    if (pageItems.length === 0) {
        showTableEmptyState('artists-tbody', 8, 'fa-palette', 'No se encontraron artistas', 'Ajusta los filtros o espera nuevos registros.');
        document.getElementById('artists-pagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = pageItems.map(a => {
        const styles = Array.isArray(a.styles_array) ? a.styles_array.join(', ') : a.styles_array;
        const idx = a.artist_index;
        const idxCls = idx >= 75 ? 'high' : (idx >= 50 ? 'medium' : (idx > 0 ? 'low' : 'none'));
        const idxLabel = idx !== null && idx > 0 ? idx : '—';

        const verifMap = {
            'verified': { label: 'Verificado', cls: 'badge-success' },
            'approved': { label: 'Aprobado', cls: 'badge-success' },
            'pending': { label: 'Pendiente', cls: 'badge-warning' },
            'pending_review': { label: 'En revision', cls: 'badge-info' },
            'rejected': { label: 'Rechazado', cls: 'badge-danger' }
        };
        const vs = verifMap[a.verification_state] || { label: a.verification_state || '—', cls: 'badge-secondary' };

        return `
            <tr>
                <td><strong>${escapeHtml(a.username) || '—'}</strong></td>
                <td>${escapeHtml(a.name) || '—'}</td>
                <td>${escapeHtml(a.current_city) || '—'}</td>
                <td><span class="truncate-text" title="${escapeHtml(styles)}">${escapeHtml(styles) || '—'}</span></td>
                <td>${a.session_cost || '—'}</td>
                <td><span class="artist-index-badge ${idxCls}">${idxLabel}</span></td>
                <td><span class="badge ${vs.cls}">${vs.label}</span></td>
                <td>
                    <button class="btn-icon" onclick="openArtistProfile('${a.id}')" title="Ver perfil">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="btn-icon" onclick="editArtist('${a.id}')" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    renderArtistsPagination();
}

function renderArtistsPagination() {
    const totalPages = Math.ceil(currentArtists.length / artistsItemsPerPage);
    const container = document.getElementById('artists-pagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentArtistsPage ? 'active' : ''}" onclick="goToArtistsPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

function changeItemsPerPage(value) {
    artistsItemsPerPage = parseInt(value);
    currentArtistsPage = 1; // Reset to page 1
    renderArtistsTable();
}

function goToArtistsPage(page) {
    currentArtistsPage = page;
    renderArtistsTable();
}

function editArtist(artistId) {
    const artist = currentArtists.find(a => a.id === artistId);
    if (!artist) return;

    // Reset form
    document.getElementById('artist-form').reset();

    // Fill fields
    document.getElementById('artist-id').value = artist.id;
    document.getElementById('artist-name').value = artist.name;
    document.getElementById('artist-username').value = artist.username;
    document.getElementById('artist-email').value = artist.email || '';
    document.getElementById('artist-instagram').value = artist.instagram || '';
    document.getElementById('artist-city').value = artist.current_city || '';
    document.getElementById('artist-studio').value = artist.studio_name || ''; // Mapping
    document.getElementById('artist-price').value = artist.session_cost || '';

    const styles = Array.isArray(artist.styles_array) ? artist.styles_array.join(', ') : '';
    document.getElementById('artist-styles').value = styles;

    document.getElementById('artist-modal-title').textContent = 'Editar Artista';
    openModal('artist-modal');
}

async function saveArtist(event) {
    event.preventDefault();

    const id = document.getElementById('artist-id').value;
    const name = document.getElementById('artist-name').value;
    const username = document.getElementById('artist-username').value;
    const email = document.getElementById('artist-email').value;
    const instagram = document.getElementById('artist-instagram').value;
    const city = document.getElementById('artist-city').value;
    const studio = document.getElementById('artist-studio').value;
    const price = document.getElementById('artist-price').value;
    const stylesStr = document.getElementById('artist-styles').value;
    const styles = stylesStr.split(',').map(s => s.trim()).filter(s => s);

    const isDemo = document.getElementById('setting-demo-mode').checked;

    try {
        if (isDemo) {
            // Update in ConfigManager
            const currentDemoArtists = window.ConfigManager.getDemoArtists();
            const index = currentDemoArtists.findIndex(a => a.userId === id);

            const updatedArtist = {
                userId: id,
                username,
                name,
                email,
                instagram,
                location: city,
                studio,
                sessionPrice: price,
                styles
            };

            let newArtistsList;
            if (index >= 0) {
                newArtistsList = [...currentDemoArtists];
                newArtistsList[index] = updatedArtist;
            } else {
                newArtistsList = [...currentDemoArtists, updatedArtist];
            }

            // Save to config
            window.ConfigManager.setValue('demoArtists', newArtistsList);
            showToast('Artista actualizado en Demo Mode', 'success');

        } else {
            // Update in Supabase
            // Verify Supabase connection
            if (!supabaseClient) throw new Error("No hay conexión con Supabase");

            const updates = {
                username,
                name,
                email,
                instagram,
                ubicacion: city,
                estudios: studio,
                session_price: price,
                styles_array: JSON.stringify(styles)
            };

            const { error } = await supabaseClient
                .from('artists_db')
                .update(updates)
                .eq('user_id', id);

            if (error) throw error;
            showToast('Artista actualizado en Supabase', 'success');
        }

        closeModal();
        loadArtists(); // Refresh table

    } catch (error) {
        console.error('Error saving artist:', error);
        showToast('Error al guardar: ' + error.message, 'error');
    }
}

function deleteArtist(artistId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este artista de la demo?')) return;

    try {
        const currentDemoArtists = window.ConfigManager.getDemoArtists();
        const newArtistsList = currentDemoArtists.filter(a => a.userId !== artistId);

        window.ConfigManager.setValue('demoArtists', newArtistsList);
        showToast('Artista eliminado', 'success');
        loadArtists();

    } catch (error) {
        showToast('Error al eliminar', 'error');
    }
}

// ============ UTILITIES ============

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for HTML
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * Format tattoo_style (JSONB or string) for display in admin views
 * @param {Object|string|null} tattooStyle - The tattoo style value
 * @returns {string} Formatted display string
 */
function formatTattooStyleDisplay(tattooStyle) {
    if (!tattooStyle) return '—';
    
    // Handle JSONB object format (new format)
    if (typeof tattooStyle === 'object') {
        if (tattooStyle.substyle_name) {
            return `${tattooStyle.style_name} › ${tattooStyle.substyle_name}`;
        }
        return tattooStyle.style_name || '—';
    }
    
    // Handle legacy string format
    return String(tattooStyle);
}

function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-xmark',
        info: 'fa-circle-info',
        warning: 'fa-triangle-exclamation'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 4000);
}
window.showToast = showToast;

// ============ UI HELPERS: LOADING & EMPTY/ERROR STATES ============

function showSectionLoading(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.setAttribute('data-prev-content', el.innerHTML);
    el.innerHTML = `
        <div class="section-loader">
            <div class="spinner"></div>
            <span class="loader-text">Cargando...</span>
        </div>
    `;
}

function hideSectionLoading(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const prev = el.getAttribute('data-prev-content');
    if (prev !== null) {
        el.removeAttribute('data-prev-content');
    }
}

function showTableLoading(tbodyId, colspan) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `
        <tr><td colspan="${colspan}" style="padding: 0;">
            <div class="section-loader">
                <div class="spinner"></div>
                <span class="loader-text">Cargando datos...</span>
            </div>
        </td></tr>
    `;
}

function showEmptyState(containerId, icon, title, description) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="empty-state-box">
            <i class="fa-solid ${icon}"></i>
            <span class="empty-title">${title}</span>
            <span class="empty-desc">${description}</span>
        </div>
    `;
}

function showTableEmptyState(tbodyId, colspan, icon, title, description) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `
        <tr><td colspan="${colspan}" style="padding: 0;">
            <div class="empty-state-box">
                <i class="fa-solid ${icon}"></i>
                <span class="empty-title">${title}</span>
                <span class="empty-desc">${description}</span>
            </div>
        </td></tr>
    `;
}

function showTableErrorState(tbodyId, colspan, message, retryFn) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const retryBtn = retryFn ? `<button class="btn btn-secondary btn-sm" onclick="${retryFn}"><i class="fa-solid fa-rotate-right"></i> Reintentar</button>` : '';
    tbody.innerHTML = `
        <tr><td colspan="${colspan}" style="padding: 0;">
            <div class="error-state-box">
                <i class="fa-solid fa-circle-exclamation"></i>
                <span class="error-title">Error al cargar datos</span>
                <span class="error-desc">${message}</span>
                ${retryBtn}
            </div>
        </td></tr>
    `;
}

window.showSectionLoading = showSectionLoading;
window.hideSectionLoading = hideSectionLoading;
window.showTableLoading = showTableLoading;
window.showEmptyState = showEmptyState;
window.showTableEmptyState = showTableEmptyState;
window.showTableErrorState = showTableErrorState;

// Setup search
document.getElementById('search-quotations')?.addEventListener('input', debounce(loadQuotations, 300));
document.getElementById('filter-status')?.addEventListener('change', loadQuotations);

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Make functions global
window.showSection = showSection;
window.testSupabaseConnection = testSupabaseConnection;
window.saveAppSettings = saveAppSettings;
window.saveEmailJSSettings = saveEmailJSSettings;
window.toggleDemoMode = toggleDemoMode;
window.togglePassword = togglePassword;
window.exportConfig = exportConfig;
window.importConfig = importConfig;
window.handleImport = handleImport;
window.loadQuotations = loadQuotations;
window.viewQuotation = viewQuotation;
window.goToPage = goToPage;
window.deleteQuotation = deleteQuotation;
window.exportQuotation = exportQuotation;
window.toggleSelectAllQuotations = toggleSelectAllQuotations;
window.toggleQuotationSelection = toggleSelectQuotation;
window.deleteSelectedQuotations = deleteSelectedQuotations;
window.exportSelectedQuotations = exportSelectedQuotations;
window.bulkChangeStatus = bulkChangeStatus;
window.bulkArchiveQuotations = bulkArchiveQuotations;
window.exportSelectedCSV = exportSelectedCSV;
window.clearQuotationFilters = clearQuotationFilters;
window.editQuestion = editQuestion;
window.saveQuestion = saveQuestion;
window.moveQuestion = moveQuestion;
window.addQuestion = addQuestion;
window.deleteQuestion = deleteQuestion;
window.toggleLogicInputs = toggleLogicInputs;
window.syncQuestionsFromDB = syncQuestionsFromDB;
window.closeModal = closeModal;

// Tattoo Styles Management (Supabase)
window.loadTattooStyles = loadTattooStyles;
window.addTattooStyle = addTattooStyle;
window.addTattooSubstyle = addTattooSubstyle;
window.editTattooStyle = editTattooStyle;
window.saveTattooStyle = saveTattooStyle;
window.deleteTattooStyle = deleteTattooStyle;

// ============ BODY PARTS MANAGER (SUPABASE) ============
let currentBodyPartsConfig = [];
let editingNode = null; // Stores the actual node being edited (with db_id)
let isAddingNode = false;
let parentNodeForAdd = null; // Parent db_id when adding subpart

async function openBodyPartsManager() {
    // Load from Supabase
    showToast('Cargando zonas...', 'info');
    currentBodyPartsConfig = await window.ConfigManager.loadBodyPartsFromDB();
    renderBodyPartsManagerFunc('tree');
    openModal('body-parts-modal');
}

function renderBodyPartsManagerFunc(mode) {
    const wrapper = document.querySelector('.body-parts-manager');
    if (!wrapper) return;

    if (mode === 'tree') {
        wrapper.innerHTML = `
            <div class="alert info mb-2" style="font-size: 0.9em;">
                <i class="fa-solid fa-database"></i> Datos conectados a Supabase. Los cambios se guardan directamente en la base de datos.
            </div>
            <div id="body-parts-tree" class="tree-view" style="max-height: 55vh; overflow-y: auto; border: 1px solid var(--border-color); padding: 10px; border-radius: 6px; background: rgba(0,0,0,0.1);">
                ${renderBodyPartLevel(currentBodyPartsConfig)}
            </div>
            <button class="btn btn-outline small mt-2 w-100" onclick="addMainBodyPart()">
                <i class="fa-solid fa-plus"></i> Agregar Zona Principal
            </button>
            <button class="btn btn-secondary small mt-2 w-100" onclick="generateAllBodyPartIcons()">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generar Iconos para Todo (IA)
            </button>
        `;
    } else if (mode === 'edit') {
        const node = editingNode || { id: '', label: '', sides: 'both', sensitivity: 5, pain_level: 5, description: '', tattoo_info: '', experience_info: '' };
        const isRoot = !parentNodeForAdd && (!editingNode || !editingNode.parent_id);
        const sensitivity = node.sensitivity || 5;
        const painLevel = node.pain_level || 5;

        wrapper.innerHTML = `
            <div class="edit-node-form">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                    <button class="btn-icon" onclick="cancelNodeEdit()" title="Volver a la lista" style="background: rgba(255,255,255,0.05); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-arrow-left"></i>
                    </button>
                    <h4 style="margin: 0;">${isAddingNode ? 'Agregar Parte' : 'Editar Parte'}</h4>
                </div>
                
                <div class="form-group">
                    <label>ID (Identificador único)</label>
                    <input type="text" id="node-id" value="${node.id || ''}" placeholder="ej: brazo_inf">
                    <small style="color: var(--text-muted);">No usar espacios ni caracteres especiales.</small>
                </div>
                
                <div class="form-group">
                    <label>Etiqueta (Nombre visible)</label>
                    <input type="text" id="node-label" value="${node.label || ''}" placeholder="Ej: Antebrazo">
                </div>
                
                <div class="form-group">
                    <label>Imagen de la Zona</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="node-image" value="${node.image || ''}" placeholder="URL de imagen o sube una..." style="flex: 1;">
                        <input type="file" id="node-image-file" accept="image/*" style="display: none;" onchange="handleBodyPartImageUpload(this)">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('node-image-file').click()" title="Subir imagen">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                    </div>
                    
                    <!-- AI Generation Controls -->
                    <div style="margin-top: 10px; padding: 10px; background: rgba(var(--primary-rgb), 0.05); border: 1px dashed var(--primary-color); border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 0.85em; font-weight: 600; color: var(--primary-color);"><i class="fa-solid fa-wand-magic-sparkles"></i> Generar con IA</span>
                            <button type="button" class="btn btn-primary btn-sm" onclick="generateBodyPartIcon()" style="font-size: 0.8em; padding: 2px 8px;">Generar</button>
                        </div>
                        <div class="row-group" style="gap: 8px;">
                            <input type="text" id="ai-style" placeholder="Estilo (ej: Minimalist line art)" value="${window.ConfigManager.getValue('gemini.defaultStyle') || ''}" style="font-size: 0.85em;">
                            <input type="text" id="ai-bg" placeholder="Fondo (ej: White)" value="${window.ConfigManager.getValue('gemini.defaultBackgroundColor') || ''}" style="font-size: 0.85em;">
                        </div>
                    </div>

                    <div id="node-image-preview" style="margin-top: 8px;">
                        ${node.image ? `<img src="${node.image}" alt="Preview" style="max-width: 80px; max-height: 80px; border-radius: 4px; border: 1px solid var(--border-color);">` : ''}
                    </div>
                    <small style="color: var(--text-muted);">URL directa o sube una imagen (se guardara en Supabase Storage).</small>
                </div>
                
                <div class="form-group">
                    <label>Lado Permitido</label>
                    <select id="node-sides">
                         <option value="both" ${node.sides === 'both' ? 'selected' : ''}>Ambos (Izquierda/Derecha)</option>
                         <option value="left" ${node.sides === 'left' ? 'selected' : ''}>Solo Izquierda</option>
                         <option value="right" ${node.sides === 'right' ? 'selected' : ''}>Solo Derecha</option>
                         <option value="none" ${node.sides === 'none' ? 'selected' : ''}>Ninguno (Centro/Único)</option>
                    </select>
                </div>

                <div class="form-section-title">Métricas de Tatuaje</div>

                <div class="slider-container">
                    <label>
                        <span>Nivel de Sensibilidad</span>
                        <span class="slider-value" id="val-sensitivity">${sensitivity}/10</span>
                    </label>
                    <input type="range" min="1" max="10" value="${sensitivity}" id="node-sensitivity" oninput="document.getElementById('val-sensitivity').textContent = this.value + '/10'">
                    <div class="range-labels"><span>Baja</span><span>Media</span><span>Alta</span></div>
                </div>

                <div class="slider-container">
                    <label>
                        <span>Nivel de Dolor</span>
                        <span class="slider-value" id="val-pain">${painLevel}/10</span>
                    </label>
                    <input type="range" min="1" max="10" value="${painLevel}" id="node-pain" oninput="document.getElementById('val-pain').textContent = this.value + '/10'">
                    <div class="range-labels"><span>Soportable</span><span>Intenso</span><span>Extremo</span></div>
                </div>

                <div class="form-section-title">Información Expandida</div>

                <div class="form-group">
                    <label>Descripción General</label>
                    <textarea id="node-description" rows="2" placeholder="Descripción de la zona...">${node.description || ''}</textarea>
                </div>

                <div class="form-group">
                    <label>Info de Tatuajes</label>
                    <textarea id="node-tattoo-info" rows="2" placeholder="Tatuajes comunes, estilos recomendados...">${node.tattoo_info || ''}</textarea>
                </div>

                <div class="form-group">
                    <label>Experiencia de Tatuaje</label>
                    <textarea id="node-experience-info" rows="2" placeholder="Cómo se siente tatuarse aquí...">${node.experience_info || ''}</textarea>
                </div>

                <div class="form-section-title">Media del Modal Expandido</div>
                
                <div class="form-group">
                    <label>Tipo de Media</label>
                    <select id="node-expanded-media-type" onchange="toggleExpandedMediaFields()">
                        <option value="none" ${(node.expanded_media_type || 'none') === 'none' ? 'selected' : ''}>Sin media (fondo por defecto)</option>
                        <option value="image" ${node.expanded_media_type === 'image' ? 'selected' : ''}>Imagen</option>
                        <option value="video" ${node.expanded_media_type === 'video' ? 'selected' : ''}>Video</option>
                    </select>
                </div>

                <div id="expanded-media-fields" style="display: ${node.expanded_media_type && node.expanded_media_type !== 'none' ? 'block' : 'none'};">
                    <div class="form-group">
                        <label>URL del Media</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="node-expanded-media-url" value="${node.expanded_media_url || ''}" placeholder="URL de imagen/video o sube uno..." style="flex: 1;">
                            <input type="file" id="node-expanded-media-file" accept="image/*,video/*" style="display: none;" onchange="handleExpandedMediaUpload(this)">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('node-expanded-media-file').click()" title="Subir archivo">
                                <i class="fa-solid fa-upload"></i>
                            </button>
                        </div>
                        <div id="expanded-media-preview" style="margin-top: 8px;">
                            ${node.expanded_media_url ? (
                                node.expanded_media_type === 'video' 
                                    ? `<video src="${node.expanded_media_url}" style="max-width: 150px; max-height: 100px; border-radius: 4px; border: 1px solid var(--border-color);" muted></video>`
                                    : `<img src="${node.expanded_media_url}" alt="Preview" style="max-width: 150px; max-height: 100px; border-radius: 4px; border: 1px solid var(--border-color);">`
                            ) : ''}
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Color de Fondo</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="color" id="node-expanded-media-bg" value="${node.expanded_media_bg || '#1a1a1a'}" style="width: 50px; height: 36px; padding: 2px; cursor: pointer;">
                            <input type="text" id="node-expanded-media-bg-text" value="${node.expanded_media_bg || '#1a1a1a'}" placeholder="#1a1a1a" style="flex: 1;" oninput="document.getElementById('node-expanded-media-bg').value = this.value">
                        </div>
                        <small style="color: var(--text-muted);">Color visible detrás del media si no cubre todo el contenedor.</small>
                    </div>

                    <div class="row-group" style="gap: 12px;">
                        <div class="form-group" style="flex: 1;">
                            <label>Alineación Horizontal</label>
                            <select id="node-expanded-media-align-h">
                                <option value="left" ${node.expanded_media_align_h === 'left' ? 'selected' : ''}>Izquierda</option>
                                <option value="center" ${(node.expanded_media_align_h || 'center') === 'center' ? 'selected' : ''}>Centro</option>
                                <option value="right" ${node.expanded_media_align_h === 'right' ? 'selected' : ''}>Derecha</option>
                            </select>
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label>Alineación Vertical</label>
                            <select id="node-expanded-media-align-v">
                                <option value="top" ${node.expanded_media_align_v === 'top' ? 'selected' : ''}>Arriba</option>
                                <option value="center" ${(node.expanded_media_align_v || 'center') === 'center' ? 'selected' : ''}>Centro</option>
                                <option value="bottom" ${node.expanded_media_align_v === 'bottom' ? 'selected' : ''}>Abajo</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Ajuste del Media</label>
                        <select id="node-expanded-media-fit">
                            <option value="cover" ${(node.expanded_media_fit || 'cover') === 'cover' ? 'selected' : ''}>Cubrir (cover) - Llena el contenedor, puede recortar</option>
                            <option value="contain" ${node.expanded_media_fit === 'contain' ? 'selected' : ''}>Contener (contain) - Muestra todo, puede dejar espacios</option>
                            <option value="fill" ${node.expanded_media_fit === 'fill' ? 'selected' : ''}>Estirar (fill) - Estira para llenar</option>
                            <option value="none" ${node.expanded_media_fit === 'none' ? 'selected' : ''}>Original (none) - Tamaño original</option>
                        </select>
                    </div>
                </div>
                
                <div class="modal-footer" style="padding: 15px 0 0 0; margin-top: 15px; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-secondary" onclick="cancelNodeEdit()">Cancelar</button>
                    <button class="btn btn-primary" onclick="saveNodeEdit()">
                        <i class="fa-solid fa-database"></i> Guardar en BD
                    </button>
                </div>
            </div>
        `;
    }
}

function renderBodyPartLevel(parts) {
    if (!parts || parts.length === 0) return '<div class="text-muted text-center p-2">Sin zonas</div>';

    return `<ul class="tree-list" style="list-style: none; padding-left: 0; margin: 0;">` +
        parts.map(part => {
            const hasImage = part.image;
            const hasSubparts = part.subparts && part.subparts.length > 0;

            return `
            <li class="tree-item" style="margin-bottom: 8px;">
                <div class="tree-content" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                    <div class="tree-info" style="display: flex; align-items: center; gap: 12px;">
                        ${hasImage ? `<img src="${part.image}" style="width: 28px; height: 28px; object-fit: contain;">` : '<i class="fa-solid fa-circle" style="font-size: 8px; color: var(--primary-color);"></i>'}
                        <div>
                            <span style="font-weight: 600;">${part.label}</span> 
                            <span class="text-muted" style="font-size: 0.75em;">(${part.id})</span>
                            <div style="font-size: 0.7em; opacity: 0.6; margin-top: 2px;">
                                Lado: ${mapSideLabel(part.sides)} | Dolor: ${part.pain_level}/10
                            </div>
                        </div>
                    </div>
                    <div class="tree-actions" style="display: flex; gap: 4px;">
                        <button class="btn-icon" onclick='addBodySubPart("${part.db_id}")' title="Agregar Subparte"><i class="fa-solid fa-plus"></i></button>
                        <button class="btn-icon" onclick='editBodyPartNode("${part.db_id}")' title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-icon danger" onclick='deleteBodyPartNode("${part.db_id}", "${part.label}")' title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                ${hasSubparts ? `<div style="margin-left: 20px; border-left: 1px dashed #444; padding-left: 10px; margin-top: 5px;">${renderBodyPartLevel(part.subparts)}</div>` : ''}
            </li>
        `;
        }).join('') + `</ul>`;
}

function mapSideLabel(side) {
    const map = { 'both': 'Ambos', 'left': 'Izq', 'right': 'Der', 'none': 'Centro' };
    return map[side] || 'Ambos';
}

function findNodeByDbId(nodes, dbId) {
    for (const node of nodes) {
        if (node.db_id === dbId) return node;
        if (node.subparts && node.subparts.length > 0) {
            const found = findNodeByDbId(node.subparts, dbId);
            if (found) return found;
        }
    }
    return null;
}

function addMainBodyPart() {
    isAddingNode = true;
    editingNode = null;
    parentNodeForAdd = null;
    renderBodyPartsManagerFunc('edit');
}

function addBodySubPart(parentDbId) {
    isAddingNode = true;
    editingNode = null;
    parentNodeForAdd = parentDbId;
    renderBodyPartsManagerFunc('edit');
}

function editBodyPartNode(dbId) {
    isAddingNode = false;
    editingNode = findNodeByDbId(currentBodyPartsConfig, dbId);
    parentNodeForAdd = null;
    renderBodyPartsManagerFunc('edit');
}

function cancelNodeEdit() {
    isAddingNode = false;
    editingNode = null;
    parentNodeForAdd = null;
    renderBodyPartsManagerFunc('tree');
}

function cancelBodyPartsConfig() {
    if (editingNode || isAddingNode) {
        cancelNodeEdit();
    } else {
        closeModal();
    }
}

async function saveNodeEdit() {
    // Get background color from either the color picker or text input
    const bgColorPicker = document.getElementById('node-expanded-media-bg');
    const bgColorText = document.getElementById('node-expanded-media-bg-text');
    const expandedMediaBg = bgColorText?.value.trim() || bgColorPicker?.value || '#1a1a1a';

    const partData = {
        id: document.getElementById('node-id').value.trim(),
        label: document.getElementById('node-label').value.trim(),
        image: document.getElementById('node-image')?.value.trim() || null,
        sides: document.getElementById('node-sides').value,
        sensitivity: parseInt(document.getElementById('node-sensitivity').value) || 5,
        pain_level: parseInt(document.getElementById('node-pain').value) || 5,
        description: document.getElementById('node-description').value.trim() || null,
        tattoo_info: document.getElementById('node-tattoo-info').value.trim() || null,
        experience_info: document.getElementById('node-experience-info').value.trim() || null,
        sort_order: editingNode?.sort_order || (currentBodyPartsConfig.length + 1),
        // Expanded media settings
        expanded_media_type: document.getElementById('node-expanded-media-type')?.value || 'none',
        expanded_media_url: document.getElementById('node-expanded-media-url')?.value.trim() || null,
        expanded_media_bg: expandedMediaBg,
        expanded_media_align_h: document.getElementById('node-expanded-media-align-h')?.value || 'center',
        expanded_media_align_v: document.getElementById('node-expanded-media-align-v')?.value || 'center',
        expanded_media_fit: document.getElementById('node-expanded-media-fit')?.value || 'cover'
    };

    if (!partData.id || !partData.label) {
        showToast('ID y Etiqueta son obligatorios', 'warning');
        return;
    }

    showToast('Guardando...', 'info');

    let result;
    if (isAddingNode) {
        result = await window.ConfigManager.createBodyPartInDB(partData, parentNodeForAdd);
    } else {
        result = await window.ConfigManager.updateBodyPartInDB(editingNode.db_id, partData);
    }

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
        return;
    }

    showToast(isAddingNode ? 'Zona creada' : 'Zona actualizada', 'success');

    // Reload data
    currentBodyPartsConfig = await window.ConfigManager.loadBodyPartsFromDB();
    isAddingNode = false;
    editingNode = null;
    parentNodeForAdd = null;
    renderBodyPartsManagerFunc('tree');
}

async function deleteBodyPartNode(dbId, label) {
    if (!confirm(`¿Eliminar "${label}" y todas sus subzonas?`)) return;

    showToast('Eliminando...', 'info');
    const result = await window.ConfigManager.deleteBodyPartFromDB(dbId);

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
        return;
    }

    showToast('Zona eliminada', 'success');
    currentBodyPartsConfig = await window.ConfigManager.loadBodyPartsFromDB();
    renderBodyPartsManagerFunc('tree');
}

async function saveBodyPartsConfig() {
    // Si hay una edición en progreso, guardarla primero
    if (editingNode || isAddingNode) {
        await saveNodeEdit();
        // Al guardar desde edición, saveNodeEdit ya nos devuelve a la vista 'tree'
        // El usuario pidió que volviera a la principal, así que no cerramos el modal aún
        return;
    }
    closeModal();
}

/**
 * Handle body part image upload to Supabase Storage
 * @param {HTMLInputElement} input - The file input element
 */
async function handleBodyPartImageUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
        showToast('Formato no soportado. Usa JPG, PNG, WEBP o GIF.', 'error');
        input.value = '';
        return;
    }

    // Validate file size (max 2MB)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('La imagen es muy grande. Maximo 2MB.', 'error');
        input.value = '';
        return;
    }

    const supabaseClient = window.ConfigManager?.getSupabaseClient();
    if (!supabaseClient) {
        showToast('Supabase no configurado. Ingresa la URL manualmente.', 'error');
        return;
    }

    showToast('Subiendo imagen...', 'info');

    try {
        // Generate unique filename
        const fileExt = file.name.split('.').pop().toLowerCase();
        const fileName = `body-part-${Date.now()}.${fileExt}`;
        const filePath = `body-parts/${fileName}`;

        // Upload to Supabase Storage
        const config = window.ConfigManager?.get();
        const bucketName = config?.supabase?.storageBucket || 'quotation-references';
        
        const { data, error } = await supabaseClient
            .storage
            .from(bucketName)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            throw error;
        }

        // Get public URL
        const { data: urlData } = supabaseClient
            .storage
            .from(bucketName)
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Update the input field with the URL
        document.getElementById('node-image').value = publicUrl;

        // Show preview
        const previewContainer = document.getElementById('node-image-preview');
        if (previewContainer) {
            previewContainer.innerHTML = `<img src="${publicUrl}" alt="Preview" style="max-width: 80px; max-height: 80px; border-radius: 4px; border: 1px solid var(--border-color);">`;
        }

        showToast('Imagen subida correctamente', 'success');

    } catch (err) {
        console.error('Error uploading body part image:', err);
        showToast('Error al subir: ' + err.message, 'error');
    }

    // Reset file input
    input.value = '';
}

/**
 * Toggle visibility of expanded media configuration fields
 */
function toggleExpandedMediaFields() {
    const mediaType = document.getElementById('node-expanded-media-type').value;
    const fieldsContainer = document.getElementById('expanded-media-fields');
    if (fieldsContainer) {
        fieldsContainer.style.display = mediaType !== 'none' ? 'block' : 'none';
    }
}

/**
 * Handle expanded media upload to Supabase Storage (supports images and videos)
 * @param {HTMLInputElement} input - The file input element
 */
async function handleExpandedMediaUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // Validate file type
    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const validVideoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    const isImage = validImageTypes.includes(file.type);
    const isVideo = validVideoTypes.includes(file.type);

    if (!isImage && !isVideo) {
        showToast('Formato no soportado. Usa JPG, PNG, WEBP, GIF para imagenes o MP4, WEBM para videos.', 'error');
        input.value = '';
        return;
    }

    // Validate file size (max 10MB for videos, 5MB for images)
    const maxSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast(`El archivo es muy grande. Maximo ${isVideo ? '10MB' : '5MB'}.`, 'error');
        input.value = '';
        return;
    }

    const supabaseClient = window.ConfigManager?.getSupabaseClient();
    if (!supabaseClient) {
        showToast('Supabase no configurado. Ingresa la URL manualmente.', 'error');
        return;
    }

    showToast('Subiendo archivo...', 'info');

    try {
        // Generate unique filename
        const fileExt = file.name.split('.').pop().toLowerCase();
        const fileName = `expanded-media-${Date.now()}.${fileExt}`;
        const filePath = `body-parts/expanded/${fileName}`;

        // Upload to Supabase Storage
        const config = window.ConfigManager?.get();
        const bucketName = config?.supabase?.storageBucket || 'quotation-references';
        
        const { data, error } = await supabaseClient
            .storage
            .from(bucketName)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            throw error;
        }

        // Get public URL
        const { data: urlData } = supabaseClient
            .storage
            .from(bucketName)
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Update the input field with the URL
        document.getElementById('node-expanded-media-url').value = publicUrl;

        // Update media type based on file type
        const mediaTypeSelect = document.getElementById('node-expanded-media-type');
        mediaTypeSelect.value = isVideo ? 'video' : 'image';
        toggleExpandedMediaFields();

        // Show preview
        const previewContainer = document.getElementById('expanded-media-preview');
        if (previewContainer) {
            if (isVideo) {
                previewContainer.innerHTML = `<video src="${publicUrl}" style="max-width: 150px; max-height: 100px; border-radius: 4px; border: 1px solid var(--border-color);" muted controls></video>`;
            } else {
                previewContainer.innerHTML = `<img src="${publicUrl}" alt="Preview" style="max-width: 150px; max-height: 100px; border-radius: 4px; border: 1px solid var(--border-color);">`;
            }
        }

        showToast('Archivo subido correctamente', 'success');

    } catch (err) {
        console.error('Error uploading expanded media:', err);
        showToast('Error al subir: ' + err.message, 'error');
    }

    // Reset file input
    input.value = '';
}

async function generateBodyPartIcon(specificNode = null) {
    const config = window.ConfigManager?.get();
    if (!config?.gemini?.enabled) {
        showToast('Gemini AI no está habilitado', 'error');
        return;
    }

    const nodeLabel = specificNode ? specificNode.label : document.getElementById('node-label').value.trim();
    const style = specificNode ? (config.gemini.defaultStyle || 'Minimalist line art') : document.getElementById('ai-style').value.trim();
    const bg = specificNode ? (config.gemini.defaultBackgroundColor || 'White') : document.getElementById('ai-bg').value.trim();

    if (!nodeLabel) {
        showToast('La etiqueta es requerida para generar el icono', 'warning');
        return;
    }

    showToast(`Generando icono para "${nodeLabel}"...`, 'info');

    try {
        const prompt = `Create a ${style} icon of a human body part: ${nodeLabel}. The icon should be ${style}. Background color: ${bg}. Resolution: 1024x1024. Only the body part should be visible, centered.`;

        const response = await fetch('/api/gemini/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                model: config.gemini.model,
                aspectRatio: '1:1',
                imageSize: '1K'
            })
        });

        const data = await response.json();

        if (data.success && data.image) {
            // If called from the edit form (single generation)
            if (!specificNode) {
                document.getElementById('node-image').value = data.image; // Base64 data URI
                const preview = document.getElementById('node-image-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${data.image}" alt="Preview" style="max-width: 80px; max-height: 80px; border-radius: 4px; border: 1px solid var(--border-color);">`;
                }
                showToast('Icono generado exitosamente', 'success');
            } else {
                // Return for batch processing
                return data.image;
            }
        } else {
            throw new Error(data.error || 'Failed to generate');
        }
    } catch (err) {
        console.error('Generation error:', err);
        showToast(`Error al generar: ${err.message}`, 'error');
        return null;
    }
}

async function generateAllBodyPartIcons() {
    if (!confirm('Esto generará iconos para TODAS las partes del cuerpo que no tengan imagen, usando la configuración por defecto. ¿Continuar?')) return;

    const config = window.ConfigManager?.get();
    if (!config?.gemini?.enabled) {
        showToast('Gemini AI no está habilitado', 'error');
        return;
    }

    showToast('Iniciando generación masiva... Esto puede tardar.', 'info');

    // Helper to traverse and update
    async function traverseAndUpdate(nodes) {
        let count = 0;
        for (const node of nodes) {
            if (!node.image) { // Only generate if missing
                const image = await generateBodyPartIcon(node);
                if (image) {
                    // Save immediately to DB
                    await window.ConfigManager.updateBodyPartInDB(node.db_id, { ...node, image });
                    node.image = image; // Update local state
                    count++;
                    // Delay to avoid rate limits
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            if (node.subparts && node.subparts.length > 0) {
                count += await traverseAndUpdate(node.subparts);
            }
        }
        return count;
    }

    // Reload latest from DB first
    currentBodyPartsConfig = await window.ConfigManager.loadBodyPartsFromDB();
    
    const totalGenerated = await traverseAndUpdate(currentBodyPartsConfig);
    
    showToast(`Proceso finalizado. ${totalGenerated} iconos generados.`, 'success');
    renderBodyPartsManagerFunc('tree');
}

// Exports
window.openBodyPartsManager = openBodyPartsManager;
window.handleBodyPartImageUpload = handleBodyPartImageUpload;
window.addMainBodyPart = addMainBodyPart;
window.addBodySubPart = addBodySubPart;
window.editBodyPartNode = editBodyPartNode;
window.deleteBodyPartNode = deleteBodyPartNode;
window.saveNodeEdit = saveNodeEdit;
window.saveBodyPartsConfig = saveBodyPartsConfig;
window.renderBodyPartsManagerFunc = renderBodyPartsManagerFunc;
window.cancelNodeEdit = cancelNodeEdit;
window.cancelBodyPartsConfig = cancelBodyPartsConfig;

// ============================================
// SUPER ADMIN SECTIONS
// APIs, Database, Routes, Backup
// ============================================

// ============ APIs SECTION ============
let currentTableData = [];
let currentTableAllData = [];
let currentTableFilteredData = [];
let currentTableName = '';
let tableInspectorPage = 1;
const tableInspectorPerPage = 20;
let tableInspectorSort = { column: null, ascending: true };
let tableInspectorColFilters = {};
const TABLE_FK_MAP = {
    'quotations_db': { artist_id: 'artists_db', artist_name: 'artists_db' },
    'feedback_tickets': { user_id: 'artists_db' },
    'chat_messages': { quotation_id: 'quotations_db' }
};

function loadAPIsSection() {
    // Load current config values into form fields
    const config = window.ConfigManager?.get() || {};
    
    // Supabase
    document.getElementById('api-supabase-url').value = config.supabase?.url || '';
    document.getElementById('api-supabase-key').value = config.supabase?.anonKey || '';
    document.getElementById('api-supabase-bucket').value = config.supabase?.storageBucket || 'quotation-references';
    document.getElementById('api-supabase-service-key').value = config.supabase?.serviceRoleKey || '';
    
    // Google Drive (new direct API integration)
    const gdriveCredentials = document.getElementById('api-gdrive-credentials');
    const gdriveServiceEmail = document.getElementById('api-gdrive-service-email');
    const gdriveLink = document.getElementById('api-gdrive-folder-link');
    const gdriveFolderId = document.getElementById('api-gdrive-folder-id');
    
    if (gdriveCredentials) {
        // Load existing credentials (stored as JSON string)
        const storedCredentials = config.googleDrive?.serviceAccountJson || '';
        if (storedCredentials) {
            gdriveCredentials.value = storedCredentials;
            // Extract and display the service account email
            try {
                const parsed = JSON.parse(storedCredentials);
                if (gdriveServiceEmail && parsed.client_email) {
                    gdriveServiceEmail.value = parsed.client_email;
                }
            } catch (e) {
                console.warn('Could not parse stored credentials');
            }
        }
        
        // Add event listener to extract email when credentials are pasted
        gdriveCredentials.addEventListener('input', function() {
            try {
                const parsed = JSON.parse(this.value);
                if (gdriveServiceEmail && parsed.client_email) {
                    gdriveServiceEmail.value = parsed.client_email;
                }
            } catch (e) {
                if (gdriveServiceEmail) {
                    gdriveServiceEmail.value = '';
                }
            }
        });
    }
    
    if (gdriveLink && gdriveFolderId) {
        const mainFolderId = config.googleDrive?.mainFolderId || '';
        gdriveFolderId.value = mainFolderId;
        // Reconstruct the link from the ID if we have one
        if (mainFolderId) {
            gdriveLink.value = `https://drive.google.com/drive/folders/${mainFolderId}`;
        }
        // Add event listener to extract ID from pasted link
        gdriveLink.addEventListener('input', function() {
            const extractedId = extractGoogleDriveFolderId(this.value);
            gdriveFolderId.value = extractedId || '';
        });
    }
    
    // n8n (legacy)
    document.getElementById('api-n8n-webhook').value = config.n8n?.webhookUrl || '';
    document.getElementById('api-n8n-drive-folder').value = config.n8n?.driveFolderId || '';
    
    // EmailJS
    document.getElementById('api-emailjs-service').value = config.emailjs?.serviceId || '';
    document.getElementById('api-emailjs-template').value = config.emailjs?.templateId || '';
    document.getElementById('api-emailjs-pubkey').value = config.emailjs?.publicKey || '';
    
    // Google Maps
    document.getElementById('api-gmaps-key').value = config.googleMaps?.apiKey || '';

    // Gemini AI
    document.getElementById('api-gemini-key').value = config.gemini?.apiKey || '';
    document.getElementById('api-gemini-model').value = config.gemini?.model || 'gemini-3-pro-image-preview';
    document.getElementById('api-gemini-style').value = config.gemini?.defaultStyle || 'Minimalist line art';
    document.getElementById('api-gemini-bg').value = config.gemini?.defaultBackgroundColor || 'White';
    document.getElementById('api-gemini-enabled').checked = config.gemini?.enabled || false;
    
    // Google Calendar
    const gcalendarClientId = document.getElementById('api-gcalendar-client-id');
    const gcalendarApiKey = document.getElementById('api-gcalendar-api-key');
    const gcalendarEnabled = document.getElementById('api-gcalendar-enabled');
    
    if (gcalendarClientId) {
        gcalendarClientId.value = config.googleCalendar?.clientId || '';
    }
    if (gcalendarApiKey) {
        gcalendarApiKey.value = config.googleCalendar?.apiKey || '';
    }
    if (gcalendarEnabled) {
        gcalendarEnabled.checked = config.googleCalendar?.enabled || false;
    }
    
    // Update status indicators based on configuration
    updateAPIStatus('supabase', config.supabase?.url ? 'configured' : 'none');
    // Google Drive needs both credentials and folder ID
    const gdriveConfigured = config.googleDrive?.mainFolderId && config.googleDrive?.serviceAccountJson;
    updateAPIStatus('gdrive', gdriveConfigured ? 'configured' : 'none');
    // Google Calendar needs both client ID and API key
    const gcalendarConfigured = config.googleCalendar?.clientId && config.googleCalendar?.apiKey;
    updateAPIStatus('gcalendar', gcalendarConfigured ? 'configured' : 'none');
    updateAPIStatus('n8n', config.n8n?.webhookUrl ? 'configured' : 'none');
    updateAPIStatus('emailjs', config.emailjs?.serviceId ? 'configured' : 'none');
    updateAPIStatus('gmaps', config.googleMaps?.apiKey ? 'configured' : 'none');
    updateAPIStatus('gemini', config.gemini?.apiKey ? 'configured' : 'none');
}

/**
 * Extract Google Drive folder ID from various link formats
 * Supports:
 * - https://drive.google.com/drive/folders/FOLDER_ID
 * - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
 * - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 * - Just the folder ID itself
 */
function extractGoogleDriveFolderId(input) {
    if (!input) return null;
    
    const trimmed = input.trim();
    
    // Pattern for folder links
    const folderPattern = /(?:drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/|^)([a-zA-Z0-9_-]{25,})/;
    const match = trimmed.match(folderPattern);
    
    if (match && match[1]) {
        return match[1];
    }
    
    // If it looks like just an ID (alphanumeric with dashes/underscores, 25+ chars)
    if (/^[a-zA-Z0-9_-]{25,}$/.test(trimmed)) {
        return trimmed;
    }
    
    return null;
}

function updateAPIStatus(api, status) {
    const el = document.getElementById(`api-${api}-status`);
    if (!el) return;
    
    const statusConfig = {
        'connected': { icon: 'fa-circle-check', text: 'Conectado', class: 'connected' },
        'configured': { icon: 'fa-circle', text: 'Configurado', class: 'warning' },
        'error': { icon: 'fa-circle-xmark', text: 'Error', class: 'disconnected' },
        'none': { icon: 'fa-circle', text: 'Sin configurar', class: '' }
    };
    
    const cfg = statusConfig[status] || statusConfig['none'];
    el.innerHTML = `<i class="fa-solid ${cfg.icon}"></i> ${cfg.text}`;
    el.className = `api-status ${cfg.class}`;
}

async function testSupabaseAPI() {
    const url = document.getElementById('api-supabase-url').value.trim();
    const key = document.getElementById('api-supabase-key').value.trim();
    
    if (!url || !key) {
        showToast('Por favor ingresa URL y Key', 'error');
        return;
    }
    
    showToast('Probando conexión...', 'info');
    updateAPIStatus('supabase', 'none');
    
    try {
        const testClient = window.supabase.createClient(url, key);
        const { count, error } = await testClient
            .from('artists_db')
            .select('*', { count: 'exact', head: true });
        
        if (error) throw error;
        
        updateAPIStatus('supabase', 'connected');
        showToast(`Conexión exitosa. ${count} artistas encontrados.`, 'success');
    } catch (err) {
        updateAPIStatus('supabase', 'error');
        showToast('Error: ' + err.message, 'error');
    }
}

function saveSupabaseAPI() {
    const url = document.getElementById('api-supabase-url').value.trim();
    const key = document.getElementById('api-supabase-key').value.trim();
    const bucket = document.getElementById('api-supabase-bucket').value.trim();
    const serviceKey = document.getElementById('api-supabase-service-key').value.trim();
    
    window.ConfigManager?.update({
        supabase: { url, anonKey: key, storageBucket: bucket, serviceRoleKey: serviceKey }
    });
    
    // Also update legacy settings
    const settings = JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}');
    settings.supabase = { url, key, serviceKey };
    localStorage.setItem('weotzi_admin_settings', JSON.stringify(settings));
    
    showToast('Configuración de Supabase guardada', 'success');
    updateAPIStatus('supabase', url ? 'configured' : 'none');
}

async function testN8NAPI() {
    const webhookUrl = document.getElementById('api-n8n-webhook').value.trim();
    
    if (!webhookUrl) {
        showToast('Por favor ingresa la URL del webhook', 'error');
        return;
    }
    
    showToast('Enviando test webhook...', 'info');
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                test: true,
                source: 'weotzi-admin',
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            updateAPIStatus('n8n', 'connected');
            showToast('Webhook respondió correctamente', 'success');
        } else {
            updateAPIStatus('n8n', 'error');
            showToast(`Error: HTTP ${response.status}`, 'error');
        }
    } catch (err) {
        updateAPIStatus('n8n', 'error');
        showToast('Error: ' + err.message, 'error');
    }
}

function saveN8NAPI() {
    const webhookUrl = document.getElementById('api-n8n-webhook').value.trim();
    const driveFolderId = document.getElementById('api-n8n-drive-folder').value.trim();
    
    window.ConfigManager?.update({
        n8n: { webhookUrl, driveFolderId }
    });
    
    showToast('Configuración de n8n guardada', 'success');
    updateAPIStatus('n8n', webhookUrl ? 'configured' : 'none');
}

// ============ GOOGLE DRIVE API FUNCTIONS ============

/**
 * Validate and parse service account JSON
 */
function parseServiceAccountCredentials(jsonString) {
    if (!jsonString || !jsonString.trim()) {
        return { valid: false, error: 'Credenciales vacias' };
    }
    
    try {
        const parsed = JSON.parse(jsonString);
        
        // Validate required fields
        const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
        const missingFields = requiredFields.filter(f => !parsed[f]);
        
        if (missingFields.length > 0) {
            return { valid: false, error: `Campos faltantes: ${missingFields.join(', ')}` };
        }
        
        if (parsed.type !== 'service_account') {
            return { valid: false, error: 'El tipo debe ser "service_account"' };
        }
        
        return { valid: true, credentials: parsed };
    } catch (e) {
        return { valid: false, error: 'JSON invalido: ' + e.message };
    }
}

/**
 * Test connection to the Google Drive API backend
 */
async function testGoogleDriveAPI() {
    const credentialsJson = document.getElementById('api-gdrive-credentials').value.trim();
    const folderId = document.getElementById('api-gdrive-folder-id').value.trim();
    
    // Validate credentials
    const credResult = parseServiceAccountCredentials(credentialsJson);
    if (!credResult.valid) {
        showToast('Credenciales invalidas: ' + credResult.error, 'error');
        return;
    }
    
    if (!folderId) {
        showToast('Por favor ingresa un enlace de carpeta de Google Drive valido', 'error');
        return;
    }
    
    showToast('Probando conexion con Google Drive...', 'info');
    updateAPIStatus('gdrive', 'none');
    
    try {
        const response = await fetch('/api/google-drive/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                folderId,
                credentials: credResult.credentials
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateAPIStatus('gdrive', 'connected');
            showToast(`Conexion exitosa. Carpeta: ${result.folderName || folderId}`, 'success');
        } else {
            updateAPIStatus('gdrive', 'error');
            showToast(`Error: ${result.error || 'No se pudo conectar'}`, 'error');
        }
    } catch (err) {
        updateAPIStatus('gdrive', 'error');
        showToast('Error: ' + err.message, 'error');
    }
}

/**
 * Save Google Drive configuration
 */
function saveGoogleDriveAPI() {
    const credentialsJson = document.getElementById('api-gdrive-credentials').value.trim();
    const folderLink = document.getElementById('api-gdrive-folder-link').value.trim();
    let folderId = document.getElementById('api-gdrive-folder-id').value.trim();
    
    // Validate credentials if provided
    if (credentialsJson) {
        const credResult = parseServiceAccountCredentials(credentialsJson);
        if (!credResult.valid) {
            showToast('Credenciales invalidas: ' + credResult.error, 'error');
            return;
        }
    }
    
    // Extract folder ID from link if needed
    if (!folderId && folderLink) {
        const extracted = extractGoogleDriveFolderId(folderLink);
        if (extracted) {
            document.getElementById('api-gdrive-folder-id').value = extracted;
            folderId = extracted;
        } else {
            showToast('No se pudo extraer el ID de la carpeta del enlace proporcionado', 'error');
            return;
        }
    }
    
    // Save to config
    window.ConfigManager?.update({
        googleDrive: { 
            mainFolderId: folderId,
            folderLink: folderLink,
            serviceAccountJson: credentialsJson
        }
    });
    
    showToast('Configuracion de Google Drive guardada', 'success');
    updateAPIStatus('gdrive', (folderId && credentialsJson) ? 'configured' : 'none');
}

/**
 * Test Google Calendar API configuration
 * Validates the format of Client ID and API Key
 */
function testGoogleCalendarAPI() {
    const clientId = document.getElementById('api-gcalendar-client-id').value.trim();
    const apiKey = document.getElementById('api-gcalendar-api-key').value.trim();
    
    if (!clientId || !apiKey) {
        showToast('Por favor completa Client ID y API Key', 'error');
        updateAPIStatus('gcalendar', 'none');
        return;
    }
    
    // Validate Client ID format (should end with .apps.googleusercontent.com)
    if (!clientId.includes('.apps.googleusercontent.com')) {
        showToast('El Client ID no parece valido. Debe terminar en .apps.googleusercontent.com', 'error');
        updateAPIStatus('gcalendar', 'error');
        return;
    }
    
    // Validate API Key format (should start with AIza)
    if (!apiKey.startsWith('AIza')) {
        showToast('El API Key no parece valido. Debe comenzar con AIza...', 'error');
        updateAPIStatus('gcalendar', 'error');
        return;
    }
    
    // Both validations passed
    showToast('Formato de credenciales valido. La conexion real se probara en el calendario del artista.', 'success');
    updateAPIStatus('gcalendar', 'configured');
}

/**
 * Save Google Calendar configuration
 */
function saveGoogleCalendarAPI() {
    const clientId = document.getElementById('api-gcalendar-client-id').value.trim();
    const apiKey = document.getElementById('api-gcalendar-api-key').value.trim();
    const enabled = document.getElementById('api-gcalendar-enabled').checked;
    
    // Save to config
    window.ConfigManager?.update({
        googleCalendar: { 
            clientId: clientId,
            apiKey: apiKey,
            enabled: enabled
        }
    });
    
    showToast('Configuracion de Google Calendar guardada', 'success');
    updateAPIStatus('gcalendar', (clientId && apiKey) ? 'configured' : 'none');
}

function testEmailJSAPI() {
    const serviceId = document.getElementById('api-emailjs-service').value.trim();
    const publicKey = document.getElementById('api-emailjs-pubkey').value.trim();
    
    if (!serviceId || !publicKey) {
        showToast('Por favor completa Service ID y Public Key', 'error');
        return;
    }
    
    // EmailJS can't be easily tested without sending a real email
    // Just verify the configuration exists
    updateAPIStatus('emailjs', 'configured');
    showToast('Configuración de EmailJS verificada', 'success');
}

function saveEmailJSAPI() {
    const serviceId = document.getElementById('api-emailjs-service').value.trim();
    const templateId = document.getElementById('api-emailjs-template').value.trim();
    const publicKey = document.getElementById('api-emailjs-pubkey').value.trim();
    
    window.ConfigManager?.update({
        emailjs: { serviceId, templateId, publicKey }
    });
    
    // Also update legacy settings
    const settings = JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}');
    settings.emailjs = { serviceId, templateId, publicKey };
    localStorage.setItem('weotzi_admin_settings', JSON.stringify(settings));
    
    showToast('Configuración de EmailJS guardada', 'success');
    updateAPIStatus('emailjs', serviceId ? 'configured' : 'none');
}

function testGoogleMapsAPI() {
    const apiKey = document.getElementById('api-gmaps-key').value.trim();
    
    if (!apiKey) {
        showToast('Por favor ingresa la API Key', 'error');
        return;
    }
    
    // Google Maps API verification
    updateAPIStatus('gmaps', 'configured');
    showToast('API Key de Google Maps configurada', 'success');
}

function saveGoogleMapsAPI() {
    const apiKey = document.getElementById('api-gmaps-key').value.trim();
    
    window.ConfigManager?.update({
        googleMaps: { apiKey }
    });
    
    showToast('Configuración de Google Maps guardada', 'success');
    updateAPIStatus('gmaps', apiKey ? 'configured' : 'none');
}

async function testGeminiAPI() {
    const apiKey = document.getElementById('api-gemini-key').value.trim();
    const model = document.getElementById('api-gemini-model').value;
    
    if (!apiKey) {
        showToast('Por favor ingresa la API Key', 'error');
        return;
    }
    
    showToast('Generando imagen de prueba...', 'info');
    updateAPIStatus('gemini', 'none');
    
    try {
        const response = await fetch('/api/gemini/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'A simple minimalist line art icon of a circle',
                model,
                aspectRatio: '1:1',
                imageSize: '1K'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateAPIStatus('gemini', 'connected');
            showToast('Conexión exitosa. Imagen generada.', 'success');
            // We could show the image in a modal or log it, but success is enough for config test
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        updateAPIStatus('gemini', 'error');
        showToast('Error: ' + err.message, 'error');
    }
}

function saveGeminiAPI() {
    const apiKey = document.getElementById('api-gemini-key').value.trim();
    const model = document.getElementById('api-gemini-model').value;
    const defaultStyle = document.getElementById('api-gemini-style').value.trim();
    const defaultBackgroundColor = document.getElementById('api-gemini-bg').value.trim();
    const enabled = document.getElementById('api-gemini-enabled').checked;
    
    window.ConfigManager?.update({
        gemini: { 
            apiKey, 
            model, 
            defaultStyle, 
            defaultBackgroundColor,
            enabled
        }
    });
    
    showToast('Configuración de Gemini AI guardada', 'success');
    updateAPIStatus('gemini', apiKey ? 'configured' : 'none');
}

async function testAllConnections() {
    showToast('Probando todas las conexiones...', 'info');

    try {
        const response = await fetch('/api/health/all');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.services) {
                const svcMap = {
                    'supabase': 'supabase',
                    'n8n': 'n8n',
                    'gemini': 'gemini',
                    'google-maps': 'gmaps',
                    'google-drive': 'gdrive',
                    'emailjs': 'emailjs',
                    'google-calendar': 'gcalendar'
                };
                let healthy = 0;
                let total = 0;
                for (const [svcKey, uiKey] of Object.entries(svcMap)) {
                    const svc = data.services[svcKey];
                    if (!svc) continue;
                    total++;
                    if (svc.status === 'healthy') {
                        updateAPIStatus(uiKey, 'connected');
                        healthy++;
                    } else if (svc.status === 'unconfigured') {
                        updateAPIStatus(uiKey, 'none');
                    } else {
                        updateAPIStatus(uiKey, 'error');
                    }
                }
                showToast(`Test completado: ${healthy}/${total} servicios saludables (${data.overall})`, healthy === total ? 'success' : 'warning');
                return;
            }
        }
    } catch (e) {
        console.warn('Health endpoint unavailable, falling back to individual tests:', e.message);
    }

    // Fallback: individual tests
    await testSupabaseAPI();
    await new Promise(r => setTimeout(r, 500));
    const n8nUrl = document.getElementById('api-n8n-webhook').value.trim();
    if (n8nUrl) await testN8NAPI();
}

// ============ DATABASE SECTION ============
const DB_TABLES = [
    'artists_db',
    'quotations_db',
    'tattoo_styles',
    'body_parts',
    'quotation_flow_config',
    'support_users_db',
    'feedback_tickets'
];

async function loadDatabaseSection() {
    await loadDatabaseStats();
}

async function loadDatabaseStats() {
    const healthIndicator = document.getElementById('db-health-indicator');
    const tablesGrid = document.getElementById('tables-grid');
    
    // Check if Supabase is available
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        healthIndicator.className = 'db-health-indicator disconnected';
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Sin conexion a Supabase</span>';
        showEmptyState('tables-grid', 'fa-plug', 'Sin conexion a Supabase', 'Configura la conexion en Configuracion para ver las tablas.');
        return;
    }

    healthIndicator.className = 'db-health-indicator';
    healthIndicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Cargando...</span>';
    showSectionLoading('tables-grid');
    
    try {
        let totalRows = 0;
        const tableCounts = {};
        
        // Get row counts for each table
        for (const table of DB_TABLES) {
            try {
                const { count, error } = await client
                    .from(table)
                    .select('*', { count: 'exact', head: true });
                
                tableCounts[table] = error ? 'Error' : (count || 0);
                if (!error && count) totalRows += count;
            } catch {
                tableCounts[table] = 'Error';
            }
        }
        
        // Update health indicator
        healthIndicator.className = 'db-health-indicator connected';
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Conectado</span>';
        
        // Update stats
        document.getElementById('db-total-tables').textContent = DB_TABLES.length;
        document.getElementById('db-total-rows').textContent = totalRows.toLocaleString();
        
        // Render tables grid
        tablesGrid.innerHTML = DB_TABLES.map(table => {
            const count = tableCounts[table];
            const isError = count === 'Error';
            
            return `
                <div class="table-card" onclick="inspectTable('${table}')">
                    <div class="table-card-header">
                        <div class="table-card-name">
                            <i class="fa-solid fa-table"></i>
                            <span>${table}</span>
                        </div>
                        <span class="table-card-count ${isError ? 'error' : ''}">${isError ? 'Error' : count}</span>
                    </div>
                    <div class="table-card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); exportTable('${table}')">
                            <i class="fa-solid fa-download"></i> Exportar
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        healthIndicator.className = 'db-health-indicator disconnected';
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Error de conexión</span>';
        showToast('Error: ' + err.message, 'error');
    }
}

async function inspectTable(tableName) {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) { showToast('No hay conexión a Supabase', 'error'); return; }
    currentTableName = tableName;
    tableInspectorPage = 1;
    tableInspectorSort = { column: null, ascending: true };
    tableInspectorColFilters = {};
    document.getElementById('table-inspector-title').textContent = `Tabla: ${tableName}`;
    const searchInput = document.getElementById('table-inspector-search');
    if (searchInput) searchInput.value = '';
    showToast('Cargando datos...', 'info');
    try {
        const { data, error } = await client.from(tableName).select('*');
        if (error) throw error;
        currentTableAllData = data || [];
        currentTableData = [...currentTableAllData];
        currentTableFilteredData = [...currentTableAllData];
        document.getElementById('table-inspector-count').textContent = `${currentTableAllData.length} registros`;
        const fkInfo = document.getElementById('table-inspector-fk-info');
        const fks = TABLE_FK_MAP[tableName];
        if (fkInfo && fks) { fkInfo.innerHTML = `<i class="fa-solid fa-link"></i> FK: ${Object.entries(fks).map(([c,r])=>c+' -> '+r).join(', ')}`; }
        else if (fkInfo) { fkInfo.innerHTML = ''; }
        renderColumnFilters();
        renderTableInspector();
        openModal('table-inspector-modal');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function detectColumnType(data, col) {
    for (const row of data) {
        const val = row[col];
        if (val === null || val === undefined || val === '') continue;
        if (typeof val === 'number') return 'number';
        if (typeof val === 'boolean') return 'boolean';
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return 'date';
        if (typeof val === 'object') return 'json';
        return 'text';
    }
    return 'text';
}


function renderColumnFilters() {
    const container = document.getElementById('table-inspector-col-filters');
    if (!container || currentTableAllData.length === 0) {
        if (container) container.innerHTML = '';
        return;
    }

    const columns = Object.keys(currentTableAllData[0]);
    const filterCols = columns.slice(0, 8);

    container.innerHTML = filterCols.map(col => {
        const type = detectColumnType(currentTableAllData, col);
        const currentVal = tableInspectorColFilters[col] || '';
        const baseStyle = 'width:100px;padding:4px 8px;font-size:0.75rem;border:1px solid var(--border-color,#333);border-radius:4px;background:var(--bg-secondary,#1a1a1a);color:var(--text-primary,#fff);';

        if (type === 'date') {
            return `<input type="date" value="${currentVal}" style="${baseStyle}width:130px;"
                oninput="updateColFilter('${col}',this.value)" title="Filtrar ${col}">`;
        }
        const placeholder = type === 'number' ? `${col} (>N, <N, N-N)` : col;
        return `<input type="text" placeholder="${placeholder}" value="${currentVal}" style="${baseStyle}"
            oninput="updateColFilter('${col}',this.value)" title="Filtrar ${col}">`;
    }).join('');
}


function updateColFilter(col, value) {
    if (value) {
        tableInspectorColFilters[col] = value;
    } else {
        delete tableInspectorColFilters[col];
    }
    tableInspectorPage = 1;
    applyInspectorFilters();
}


function filterTableInspector() {
    tableInspectorPage = 1;
    applyInspectorFilters();
}


function applyInspectorFilters() {
    const searchInput = document.getElementById('table-inspector-search');
    const searchTerm = (searchInput?.value || '').toLowerCase().trim();

    let filtered = [...currentTableAllData];

    // Global search
    if (searchTerm) {
        filtered = filtered.filter(row =>
            Object.values(row).some(val => {
                if (val === null || val === undefined) return false;
                return String(val).toLowerCase().includes(searchTerm);
            })
        );
    }

    // Column filters
    for (const [col, filterVal] of Object.entries(tableInspectorColFilters)) {
        if (!filterVal) continue;
        const type = detectColumnType(currentTableAllData, col);

        if (type === 'number') {
            if (filterVal.startsWith('>')) {
                const num = parseFloat(filterVal.slice(1));
                if (!isNaN(num)) filtered = filtered.filter(r => (r[col] || 0) > num);
            } else if (filterVal.startsWith('<')) {
                const num = parseFloat(filterVal.slice(1));
                if (!isNaN(num)) filtered = filtered.filter(r => (r[col] || 0) < num);
            } else if (filterVal.includes('-') && !filterVal.startsWith('-')) {
                const [min, max] = filterVal.split('-').map(Number);
                if (!isNaN(min) && !isNaN(max)) filtered = filtered.filter(r => (r[col] || 0) >= min && (r[col] || 0) <= max);
            } else {
                const num = parseFloat(filterVal);
                if (!isNaN(num)) filtered = filtered.filter(r => r[col] === num);
            }
        } else if (type === 'date') {
            filtered = filtered.filter(r => r[col] && r[col].startsWith(filterVal));
        } else {
            const lowerFilter = filterVal.toLowerCase();
            filtered = filtered.filter(r => {
                if (r[col] === null || r[col] === undefined) return false;
                return String(r[col]).toLowerCase().includes(lowerFilter);
            });
        }
    }

    currentTableFilteredData = filtered;
    currentTableData = filtered;

    document.getElementById('table-inspector-count').textContent =
        filtered.length === currentTableAllData.length
            ? `${filtered.length} registros`
            : `${filtered.length} de ${currentTableAllData.length} registros`;

    renderTableInspector();
}


function sortTableInspector(column) {
    if (tableInspectorSort.column === column) {
        tableInspectorSort.ascending = !tableInspectorSort.ascending;
    } else {
        tableInspectorSort.column = column;
        tableInspectorSort.ascending = true;
    }

    currentTableFilteredData.sort((a, b) => {
        let valA = a[column];
        let valB = b[column];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
            return tableInspectorSort.ascending ? valA - valB : valB - valA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return tableInspectorSort.ascending ? -1 : 1;
        if (valA > valB) return tableInspectorSort.ascending ? 1 : -1;
        return 0;
    });

    currentTableData = currentTableFilteredData;
    tableInspectorPage = 1;
    renderTableInspector();
}

// --- REPLACE renderTableInspector ---
function renderTableInspector() {
    const thead = document.getElementById('table-inspector-head');
    const tbody = document.getElementById('table-inspector-body');
    const data = currentTableFilteredData;

    if (!data || data.length === 0) {
        thead.innerHTML = '<tr><th>Sin datos</th></tr>';
        tbody.innerHTML = '<tr><td class="empty-state">No hay resultados</td></tr>';
        document.getElementById('table-inspector-pagination').innerHTML = '';
        return;
    }

    const columns = Object.keys(data[0]);
    const fks = TABLE_FK_MAP[currentTableName] || {};

    // Header with sort + FK badges
    thead.innerHTML = `<tr>
        <th style="width:40px;text-align:center;">#</th>
        ${columns.map(col => {
            const sortIcon = tableInspectorSort.column === col
                ? (tableInspectorSort.ascending ? ' <i class="fa-solid fa-sort-up"></i>' : ' <i class="fa-solid fa-sort-down"></i>')
                : ' <i class="fa-solid fa-sort" style="opacity:0.3"></i>';
            const fkBadge = fks[col] ? ` <span style="font-size:0.6rem;background:var(--bauhaus-blue,#1A4B8E);color:white;padding:1px 4px;border-radius:3px;" title="FK → ${fks[col]}">FK</span>` : '';
            return `<th style="cursor:pointer;white-space:nowrap;user-select:none;" onclick="sortTableInspector('${col}')">${col}${fkBadge}${sortIcon}</th>`;
        }).join('')}
    </tr>`;

    // Paginate
    const start = (tableInspectorPage - 1) * tableInspectorPerPage;
    const end = start + tableInspectorPerPage;
    const pageData = data.slice(start, end);

    // Rows with inline edit on double-click
    tbody.innerHTML = pageData.map((row, idx) => {
        const globalIdx = start + idx;
        return `<tr>
            <td style="text-align:center;color:var(--text-muted);font-size:0.75rem;">${globalIdx + 1}</td>
            ${columns.map(col => {
                let value = row[col];
                const isFK = !!fks[col];

                if (value === null) value = '<span class="text-muted">null</span>';
                else if (typeof value === 'object') {
                    const json = JSON.stringify(value);
                    value = `<code title="${json.replace(/"/g, '&quot;')}">${json.substring(0, 40)}${json.length > 40 ? '...' : ''}</code>`;
                }
                else if (typeof value === 'string' && value.length > 50) value = `<span title="${value.replace(/"/g, '&quot;')}">${value.substring(0, 50)}...</span>`;

                const fkLink = isFK && row[col] !== null ? ` <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.6rem;cursor:pointer;color:var(--bauhaus-blue,#1A4B8E);" onclick="event.stopPropagation();inspectTable('${fks[col]}')" title="Ver en ${fks[col]}"></i>` : '';

                return `<td ondblclick="startInlineEdit(this,'${col}',${globalIdx})" style="cursor:default;" title="Doble click para editar">${value}${fkLink}</td>`;
            }).join('')}
        </tr>`;
    }).join('');

    renderInspectorPagination();
}


function renderInspectorPagination() {
    const container = document.getElementById('table-inspector-pagination');
    const totalPages = Math.ceil(currentTableFilteredData.length / tableInspectorPerPage);

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button ${tableInspectorPage <= 1 ? 'disabled' : ''} onclick="goToInspectorPage(${tableInspectorPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;

    const startPage = Math.max(1, tableInspectorPage - 2);
    const endPage = Math.min(totalPages, tableInspectorPage + 2);

    if (startPage > 1) html += `<button onclick="goToInspectorPage(1)">1</button><span>...</span>`;
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="${i === tableInspectorPage ? 'active' : ''}" onclick="goToInspectorPage(${i})">${i}</button>`;
    }
    if (endPage < totalPages) html += `<span>...</span><button onclick="goToInspectorPage(${totalPages})">${totalPages}</button>`;

    html += `<button ${tableInspectorPage >= totalPages ? 'disabled' : ''} onclick="goToInspectorPage(${tableInspectorPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = html;
}

function goToInspectorPage(page) {
    const totalPages = Math.ceil(currentTableFilteredData.length / tableInspectorPerPage);
    if (page < 1 || page > totalPages) return;
    tableInspectorPage = page;
    renderTableInspector();
}


function startInlineEdit(td, column, rowIndex) {
    // Don't edit id or created_at
    if (column === 'id' || column === 'created_at') {
        showToast('Esta columna no es editable', 'info');
        return;
    }

    const row = currentTableFilteredData[rowIndex];
    if (!row) return;

    const currentValue = row[column];
    const displayValue = currentValue === null ? '' : (typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(currentValue));

    td.innerHTML = `<div style="display:flex;gap:4px;align-items:center;">
        <input type="text" value="${displayValue.replace(/"/g, '&quot;')}"
            style="flex:1;padding:4px 6px;font-size:0.8rem;border:1px solid var(--bauhaus-blue,#1A4B8E);border-radius:3px;background:var(--bg-secondary,#1a1a1a);color:var(--text-primary,#fff);min-width:80px;"
            onkeydown="if(event.key==='Enter')saveInlineEdit(this,'${column}',${rowIndex});if(event.key==='Escape')cancelInlineEdit();"
            id="inline-edit-input">
        <button onclick="saveInlineEdit(document.getElementById('inline-edit-input'),'${column}',${rowIndex})"
            style="padding:2px 6px;font-size:0.7rem;background:var(--bauhaus-blue,#1A4B8E);color:white;border:none;border-radius:3px;cursor:pointer;" title="Guardar">
            <i class="fa-solid fa-check"></i>
        </button>
        <button onclick="cancelInlineEdit()"
            style="padding:2px 6px;font-size:0.7rem;background:var(--bauhaus-red,#C62828);color:white;border:none;border-radius:3px;cursor:pointer;" title="Cancelar">
            <i class="fa-solid fa-xmark"></i>
        </button>
    </div>`;

    const input = document.getElementById('inline-edit-input');
    if (input) {
        input.focus();
        input.select();
    }
}


async function saveInlineEdit(input, column, rowIndex) {
    const newValue = input.value;
    const row = currentTableFilteredData[rowIndex];
    if (!row) return;

    const oldValue = row[column];
    const displayNew = newValue === '' ? 'null' : newValue;
    const displayOld = oldValue === null ? 'null' : String(oldValue);

    if (displayNew === displayOld) {
        cancelInlineEdit();
        return;
    }

    if (!confirm(`Cambiar "${column}" de "${displayOld}" a "${displayNew}"?`)) {
        cancelInlineEdit();
        return;
    }

    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('No hay conexión a Supabase', 'error');
        return;
    }

    // Determine the primary key
    const pk = row.id !== undefined ? 'id' : (row.quote_id !== undefined ? 'quote_id' : null);
    if (!pk) {
        showToast('No se pudo identificar la clave primaria', 'error');
        cancelInlineEdit();
        return;
    }

    try {
        // Parse value type
        let parsedValue = newValue === '' ? null : newValue;
        if (parsedValue !== null) {
            if (parsedValue === 'true') parsedValue = true;
            else if (parsedValue === 'false') parsedValue = false;
            else if (!isNaN(parsedValue) && parsedValue.trim() !== '') parsedValue = Number(parsedValue);
            else {
                try { const obj = JSON.parse(parsedValue); if (typeof obj === 'object') parsedValue = obj; } catch {}
            }
        }

        const { error } = await client
            .from(currentTableName)
            .update({ [column]: parsedValue })
            .eq(pk, row[pk]);

        if (error) throw error;

        // Update local data
        row[column] = parsedValue;
        const allDataRow = currentTableAllData.find(r => r[pk] === row[pk]);
        if (allDataRow) allDataRow[column] = parsedValue;

        showToast('Registro actualizado', 'success');
        renderTableInspector();

    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
        cancelInlineEdit();
    }
}


function cancelInlineEdit() {
    renderTableInspector();
}


function exportFilteredCSV() {
    const data = currentTableFilteredData;
    if (!data || data.length === 0) {
        showToast('No hay datos filtrados para exportar', 'error');
        return;
    }

    const columns = Object.keys(data[0]);
    const csvRows = [columns.join(',')];

    for (const row of data) {
        const values = columns.map(col => {
            let val = row[col];
            if (val === null) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            return `"${String(val).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    saveAs(blob, `${currentTableName}-filtrado-${new Date().toISOString().split('T')[0]}.csv`);
    showToast(`Exportados ${data.length} registros filtrados como CSV`, 'success');
}

async function exportTable(tableName) {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('No hay conexión a Supabase', 'error');
        return;
    }
    
    showToast(`Exportando ${tableName}...`, 'info');
    
    try {
        const { data, error } = await client.from(tableName).select('*');
        if (error) throw error;
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        saveAs(blob, `${tableName}-${new Date().toISOString().split('T')[0]}.json`);
        
        showToast('Tabla exportada', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function exportTableJSON() {
    if (!currentTableData || currentTableData.length === 0) {
        showToast('No hay datos para exportar', 'error');
        return;
    }
    
    const blob = new Blob([JSON.stringify(currentTableData, null, 2)], { type: 'application/json' });
    saveAs(blob, `${currentTableName}-${new Date().toISOString().split('T')[0]}.json`);
    showToast('Exportado como JSON', 'success');
}

function exportTableCSV() {
    if (!currentTableData || currentTableData.length === 0) {
        showToast('No hay datos para exportar', 'error');
        return;
    }
    
    // Convert to CSV
    const columns = Object.keys(currentTableData[0]);
    const csvRows = [columns.join(',')];
    
    for (const row of currentTableData) {
        const values = columns.map(col => {
            let val = row[col];
            if (val === null) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            // Escape quotes and wrap in quotes
            return `"${String(val).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    saveAs(blob, `${currentTableName}-${new Date().toISOString().split('T')[0]}.csv`);
    showToast('Exportado como CSV', 'success');
}

async function exportAllTables() {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('No hay conexión a Supabase', 'error');
        return;
    }
    
    showToast('Exportando todas las tablas...', 'info');
    
    const zip = new JSZip();
    
    for (const table of DB_TABLES) {
        try {
            const { data } = await client.from(table).select('*');
            if (data) {
                zip.file(`${table}.json`, JSON.stringify(data, null, 2));
            }
        } catch (err) {
            console.warn(`Could not export ${table}:`, err);
        }
    }
    
    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `weotzi-database-${new Date().toISOString().split('T')[0]}.zip`);
        showToast('Base de datos exportada', 'success');
    } catch (err) {
        showToast('Error al crear ZIP', 'error');
    }
}

// ============ ROUTES SECTION ============

function loadRoutesSection() {
    loadRoutesConfig();
}

function loadRoutesConfig() {
    const config = window.ConfigManager?.get() || {};
    currentRoutes = config.routes || {};
    
    // Reset health results
    routeHealthResults = {};
    updateRoutesSummary();
    renderRoutesTable();
}

function updateRoutesSummary() {
    const total = Object.keys(currentRoutes).length;
    const healthy = Object.values(routeHealthResults).filter(r => r === 'ok').length;
    const errors = Object.values(routeHealthResults).filter(r => r === 'error').length;
    const warnings = Object.values(routeHealthResults).filter(r => r === 'warning').length;
    const pending = total - healthy - errors - warnings;
    
    document.getElementById('routes-healthy').textContent = healthy;
    document.getElementById('routes-warning').textContent = warnings + pending;
    document.getElementById('routes-error').textContent = errors;
}

function renderRoutesTable() {
    const tbody = document.getElementById('routes-tbody');
    
    const routeEntries = Object.entries(currentRoutes);
    
    if (routeEntries.length === 0) {
        showTableEmptyState('routes-tbody', 4, 'fa-route', 'No hay rutas configuradas', 'Agrega rutas con el boton "Nueva Ruta".');
        return;
    }
    
    tbody.innerHTML = routeEntries.map(([key, path]) => {
        const health = routeHealthResults[key] || 'pending';
        const statusClass = health === 'ok' ? 'ok' : (health === 'error' ? 'error' : 'pending');
        const statusText = health === 'ok' ? 'OK' : (health === 'error' ? 'Error' : 'Sin verificar');
        
        return `
            <tr>
                <td><strong>${key}</strong></td>
                <td><code>${path}</code></td>
                <td><span class="route-status ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn-icon" onclick="testRoute('${key}')" title="Verificar">
                        <i class="fa-solid fa-stethoscope"></i>
                    </button>
                    <button class="btn-icon" onclick="editRoute('${key}')" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon" onclick="window.open('${path}', '_blank')" title="Abrir">
                        <i class="fa-solid fa-external-link"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function testRoute(routeKey) {
    const path = currentRoutes[routeKey];
    if (!path) return;
    
    showToast(`Verificando ${path}...`, 'info');
    
    try {
        const response = await fetch(path, { method: 'HEAD' });
        
        if (response.ok) {
            routeHealthResults[routeKey] = 'ok';
            showToast(`${path} - OK`, 'success');
        } else {
            routeHealthResults[routeKey] = 'error';
            showToast(`${path} - Error ${response.status}`, 'error');
        }
    } catch (err) {
        routeHealthResults[routeKey] = 'error';
        showToast(`${path} - Error de conexión`, 'error');
    }
    
    updateRoutesSummary();
    renderRoutesTable();
}

async function testAllRoutes() {
    showToast('Verificando todas las rutas...', 'info');
    
    for (const key of Object.keys(currentRoutes)) {
        await testRoute(key);
        await new Promise(r => setTimeout(r, 200)); // Small delay between requests
    }
    
    showToast('Verificación completa', 'success');
}

function editRoute(routeKey) {
    const path = currentRoutes[routeKey];
    
    document.getElementById('route-edit-key').value = routeKey;
    document.getElementById('route-edit-name').value = routeKey;
    document.getElementById('route-edit-path').value = path;
    
    openModal('route-edit-modal');
}

function saveRouteEdit(event) {
    event.preventDefault();
    
    const key = document.getElementById('route-edit-key').value;
    const newPath = document.getElementById('route-edit-path').value.trim();
    
    if (!newPath.startsWith('/')) {
        showToast('La ruta debe comenzar con /', 'error');
        return;
    }
    
    currentRoutes[key] = newPath;
    
    // Save to ConfigManager
    window.ConfigManager?.update({ routes: currentRoutes });
    
    showToast('Ruta actualizada', 'success');
    closeModal();
    
    // Reset health for this route
    delete routeHealthResults[key];
    updateRoutesSummary();
    renderRoutesTable();
}

// ============ BACKUP SECTION ============
function loadBackupSection() {
    loadBackupHistory();
}

function loadBackupHistory() {
    const historyContainer = document.getElementById('backup-history');
    const history = JSON.parse(localStorage.getItem('weotzi_backup_history') || '[]');
    
    if (history.length === 0) {
        historyContainer.innerHTML = '<p class="empty-state">No hay backups registrados</p>';
        return;
    }
    
    // Show last 10
    const recentHistory = history.slice(-10).reverse();
    
    historyContainer.innerHTML = recentHistory.map(item => `
        <div class="backup-history-item">
            <div class="backup-history-info">
                <span class="backup-history-type">${item.type}</span>
                <span class="backup-history-date">${new Date(item.date).toLocaleString('es-ES')}</span>
            </div>
            <span class="text-muted">${item.filename}</span>
        </div>
    `).join('');
}

function addBackupToHistory(type, filename) {
    const history = JSON.parse(localStorage.getItem('weotzi_backup_history') || '[]');
    history.push({
        type,
        filename,
        date: new Date().toISOString()
    });
    
    // Keep only last 50
    if (history.length > 50) {
        history.splice(0, history.length - 50);
    }
    
    localStorage.setItem('weotzi_backup_history', JSON.stringify(history));
    loadBackupHistory();
}

// ============ SYSTEM BACKUP (Full with Installer) ============
async function createSystemBackup() {
    const client = window.ConfigManager?.getSupabaseClient();
    
    const includeDb = document.getElementById('backup-include-db')?.checked ?? true;
    const includeConfig = document.getElementById('backup-include-config')?.checked ?? true;
    const originalDomain = document.getElementById('system-backup-domain')?.value || window.location.origin;
    
    const progressEl = document.getElementById('system-backup-progress');
    const statusEl = document.getElementById('system-backup-status');
    const percentEl = document.getElementById('system-backup-percent');
    const barEl = document.getElementById('system-backup-bar');
    const btnEl = document.getElementById('btn-system-backup');
    
    // Show progress
    progressEl?.classList.remove('hidden');
    if (btnEl) btnEl.disabled = true;
    
    const updateProgress = (percent, status) => {
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (barEl) barEl.style.width = `${percent}%`;
        if (statusEl) statusEl.textContent = status;
    };
    
    try {
        updateProgress(10, 'Recopilando datos de la base de datos...');
        
        // Gather database data
        const dbData = {};
        
        if (includeDb && client) {
            const tables = [
                'artists_db', 'quotations_db', 'tattoo_styles', 'body_parts',
                'quotation_flow_config', 'support_users_db', 'feedback_tickets',
                'app_settings', 'session_logs', 'client_accounts'
            ];
            
            let tableCount = 0;
            for (const table of tables) {
                try {
                    const { data, error } = await client.from(table).select('*');
                    if (!error && data) {
                        dbData[table] = data;
                        console.log(`[System Backup] Exported ${table}: ${data.length} records`);
                    }
                } catch (err) {
                    console.warn(`[System Backup] Could not export ${table}:`, err.message);
                }
                tableCount++;
                updateProgress(10 + Math.round((tableCount / tables.length) * 30), `Exportando ${table}...`);
            }
        }
        
        updateProgress(50, 'Recopilando configuracion...');
        
        // Gather configuration
        const config = includeConfig ? (window.ConfigManager?.get() || {}) : {};
        
        // Add localStorage settings to config
        if (includeConfig) {
            config._localSettings = {
                admin_settings: JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}'),
                questions_config: JSON.parse(localStorage.getItem('weotzi_questions_config') || '[]')
            };
        }
        
        updateProgress(60, 'Generando paquete de backup...');
        
        // Send to server to generate ZIP with installer
        const response = await fetch('/api/admin/generate-backup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dbData,
                config,
                originalDomain
            })
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        updateProgress(80, 'Descargando archivo...');
        
        // Download the ZIP file
        const blob = await response.blob();
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `weotzi-system-backup-${timestamp}.zip`;
        
        saveAs(blob, filename);
        
        updateProgress(100, 'Backup completado!');
        
        // Record in history
        addBackupToHistory('Backup del Sistema (con Instalador)', filename);
        showToast('Backup del sistema creado exitosamente', 'success');
        
        // Reset after delay
        setTimeout(() => {
            progressEl?.classList.add('hidden');
            if (btnEl) btnEl.disabled = false;
            updateProgress(0, 'Preparando...');
        }, 3000);
        
    } catch (error) {
        console.error('[System Backup] Error:', error);
        showToast(`Error al crear backup: ${error.message}`, 'error');
        
        progressEl?.classList.add('hidden');
        if (btnEl) btnEl.disabled = false;
    }
}

async function createFullBackup() {
    const client = window.ConfigManager?.getSupabaseClient();
    
    showToast('Creando backup completo...', 'info');
    
    const zip = new JSZip();
    const timestamp = new Date().toISOString().split('T')[0];
    
    // Export database tables if connected
    if (client) {
        for (const table of DB_TABLES) {
            try {
                const { data } = await client.from(table).select('*');
                if (data) {
                    zip.file(`database/${table}.json`, JSON.stringify(data, null, 2));
                }
            } catch (err) {
                console.warn(`Could not backup ${table}:`, err);
            }
        }
    }
    
    // Export configuration
    const config = window.ConfigManager?.get() || {};
    zip.file('config/app-config.json', JSON.stringify(config, null, 2));
    
    // Export localStorage settings
    const localSettings = {
        admin_settings: JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}'),
        questions_config: JSON.parse(localStorage.getItem('weotzi_questions_config') || '[]')
    };
    zip.file('config/local-settings.json', JSON.stringify(localSettings, null, 2));
    
    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const filename = `weotzi-full-backup-${timestamp}.zip`;
        saveAs(blob, filename);
        
        addBackupToHistory('Backup Completo', filename);
        showToast('Backup completo creado', 'success');
    } catch (err) {
        showToast('Error al crear backup', 'error');
    }
}

async function createSelectiveBackup() {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('No hay conexión a Supabase', 'error');
        return;
    }
    
    // Get selected tables
    const checkboxes = document.querySelectorAll('#backup-tables-list input[type="checkbox"]:checked');
    const selectedTables = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedTables.length === 0) {
        showToast('Selecciona al menos una tabla', 'error');
        return;
    }
    
    showToast('Creando backup selectivo...', 'info');
    
    const zip = new JSZip();
    const timestamp = new Date().toISOString().split('T')[0];
    
    for (const table of selectedTables) {
        try {
            const { data } = await client.from(table).select('*');
            if (data) {
                zip.file(`${table}.json`, JSON.stringify(data, null, 2));
            }
        } catch (err) {
            console.warn(`Could not backup ${table}:`, err);
        }
    }
    
    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const filename = `weotzi-selective-backup-${timestamp}.zip`;
        saveAs(blob, filename);
        
        addBackupToHistory(`Backup Selectivo (${selectedTables.length} tablas)`, filename);
        showToast('Backup selectivo creado', 'success');
    } catch (err) {
        showToast('Error al crear backup', 'error');
    }
}

function createConfigBackup() {
    const config = window.ConfigManager?.get() || {};
    const localSettings = {
        admin_settings: JSON.parse(localStorage.getItem('weotzi_admin_settings') || '{}'),
        questions_config: JSON.parse(localStorage.getItem('weotzi_questions_config') || '[]'),
        backup_history: JSON.parse(localStorage.getItem('weotzi_backup_history') || '[]')
    };
    
    const exportData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        config,
        localSettings
    };
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `weotzi-config-backup-${timestamp}.json`;
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    saveAs(blob, filename);
    
    addBackupToHistory('Backup de Configuración', filename);
    showToast('Configuración exportada', 'success');
}

function restoreConfig() {
    document.getElementById('restore-file').click();
}

function handleRestore(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            // Confirm restore
            if (!confirm('¿Restaurar esta configuración? Esto sobrescribirá la configuración actual.')) {
                return;
            }
            
            // Restore config
            if (data.config) {
                window.ConfigManager?.update(data.config);
            }
            
            // Restore local settings
            if (data.localSettings) {
                if (data.localSettings.admin_settings) {
                    localStorage.setItem('weotzi_admin_settings', JSON.stringify(data.localSettings.admin_settings));
                }
                if (data.localSettings.questions_config) {
                    localStorage.setItem('weotzi_questions_config', JSON.stringify(data.localSettings.questions_config));
                }
            }
            
            // Also handle old format
            if (data.settings) {
                localStorage.setItem('weotzi_admin_settings', JSON.stringify(data.settings));
            }
            if (data.questions) {
                localStorage.setItem('weotzi_questions_config', JSON.stringify(data.questions));
            }
            
            showToast('Configuración restaurada. Recargando...', 'success');
            
            // Reload after short delay
            setTimeout(() => window.location.reload(), 1500);
            
        } catch (error) {
            showToast('Error al importar: archivo inválido', 'error');
        }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
}

// ============ DASHBOARD HEALTH INDICATORS ============
async function refreshServiceHealth() {
    // Get service health from ConfigManager (now uses real health check endpoint)
    const health = await window.ConfigManager?.getSystemHealth();

    if (!health) return;

    /**
     * Update a health status element based on real check results
     */
    function updateHealthElement(elementId, svcHealth) {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (svcHealth.connected) {
            const latencyText = svcHealth.latency_ms ? ` (${svcHealth.latency_ms}ms)` : '';
            el.className = 'health-status connected';
            el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Conectado${latencyText}`;
        } else if (svcHealth.status === 'degraded') {
            el.className = 'health-status warning';
            el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Degradado';
        } else if (svcHealth.status === 'down') {
            el.className = 'health-status disconnected';
            el.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Error';
        } else if (svcHealth.configured) {
            el.className = 'health-status warning';
            el.innerHTML = '<i class="fa-solid fa-circle"></i> Configurado';
        } else {
            el.className = 'health-status';
            el.innerHTML = '<i class="fa-solid fa-circle"></i> Sin configurar';
        }
    }

    updateHealthElement('supabase-status', health.supabase);
    updateHealthElement('n8n-status', health.n8n);
    updateHealthElement('emailjs-status', health.emailjs);
    updateHealthElement('gmaps-status', health.googleMaps);
    if (health.gemini) updateHealthElement('gemini-status', health.gemini);
    if (health.googleDrive) updateHealthElement('gdrive-status', health.googleDrive);
}

// Call refresh on init
document.addEventListener('DOMContentLoaded', () => {
    // Delay to ensure ConfigManager is loaded
    setTimeout(refreshServiceHealth, 1000);
});

// ============ APP CONTENT MANAGEMENT ============

/**
 * Load app content from Supabase app_settings table
 */
async function loadAppContent() {
    if (!window.ConfigManager) {
        showToast('ConfigManager no disponible', 'error');
        return;
    }

    showToast('Cargando contenido...', 'info');

    try {
        // Load Next Steps content
        const nextSteps = await window.ConfigManager.getAppSettingFromDB('success_next_steps');
        const nextStepsEl = document.getElementById('content-next-steps');
        const previewEl = document.getElementById('preview-next-steps');
        
        if (nextStepsEl && nextSteps) {
            nextStepsEl.value = nextSteps;
            if (previewEl) previewEl.innerHTML = nextSteps;
        }

        // Load Website URL
        const websiteUrl = await window.ConfigManager.getAppSettingFromDB('website_url');
        const websiteUrlEl = document.getElementById('content-website-url');
        
        if (websiteUrlEl && websiteUrl) {
            websiteUrlEl.value = websiteUrl;
        }

        // Load AI Profile Picture settings
        loadAIProfileSettings();

        showToast('Contenido cargado', 'success');
    } catch (err) {
        console.error('Error loading app content:', err);
        showToast('Error al cargar contenido', 'error');
    }
}

/**
 * Save Next Steps content to Supabase
 */
async function saveNextStepsContent() {
    if (!window.ConfigManager) {
        showToast('ConfigManager no disponible', 'error');
        return;
    }

    const content = document.getElementById('content-next-steps')?.value || '';
    
    if (!content.trim()) {
        showToast('El contenido no puede estar vacio', 'error');
        return;
    }

    showToast('Guardando...', 'info');

    const result = await window.ConfigManager.setAppSettingInDB(
        'success_next_steps',
        content,
        'html',
        'HTML content for Next Steps section on quotation success page'
    );

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
    } else {
        // Update preview
        const previewEl = document.getElementById('preview-next-steps');
        if (previewEl) previewEl.innerHTML = content;
        
        showToast('Contenido guardado exitosamente', 'success');
    }
}

/**
 * Save Website URL to Supabase
 */
async function saveWebsiteUrl() {
    if (!window.ConfigManager) {
        showToast('ConfigManager no disponible', 'error');
        return;
    }

    const url = document.getElementById('content-website-url')?.value || '';
    
    if (!url.trim()) {
        showToast('La URL no puede estar vacia', 'error');
        return;
    }

    // Basic URL validation
    try {
        new URL(url);
    } catch (e) {
        showToast('URL invalida', 'error');
        return;
    }

    showToast('Guardando...', 'info');

    const result = await window.ConfigManager.setAppSettingInDB(
        'website_url',
        url,
        'text',
        'Main website URL for We Otzi'
    );

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
    } else {
        showToast('URL guardada exitosamente', 'success');
    }
}

/**
 * Load AI Profile Picture settings from ConfigManager
 */
function loadAIProfileSettings() {
    const config = window.ConfigManager?.get();
    if (!config || !config.aiProfilePicture) return;

    const settings = config.aiProfilePicture;
    
    if (document.getElementById('ai-profile-enabled')) {
        document.getElementById('ai-profile-enabled').checked = settings.enabled;
    }
    if (document.getElementById('ai-profile-model')) {
        document.getElementById('ai-profile-model').value = settings.model || 'gemini-3-pro-image-preview';
    }
    if (document.getElementById('ai-profile-temp')) {
        document.getElementById('ai-profile-temp').value = settings.temperature || 0.7;
    }
    if (document.getElementById('ai-profile-tokens')) {
        document.getElementById('ai-profile-tokens').value = settings.maxTokens || 512;
    }
    if (document.getElementById('ai-profile-res')) {
        document.getElementById('ai-profile-res').value = settings.resolution || '1K';
    }
    if (document.getElementById('ai-profile-filters')) {
        document.getElementById('ai-profile-filters').value = settings.filters || 'Standard';
    }
    if (document.getElementById('ai-profile-prompt')) {
        document.getElementById('ai-profile-prompt').value = settings.defaultPrompt || '';
    }
}

/**
 * Save AI Profile Picture settings to ConfigManager
 */
function saveAIProfileSettings() {
    if (!window.ConfigManager) {
        showToast('ConfigManager no disponible', 'error');
        return;
    }

    const enabled = document.getElementById('ai-profile-enabled').checked;
    const model = document.getElementById('ai-profile-model').value;
    const temperature = parseFloat(document.getElementById('ai-profile-temp').value);
    const maxTokens = parseInt(document.getElementById('ai-profile-tokens').value);
    const resolution = document.getElementById('ai-profile-res').value;
    const filters = document.getElementById('ai-profile-filters').value;
    const defaultPrompt = document.getElementById('ai-profile-prompt').value.trim();

    window.ConfigManager.update({
        aiProfilePicture: {
            enabled,
            model,
            temperature,
            maxTokens,
            resolution,
            filters,
            defaultPrompt
        }
    });

    showToast('Configuración de IA Profile guardada', 'success');
}

/**
 * Initialize content section - load data when section is shown
 */
function initContentSection() {
    // Add live preview for next steps textarea
    const nextStepsEl = document.getElementById('content-next-steps');
    const previewEl = document.getElementById('preview-next-steps');
    
    if (nextStepsEl && previewEl) {
        nextStepsEl.addEventListener('input', () => {
            previewEl.innerHTML = nextStepsEl.value;
        });
    }

    // Load content
    loadAppContent();
}

// ============ SUPPORT USERS SECTION ============

/**
 * Load support users from Supabase
 */
async function loadSupportUsers() {
    const tbody = document.getElementById('support-users-tbody');
    
    // Check if Supabase is available
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showTableEmptyState('support-users-tbody', 6, 'fa-plug', 'Sin conexion a Supabase', 'Configura la conexion para ver usuarios de soporte.');
        return;
    }

    showTableLoading('support-users-tbody', 6);

    try {
        const { data, error } = await client
            .from('support_users_db')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            showTableEmptyState('support-users-tbody', 6, 'fa-headset', 'No hay usuarios de soporte', 'Crea el primer usuario con el boton de arriba.');
            return;
        }
        
        // Render users
        tbody.innerHTML = data.map(user => {
            const createdAt = user.created_at 
                ? new Date(user.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
                : '-';
            
            const statusClass = user.is_active ? 'success' : 'error';
            const statusText = user.is_active ? 'Activo' : 'Inactivo';
            const statusIcon = user.is_active ? 'fa-circle-check' : 'fa-circle-xmark';
            
            const roleLabels = {
                'support': 'Soporte',
                'supervisor': 'Supervisor',
                'admin': 'Administrador'
            };
            const roleLabel = roleLabels[user.role] || user.role;
            
            return `
                <tr>
                    <td><strong>${escapeHtml(user.full_name || '-')}</strong></td>
                    <td>${escapeHtml(user.email || '-')}</td>
                    <td><span class="badge-sm">${roleLabel}</span></td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            <i class="fa-solid ${statusIcon}"></i> ${statusText}
                        </span>
                    </td>
                    <td>${createdAt}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon" onclick="editSupportUser('${user.user_id}')" title="Editar">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="btn-icon ${user.is_active ? 'danger-hover' : 'success-hover'}" 
                                onclick="toggleSupportUserStatus('${user.user_id}', ${!user.is_active})" 
                                title="${user.is_active ? 'Desactivar' : 'Activar'}">
                                <i class="fa-solid ${user.is_active ? 'fa-user-slash' : 'fa-user-check'}"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (err) {
        console.error('Error loading support users:', err);
        showTableErrorState('support-users-tbody', 6, 'No se pudieron cargar los usuarios de soporte.', 'loadSupportUsers()');
        showToast('Error al cargar usuarios de soporte', 'error');
    }
}

/**
 * Open modal to add a new support user
 */
function addSupportUser() {
    // Reset form
    document.getElementById('support-user-form').reset();
    document.getElementById('support-user-id').value = '';
    document.getElementById('support-user-email').disabled = false;
    document.getElementById('support-user-password').required = true;
    document.getElementById('support-user-password-group').style.display = 'block';
    document.getElementById('support-user-change-password-group').style.display = 'none';
    document.getElementById('support-user-active-group').style.display = 'none';
    document.getElementById('support-user-modal-title').textContent = 'Nuevo Usuario de Soporte';
    
    // Show modal
    document.getElementById('support-user-modal').classList.add('active');
}

/**
 * Open modal to edit an existing support user
 */
async function editSupportUser(userId) {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('Error: Supabase no esta conectado', 'error');
        return;
    }
    
    try {
        const { data, error } = await client
            .from('support_users_db')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (error) throw error;
        
        // Populate form
        document.getElementById('support-user-id').value = data.user_id;
        document.getElementById('support-user-name').value = data.full_name || '';
        document.getElementById('support-user-email').value = data.email || '';
        document.getElementById('support-user-email').disabled = true; // Cannot change email
        document.getElementById('support-user-role').value = data.role || 'support';
        document.getElementById('support-user-active').checked = data.is_active !== false;
        
        // Hide initial password field, show change password section for edit
        document.getElementById('support-user-password').value = '';
        document.getElementById('support-user-password').required = false;
        document.getElementById('support-user-password-group').style.display = 'none';
        document.getElementById('support-user-new-password').value = '';
        document.getElementById('support-user-change-password-group').style.display = 'block';
        document.getElementById('support-user-active-group').style.display = 'flex';
        
        document.getElementById('support-user-modal-title').textContent = 'Editar Usuario de Soporte';
        
        // Show modal
        document.getElementById('support-user-modal').classList.add('active');
        
    } catch (err) {
        console.error('Error loading support user:', err);
        showToast('Error al cargar datos del usuario', 'error');
    }
}

/**
 * Save support user (create or update)
 */
async function saveSupportUser(event) {
    event.preventDefault();
    
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('Error: Supabase no esta conectado', 'error');
        return;
    }
    
    const userId = document.getElementById('support-user-id').value;
    const fullName = document.getElementById('support-user-name').value.trim();
    const email = document.getElementById('support-user-email').value.trim().toLowerCase();
    const password = document.getElementById('support-user-password').value;
    const role = document.getElementById('support-user-role').value;
    const isActive = document.getElementById('support-user-active').checked;
    
    const isNewUser = !userId;
    
    try {
        if (isNewUser) {
            // Validate password for new users
            if (!password || password.length < 6) {
                showToast('La contrasena debe tener al menos 6 caracteres', 'error');
                return;
            }
            
            // Step 1: Create auth user via Supabase Auth
            const { data: authData, error: authError } = await client.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: fullName,
                        role: 'support_user'
                    }
                }
            });
            
            if (authError) {
                if (authError.message.includes('already registered')) {
                    throw new Error('Este email ya esta registrado en el sistema');
                }
                throw authError;
            }
            
            if (!authData.user) {
                throw new Error('No se pudo crear el usuario de autenticacion');
            }
            
            // Step 2: Insert record in support_users_db
            const { error: insertError } = await client
                .from('support_users_db')
                .insert({
                    user_id: authData.user.id,
                    email: email,
                    full_name: fullName,
                    role: role,
                    is_active: true,
                    created_at: new Date().toISOString()
                });
            
            if (insertError) {
                console.error('Error inserting support user record:', insertError);
                // Try to clean up the auth user if possible
                showToast('Usuario auth creado pero error al guardar datos: ' + insertError.message, 'warning');
            } else {
                showToast('Usuario de soporte creado exitosamente', 'success');
            }
            
        } else {
            // Update existing user
            const newPassword = document.getElementById('support-user-new-password')?.value || '';
            
            // If new password is provided, update it via server endpoint
            if (newPassword) {
                if (newPassword.length < 6) {
                    showToast('La nueva contrasena debe tener al menos 6 caracteres', 'error');
                    return;
                }
                
                // Call server endpoint to update password (keys are read server-side from env)
                const passwordResponse = await fetch('/api/admin/update-user-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: userId,
                        newPassword: newPassword
                    })
                });
                
                const passwordResult = await passwordResponse.json();
                
                if (!passwordResult.success) {
                    throw new Error(passwordResult.error || 'Error al actualizar contrasena');
                }
                
                console.log('Password updated successfully for user:', userId);
            }
            
            // Update user data in support_users_db
            const { error: updateError } = await client
                .from('support_users_db')
                .update({
                    full_name: fullName,
                    role: role,
                    is_active: isActive,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);
            
            if (updateError) throw updateError;
            
            showToast(newPassword ? 'Usuario y contrasena actualizados' : 'Usuario de soporte actualizado', 'success');
        }
        
        // Close modal and refresh list
        closeModal();
        loadSupportUsers();
        
    } catch (err) {
        console.error('Error saving support user:', err);
        showToast('Error: ' + err.message, 'error');
    }
}

/**
 * Toggle support user active status
 */
async function toggleSupportUserStatus(userId, newStatus) {
    const action = newStatus ? 'activar' : 'desactivar';
    if (!confirm(`¿Estas seguro de que quieres ${action} este usuario?`)) {
        return;
    }
    
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('Error: Supabase no esta conectado', 'error');
        return;
    }
    
    try {
        const { error } = await client
            .from('support_users_db')
            .update({
                is_active: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
        
        if (error) throw error;
        
        showToast(`Usuario ${newStatus ? 'activado' : 'desactivado'} correctamente`, 'success');
        loadSupportUsers();
        
    } catch (err) {
        console.error('Error toggling support user status:', err);
        showToast('Error al cambiar estado del usuario', 'error');
    }
}

/**
 * Send password reset email to support user
 */
async function sendPasswordResetEmail() {
    const email = document.getElementById('support-user-email').value.trim();
    
    if (!email) {
        showToast('No se ha especificado el email del usuario', 'error');
        return;
    }
    
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('Error: Supabase no esta conectado', 'error');
        return;
    }
    
    try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/support/login'
        });
        
        if (error) throw error;
        
        showToast(`Email de restablecimiento enviado a ${email}`, 'success');
        
    } catch (err) {
        console.error('Error sending password reset email:', err);
        showToast('Error al enviar email: ' + err.message, 'error');
    }
}

// ============ SUPPORT USERS EXPORTS ============
window.loadSupportUsers = loadSupportUsers;
window.addSupportUser = addSupportUser;
window.editSupportUser = editSupportUser;
window.saveSupportUser = saveSupportUser;
window.toggleSupportUserStatus = toggleSupportUserStatus;
window.sendPasswordResetEmail = sendPasswordResetEmail;

// ============ N8N EVENTS / WEBHOOKS SECTION ============

/**
 * Load n8n events configuration and render the table
 */
async function loadN8NEvents() {
    const tbody = document.getElementById('events-tbody');
    if (!tbody) return;

    showTableLoading('events-tbody', 5);

    try {
        // Wait for ConfigManager to be ready
        if (window.ConfigManager && typeof window.ConfigManager.ready === 'function') {
            await window.ConfigManager.ready();
        }

        // Load events from DB or config
        const events = await window.ConfigManager.getN8NEvents(true); // Force refresh

        if (!events || events.length === 0) {
            showTableEmptyState('events-tbody', 5, 'fa-bolt', 'No hay eventos configurados', 'Configura webhooks de n8n para habilitar automatizaciones.');
            return;
        }

        // Render events table
        tbody.innerHTML = events.map(event => {
            const statusClass = event.enabled ? 'success' : 'error';
            const statusText = event.enabled ? 'Activo' : 'Inactivo';
            const statusIcon = event.enabled ? 'fa-circle-check' : 'fa-circle-xmark';
            const webhookUrlDisplay = event.webhookUrl 
                ? `<code style="font-size: 0.75rem; word-break: break-all;">${escapeHtml(event.webhookUrl)}</code>` 
                : '<span style="opacity: 0.5;">Sin configurar</span>';

            return `
                <tr data-event-id="${event.id}">
                    <td>
                        <strong>${escapeHtml(event.name)}</strong>
                        <br><small style="opacity: 0.6;">${event.id}</small>
                    </td>
                    <td>${escapeHtml(event.description || '-')}</td>
                    <td style="max-width: 300px;">
                        <div class="webhook-url-container">
                            <input type="text" 
                                class="form-input webhook-url-input" 
                                id="webhook-url-${event.id}"
                                value="${escapeHtml(event.webhookUrl || '')}"
                                placeholder="https://n8n.example.com/webhook/..."
                                style="font-size: 0.8rem; padding: 6px 8px;">
                            <button class="btn btn-sm btn-secondary" 
                                onclick="saveEventWebhookUrl('${event.id}')" 
                                title="Guardar URL"
                                style="padding: 6px 8px; margin-left: 4px;">
                                <i class="fa-solid fa-floppy-disk"></i>
                            </button>
                        </div>
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            <i class="fa-solid ${statusIcon}"></i> ${statusText}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <label class="toggle-switch" title="${event.enabled ? 'Desactivar' : 'Activar'}">
                                <input type="checkbox" 
                                    ${event.enabled ? 'checked' : ''} 
                                    onchange="toggleEventEnabled('${event.id}', this.checked)">
                                <span class="toggle-slider"></span>
                            </label>
                            <button class="btn-icon" 
                                onclick="testEventWebhook('${event.id}')" 
                                title="Probar Webhook"
                                ${!event.webhookUrl ? 'disabled' : ''}>
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading n8n events:', err);
        showTableErrorState('events-tbody', 5, 'No se pudieron cargar los eventos.', 'loadN8NEvents()');
        showToast('Error al cargar eventos', 'error');
    }
}

/**
 * Save webhook URL for a specific event
 * @param {string} eventId - The event ID
 */
async function saveEventWebhookUrl(eventId) {
    const input = document.getElementById(`webhook-url-${eventId}`);
    if (!input) return;

    const webhookUrl = input.value.trim();

    // Basic URL validation if not empty
    if (webhookUrl && !webhookUrl.startsWith('http')) {
        showToast('La URL debe comenzar con http:// o https://', 'error');
        return;
    }

    showToast('Guardando...', 'info');

    const result = await window.ConfigManager.updateN8NEvent(eventId, { webhookUrl });

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
    } else {
        showToast('URL de webhook guardada', 'success');
        // Refresh the row to update button states
        loadN8NEvents();
    }
}

/**
 * Toggle event enabled/disabled status
 * @param {string} eventId - The event ID
 * @param {boolean} enabled - New enabled status
 */
async function toggleEventEnabled(eventId, enabled) {
    showToast(enabled ? 'Activando evento...' : 'Desactivando evento...', 'info');

    const result = await window.ConfigManager.updateN8NEvent(eventId, { enabled });

    if (result.error) {
        showToast('Error: ' + result.error, 'error');
        // Revert checkbox
        loadN8NEvents();
    } else {
        showToast(`Evento ${enabled ? 'activado' : 'desactivado'}`, 'success');
        // Refresh to update status badge
        loadN8NEvents();
    }
}

/**
 * Test a webhook by sending a test payload
 * @param {string} eventId - The event ID
 */
async function testEventWebhook(eventId) {
    const event = await window.ConfigManager.getN8NEvent(eventId);

    if (!event) {
        showToast('Evento no encontrado', 'error');
        return;
    }

    if (!event.webhookUrl) {
        showToast('No hay URL de webhook configurada', 'error');
        return;
    }

    showToast('Enviando prueba...', 'info');

    try {
        const testPayload = {
            test: true,
            event_id: eventId,
            event_name: event.name,
            timestamp: new Date().toISOString(),
            source: 'weotzi-admin-test',
            data: {
                message: 'Este es un mensaje de prueba desde el panel de administracion de We Otzi',
                test_field: 'valor_de_prueba'
            }
        };

        const response = await fetch(event.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });

        if (response.ok) {
            showToast('Webhook enviado exitosamente', 'success');
        } else {
            showToast(`Error HTTP ${response.status}: ${response.statusText}`, 'error');
        }
    } catch (err) {
        console.error('Error testing webhook:', err);
        showToast('Error al enviar: ' + err.message, 'error');
    }
}

// ============ N8N EVENTS EXPORTS ============
window.loadN8NEvents = loadN8NEvents;
window.saveEventWebhookUrl = saveEventWebhookUrl;
window.toggleEventEnabled = toggleEventEnabled;
window.testEventWebhook = testEventWebhook;

// ============================================
// CURRENCIES SECTION (Super Admin)
// ============================================

async function loadCurrenciesAdmin() {
    const tbody = document.getElementById('currencies-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8"><div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando monedas...</span></div></td></tr>';

    try {
        if (!supabaseClient) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 16px; opacity: 0.6;">Supabase no inicializado.</td></tr>';
            return;
        }

        const { data: currencies, error } = await supabaseClient
            .from('currencies')
            .select('code,name,symbol,decimals,units_per_usd,units_per_eur,is_active,last_updated_at,source')
            .order('code', { ascending: true });

        if (error) throw error;

        if (!currencies || !currencies.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 16px; opacity: 0.6;">No hay monedas registradas.</td></tr>';
        } else {
            tbody.innerHTML = currencies.map(function (c) {
                const updated = c.last_updated_at
                    ? new Date(c.last_updated_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
                    : '—';
                return '<tr>'
                    + '<td><strong>' + escapeHtml(c.code) + '</strong></td>'
                    + '<td>' + escapeHtml(c.name || '') + '</td>'
                    + '<td>' + escapeHtml(c.symbol || '') + '</td>'
                    + '<td style="font-family: monospace;">' + Number(c.units_per_usd).toFixed(4) + '</td>'
                    + '<td style="font-family: monospace;">' + Number(c.units_per_eur).toFixed(4) + '</td>'
                    + '<td>' + escapeHtml(updated) + '</td>'
                    + '<td>' + escapeHtml(c.source || '—') + '</td>'
                    + '<td>'
                    +   '<label class="switch">'
                    +     '<input type="checkbox" ' + (c.is_active ? 'checked' : '')
                    +       ' onchange="toggleCurrencyActive(\'' + c.code + '\', this.checked)">'
                    +     '<span class="slider"></span>'
                    +   '</label>'
                    + '</td>'
                    + '</tr>';
            }).join('');
        }

        const { data: logs, error: logsErr } = await supabaseClient
            .from('currency_refresh_logs')
            .select('source,status,currencies_updated,error_message,refreshed_at')
            .order('refreshed_at', { ascending: false })
            .limit(10);

        const logsTbody = document.getElementById('currency-refresh-logs-tbody');
        if (!logsTbody) return;
        if (logsErr || !logs || !logs.length) {
            logsTbody.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; opacity: 0.6;">Sin registros aún.</td></tr>';
        } else {
            logsTbody.innerHTML = logs.map(function (l) {
                const when = new Date(l.refreshed_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
                const statusColor = l.status === 'success' ? '#22c55e' : (l.status === 'partial' ? '#F4B942' : '#E23E28');
                return '<tr>'
                    + '<td>' + escapeHtml(when) + '</td>'
                    + '<td>' + escapeHtml(l.source || '—') + '</td>'
                    + '<td><span style="background:' + statusColor + '; color:white; padding:2px 8px; font-size:0.75rem; font-weight:700; text-transform:uppercase; border-radius: 2px;">' + escapeHtml(l.status) + '</span></td>'
                    + '<td>' + (l.currencies_updated || 0) + '</td>'
                    + '<td style="font-family: monospace; font-size: 0.75rem;">' + escapeHtml(l.error_message || '') + '</td>'
                    + '</tr>';
            }).join('');
        }
    } catch (err) {
        console.error('[Admin] loadCurrenciesAdmin failed:', err);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 16px; color: var(--error-color);">Error: ' + escapeHtml(err.message || String(err)) + '</td></tr>';
    }
}

async function toggleCurrencyActive(code, isActive) {
    try {
        if (!supabaseClient) throw new Error('Supabase no inicializado');
        const { error } = await supabaseClient
            .from('currencies')
            .update({ is_active: !!isActive })
            .eq('code', code);
        if (error) throw error;
        showToast('Moneda ' + code + (isActive ? ' activada' : ' desactivada'), 'success');
    } catch (err) {
        console.error('[Admin] toggleCurrencyActive failed:', err);
        showToast('Error: ' + err.message, 'error');
        loadCurrenciesAdmin();
    }
}

async function refreshCurrenciesNow() {
    const btn = document.getElementById('btn-refresh-currencies-now');
    const tokenKey = 'weotzi_admin_cron_token';
    let token = '';
    try { token = localStorage.getItem(tokenKey) || ''; } catch (e) { /* ignore */ }
    if (!token) {
        token = prompt('Ingresa el CRON_API_TOKEN (se guarda en localStorage para futuros usos):') || '';
        if (!token) return;
        try { localStorage.setItem(tokenKey, token); } catch (e) { /* ignore */ }
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refrescando...'; }
    try {
        const response = await fetch('/api/admin/currencies/refresh-now', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cron-Token': token
            },
            body: '{}'
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (response.status === 401) {
                try { localStorage.removeItem(tokenKey); } catch (e) { /* ignore */ }
            }
            throw new Error(data.error || ('HTTP ' + response.status));
        }
        showToast('Tipos de cambio actualizados (' + data.upserted + ' monedas)', 'success');
        await loadCurrenciesAdmin();
    } catch (err) {
        console.error('[Admin] refreshCurrenciesNow failed:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refrescar ahora'; }
    }
}

window.loadCurrenciesAdmin = loadCurrenciesAdmin;
window.toggleCurrencyActive = toggleCurrencyActive;
window.refreshCurrenciesNow = refreshCurrenciesNow;

// ============ APP CONTENT EXPORTS ============
window.loadAppContent = loadAppContent;
window.saveNextStepsContent = saveNextStepsContent;
window.saveWebsiteUrl = saveWebsiteUrl;
window.loadAIProfileSettings = loadAIProfileSettings;
window.saveAIProfileSettings = saveAIProfileSettings;
window.initContentSection = initContentSection;

// ============ SUPER ADMIN EXPORTS ============
window.refreshServiceHealth = refreshServiceHealth;
window.loadAPIsSection = loadAPIsSection;
window.testSupabaseAPI = testSupabaseAPI;
window.saveSupabaseAPI = saveSupabaseAPI;
window.testN8NAPI = testN8NAPI;
window.saveN8NAPI = saveN8NAPI;
window.testEmailJSAPI = testEmailJSAPI;
window.saveEmailJSAPI = saveEmailJSAPI;
window.testGoogleMapsAPI = testGoogleMapsAPI;
window.saveGoogleMapsAPI = saveGoogleMapsAPI;
window.testGoogleCalendarAPI = testGoogleCalendarAPI;
window.saveGoogleCalendarAPI = saveGoogleCalendarAPI;
window.testGoogleDriveAPI = testGoogleDriveAPI;
window.saveGoogleDriveAPI = saveGoogleDriveAPI;
window.testGeminiAPI = testGeminiAPI;
window.saveGeminiAPI = saveGeminiAPI;
window.testAllConnections = testAllConnections;

window.generateBodyPartIcon = generateBodyPartIcon;
window.generateAllBodyPartIcons = generateAllBodyPartIcons;

window.loadDatabaseSection = loadDatabaseSection;
window.loadDatabaseStats = loadDatabaseStats;
window.inspectTable = inspectTable;
window.exportTable = exportTable;
window.exportTableJSON = exportTableJSON;
window.exportTableCSV = exportTableCSV;
window.exportAllTables = exportAllTables;
window.filterTableInspector = filterTableInspector;
window.updateColFilter = updateColFilter;
window.sortTableInspector = sortTableInspector;
window.startInlineEdit = startInlineEdit;
window.saveInlineEdit = saveInlineEdit;
window.cancelInlineEdit = cancelInlineEdit;
window.exportFilteredCSV = exportFilteredCSV;
window.goToInspectorPage = goToInspectorPage;

window.loadRoutesSection = loadRoutesSection;
window.loadRoutesConfig = loadRoutesConfig;
window.testRoute = testRoute;
window.testAllRoutes = testAllRoutes;
window.editRoute = editRoute;
window.saveRouteEdit = saveRouteEdit;

window.loadBackupSection = loadBackupSection;
window.createFullBackup = createFullBackup;
window.createSelectiveBackup = createSelectiveBackup;
window.createConfigBackup = createConfigBackup;
window.restoreConfig = restoreConfig;
window.handleRestore = handleRestore;

// ============ ANALYTICS SECTION ============

let analyticsCharts = {};

// Chart.js global defaults for dark theme
function configureChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.borderColor = '#2a2a2a';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
}

async function loadAnalyticsData() {
    configureChartDefaults();

    const period = document.getElementById('analytics-period')?.value || '30d';

    // Try to fetch real data from individual API endpoints, fall back to mock
    let data = {};
    let usedMock = false;

    try {
        const endpoints = [
            fetch(`/api/analytics/users?period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/analytics/devices?period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/analytics/locations?period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/analytics/pages?period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/analytics/errors?period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null)
        ];

        const [users, devices, locations, pages, errors] = await Promise.all(endpoints);

        if (users) {
            data.totalUsers = users.totalUsers;
            data.newUsersThisMonth = users.newUsersThisMonth;
            data.activeSessions = users.activeSessions;
            data.usersTimeline = users.timeline;
        }
        if (devices) data.devices = devices;
        if (locations) data.countries = locations.countries;
        if (pages) data.topPages = pages;
        if (errors) {
            data.errorSessions = errors.totalErrorSessions;
            data.errors = errors.items;
        }
    } catch (e) {
        // API not available yet
    }

    // Fill any missing data with mock
    if (!data.totalUsers) {
        usedMock = true;
        const mock = generateMockAnalyticsData(period);
        data = { ...mock, ...data };
        Object.keys(mock).forEach(k => { if (data[k] === undefined) data[k] = mock[k]; });
    }

    // Update metric cards
    document.getElementById('analytics-total-users').textContent = (data.totalUsers || 0).toLocaleString();
    document.getElementById('analytics-new-users').textContent = (data.newUsersThisMonth || 0).toLocaleString();
    document.getElementById('analytics-active-sessions').textContent = (data.activeSessions || 0).toLocaleString();
    document.getElementById('analytics-error-sessions').textContent = (data.errorSessions || 0).toLocaleString();
    document.getElementById('analytics-error-badge').textContent = data.errorSessions || 0;

    // Render charts
    renderUsersTimelineChart(data.usersTimeline);
    renderDevicesChart(data.devices);
    renderCountriesChart(data.countries);
    renderPagesTable(data.topPages);
    renderErrorsTable(data.errors);

    if (usedMock) {
        showToast('Mostrando datos de ejemplo. Los endpoints de Analytics aun no estan disponibles.', 'info');
    }
}

function generateMockAnalyticsData(period) {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    // Generate timeline labels based on real session_logs data patterns
    const labels = [];
    const clientsData = [];
    const artistsData = [];
    for (let i = days; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
        // Realistic distribution: ~1.3% clients, ~15% artists from 1046 sessions over ~54 days
        clientsData.push(Math.floor(Math.random() * 2));
        artistsData.push(Math.floor(Math.random() * 4) + 1);
    }

    return {
        totalUsers: 55,
        newUsersThisMonth: 14,
        activeSessions: 1046,
        errorSessions: 79,
        usersTimeline: { labels, clients: clientsData, artists: artistsData },
        devices: { mobile: 21, desktop: 79, tablet: 0 },
        countries: [
            { name: 'Mexico', count: 28 },
            { name: 'Colombia', count: 9 },
            { name: 'Argentina', count: 6 },
            { name: 'Espana', count: 5 },
            { name: 'Estados Unidos', count: 4 },
            { name: 'Chile', count: 2 },
            { name: 'Peru', count: 1 }
        ],
        topPages: [
            { url: '/artist/dashboard', visits: 273, pct: 26.1 },
            { url: '/artist/profile', visits: 181, pct: 17.3 },
            { url: '/registerclosedbeta', visits: 163, pct: 15.6 },
            { url: '/quotation', visits: 140, pct: 13.4 },
            { url: '/job-board', visits: 98, pct: 9.4 },
            { url: '/marketplace', visits: 76, pct: 7.3 },
            { url: '/client/dashboard', visits: 62, pct: 5.9 },
            { url: '/', visits: 53, pct: 5.1 }
        ],
        errors: [
            { page: '/artist/dashboard', error: 'TypeError: Cannot read properties of null (reading style)', count: 23, lastSeen: '2026-03-28' },
            { page: '/quotation', error: 'Failed to fetch: NetworkError when attempting to fetch resource', count: 18, lastSeen: '2026-03-28' },
            { page: '/registerclosedbeta', error: 'ReferenceError: supabase is not defined', count: 15, lastSeen: '2026-03-27' },
            { page: '/job-board', error: 'TypeError: feedContainer is null', count: 12, lastSeen: '2026-03-27' },
            { page: '/marketplace', error: 'Supabase: relation "marketplace_listings" does not exist', count: 11, lastSeen: '2026-03-26' }
        ]
    };
}

function renderUsersTimelineChart(timeline) {
    if (!window.Chart) return;
    const ctx = document.getElementById('chart-users-timeline');
    if (!ctx) return;

    if (analyticsCharts.usersTimeline) analyticsCharts.usersTimeline.destroy();

    analyticsCharts.usersTimeline = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeline.labels,
            datasets: [
                {
                    label: 'Clientes',
                    data: timeline.clients,
                    borderColor: '#FFD700',
                    backgroundColor: 'rgba(255, 215, 0, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    borderWidth: 2
                },
                {
                    label: 'Artistas',
                    data: timeline.artists,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    borderWidth: 2
                }
            ]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 10 }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1a1a1a',
                    titleColor: '#fff',
                    bodyColor: '#9ca3af',
                    borderColor: '#2a2a2a',
                    borderWidth: 1
                }
            },
            interaction: { mode: 'index', intersect: false }
        }
    });
}

function renderDevicesChart(devices) {
    if (!window.Chart) return;
    const ctx = document.getElementById('chart-devices');
    if (!ctx) return;

    if (analyticsCharts.devices) analyticsCharts.devices.destroy();

    analyticsCharts.devices = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Movil', 'Desktop', 'Tablet'],
            datasets: [{
                data: [devices.mobile, devices.desktop, devices.tablet],
                backgroundColor: ['#FFD700', '#3b82f6', '#a855f7'],
                borderColor: '#1a1a1a',
                borderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            cutout: '65%',
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        padding: 16,
                        usePointStyle: true,
                        pointStyleWidth: 10
                    }
                },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#fff',
                    bodyColor: '#9ca3af',
                    borderColor: '#2a2a2a',
                    borderWidth: 1,
                    callbacks: {
                        label: function(ctx) {
                            return ` ${ctx.label}: ${ctx.parsed}%`;
                        }
                    }
                }
            }
        }
    });
}

function renderCountriesChart(countries) {
    if (!window.Chart) return;
    const ctx = document.getElementById('chart-countries');
    if (!ctx) return;

    if (analyticsCharts.countries) analyticsCharts.countries.destroy();

    const top8 = countries.slice(0, 8);

    analyticsCharts.countries = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top8.map(c => c.name),
            datasets: [{
                data: top8.map(c => c.count),
                backgroundColor: 'rgba(255, 215, 0, 0.6)',
                borderColor: '#FFD700',
                borderWidth: 1,
                borderRadius: 4,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#fff',
                    bodyColor: '#9ca3af',
                    borderColor: '#2a2a2a',
                    borderWidth: 1,
                    callbacks: {
                        label: function(ctx) {
                            return ` ${ctx.parsed.x} usuarios`;
                        }
                    }
                }
            }
        }
    });
}

function renderPagesTable(pages) {
    const tbody = document.getElementById('analytics-pages-tbody');
    if (!tbody) return;

    if (!pages || pages.length === 0) {
        showTableEmptyState('analytics-pages-tbody', 3, 'fa-file', 'Sin datos de paginas', 'Los datos apareceran cuando haya visitas registradas.');
        return;
    }

    const maxVisits = Math.max(...pages.map(p => p.visits));

    tbody.innerHTML = pages.map(p => `
        <tr>
            <td class="page-url">${escapeHtml(p.url)}</td>
            <td>
                <div class="visit-bar">
                    <div class="visit-bar-fill" style="width: ${(p.visits / maxVisits) * 100}px;"></div>
                    <span>${p.visits.toLocaleString()}</span>
                </div>
            </td>
            <td>${p.pct}%</td>
        </tr>
    `).join('');
}

function renderErrorsTable(errors) {
    const tbody = document.getElementById('analytics-errors-tbody');
    if (!tbody) return;

    if (!errors || errors.length === 0) {
        showTableEmptyState('analytics-errors-tbody', 4, 'fa-circle-check', 'Sin errores registrados', 'No se han detectado errores en el periodo seleccionado.');
        return;
    }

    tbody.innerHTML = errors.map(e => `
        <tr>
            <td class="page-url">${escapeHtml(e.page)}</td>
            <td class="error-msg" title="${escapeHtml(e.error)}">${escapeHtml(e.error)}</td>
            <td><span class="badge" style="background: rgba(239,68,68,0.15); color: var(--error-color);">${e.count}</span></td>
            <td>${e.lastSeen}</td>
        </tr>
    `).join('');
}

window.loadAnalyticsData = loadAnalyticsData;

// ============ SUPABASE REALTIME — DASHBOARD ACTIVITY FEED ============

const _realtimeChannels = [];
const _realtimeEvents = [];
const MAX_REALTIME_EVENTS = 50;

function initRealtimeSubscriptions() {
    if (!supabaseClient) return;

    cleanupRealtimeSubscriptions();

    // Channel: new/updated quotations
    const quotationsChannel = supabaseClient
        .channel('dashboard-quotations')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quotations_db' }, (payload) => {
            const q = payload.new;
            pushRealtimeEvent({
                type: 'quotation_new',
                icon: 'fa-file-invoice',
                color: '#8b5cf6',
                title: 'Nueva cotizacion',
                detail: `${q.client_full_name || 'Cliente'} — ${q.quote_id || ''}`,
                timestamp: q.created_at || new Date().toISOString()
            });
            refreshStatValue('stat-total', 1);
            refreshStatValue('stat-pending-artist', 1);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quotations_db' }, (payload) => {
            const q = payload.new;
            const oldStatus = payload.old?.quote_status;
            const newStatus = q.quote_status;
            if (oldStatus === newStatus) return;

            const statusLabels = {
                'pending': 'Pendiente',
                'responded': 'Respondida',
                'client_approved': 'Aprobada por cliente',
                'client_rejected': 'Rechazada por cliente',
                'in_progress': 'En progreso',
                'completed': 'Completada'
            };

            pushRealtimeEvent({
                type: 'quotation_status',
                icon: 'fa-arrow-right-arrow-left',
                color: '#f59e0b',
                title: `Cotizacion ${q.quote_id || ''} cambio de estado`,
                detail: `${statusLabels[oldStatus] || oldStatus} → ${statusLabels[newStatus] || newStatus}`,
                timestamp: new Date().toISOString()
            });
            loadDashboardStats();
        })
        .subscribe();

    _realtimeChannels.push(quotationsChannel);

    // Channel: new artists
    const artistsChannel = supabaseClient
        .channel('dashboard-artists')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'artists_db' }, (payload) => {
            const a = payload.new;
            pushRealtimeEvent({
                type: 'artist_new',
                icon: 'fa-palette',
                color: '#3ecf8e',
                title: 'Nuevo artista registrado',
                detail: a.artist_name || a.email || 'Artista',
                timestamp: a.created_at || new Date().toISOString()
            });
            refreshStatValue('stat-artists', 1);
        })
        .subscribe();

    _realtimeChannels.push(artistsChannel);

    // Channel: job board applications
    const applicationsChannel = supabaseClient
        .channel('dashboard-applications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_board_applications' }, (payload) => {
            const app = payload.new;
            pushRealtimeEvent({
                type: 'application_new',
                icon: 'fa-paper-plane',
                color: '#3b82f6',
                title: 'Nueva postulacion al Job Board',
                detail: `Artista postulo a solicitud ${app.request_id || ''}`,
                timestamp: app.created_at || new Date().toISOString()
            });
        })
        .subscribe();

    _realtimeChannels.push(applicationsChannel);

    // Show live indicator
    const indicator = document.getElementById('realtime-indicator');
    if (indicator) indicator.style.display = '';
}

function cleanupRealtimeSubscriptions() {
    if (!supabaseClient) return;
    for (const channel of _realtimeChannels) {
        supabaseClient.removeChannel(channel);
    }
    _realtimeChannels.length = 0;

    const indicator = document.getElementById('realtime-indicator');
    if (indicator) indicator.style.display = 'none';
}

function pushRealtimeEvent(event) {
    _realtimeEvents.unshift(event);
    if (_realtimeEvents.length > MAX_REALTIME_EVENTS) {
        _realtimeEvents.length = MAX_REALTIME_EVENTS;
    }
    renderRealtimeFeed();
}

function renderRealtimeFeed() {
    const feed = document.getElementById('realtime-feed');
    if (!feed) return;

    if (_realtimeEvents.length === 0) {
        feed.innerHTML = `
            <div class="empty-state-box" style="padding: 24px;">
                <i class="fa-solid fa-satellite-dish"></i>
                <span class="empty-title">Esperando actividad...</span>
                <span class="empty-desc">Los eventos apareceran aqui en tiempo real.</span>
            </div>
        `;
        return;
    }

    feed.innerHTML = _realtimeEvents.slice(0, 15).map(evt => {
        const time = formatRelativeTime(evt.timestamp);
        return `
            <div class="realtime-event realtime-event--new">
                <div class="realtime-event-icon" style="color: ${evt.color};">
                    <i class="fa-solid ${evt.icon}"></i>
                </div>
                <div class="realtime-event-body">
                    <span class="realtime-event-title">${escapeHtml(evt.title)}</span>
                    <span class="realtime-event-detail">${escapeHtml(evt.detail)}</span>
                </div>
                <span class="realtime-event-time">${time}</span>
            </div>
        `;
    }).join('');

    // Trigger entry animation on newest item
    const firstEvent = feed.querySelector('.realtime-event--new');
    if (firstEvent) {
        requestAnimationFrame(() => {
            firstEvent.classList.remove('realtime-event--new');
        });
    }
}

function formatRelativeTime(isoString) {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 5) return 'ahora';
    if (diffSec < 60) return `hace ${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `hace ${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `hace ${diffHr}h`;
    return new Date(isoString).toLocaleDateString('es');
}

function refreshStatValue(elementId, increment) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    el.textContent = current + increment;
}

// ============ ARTIST PROFILE MODAL ============

async function openArtistProfile(artistId) {
    const artist = allArtistsUnfiltered.find(a => a.id === artistId || a.user_id === artistId);
    if (!artist) { showToast('Artista no encontrado', 'error'); return; }

    const overlay = document.getElementById('artist-profile-overlay');
    const content = document.getElementById('artist-profile-content');
    if (!overlay || !content) return;

    // Fetch artist index from API
    let artistIndex = null;
    try {
        const res = await fetch(`/api/artists/index?artist_id=${artist.user_id}`);
        if (res.ok) artistIndex = await res.json();
    } catch (e) { console.warn('Could not fetch artist index:', e); }

    // Fetch locations
    let locations = [];
    if (supabaseClient) {
        try {
            const { data } = await supabaseClient.from('artist_tattoo_locations').select('*').eq('artist_user_id', artist.user_id).order('sort_order');
            locations = data || [];
        } catch (e) { /* optional */ }
    }

    // Fetch quotation stats
    let totalQuotes = 0, completedQuotes = 0;
    if (supabaseClient) {
        try {
            const { count: tq } = await supabaseClient.from('quotations_db').select('*', { count: 'exact', head: true }).eq('artist_id', artist.user_id);
            totalQuotes = tq || 0;
            const { count: cq } = await supabaseClient.from('quotations_db').select('*', { count: 'exact', head: true }).eq('artist_id', artist.user_id).eq('quote_status', 'completed');
            completedQuotes = cq || 0;
        } catch (e) { /* optional */ }
    }

    const styles = Array.isArray(artist.styles_array) ? artist.styles_array : [];
    const idx = artistIndex?.artist_index || artist.artist_index || 0;
    const breakdown = artistIndex?.breakdown || {};

    const verifMap = {
        'verified': { label: 'Verificado', cls: 'badge-success' },
        'approved': { label: 'Aprobado', cls: 'badge-success' },
        'pending': { label: 'Pendiente', cls: 'badge-warning' },
        'pending_review': { label: 'En revision', cls: 'badge-info' },
        'rejected': { label: 'Rechazado', cls: 'badge-danger' }
    };
    const vs = verifMap[artist.verification_state] || { label: artist.verification_state || '—', cls: 'badge-secondary' };

    content.innerHTML = `
        <div class="artist-profile-header">
            <button class="artist-profile-close" onclick="closeArtistProfile()"><i class="fa-solid fa-xmark"></i></button>
            <div class="artist-profile-avatar">
                ${artist.profile_photo ? `<img src="${artist.profile_photo}" alt="${escapeHtml(artist.name)}">` : `<i class="fa-solid fa-user"></i>`}
            </div>
            <div class="artist-profile-info">
                <h2>${escapeHtml(artist.name || '—')}</h2>
                <p>@${escapeHtml(artist.username || '—')} ${artist.current_city ? '&bull; ' + escapeHtml(artist.current_city) : ''} ${artist.country ? '&bull; ' + escapeHtml(artist.country) : ''}</p>
                <span class="badge ${vs.cls}">${vs.label}</span>
            </div>
        </div>
        <div class="artist-profile-stats-row">
            <div class="artist-profile-stat"><strong>${idx}</strong><span>Index</span></div>
            <div class="artist-profile-stat"><strong>${totalQuotes}</strong><span>Cotizaciones</span></div>
            <div class="artist-profile-stat"><strong>${completedQuotes}</strong><span>Completadas</span></div>
            <div class="artist-profile-stat"><strong>${artist.session_cost || '—'}</strong><span>Precio/Sesion</span></div>
        </div>
        <div class="artist-profile-data-grid">
            <div><label>Email</label><span>${escapeHtml(artist.email) || '—'}</span></div>
            <div><label>Instagram</label><span>${escapeHtml(artist.instagram) || '—'}</span></div>
            <div><label>Telefono</label><span>${escapeHtml(artist.phone) || '—'}</span></div>
            <div><label>Estudio</label><span>${escapeHtml(artist.studio_name) || '—'}</span></div>
        </div>
        ${artist.bio ? `<div class="artist-profile-bio"><h4>Bio</h4><p>${escapeHtml(artist.bio)}</p></div>` : ''}
        <div class="artist-profile-tags"><h4>Estilos</h4>${styles.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('') || '<span class="text-muted">Sin estilos</span>'}</div>
        ${locations.length > 0 ? `
        <div class="profile-locations"><h4>Ubicaciones</h4>
            ${locations.map(l => `<div class="profile-location-item">
                <strong>${escapeHtml(l.city) || '—'}</strong> ${l.studio_name ? '(' + escapeHtml(l.studio_name) + ')' : ''}
                <span class="badge ${l.period_type === 'current' ? 'badge-info' : 'badge-warning'}">${l.period_type === 'current' ? 'Actual' : 'Proximo'}</span>
                <span class="location-agenda ${l.agenda_status}">${l.agenda_status === 'open' ? 'Agenda abierta' : 'Agenda cerrada'}</span>
                ${l.start_date ? `<span class="location-dates">${l.start_date}${l.end_date ? ' - ' + l.end_date : ''}</span>` : ''}
            </div>`).join('')}
        </div>` : ''}
        <div class="artist-profile-index-section"><h4>Artist Index: ${idx}/100</h4>
            <div class="index-bar-row"><span>Perfil</span><div class="index-bar"><div class="index-bar-fill" style="width:${breakdown.profile || 0}%"></div></div><span>${breakdown.profile || 0}%</span></div>
            <div class="index-bar-row"><span>Respuesta</span><div class="index-bar"><div class="index-bar-fill" style="width:${breakdown.responseTime || 0}%"></div></div><span>${breakdown.responseTime || 0}%</span></div>
            <div class="index-bar-row"><span>Rating</span><div class="index-bar"><div class="index-bar-fill" style="width:${breakdown.rating || 0}%"></div></div><span>${breakdown.rating || 0}%</span></div>
            <div class="index-bar-row"><span>Conversion</span><div class="index-bar"><div class="index-bar-fill" style="width:${breakdown.conversion || 0}%"></div></div><span>${breakdown.conversion || 0}%</span></div>
        </div>
        <div class="artist-profile-actions">
            <button class="btn btn-primary btn-sm" onclick="verifyFromProfile('${artist.user_id}')"><i class="fa-solid fa-check-circle"></i> Verificar</button>
            <button class="btn btn-secondary btn-sm" onclick="editArtist('${artist.id}');closeArtistProfile()"><i class="fa-solid fa-pen"></i> Editar</button>
        </div>
    `;

    overlay.classList.add('active');
}

function closeArtistProfile() {
    const overlay = document.getElementById('artist-profile-overlay');
    if (overlay) overlay.classList.remove('active');
}

async function verifyFromProfile(artistId) {
    if (!confirm('Aprobar verificacion de este artista?')) return;
    if (!supabaseClient) { showToast('Sin conexion a Supabase', 'error'); return; }
    try {
        const { error } = await supabaseClient.from('artists_db').update({ verification_state: 'verified' }).eq('user_id', artistId);
        if (error) throw error;
        showToast('Artista verificado', 'success');
        closeArtistProfile();
        loadArtists();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ============ VERIFICATION QUEUE ============

async function loadVerificationQueue() {
    const container = document.getElementById('verification-queue');
    if (!container) return;
    if (!supabaseClient) { container.innerHTML = '<div class="empty-state-box" style="padding:32px;"><i class="fa-solid fa-plug"></i><span class="empty-title">Sin conexion a Supabase</span></div>'; return; }

    const filterStatus = document.getElementById('verification-filter-status')?.value || 'pending';

    container.innerHTML = '<div class="empty-state-box" style="padding:32px;"><div class="spinner"></div><span class="empty-title">Cargando...</span></div>';

    try {
        let query = supabaseClient.from('artists_db').select('user_id, name, username, email, ubicacion, verification_state, profile_picture, styles_array, country, city').order('name', { ascending: true });
        if (filterStatus !== 'all') {
            if (filterStatus === 'pending') query = query.in('verification_state', ['pending', 'pending_review']);
            else query = query.eq('verification_state', filterStatus);
        }
        const { data, error } = await query;
        if (error) throw error;

        const artists = data || [];

        // Update stats
        const pending = artists.filter(a => a.verification_state === 'pending' || a.verification_state === 'pending_review').length;
        const approved = artists.filter(a => a.verification_state === 'verified' || a.verification_state === 'approved').length;
        const rejected = artists.filter(a => a.verification_state === 'rejected').length;
        document.getElementById('verif-stat-pending').textContent = filterStatus === 'all' ? pending : (filterStatus === 'pending' ? artists.length : pending);
        document.getElementById('verif-stat-approved').textContent = filterStatus === 'all' ? approved : (filterStatus === 'verified' ? artists.length : approved);
        document.getElementById('verif-stat-rejected').textContent = filterStatus === 'all' ? rejected : (filterStatus === 'rejected' ? artists.length : rejected);

        if (artists.length === 0) {
            container.innerHTML = '<div class="empty-state-box" style="padding:32px;"><i class="fa-solid fa-check-circle"></i><span class="empty-title">No hay verificaciones pendientes</span></div>';
            return;
        }

        container.innerHTML = artists.map(a => {
            const vs = a.verification_state || 'pending';
            const verifMap = { 'verified': 'badge-success', 'approved': 'badge-success', 'pending': 'badge-warning', 'pending_review': 'badge-info', 'rejected': 'badge-danger' };
            const styles = typeof a.styles_array === 'string' ? JSON.parse(a.styles_array) : (a.styles_array || []);

            return `<div class="verification-card" style="display:flex;gap:16px;align-items:center;padding:16px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:12px;background:var(--bg-secondary,#1a1a1a);">
                <div style="width:48px;height:48px;border-radius:50%;background:var(--bg-color);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                    ${a.profile_picture ? `<img src="${a.profile_picture}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-user" style="font-size:1.2rem;color:var(--text-muted);"></i>'}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <strong>${escapeHtml(a.name || '—')}</strong>
                        <span class="badge ${verifMap[vs] || 'badge-secondary'}" style="font-size:0.7rem;">${vs}</span>
                    </div>
                    <div style="font-size:0.82rem;color:var(--text-secondary);">@${escapeHtml(a.username || '—')} &bull; ${escapeHtml(a.ubicacion || '—')} &bull; ${escapeHtml(a.email || '—')}</div>
                    <div style="margin-top:4px;">${styles.slice(0, 3).map(s => `<span class="tag" style="font-size:0.7rem;">${escapeHtml(s)}</span>`).join(' ')}</div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                    ${vs !== 'verified' && vs !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="approveVerification('${a.user_id}')"><i class="fa-solid fa-check"></i></button>` : ''}
                    ${vs !== 'rejected' ? `<button class="btn btn-secondary btn-sm" style="color:#ef4444;" onclick="rejectVerification('${a.user_id}')"><i class="fa-solid fa-xmark"></i></button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="openArtistProfile('${a.user_id}')"><i class="fa-solid fa-eye"></i></button>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        showToast('Error: ' + err.message, 'error');
        container.innerHTML = '<div class="empty-state-box" style="padding:32px;"><i class="fa-solid fa-triangle-exclamation"></i><span class="empty-title">Error cargando verificaciones</span></div>';
    }
}

async function approveVerification(userId) {
    if (!confirm('Aprobar verificacion de este artista?')) return;
    if (!supabaseClient) return;
    try {
        const { error } = await supabaseClient.from('artists_db').update({ verification_state: 'verified' }).eq('user_id', userId);
        if (error) throw error;
        showToast('Artista verificado', 'success');
        loadVerificationQueue();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function rejectVerification(userId) {
    if (!confirm('Rechazar verificacion de este artista?')) return;
    if (!supabaseClient) return;
    try {
        const { error } = await supabaseClient.from('artists_db').update({ verification_state: 'rejected' }).eq('user_id', userId);
        if (error) throw error;
        showToast('Verificacion rechazada', 'success');
        loadVerificationQueue();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ============ SUPPORT TICKETS SECTION (#27) ============

async function loadSupportTickets() {
    if (!supabaseClient) { showToast('Sin conexion a Supabase', 'error'); return; }

    try {
        const { data, error } = await supabaseClient
            .from('feedback_tickets')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;

        allTickets = data || [];
        updateTicketStats();
        populateAgentFilter();
        applyTicketFilters();
        renderTicketMetrics();
        initTicketRealtimeSubscriptions();
    } catch (err) {
        showToast('Error cargando tickets: ' + err.message, 'error');
    }
}

function updateTicketStats() {
    const critical = allTickets.filter(t => t.ticket_priority === 'critical').length;
    const open = allTickets.filter(t => t.status === 'open').length;
    const inProgress = allTickets.filter(t => t.status === 'in_progress').length;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const resolved = allTickets.filter(t => (t.status === 'resolved' || t.status === 'closed') && t.updated_at >= thirtyDaysAgo).length;

    document.getElementById('ticket-stat-critical').textContent = critical;
    document.getElementById('ticket-stat-open').textContent = open;
    document.getElementById('ticket-stat-progress').textContent = inProgress;
    document.getElementById('ticket-stat-resolved').textContent = resolved;
}

function populateAgentFilter() {
    const select = document.getElementById('ticket-filter-agent');
    if (!select) return;
    const agents = [...new Set(allTickets.map(t => t.assigned_to).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = '<option value="">Todos los agentes</option><option value="unassigned">Sin asignar</option>' +
        agents.map(a => `<option value="${a}">${a}</option>`).join('');
    select.value = current;
}

function applyTicketFilters() {
    const statusF = document.getElementById('ticket-filter-status')?.value || '';
    const categoryF = document.getElementById('ticket-filter-category')?.value || '';
    const priorityF = document.getElementById('ticket-filter-priority')?.value || '';
    const agentF = document.getElementById('ticket-filter-agent')?.value || '';

    filteredTickets = allTickets.filter(t => {
        if (statusF && t.status !== statusF) return false;
        if (categoryF && t.ticket_category !== categoryF) return false;
        if (priorityF && t.ticket_priority !== priorityF) return false;
        if (agentF === 'unassigned' && t.assigned_to) return false;
        if (agentF && agentF !== 'unassigned' && t.assigned_to !== agentF) return false;
        return true;
    });

    renderTicketsList();
}

function clearTicketFilters() {
    ['ticket-filter-status', 'ticket-filter-category', 'ticket-filter-priority', 'ticket-filter-agent'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    applyTicketFilters();
}

function renderTicketsList() {
    const container = document.getElementById('tickets-list');
    if (!container) return;

    if (filteredTickets.length === 0) {
        container.innerHTML = '<div class="empty-state-box" style="padding:32px;"><i class="fa-solid fa-ticket"></i><span class="empty-title">No hay tickets</span></div>';
        return;
    }

    const priorityColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };

    container.innerHTML = filteredTickets.map(t => {
        const isActive = t.id === currentTicketId ? ' active' : '';
        const pColor = priorityColors[t.ticket_priority] || '#6b7280';
        const date = t.created_at ? new Date(t.created_at).toLocaleDateString('es') : '—';

        return `<div class="ticket-item${isActive}" onclick="selectTicket('${t.id}')" style="border-left:3px solid ${pColor};">
            <div class="ticket-item-header">
                <strong class="ticket-item-subject">${escapeHtml(t.subject || 'Sin asunto')}</strong>
                <span class="badge badge-sm ${t.status === 'open' ? 'badge-warning' : (t.status === 'resolved' ? 'badge-success' : 'badge-info')}">${t.status}</span>
            </div>
            <div class="ticket-item-meta">
                <span>${escapeHtml(t.ticket_category || '—')}</span>
                <span>${date}</span>
                ${t.assigned_to ? `<span><i class="fa-solid fa-user"></i> ${escapeHtml(t.assigned_to)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function selectTicket(ticketId) {
    currentTicketId = ticketId;
    renderTicketsList(); // re-render to update active state

    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const panel = document.getElementById('ticket-detail-panel');
    if (!panel) return;

    // Load comments
    let comments = [];
    if (supabaseClient) {
        try {
            const { data } = await supabaseClient.from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
            comments = data || [];
        } catch (e) { /* optional */ }
    }

    const pMap = { critical: 'Critica', high: 'Alta', medium: 'Media', low: 'Baja' };

    panel.innerHTML = `
        <div class="ticket-detail-header">
            <h3>${escapeHtml(ticket.subject || 'Sin asunto')}</h3>
            <span class="badge ${ticket.status === 'open' ? 'badge-warning' : (ticket.status === 'resolved' ? 'badge-success' : 'badge-info')}">${ticket.status}</span>
        </div>
        <div class="ticket-detail-meta" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0;font-size:0.85rem;">
            <div><label style="color:var(--text-muted);">Prioridad</label><br><strong>${pMap[ticket.ticket_priority] || ticket.ticket_priority || '—'}</strong></div>
            <div><label style="color:var(--text-muted);">Categoria</label><br><strong>${escapeHtml(ticket.ticket_category || '—')}</strong></div>
            <div><label style="color:var(--text-muted);">Creado</label><br>${ticket.created_at ? new Date(ticket.created_at).toLocaleString('es') : '—'}</div>
            <div><label style="color:var(--text-muted);">Asignado a</label><br>${ticket.assigned_to ? escapeHtml(ticket.assigned_to) : '<em>Sin asignar</em>'}</div>
        </div>
        ${ticket.description ? `<div style="padding:12px;background:var(--bg-color);border-radius:6px;margin-bottom:12px;font-size:0.9rem;">${escapeHtml(ticket.description)}</div>` : ''}
        <div class="ticket-detail-actions" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
            <select onchange="updateTicketField('${ticketId}','status',this.value)" style="padding:6px 10px;font-size:0.8rem;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);">
                <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Abierto</option>
                <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>En progreso</option>
                <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resuelto</option>
                <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Cerrado</option>
            </select>
            <select onchange="updateTicketField('${ticketId}','ticket_priority',this.value)" style="padding:6px 10px;font-size:0.8rem;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);">
                <option value="critical" ${ticket.ticket_priority === 'critical' ? 'selected' : ''}>Critica</option>
                <option value="high" ${ticket.ticket_priority === 'high' ? 'selected' : ''}>Alta</option>
                <option value="medium" ${ticket.ticket_priority === 'medium' ? 'selected' : ''}>Media</option>
                <option value="low" ${ticket.ticket_priority === 'low' ? 'selected' : ''}>Baja</option>
            </select>
            <input type="text" placeholder="Asignar a..." value="${escapeHtml(ticket.assigned_to) || ''}" onchange="updateTicketField('${ticketId}','assigned_to',this.value)" style="padding:6px 10px;font-size:0.8rem;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);width:140px;">
        </div>
        <div class="ticket-comments-section">
            <h4 style="margin:0 0 12px;font-size:0.9rem;">Comentarios (${comments.length})</h4>
            <div id="ticket-comments-list">
                ${comments.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem;">Sin comentarios</p>' :
                comments.map(c => `<div class="ticket-comment" style="padding:10px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:8px;background:var(--bg-color);">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:0.78rem;color:var(--text-muted);">
                        <strong>${escapeHtml(c.author || 'Sistema')}</strong>
                        <span>${c.created_at ? new Date(c.created_at).toLocaleString('es') : ''}</span>
                    </div>
                    <p style="margin:0;font-size:0.85rem;">${escapeHtml(c.content || '')}</p>
                </div>`).join('')}
            </div>
            <div class="ticket-add-comment" style="display:flex;gap:8px;margin-top:12px;">
                <input type="text" id="ticket-comment-input" placeholder="Escribe un comentario..." style="flex:1;padding:8px 12px;font-size:0.85rem;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);">
                <button class="btn btn-primary btn-sm" onclick="addTicketComment('${ticketId}')"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
        </div>
    `;
}

async function updateTicketField(ticketId, field, value) {
    if (!supabaseClient) return;
    try {
        const { error } = await supabaseClient.from('feedback_tickets').update({ [field]: value || null, updated_at: new Date().toISOString() }).eq('id', ticketId);
        if (error) throw error;
        const ticket = allTickets.find(t => t.id === ticketId);
        if (ticket) ticket[field] = value;
        updateTicketStats();
        renderTicketsList();
        showToast('Ticket actualizado', 'success');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function addTicketComment(ticketId) {
    const input = document.getElementById('ticket-comment-input');
    if (!input || !input.value.trim()) return;
    if (!supabaseClient) return;

    try {
        const { error } = await supabaseClient.from('ticket_comments').insert({
            ticket_id: ticketId,
            author: 'Admin',
            content: input.value.trim()
        });
        if (error) throw error;
        input.value = '';
        showToast('Comentario agregado', 'success');
        selectTicket(ticketId); // refresh detail
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function renderTicketMetrics() {
    if (!window.Chart) return;

    // Category distribution
    const catCounts = {};
    allTickets.forEach(t => {
        const cat = t.ticket_category || 'sin_categoria';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const catCanvas = document.getElementById('ticket-category-chart');
    if (catCanvas) {
        const existingChart = Chart.getChart(catCanvas);
        if (existingChart) existingChart.destroy();
        new Chart(catCanvas, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catCounts),
                datasets: [{ data: Object.values(catCounts), backgroundColor: ['#ef4444', '#3b82f6', '#eab308', '#8b5cf6', '#6b7280'] }]
            },
            options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    // Trend chart (last 30 days)
    const trendCanvas = document.getElementById('ticket-trend-chart');
    if (trendCanvas) {
        const existingChart = Chart.getChart(trendCanvas);
        if (existingChart) existingChart.destroy();

        const days = {};
        for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
            days[d] = 0;
        }
        allTickets.forEach(t => {
            if (t.created_at) {
                const d = t.created_at.split('T')[0];
                if (days[d] !== undefined) days[d]++;
            }
        });

        new Chart(trendCanvas, {
            type: 'bar',
            data: {
                labels: Object.keys(days).map(d => d.substring(5)),
                datasets: [{ data: Object.values(days), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 3 }]
            },
            options: { scales: { x: { ticks: { maxRotation: 45, font: { size: 9 } } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        });
    }
}

// ============ TICKET REALTIME (#28) ============

function initTicketRealtimeSubscriptions() {
    cleanupTicketRealtimeSubscriptions();
    if (!supabaseClient) return;

    const ticketsChannel = supabaseClient
        .channel('tickets-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback_tickets' }, (payload) => {
            if (payload.eventType === 'INSERT') {
                allTickets.unshift(payload.new);
            } else if (payload.eventType === 'UPDATE') {
                const idx = allTickets.findIndex(t => t.id === payload.new.id);
                if (idx >= 0) allTickets[idx] = payload.new;
            } else if (payload.eventType === 'DELETE') {
                allTickets = allTickets.filter(t => t.id !== payload.old.id);
            }
            updateTicketStats();
            applyTicketFilters();
            if (currentTicketId === (payload.new?.id || payload.old?.id)) selectTicket(currentTicketId);
        })
        .subscribe();
    _ticketRealtimeChannels.push(ticketsChannel);

    const commentsChannel = supabaseClient
        .channel('ticket-comments-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_comments' }, (payload) => {
            if (currentTicketId === payload.new.ticket_id) selectTicket(currentTicketId);
        })
        .subscribe();
    _ticketRealtimeChannels.push(commentsChannel);
}

function cleanupTicketRealtimeSubscriptions() {
    if (!supabaseClient) return;
    for (const ch of _ticketRealtimeChannels) {
        supabaseClient.removeChannel(ch);
    }
    _ticketRealtimeChannels.length = 0;
}

// ============ JOB BOARD ADMIN SECTION ============

async function loadJobBoardAdmin() {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('No hay conexion a Supabase', 'error');
        return;
    }

    showToast('Cargando Job Board...', 'info');

    try {
        const { data: requests, error } = await client
            .from('job_board_requests')
            .select('*, job_board_applications(*)')
            .order('created_at', { ascending: false });

        if (error) throw error;

        allJobBoardRequests = requests || [];
        filteredJobBoardRequests = [...allJobBoardRequests];
        jobBoardPage = 1;

        updateJobBoardStats();
        applyJobBoardFilters();
    } catch (err) {
        showToast('Error cargando Job Board: ' + err.message, 'error');
    }
}

function updateJobBoardStats() {
    const data = allJobBoardRequests;
    const totalBids = data.reduce((sum, r) => sum + (r.job_board_applications?.length || 0), 0);
    const open = data.filter(r => r.status === 'open' || r.status === 'active').length;
    const accepted = data.filter(r => r.status === 'accepted').length;
    const expired = data.filter(r => r.status === 'expired').length;

    document.getElementById('jb-stat-total').textContent = data.length;
    document.getElementById('jb-stat-open').textContent = open;
    document.getElementById('jb-stat-bids').textContent = totalBids;
    document.getElementById('jb-stat-accepted').textContent = accepted;
    document.getElementById('jb-stat-expired').textContent = expired;
}

function applyJobBoardFilters() {
    const statusFilter = document.getElementById('filter-jb-status')?.value || '';
    const searchTerm = (document.getElementById('search-jobboard')?.value || '').toLowerCase().trim();

    filteredJobBoardRequests = allJobBoardRequests.filter(r => {
        if (statusFilter && r.status !== statusFilter) return false;
        if (searchTerm) {
            const style = r.tattoo_style?.style_name || r.tattoo_style?.style_slug || '';
            const city = r.preferred_city || r.client_city || '';
            const code = r.id?.substring(0, 8) || '';
            const haystack = `${style} ${city} ${code}`.toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }
        return true;
    });

    jobBoardPage = 1;
    renderJobBoardTable();
}

function renderJobBoardTable() {
    const tbody = document.getElementById('jobboard-tbody');
    const start = (jobBoardPage - 1) * jobBoardPerPage;
    const pageItems = filteredJobBoardRequests.slice(start, start + jobBoardPerPage);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state-box"><i class="fa-solid fa-briefcase"></i><span class="empty-title">No se encontraron solicitudes</span><span class="empty-desc">Ajusta los filtros o espera nuevas solicitudes.</span></div></td></tr>`;
        document.getElementById('jobboard-pagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = pageItems.map(r => {
        const apps = r.job_board_applications || [];
        const pendingBids = apps.filter(a => a.status === 'pending' || a.status === 'viewed').length;
        const totalBids = apps.length;
        const budgetMin = r.client_budget_min;
        const budgetMax = r.client_budget_max;
        const budgetStr = budgetMin && budgetMax ? `$${budgetMin} - $${budgetMax}` : (budgetMin ? `Desde $${budgetMin}` : (budgetMax ? `Hasta $${budgetMax}` : 'No especificado'));
        const style = r.tattoo_style?.style_name || r.tattoo_style?.style_slug || 'N/A';
        const city = r.preferred_city || r.client_city || 'N/A';
        const code = r.id?.substring(0, 8)?.toUpperCase() || '—';
        const popularityBadge = totalBids >= 5 ? ' <i class="fa-solid fa-star" style="color:var(--bauhaus-red,#C62828);font-size:0.7rem;" title="Popular: 5+ propuestas"></i>' : '';

        const statusMap = {
            'open': { label: 'Abierta', cls: 'badge-info' },
            'active': { label: 'Activa', cls: 'badge-info' },
            'in_review': { label: 'En revision', cls: 'badge-warning' },
            'accepted': { label: 'Aceptada', cls: 'badge-success' },
            'closed': { label: 'Cerrada', cls: 'badge-secondary' },
            'expired': { label: 'Expirada', cls: 'badge-danger' }
        };
        const st = statusMap[r.status] || { label: r.status || 'Desconocido', cls: 'badge-secondary' };

        return `<tr>
            <td><code>${code}</code></td>
            <td>${escapeHtml(style)}</td>
            <td>${escapeHtml(city)}</td>
            <td>${budgetStr}</td>
            <td>${pendingBids}/${totalBids}${popularityBadge}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
            <td>
                <button class="btn-icon" onclick="viewJobBoardBids('${r.id}')" title="Ver propuestas"><i class="fa-solid fa-eye"></i></button>
            </td>
        </tr>`;
    }).join('');

    renderJobBoardPagination();
}

function renderJobBoardPagination() {
    const container = document.getElementById('jobboard-pagination');
    const totalPages = Math.ceil(filteredJobBoardRequests.length / jobBoardPerPage);
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    let h = `<button ${jobBoardPage <= 1 ? 'disabled' : ''} onclick="goToJobBoardPage(${jobBoardPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
    const sp = Math.max(1, jobBoardPage - 2), ep = Math.min(totalPages, jobBoardPage + 2);
    if (sp > 1) h += `<button onclick="goToJobBoardPage(1)">1</button><span>...</span>`;
    for (let i = sp; i <= ep; i++) h += `<button class="${i === jobBoardPage ? 'active' : ''}" onclick="goToJobBoardPage(${i})">${i}</button>`;
    if (ep < totalPages) h += `<span>...</span><button onclick="goToJobBoardPage(${totalPages})">${totalPages}</button>`;
    h += `<button ${jobBoardPage >= totalPages ? 'disabled' : ''} onclick="goToJobBoardPage(${jobBoardPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
    container.innerHTML = h;
}

function goToJobBoardPage(page) {
    const totalPages = Math.ceil(filteredJobBoardRequests.length / jobBoardPerPage);
    if (page < 1 || page > totalPages) return;
    jobBoardPage = page;
    renderJobBoardTable();
}

function viewJobBoardBids(requestId) {
    const request = allJobBoardRequests.find(r => r.id === requestId);
    if (!request) { showToast('Solicitud no encontrada', 'error'); return; }

    const panel = document.getElementById('jb-bids-panel');
    const title = document.getElementById('jb-bids-title');
    const content = document.getElementById('jb-bids-content');

    const style = request.tattoo_style?.style_name || request.tattoo_style?.style_slug || 'N/A';
    title.textContent = `Propuestas — ${style} (${request.id?.substring(0, 8)?.toUpperCase()})`;

    const apps = request.job_board_applications || [];
    if (apps.length === 0) {
        content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No hay propuestas para esta solicitud.</p>';
    } else {
        content.innerHTML = apps.map(a => {
            const priceInRange = request.client_budget_min && request.client_budget_max && a.estimated_price
                ? (a.estimated_price >= request.client_budget_min && a.estimated_price <= request.client_budget_max)
                : false;
            const matchBadge = priceInRange ? '<span style="background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem;margin-left:8px;">MATCH</span>' : '';

            const statusMap = {
                'pending': { label: 'Pendiente', cls: 'badge-warning' },
                'viewed': { label: 'Vista', cls: 'badge-info' },
                'accepted': { label: 'Aceptada', cls: 'badge-success' },
                'rejected': { label: 'Rechazada', cls: 'badge-danger' }
            };
            const st = statusMap[a.status] || { label: a.status || '—', cls: 'badge-secondary' };

            const actions = (a.status === 'pending' || a.status === 'viewed')
                ? `<div style="display:flex;gap:8px;margin-top:10px;">
                    <button class="btn btn-primary btn-sm" onclick="acceptBidAdmin('${a.id}','${requestId}')"><i class="fa-solid fa-check"></i> Aceptar</button>
                    <button class="btn btn-secondary btn-sm" onclick="rejectBidAdmin('${a.id}','${requestId}')"><i class="fa-solid fa-xmark"></i> Rechazar</button>
                  </div>`
                : '';

            return `<div style="border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px;background:var(--bg-secondary,#1a1a1a);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong>${escapeHtml(a.artist_name || a.artist_id?.substring(0, 8) || 'Artista')}</strong>
                    <span class="badge ${st.cls}">${st.label}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:0.85rem;color:var(--text-secondary);">
                    <span><i class="fa-solid fa-dollar-sign"></i> Precio: <strong style="color:var(--text-primary);">$${a.estimated_price || '—'}</strong>${matchBadge}</span>
                    <span><i class="fa-solid fa-calendar"></i> Sesiones: <strong style="color:var(--text-primary);">${a.estimated_sessions || '—'}</strong></span>
                    <span><i class="fa-solid fa-clock"></i> Disponibilidad: ${escapeHtml(a.availability_note || 'No especificada')}</span>
                </div>
                ${a.message ? `<p style="margin:8px 0 0;font-size:0.85rem;color:var(--text-secondary);">${escapeHtml(a.message)}</p>` : ''}
                ${actions}
            </div>`;
        }).join('');
    }

    panel.style.display = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeJobBoardBidsPanel() {
    const panel = document.getElementById('jb-bids-panel');
    if (panel) panel.style.display = 'none';
}

async function acceptBidAdmin(appId, requestId) {
    if (!confirm('Aceptar esta propuesta? Las demas propuestas pendientes seran rechazadas automaticamente.')) return;

    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) { showToast('No hay conexion a Supabase', 'error'); return; }

    try {
        // Accept this bid
        const { error: acceptErr } = await client
            .from('job_board_applications')
            .update({ status: 'accepted', decided_at: new Date().toISOString() })
            .eq('id', appId);
        if (acceptErr) throw acceptErr;

        // Reject all other pending bids for this request
        const { error: rejectErr } = await client
            .from('job_board_applications')
            .update({ status: 'rejected', decided_at: new Date().toISOString() })
            .eq('request_id', requestId)
            .neq('id', appId)
            .in('status', ['pending', 'viewed']);
        if (rejectErr) throw rejectErr;

        // Update request status to accepted
        const { error: reqErr } = await client
            .from('job_board_requests')
            .update({ status: 'accepted' })
            .eq('id', requestId);
        if (reqErr) throw reqErr;

        showToast('Propuesta aceptada', 'success');
        await loadJobBoardAdmin();
        viewJobBoardBids(requestId);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function rejectBidAdmin(appId, requestId) {
    if (!confirm('Rechazar esta propuesta?')) return;

    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) { showToast('No hay conexion a Supabase', 'error'); return; }

    try {
        const { error } = await client
            .from('job_board_applications')
            .update({ status: 'rejected', decided_at: new Date().toISOString() })
            .eq('id', appId);
        if (error) throw error;

        showToast('Propuesta rechazada', 'success');
        await loadJobBoardAdmin();
        viewJobBoardBids(requestId);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// Hook into showSection to manage subscriptions lifecycle
const _originalShowSection = showSection;
function showSectionWithRealtime(sectionId) {
    // Cleanup previous realtime subscriptions
    cleanupRealtimeSubscriptions();
    cleanupTicketRealtimeSubscriptions();

    _originalShowSection(sectionId);

    if (sectionId === 'dashboard') {
        initRealtimeSubscriptions();
    } else if (sectionId === 'tickets') {
        initTicketRealtimeSubscriptions();
    }
}
window.showSection = showSectionWithRealtime;

// Auto-start realtime if dashboard is the active section on load
document.addEventListener('DOMContentLoaded', () => {
    const dashboardSection = document.getElementById('section-dashboard');
    if (dashboardSection && dashboardSection.classList.contains('active')) {
        // Wait for Supabase to be ready
        const waitForSupabase = setInterval(() => {
            if (supabaseClient) {
                clearInterval(waitForSupabase);
                initRealtimeSubscriptions();
            }
        }, 500);
        // Stop waiting after 10 seconds
        setTimeout(() => clearInterval(waitForSupabase), 10000);
    }
});

window.initRealtimeSubscriptions = initRealtimeSubscriptions;
window.cleanupRealtimeSubscriptions = cleanupRealtimeSubscriptions;

// Artist exports
window.loadArtists = loadArtists;
window.renderArtistsTable = renderArtistsTable;
window.goToArtistsPage = goToArtistsPage;
window.changeItemsPerPage = changeItemsPerPage;
window.editArtist = editArtist;
window.applyArtistFilters = applyArtistFilters;
window.clearArtistFilters = clearArtistFilters;
window.openArtistProfile = openArtistProfile;
window.closeArtistProfile = closeArtistProfile;
window.verifyFromProfile = verifyFromProfile;
window.deleteArtist = deleteArtist;
window.saveArtist = saveArtist;
window.loadDashboardCharts = loadDashboardCharts;
window.createSystemBackup = createSystemBackup;

// Verification exports
window.loadVerificationQueue = loadVerificationQueue;
window.approveVerification = approveVerification;
window.rejectVerification = rejectVerification;

// Tickets exports
window.loadSupportTickets = loadSupportTickets;
window.applyTicketFilters = applyTicketFilters;
window.clearTicketFilters = clearTicketFilters;
window.selectTicket = selectTicket;
window.updateTicketField = updateTicketField;
window.addTicketComment = addTicketComment;
window.initTicketRealtimeSubscriptions = initTicketRealtimeSubscriptions;
window.cleanupTicketRealtimeSubscriptions = cleanupTicketRealtimeSubscriptions;

// Job Board exports
window.loadJobBoardAdmin = loadJobBoardAdmin;
window.applyJobBoardFilters = applyJobBoardFilters;
window.goToJobBoardPage = goToJobBoardPage;
window.viewJobBoardBids = viewJobBoardBids;
window.closeJobBoardBidsPanel = closeJobBoardBidsPanel;
window.acceptBidAdmin = acceptBidAdmin;
window.rejectBidAdmin = rejectBidAdmin;
