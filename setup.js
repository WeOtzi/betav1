#!/usr/bin/env node
// ============================================
// WE ÖTZI - BACKUP INSTALLER BOOTSTRAPPER
// Run this file to start the installation process
// ============================================

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const INSTALLER_PORT = 3001;
const ROOT_DIR = __dirname;

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       WE ÖTZI - SYSTEM BACKUP INSTALLER                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

// Check if this is a backup package (has backup folder)
const backupDir = path.join(ROOT_DIR, 'backup');
if (!fs.existsSync(backupDir)) {
    console.error('[ERROR] No backup folder found. This installer requires a valid backup package.');
    console.error('        Make sure you extracted the complete backup ZIP file.');
    process.exit(1);
}

// Check for metadata
const metadataPath = path.join(backupDir, 'metadata.json');
if (!fs.existsSync(metadataPath)) {
    console.error('[ERROR] No metadata.json found in backup folder.');
    console.error('        The backup package may be corrupted.');
    process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
console.log(`  Backup Info:`);
console.log(`  ─────────────────────────────────────────────`);
console.log(`  Created:        ${metadata.created}`);
console.log(`  Original Domain: ${metadata.originalDomain || 'Not specified'}`);
console.log(`  Version:        ${metadata.version || '1.0.0'}`);
console.log('');

// Check if node_modules exists
const nodeModulesPath = path.join(ROOT_DIR, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
    console.log('  [!] node_modules not found. Installing dependencies...');
    console.log('');
    
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawn(npm, ['install'], { 
        cwd: ROOT_DIR, 
        stdio: 'inherit',
        shell: true 
    });
    
    install.on('close', (code) => {
        if (code !== 0) {
            console.error('[ERROR] Failed to install dependencies.');
            process.exit(1);
        }
        startInstaller();
    });
} else {
    startInstaller();
}

function startInstaller() {
    console.log(`  Starting Installer Server on port ${INSTALLER_PORT}...`);
    console.log('');
    
    // Start the installer server
    const installerPath = path.join(ROOT_DIR, 'installer', 'server.js');
    
    if (!fs.existsSync(installerPath)) {
        console.error('[ERROR] Installer server not found at:', installerPath);
        process.exit(1);
    }
    
    const server = spawn('node', [installerPath], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env: { ...process.env, INSTALLER_PORT, ROOT_DIR }
    });
    
    server.on('error', (err) => {
        console.error('[ERROR] Failed to start installer:', err.message);
        process.exit(1);
    });
    
    // Give the server a moment to start, then open browser
    setTimeout(() => {
        const url = `http://localhost:${INSTALLER_PORT}`;
        console.log(`  Opening browser at ${url}`);
        console.log('');
        console.log('  If the browser does not open automatically, visit:');
        console.log(`  ${url}`);
        console.log('');
        
        // Open browser based on platform
        const openCommand = process.platform === 'win32' 
            ? `start ${url}`
            : process.platform === 'darwin' 
                ? `open ${url}`
                : `xdg-open ${url}`;
        
        exec(openCommand, (err) => {
            if (err) {
                console.log('  [!] Could not open browser automatically.');
            }
        });
    }, 2000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n  Shutting down installer...');
        server.kill();
        process.exit(0);
    });
}
