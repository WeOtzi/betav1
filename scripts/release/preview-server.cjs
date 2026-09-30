#!/usr/bin/env node
'use strict';
// This trusted static gateway never runs branch server.js, npm scripts, or application services.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { safeChild, runtimePath, sanitizedPreviewConfig } = require('./runtime.cjs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://code.jquery.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; form-action 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; worker-src 'none'";

function json(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }
function escaped(value) { return String(value).replace(/[&<>"']/g, item => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[item]); }
function rewritePaths(content, prefix) {
  // Only markup attributes and CSS URLs. Rewriting arbitrary JS strings also corrupts regex literals.
  return content.replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])\/(?!\/|__preview\/)([^"']*)\2/gi, (_, name, quote, rest) => name + '=' + quote + prefix + '/' + rest + quote)
    .replace(/url\(\/(?!\/)([^)]+)\)/g, (_, rest) => 'url(' + prefix + '/' + rest + ')');
}

function gateway(config) {
  const root = path.resolve(config.stateRoot);
  return http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Weotzi-Environment', 'preview');
    // Cookies and Authorization are deliberately ignored. Demo identities are browser-local.
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 403, { success: false, preview: true, error: 'Esta preview usa datos de demostración; no ejecuta operaciones de la beta.' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch (_) { return json(response, 400, { error: 'Invalid path' }); }
    if (pathname === '/__preview/bootstrap.js') {
      const bootstrap = path.join(root, 'control', 'preview-bootstrap.js');
      if (!fs.existsSync(bootstrap)) return json(response, 503, { error: 'Preview fixture adapter is not installed' });
      response.writeHead(200, { 'Content-Type': MIME['.js'] });
      return response.end(fs.readFileSync(bootstrap));
    }
    let map;
    try { map = JSON.parse(fs.readFileSync(path.join(root, 'preview-map.json'), 'utf8')); }
    catch (_) { map = {}; }
    // Legacy JS sometimes navigates to root-relative routes. Redirect those requests back to the
    // branch from the same-origin Referer; a demo-only cookie is a fallback for no-Referer navigation.
    if (pathname !== '/' && !pathname.startsWith('/preview/')) {
      let inferred;
      try { inferred = new URL(request.headers.referer).pathname.match(/^\/preview\/(preview-[a-z0-9-]+)(?:\/|$)/)?.[1]; } catch (_) {}
      inferred ||= String(request.headers.cookie || '').match(/(?:^|;\s*)weotzi_preview_target=(preview-[a-z0-9-]+)/)?.[1];
      if (inferred && map[inferred]) {
        response.writeHead(302, { Location: '/preview/' + inferred + pathname + new URL(request.url, 'http://127.0.0.1').search });
        return response.end();
      }
    }
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': MIME['.html'] });
      return response.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>We Ötzi · Previews</title><h1>Previews de desarrollo</h1><p>Datos de demostración. Los cambios de cada rama se prueban aquí antes de integrarlos a main.</p><ul>' + Object.entries(map).map(([target, item]) => '<li><a href="/preview/' + escaped(target) + '/inicio/">' + escaped(item.ref) + '</a> · ' + escaped(item.version) + ' · ' + escaped(item.commit.slice(0, 8)) + '</li>').join('') + '</ul></html>');
    }
    const match = pathname.match(/^\/preview\/(preview-[a-z0-9-]+)(\/.*)?$/);
    if (!match || !map[match[1]]) return json(response, 404, { error: 'Preview not found' });
    const target = match[1], entry = map[target], prefix = '/preview/' + target;
    response.setHeader('Set-Cookie', 'weotzi_preview_target=' + target + '; Path=/; HttpOnly; SameSite=Lax');
    let relative = match[2] || '/';
    if (relative === '/') {
      response.writeHead(302, { Location: prefix + '/inicio/' });
      return response.end();
    }
    if (relative === '/api/release') return json(response, 200, { ok: true, environment: 'preview', dataMode: 'browser-demo', commit: entry.commit, version: entry.version });
    if (relative.startsWith('/api/')) return json(response, 403, { success: false, preview: true, error: 'Backend de beta desactivado en preview' });
    if (relative === '/shared/js/app-config.json') {
      const configPath = path.join(entry.directory, 'public/shared/js/app-config.json');
      return json(response, 200, sanitizedPreviewConfig(JSON.parse(fs.readFileSync(configPath, 'utf8'))));
    }
    try {
      const releaseRoot = safeChild(root, 'releases');
      const directory = path.resolve(entry.directory);
      const localWorkspace = config.workspaceRoot && path.resolve(config.workspaceRoot) === directory;
      if (!localWorkspace && !directory.startsWith(releaseRoot + path.sep)) throw new Error('Invalid release path');
      if (relative.startsWith('/travel/t/')) relative = '/travel/share/index.html';
      let file = safeChild(directory, 'public', relative.slice(1));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!relative.endsWith('/')) {
          response.writeHead(302, { Location: prefix + relative + '/' + new URL(request.url, 'http://127.0.0.1').search });
          return response.end();
        }
        file = path.join(file, 'index.html');
      }
      else if (!path.extname(file)) {
        const index = path.join(file, 'index.html');
        file = fs.existsSync(index) ? index : file + '.html';
      }
      const runtimeRelative = path.relative(directory, file).split(path.sep).join('/');
      if (!runtimePath(runtimeRelative, true)) return json(response, 404, { error: 'Not found' });
      // Even a filesystem symlink introduced outside deployment cannot expose private files.
      const actual = fs.realpathSync(file);
      if (!actual.startsWith(path.join(directory, 'public') + path.sep)) throw new Error('Forbidden link');
      const extension = path.extname(file).toLowerCase();
      const mime = MIME[extension];
      if (!mime) return json(response, 404, { error: 'Unsupported preview file' });
      let body = fs.readFileSync(file);
      if (['.html', '.css'].includes(extension)) {
        let text = rewritePaths(body.toString('utf8'), prefix);
        if (extension === '.html') {
          // The trusted fixture adapter replaces the old URL-triggered demo bootstrap entirely.
          text = text.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:\/|^)wo-demo\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script\s*>/gi, '');
          const pageBase = prefix + (match[2] || '/');
          const injection = '<base href="' + escaped(pageBase) + '"><script>window.WEOTZI_BASE_PATH=' + JSON.stringify(prefix) + ';window.WEOTZI_PREVIEW=true;window.WEOTZI_PREVIEW_COMMIT=' + JSON.stringify(entry.commit) + ';</script><script src="/__preview/bootstrap.js"></script>';
          text = text.replace(/<head(?:\s[^>]*)?>/i, tag => tag + injection);
        }
        body = Buffer.from(text);
      }
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (_) { json(response, 404, { error: 'Not found' }); }
  });
}
if (require.main === module) {
  if (!process.env.DEPLOY_STATE_ROOT) throw new Error('DEPLOY_STATE_ROOT is required');
  const server = gateway({ stateRoot: process.env.DEPLOY_STATE_ROOT });
  if (process.env.PREVIEW_SOCKET) {
    const socket = safeChild(process.env.DEPLOY_STATE_ROOT, 'sockets', path.basename(process.env.PREVIEW_SOCKET));
    if (socket !== path.resolve(process.env.PREVIEW_SOCKET)) throw new Error('Preview socket must be in the private sockets directory');
    fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
    if (fs.existsSync(socket)) { if (!fs.lstatSync(socket).isSocket()) throw new Error('Socket path is occupied by a non-socket file'); fs.unlinkSync(socket); }
    server.listen(socket, () => { fs.chmodSync(socket, 0o600); console.log('[Preview] Trusted demo gateway listening on private Unix socket'); });
  } else server.listen(Number(process.env.PORT || 4670), '127.0.0.1', () => console.log('[Preview] Trusted demo gateway listening on loopback'));
}
module.exports = { gateway, rewritePaths, CSP };
