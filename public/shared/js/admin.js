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
// Used to sanity-check an identifier before sending it to the delete endpoint.
const UUID_RE_CLIENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Questions configuration
let questionsConfig = [];

// Styles configuration (extracted from questionsConfig)
let currentStyles = [];

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
        'studios': 'Gestion de Estudios',
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
        'currencies': 'Monedas y Tipos de Cambio'
    };
    document.getElementById('section-title').textContent = titles[sectionId];

    // Load data if needed
    if (sectionId === 'quotations') {
        loadQuotations();
    } else if (sectionId === 'artists') {
        loadArtists();
    } else if (sectionId === 'studios') {
        loadStudios();
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
let supabaseClient = null;

if (typeof window.supabase !== 'undefined' && 
    CONFIG.supabase.url !== 'https://YOUR_PROJECT_ID.supabase.co') {
    supabaseClient = window._supabase = window._supabase || window.supabase.createClient(
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
    let url = window.ConfigManager?.getValue?.('supabase.url') || '';
    let key = window.ConfigManager?.getValue?.('supabase.anonKey') || '';

    const savedSettings = localStorage.getItem('weotzi_admin_settings');
    if ((!url || !key) && savedSettings) {
        const settings = JSON.parse(savedSettings);
        url = settings.supabase?.url || '';
        key = settings.supabase?.key || settings.supabase?.anonKey || '';
    }

    if (url && key) {
        connectSupabase(url, key);
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

        await _fetchAdminJson('/api/admin/database/tables');

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
        await _fetchAdminJson('/api/admin/database/tables');

        // Save settings
        saveSettings();

        // Connect
        supabaseClient = window.ConfigManager?.getSupabaseClient?.() || window._supabase || null;
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
        const total = await WeotziData.Quotations.countAll();

        document.getElementById('stat-total').textContent = total || 0;

        // Pending (Awaiting artist response)
        const pendingCount = await WeotziData.Quotations.countByStatus('pending');

        document.getElementById('stat-pending-artist').textContent = pendingCount || 0;

        // Responded (Addressed by artist)
        const respondedCount = await WeotziData.Quotations.countByStatus('responded');

        document.getElementById('stat-responded').textContent = respondedCount || 0;

        // In progress (Still being filled by client)
        const inProgressCount = await WeotziData.Quotations.countByStatus('in_progress');

        document.getElementById('stat-in-progress').textContent = inProgressCount || 0;

        // Artists
        const { count: artists } = await WeotziData
            .from('artists_db')
            .select('*', { count: 'exact', head: true });

        document.getElementById('stat-artists').textContent = artists || 0;

        // Recent quotations
        const recent = await WeotziData.Quotations.listRecent(5);

        renderRecentQuotations(recent || []);

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
        'artist_completed': 'Lista para cliente',
        'client_rejected': 'Cliente Rechazo',
        'completed': 'Completada'
    };

    container.innerHTML = quotations.map(q => `
        <div class="recent-item">
            <div class="recent-info">
                <span class="recent-id">${q.quote_id}</span>
                <span class="recent-meta">${q.client_full_name || 'Prospecto'} → ${q.artist_name || 'Sin artista'}</span>
            </div>
            <span class="status-badge ${q.quote_status}">${statusLabels[q.quote_status] || q.quote_status}</span>
        </div>
    `).join('');
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
        const data = await WeotziData.Quotations.listForAdmin({ status: statusFilter || null });

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
        'artist_completed': 'Lista para cliente',
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
                <td>${q.client_full_name || '—'}</td>
                <td>${q.artist_name || '—'}</td>
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

        await WeotziData.Quotations.hardDeleteByQuoteId(quoteId);

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

        await WeotziData.Quotations.hardDeleteByQuoteIds(idsToDelete);

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
                <span class="detail-value">${quotation.client_budget_amount || '—'} ${quotation.client_budget_currency || ''}</span>
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
                    <div class="question-title">${q.title}</div>
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
//
// Reads artists_db from Supabase (fallback to demo via ConfigManager) and
// renders a dense business view: identity + contact + ubicación + studio +
// estilos + precio + experiencia + embajador + verificación + índice +
// completitud. The edit modal exposes ~30 columns split across tabs so the
// admin can curate any field without leaving /backoffice.
//
// Key constants live near the top of this block to keep them in sync between
// list, filters, badges and the edit modal.
const EMBAJADOR_LABELS = {
    si: { text: 'Embajador', class: 'ambassador' },
    pendiente: { text: 'Pendiente', class: 'pending' },
    No: { text: 'No', class: 'none' }
};

const VERIFICATION_LABELS = {
    'Yes':         { text: 'Verificado',   class: 'verified' },
    'No':          { text: 'No verificado',class: 'not-verified' },
    'Requested':   { text: 'Solicitada',   class: 'requested' },
    'In Progress': { text: 'En progreso',  class: 'in-progress' },
    'In Analysis': { text: 'En análisis',  class: 'in-analysis' },
    'Denied':      { text: 'Denegado',     class: 'denied' }
};

function normalizeEmbajador(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'si' || v === 'sí' || v === 'yes' || v === 'true') return 'si';
    if (v === 'pendiente' || v === 'pending') return 'pendiente';
    return 'No';
}

function getEmbajadorBadge(value) {
    const key = normalizeEmbajador(value);
    const cfg = EMBAJADOR_LABELS[key] || EMBAJADOR_LABELS.No;
    return `<span class="status-badge ${cfg.class}">${cfg.text}</span>`;
}

function getVerificationBadge(state) {
    const cfg = VERIFICATION_LABELS[state] || VERIFICATION_LABELS.No;
    return `<span class="status-badge ${cfg.class}">${cfg.text}</span>`;
}

function progressBar(value, max = 100) {
    const v = Number(value) || 0;
    const pct = Math.min(100, Math.max(0, (v / max) * 100));
    const cls = v >= 70 ? '' : (v >= 40 ? 'warn' : 'error');
    return `<div class="bo-progress" title="${v} / ${max}">
        <span class="bar"><span class="${cls}" style="width: ${pct}%"></span></span>
        <span class="value">${v}</span>
    </div>`;
}

function avatarInitials(name) {
    return String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(s => s[0].toUpperCase())
        .join('') || '?';
}

function buildArtistLocation(a) {
    // Prefer structured fields, fall back to legacy columns.
    const parts = [];
    const city = a.city || a.locality;
    if (city) parts.push(city);
    const region = a.state_province;
    if (region && region !== city) parts.push(region);
    const country = a.country;
    if (country) parts.push(country);
    if (parts.length) return parts.join(', ');
    return a.ubicacion || '';
}

async function loadArtists() {
    const tbody = document.getElementById('artists-tbody');
    const isDemo = document.getElementById('setting-demo-mode').checked;
    const colCount = 12;

    const searchTerm = (document.getElementById('search-artists')?.value || '').trim().toLowerCase();
    const filterEmb = document.getElementById('filter-artists-embajador')?.value || '';
    const filterVer = document.getElementById('filter-artists-verification')?.value || '';

    showTableLoading('artists-tbody', colCount);

    try {
        let artists = [];

        if (isDemo) {
            const demoArtists = window.ConfigManager.getDemoArtists();
            artists = demoArtists.map(a => ({
                id: a.userId,
                user_id: a.userId,
                username: a.username,
                name: a.name,
                email: a.email || '',
                instagram: a.instagram || '',
                whatsapp_number: a.whatsappNumber || '',
                city: a.location,
                country: a.country || '',
                estudios: a.studio || '',
                styles_array: a.styles || [],
                session_price: a.sessionPrice,
                years_experience: a.yearsExperience || '',
                embajador: a.embajador || 'No',
                verification_state: a.verificationState || 'No',
                is_recommended: !!a.isRecommended,
                artist_index: Number(a.artistIndex) || 0,
                profile_completeness: Number(a.profileCompleteness) || 0,
                profile_picture: a.profilePicture || ''
            }));
        } else {
            const result = await _fetchAdminJson('/api/admin/artists');
            const data = result.artists || [];

            artists = data.map(a => ({
                ...a,
                id: a.id || a.user_id,
                styles_array: typeof a.styles_array === 'string'
                    ? JSON.parse(a.styles_array)
                    : (a.styles_array || []),
                languages: typeof a.languages === 'string'
                    ? JSON.parse(a.languages)
                    : (a.languages || []),
                custom_canvas_labels: typeof a.custom_canvas_labels === 'string'
                    ? JSON.parse(a.custom_canvas_labels)
                    : (a.custom_canvas_labels || [])
            }));
        }

        // Filter (search across many fields, plus dropdown filters)
        if (searchTerm) {
            artists = artists.filter(a => {
                const haystack = [
                    a.name, a.username, a.email, a.instagram, a.whatsapp_number,
                    a.city, a.country, a.locality, a.state_province, a.ubicacion,
                    a.estudios, a.formatted_address,
                    Array.isArray(a.styles_array) ? a.styles_array.join(' ') : a.styles_array
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(searchTerm);
            });
        }
        if (filterEmb) {
            artists = artists.filter(a => normalizeEmbajador(a.embajador) === filterEmb);
        }
        if (filterVer) {
            artists = artists.filter(a => (a.verification_state || 'No') === filterVer);
        }

        currentArtists = artists;
        currentArtistsPage = 1;
        renderArtistsTable();
        renderArtistsMeta(artists);

    } catch (error) {
        console.error('Error loading artists:', error);
        showTableErrorState('artists-tbody', colCount, 'No se pudieron cargar los artistas. Verifica tu conexion.', 'loadArtists()');
        showToast('Error cargando artistas', 'error');
    }
}

function renderArtistsMeta(artists) {
    const meta = document.getElementById('artists-table-meta');
    if (!meta) return;
    const total = artists.length;
    const ambassadors = artists.filter(a => normalizeEmbajador(a.embajador) === 'si').length;
    const pending = artists.filter(a => normalizeEmbajador(a.embajador) === 'pendiente').length;
    const verified = artists.filter(a => a.verification_state === 'Yes').length;
    const recommended = artists.filter(a => a.is_recommended === true).length;
    meta.innerHTML = `
        <span><strong>${total}</strong> artistas</span>
        <span><strong>${ambassadors}</strong> embajadores</span>
        <span><strong>${pending}</strong> pendientes</span>
        <span><strong>${verified}</strong> verificados</span>
        <span><strong>${recommended}</strong> recomendados</span>
    `;
}

function renderArtistsTable() {
    const tbody = document.getElementById('artists-tbody');
    const colCount = 12;
    const start = (currentArtistsPage - 1) * artistsItemsPerPage;
    const end = start + parseInt(artistsItemsPerPage);
    const pageItems = currentArtists.slice(start, end);

    if (pageItems.length === 0) {
        showTableEmptyState('artists-tbody', colCount, 'fa-palette', 'No se encontraron artistas', 'Ajusta los filtros o espera nuevos registros.');
        return;
    }

    tbody.innerHTML = pageItems.map(a => {
        const styles = Array.isArray(a.styles_array) ? a.styles_array.join(', ') : (a.styles_array || '');
        const location = buildArtistLocation(a);
        const studio = a.estudios || (a.studio_id ? `Studio ${String(a.studio_id).slice(0, 8)}…` : '');
        const initials = avatarInitials(a.name || a.username);
        const recommendedTag = a.is_recommended
            ? '<span class="badge-sm" title="Artista recomendado" style="margin-left:6px;background:rgba(245,158,11,0.18);color:#f59e0b;">★</span>'
            : '';
        const safeId = escapeHtml(a.user_id || a.id || '');

        return `
            <tr>
                <td>
                    <div class="artist-cell-identity">
                        <span class="avatar">${a.profile_picture ? `<img src="${escapeHtml(a.profile_picture)}" alt="">` : escapeHtml(initials)}</span>
                        <div class="artist-meta">
                            <strong title="${escapeHtml(a.name || '')}">${escapeHtml(a.name || '—')}${recommendedTag}</strong>
                            <small title="${escapeHtml(a.username || '')}">@${escapeHtml(a.username || '—')}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="artist-cell-contact">
                        ${a.email ? `<a href="mailto:${escapeHtml(a.email)}" title="${escapeHtml(a.email)}"><i class="fa-solid fa-envelope"></i> ${escapeHtml(a.email)}</a>` : '<span>—</span>'}
                        ${a.instagram ? `<a href="${escapeHtml(a.instagram)}" target="_blank" rel="noopener" title="${escapeHtml(a.instagram)}"><i class="fa-brands fa-instagram"></i> Instagram</a>` : ''}
                        ${a.whatsapp_number ? `<span title="${escapeHtml(a.whatsapp_number)}"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(a.whatsapp_number)}</span>` : ''}
                    </div>
                </td>
                <td><span class="truncate-text" title="${escapeHtml(location)}">${escapeHtml(location || '—')}</span></td>
                <td><span class="truncate-text" title="${escapeHtml(studio)}">${escapeHtml(studio || '—')}</span></td>
                <td><span class="truncate-text" title="${escapeHtml(styles)}">${escapeHtml(styles || '—')}</span></td>
                <td>${escapeHtml(a.session_price || '—')}</td>
                <td>${escapeHtml(a.years_experience || '—')}</td>
                <td>${getEmbajadorBadge(a.embajador)}</td>
                <td>${getVerificationBadge(a.verification_state || 'No')}</td>
                <td>${progressBar(a.artist_index)}</td>
                <td>${progressBar(a.profile_completeness)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="editArtist('${safeId}')" title="Editar">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="btn-icon danger-hover" onclick="deleteArtist('${safeId}')" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
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

// Switches between tabs inside the artist edit modal.
function switchArtistTab(tabName) {
    document.querySelectorAll('#artist-modal .modal-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('#artist-modal .modal-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.tabPanel === tabName);
    });
}

// Tracks the artist currently open in the modal so save/delete know which row
// to operate on, even when the user types into form fields.
let editingArtist = null;

function setVal(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else if (el.isContentEditable) {
        if (id === 'artist-bio' && window.BioFormatting) {
            window.BioFormatting.renderBioHtml(el, value, { emptyMessage: '' });
        } else {
            el.textContent = value == null ? '' : value;
        }
    }
    else el.value = value == null ? '' : value;
}

function getVal(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    if (el.isContentEditable) {
        const raw = el.innerHTML || '';
        if (id === 'artist-bio' && window.BioFormatting) {
            return window.BioFormatting.sanitizeBioHtml(raw);
        }
        return raw;
    }
    return el.value;
}

function csvToArray(s) {
    return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

function editArtist(artistId) {
    const artist = currentArtists.find(a =>
        a.user_id === artistId || a.id === artistId
    );
    if (!artist) {
        showToast('Artista no encontrado', 'error');
        return;
    }
    editingArtist = artist;

    document.getElementById('artist-form').reset();
    switchArtistTab('identity');

    // Hidden ids: artist-id keeps the row primary key (id); artist-user-id keeps user_id (used as filter for updates because RLS policies key off user_id).
    setVal('artist-id', artist.id || artist.user_id);
    setVal('artist-user-id', artist.user_id || artist.id);

    // Identidad
    setVal('artist-name', artist.name);
    setVal('artist-username', artist.username);
    setVal('artist-email', artist.email);
    setVal('artist-whatsapp', artist.whatsapp_number);
    setVal('artist-instagram', artist.instagram);
    setVal('artist-portfolio', artist.portafolio);
    setVal('artist-picture', artist.profile_picture);
    setVal('artist-birth', artist.birth_date);
    setVal('artist-bio', artist.bio_description);
    setVal('artist-languages', Array.isArray(artist.languages) ? artist.languages.join(', ') : artist.languages);
    setVal('artist-newsletter', artist.subscribed_newsletter);

    // Ubicación
    setVal('artist-city', artist.city);
    setVal('artist-country', artist.country);
    setVal('artist-state-province', artist.state_province);
    setVal('artist-locality', artist.locality);
    setVal('artist-street', artist.street);
    setVal('artist-street-number', artist.street_number);
    setVal('artist-unit', artist.unit);
    setVal('artist-postal-code', artist.postal_code);
    setVal('artist-country-code', artist.country_code);
    setVal('artist-formatted-address', artist.formatted_address);
    setVal('artist-latitude', artist.latitude);
    setVal('artist-longitude', artist.longitude);
    setVal('artist-ubicacion', artist.ubicacion);

    // Negocio
    setVal('artist-studio', artist.estudios);
    setVal('artist-studio-id', artist.studio_id);
    setVal('artist-work-type', artist.work_type);
    setVal('artist-experience', artist.years_experience);
    setVal('artist-price', artist.session_price);
    setVal('artist-nivel', artist.nivel);
    setVal('artist-styles', Array.isArray(artist.styles_array) ? artist.styles_array.join(', ') : artist.styles_array);
    setVal('artist-estilo', artist.estilo);

    // Estatus
    setVal('artist-embajador', normalizeEmbajador(artist.embajador));
    setVal('artist-verification-state', artist.verification_state || 'No');
    setVal('artist-is-recommended', artist.is_recommended);
    setVal('artist-email-confirmed', artist.email_confirmed);
    setVal('artist-vacation-start', artist.vacation_start);
    setVal('artist-vacation-end', artist.vacation_end);
    setVal('artist-ms-profile-complete', artist.ms_profile_complete);
    setVal('artist-ms-first-quote-received', artist.ms_first_quote_received);
    setVal('artist-ms-first-quote-completed', artist.ms_first_quote_completed);
    setVal('artist-ms-whatsapp-shared', artist.ms_whatsapp_shared);
    setVal('artist-ms-profile-shared', artist.ms_profile_shared);

    // Avanzado
    setVal('artist-custom-canvas-labels', Array.isArray(artist.custom_canvas_labels) ? artist.custom_canvas_labels.join(', ') : artist.custom_canvas_labels);
    setVal('artist-artist-index', artist.artist_index);
    setVal('artist-profile-completeness', artist.profile_completeness);
    setVal('artist-google-place-id', artist.google_place_id);
    setVal('artist-idx', artist.idx);

    // Header meta inside the modal — quick reference of read-only signals.
    const meta = document.getElementById('artist-modal-meta');
    if (meta) {
        const created = artist.index_updated_at ? new Date(artist.index_updated_at).toLocaleString() : '—';
        meta.innerHTML = `
            <span>ID: <strong>${escapeHtml(String(artist.id || ''))}</strong></span>
            <span>user_id: <strong>${escapeHtml(String(artist.user_id || ''))}</strong></span>
            <span>Índice: <strong>${artist.artist_index || 0}/100</strong></span>
            <span>Perfil: <strong>${artist.profile_completeness || 0}%</strong></span>
            <span>Actualizado: <strong>${escapeHtml(created)}</strong></span>
        `;
    }

    document.getElementById('artist-modal-title').textContent = `Editar Artista — ${artist.name || artist.username || ''}`;
    openModal('artist-modal');
}

// Translate Supabase / PostgREST errors into friendlier Spanish messages. We
// keep the original error.message as a fallback so nothing is hidden.
function describeArtistDbError(error) {
    if (!error) return 'Operación bloqueada (RLS o fila no encontrada). Revisa tu sesión.';
    const code = error.code || '';
    const details = error.details || '';
    const msg = error.message || String(error);
    if (code === '42501') {
        return 'Sin permisos para modificar artists_db. Tu sesión de superadmin pudo haber expirado.';
    }
    if (code === '23503') {
        // Foreign key violation — surface which table is blocking the delete.
        if (/studio_jobs_log/.test(details + msg)) {
            return 'No se puede eliminar: el artista tiene registros en studio_jobs_log (ON DELETE RESTRICT).';
        }
        if (/job_board_requests/.test(details + msg)) {
            return 'No se puede eliminar: el artista aceptó una solicitud en job_board_requests. Reasigna o cancela la solicitud primero.';
        }
        return 'No se puede eliminar: hay registros relacionados que lo impiden (' + (details || msg) + ').';
    }
    if (code === '23514') {
        // error.message carries the constraint name ("violates check constraint X"),
        // which is the actual clue. details/hint are extra context — keep them all.
        const parts = [msg, details, error.hint].filter(Boolean);
        return 'CHECK constraint violado: ' + parts.join(' — ');
    }
    return msg;
}

async function saveArtist(event) {
    event.preventDefault();

    const id = getVal('artist-id');
    const userId = getVal('artist-user-id') || id;
    const isDemo = document.getElementById('setting-demo-mode').checked;

    // Optional password change. Empty = leave the current password untouched.
    // Validate length up front so we never do a partial save (DB row updated
    // but password rejected).
    const newPassword = getVal('artist-new-password');
    if (newPassword && newPassword.length < 6) {
        showToast('La nueva contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }
    // A password only exists for artists with a real auth account. Drafts /
    // imported artists have user_id = NULL (the hidden field falls back to the
    // primary key, so read the true value off the loaded row instead).
    const authUserId = (editingArtist && editingArtist.user_id) || '';
    let passwordApplied = false;

    // Build payload that matches artists_db column names exactly.
    // artist_index, profile_completeness and index_updated_at are NOT sent —
    // they are computed by the BEFORE-UPDATE trigger update_artist_index().
    const updates = {
        name: getVal('artist-name'),
        username: getVal('artist-username'),
        email: getVal('artist-email'),
        whatsapp_number: getVal('artist-whatsapp'),
        instagram: getVal('artist-instagram'),
        portafolio: getVal('artist-portfolio'),
        profile_picture: getVal('artist-picture'),
        birth_date: getVal('artist-birth') || null,
        bio_description: getVal('artist-bio'),
        languages: csvToArray(getVal('artist-languages')),
        subscribed_newsletter: getVal('artist-newsletter'),

        city: getVal('artist-city'),
        country: getVal('artist-country'),
        state_province: getVal('artist-state-province'),
        locality: getVal('artist-locality'),
        street: getVal('artist-street'),
        street_number: getVal('artist-street-number'),
        unit: getVal('artist-unit'),
        postal_code: getVal('artist-postal-code'),
        country_code: getVal('artist-country-code'),
        formatted_address: getVal('artist-formatted-address'),
        latitude: getVal('artist-latitude') === '' ? null : Number(getVal('artist-latitude')),
        longitude: getVal('artist-longitude') === '' ? null : Number(getVal('artist-longitude')),
        ubicacion: getVal('artist-ubicacion'),

        estudios: getVal('artist-studio'),
        studio_id: getVal('artist-studio-id') || null,
        work_type: getVal('artist-work-type') || null,
        years_experience: getVal('artist-experience'),
        session_price: getVal('artist-price'),
        nivel: getVal('artist-nivel') || 'Nuevo',
        styles_array: csvToArray(getVal('artist-styles')),
        estilo: getVal('artist-estilo'),

        embajador: getVal('artist-embajador'),
        verification_state: getVal('artist-verification-state'),
        is_recommended: getVal('artist-is-recommended'),
        email_confirmed: getVal('artist-email-confirmed'),
        vacation_start: getVal('artist-vacation-start') || null,
        vacation_end: getVal('artist-vacation-end') || null,
        ms_profile_complete: getVal('artist-ms-profile-complete'),
        ms_first_quote_received: getVal('artist-ms-first-quote-received'),
        ms_first_quote_completed: getVal('artist-ms-first-quote-completed'),
        ms_whatsapp_shared: getVal('artist-ms-whatsapp-shared'),
        ms_profile_shared: getVal('artist-ms-profile-shared'),

        custom_canvas_labels: csvToArray(getVal('artist-custom-canvas-labels')),
        google_place_id: getVal('artist-google-place-id'),
        idx: getVal('artist-idx') === '' ? null : Number(getVal('artist-idx'))
    };

    try {
        if (isDemo) {
            const currentDemoArtists = window.ConfigManager.getDemoArtists();
            const index = currentDemoArtists.findIndex(a => a.userId === userId);
            const updatedArtist = {
                userId,
                username: updates.username,
                name: updates.name,
                email: updates.email,
                instagram: updates.instagram,
                location: updates.city,
                country: updates.country,
                studio: updates.estudios,
                sessionPrice: updates.session_price,
                yearsExperience: updates.years_experience,
                styles: updates.styles_array,
                embajador: updates.embajador,
                verificationState: updates.verification_state,
                isRecommended: updates.is_recommended,
                profilePicture: updates.profile_picture
            };
            const newList = [...currentDemoArtists];
            if (index >= 0) newList[index] = updatedArtist;
            else newList.push(updatedArtist);
            window.ConfigManager.setValue('demoArtists', newList);
            showToast(
                newPassword
                    ? 'Artista actualizado en Demo Mode (la contraseña no aplica en demo)'
                    : 'Artista actualizado en Demo Mode',
                newPassword ? 'warning' : 'success'
            );
        } else {
            if (!supabaseClient) throw new Error('No hay conexión con Supabase');
            if (!userId) throw new Error('user_id vacío — abre el artista desde la tabla.');

            // .select() forces PostgREST to return affected rows so we can
            // detect silent RLS failures (data:[], error:null) that previously
            // surfaced as a fake "Artista actualizado" toast.
            const { data, error } = await WeotziData
                .from('artists_db')
                .update(updates)
                .eq('user_id', userId)
                .select('user_id');

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('No se actualizó ninguna fila (RLS bloqueó la operación o user_id no coincide). Inicia sesión otra vez en /backoffice/login.');
            }

            // Password change goes through the service-role admin endpoint
            // (Supabase's anon/authenticated key cannot set another user's
            // password — only the auth.admin API can). Same endpoint already
            // used for support users.
            if (newPassword) {
                if (!authUserId) {
                    showToast('Este artista no tiene cuenta de acceso (borrador/importado): no se puede asignar contraseña.', 'warning');
                } else {
                    const headers = await _getApifyAuthHeaders();
                    if (headers._noSession) {
                        throw new Error('No hay sesión de superadmin para cambiar la contraseña. Inicia sesión otra vez en /backoffice/login.');
                    }
                    const pwRes = await fetch('/api/admin/update-user-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...headers },
                        body: JSON.stringify({ userId: authUserId, newPassword })
                    });
                    const pwResult = await pwRes.json();
                    if (!pwRes.ok || !pwResult.success) {
                        throw new Error(pwResult.error || `Error al actualizar la contraseña (HTTP ${pwRes.status})`);
                    }
                    passwordApplied = true;
                }
            }

            showToast(passwordApplied ? 'Artista y contraseña actualizados' : 'Artista actualizado en Supabase', 'success');
        }

        closeModal();
        loadArtists();

    } catch (error) {
        console.error('Error saving artist:', error);
        showToast('Error al guardar: ' + describeArtistDbError(error), 'error');
    }
}

async function deleteArtist(artistId) {
    const isDemo = document.getElementById('setting-demo-mode').checked;
    const target = currentArtists.find(a => a.user_id === artistId || a.id === artistId);
    const label = target ? (target.name || target.username || artistId) : artistId;

    if (!confirm(`¿Eliminar al artista "${label}"?\nEsta acción no se puede deshacer.`)) return;

    try {
        if (isDemo) {
            const currentDemoArtists = window.ConfigManager.getDemoArtists();
            const newList = currentDemoArtists.filter(a => a.userId !== artistId);
            window.ConfigManager.setValue('demoArtists', newList);
            showToast('Artista eliminado (Demo)', 'success');
        } else {
            // user_id is nullable (registration drafts / imported artists), so
            // the primary key `id` is the reliable identifier. Resolve both
            // from the loaded row and let the server prefer `id`.
            const pkId = (target && target.id) || (UUID_RE_CLIENT.test(String(artistId)) ? artistId : null);
            const uId = (target && target.user_id) || null;
            if (!pkId && !uId) throw new Error('No se pudo resolver el artista — recarga la lista e inténtalo de nuevo.');

            // Delete server-side via the service-role key. Going through the
            // browser's anon/authenticated key would hit the "Support admins
            // can delete artists" RLS policy, which silently no-ops if the
            // session expired or the support row is unseeded. The server
            // endpoint bypasses RLS and is gated to the superadmin account.
            const headers = await _getApifyAuthHeaders();
            if (headers._noSession) {
                throw new Error('No hay sesión de superadmin. Inicia sesión otra vez en /backoffice/login.');
            }

            const response = await fetch('/api/admin/delete-artist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ id: pkId, userId: uId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `Error del servidor (HTTP ${response.status})`);
            }
            showToast('Artista eliminado de Supabase', 'success');
        }
        loadArtists();
    } catch (error) {
        console.error('Error deleting artist:', error);
        showToast('Error al eliminar: ' + describeArtistDbError(error), 'error');
    }
}

function deleteArtistFromModal() {
    const userId = getVal('artist-user-id') || getVal('artist-id');
    if (!userId) return;
    closeModal();
    deleteArtist(userId);
}

// ============ STUDIOS (studio accounts) ============
// Studios are a first-class user type owned by an auth.users row via
// studios.user_id. This block mirrors the artists CRUD: list + search/filter +
// paginate + edit (profile/brand/contact/status + password) + delete (which
// cascades sedes/memberships and removes the owning auth user server-side).
let currentStudios = [];
let currentStudiosPage = 1;
let studiosItemsPerPage = 15;
let editingStudio = null;

// Normalizes languages which PostgREST may return as a JS array (text[]) or,
// rarely, a "{a,b}" string. Always returns an array.
function studioLanguagesArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) {
        return value.replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
    }
    return [];
}

function studioInstagramHref(instagram) {
    const v = String(instagram || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return 'https://instagram.com/' + v.replace(/^@/, '');
}

async function loadStudios() {
    const colCount = 7;
    const searchTerm = (document.getElementById('search-studios')?.value || '').trim().toLowerCase();
    const filterVer = document.getElementById('filter-studios-verified')?.value || '';
    const filterActive = document.getElementById('filter-studios-active')?.value || '';

    showTableLoading('studios-tbody', colCount);

    try {
        const result = await _fetchAdminJson('/api/admin/studios');
        let studios = (result.studios || []).map(s => ({
            ...s,
            languages: studioLanguagesArray(s.languages)
        }));

        if (searchTerm) {
            studios = studios.filter(s => {
                const haystack = [
                    s.name, s.slug, s.email, s.instagram, s.tiktok, s.whatsapp,
                    s.contact_phone, s.phone, s.tagline,
                    s.primary_city, s.primary_country, s.city, s.country
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(searchTerm);
            });
        }
        if (filterVer) studios = studios.filter(s => (filterVer === 'yes') === Boolean(s.is_verified));
        if (filterActive) studios = studios.filter(s => (filterActive === 'yes') === Boolean(s.is_active));

        currentStudios = studios;
        currentStudiosPage = 1;
        renderStudiosTable();
        renderStudiosMeta(studios);
    } catch (error) {
        console.error('Error loading studios:', error);
        showTableErrorState('studios-tbody', colCount, 'No se pudieron cargar los estudios. Verifica tu conexion.', 'loadStudios()');
        showToast('Error cargando estudios: ' + error.message, 'error');
    }
}

function renderStudiosMeta(studios) {
    const meta = document.getElementById('studios-table-meta');
    if (!meta) return;
    const total = studios.length;
    const verified = studios.filter(s => s.is_verified).length;
    const active = studios.filter(s => s.is_active).length;
    const sedes = studios.reduce((n, s) => n + (Number(s.location_count) || 0), 0);
    meta.innerHTML = `
        <span><strong>${total}</strong> estudios</span>
        <span><strong>${verified}</strong> verificados</span>
        <span><strong>${active}</strong> activos</span>
        <span><strong>${sedes}</strong> sedes</span>
    `;
}

function renderStudiosTable() {
    const tbody = document.getElementById('studios-tbody');
    const colCount = 7;
    const start = (currentStudiosPage - 1) * studiosItemsPerPage;
    const end = start + parseInt(studiosItemsPerPage);
    const pageItems = currentStudios.slice(start, end);

    if (pageItems.length === 0) {
        showTableEmptyState('studios-tbody', colCount, 'fa-store', 'No se encontraron estudios', 'Ajusta los filtros o espera nuevos registros.');
        return;
    }

    tbody.innerHTML = pageItems.map(s => {
        const initials = avatarInitials(s.name);
        const logo = s.logo_image || s.cover_image || '';
        const location = [s.primary_city || s.city, s.primary_country || s.country].filter(Boolean).join(', ');
        const sedes = Number(s.location_count) || 0;
        const created = s.created_at
            ? new Date(s.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';
        const igHref = studioInstagramHref(s.instagram);
        const safeId = escapeHtml(s.id || '');
        const verifiedBadge = s.is_verified
            ? '<span class="status-badge verified">Verificado</span>'
            : '<span class="status-badge not-verified">No verif.</span>';
        const activeBadge = s.is_active
            ? '<span class="status-badge success">Activo</span>'
            : '<span class="status-badge error">Inactivo</span>';

        return `
            <tr>
                <td>
                    <div class="artist-cell-identity">
                        <span class="avatar">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : escapeHtml(initials)}</span>
                        <div class="artist-meta">
                            <strong title="${escapeHtml(s.name || '')}">${escapeHtml(s.name || '—')}</strong>
                            <small title="${escapeHtml(s.slug || '')}">${s.slug ? '/' + escapeHtml(s.slug) : '—'}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="artist-cell-contact">
                        ${s.email ? `<a href="mailto:${escapeHtml(s.email)}" title="${escapeHtml(s.email)}"><i class="fa-solid fa-envelope"></i> ${escapeHtml(s.email)}</a>` : '<span>—</span>'}
                        ${igHref ? `<a href="${escapeHtml(igHref)}" target="_blank" rel="noopener"><i class="fa-brands fa-instagram"></i> Instagram</a>` : ''}
                        ${s.whatsapp ? `<span title="${escapeHtml(s.whatsapp)}"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(s.whatsapp)}</span>` : ''}
                    </div>
                </td>
                <td><span class="truncate-text" title="${escapeHtml(location)}">${escapeHtml(location || '—')}</span></td>
                <td>${sedes}</td>
                <td><div class="action-buttons" style="gap:4px;">${verifiedBadge} ${activeBadge}</div></td>
                <td>${created}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-secondary btn-sm" onclick="openStudioDetail('${safeId}')" title="Administrar estudio">
                            <i class="fa-solid fa-sliders"></i> Administrar
                        </button>
                        <button class="btn-icon danger-hover" onclick="deleteStudio('${safeId}')" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderStudiosPagination();
}

function renderStudiosPagination() {
    const totalPages = Math.ceil(currentStudios.length / studiosItemsPerPage);
    const container = document.getElementById('studios-pagination');
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentStudiosPage ? 'active' : ''}" onclick="goToStudiosPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

function goToStudiosPage(page) {
    currentStudiosPage = page;
    renderStudiosTable();
}

function changeStudiosItemsPerPage(value) {
    studiosItemsPerPage = parseInt(value);
    currentStudiosPage = 1;
    renderStudiosTable();
}

function editStudio(id) {
    const s = currentStudios.find(x => x.id === id);
    if (!s) { showToast('Estudio no encontrado — recarga la lista.', 'error'); return; }
    editingStudio = s;

    setVal('studio-id', s.id);
    setVal('studio-user-id', s.user_id || '');
    setVal('studio-name', s.name);
    setVal('studio-slug', s.slug);
    setVal('studio-email', s.email);
    setVal('studio-founded-year', s.founded_year);
    setVal('studio-new-password', '');
    setVal('studio-tagline', s.tagline);
    setVal('studio-bio', s.bio);
    setVal('studio-cover-image', s.cover_image);
    setVal('studio-logo-image', s.logo_image);
    setVal('studio-languages', studioLanguagesArray(s.languages).join(', '));
    setVal('studio-instagram', s.instagram);
    setVal('studio-tiktok', s.tiktok);
    setVal('studio-whatsapp', s.whatsapp);
    setVal('studio-contact-phone', s.contact_phone);
    setVal('studio-phone', s.phone);
    setVal('studio-website', s.website);
    setVal('studio-is-verified', s.is_verified);
    setVal('studio-is-active', s.is_active);
    setVal('studio-profile-complete', s.profile_complete);

    const meta = document.getElementById('studio-modal-meta');
    if (meta) {
        meta.innerHTML = `
            <span><strong>ID:</strong> ${escapeHtml(s.id)}</span>
            <span><strong>Cuenta:</strong> ${s.user_id ? escapeHtml(s.user_id) : 'sin cuenta de acceso'}</span>
            <span><strong>Sedes:</strong> ${Number(s.location_count) || 0}</span>
        `;
    }
    document.getElementById('studio-modal-title').textContent = 'Editar Estudio';
    openModal('studio-modal');
}

async function saveStudio(event) {
    event.preventDefault();

    const id = getVal('studio-id');
    if (!id) { showToast('Falta el ID del estudio — abre el estudio desde la tabla.', 'error'); return; }

    const newPassword = getVal('studio-new-password');
    if (newPassword && newPassword.length < 6) {
        showToast('La nueva contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }
    const authUserId = (editingStudio && editingStudio.user_id) || getVal('studio-user-id') || '';
    const foundedRaw = getVal('studio-founded-year');

    const updates = {
        name: getVal('studio-name'),
        slug: getVal('studio-slug') || null,
        email: getVal('studio-email'),
        founded_year: foundedRaw === '' ? null : Number(foundedRaw),
        tagline: getVal('studio-tagline') || null,
        bio: getVal('studio-bio') || null,
        cover_image: getVal('studio-cover-image') || null,
        logo_image: getVal('studio-logo-image') || null,
        languages: csvToArray(getVal('studio-languages')),
        instagram: getVal('studio-instagram') || null,
        tiktok: getVal('studio-tiktok') || null,
        whatsapp: getVal('studio-whatsapp') || null,
        contact_phone: getVal('studio-contact-phone') || null,
        phone: getVal('studio-phone') || null,
        website: getVal('studio-website') || null,
        is_verified: getVal('studio-is-verified'),
        is_active: getVal('studio-is-active'),
        profile_complete: getVal('studio-profile-complete')
    };

    try {
        await _fetchAdminJson(`/api/admin/studios/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });

        let passwordApplied = false;
        if (newPassword) {
            if (!authUserId) {
                showToast('Este estudio no tiene cuenta de acceso: no se puede asignar contraseña.', 'warning');
            } else {
                await _fetchAdminJson('/api/admin/update-user-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: authUserId, newPassword })
                });
                passwordApplied = true;
            }
        }

        showToast(passwordApplied ? 'Estudio y contraseña actualizados' : 'Estudio actualizado en Supabase', 'success');
        closeModal();
        loadStudios();
    } catch (error) {
        console.error('Error saving studio:', error);
        showToast('Error al guardar: ' + error.message, 'error');
    }
}

async function deleteStudio(id) {
    const s = currentStudios.find(x => x.id === id);
    const label = s ? (s.name || id) : id;
    if (!confirm(`¿Eliminar el estudio "${label}"?\nSe borrarán sus sedes, membresías y su cuenta de acceso. Esta acción no se puede deshacer.`)) return;

    try {
        await _fetchAdminJson('/api/admin/delete-studio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        showToast('Estudio eliminado de Supabase', 'success');
        loadStudios();
    } catch (error) {
        console.error('Error deleting studio:', error);
        showToast('Error al eliminar: ' + error.message, 'error');
    }
}

function deleteStudioFromModal() {
    const id = getVal('studio-id');
    if (!id) return;
    closeModal();
    deleteStudio(id);
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

// Artists section: live search + filters. The previous version had no
// listener at all, which is why typing in the search box did nothing.
document.getElementById('search-artists')?.addEventListener('input', debounce(loadArtists, 300));
document.getElementById('filter-artists-embajador')?.addEventListener('change', loadArtists);
document.getElementById('filter-artists-verification')?.addEventListener('change', loadArtists);

// Studios section: same live search + filters pattern as artists.
document.getElementById('search-studios')?.addEventListener('input', debounce(loadStudios, 300));
document.getElementById('filter-studios-verified')?.addEventListener('change', loadStudios);
document.getElementById('filter-studios-active')?.addEventListener('change', loadStudios);

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
let currentTableName = '';
let tableInspectorPage = 1;
const tableInspectorPerPage = 20;
// Inspector edit/delete state. `currentTableIsView` disables row actions for
// read-only views; `tableKindByName` is filled from the tables grid; `count`
// drives pagination; `currentRowEditKey` remembers which row the editor is on.
let currentTableIsView = false;
let tableInspectorCount = 0;
const tableKindByName = {};
let currentRowEditKey = null;

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
    const supabaseConfigured = Boolean(document.getElementById('api-supabase-url')?.value.trim());
    updateAPIStatus('supabase', supabaseConfigured ? 'configured' : 'none');
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

    // Apify lives in app_settings (server-side), not localStorage. Fetch async.
    if (typeof loadApifySavedInfo === 'function') {
        loadApifySavedInfo();
    }
    // Wire the stats panel: data loads on first <details> open.
    if (typeof _wireApifyStatsPanel === 'function') {
        _wireApifyStatsPanel();
    }
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

async function legacySupabaseBrowserAPITest() {
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

async function testSupabaseAPI() {
    const url = document.getElementById('api-supabase-url')?.value.trim() || '';
    const key = document.getElementById('api-supabase-key')?.value.trim() || '';

    showToast('Probando conexion...', 'info');
    updateAPIStatus('supabase', 'none');

    try {
        const result = await _fetchAdminJson('/api/admin/database/tables');
        const artistsTable = (result.tables || []).find(table => table.name === 'artists_db');
        const count = artistsTable && typeof artistsTable.count === 'number' ? artistsTable.count : 0;

        updateAPIStatus('supabase', 'connected');
        if (url && key) updateConnectionStatus(true);
        showToast(`Conexion exitosa. ${count} artistas encontrados.`, 'success');
    } catch (err) {
        updateAPIStatus('supabase', 'error');
        updateConnectionStatus(false);
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

// ============================================
// APIFY (Instagram import) — uses server-side app_settings
// ============================================

async function _getApifyAuthHeaders() {
    const client = window.ConfigManager?.getSupabaseClient?.() || window.supabaseClient || null;
    if (!client || !client.auth) return { _noSession: true };
    try {
        const { data } = await client.auth.getSession();
        const token = data && data.session && data.session.access_token;
        return token ? { 'Authorization': `Bearer ${token}` } : { _noSession: true };
    } catch (e) {
        return { _noSession: true };
    }
}

async function _fetchAdminJson(url, options = {}) {
    const authHeaders = await _getApifyAuthHeaders();
    if (authHeaders._noSession) {
        throw new Error('No hay sesion de superadmin activa');
    }

    const headers = {
        ...(options.headers || {}),
        ...authHeaders
    };

    const response = await fetch(url, {
        ...options,
        headers
    });
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { error: text };
        }
    }

    if (!response.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
}

function _apifyNoSessionHTML() {
    return '<div style="padding:10px; background:#3a2a1a; border:1px solid #d80; border-radius:6px; color:#fda; font-size:12px; line-height:1.5;">'
        + '<strong>No hay sesion de superadmin.</strong> Inicia sesion en <a href="/backoffice/login" style="color:#ffd86b; text-decoration:underline;">/backoffice/login</a> y vuelve a esta seccion.'
        + '</div>';
}

function _renderApifyResult(target, html) {
    target.style.display = 'block';
    target.innerHTML = html;
}

function _renderApifySavedInfo(meta) {
    const wrap = document.getElementById('api-apify-saved-info');
    const mask = document.getElementById('api-apify-saved-mask');
    const updated = document.getElementById('api-apify-saved-updated');
    if (!wrap || !mask || !updated) return;
    if (meta && meta.configured) {
        wrap.style.display = '';
        mask.textContent = meta.last_chars ? `••••••${meta.last_chars}` : '••••••';
        updated.textContent = meta.updated_at
            ? new Date(meta.updated_at).toLocaleString()
            : '—';
        updateAPIStatus('apify', 'configured');
    } else {
        wrap.style.display = 'none';
        mask.textContent = '••••••';
        updated.textContent = '—';
        updateAPIStatus('apify', 'none');
    }
}

async function loadApifySavedInfo() {
    try {
        const headers = await _getApifyAuthHeaders();
        if (headers._noSession) {
            updateAPIStatus('apify', 'none');
            const result = document.getElementById('api-apify-result');
            if (result) _renderApifyResult(result, _apifyNoSessionHTML());
            return;
        }
        const res = await fetch('/api/admin/integrations/apify', { headers });
        if (res.status === 401 || res.status === 403) {
            // Token rejected by server — same message as missing session.
            updateAPIStatus('apify', 'none');
            const result = document.getElementById('api-apify-result');
            if (result) _renderApifyResult(result, _apifyNoSessionHTML());
            return;
        }
        if (!res.ok) {
            updateAPIStatus('apify', 'error');
            return;
        }
        const data = await res.json();
        if (data && data.success) _renderApifySavedInfo(data);
    } catch (err) {
        console.warn('[Apify] could not load saved info:', err.message);
        updateAPIStatus('apify', 'none');
    }
}

// ---- Stats panel (imports/day + cost USD) ----------------------------------

let _apifyStatsLoaded = false;
let _apifyStatsChart = null;

function _wireApifyStatsPanel() {
    const panel = document.getElementById('api-apify-stats-panel');
    if (!panel || panel.dataset.wired === 'true') return;
    panel.dataset.wired = 'true';
    panel.addEventListener('toggle', () => {
        if (panel.open && !_apifyStatsLoaded) {
            loadApifyStats();
        }
    });
}

function _renderRecentRow(row) {
    const fields = row.imported_fields || {};
    const tags = [];
    if (fields.bio) tags.push('bio');
    if (fields.bio_link) tags.push('link');
    if (fields.location) tags.push('loc');
    if (fields.photos) tags.push(`${fields.photos} fotos`);
    if (fields.reels) tags.push(`${fields.reels} reels`);
    const cost = Number(row.cost_estimate_usd || 0).toFixed(4);
    const date = new Date(row.created_at).toLocaleString();
    const targetLabel = row.target === 'studio' ? 'studio' : 'artista';
    return `
        <tr style="border-top:1px solid #222;">
            <td style="padding:6px 8px; color:#ddd;">@${escapeHtmlSafe(row.ig_handle)}</td>
            <td style="padding:6px 8px; color:#aaa;">${targetLabel}</td>
            <td style="padding:6px 8px; color:#aaa;">${tags.join(', ') || '—'}</td>
            <td style="padding:6px 8px; color:#aaa; text-align:right;">$${cost}</td>
            <td style="padding:6px 8px; color:#777; font-size:11px;">${date}</td>
        </tr>
    `;
}

function escapeHtmlSafe(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadApifyStats() {
    const body = document.getElementById('api-apify-stats-body');
    if (!body) return;

    try {
        const headers = await _getApifyAuthHeaders();
        if (headers._noSession) {
            body.innerHTML = _apifyNoSessionHTML();
            return;
        }
        const res = await fetch('/api/admin/integrations/apify/stats', { headers });
        if (!res.ok) {
            body.innerHTML = `<div style="color:#f5a; padding:8px 0;">Error ${res.status}: no se pudieron cargar las estadísticas</div>`;
            return;
        }
        const data = await res.json();
        if (!data.success) {
            body.innerHTML = `<div style="color:#f5a; padding:8px 0;">${data.error || 'Error desconocido'}</div>`;
            return;
        }
        _apifyStatsLoaded = true;
        _renderApifyStats(body, data);
    } catch (err) {
        body.innerHTML = `<div style="color:#f5a; padding:8px 0;">No se conectó: ${err.message}</div>`;
    }
}

function _renderApifyStats(container, data) {
    const t = data.totals || {};
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const daily = Array.isArray(data.daily) ? data.daily : [];

    container.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:14px;">
            <div style="background:#0f0f0f; border:1px solid #2a2a2a; border-radius:6px; padding:10px;">
                <div style="color:#888; font-size:11px; text-transform:uppercase;">7 días</div>
                <div style="color:#fff; font-size:20px; font-weight:600; margin-top:4px;">${t.imports_7d || 0}</div>
            </div>
            <div style="background:#0f0f0f; border:1px solid #2a2a2a; border-radius:6px; padding:10px;">
                <div style="color:#888; font-size:11px; text-transform:uppercase;">30 días</div>
                <div style="color:#fff; font-size:20px; font-weight:600; margin-top:4px;">${t.imports_30d || 0}</div>
            </div>
            <div style="background:#0f0f0f; border:1px solid #2a2a2a; border-radius:6px; padding:10px;">
                <div style="color:#888; font-size:11px; text-transform:uppercase;">Total</div>
                <div style="color:#fff; font-size:20px; font-weight:600; margin-top:4px;">${t.imports_total || 0}</div>
            </div>
            <div style="background:#0f0f0f; border:1px solid #5a3d20; border-radius:6px; padding:10px;">
                <div style="color:#ddc7a8; font-size:11px; text-transform:uppercase;">Costo total</div>
                <div style="color:#ffd86b; font-size:20px; font-weight:600; margin-top:4px;">$${Number(t.cost_total_usd || 0).toFixed(4)}</div>
            </div>
        </div>

        <div style="margin-bottom:18px;">
            <div style="color:#aaa; font-size:11px; text-transform:uppercase; margin-bottom:6px;">Imports por día (últimos 14)</div>
            <div style="background:#0f0f0f; border:1px solid #2a2a2a; border-radius:6px; padding:10px; height:160px;">
                <canvas id="api-apify-stats-chart"></canvas>
            </div>
        </div>

        <div>
            <div style="color:#aaa; font-size:11px; text-transform:uppercase; margin-bottom:6px;">Últimos imports</div>
            ${recent.length === 0 ? '<div style="color:#666; padding:8px 0;">Aún no hay imports.</div>' : `
            <div style="background:#0f0f0f; border:1px solid #2a2a2a; border-radius:6px; overflow:hidden;">
                <table style="width:100%; border-collapse:collapse; font-size:11px;">
                    <thead>
                        <tr style="background:#161616; color:#888; text-transform:uppercase; font-size:10px;">
                            <th style="padding:6px 8px; text-align:left;">Handle</th>
                            <th style="padding:6px 8px; text-align:left;">Tipo</th>
                            <th style="padding:6px 8px; text-align:left;">Importado</th>
                            <th style="padding:6px 8px; text-align:right;">Costo</th>
                            <th style="padding:6px 8px; text-align:left;">Fecha</th>
                        </tr>
                    </thead>
                    <tbody>${recent.map(_renderRecentRow).join('')}</tbody>
                </table>
            </div>
            `}
        </div>
    `;

    if (window.Chart && daily.length > 0) {
        const ctx = document.getElementById('api-apify-stats-chart');
        if (_apifyStatsChart) _apifyStatsChart.destroy();
        _apifyStatsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: daily.map(d => d.day.slice(5)), // MM-DD
                datasets: [{
                    label: 'Imports',
                    data: daily.map(d => d.count),
                    backgroundColor: 'rgba(193, 53, 132, 0.6)',
                    borderColor: 'rgba(193, 53, 132, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: '#888', font: { size: 10 }, stepSize: 1 }, grid: { color: '#222' } }
                }
            }
        });
    }
}

async function saveApifyAPI() {
    const tokenInput = document.getElementById('api-apify-token');
    const token = (tokenInput && tokenInput.value || '').trim();
    if (!token) {
        showToast('Pega el token de Apify primero', 'error');
        return;
    }

    try {
        const headers = await _getApifyAuthHeaders();
        if (headers._noSession) {
            const result = document.getElementById('api-apify-result');
            if (result) _renderApifyResult(result, _apifyNoSessionHTML());
            showToast('Inicia sesión como admin primero', 'error');
            return;
        }
        const res = await fetch('/api/admin/integrations/apify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            const msg = (data && data.error) || `HTTP ${res.status}`;
            updateAPIStatus('apify', 'error');
            showToast('No se pudo guardar: ' + msg, 'error');
            return;
        }
        _renderApifySavedInfo(data);
        if (tokenInput) tokenInput.value = '';
        showToast('Token de Apify guardado', 'success');
    } catch (err) {
        updateAPIStatus('apify', 'error');
        showToast('Error guardando: ' + err.message, 'error');
    }
}

async function testApifyAPI() {
    const tokenInput = document.getElementById('api-apify-token');
    const handleInput = document.getElementById('api-apify-test-handle');
    const result = document.getElementById('api-apify-result');
    const tokenInForm = (tokenInput && tokenInput.value || '').trim();
    const handle = ((handleInput && handleInput.value) || 'instagram').trim().replace(/^@/, '');

    _renderApifyResult(result, '<div style="padding:10px; color:#aaa;">Probando contra Apify…</div>');
    updateAPIStatus('apify', 'none');

    try {
        const headers = await _getApifyAuthHeaders();
        if (headers._noSession) {
            updateAPIStatus('apify', 'none');
            _renderApifyResult(result, _apifyNoSessionHTML());
            return;
        }
        const body = { handle };
        if (tokenInForm) body.token = tokenInForm; // pre-save test
        const res = await fetch('/api/admin/integrations/apify/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body)
        });
        if (res.status === 401 || res.status === 403) {
            updateAPIStatus('apify', 'none');
            _renderApifyResult(result, _apifyNoSessionHTML());
            return;
        }
        const data = await res.json();

        if (!data.success) {
            updateAPIStatus('apify', 'error');
            _renderApifyResult(result, `<div style="padding:10px; background:#3a1a1a; border:1px solid #d33; border-radius:6px; color:#fdd; font-size:12px;">Falló: ${data.error || 'desconocido'}</div>`);
            return;
        }
        if (!data.ok) {
            updateAPIStatus('apify', 'error');
            const reasons = {
                invalid_token: 'Token inválido',
                private_profile: 'El perfil de prueba es privado, intenta otro',
                empty_dataset: 'Apify no devolvió datos para ese handle',
                apify_error: `Apify respondió ${data.http_status}`
            };
            _renderApifyResult(result, `<div style="padding:10px; background:#3a2a1a; border:1px solid #d80; border-radius:6px; color:#fda; font-size:12px;">${reasons[data.reason] || data.reason}</div>`);
            return;
        }

        updateAPIStatus('apify', 'connected');
        const s = data.sample;
        _renderApifyResult(result, `
            <div style="padding:12px; background:#1a3a1a; border:1px solid #4d4; border-radius:6px; color:#dfd; font-size:12px; line-height:1.6;">
                <div><strong>✓ Token válido</strong> · Latencia: ${data.elapsedMs} ms</div>
                <div style="margin-top:8px; color:#cfc;">
                    <div>Handle:        <strong>@${s.username}</strong></div>
                    <div>Nombre:        ${s.fullName || '—'}</div>
                    <div>Bio:           ${s.hasBio ? 'Sí' : 'No'}</div>
                    <div>Enlace bio:    ${s.hasExternalUrl ? 'Sí' : 'No'}</div>
                    <div>Posts traídos: ${s.postsReturned}</div>
                    <div>Followers:     ${s.followersCount != null ? s.followersCount.toLocaleString() : '—'}</div>
                </div>
            </div>
        `);
    } catch (err) {
        updateAPIStatus('apify', 'error');
        _renderApifyResult(result, `<div style="padding:10px; background:#3a1a1a; border:1px solid #d33; border-radius:6px; color:#fdd; font-size:12px;">Error: ${err.message}</div>`);
    }
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
    'support_users_db'
];

async function loadDatabaseSection() {
    await loadDatabaseStats();
}

async function loadDatabaseStats() {
    const healthIndicator = document.getElementById('db-health-indicator');
    const tablesGrid = document.getElementById('tables-grid');

    healthIndicator.className = 'db-health-indicator';
    healthIndicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Cargando...</span>';
    showSectionLoading('tables-grid');

    try {
        const result = await _fetchAdminJson('/api/admin/database/tables');
        const tables = Array.isArray(result.tables) ? result.tables : [];
        const totalRows = tables.reduce((sum, table) => (
            typeof table.count === 'number' ? sum + table.count : sum
        ), 0);

        healthIndicator.className = 'db-health-indicator connected';
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Conectado al API</span>';
        document.getElementById('db-total-tables').textContent = tables.length;
        document.getElementById('db-total-rows').textContent = totalRows.toLocaleString();

        tablesGrid.innerHTML = tables.map(table => {
            const isError = Boolean(table.error);
            const count = isError ? 'Error' : (table.count ?? 0);
            const description = table.description ? ` title="${escapeHtml(table.description)}"` : '';
            const kind = table.kind === 'view' ? 'view' : 'table';
            tableKindByName[table.name] = kind;
            const icon = kind === 'view' ? 'fa-eye' : 'fa-table';
            const viewBadge = kind === 'view'
                ? '<span class="badge-sm" title="Vista de solo lectura" style="margin-left:6px;background:rgba(59,130,246,0.15);color:#3b82f6;">vista</span>'
                : '';

            return `
                <div class="table-card" onclick="inspectTable('${table.name}', '${kind}')"${description}>
                    <div class="table-card-header">
                        <div class="table-card-name">
                            <i class="fa-solid ${icon}"></i>
                            <span>${table.name}</span>${viewBadge}
                        </div>
                        <span class="table-card-count ${isError ? 'error' : ''}">${isError ? 'Error' : count}</span>
                    </div>
                    <div class="table-card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); exportTable('${table.name}')">
                            <i class="fa-solid fa-download"></i> Exportar
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        healthIndicator.className = 'db-health-indicator disconnected';
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Error de conexion</span>';
        showEmptyState('tables-grid', 'fa-plug', 'Sin conexion a Supabase', err.message || 'No se pudieron cargar las tablas desde el API.');
        showToast('Error: ' + err.message, 'error');
    }
}

async function inspectTable(tableName, kind) {
    currentTableName = tableName;
    currentTableIsView = (kind || tableKindByName[tableName]) === 'view';
    tableInspectorPage = 1;

    const titleEl = document.getElementById('table-inspector-title');
    titleEl.textContent = `${currentTableIsView ? 'Vista' : 'Tabla'}: ${tableName}`;
    showToast('Cargando datos...', 'info');

    try {
        await loadInspectorPage(1);
        openModal('table-inspector-modal');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// Fetches one page of the current table from the admin API and re-renders the
// inspector. Used by inspectTable, the pagination buttons, and the row
// edit/delete handlers (to refresh after a write). 1-based page.
async function loadInspectorPage(page) {
    const offset = (page - 1) * tableInspectorPerPage;
    const params = new URLSearchParams({
        limit: String(tableInspectorPerPage),
        offset: String(offset)
    });
    const result = await _fetchAdminJson(`/api/admin/database/tables/${encodeURIComponent(currentTableName)}?${params}`);
    tableInspectorCount = result.count ?? (result.rows ? result.rows.length : 0);
    tableInspectorPage = page;
    currentTableData = result.rows || [];

    const countEl = document.getElementById('table-inspector-count');
    if (countEl) {
        countEl.textContent = `${tableInspectorCount} registros${currentTableIsView ? ' · vista de solo lectura' : ''}`;
    }
    renderTableInspector(currentTableData);
    renderTableInspectorPagination();
}

async function exportTable(tableName) {
    showToast(`Exportando ${tableName}...`, 'info');

    try {
        const params = new URLSearchParams({ limit: '1000', offset: '0' });
        const result = await _fetchAdminJson(`/api/admin/database/tables/${encodeURIComponent(tableName)}?${params}`);
        const data = result.rows || [];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        saveAs(blob, `${tableName}-${new Date().toISOString().split('T')[0]}.json`);
        showToast('Tabla exportada', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function exportAllTables() {
    showToast('Exportando todas las tablas...', 'info');

    const zip = new JSZip();

    try {
        const result = await _fetchAdminJson('/api/admin/database/tables');
        const tables = Array.isArray(result.tables) ? result.tables : [];

        for (const table of tables) {
            try {
                const params = new URLSearchParams({ limit: '1000', offset: '0' });
                const tableResult = await _fetchAdminJson(`/api/admin/database/tables/${encodeURIComponent(table.name)}?${params}`);
                zip.file(`${table.name}.json`, JSON.stringify(tableResult.rows || [], null, 2));
            } catch (err) {
                console.warn(`Could not export ${table.name}:`, err);
            }
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `weotzi-database-${new Date().toISOString().split('T')[0]}.zip`);
        showToast('Base de datos exportada', 'success');
    } catch (err) {
        showToast('Error al exportar base de datos: ' + err.message, 'error');
    }
}

function renderTableInspector(data) {
    const thead = document.getElementById('table-inspector-head');
    const tbody = document.getElementById('table-inspector-body');
    const showActions = !currentTableIsView;

    if (!data || data.length === 0) {
        thead.innerHTML = '<tr><th>Sin datos</th></tr>';
        tbody.innerHTML = '<tr><td class="empty-state">Esta tabla está vacía</td></tr>';
        return;
    }

    const columns = Object.keys(data[0]);

    // Header (+ Acciones column for writable tables).
    thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}${showActions ? '<th>Acciones</th>' : ''}</tr>`;

    // Rows. Values are escaped (admin data is untrusted) and truncated for the
    // grid; the full value is available in the row editor / via title tooltips.
    tbody.innerHTML = data.map((row, i) => {
        const cells = columns.map(col => {
            const raw = row[col];
            let html;
            if (raw === null || raw === undefined) {
                html = '<span class="text-muted">null</span>';
            } else if (typeof raw === 'object') {
                const json = JSON.stringify(raw);
                html = `<code title="${escapeHtml(json)}">${escapeHtml(json.length > 60 ? json.slice(0, 60) + '…' : json)}</code>`;
            } else {
                const str = String(raw);
                html = escapeHtml(str.length > 80 ? str.slice(0, 80) + '…' : str);
            }
            return `<td>${html}</td>`;
        }).join('');

        let actions = '';
        if (showActions) {
            const key = pickRowKey(row);
            actions = key
                ? `<td><div class="action-buttons">
                        <button class="btn-icon" onclick="editTableRow(${i})" title="Editar fila"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-icon danger-hover" onclick="deleteTableRow(${i})" title="Borrar fila"><i class="fa-solid fa-trash"></i></button>
                    </div></td>`
                : '<td><span class="text-muted" title="Sin clave única detectada en esta fila">—</span></td>';
        }
        return `<tr>${cells}${actions}</tr>`;
    }).join('');
}

// Columns tried, in order, to identify a row for edit/delete. The generic
// inspector has no schema knowledge, so it picks the first present unique-ish
// column; falls back to the first scalar column otherwise.
const ROW_KEY_PRIORITY = ['id', 'user_id', 'setting_key', 'uuid', 'slug', 'key'];
function pickRowKey(row) {
    for (const col of ROW_KEY_PRIORITY) {
        const v = row[col];
        if (v !== undefined && v !== null && typeof v !== 'object' && String(v) !== '') {
            return { column: col, value: v };
        }
    }
    for (const col of Object.keys(row)) {
        const v = row[col];
        if (v !== undefined && v !== null && typeof v !== 'object' && String(v) !== '') {
            return { column: col, value: v };
        }
    }
    return null;
}

function renderTableInspectorPagination() {
    const container = document.getElementById('table-inspector-pagination');
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil((tableInspectorCount || 0) / tableInspectorPerPage));
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const cur = tableInspectorPage;
    container.innerHTML = `
        <button ${cur <= 1 ? 'disabled' : ''} onclick="gotoInspectorPage(${cur - 1})"><i class="fa-solid fa-chevron-left"></i></button>
        <span style="padding:0 10px;">Página ${cur} de ${totalPages}</span>
        <button ${cur >= totalPages ? 'disabled' : ''} onclick="gotoInspectorPage(${cur + 1})"><i class="fa-solid fa-chevron-right"></i></button>
    `;
}

async function gotoInspectorPage(page) {
    const totalPages = Math.max(1, Math.ceil((tableInspectorCount || 0) / tableInspectorPerPage));
    if (page < 1 || page > totalPages) return;
    try { await loadInspectorPage(page); }
    catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// Opens the generic row editor for the row at `index` in the current page.
// ============ GENERIC ROW EDITOR (shared) ============
// Used by the DB inspector AND the studio Operaciones tables. One editor, two
// callers — each passes its own onSaved() reload. Supports edit mode (PATCH
// only changed fields) and create mode (POST non-empty fields), plus a raw-JSON
// fallback for inserting into an empty table whose columns we can't infer.
let currentRowEditorCtx = null;

function _coerceRowField(el) {
    const type = el.getAttribute('data-type');
    const v = el.value;
    if (type === 'json') { const t = v.trim(); return t === '' ? null : JSON.parse(t); }
    if (type === 'bool') return v === 'true';
    if (type === 'number') {
        if (v === '') return null;
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`"${el.getAttribute('data-col')}" no es un número válido`);
        return n;
    }
    return v === '' ? null : v;
}

function _buildRowEditorFields(row, { idColumn, isNew, skipKeys = [] }) {
    return Object.keys(row).filter(c => !skipKeys.includes(c)).map(col => {
        const raw = row[col];
        const isKey = !isNew && col === idColumn;
        const fid = `rowedit-${col}`;
        const colAttr = escapeHtml(col);
        let control;
        if (raw !== null && typeof raw === 'object') {
            control = `<textarea id="${fid}" data-col="${colAttr}" data-type="json" rows="3" class="rowedit-input"${isKey ? ' readonly' : ''}>${escapeHtml(JSON.stringify(raw, null, 2))}</textarea>`;
        } else if (typeof raw === 'boolean') {
            control = `<select id="${fid}" data-col="${colAttr}" data-type="bool" class="rowedit-input">
                <option value="true" ${raw === true ? 'selected' : ''}>true</option>
                <option value="false" ${raw === false ? 'selected' : ''}>false</option>
            </select>`;
        } else {
            const val = (raw === null || raw === undefined) ? '' : String(raw);
            const type = typeof raw === 'number' ? 'number' : 'text';
            control = `<input id="${fid}" data-col="${colAttr}" data-type="${type}" class="rowedit-input" value="${escapeHtml(val)}"${isKey ? ' readonly' : ''}>`;
        }
        return `<div class="form-group">
            <label for="${fid}">${colAttr}${isKey ? ' <span class="badge-sm">clave</span>' : ''}</label>
            ${control}
        </div>`;
    }).join('');
}

function openRowEditor({ table, row, isNew = false, title, subtitle, idColumn, idValue, onSaved, raw = false }) {
    currentRowEditorCtx = { table, isNew, idColumn, idValue, original: row, onSaved, raw };
    document.getElementById('row-editor-title').textContent = title || (isNew ? `Nueva fila · ${table}` : `Editar fila · ${table}`);
    document.getElementById('row-editor-subtitle').innerHTML = subtitle == null
        ? (isNew
            ? 'Completá los campos. Los vacíos usan el valor por defecto de la tabla.'
            : `Identificada por <code>${escapeHtml(String(idColumn))} = ${escapeHtml(String(idValue))}</code>. Solo se guardan los campos que cambies. Vacío = <code>null</code>.`)
        : subtitle;

    const fieldsEl = document.getElementById('row-editor-fields');
    if (raw) {
        fieldsEl.innerHTML = `<div class="form-group">
            <label for="rowedit-rawjson">Fila (JSON)</label>
            <textarea id="rowedit-rawjson" rows="8" class="rowedit-input" style="font-family:monospace;">${escapeHtml(JSON.stringify(row, null, 2))}</textarea>
            <small class="form-hint">No se pudo inferir el esquema (tabla vacía). Editá el JSON de la fila a insertar.</small>
        </div>`;
    } else {
        const skipKeys = isNew ? ['id', 'created_at', 'updated_at'] : [];
        fieldsEl.innerHTML = _buildRowEditorFields(row, { idColumn, isNew, skipKeys });
    }
    openModal('row-editor-modal');
}

async function saveRowEditor(event) {
    event.preventDefault();
    const ctx = currentRowEditorCtx;
    if (!ctx) { showToast('No hay fila en edición.', 'error'); return; }
    const base = `/api/admin/database/tables/${encodeURIComponent(ctx.table)}/row`;

    try {
        const rawEl = document.getElementById('rowedit-rawjson');
        if (rawEl) {
            const values = JSON.parse(rawEl.value || '{}');
            await _fetchAdminJson(base, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values })
            });
        } else if (ctx.isNew) {
            const values = {};
            document.querySelectorAll('#row-editor-fields .rowedit-input').forEach(el => {
                const col = el.getAttribute('data-col');
                const coerced = _coerceRowField(el);
                // Only send filled fields so table defaults / NOT NULL apply.
                if (coerced !== null) values[col] = coerced;
            });
            if (Object.keys(values).length === 0) { showToast('Completá al menos un campo.', 'error'); return; }
            await _fetchAdminJson(base, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values })
            });
        } else {
            const original = ctx.original || {};
            const patch = {};
            document.querySelectorAll('#row-editor-fields .rowedit-input').forEach(el => {
                const col = el.getAttribute('data-col');
                if (col === ctx.idColumn) return;
                const coerced = _coerceRowField(el);
                const orig = original[col];
                const bothNull = (orig === null || orig === undefined) && (coerced === null || coerced === undefined);
                const changed = (orig !== null && typeof orig === 'object')
                    ? JSON.stringify(orig) !== JSON.stringify(coerced)
                    : orig !== coerced;
                if (changed && !bothNull) patch[col] = coerced;
            });
            if (Object.keys(patch).length === 0) { showToast('No hay cambios para guardar.', 'info'); closeModal(); return; }
            await _fetchAdminJson(base, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idColumn: ctx.idColumn, idValue: ctx.idValue, patch })
            });
        }
        showToast(ctx.isNew ? 'Fila creada' : 'Fila actualizada', 'success');
        closeModal();
        if (typeof ctx.onSaved === 'function') await ctx.onSaved();
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }
}

async function deleteRowGeneric(table, idColumn, idValue, label, onDeleted) {
    if (!confirm(`¿Borrar "${label}" de "${table}"?\nEsta acción no se puede deshacer.`)) return;
    try {
        await _fetchAdminJson(`/api/admin/database/tables/${encodeURIComponent(table)}/row`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idColumn, idValue })
        });
        showToast('Fila borrada', 'success');
        if (typeof onDeleted === 'function') await onDeleted();
    } catch (err) {
        showToast('Error al borrar: ' + err.message, 'error');
    }
}

// ---- DB inspector wrappers (operate on the current inspector page) ----
function editTableRow(index) {
    const row = currentTableData[index];
    if (!row) { showToast('Fila no encontrada — recarga la tabla.', 'error'); return; }
    const key = pickRowKey(row);
    if (!key) { showToast('No se detectó una clave única para esta fila; no se puede editar.', 'error'); return; }
    openRowEditor({
        table: currentTableName, row, isNew: false,
        idColumn: key.column, idValue: key.value,
        onSaved: () => loadInspectorPage(tableInspectorPage)
    });
}

async function deleteTableRow(index) {
    const row = currentTableData[index];
    if (!row) { showToast('Fila no encontrada — recarga la tabla.', 'error'); return; }
    const key = pickRowKey(row);
    if (!key) { showToast('No se detectó una clave única; no se puede borrar.', 'error'); return; }
    await deleteRowGeneric(currentTableName, key.column, key.value, String(key.value), () => {
        const remaining = Math.max(0, (tableInspectorCount || 1) - 1);
        const totalPages = Math.max(1, Math.ceil(remaining / tableInspectorPerPage));
        return loadInspectorPage(Math.min(tableInspectorPage, totalPages));
    });
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

// ============ ROUTES SECTION ============
let currentRoutes = {};
let routeHealthResults = {};

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
                'quotation_flow_config', 'support_users_db',
                'app_settings', 'session_logs', 'client_accounts'
            ];
            
            let tableCount = 0;
            for (const table of tables) {
                try {
                    const { data, error } = await WeotziData.from(table).select('*');
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

        const headers = await _getApifyAuthHeaders();
        if (headers._noSession) {
            throw new Error('No hay sesion de superadmin activa');
        }
        
        // Send to server to generate ZIP with installer
        const response = await fetch('/api/admin/generate-backup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
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
                const { data } = await WeotziData.from(table).select('*');
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
            const { data } = await WeotziData.from(table).select('*');
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
async function loadSupportUsersLegacy() {
    const tbody = document.getElementById('support-users-tbody');
    
    // Check if Supabase is available
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showTableEmptyState('support-users-tbody', 6, 'fa-plug', 'Sin conexion a Supabase', 'Configura la conexion para ver usuarios de soporte.');
        return;
    }

    showTableLoading('support-users-tbody', 6);

    try {
        const { data, error } = await WeotziData
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
async function editSupportUserLegacy(userId) {
    const client = window.ConfigManager?.getSupabaseClient();
    if (!client) {
        showToast('Error: Supabase no esta conectado', 'error');
        return;
    }
    
    try {
        const { data, error } = await WeotziData
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
async function saveSupportUserLegacy(event) {
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
            const { error: insertError } = await WeotziData
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
                const headers = await _getApifyAuthHeaders();
                if (headers._noSession) {
                    throw new Error('No hay sesion de superadmin activa');
                }

                const passwordResponse = await fetch('/api/admin/update-user-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
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
            const { error: updateError } = await WeotziData
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
async function toggleSupportUserStatusLegacy(userId, newStatus) {
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
        const { error } = await WeotziData
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

async function loadSupportUsers() {
    const tbody = document.getElementById('support-users-tbody');
    showTableLoading('support-users-tbody', 6);

    try {
        const result = await _fetchAdminJson('/api/admin/support-users');
        const data = result.users || [];

        if (!data || data.length === 0) {
            showTableEmptyState('support-users-tbody', 6, 'fa-headset', 'No hay usuarios de soporte', 'Crea el primer usuario con el boton de arriba.');
            return;
        }

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
        showToast('Error al cargar usuarios de soporte: ' + err.message, 'error');
    }
}

async function editSupportUser(userId) {
    try {
        const result = await _fetchAdminJson(`/api/admin/support-users/${encodeURIComponent(userId)}`);
        const data = result.user;
        if (!data) throw new Error('Usuario no encontrado');

        document.getElementById('support-user-id').value = data.user_id;
        document.getElementById('support-user-name').value = data.full_name || '';
        document.getElementById('support-user-email').value = data.email || '';
        document.getElementById('support-user-email').disabled = true;
        document.getElementById('support-user-role').value = data.role || 'support';
        document.getElementById('support-user-active').checked = data.is_active !== false;
        document.getElementById('support-user-password').value = '';
        document.getElementById('support-user-password').required = false;
        document.getElementById('support-user-password-group').style.display = 'none';
        document.getElementById('support-user-new-password').value = '';
        document.getElementById('support-user-change-password-group').style.display = 'block';
        document.getElementById('support-user-active-group').style.display = 'flex';
        document.getElementById('support-user-modal-title').textContent = 'Editar Usuario de Soporte';
        document.getElementById('support-user-modal').classList.add('active');
    } catch (err) {
        console.error('Error loading support user:', err);
        showToast('Error al cargar datos del usuario: ' + err.message, 'error');
    }
}

async function saveSupportUser(event) {
    event.preventDefault();

    const userId = document.getElementById('support-user-id').value;
    const fullName = document.getElementById('support-user-name').value.trim();
    const email = document.getElementById('support-user-email').value.trim().toLowerCase();
    const password = document.getElementById('support-user-password').value;
    const role = document.getElementById('support-user-role').value;
    const isActive = document.getElementById('support-user-active').checked;
    const isNewUser = !userId;

    try {
        if (isNewUser) {
            if (!password || password.length < 6) {
                showToast('La contrasena debe tener al menos 6 caracteres', 'error');
                return;
            }

            await _fetchAdminJson('/api/admin/support-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName, email, password, role, isActive: true })
            });
            showToast('Usuario de soporte creado exitosamente', 'success');
        } else {
            const newPassword = document.getElementById('support-user-new-password')?.value || '';
            if (newPassword) {
                if (newPassword.length < 6) {
                    showToast('La nueva contrasena debe tener al menos 6 caracteres', 'error');
                    return;
                }
                await _fetchAdminJson('/api/admin/update-user-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, newPassword })
                });
            }

            await _fetchAdminJson(`/api/admin/support-users/${encodeURIComponent(userId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName, role, isActive })
            });
            showToast(newPassword ? 'Usuario y contrasena actualizados' : 'Usuario de soporte actualizado', 'success');
        }

        closeModal();
        loadSupportUsers();
    } catch (err) {
        console.error('Error saving support user:', err);
        showToast('Error: ' + err.message, 'error');
    }
}

async function toggleSupportUserStatus(userId, newStatus) {
    const action = newStatus ? 'activar' : 'desactivar';
    if (!confirm(`Â¿Estas seguro de que quieres ${action} este usuario?`)) {
        return;
    }

    try {
        await _fetchAdminJson(`/api/admin/support-users/${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: newStatus })
        });
        showToast(`Usuario ${newStatus ? 'activado' : 'desactivado'} correctamente`, 'success');
        loadSupportUsers();
    } catch (err) {
        console.error('Error toggling support user status:', err);
        showToast('Error al cambiar estado del usuario: ' + err.message, 'error');
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


// ============ CURRENCY ADMIN ============
async function loadCurrenciesAdmin() {
    const tbody = document.getElementById('currencies-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8"><div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando monedas...</span></div></td></tr>';

    try {
        if (!supabaseClient) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 16px; opacity: 0.6;">Supabase no inicializado.</td></tr>';
            return;
        }

        const { data: currencies, error } = await WeotziData
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

        const { data: logs, error: logsErr } = await WeotziData
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
        const { error } = await WeotziData
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

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refrescando...'; }
    try {
        const authHeaders = typeof _getApifyAuthHeaders === 'function' ? await _getApifyAuthHeaders() : {};
        if (authHeaders._noSession) {
            throw new Error('Inicia sesion en /backoffice/login para refrescar monedas.');
        }
        const response = await fetch('/api/admin/currencies/refresh-now', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            },
            body: '{}'
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
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
window.gotoInspectorPage = gotoInspectorPage;
window.editTableRow = editTableRow;
window.deleteTableRow = deleteTableRow;
window.saveRowEditor = saveRowEditor;

// Studios (studio accounts) management
window.loadStudios = loadStudios;
window.editStudio = editStudio;
window.saveStudio = saveStudio;
window.deleteStudio = deleteStudio;
window.deleteStudioFromModal = deleteStudioFromModal;
window.goToStudiosPage = goToStudiosPage;
window.changeStudiosItemsPerPage = changeStudiosItemsPerPage;

// Studio detail (full-page admin)
window.openStudioDetail = openStudioDetail;
window.closeStudioDetail = closeStudioDetail;
window.reloadStudioDetail = reloadStudioDetail;
window.deleteStudioFromDetail = deleteStudioFromDetail;
window.switchStudioTab = switchStudioTab;
window.saveStudioGeneral = saveStudioGeneral;
window.saveStudioContact = saveStudioContact;
window.saveStudioImages = saveStudioImages;
window.openSedeForm = openSedeForm;
window.saveSede = saveSede;
window.deleteSedeFromModal = deleteSedeFromModal;
window.deleteSede = deleteSede;
window.openSpotForm = openSpotForm;
window.saveSpot = saveSpot;
window.deleteSpotFromModal = deleteSpotFromModal;
window.deleteSpot = deleteSpot;
window.setApplicationStatus = setApplicationStatus;
window.switchOpsTable = switchOpsTable;
window.addOpsRow = addOpsRow;
window.editOpsRow = editOpsRow;
window.deleteOpsRow = deleteOpsRow;
window.removeMembership = removeMembership;
window.editMembership = editMembership;
window.assignMembershipSede = assignMembershipSede;

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
    const quotationsChannel = WeotziData.Realtime.subscribeQuotationsForAdmin('dashboard-quotations', {
        onInsert: (payload) => {
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
        },
        onUpdate: (payload) => {
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
                'artist_completed': 'Lista para cliente',
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
        }
    });

    if (quotationsChannel) _realtimeChannels.push(quotationsChannel);

    // Channel: new artists
    const artistsChannel = WeotziData
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
    const applicationsChannel = WeotziData
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
        WeotziData.removeChannel(channel);
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

// Hook into showSection to manage subscriptions lifecycle
const _originalShowSection = showSection;
function showSectionWithRealtime(sectionId) {
    _originalShowSection(sectionId);

    if (sectionId === 'dashboard') {
        initRealtimeSubscriptions();
    } else {
        cleanupRealtimeSubscriptions();
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

// ============================================================
// STUDIO DETAIL — full-page studio administrator
// ============================================================
// Opens from the Estudios list ("Administrar"). One studio at a time, with
// lazy-loaded tabs. Child records (sedes, spots, roster, operaciones) are read
// via the generic studio_id-filtered table endpoint and written via the generic
// row INSERT/PATCH/DELETE endpoints. Images upload straight to the studio-photos
// bucket through WeOtziUploader; their URLs are saved via the studios PATCH.
let currentStudioDetail = null;
let currentStudioDetailId = null;
let sdLocations = [];
let sdSpots = [];
let sdRoster = [];
let sdCurrentSpotId = null;
let sdGalleryUploader = null;
let sedePhotosUploader = null;
let sedeWorkstationUploader = null;
let currentOpsTable = 'studio_inventory_items';
let currentOpsTitle = 'Inventario';
let sdOpsRows = [];

function _sdSupabase() {
    return (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient())
        || window.supabaseClient || window._supabase || null;
}

async function _sdFetchChildren(table, column, value, order) {
    const params = new URLSearchParams({ filterColumn: column, filterValue: value, limit: '1000' });
    if (order) params.set('order', order);
    const result = await _fetchAdminJson(`/api/admin/database/tables/${encodeURIComponent(table)}?${params}`);
    return result.rows || [];
}

function _sdStudioPatch(patch) {
    return _fetchAdminJson(`/api/admin/studios/${encodeURIComponent(currentStudioDetailId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    });
}

function _sdFmtCell(v) {
    if (v === null || v === undefined) return '<span class="text-muted">null</span>';
    if (typeof v === 'object') {
        const j = JSON.stringify(v);
        return `<code title="${escapeHtml(j)}">${escapeHtml(j.length > 50 ? j.slice(0, 50) + '…' : j)}</code>`;
    }
    const s = String(v);
    return escapeHtml(s.length > 60 ? s.slice(0, 60) + '…' : s);
}

// ---- Shell ----
async function openStudioDetail(id) {
    currentStudioDetailId = id;
    sdLocations = []; sdSpots = []; sdRoster = []; sdGalleryUploader = null;
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-studio-detail').classList.add('active');

    try {
        const res = await _fetchAdminJson(`/api/admin/database/tables/studios?filterColumn=id&filterValue=${encodeURIComponent(id)}&limit=1`);
        const s = (res.rows && res.rows[0]) || currentStudios.find(x => x.id === id);
        if (!s) { showToast('Estudio no encontrado', 'error'); closeStudioDetail(); return; }
        currentStudioDetail = s;
        const titleEl = document.getElementById('section-title');
        if (titleEl) titleEl.textContent = 'Estudio: ' + (s.name || '');
        renderStudioDetailHeader(s);
        populateStudioGeneral(s);
        populateStudioContact(s);
        switchStudioTab('general');
    } catch (err) {
        showToast('Error al cargar el estudio: ' + err.message, 'error');
    }
}

function closeStudioDetail() {
    if (typeof window.showSection === 'function') window.showSection('studios');
}

function reloadStudioDetail() {
    if (currentStudioDetailId) openStudioDetail(currentStudioDetailId);
}

function renderStudioDetailHeader(s) {
    const logoEl = document.getElementById('sd-logo');
    logoEl.innerHTML = s.logo_image ? `<img src="${escapeHtml(s.logo_image)}" alt="">` : escapeHtml(avatarInitials(s.name));
    document.getElementById('sd-name').textContent = s.name || '—';
    const badges = [];
    badges.push(s.is_verified ? '<span class="status-badge verified">Verificado</span>' : '<span class="status-badge not-verified">No verif.</span>');
    badges.push(s.is_active ? '<span class="status-badge success">Activo</span>' : '<span class="status-badge error">Inactivo</span>');
    if (s.is_seeking_artists) badges.push('<span class="status-badge" style="background:rgba(245,158,11,0.18);color:#f59e0b;"><i class="fa-solid fa-bullhorn"></i> Buscando artistas</span>');
    if (s.slug) badges.push(`<span class="status-badge">/${escapeHtml(s.slug)}</span>`);
    if (s.email) badges.push(`<span class="status-badge">${escapeHtml(s.email)}</span>`);
    document.getElementById('sd-badges').innerHTML = badges.join(' ');
}

function populateStudioGeneral(s) {
    setVal('sd-id', s.id);
    setVal('sd-user-id', s.user_id || '');
    setVal('sd-name-input', s.name);
    setVal('sd-slug', s.slug);
    setVal('sd-email', s.email);
    setVal('sd-founded-year', s.founded_year);
    setVal('sd-tagline', s.tagline);
    setVal('sd-bio', s.bio);
    setVal('sd-languages', studioLanguagesArray(s.languages).join(', '));
    setVal('sd-is-verified', s.is_verified);
    setVal('sd-is-active', s.is_active);
    setVal('sd-profile-complete', s.profile_complete);
    setVal('sd-is-seeking-artists', s.is_seeking_artists);
    setVal('sd-new-password', '');
}

function populateStudioContact(s) {
    setVal('sd-instagram', s.instagram);
    setVal('sd-tiktok', s.tiktok);
    setVal('sd-whatsapp', s.whatsapp);
    setVal('sd-contact-phone', s.contact_phone);
    setVal('sd-phone', s.phone);
    setVal('sd-website', s.website);
    setVal('sd-google-maps-url', s.google_maps_url);
}

function switchStudioTab(tab) {
    document.querySelectorAll('#section-studio-detail .sd-tab').forEach(b => b.classList.toggle('active', b.dataset.sdTab === tab));
    document.querySelectorAll('#section-studio-detail .sd-panel').forEach(p => p.classList.toggle('active', p.dataset.sdPanel === tab));
    if (tab === 'images') loadStudioImagesTab();
    else if (tab === 'locations') loadStudioLocations();
    else if (tab === 'spots') loadStudioSpots();
    else if (tab === 'roster') loadStudioRoster();
    else if (tab === 'ops') switchOpsTable(currentOpsTable, currentOpsTitle);
}

async function deleteStudioFromDetail() {
    const s = currentStudioDetail;
    const id = currentStudioDetailId;
    if (!id) return;
    if (!confirm(`¿Eliminar el estudio "${(s && s.name) || id}"?\nSe borrarán sus sedes, spots, roster y su cuenta de acceso. No se puede deshacer.`)) return;
    try {
        await _fetchAdminJson('/api/admin/delete-studio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
        });
        showToast('Estudio eliminado', 'success');
        closeStudioDetail();
    } catch (err) {
        showToast('Error al eliminar: ' + err.message, 'error');
    }
}

// ---- General / Contacto ----
async function saveStudioGeneral(event) {
    event.preventDefault();
    const newPassword = getVal('sd-new-password');
    if (newPassword && newPassword.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres', 'error'); return; }
    const foundedRaw = getVal('sd-founded-year');
    const patch = {
        name: getVal('sd-name-input'),
        slug: getVal('sd-slug') || null,
        email: getVal('sd-email'),
        founded_year: foundedRaw === '' ? null : Number(foundedRaw),
        tagline: getVal('sd-tagline') || null,
        bio: getVal('sd-bio') || null,
        languages: csvToArray(getVal('sd-languages')),
        is_verified: getVal('sd-is-verified'),
        is_active: getVal('sd-is-active'),
        profile_complete: getVal('sd-profile-complete'),
        is_seeking_artists: getVal('sd-is-seeking-artists')
    };
    try {
        await _sdStudioPatch(patch);
        const authUserId = (currentStudioDetail && currentStudioDetail.user_id) || getVal('sd-user-id') || '';
        let pw = false;
        if (newPassword) {
            if (!authUserId) showToast('Sin cuenta de acceso: no se cambió la contraseña.', 'warning');
            else {
                await _fetchAdminJson('/api/admin/update-user-password', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: authUserId, newPassword })
                });
                pw = true;
            }
        }
        Object.assign(currentStudioDetail, patch);
        renderStudioDetailHeader(currentStudioDetail);
        setVal('sd-new-password', '');
        showToast(pw ? 'General y contraseña actualizados' : 'General actualizado', 'success');
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }
}

async function saveStudioContact(event) {
    event.preventDefault();
    const patch = {
        instagram: getVal('sd-instagram') || null,
        tiktok: getVal('sd-tiktok') || null,
        whatsapp: getVal('sd-whatsapp') || null,
        contact_phone: getVal('sd-contact-phone') || null,
        phone: getVal('sd-phone') || null,
        website: getVal('sd-website') || null,
        google_maps_url: getVal('sd-google-maps-url') || null
    };
    try {
        await _sdStudioPatch(patch);
        Object.assign(currentStudioDetail, patch);
        showToast('Contacto actualizado', 'success');
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }
}

// ---- Imágenes ----
function loadStudioImagesTab() {
    const s = currentStudioDetail;
    if (!s) return;
    const client = _sdSupabase();
    const panel = document.querySelector('#section-studio-detail [data-sd-panel="images"]');
    const grid = panel.querySelector('.sd-images-grid');
    // Rebuild inputs fresh each time so re-attaching the uploader never double-wraps.
    grid.innerHTML = `
        <div class="sd-image-field"><label>Logo</label><input type="url" id="sd-logo-input" placeholder="URL del logo"></div>
        <div class="sd-image-field"><label>Portada (cover)</label><input type="url" id="sd-cover-input" placeholder="URL de portada"></div>`;
    const gallery = document.getElementById('sd-gallery');
    gallery.innerHTML = '';
    const logoInput = document.getElementById('sd-logo-input');
    const coverInput = document.getElementById('sd-cover-input');
    logoInput.value = s.logo_image || '';
    coverInput.value = s.cover_image || '';

    const photoUrls = _sdPhotoUrls(s.photo_feed_items);

    if (window.WeOtziUploader && client) {
        WeOtziUploader.attach(logoInput, { supabase: client, bucket: 'studio-photos', pathPrefix: s.id + '/brand', accept: 'image/*' });
        WeOtziUploader.attach(coverInput, { supabase: client, bucket: 'studio-photos', pathPrefix: s.id + '/brand', accept: 'image/*' });
        sdGalleryUploader = WeOtziUploader.attachGallery(gallery, { supabase: client, bucket: 'studio-photos', pathPrefix: s.id + '/gallery', initialUrls: photoUrls, accept: 'image/*' });
    } else {
        sdGalleryUploader = null;
        gallery.innerHTML = '<p class="sd-panel-hint">Subida no disponible (sin cliente Supabase). Pegá URLs en los campos de arriba.</p>';
    }
}

// Normalizes a JSONB photo array (items are {url,...} objects or plain strings)
// to a flat list of URLs.
function _sdPhotoUrls(value) {
    return (Array.isArray(value) ? value : [])
        .map(it => (typeof it === 'string' ? it : (it && it.url)))
        .filter(Boolean);
}

async function saveStudioImages() {
    if (!currentStudioDetailId) return;
    const logo = (document.getElementById('sd-logo-input') || {}).value || '';
    const cover = (document.getElementById('sd-cover-input') || {}).value || '';
    const photoUrls = sdGalleryUploader ? sdGalleryUploader.getUrls() : _sdPhotoUrls(currentStudioDetail.photo_feed_items);
    const photo_feed_items = photoUrls.map((url, i) => ({ url, kind: 'image', category: 'studio', sort: i }));
    try {
        await _sdStudioPatch({ logo_image: logo || null, cover_image: cover || null, photo_feed_items });
        currentStudioDetail.logo_image = logo || null;
        currentStudioDetail.cover_image = cover || null;
        currentStudioDetail.photo_feed_items = photo_feed_items;
        renderStudioDetailHeader(currentStudioDetail);
        showToast('Imágenes guardadas', 'success');
    } catch (err) {
        showToast('Error al guardar imágenes: ' + err.message, 'error');
    }
}

// ---- Sedes (studio_locations) ----
async function loadStudioLocations() {
    const listEl = document.getElementById('sd-locations-list');
    listEl.innerHTML = '<div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando sedes...</span></div>';
    try {
        sdLocations = await _sdFetchChildren('studio_locations', 'studio_id', currentStudioDetailId, 'sort_order.asc');
        if (!sdLocations.length) {
            listEl.innerHTML = '<p class="sd-panel-hint">Sin sedes. Agregá la primera con "Nueva sede".</p>';
            return;
        }

        // Derived per-sede counts (best-effort — failures just hide the badges):
        //   "Artistas en la sede"  -> active memberships grouped by location_id
        //   "Spots disponibles"    -> open spots grouped by location_id
        const artistsByLoc = {};
        const openSpotsByLoc = {};
        let unassigned = 0;
        try {
            const members = await _sdFetchChildren('studio_artist_memberships', 'studio_id', currentStudioDetailId);
            members.filter(m => m.status === 'active').forEach(m => {
                if (m.location_id) artistsByLoc[m.location_id] = (artistsByLoc[m.location_id] || 0) + 1;
                else unassigned += 1;
            });
        } catch (_) { /* counts optional */ }
        try {
            const spots = await _sdFetchChildren('studio_spots', 'studio_id', currentStudioDetailId);
            spots.filter(s => s.status === 'open' && s.location_id).forEach(s => {
                openSpotsByLoc[s.location_id] = (openSpotsByLoc[s.location_id] || 0) + 1;
            });
        } catch (_) { /* counts optional */ }

        const cards = sdLocations.map(loc => {
            const addr = loc.formatted_address || [loc.street, loc.street_number, loc.city, loc.country].filter(Boolean).join(', ');
            const badges = (loc.is_primary ? '<span class="status-badge verified">Principal</span> ' : '')
                + (loc.is_active !== false ? '<span class="status-badge success">Activa</span>' : '<span class="status-badge error">Inactiva</span>')
                + (loc.is_seeking_artists ? ' <span class="status-badge" style="background:rgba(245,158,11,0.18);color:#f59e0b;"><i class="fa-solid fa-bullhorn"></i> Buscando</span>' : '');
            const artistCount = artistsByLoc[loc.id] || 0;
            const spotCount = openSpotsByLoc[loc.id] || 0;
            const photoCount = _sdPhotoUrls(loc.photo_feed_items).length + _sdPhotoUrls(loc.workstation_photos).length;
            const mapsHref = loc.google_maps_url
                || (loc.formatted_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.formatted_address)}` : '');
            const mapsLink = mapsHref ? ` · <a href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener">Maps</a>` : '';
            return `<div class="sd-card"><div class="sd-card-main">
                <div class="sd-card-title">${escapeHtml(loc.label || 'Sede')} ${badges}
                    <span class="badge-sm" title="Artistas en esta sede"><i class="fa-solid fa-user"></i> ${artistCount}</span>
                    <span class="badge-sm" title="Spots disponibles en esta sede"><i class="fa-solid fa-bullseye"></i> ${spotCount}</span>
                    <span class="badge-sm" title="Fotos de esta sede"><i class="fa-solid fa-image"></i> ${photoCount}</span></div>
                <div class="sd-card-sub">${escapeHtml(addr || '—')}${loc.phone ? ' · ' + escapeHtml(loc.phone) : ''}${mapsLink}</div>
            </div><div class="sd-card-actions">
                <button class="btn-icon" onclick="openSedeForm('${escapeHtml(loc.id)}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon danger-hover" onclick="deleteSede('${escapeHtml(loc.id)}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </div></div>`;
        }).join('');

        const note = unassigned
            ? `<p class="sd-panel-hint"><i class="fa-solid fa-circle-info"></i> ${unassigned} artista(s) del roster sin sede asignada.</p>`
            : '';
        listEl.innerHTML = cards + note;
    } catch (err) {
        listEl.innerHTML = `<p class="sd-panel-hint" style="color:var(--error-color);">${escapeHtml(err.message)}</p>`;
    }
}

function openSedeForm(locId) {
    const loc = locId ? sdLocations.find(l => l.id === locId) : null;
    setVal('sede-id', loc ? loc.id : '');
    setVal('sede-studio-id', currentStudioDetailId);
    setVal('sede-label', loc ? loc.label : '');
    setVal('sede-sort-order', loc ? (loc.sort_order != null ? loc.sort_order : 0) : sdLocations.length);
    // The first sede ever, and the only sede, must be primary — force + lock it.
    const isNewFirst = !loc && sdLocations.length === 0;
    const isEditOnly = loc && sdLocations.length === 1;
    setVal('sede-is-primary', loc ? !!loc.is_primary : isNewFirst);
    const primaryToggle = document.getElementById('sede-is-primary');
    if (primaryToggle) {
        if (isNewFirst || isEditOnly) { primaryToggle.checked = true; primaryToggle.disabled = true; }
        else primaryToggle.disabled = false;
    }
    setVal('sede-is-active', loc ? loc.is_active !== false : true);
    setVal('sede-country', loc ? loc.country : '');
    setVal('sede-country-code', loc ? loc.country_code : '');
    setVal('sede-state-province', loc ? loc.state_province : '');
    setVal('sede-city', loc ? loc.city : '');
    setVal('sede-locality', loc ? loc.locality : '');
    setVal('sede-street', loc ? loc.street : '');
    setVal('sede-street-number', loc ? loc.street_number : '');
    setVal('sede-unit', loc ? loc.unit : '');
    setVal('sede-postal-code', loc ? loc.postal_code : '');
    setVal('sede-formatted-address', loc ? loc.formatted_address : '');
    setVal('sede-latitude', loc ? loc.latitude : '');
    setVal('sede-longitude', loc ? loc.longitude : '');
    setVal('sede-phone', loc ? loc.phone : '');
    setVal('sede-google-maps-url', loc ? loc.google_maps_url : '');
    setVal('sede-is-seeking-artists', loc ? !!loc.is_seeking_artists : false);

    // Per-sede galleries. attachGallery resets its container, so re-mounting on
    // every open is safe (no double-wrap). Files land under <studioId>/sedes so
    // the studio-photos bucket RLS (path prefix = studio UUID) still passes.
    const client = _sdSupabase();
    const photosC = document.getElementById('sede-photos-gallery');
    const wsC = document.getElementById('sede-workstation-gallery');
    const prefix = currentStudioDetailId + '/sedes';
    if (window.WeOtziUploader && client) {
        sedePhotosUploader = WeOtziUploader.attachGallery(photosC, { supabase: client, bucket: 'studio-photos', pathPrefix: prefix, initialUrls: _sdPhotoUrls(loc && loc.photo_feed_items), accept: 'image/*' });
        sedeWorkstationUploader = WeOtziUploader.attachGallery(wsC, { supabase: client, bucket: 'studio-photos', pathPrefix: prefix, initialUrls: _sdPhotoUrls(loc && loc.workstation_photos), accept: 'image/*' });
    } else {
        sedePhotosUploader = null;
        sedeWorkstationUploader = null;
        if (photosC) photosC.innerHTML = '<p class="sd-panel-hint">Subida no disponible (sin cliente Supabase).</p>';
        if (wsC) wsC.innerHTML = '';
    }

    document.getElementById('sede-modal-title').textContent = loc ? 'Editar Sede' : 'Nueva Sede';
    document.getElementById('sede-delete-btn').style.display = loc ? '' : 'none';
    openModal('sede-modal');
}

async function saveSede(event) {
    event.preventDefault();
    const id = getVal('sede-id');
    const latRaw = getVal('sede-latitude');
    const lngRaw = getVal('sede-longitude');
    const lat = latRaw === '' ? null : Number(latRaw);
    const lng = lngRaw === '' ? null : Number(lngRaw);
    if ((lat === null) !== (lng === null)) { showToast('Latitud y longitud deben ir juntas (ambas o ninguna).', 'error'); return; }

    // Photo arrays come from the gallery uploaders; if the uploader couldn't
    // mount (no client), fall back to the sede's existing photos so we don't
    // wipe them on save.
    const existing = id ? sdLocations.find(l => l.id === id) : null;
    const sedePhotoUrls = sedePhotosUploader ? sedePhotosUploader.getUrls() : _sdPhotoUrls(existing && existing.photo_feed_items);
    const sedeWsUrls = sedeWorkstationUploader ? sedeWorkstationUploader.getUrls() : _sdPhotoUrls(existing && existing.workstation_photos);

    const values = {
        studio_id: currentStudioDetailId,
        label: getVal('sede-label') || null,
        is_primary: getVal('sede-is-primary'),
        is_active: getVal('sede-is-active'),
        sort_order: getVal('sede-sort-order') === '' ? 0 : Number(getVal('sede-sort-order')),
        country: getVal('sede-country') || null,
        country_code: getVal('sede-country-code') || null,
        state_province: getVal('sede-state-province') || null,
        city: getVal('sede-city') || null,
        locality: getVal('sede-locality') || null,
        street: getVal('sede-street') || null,
        street_number: getVal('sede-street-number') || null,
        unit: getVal('sede-unit') || null,
        postal_code: getVal('sede-postal-code') || null,
        formatted_address: getVal('sede-formatted-address') || null,
        latitude: lat,
        longitude: lng,
        phone: getVal('sede-phone') || null,
        google_maps_url: getVal('sede-google-maps-url') || null,
        is_seeking_artists: getVal('sede-is-seeking-artists'),
        photo_feed_items: sedePhotoUrls.map((url, i) => ({ url, kind: 'image', category: 'studio', sort: i })),
        workstation_photos: sedeWsUrls.map((url, i) => ({ url, kind: 'image', category: 'workstation', sort: i }))
    };

    // A studio must always have exactly one primary sede. The first sede (and
    // the only sede) is forced primary; un-checking primary is rejected unless
    // another sede is already primary.
    const isFirstSede = sdLocations.length === 0;
    const isOnlySede = id && sdLocations.length === 1;
    if (isFirstSede || isOnlySede) {
        values.is_primary = true;
    } else if (!values.is_primary) {
        const anotherPrimary = sdLocations.some(l => l.id !== id && l.is_primary);
        if (!anotherPrimary) {
            values.is_primary = true;
            showToast('Debe haber una sede principal; se mantuvo esta como principal.', 'warning');
        }
    }

    const rowUrl = '/api/admin/database/tables/studio_locations/row';
    try {
        // Single-primary invariant: clear other primaries first.
        if (values.is_primary) {
            const others = sdLocations.filter(l => l.is_primary && l.id !== id);
            for (const o of others) {
                await _fetchAdminJson(rowUrl, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idColumn: 'id', idValue: o.id, patch: { is_primary: false } })
                });
            }
        }
        if (id) {
            await _fetchAdminJson(rowUrl, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idColumn: 'id', idValue: id, patch: values })
            });
        } else {
            await _fetchAdminJson(rowUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values })
            });
        }
        showToast('Sede guardada', 'success');
        closeModal();
        loadStudioLocations();
    } catch (err) {
        showToast('Error al guardar sede: ' + err.message, 'error');
    }
}

async function deleteSede(locId) {
    const loc = sdLocations.find(l => l.id === locId);
    // A studio must keep at least one sede.
    if (sdLocations.length <= 1) {
        showToast('Un estudio debe tener al menos una sede. No se puede eliminar la última.', 'error');
        return;
    }
    if (!confirm(`¿Eliminar la sede "${(loc && loc.label) || 'sede'}"?\nEsta acción no se puede deshacer.`)) return;

    const rowUrl = '/api/admin/database/tables/studio_locations/row';
    try {
        await _fetchAdminJson(rowUrl, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idColumn: 'id', idValue: locId })
        });
        // If the deleted sede was the primary, promote another so a primary
        // always exists.
        if (loc && loc.is_primary) {
            const remaining = sdLocations.filter(l => l.id !== locId)
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            if (remaining[0]) {
                await _fetchAdminJson(rowUrl, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idColumn: 'id', idValue: remaining[0].id, patch: { is_primary: true } })
                });
            }
        }
        showToast('Sede eliminada', 'success');
        loadStudioLocations();
    } catch (err) {
        showToast('Error al eliminar sede: ' + err.message, 'error');
    }
}

function deleteSedeFromModal() {
    const id = getVal('sede-id');
    if (!id) return;
    closeModal();
    deleteSede(id);
}

// ---- Spots ----
const SPOT_KIND_LABELS = { resident: 'Residente', itinerant: 'Itinerante', guest_spot: 'Guest spot' };
const SPOT_STATUS_BADGE = {
    draft: 'pending', open: 'success', filled: 'verified', closed: 'none', expired: 'error'
};

async function loadStudioSpots() {
    const listEl = document.getElementById('sd-spots-list');
    listEl.innerHTML = '<div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando spots...</span></div>';
    try {
        sdSpots = await _sdFetchChildren('studio_spots', 'studio_id', currentStudioDetailId, 'created_at.desc');
        if (!sdSpots.length) {
            listEl.innerHTML = '<p class="sd-panel-hint">Sin spots. Creá uno con "Nuevo spot".</p>';
            return;
        }
        const openCount = sdSpots.filter(s => s.status === 'open').length;
        const summary = `<p class="sd-panel-hint"><i class="fa-solid fa-circle-check" style="color:var(--success-color);"></i> <strong>${openCount}</strong> spot(s) disponible(s) (estado <code>open</code>) de ${sdSpots.length} total.</p>`;
        listEl.innerHTML = summary + sdSpots.map(sp => {
            const statusCls = SPOT_STATUS_BADGE[sp.status] || 'none';
            const dates = [sp.start_date, sp.end_date].filter(Boolean).join(' → ');
            return `<div class="sd-card"><div class="sd-card-main">
                <div class="sd-card-title">${escapeHtml(sp.title || 'Spot')}
                    <span class="status-badge ${statusCls}">${escapeHtml(sp.status || '')}</span>
                    <span class="badge-sm">${escapeHtml(SPOT_KIND_LABELS[sp.kind] || sp.kind || '')}</span>
                </div>
                <div class="sd-card-sub">${dates ? escapeHtml(dates) + ' · ' : ''}${sp.application_count || 0} postulación(es)</div>
            </div><div class="sd-card-actions">
                <button class="btn-icon" onclick="openSpotForm('${escapeHtml(sp.id)}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon danger-hover" onclick="deleteSpot('${escapeHtml(sp.id)}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </div></div>`;
        }).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="sd-panel-hint" style="color:var(--error-color);">${escapeHtml(err.message)}</p>`;
    }
}

async function openSpotForm(spotId) {
    if (!sdLocations.length) {
        try { sdLocations = await _sdFetchChildren('studio_locations', 'studio_id', currentStudioDetailId, 'sort_order.asc'); } catch (_) {}
    }
    const sel = document.getElementById('spot-location-id');
    sel.innerHTML = '<option value="">— Sin sede —</option>' +
        sdLocations.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.label || l.city || l.id)}</option>`).join('');

    const sp = spotId ? sdSpots.find(s => s.id === spotId) : null;
    sdCurrentSpotId = sp ? sp.id : null;
    setVal('spot-id', sp ? sp.id : '');
    setVal('spot-studio-id', currentStudioDetailId);
    setVal('spot-title', sp ? sp.title : '');
    setVal('spot-kind', sp ? sp.kind : 'guest_spot');
    setVal('spot-status', sp ? sp.status : 'draft');
    setVal('spot-description', sp ? sp.description : '');
    setVal('spot-styles-wanted', sp && Array.isArray(sp.styles_wanted) ? sp.styles_wanted.join(', ') : '');
    setVal('spot-language-requirements', sp && Array.isArray(sp.language_requirements) ? sp.language_requirements.join(', ') : '');
    setVal('spot-experience-min-years', sp ? sp.experience_min_years : '');
    setVal('spot-location-id', sp ? (sp.location_id || '') : '');
    setVal('spot-includes-housing', sp ? !!sp.includes_housing : false);
    setVal('spot-revenue-split-pct', sp ? sp.revenue_split_pct : '');
    setVal('spot-stipend-amount', sp ? sp.stipend_amount : '');
    setVal('spot-stipend-currency', sp ? sp.stipend_currency : '');
    setVal('spot-start-date', sp ? sp.start_date : '');
    setVal('spot-end-date', sp ? sp.end_date : '');
    setVal('spot-expires-at', sp && sp.expires_at ? String(sp.expires_at).slice(0, 10) : '');
    setVal('spot-weeks-minimum', sp ? sp.weeks_minimum : '');
    setVal('spot-weeks-maximum', sp ? sp.weeks_maximum : '');
    setVal('spot-max-applications', sp ? sp.max_applications : '');

    // Rebuild cover field fresh so the uploader never double-wraps.
    const coverGroup = document.getElementById('spot-cover-image').closest('.form-group');
    coverGroup.innerHTML = '<label>Imagen de portada del spot</label><input type="url" id="spot-cover-image" placeholder="URL de portada">';
    const coverInput = document.getElementById('spot-cover-image');
    coverInput.value = sp ? (sp.cover_image || '') : '';
    const client = _sdSupabase();
    if (window.WeOtziUploader && client) {
        WeOtziUploader.attach(coverInput, { supabase: client, bucket: 'studio-photos', pathPrefix: currentStudioDetailId + '/spots', accept: 'image/*' });
    }

    document.getElementById('spot-modal-title').textContent = sp ? 'Editar Spot' : 'Nuevo Spot';
    document.getElementById('spot-delete-btn').style.display = sp ? '' : 'none';

    const appsWrap = document.getElementById('spot-applications-wrap');
    if (sp) { appsWrap.style.display = ''; loadSpotApplications(sp.id); }
    else { appsWrap.style.display = 'none'; }

    openModal('spot-modal');
}

async function saveSpot(event) {
    event.preventDefault();
    const id = getVal('spot-id');
    const num = v => (v === '' ? null : Number(v));
    const values = {
        studio_id: currentStudioDetailId,
        title: getVal('spot-title'),
        kind: getVal('spot-kind'),
        status: getVal('spot-status'),
        description: getVal('spot-description') || null,
        styles_wanted: csvToArray(getVal('spot-styles-wanted')),
        language_requirements: csvToArray(getVal('spot-language-requirements')),
        experience_min_years: num(getVal('spot-experience-min-years')),
        includes_housing: getVal('spot-includes-housing'),
        revenue_split_pct: num(getVal('spot-revenue-split-pct')),
        stipend_amount: num(getVal('spot-stipend-amount')),
        stipend_currency: getVal('spot-stipend-currency') || null,
        start_date: getVal('spot-start-date') || null,
        end_date: getVal('spot-end-date') || null,
        expires_at: getVal('spot-expires-at') || null,
        weeks_minimum: num(getVal('spot-weeks-minimum')),
        weeks_maximum: num(getVal('spot-weeks-maximum')),
        max_applications: num(getVal('spot-max-applications')),
        cover_image: (document.getElementById('spot-cover-image') || {}).value || null,
        location_id: getVal('spot-location-id') || null
    };
    const rowUrl = '/api/admin/database/tables/studio_spots/row';
    try {
        if (id) {
            await _fetchAdminJson(rowUrl, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idColumn: 'id', idValue: id, patch: values })
            });
        } else {
            await _fetchAdminJson(rowUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values })
            });
        }
        showToast('Spot guardado', 'success');
        closeModal();
        loadStudioSpots();
    } catch (err) {
        showToast('Error al guardar spot: ' + err.message, 'error');
    }
}

function deleteSpot(spotId) {
    const sp = sdSpots.find(s => s.id === spotId);
    deleteRowGeneric('studio_spots', 'id', spotId, (sp && sp.title) || 'spot', loadStudioSpots);
}

function deleteSpotFromModal() {
    const id = getVal('spot-id');
    if (!id) return;
    closeModal();
    deleteSpot(id);
}

async function loadSpotApplications(spotId) {
    const listEl = document.getElementById('spot-applications-list');
    listEl.innerHTML = '<p class="sd-panel-hint">Cargando postulaciones…</p>';
    try {
        const apps = await _sdFetchChildren('studio_spot_applications', 'spot_id', spotId, 'created_at.desc');
        document.getElementById('spot-applications-count').textContent = apps.length;
        if (!apps.length) { listEl.innerHTML = '<p class="sd-panel-hint">Sin postulaciones.</p>'; return; }
        listEl.innerHTML = apps.map(app => {
            return `<div class="sd-card"><div class="sd-card-main">
                <div class="sd-card-title">Artista ${escapeHtml(String(app.artist_user_id).slice(0, 8))}…
                    <span class="badge-sm">${escapeHtml(app.status || '')}</span></div>
                <div class="sd-card-sub">${escapeHtml(app.message || '—')}${app.portfolio_url ? ` · <a href="${escapeHtml(app.portfolio_url)}" target="_blank" rel="noopener">portfolio</a>` : ''}</div>
            </div><div class="sd-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="setApplicationStatus('${escapeHtml(app.id)}','shortlisted')">Preseleccionar</button>
                <button class="btn btn-secondary btn-sm" onclick="setApplicationStatus('${escapeHtml(app.id)}','accepted')">Aceptar</button>
                <button class="btn btn-secondary btn-sm danger-hover" onclick="setApplicationStatus('${escapeHtml(app.id)}','rejected')">Rechazar</button>
            </div></div>`;
        }).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="sd-panel-hint" style="color:var(--error-color);">${escapeHtml(err.message)}</p>`;
    }
}

async function setApplicationStatus(appId, status) {
    try {
        await _fetchAdminJson('/api/admin/database/tables/studio_spot_applications/row', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idColumn: 'id', idValue: appId, patch: { status, decided_at: new Date().toISOString() } })
        });
        showToast('Postulación: ' + status, 'success');
        if (sdCurrentSpotId) loadSpotApplications(sdCurrentSpotId);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ---- Roster (studio_artist_memberships) ----
async function loadStudioRoster() {
    const tbody = document.getElementById('sd-roster-body');
    tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;">Cargando…</td></tr>';
    try {
        // Refresh the sedes cache so the assignment dropdown is current.
        try { sdLocations = await _sdFetchChildren('studio_locations', 'studio_id', currentStudioDetailId, 'sort_order.asc'); } catch (_) {}

        sdRoster = await _sdFetchChildren('studio_artist_memberships', 'studio_id', currentStudioDetailId, 'created_at.desc');
        if (!sdRoster.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;opacity:.6;">Sin artistas en el roster.</td></tr>';
            return;
        }
        tbody.innerHTML = sdRoster.map(m => {
            const sedeOptions = sdLocations.map(l =>
                `<option value="${escapeHtml(l.id)}" ${l.id === m.location_id ? 'selected' : ''}>${escapeHtml(l.label || l.city || l.id)}</option>`
            ).join('');
            const sedeSelect = `<select class="rowedit-input" style="min-width:150px;" onchange="assignMembershipSede('${escapeHtml(m.id)}', this.value)">
                <option value="">— Sin sede —</option>${sedeOptions}</select>`;
            return `<tr>
                <td title="${escapeHtml(m.artist_user_id)}">${escapeHtml(String(m.artist_user_id).slice(0, 8))}…</td>
                <td>${escapeHtml(m.role || '—')}</td>
                <td>${escapeHtml(m.status || '—')}</td>
                <td>${m.revenue_split_pct != null ? escapeHtml(String(m.revenue_split_pct)) : '—'}</td>
                <td>${m.started_at ? new Date(m.started_at).toLocaleDateString('es-ES') : '—'}</td>
                <td>${sedeSelect}</td>
                <td><div class="action-buttons">
                    <button class="btn-icon" onclick="editMembership('${escapeHtml(m.id)}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon danger-hover" onclick="removeMembership('${escapeHtml(m.id)}')" title="Quitar"><i class="fa-solid fa-user-minus"></i></button>
                </div></td></tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--error-color);">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function assignMembershipSede(mId, locationId) {
    try {
        await _fetchAdminJson('/api/admin/database/tables/studio_artist_memberships/row', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idColumn: 'id', idValue: mId, patch: { location_id: locationId || null } })
        });
        const m = sdRoster.find(x => x.id === mId);
        if (m) m.location_id = locationId || null;
        showToast('Artista vinculado a la sede', 'success');
    } catch (err) {
        showToast('Error al asignar sede: ' + err.message, 'error');
        loadStudioRoster();
    }
}

function editMembership(mId) {
    const m = sdRoster.find(x => x.id === mId);
    if (!m) return;
    openRowEditor({ table: 'studio_artist_memberships', row: m, isNew: false, idColumn: 'id', idValue: mId, onSaved: loadStudioRoster });
}

function removeMembership(mId) {
    deleteRowGeneric('studio_artist_memberships', 'id', mId, 'membresía', loadStudioRoster);
}

// ---- Operaciones (generic studio-filtered tables) ----
function switchOpsTable(table, title) {
    currentOpsTable = table;
    currentOpsTitle = title || table;
    document.querySelectorAll('#sd-ops-subtabs .sd-subtab').forEach(b => b.classList.toggle('active', b.dataset.ops === table));
    const titleEl = document.getElementById('sd-ops-title');
    if (titleEl) titleEl.textContent = currentOpsTitle;
    loadOpsTable();
}

async function loadOpsTable() {
    const head = document.getElementById('sd-ops-head');
    const body = document.getElementById('sd-ops-body');
    head.innerHTML = '';
    body.innerHTML = '<tr><td style="padding:16px;">Cargando…</td></tr>';
    try {
        sdOpsRows = await _sdFetchChildren(currentOpsTable, 'studio_id', currentStudioDetailId, 'created_at.desc');
        if (!sdOpsRows.length) {
            head.innerHTML = '<tr><th>Sin datos</th></tr>';
            body.innerHTML = '<tr><td style="padding:16px;opacity:.6;">Sin registros. Usá "Agregar".</td></tr>';
            return;
        }
        const cols = Object.keys(sdOpsRows[0]);
        head.innerHTML = `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}<th>Acciones</th></tr>`;
        body.innerHTML = sdOpsRows.map((r, i) => `<tr>${cols.map(c => `<td>${_sdFmtCell(r[c])}</td>`).join('')}<td><div class="action-buttons">
            <button class="btn-icon" onclick="editOpsRow(${i})" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon danger-hover" onclick="deleteOpsRow(${i})" title="Borrar"><i class="fa-solid fa-trash"></i></button>
        </div></td></tr>`).join('');
    } catch (err) {
        head.innerHTML = '<tr><th>Error</th></tr>';
        body.innerHTML = `<tr><td style="padding:16px;color:var(--error-color);">${escapeHtml(err.message)}</td></tr>`;
    }
}

function editOpsRow(index) {
    const row = sdOpsRows[index];
    if (!row) return;
    const key = pickRowKey(row);
    if (!key) { showToast('Sin clave única; no editable.', 'error'); return; }
    openRowEditor({ table: currentOpsTable, row, isNew: false, idColumn: key.column, idValue: key.value, onSaved: loadOpsTable });
}

function deleteOpsRow(index) {
    const row = sdOpsRows[index];
    if (!row) return;
    const key = pickRowKey(row);
    if (!key) { showToast('Sin clave única; no borrable.', 'error'); return; }
    deleteRowGeneric(currentOpsTable, key.column, key.value, String(key.value), loadOpsTable);
}

function addOpsRow() {
    const sample = sdOpsRows[0];
    if (sample) {
        const template = {};
        Object.keys(sample).forEach(c => {
            if (['id', 'created_at', 'updated_at'].includes(c)) return;
            const v = sample[c];
            if (c === 'studio_id') template[c] = currentStudioDetailId;
            else if (typeof v === 'boolean') template[c] = false;
            else template[c] = null;
        });
        openRowEditor({ table: currentOpsTable, row: template, isNew: true, onSaved: loadOpsTable, subtitle: `Nueva fila en ${escapeHtml(currentOpsTitle)}.` });
    } else {
        // Empty table: can't infer columns — fall back to raw JSON seeded with studio_id.
        openRowEditor({ table: currentOpsTable, row: { studio_id: currentStudioDetailId }, isNew: true, raw: true, onSaved: loadOpsTable });
    }
}
