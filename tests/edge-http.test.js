'use strict';
// 2.7.2: diferencias entre el borde de Hostinger (proxy.php + LiteSpeed) y el Traefik de
// Easypanel en el VPS. Ver lib/edge-http.js y deployments/vps/README.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const express = require('express');
const compression = require('compression');
const edge = require('../lib/edge-http');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

async function serve(t, configure) {
    const app = express();
    app.set('trust proxy', 1); // igual que server.js
    configure(app);
    const server = edge.tuneServerTimeouts(app.listen(0, '127.0.0.1'));
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

// Petición cruda: fetch descomprime solo y oculta Content-Encoding.
function raw(url, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

test('clientIp: la IP que agregó el proxy propio, nunca la que inventa el cliente en X-Forwarded-For', async (t) => {
    const base = await serve(t, (app) => app.get('/ip', (req, res) => res.json({ ip: edge.clientIp(req) })));
    // Traefik (forwardedHeaders.insecure) conserva lo del cliente y agrega la IP real al final.
    const spoofed = await (await fetch(`${base}/ip`, { headers: { 'X-Forwarded-For': '203.0.113.77, 198.51.100.9' } })).json();
    assert.equal(spoofed.ip, '198.51.100.9');
    // proxy.php (Hostinger) manda solo REMOTE_ADDR.
    const single = await (await fetch(`${base}/ip`, { headers: { 'X-Forwarded-For': '198.51.100.9' } })).json();
    assert.equal(single.ip, '198.51.100.9');
    // Sin proxy (local): el socket, sin el prefijo IPv4-mapeado.
    const direct = await (await fetch(`${base}/ip`)).json();
    assert.equal(direct.ip, '127.0.0.1');
    assert.equal(edge.clientIp({ socket: { remoteAddress: '::ffff:10.0.0.5' }, headers: { 'x-forwarded-for': '1.1.1.1' } }), '10.0.0.5');
    assert.equal(edge.clientIp(null), '');
});

test('ningún código del servidor vuelve a leer X-Forwarded-For, X-Real-IP ni cf-connecting-ip a mano', () => {
    const files = ['server.js'];
    for (const dir of ['lib', 'services']) {
        const walk = (d) => {
            for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
                const rel = `${d}/${e.name}`;
                if (e.isDirectory()) walk(rel);
                else if (e.name.endsWith('.js')) files.push(rel);
            }
        };
        walk(dir);
    }
    for (const file of files) {
        assert.doesNotMatch(read(file), /['"`](x-forwarded-for|cf-connecting-ip|x-real-ip)['"`]/i, file);
    }
    for (const file of ['server.js', 'lib/routes/perfil.js', 'lib/privacidad-cookies.js']) {
        assert.match(read(file), /edgeHttp\.clientIp|edgeClientIp/, file);
    }
});

test('los 502 propios de la app salen como 504 para que Easypanel no los cambie por su página HTML', async (t) => {
    const base = await serve(t, (app) => {
        app.use(edge.upstreamFailureStatus);
        app.get('/json', (req, res) => res.status(502).json({ success: false, error: 'No pudimos generar la imagen' }));
        app.get('/send-status', (req, res) => res.sendStatus(502));
        app.get('/status-code', (req, res) => { res.statusCode = 502; res.end('x'); });
        app.get('/write-head', (req, res) => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('x'); });
        app.get('/other', (req, res) => res.status(503).json({ error: 'no configurado' }));
    });
    const json = await fetch(`${base}/json`);
    assert.equal(json.status, 504);
    assert.deepEqual(await json.json(), { success: false, error: 'No pudimos generar la imagen' });
    for (const p of ['/send-status', '/status-code', '/write-head']) {
        assert.equal((await fetch(base + p)).status, 504, p);
    }
    assert.equal((await fetch(`${base}/other`)).status, 503, 'el resto de los códigos no cambia');
    assert.equal(edge.UPSTREAM_FAILURE_STATUS, 504);
});

test('el frontend no trata el 504 distinto del 502 (sí al 500 y al 503, por eso no se usan)', () => {
    const walk = (d, out) => {
        for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
            const rel = `${d}/${e.name}`;
            if (e.isDirectory()) { if (!['vendor', 'geo', 'node_modules'].includes(e.name)) walk(rel, out); }
            else if (/\.(js|html)$/.test(e.name) && !/\.min\.js$/.test(e.name)) out.push(rel);
        }
        return out;
    };
    for (const file of walk('public', [])) {
        // Cualquier comparación o pertenencia con 502/504: `status === 504`, `502 === res.status`,
        // `httpStatus >= 502`, `case 504:`, `[502, 504].includes(...)`.
        assert.doesNotMatch(read(file),
            /(?:status\w*|\bcode)\s*(?:[!=]==?|[<>]=?)\s*50[24]\b|\b50[24]\s*[!=]==?\s*[\w.]*status|case\s+50[24]\s*:|\[[^\]\n]*\b50[24]\b[^\]\n]*\]\s*\.includes/i,
            file);
    }
});

test('compresión brotli/gzip como LiteSpeed, sin tocar los pedidos con Range', async (t) => {
    const big = 'We Ötzi '.repeat(800);
    const base = await serve(t, (app) => {
        app.use(compression({ filter: (req, res) => edge.shouldCompress(req, res, compression.filter) }));
        app.get('/text', (req, res) => res.type('text/html').send(big));
        app.get('/small', (req, res) => res.json({ ok: true }));
        app.get('/zip', (req, res) => res.type('application/zip').send(Buffer.alloc(4096, 1)));
    });
    const br = await raw(`${base}/text`, { 'Accept-Encoding': 'br, gzip' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(String(br.headers.vary), /Accept-Encoding/);
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), big);
    const gz = await raw(`${base}/text`, { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gz.body).toString(), big);
    const ranged = await raw(`${base}/text`, { 'Accept-Encoding': 'br, gzip', Range: 'bytes=0-9' });
    assert.equal(ranged.headers['content-encoding'], undefined);
    assert.equal((await raw(`${base}/small`, { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined, 'menos de 1 KB no se comprime');
    assert.equal((await raw(`${base}/zip`, { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined, 'un zip no se recomprime');
});

test('upgrade-insecure-requests solo en HTTPS (paridad con Hostinger, sin romper http://localhost)', async (t) => {
    const base = await serve(t, (app) => {
        app.use(edge.upgradeInsecureRequests);
        app.get('/', (req, res) => res.send('ok'));
    });
    const secure = await raw(`${base}/`, { 'X-Forwarded-Proto': 'https' });
    assert.equal(secure.headers['content-security-policy'], 'upgrade-insecure-requests');
    const plain = await raw(`${base}/`);
    assert.equal(plain.headers['content-security-policy'], undefined);
});

test('keep-alive del servidor más largo que la reutilización de conexiones de Traefik (90 s)', () => {
    const server = edge.tuneServerTimeouts(http.createServer());
    assert.ok(server.keepAliveTimeout > 90000);
    assert.ok(server.headersTimeout > server.keepAliveTimeout);
    assert.equal(edge.tuneServerTimeouts(null), null);
});

test('server.js conecta el borde antes de cualquier ruta o estático', () => {
    const server = read('server.js');
    const at = (needle) => {
        const i = server.indexOf(needle);
        assert.notEqual(i, -1, needle);
        return i;
    };
    const helmet = at('app.use(helmet(');
    const upgrade = at('app.use(edgeHttp.upgradeInsecureRequests)');
    const upstream = at('app.use(edgeHttp.upstreamFailureStatus)');
    const compress = at('app.use(compression({ filter: (req, res) => edgeHttp.shouldCompress(req, res, compression.filter) }))');
    assert.ok(helmet < upgrade && upgrade < upstream && upstream < compress);
    // Antes de helmet solo están /api/release (JSON chico, nunca 502) y stripAppBasePath.
    const before = server.slice(0, helmet).match(/app\.(get|post|put|patch|delete|all|use)\(/g) || [];
    assert.equal(before.length, 2, 'solo /api/release y stripAppBasePath van antes del borde');
    assert.ok(compress < at("app.get('/api/client-info'"), 'antes de las rutas');
    assert.ok(compress < at('express.static('), 'antes de los estáticos');
    assert.match(read('package.json'), /"compression": "\^1\.8\.2"/);
});
