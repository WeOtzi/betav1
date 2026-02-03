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
        // Super Admin sections
        'apis': 'Gestion de APIs',
        'database': 'Base de Datos',
        'routes': 'Gestion de Rutas',
        'backup': 'Backup y Restauracion',
        'support': 'Usuarios de Soporte',
        'events': 'Eventos y Webhooks'
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

    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function renderRecentQuotations(quotations) {
    const container = document.getElementById('recent-quotations');

    if (quotations.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay cotizaciones recientes</p>';
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
                <span class="recent-meta">${q.client_full_name || 'Prospecto'} → ${q.artist_name || 'Sin artista'}</span>
            </div>
            <span class="status-badge ${q.quote_status}">${statusLabels[q.quote_status] || q.quote_status}</span>
        </div>
    `).join('');
}

// ============ QUOTATIONS ============
async function loadQuotations() {
    if (!supabaseClient) {
        document.getElementById('quotations-tbody').innerHTML = `
            <tr><td colspan="7" class="empty-state">Conecta Supabase para ver cotizaciones</td></tr>
        `;
        return;
    }

    const searchTerm = document.getElementById('search-quotations').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;

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
        showToast('Error cargando cotizaciones', 'error');
    }
}

function renderQuotationsTable() {
    const tbody = document.getElementById('quotations-tbody');
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = currentQuotations.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No se encontraron cotizaciones</td></tr>';
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
                <span class="detail-value">${quotation.tattoo_is_first_tattoo ? 'Sí' : 'No'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Cover-up:</span>
                <span class="detail-value">${quotation.tattoo_is_cover_up ? 'Sí' : 'No'}</span>
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
async function loadArtists() {
    const tbody = document.getElementById('artists-tbody');
    const isDemo = document.getElementById('setting-demo-mode').checked;

    // Check connection first
    if (!supabaseClient && !isDemo) {
        tbody.innerHTML = `
            <tr><td colspan="6" class="empty-state">Conecta Supabase para ver artistas o activa el Modo Demo en Configuración</td></tr>
        `;
        return;
    }

    const searchTerm = document.getElementById('search-artists').value.trim().toLowerCase();

    try {
        let artists = [];

        if (isDemo) {
            // Load from ConfigManager
            const demoArtists = window.ConfigManager.getDemoArtists();
            // Map to unified format if needed, but demo structure is already good
            artists = demoArtists.map(a => ({
                id: a.userId,
                username: a.username,
                name: a.name,
                current_city: a.location,
                styles_array: a.styles, // Array in demo
                session_cost: a.sessionPrice
            }));
        } else {
            // Load from Supabase
            const { data, error } = await supabaseClient
                .from('artists_db')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            // Map Supabase format
            artists = data.map(a => ({
                id: a.user_id,
                username: a.username,
                name: a.name,
                current_city: a.ubicacion, // Note field name mapping
                studio_name: a.estudios,
                email: a.email,
                instagram: a.instagram,
                styles_array: typeof a.styles_array === 'string' ? JSON.parse(a.styles_array) : a.styles_array,
                session_cost: a.session_price
            }));
        }

        // Filter
        if (searchTerm) {
            artists = artists.filter(a =>
                a.name.toLowerCase().includes(searchTerm) ||
                a.username.toLowerCase().includes(searchTerm) ||
                (a.current_city && a.current_city.toLowerCase().includes(searchTerm))
            );
        }

        currentArtists = artists;
        renderArtistsTable();

    } catch (error) {
        console.error('Error loading artists:', error);
        showToast('Error cargando artistas: ' + error.message, 'error');
    }
}

function renderArtistsTable() {
    const tbody = document.getElementById('artists-tbody');
    const start = (currentArtistsPage - 1) * artistsItemsPerPage;
    const end = start + parseInt(artistsItemsPerPage);
    const pageItems = currentArtists.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No se encontraron artistas</td></tr>';
        return;
    }

    tbody.innerHTML = pageItems.map(a => {
        const styles = Array.isArray(a.styles_array) ? a.styles_array.join(', ') : a.styles_array;

        return `
            <tr>
                <td><strong>${a.username}</strong></td>
                <td>${a.name}</td>
                <td>${a.current_city || '—'}</td>
                <td><span class="truncate-text" title="${styles}">${styles || '—'}</span></td>
                <td>${a.session_cost || '—'}</td>
                <td>
                    <button class="btn-icon" onclick="editArtist('${a.id}')" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${document.getElementById('setting-demo-mode').checked ? `
                    <button class="btn-icon danger" onclick="deleteArtist('${a.id}')" title="Eliminar (Solo Demo)">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    ` : ''}
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
    const container = document.getElementById('toast-container');

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-xmark',
        info: 'fa-circle-info'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${icons[type]}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

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
        alert('ID y Etiqueta son obligatorios');
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
    if (!config?.gemini?.enabled || !config?.gemini?.apiKey) {
        showToast('Gemini AI no está habilitado o configurado', 'error');
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
                apiKey: config.gemini.apiKey,
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
                apiKey,
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
    await testSupabaseAPI();
    // Add slight delay between tests
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
        healthIndicator.innerHTML = '<i class="fa-solid fa-database"></i><span>Sin conexión a Supabase</span>';
        tablesGrid.innerHTML = '<div class="empty-state">Configura Supabase para ver las tablas</div>';
        return;
    }
    
    healthIndicator.className = 'db-health-indicator';
    healthIndicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Cargando...</span>';
    
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
    if (!client) {
        showToast('No hay conexión a Supabase', 'error');
        return;
    }
    
    currentTableName = tableName;
    tableInspectorPage = 1;
    
    document.getElementById('table-inspector-title').textContent = `Tabla: ${tableName}`;
    
    showToast('Cargando datos...', 'info');
    
    try {
        // Get total count
        const { count } = await client
            .from(tableName)
            .select('*', { count: 'exact', head: true });
        
        document.getElementById('table-inspector-count').textContent = `${count || 0} registros`;
        
        // Get first page of data
        const { data, error } = await client
            .from(tableName)
            .select('*')
            .range(0, tableInspectorPerPage - 1);
        
        if (error) throw error;
        
        currentTableData = data || [];
        renderTableInspector(data);
        
        openModal('table-inspector-modal');
        
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function renderTableInspector(data) {
    const thead = document.getElementById('table-inspector-head');
    const tbody = document.getElementById('table-inspector-body');
    
    if (!data || data.length === 0) {
        thead.innerHTML = '<tr><th>Sin datos</th></tr>';
        tbody.innerHTML = '<tr><td class="empty-state">Esta tabla está vacía</td></tr>';
        return;
    }
    
    // Get columns from first row
    const columns = Object.keys(data[0]);
    
    // Render header
    thead.innerHTML = `<tr>${columns.map(col => `<th>${col}</th>`).join('')}</tr>`;
    
    // Render rows
    tbody.innerHTML = data.map(row => {
        return `<tr>${columns.map(col => {
            let value = row[col];
            
            // Format different types
            if (value === null) value = '<span class="text-muted">null</span>';
            else if (typeof value === 'object') value = `<code>${JSON.stringify(value).substring(0, 50)}...</code>`;
            else if (typeof value === 'string' && value.length > 50) value = value.substring(0, 50) + '...';
            
            return `<td>${value}</td>`;
        }).join('')}</tr>`;
    }).join('');
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
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No hay rutas configuradas</td></tr>';
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
    // Get service health from ConfigManager
    const health = await window.ConfigManager?.getSystemHealth();
    
    if (!health) return;
    
    // Update Supabase status
    const supabaseEl = document.getElementById('supabase-status');
    if (supabaseEl) {
        if (health.supabase.connected) {
            supabaseEl.className = 'health-status connected';
            supabaseEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Conectado';
        } else if (health.supabase.configured) {
            supabaseEl.className = 'health-status warning';
            supabaseEl.innerHTML = '<i class="fa-solid fa-circle"></i> Configurado';
        } else {
            supabaseEl.className = 'health-status disconnected';
            supabaseEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Sin configurar';
        }
    }
    
    // Update n8n status
    const n8nEl = document.getElementById('n8n-status');
    if (n8nEl) {
        if (health.n8n.configured) {
            n8nEl.className = 'health-status warning';
            n8nEl.innerHTML = '<i class="fa-solid fa-circle"></i> Configurado';
        } else {
            n8nEl.className = 'health-status';
            n8nEl.innerHTML = '<i class="fa-solid fa-circle"></i> Sin configurar';
        }
    }
    
    // Update EmailJS status
    const emailjsEl = document.getElementById('emailjs-status');
    if (emailjsEl) {
        if (health.emailjs.configured) {
            emailjsEl.className = 'health-status warning';
            emailjsEl.innerHTML = '<i class="fa-solid fa-circle"></i> Configurado';
        } else {
            emailjsEl.className = 'health-status';
            emailjsEl.innerHTML = '<i class="fa-solid fa-circle"></i> Sin configurar';
        }
    }
    
    // Update Google Maps status
    const gmapsEl = document.getElementById('gmaps-status');
    if (gmapsEl) {
        if (health.googleMaps.configured) {
            gmapsEl.className = 'health-status warning';
            gmapsEl.innerHTML = '<i class="fa-solid fa-circle"></i> Configurado';
        } else {
            gmapsEl.className = 'health-status';
            gmapsEl.innerHTML = '<i class="fa-solid fa-circle"></i> Sin configurar';
        }
    }
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
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    Conecta Supabase para ver usuarios de soporte
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state">
                <i class="fa-solid fa-spinner fa-spin"></i> Cargando...
            </td>
        </tr>
    `;
    
    try {
        const { data, error } = await client
            .from('support_users_db')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        No hay usuarios de soporte registrados
                    </td>
                </tr>
            `;
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
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="color: var(--error-color);">
                    Error al cargar usuarios: ${err.message}
                </td>
            </tr>
        `;
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
                
                const config = window.ConfigManager?.get() || {};
                const supabaseUrl = config.supabase?.url;
                const serviceRoleKey = config.supabase?.serviceRoleKey;
                
                if (!serviceRoleKey) {
                    showToast('Para cambiar contrasenas, configura el Service Role Key en la seccion de APIs', 'error');
                    return;
                }
                
                // Call server endpoint to update password
                const passwordResponse = await fetch('/api/admin/update-user-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: userId,
                        newPassword: newPassword,
                        supabaseUrl: supabaseUrl,
                        serviceRoleKey: serviceRoleKey
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

    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Cargando eventos...</td></tr>';

    try {
        // Wait for ConfigManager to be ready
        if (window.ConfigManager && typeof window.ConfigManager.ready === 'function') {
            await window.ConfigManager.ready();
        }

        // Load events from DB or config
        const events = await window.ConfigManager.getN8NEvents(true); // Force refresh

        if (!events || events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay eventos configurados</td></tr>';
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
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state" style="color: var(--error-color);">
                    Error al cargar eventos: ${err.message}
                </td>
            </tr>
        `;
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

// ============ APP CONTENT EXPORTS ============
window.loadAppContent = loadAppContent;
window.saveNextStepsContent = saveNextStepsContent;
window.saveWebsiteUrl = saveWebsiteUrl;
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
