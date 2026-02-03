// ============================================
// WE ÖTZI - INSTALLER SERVER
// Handles system scanning, restoration, and logging
// ============================================

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const si = require('systeminformation');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.INSTALLER_PORT || 3001;
const ROOT_DIR = process.env.ROOT_DIR || path.join(__dirname, '..');

// Paths
const BACKUP_DIR = path.join(ROOT_DIR, 'backup');
const LOGS_DIR = path.join(ROOT_DIR, 'logs', 'server_clients');
const CONFIG_PATH = path.join(ROOT_DIR, 'public', 'shared', 'js', 'app-config.json');

// Ensure logs directory exists
fs.ensureDirSync(LOGS_DIR);

// Current installation session
let installationLog = [];
let sessionId = null;

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Logger middleware - logs all requests
app.use((req, res, next) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress
    };
    addToLog('REQUEST', logEntry);
    next();
});

// ============================================
// LOGGING FUNCTIONS
// ============================================

function addToLog(type, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        type,
        data
    };
    installationLog.push(entry);
    
    // Write to file if session exists
    if (sessionId) {
        const logPath = path.join(LOGS_DIR, `install_${sessionId}.json`);
        fs.writeJsonSync(logPath, {
            sessionId,
            startedAt: installationLog[0]?.timestamp,
            updatedAt: entry.timestamp,
            entries: installationLog
        }, { spaces: 2 });
    }
    
    return entry;
}

function createAuditLog(systemInfo) {
    sessionId = Date.now().toString();
    const auditPath = path.join(LOGS_DIR, `install_audit_${sessionId}.json`);
    
    const auditData = {
        sessionId,
        type: 'INSTALLATION_ATTEMPT',
        timestamp: new Date().toISOString(),
        systemInfo,
        status: 'STARTED'
    };
    
    fs.writeJsonSync(auditPath, auditData, { spaces: 2 });
    addToLog('AUDIT_CREATED', { auditPath, systemInfo });
    
    return auditData;
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /api/metadata
 * Returns backup metadata
 */
app.get('/api/metadata', async (req, res) => {
    try {
        const metadataPath = path.join(BACKUP_DIR, 'metadata.json');
        if (!fs.existsSync(metadataPath)) {
            return res.status(404).json({ success: false, error: 'Metadata not found' });
        }
        
        const metadata = await fs.readJson(metadataPath);
        res.json({ success: true, metadata });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/audit
 * Performs system audit and creates initial log
 */
app.get('/api/audit', async (req, res) => {
    try {
        addToLog('AUDIT_STARTED', { message: 'Gathering system information...' });
        
        // Gather system information
        const [osInfo, networkInterfaces, cpu, mem, diskLayout] = await Promise.all([
            si.osInfo(),
            si.networkInterfaces(),
            si.cpu(),
            si.mem(),
            si.diskLayout()
        ]);
        
        // Get external IP
        let externalIp = 'Unknown';
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json', { timeout: 5000 });
            const ipData = await ipResponse.json();
            externalIp = ipData.ip;
        } catch (e) {
            addToLog('WARNING', { message: 'Could not fetch external IP', error: e.message });
        }
        
        // Get local IPs
        const localIps = networkInterfaces
            .filter(iface => !iface.internal && iface.ip4)
            .map(iface => ({ name: iface.iface, ip: iface.ip4, mac: iface.mac }));
        
        const systemInfo = {
            hostname: os.hostname(),
            platform: osInfo.platform,
            distro: osInfo.distro,
            release: osInfo.release,
            arch: osInfo.arch,
            nodeVersion: process.version,
            externalIp,
            localIps,
            cpu: {
                manufacturer: cpu.manufacturer,
                brand: cpu.brand,
                cores: cpu.cores
            },
            memory: {
                total: Math.round(mem.total / 1024 / 1024 / 1024) + ' GB',
                free: Math.round(mem.free / 1024 / 1024 / 1024) + ' GB'
            },
            disks: diskLayout.map(d => ({
                name: d.name,
                size: Math.round(d.size / 1024 / 1024 / 1024) + ' GB',
                type: d.type
            })),
            workingDirectory: ROOT_DIR,
            installerPort: PORT
        };
        
        // Check permissions
        const permissionTests = {
            canWriteConfig: false,
            canWriteLogs: false,
            canReadBackup: false
        };
        
        try {
            await fs.access(path.dirname(CONFIG_PATH), fs.constants.W_OK);
            permissionTests.canWriteConfig = true;
        } catch (e) { /* no write access */ }
        
        try {
            await fs.access(LOGS_DIR, fs.constants.W_OK);
            permissionTests.canWriteLogs = true;
        } catch (e) { /* no write access */ }
        
        try {
            await fs.access(BACKUP_DIR, fs.constants.R_OK);
            permissionTests.canReadBackup = true;
        } catch (e) { /* no read access */ }
        
        systemInfo.permissions = permissionTests;
        
        // Create audit log
        const audit = createAuditLog(systemInfo);
        
        res.json({ 
            success: true, 
            systemInfo,
            sessionId,
            audit
        });
        
    } catch (error) {
        addToLog('ERROR', { message: 'Audit failed', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/backup-contents
 * Returns list of available tables and config for restore
 */
app.get('/api/backup-contents', async (req, res) => {
    try {
        const dbDir = path.join(BACKUP_DIR, 'database');
        const configDir = path.join(BACKUP_DIR, 'config');
        
        const contents = {
            tables: [],
            config: null,
            metadata: null
        };
        
        // Read database tables
        if (fs.existsSync(dbDir)) {
            const files = await fs.readdir(dbDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const tableName = file.replace('.json', '');
                    const data = await fs.readJson(path.join(dbDir, file));
                    contents.tables.push({
                        name: tableName,
                        recordCount: Array.isArray(data) ? data.length : 0,
                        file
                    });
                }
            }
        }
        
        // Read config
        const configPath = path.join(configDir, 'app-config.json');
        if (fs.existsSync(configPath)) {
            contents.config = await fs.readJson(configPath);
        }
        
        // Read metadata
        const metadataPath = path.join(BACKUP_DIR, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            contents.metadata = await fs.readJson(metadataPath);
        }
        
        addToLog('BACKUP_CONTENTS_READ', { 
            tablesCount: contents.tables.length,
            hasConfig: !!contents.config
        });
        
        res.json({ success: true, contents });
        
    } catch (error) {
        addToLog('ERROR', { message: 'Failed to read backup contents', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/restore
 * Main restoration endpoint
 */
app.post('/api/restore', async (req, res) => {
    const { 
        targetDomain, 
        targetIp,
        serverPort,
        supabaseConfig,
        apiKeys,
        selectedTables,
        selectedConfig,
        replaceLinks
    } = req.body;
    
    addToLog('RESTORE_STARTED', {
        targetDomain,
        targetIp,
        serverPort,
        selectedTables,
        selectedConfig,
        replaceLinks
    });
    
    const results = {
        configUpdated: false,
        tablesRestored: [],
        linksReplaced: 0,
        errors: []
    };
    
    try {
        // 1. Read metadata for link replacement
        const metadataPath = path.join(BACKUP_DIR, 'metadata.json');
        const metadata = await fs.readJson(metadataPath);
        const originalDomain = metadata.originalDomain || '';
        
        // 2. Update configuration if selected
        if (selectedConfig && selectedConfig.length > 0) {
            addToLog('CONFIG_UPDATE_STARTED', { items: selectedConfig });
            
            const configPath = path.join(BACKUP_DIR, 'config', 'app-config.json');
            let config = {};
            
            if (fs.existsSync(configPath)) {
                config = await fs.readJson(configPath);
            }
            
            // Update Supabase config if provided
            if (supabaseConfig) {
                config.supabase = {
                    ...config.supabase,
                    ...supabaseConfig
                };
                addToLog('CONFIG_UPDATED', { section: 'supabase' });
            }
            
            // Update API keys if provided
            if (apiKeys) {
                for (const [key, value] of Object.entries(apiKeys)) {
                    if (value) {
                        const keyPath = key.split('.');
                        let obj = config;
                        for (let i = 0; i < keyPath.length - 1; i++) {
                            if (!obj[keyPath[i]]) obj[keyPath[i]] = {};
                            obj = obj[keyPath[i]];
                        }
                        obj[keyPath[keyPath.length - 1]] = value;
                        addToLog('API_KEY_UPDATED', { key });
                    }
                }
            }
            
            // Replace domain in config if needed
            if (replaceLinks && targetDomain && originalDomain) {
                const configStr = JSON.stringify(config);
                const updatedConfigStr = configStr.replace(
                    new RegExp(escapeRegex(originalDomain), 'g'), 
                    targetDomain
                );
                config = JSON.parse(updatedConfigStr);
                addToLog('CONFIG_DOMAIN_REPLACED', { from: originalDomain, to: targetDomain });
            }
            
            // Write updated config
            await fs.ensureDir(path.dirname(CONFIG_PATH));
            await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
            results.configUpdated = true;
            addToLog('CONFIG_WRITTEN', { path: CONFIG_PATH });
        }
        
        // 3. Process selected tables
        if (selectedTables && selectedTables.length > 0) {
            addToLog('DB_RESTORE_STARTED', { tables: selectedTables });
            
            // Validate Supabase credentials
            if (!supabaseConfig?.url || !supabaseConfig?.anonKey) {
                throw new Error('Supabase credentials required for database restoration');
            }
            
            const dbDir = path.join(BACKUP_DIR, 'database');
            
            for (const tableName of selectedTables) {
                try {
                    const tablePath = path.join(dbDir, `${tableName}.json`);
                    if (!fs.existsSync(tablePath)) {
                        results.errors.push({ table: tableName, error: 'File not found' });
                        continue;
                    }
                    
                    let tableData = await fs.readJson(tablePath);
                    
                    // Replace links in data if needed
                    if (replaceLinks && targetDomain && originalDomain) {
                        const dataStr = JSON.stringify(tableData);
                        const matches = (dataStr.match(new RegExp(escapeRegex(originalDomain), 'g')) || []).length;
                        const updatedDataStr = dataStr.replace(
                            new RegExp(escapeRegex(originalDomain), 'g'),
                            targetDomain
                        );
                        tableData = JSON.parse(updatedDataStr);
                        results.linksReplaced += matches;
                        addToLog('LINKS_REPLACED_IN_TABLE', { table: tableName, count: matches });
                    }
                    
                    // Upsert data to Supabase
                    const upsertResult = await upsertToSupabase(
                        supabaseConfig.url,
                        supabaseConfig.anonKey,
                        tableName,
                        tableData
                    );
                    
                    results.tablesRestored.push({
                        table: tableName,
                        records: tableData.length,
                        success: upsertResult.success
                    });
                    
                    addToLog('TABLE_RESTORED', { 
                        table: tableName, 
                        records: tableData.length,
                        success: upsertResult.success
                    });
                    
                } catch (tableError) {
                    results.errors.push({ table: tableName, error: tableError.message });
                    addToLog('TABLE_RESTORE_ERROR', { table: tableName, error: tableError.message });
                }
            }
        }
        
        // 4. Update metadata to mark installation
        const installMetadata = {
            ...metadata,
            installedAt: new Date().toISOString(),
            installedDomain: targetDomain,
            installedIp: targetIp,
            installerSessionId: sessionId
        };
        await fs.writeJson(metadataPath, installMetadata, { spaces: 2 });
        
        addToLog('RESTORE_COMPLETED', results);
        
        // Update audit log status
        const auditPath = path.join(LOGS_DIR, `install_audit_${sessionId}.json`);
        if (fs.existsSync(auditPath)) {
            const audit = await fs.readJson(auditPath);
            audit.status = 'COMPLETED';
            audit.completedAt = new Date().toISOString();
            audit.results = results;
            await fs.writeJson(auditPath, audit, { spaces: 2 });
        }
        
        res.json({ success: true, results });
        
    } catch (error) {
        addToLog('RESTORE_FAILED', { error: error.message });
        results.errors.push({ general: error.message });
        res.status(500).json({ success: false, error: error.message, results });
    }
});

/**
 * GET /api/logs
 * Returns current installation log
 */
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: installationLog, sessionId });
});

/**
 * POST /api/test-supabase
 * Tests Supabase connection
 */
app.post('/api/test-supabase', async (req, res) => {
    const { url, anonKey } = req.body;
    
    try {
        const response = await fetch(`${url}/rest/v1/`, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });
        
        if (response.ok) {
            addToLog('SUPABASE_TEST_SUCCESS', { url });
            res.json({ success: true, message: 'Connection successful' });
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        addToLog('SUPABASE_TEST_FAILED', { url, error: error.message });
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scan-links
 * Scans backup for links that need replacement
 */
app.post('/api/scan-links', async (req, res) => {
    const { searchDomain } = req.body;
    
    try {
        const results = {
            config: { count: 0, samples: [] },
            database: {}
        };
        
        // Scan config
        const configPath = path.join(BACKUP_DIR, 'config', 'app-config.json');
        if (fs.existsSync(configPath)) {
            const configStr = await fs.readFile(configPath, 'utf8');
            const matches = configStr.match(new RegExp(escapeRegex(searchDomain), 'g')) || [];
            results.config.count = matches.length;
        }
        
        // Scan database tables
        const dbDir = path.join(BACKUP_DIR, 'database');
        if (fs.existsSync(dbDir)) {
            const files = await fs.readdir(dbDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const tableName = file.replace('.json', '');
                    const dataStr = await fs.readFile(path.join(dbDir, file), 'utf8');
                    const matches = dataStr.match(new RegExp(escapeRegex(searchDomain), 'g')) || [];
                    if (matches.length > 0) {
                        results.database[tableName] = matches.length;
                    }
                }
            }
        }
        
        addToLog('LINK_SCAN_COMPLETED', { searchDomain, results });
        res.json({ success: true, results });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/shutdown
 * Shuts down the installer server
 */
app.post('/api/shutdown', (req, res) => {
    addToLog('INSTALLER_SHUTDOWN', { reason: 'User requested shutdown' });
    res.json({ success: true, message: 'Installer will shut down...' });
    
    setTimeout(() => {
        console.log('\n  Installer server stopped.');
        console.log('  You can now start the main application with: npm start');
        console.log('');
        process.exit(0);
    }, 1000);
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function upsertToSupabase(url, key, table, data) {
    if (!Array.isArray(data) || data.length === 0) {
        return { success: true, message: 'No data to upsert' };
    }
    
    try {
        // Use upsert with onConflict on id
        const response = await fetch(`${url}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': key,
                'Authorization': `Bearer ${key}`,
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase error: ${response.status} - ${errorBody}`);
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       INSTALLER SERVER RUNNING                             ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  Domain:  http://weotzi.com`);
    console.log('');
    console.log('  Waiting for installation to begin...');
    console.log('  Press Ctrl+C to stop the installer.');
    console.log('');
});
