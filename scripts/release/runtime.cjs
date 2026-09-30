'use strict';
// Shared deployment rules. Never package local secrets, uploads or agent state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_FILES = new Set(['server.js', 'package.json', 'package-lock.json']);
const RUNTIME_DIRS = new Set(['public', 'lib', 'services', 'templates']);
const EXCLUDED_PARTS = /^(?:\.env(?:\..*)?|\.git|\.deploy_backups|node_modules|uploads|storage|backups|logs)$/i;
const EXCLUDED_NAMES = /credential|secret|id_rsa|id_ed25519|\.pem$|\.key$|\.log$|\.clixml$|\.dpapi$|\.php$|\.sql$|\.md$/i;

function runtimePath(name, preview = false) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || name.includes('\0')) return false;
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || EXCLUDED_PARTS.test(part))) return false;
  if (preview ? parts[0] !== 'public' : !ROOT_FILES.has(name) && !RUNTIME_DIRS.has(parts[0])) return false;
  return !EXCLUDED_NAMES.test(parts.at(-1));
}

function safeChild(root, ...parts) {
  const parent = path.resolve(root);
  const child = path.resolve(parent, ...parts);
  if (child === parent || !child.startsWith(parent + path.sep)) throw new Error('Path escapes its deployment directory');
  return child;
}

function targetForRef(ref) {
  if (ref === 'main') return 'main';
  // Git ref validation is also performed by git check-ref-format before fetching.
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,180}$/.test(ref) || ref.includes('..')) throw new Error('Invalid branch name');
  const slug = ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return 'preview-' + slug + '-' + crypto.createHash('sha256').update(ref).digest('hex').slice(0, 8);
}

function atomicJson(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + '.new-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function replaceSymlink(link, destination) {
  fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
  const temporary = link + '.new-' + process.pid;
  fs.rmSync(temporary, { force: true });
  fs.symlinkSync(destination, temporary, process.platform === 'win32' ? 'junction' : 'dir');
  // Linux rename atomically replaces a symlink. Windows junctions need explicit unlink in local tests.
  if (process.platform === 'win32' && fs.existsSync(link)) fs.rmSync(link, { recursive: true, force: true });
  fs.renameSync(temporary, link);
}

function fileManifest(directory) {
  const files = [];
  function walk(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name);
      if (item.isSymbolicLink()) continue; // Shared writable state is recorded separately, never hashed as code.
      if (item.isDirectory()) walk(filename);
      else if (item.isFile() && item.name !== 'release-manifest.json') {
        const data = fs.readFileSync(filename);
        files.push({ path: path.relative(directory, filename).split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length });
      }
    }
  }
  walk(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function sanitizedPreviewConfig(source = {}) {
  return {
    version: source.version || 'preview',
    // Reserved .invalid domain and public marker are consumed only by the injected browser fixture adapter.
    supabase: { url: 'https://preview.weotzi.invalid', anonKey: 'weotzi-preview-public', storageBucket: 'preview-fixtures' },
    n8n: { webhookUrl: '', driveFolderId: '', events: [] },
    googleMaps: { apiKey: '' }, googleDrive: {}, emailjs: {}, gemini: { enabled: false },
    registration: { presetPassword: '' }, weOtzi: { whatsapp: '' },
    // The legacy demo flag disables normal auth controllers. The trusted adapter supplies fake
    // Auth/PostgREST while normal controllers remain active; deployment.dataMode labels the simulation.
    features: { demoMode: false, emailNotifications: false, imageUpload: false },
    app: { defaultCurrency: 'USD', maxImages: 4, maxImageSizeMB: 5, totalSteps: 19 },
    routes: source.routes || {}, demoArtists: source.demoArtists || [],
    deployment: { environment: 'preview', isolated: true, dataMode: 'browser-demo', emailEnabled: false }
  };
}

module.exports = { runtimePath, safeChild, targetForRef, atomicJson, replaceSymlink, fileManifest, sanitizedPreviewConfig };
