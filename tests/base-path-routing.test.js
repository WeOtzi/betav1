const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const port = 4687;
const baseUrl = `http://127.0.0.1:${port}`;

function startServer(extraEnv = {}) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: rootDir,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            ...extraEnv
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', chunk => {
        output += chunk.toString();
    });
    child.stderr.on('data', chunk => {
        output += chunk.toString();
    });

    return { child, getOutput: () => output };
}

async function stopServer(child) {
    if (!child || child.killed) return;

    child.kill();
    await new Promise(resolve => {
        const timer = setTimeout(resolve, 1500);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function waitForServer(getOutput) {
    const deadline = Date.now() + 12000;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/client-info`);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`Server did not become ready: ${lastError?.message || 'timeout'}\n${getOutput()}`);
}

test('serves app pages, static assets and API routes under /beta base path', async () => {
    const { child, getOutput } = startServer();

    try {
        await waitForServer(getOutput);

        const page = await fetch(`${baseUrl}/beta/registerclosedbeta`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /registerclosedbeta-page/);

        const visitorsPage = await fetch(`${baseUrl}/beta/artist/visitors/`);
        assert.equal(visitorsPage.status, 200);
        assert.match(await visitorsPage.text(), /block-visitors-map/);

        const asset = await fetch(`${baseUrl}/beta/shared/js/config-manager.js`);
        assert.equal(asset.status, 200);
        assert.match(await asset.text(), /CONFIGURATION MANAGER/);

        const api = await fetch(`${baseUrl}/beta/api/client-info`);
        assert.equal(api.status, 200);
        assert.match(api.headers.get('content-type') || '', /application\/json/);
        const payload = await api.json();
        assert.equal(typeof payload.ip, 'string');
        assert.equal(typeof payload.timestamp, 'string');
    } finally {
        await stopServer(child);
    }
});

test('development CORS accepts ngrok preview origins for assets and API preflight', async () => {
    const { child, getOutput } = startServer();
    const origin = 'https://beta.weotzi.ngrok.app';

    try {
        await waitForServer(getOutput);

        const asset = await fetch(`${baseUrl}/shared/js/globe/globe-app.js`, {
            headers: { Origin: origin }
        });
        assert.equal(asset.status, 200);
        assert.equal(asset.headers.get('access-control-allow-origin'), origin);
        assert.match(await asset.text(), /GLOBE APP/);

        const preflight = await fetch(`${baseUrl}/api/support-chat/conversation`, {
            method: 'OPTIONS',
            headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type'
            }
        });
        assert.notEqual(preflight.status, 500);
        assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    } finally {
        await stopServer(child);
    }
});

test('profile visit endpoint is registered under /beta and returns JSON when Supabase is unavailable', async () => {
    const { child, getOutput } = startServer({
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: ''
    });

    try {
        await waitForServer(getOutput);

        const response = await fetch(`${baseUrl}/beta/api/artist/profile-visit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artist_username: 'demo.wo',
                device_fingerprint: 'test-device'
            })
        });

        assert.equal(response.status, 503);
        assert.match(response.headers.get('content-type') || '', /application\/json/);

        const payload = await response.json();
        assert.equal(payload.success, false);
        assert.match(payload.error, /Supabase/i);
    } finally {
        await stopServer(child);
    }
});
