// ============================================
// WE ÖTZI - INSTALLER FRONTEND
// ============================================

let sessionId = null;
let systemInfo = null;
let backupContents = null;
let metadata = null;
let currentStep = 1;
let isInstalling = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    updateTime();
    setInterval(updateTime, 1000);
    
    // Start system audit
    await performAudit();
});

function updateTime() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleString('es-ES');
}

// ============================================
// STEP NAVIGATION
// ============================================

function goToStep(step) {
    if (isInstalling && step < currentStep) return;
    
    // Update steps UI
    document.querySelectorAll('.step').forEach((el, idx) => {
        el.classList.remove('active', 'completed');
        if (idx + 1 < step) el.classList.add('completed');
        if (idx + 1 === step) el.classList.add('active');
    });
    
    // Update content
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${step}`).classList.add('active');
    
    currentStep = step;
    
    // Step-specific actions
    if (step === 2) {
        loadConfigFromBackup();
    } else if (step === 3) {
        loadBackupContents();
    } else if (step === 4) {
        generateSummary();
    }
}

// ============================================
// STEP 1: SYSTEM AUDIT
// ============================================

async function performAudit() {
    try {
        const response = await fetch('/api/audit');
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error);
        
        systemInfo = data.systemInfo;
        sessionId = data.sessionId;
        
        document.getElementById('session-id').textContent = `Session: ${sessionId}`;
        
        // Fill system info
        const sysGrid = document.getElementById('system-info-grid');
        sysGrid.innerHTML = `
            <div class="info-item">
                <span class="label">Hostname</span>
                <span class="value">${systemInfo.hostname}</span>
            </div>
            <div class="info-item">
                <span class="label">Sistema</span>
                <span class="value">${systemInfo.distro} ${systemInfo.release}</span>
            </div>
            <div class="info-item">
                <span class="label">Arquitectura</span>
                <span class="value">${systemInfo.arch}</span>
            </div>
            <div class="info-item">
                <span class="label">Node.js</span>
                <span class="value">${systemInfo.nodeVersion}</span>
            </div>
            <div class="info-item">
                <span class="label">CPU</span>
                <span class="value">${systemInfo.cpu.brand} (${systemInfo.cpu.cores} cores)</span>
            </div>
            <div class="info-item">
                <span class="label">Memoria</span>
                <span class="value">${systemInfo.memory.total} total, ${systemInfo.memory.free} libre</span>
            </div>
            <div class="info-item">
                <span class="label">Directorio</span>
                <span class="value">${systemInfo.workingDirectory}</span>
            </div>
        `;
        
        // Fill network info
        const netGrid = document.getElementById('network-info-grid');
        netGrid.innerHTML = `
            <div class="info-item">
                <span class="label">IP Externa</span>
                <span class="value">${systemInfo.externalIp}</span>
            </div>
            ${systemInfo.localIps.map(ip => `
                <div class="info-item">
                    <span class="label">${ip.name}</span>
                    <span class="value">${ip.ip}</span>
                </div>
            `).join('')}
        `;
        
        // Auto-fill target IP
        document.getElementById('target-ip').value = systemInfo.externalIp !== 'Unknown' 
            ? systemInfo.externalIp 
            : (systemInfo.localIps[0]?.ip || '');
        
        // Fill permissions
        const permList = document.getElementById('permissions-list');
        const perms = systemInfo.permissions;
        permList.innerHTML = `
            <div class="permission-item ${perms.canWriteConfig ? 'ok' : 'error'}">
                <i class="fa-solid ${perms.canWriteConfig ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                <span>Escritura en configuracion</span>
            </div>
            <div class="permission-item ${perms.canWriteLogs ? 'ok' : 'error'}">
                <i class="fa-solid ${perms.canWriteLogs ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                <span>Escritura en logs</span>
            </div>
            <div class="permission-item ${perms.canReadBackup ? 'ok' : 'error'}">
                <i class="fa-solid ${perms.canReadBackup ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                <span>Lectura de backup</span>
            </div>
        `;
        
        // Load backup metadata
        const metaResponse = await fetch('/api/metadata');
        const metaData = await metaResponse.json();
        
        if (metaData.success) {
            metadata = metaData.metadata;
            const backupGrid = document.getElementById('backup-info-grid');
            backupGrid.innerHTML = `
                <div class="info-item">
                    <span class="label">Fecha de Creacion</span>
                    <span class="value">${new Date(metadata.created).toLocaleString('es-ES')}</span>
                </div>
                <div class="info-item">
                    <span class="label">Dominio Original</span>
                    <span class="value">${metadata.originalDomain || 'No especificado'}</span>
                </div>
                <div class="info-item">
                    <span class="label">Version</span>
                    <span class="value">${metadata.version || '1.0.0'}</span>
                </div>
            `;
            
            // Pre-fill scan domain
            if (metadata.originalDomain) {
                document.getElementById('scan-domain').value = metadata.originalDomain;
            }
        }
        
        // Show results
        document.getElementById('audit-loading').classList.add('hidden');
        document.getElementById('audit-results').classList.remove('hidden');
        document.getElementById('btn-next-1').disabled = false;
        
    } catch (error) {
        console.error('Audit failed:', error);
        document.getElementById('audit-loading').innerHTML = `
            <i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i>
            <span>Error en la auditoria: ${error.message}</span>
        `;
    }
}

// ============================================
// STEP 2: CONFIGURATION
// ============================================

async function loadConfigFromBackup() {
    try {
        const response = await fetch('/api/backup-contents');
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error);
        
        backupContents = data.contents;
        const config = backupContents.config;
        
        if (config) {
            // Fill Supabase config
            if (config.supabase) {
                document.getElementById('supabase-url').value = config.supabase.url || '';
                document.getElementById('supabase-anon-key').value = config.supabase.anonKey || '';
                document.getElementById('supabase-service-key').value = config.supabase.serviceRoleKey || '';
                document.getElementById('supabase-bucket').value = config.supabase.storageBucket || '';
            }
            
            // Build API keys grid
            const apiKeysGrid = document.getElementById('api-keys-grid');
            const apiKeys = [];
            
            // Extract known API keys from config
            if (config.google?.mapsApiKey) apiKeys.push({ key: 'google.mapsApiKey', label: 'Google Maps API Key', value: config.google.mapsApiKey });
            if (config.google?.calendarClientId) apiKeys.push({ key: 'google.calendarClientId', label: 'Google Calendar Client ID', value: config.google.calendarClientId });
            if (config.google?.calendarApiKey) apiKeys.push({ key: 'google.calendarApiKey', label: 'Google Calendar API Key', value: config.google.calendarApiKey });
            if (config.googleDrive?.credentials) apiKeys.push({ key: 'googleDrive.credentials', label: 'Google Drive Credentials', value: typeof config.googleDrive.credentials === 'object' ? JSON.stringify(config.googleDrive.credentials) : config.googleDrive.credentials, isJson: true });
            if (config.googleDrive?.folderId) apiKeys.push({ key: 'googleDrive.folderId', label: 'Google Drive Folder ID', value: config.googleDrive.folderId });
            if (config.gemini?.apiKey) apiKeys.push({ key: 'gemini.apiKey', label: 'Gemini AI API Key', value: config.gemini.apiKey });
            if (config.emailjs?.serviceId) apiKeys.push({ key: 'emailjs.serviceId', label: 'EmailJS Service ID', value: config.emailjs.serviceId });
            if (config.emailjs?.templateId) apiKeys.push({ key: 'emailjs.templateId', label: 'EmailJS Template ID', value: config.emailjs.templateId });
            if (config.emailjs?.publicKey) apiKeys.push({ key: 'emailjs.publicKey', label: 'EmailJS Public Key', value: config.emailjs.publicKey });
            if (config.n8n?.webhookUrl) apiKeys.push({ key: 'n8n.webhookUrl', label: 'n8n Webhook URL', value: config.n8n.webhookUrl });
            
            apiKeysGrid.innerHTML = apiKeys.map(api => `
                <div class="form-group api-key-item">
                    <label for="api-${api.key}">${api.label}</label>
                    <div class="input-password">
                        <input type="password" id="api-${api.key}" data-api-key="${api.key}" 
                               value="${api.value || ''}" ${api.isJson ? 'data-is-json="true"' : ''}>
                        <button type="button" onclick="togglePassword('api-${api.key}')">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>
            `).join('');
            
            if (apiKeys.length === 0) {
                apiKeysGrid.innerHTML = '<p class="empty-state">No se encontraron claves API en el backup</p>';
            }
        }
        
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling?.querySelector('i') || input.parentElement.querySelector('button i');
    
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        if (icon) icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function toggleAllApiKeys() {
    const inputs = document.querySelectorAll('#api-keys-grid input[type="password"], #api-keys-grid input[type="text"]');
    const showAll = inputs[0]?.type === 'password';
    
    inputs.forEach(input => {
        input.type = showAll ? 'text' : 'password';
    });
}

async function testSupabase() {
    const url = document.getElementById('supabase-url').value;
    const key = document.getElementById('supabase-anon-key').value;
    const statusEl = document.getElementById('supabase-status');
    
    if (!url || !key) {
        statusEl.innerHTML = '<i class="fa-solid fa-circle" style="color: #f59e0b;"></i> Completa los campos';
        return;
    }
    
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Probando...';
    
    try {
        const response = await fetch('/api/test-supabase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, anonKey: key })
        });
        
        const data = await response.json();
        
        if (data.success) {
            statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> Conexion exitosa';
        } else {
            statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> ${data.error}`;
        }
    } catch (error) {
        statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> ${error.message}`;
    }
}

// ============================================
// STEP 3: SELECTION
// ============================================

async function loadBackupContents() {
    if (!backupContents) {
        const response = await fetch('/api/backup-contents');
        const data = await response.json();
        if (data.success) backupContents = data.contents;
    }
    
    // Fill tables list
    const tablesList = document.getElementById('tables-list');
    
    if (backupContents?.tables?.length > 0) {
        tablesList.innerHTML = backupContents.tables.map(table => `
            <label class="selection-item">
                <input type="checkbox" name="table-item" value="${table.name}" checked>
                <span>${table.name}</span>
                <span class="badge">${table.recordCount} registros</span>
            </label>
        `).join('');
    } else {
        tablesList.innerHTML = '<p class="empty-state">No se encontraron tablas en el backup</p>';
    }
}

function toggleAllTables(checked) {
    document.querySelectorAll('input[name="table-item"]').forEach(cb => cb.checked = checked);
}

function toggleAllConfig(checked) {
    document.querySelectorAll('input[name="config-item"]').forEach(cb => cb.checked = checked);
}

async function scanLinks() {
    const searchDomain = document.getElementById('scan-domain').value;
    if (!searchDomain) {
        alert('Ingresa un dominio a buscar');
        return;
    }
    
    try {
        const response = await fetch('/api/scan-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ searchDomain })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const resultsDiv = document.getElementById('scan-results');
            const contentDiv = document.getElementById('scan-results-content');
            
            let html = `<p>Encontradas <strong>${data.results.config.count}</strong> referencias en configuracion.</p>`;
            
            const dbTables = Object.entries(data.results.database);
            if (dbTables.length > 0) {
                html += '<p>Referencias en base de datos:</p><ul>';
                dbTables.forEach(([table, count]) => {
                    html += `<li><strong>${table}:</strong> ${count} referencias</li>`;
                });
                html += '</ul>';
            } else {
                html += '<p>No se encontraron referencias en la base de datos.</p>';
            }
            
            contentDiv.innerHTML = html;
            resultsDiv.classList.remove('hidden');
        }
    } catch (error) {
        alert('Error al escanear: ' + error.message);
    }
}

// ============================================
// STEP 4: INSTALLATION
// ============================================

function generateSummary() {
    const summary = document.getElementById('install-summary');
    
    const selectedTables = Array.from(document.querySelectorAll('input[name="table-item"]:checked')).map(cb => cb.value);
    const selectedConfig = Array.from(document.querySelectorAll('input[name="config-item"]:checked')).map(cb => cb.value);
    const replaceLinks = document.getElementById('replace-links').checked;
    const targetDomain = document.getElementById('target-domain').value;
    const targetIp = document.getElementById('target-ip').value;
    
    summary.innerHTML = `
        <div class="summary-item">
            <span class="summary-label">Dominio destino:</span>
            <span class="summary-value">${targetDomain || 'No especificado'}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">IP destino:</span>
            <span class="summary-value">${targetIp || 'No especificado'}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Tablas a restaurar:</span>
            <span class="summary-value">${selectedTables.length} tablas</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Configuracion:</span>
            <span class="summary-value">${selectedConfig.join(', ') || 'Ninguna'}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Reemplazo de enlaces:</span>
            <span class="summary-value">${replaceLinks ? 'Si' : 'No'}</span>
        </div>
    `;
}

async function startInstallation() {
    if (isInstalling) return;
    
    if (!confirm('¿Estas seguro de iniciar la instalacion? Este proceso modificara archivos y datos.')) {
        return;
    }
    
    isInstalling = true;
    
    // Disable navigation
    document.getElementById('btn-back-4').disabled = true;
    document.getElementById('btn-install').disabled = true;
    document.getElementById('btn-install').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando...';
    
    // Show progress
    document.getElementById('install-progress').classList.remove('hidden');
    
    // Gather data
    const selectedTables = Array.from(document.querySelectorAll('input[name="table-item"]:checked')).map(cb => cb.value);
    const selectedConfig = Array.from(document.querySelectorAll('input[name="config-item"]:checked')).map(cb => cb.value);
    
    const apiKeys = {};
    document.querySelectorAll('#api-keys-grid input[data-api-key]').forEach(input => {
        if (input.value) {
            apiKeys[input.dataset.apiKey] = input.dataset.isJson === 'true' 
                ? JSON.parse(input.value) 
                : input.value;
        }
    });
    
    const payload = {
        targetDomain: document.getElementById('target-domain').value,
        targetIp: document.getElementById('target-ip').value,
        serverPort: document.getElementById('server-port').value,
        supabaseConfig: {
            url: document.getElementById('supabase-url').value,
            anonKey: document.getElementById('supabase-anon-key').value,
            serviceRoleKey: document.getElementById('supabase-service-key').value,
            storageBucket: document.getElementById('supabase-bucket').value
        },
        apiKeys,
        selectedTables,
        selectedConfig,
        replaceLinks: document.getElementById('replace-links').checked
    };
    
    addLog('INFO', 'Iniciando proceso de instalacion...');
    updateProgress(10, 'Preparando restauracion...');
    
    try {
        const response = await fetch('/api/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateProgress(100, 'Instalacion completada');
            addLog('SUCCESS', 'Instalacion completada exitosamente');
            
            if (data.results.tablesRestored.length > 0) {
                addLog('INFO', `Tablas restauradas: ${data.results.tablesRestored.map(t => t.table).join(', ')}`);
            }
            if (data.results.linksReplaced > 0) {
                addLog('INFO', `Enlaces reemplazados: ${data.results.linksReplaced}`);
            }
            if (data.results.errors.length > 0) {
                data.results.errors.forEach(err => {
                    addLog('ERROR', `Error: ${err.table || err.general} - ${err.error || ''}`);
                });
            }
            
            // Show completion
            document.getElementById('completion-card').classList.remove('hidden');
            
            // Update app link
            const targetDomain = document.getElementById('target-domain').value;
            const serverPort = document.getElementById('server-port').value;
            if (targetDomain) {
                document.getElementById('open-app-link').href = targetDomain;
            } else {
                document.getElementById('open-app-link').href = `http://localhost:${serverPort}`;
            }
            
        } else {
            throw new Error(data.error);
        }
        
    } catch (error) {
        addLog('ERROR', `Error en la instalacion: ${error.message}`);
        updateProgress(0, 'Error en la instalacion');
        
        document.getElementById('btn-back-4').disabled = false;
        document.getElementById('btn-install').disabled = false;
        document.getElementById('btn-install').innerHTML = '<i class="fa-solid fa-play"></i> Reintentar';
        isInstalling = false;
    }
}

function updateProgress(percent, status) {
    document.getElementById('progress-fill').style.width = `${percent}%`;
    document.getElementById('progress-percent').textContent = `${percent}%`;
    document.getElementById('progress-status').textContent = status;
}

function addLog(type, message) {
    const logsContainer = document.getElementById('logs-container');
    const now = new Date();
    const time = now.toLocaleTimeString('es-ES');
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type.toLowerCase()}`;
    logEntry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-type">[${type}]</span>
        <span class="log-message">${message}</span>
    `;
    
    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

async function refreshLogs() {
    try {
        const response = await fetch('/api/logs');
        const data = await response.json();
        
        if (data.success && data.logs.length > 0) {
            const logsContainer = document.getElementById('logs-container');
            logsContainer.innerHTML = data.logs.map(log => `
                <div class="log-entry ${log.type.toLowerCase()}">
                    <span class="log-time">${new Date(log.timestamp).toLocaleTimeString('es-ES')}</span>
                    <span class="log-type">[${log.type}]</span>
                    <span class="log-message">${typeof log.data === 'object' ? JSON.stringify(log.data) : log.data}</span>
                </div>
            `).join('');
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to refresh logs:', error);
    }
}

async function shutdownInstaller() {
    if (confirm('¿Cerrar el instalador? Recuerda iniciar la aplicacion con "npm start".')) {
        try {
            await fetch('/api/shutdown', { method: 'POST' });
            document.body.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Inter, sans-serif; background: #0a0a0a; color: #fff;">
                    <i class="fa-solid fa-circle-check" style="font-size: 64px; color: #22c55e; margin-bottom: 24px;"></i>
                    <h1>Instalador Cerrado</h1>
                    <p>Puedes cerrar esta ventana.</p>
                    <p style="margin-top: 24px; color: #888;">Para iniciar la aplicacion ejecuta: <code style="background: #222; padding: 4px 8px; border-radius: 4px;">npm start</code></p>
                </div>
            `;
        } catch (error) {
            alert('Error al cerrar el instalador');
        }
    }
}
