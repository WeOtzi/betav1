const { spawn } = require('child_process');

const DEFAULT_NGROK_API_PORTS = [4040, 4041, 4042, 4043, 4044, 4045, 4046, 4047, 4048, 4049, 4050];

let ngrokProcess = null;

function enabled(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizePublicUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function redactSecrets(text) {
    const token = process.env.NGROK_AUTHTOKEN;
    if (!token) return text;
    return text.split(token).join('[redacted-ngrok-token]');
}

async function localTunnelExists(publicUrl) {
    if (!publicUrl) return false;

    for (const port of DEFAULT_NGROK_API_PORTS) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/tunnels`);
            if (!response.ok) continue;
            const payload = await response.json();
            const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
            if (tunnels.some(tunnel => tunnel.public_url === publicUrl)) {
                return true;
            }
        } catch {
            // Keep probing the next local ngrok inspector port.
        }
    }

    return false;
}

function buildNgrokArgs({ publicUrl, targetPort, authtoken }) {
    const args = ['http', `http://127.0.0.1:${targetPort}`, '--log=stdout'];

    if (publicUrl) {
        args.push('--url', publicUrl.replace(/^https?:\/\//, ''));
    }

    if (authtoken) {
        args.push('--authtoken', authtoken);
    }

    return args;
}

async function startLocalNgrok({ targetPort } = {}) {
    if (!enabled(process.env.NGROK_AUTOSTART)) {
        return { started: false, reason: 'disabled' };
    }

    if (process.env.NODE_ENV === 'test') {
        return { started: false, reason: 'disabled-in-test' };
    }

    if (ngrokProcess && !ngrokProcess.killed) {
        return { started: false, reason: 'already-started' };
    }

    const publicUrl = normalizePublicUrl(process.env.NGROK_URL || process.env.NGROK_DOMAIN);
    const port = Number(process.env.NGROK_TARGET_PORT || targetPort);

    if (!Number.isInteger(port) || port <= 0) {
        console.warn('[ngrok] NGROK_TARGET_PORT is invalid; skipping tunnel startup.');
        return { started: false, reason: 'invalid-port' };
    }

    if (await localTunnelExists(publicUrl)) {
        console.log(`[ngrok] Reusing active local tunnel: ${publicUrl}`);
        return { started: false, reason: 'reused-local-tunnel', publicUrl };
    }

    const args = buildNgrokArgs({
        publicUrl,
        targetPort: port,
        authtoken: process.env.NGROK_AUTHTOKEN
    });

    console.log(`[ngrok] Starting tunnel ${publicUrl || '(random url)'} -> http://127.0.0.1:${port}`);

    ngrokProcess = spawn('ngrok', args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    ngrokProcess.stdout.on('data', chunk => {
        const message = redactSecrets(chunk.toString()).trim();
        if (message) console.log(`[ngrok] ${message}`);
    });

    ngrokProcess.stderr.on('data', chunk => {
        const message = redactSecrets(chunk.toString()).trim();
        if (!message) return;

        if (message.includes('ERR_NGROK_334')) {
            console.warn(`[ngrok] ${publicUrl} is already online. Reusing the existing endpoint if it points here.`);
            return;
        }

        console.warn(`[ngrok] ${message}`);
    });

    ngrokProcess.on('error', err => {
        console.warn(`[ngrok] Could not start ngrok: ${err.message}`);
    });

    ngrokProcess.on('exit', (code, signal) => {
        ngrokProcess = null;
        if (code === 0 || signal) return;
        console.warn(`[ngrok] Tunnel process exited with code ${code}.`);
    });

    return { started: true, publicUrl };
}

function stopLocalNgrok() {
    if (!ngrokProcess || ngrokProcess.killed) return;
    ngrokProcess.kill();
    ngrokProcess = null;
}

process.once('exit', stopLocalNgrok);
process.once('SIGINT', () => {
    stopLocalNgrok();
    process.exit(130);
});
process.once('SIGTERM', () => {
    stopLocalNgrok();
    process.exit(143);
});

module.exports = {
    startLocalNgrok,
    stopLocalNgrok,
    normalizePublicUrl,
    buildNgrokArgs
};
