#!/usr/bin/env node
'use strict';
// Trusted controller installed outside the repository checkout. Branch code never controls this script.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const os = require('node:os');
const http = require('node:http');
const { runtimePath, safeChild, targetForRef, atomicJson, replaceSymlink, fileManifest, sanitizedPreviewConfig } = require('./runtime.cjs');

function command(binary, args, options = {}) {
  const result = cp.spawnSync(binary, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(binary)} failed (${result.status ?? result.error?.code})`);
  return result.stdout;
}

function validateConfig(config) {
  if (!path.isAbsolute(config.stateRoot || '') || !path.isAbsolute(config.node || '') || !path.isAbsolute(config.pm2 || '')) throw new Error('Deployment paths must be absolute');
  if (config.stateRoot.includes('/public_html/') || config.stateRoot.endsWith('/public_html')) throw new Error('Private state must be outside public_html');
  if (!/^(?:git@github\.com:|https:\/\/github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(config.repository || '')) throw new Error('Use a GitHub repository URL without embedded credentials');
  if (!Number.isInteger(config.mainPort) || !Number.isInteger(config.previewPort) || config.mainPort === config.previewPort) throw new Error('Distinct numeric main and preview ports are required');
  for (const name of ['mainSocket', 'previewSocket']) {
    if (config[name] && (!path.isAbsolute(config[name]) || path.dirname(config[name]) !== safeChild(config.stateRoot, 'sockets'))) throw new Error('Unix sockets must be inside the private sockets directory');
  }
  if (config.mainSocket && config.mainSocket === config.previewSocket) throw new Error('Main and preview must use different sockets');
  if (config.pm2Home && (!path.isAbsolute(config.pm2Home) || !path.resolve(config.pm2Home).startsWith(path.resolve(config.stateRoot) + path.sep))) throw new Error('PM2_HOME must be private to this deployment');
  if (config.mainProcess && !/^weotzi-[a-z0-9][a-z0-9-]{0,40}$/.test(config.mainProcess)) throw new Error('Main process must be a named We Otzi app, never all or a numeric process id');
  return config;
}

function loadJson(filename, fallback = {}) { return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : fallback; }

function acquireLock(root) {
  const lock = safeChild(root, 'deployment.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = loadJson(path.join(lock, 'owner.json'));
    let alive = true;
    if (owner.host === os.hostname() && Number.isInteger(owner.pid)) {
      try { process.kill(owner.pid, 0); } catch (failure) { if (failure.code === 'ESRCH') alive = false; }
    }
    if (alive) throw new Error('Another deployment owns the lock; inspect deployment.lock/owner.json');
    fs.renameSync(lock, lock + '.stale-' + Date.now());
    fs.mkdirSync(lock, { mode: 0o700 });
  }
  atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() });
  return () => fs.rmSync(lock, { recursive: true, force: true });
}

function repository(config, run = command) {
  const gitDirectory = safeChild(config.stateRoot, 'repository.git');
  const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (config.gitSshCommand) environment.GIT_SSH_COMMAND = config.gitSshCommand;
  if (!fs.existsSync(gitDirectory)) run('git', ['clone', '--bare', config.repository, gitDirectory], { env: environment });
  const origin = run('git', ['--git-dir', gitDirectory, 'remote', 'get-url', 'origin'], { env: environment }).trim();
  if (origin !== config.repository) throw new Error('Private checkout origin differs from configured repository');
  return { directory: gitDirectory, env: environment };
}

function fetchCommit(config, ref, sha, run = command) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('A full lowercase Git commit SHA is required');
  targetForRef(ref);
  run('git', ['check-ref-format', '--branch', ref]);
  const repo = repository(config, run);
  const remoteRef = 'refs/remotes/origin/' + ref;
  run('git', ['--git-dir', repo.directory, 'fetch', '--no-tags', 'origin', '+refs/heads/' + ref + ':' + remoteRef], { env: repo.env });
  const actual = run('git', ['--git-dir', repo.directory, 'rev-parse', remoteRef + '^{commit}'], { env: repo.env }).trim();
  if (actual !== sha) throw new Error('Branch moved since this workflow started; deploy the current workflow instead');
  return repo;
}

function exportRuntime(repo, sha, directory, preview, run = command) {
  const listing = run('git', ['--git-dir', repo.directory, 'ls-tree', '-r', '-z', sha]);
  let count = 0;
  for (const line of listing.split('\0').filter(Boolean)) {
    const tab = line.indexOf('\t');
    const [mode, type, blob] = line.slice(0, tab).split(' ');
    const name = line.slice(tab + 1);
    if (!runtimePath(name, preview)) continue;
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error('Runtime symlinks and submodules are forbidden: ' + name);
    const content = run('git', ['--git-dir', repo.directory, 'cat-file', 'blob', blob], { encoding: null });
    const filename = safeChild(directory, ...name.split('/'));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content, { mode: 0o600 });
    count++;
  }
  if (!count || !fs.existsSync(path.join(directory, 'public/inicio/index.html'))) throw new Error('Release is missing the application entry point');
  return count;
}

function linkSharedState(config, directory) {
  const shared = safeChild(config.stateRoot, 'shared');
  const envFile = safeChild(shared, 'main.env');
  if (!fs.existsSync(envFile)) throw new Error('Missing private shared/main.env; bootstrap it before deployment');
  fs.symlinkSync(envFile, safeChild(directory, '.env'));
  for (const relative of ['public/uploads', 'public/storage', 'logs']) {
    const persisted = safeChild(shared, relative.replaceAll('/', '-'));
    fs.mkdirSync(persisted, { recursive: true, mode: 0o700 });
    const destination = safeChild(directory, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(persisted, destination, 'dir');
  }
}

function ecosystem(config, release, target, metadata) {
  const preview = target !== 'main';
  const script = preview ? safeChild(config.stateRoot, 'control', 'preview-server.cjs') : path.join(release, 'server.js');
  return { apps: [{
    name: preview ? 'weotzi-previews' : (config.mainProcess || 'weotzi-beta'), script,
    cwd: preview ? safeChild(config.stateRoot, 'control') : release, interpreter: config.node,
    node_args: !preview && metadata.legacy ? ['--require', safeChild(config.stateRoot, 'control', 'legacy-loopback.cjs')] : [],
    env: preview ? { NODE_ENV: 'production', PORT: config.previewPort, DEPLOY_STATE_ROOT: config.stateRoot, PREVIEW_SOCKET: config.previewSocket || '' }
      : { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: config.mainPort,
        NODE_OPTIONS: '',
        NGROK_AUTOSTART: 'false', LISTEN_SOCKET: config.mainSocket || '', RELEASE_COMMIT: metadata.commit || '', RELEASE_VERSION: metadata.version, RELEASE_ENVIRONMENT: 'beta', DEPLOYMENT_ENV: 'beta' },
    instances: 1, exec_mode: 'fork', autorestart: true, max_restarts: 20, min_uptime: '5s', restart_delay: 2000,
    max_memory_restart: preview ? '160M' : '300M', watch: false, kill_timeout: 5000,
    error_file: safeChild(config.stateRoot, 'logs', preview ? 'previews-error.log' : 'main-error.log'),
    out_file: safeChild(config.stateRoot, 'logs', preview ? 'previews-out.log' : 'main-out.log'), merge_logs: true, log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }] };
}

async function health(url, expectedCommit, fetchFn = fetch, attempts = 25) {
  for (let index = 0; index < attempts; index++) {
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
      const body = await response.json();
      if (response.ok && body.ok === true && (!expectedCommit || body.commit === expectedCommit)) return body;
    } catch (_) { /* allow startup to finish */ }
    if (index + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error('Release health check failed: ' + url);
}

async function legacyHealth(config, fetchFn = fetch, attempts = 25, retryDelayMs = 800) {
  // PM2 start acknowledges a process before its HTTP listener is ready. The adopted baseline
  // needs the same startup grace as current releases, including after a real rollback.
  for (let index = 0; index < attempts; index++) {
    try {
      if (config.mainSocket) {
        const response = await socketRequest(config.mainSocket, '/inicio/');
        if (response.status === 200 && /We\s*(?:Ö|&Ouml;|O)tzi/i.test(response.text)) return;
      } else {
        const response = await fetchFn(`http://127.0.0.1:${config.mainPort}/inicio/`, { signal: AbortSignal.timeout(2500) });
        if (response.ok && /We\s*(?:Ö|&Ouml;|O)tzi/i.test(await response.text())) return;
      }
    } catch (_) { /* legacy startup is still in progress */ }
    if (index + 1 < attempts) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  throw new Error('Legacy application did not recover');
}

function socketRequest(socketPath, route) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: route, method: 'GET', headers: { Host: 'beta.weotzi.com' } }, response => {
      let text = ''; response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; if (text.length > 2 * 1024 * 1024) request.destroy(new Error('Health response too large')); });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.setTimeout(2500, () => request.destroy(new Error('Unix socket health timeout')));
    request.on('error', reject); request.end();
  });
}
async function healthSocket(socketPath, route, expectedCommit, attempts = 25) {
  for (let index = 0; index < attempts; index++) {
    try {
      const response = await socketRequest(socketPath, route), body = JSON.parse(response.text);
      if (response.status === 200 && body.ok === true && (!expectedCommit || body.commit === expectedCommit)) return body;
    } catch (_) {}
    if (index + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error('Unix socket release health check failed');
}

function readRelease(config, target, releaseId) {
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(releaseId)) throw new Error('Invalid release id');
  const directory = safeChild(config.stateRoot, 'releases', target, releaseId);
  const metadata = loadJson(path.join(directory, 'release.json'));
  if (!metadata.releaseId || metadata.target !== target) throw new Error('Release metadata does not match target');
  return { directory, metadata };
}

async function activate(config, target, releaseId, options = {}) {
  const run = options.run || command;
  const probe = options.health || health;
  const socketProbe = options.healthSocket || healthSocket;
  const release = readRelease(config, target, releaseId);
  const currentFile = safeChild(config.stateRoot, 'targets', target + '.json');
  const previous = loadJson(currentFile, null);
  const currentLink = safeChild(config.stateRoot, 'current', target);
  const pm2File = safeChild(config.stateRoot, 'processes', target === 'main' ? 'main.json' : 'previews.json');
  const mapFile = safeChild(config.stateRoot, 'preview-map.json');
  const pm2Env = { ...process.env, PM2_HOME: config.pm2Home || safeChild(config.stateRoot, 'pm2'), PATH: path.dirname(config.node) + path.delimiter + process.env.PATH };
  const oldMap = loadJson(mapFile);
  const preview = target !== 'main';
  fs.mkdirSync(safeChild(config.stateRoot, 'logs'), { recursive: true });
  const start = (directory, metadata) => {
    atomicJson(pm2File, ecosystem(config, directory, target, metadata));
    const appName = preview ? 'weotzi-previews' : (config.mainProcess || 'weotzi-beta');
    // PM2 startOrReload retains pm_exec_path/pm_cwd of an existing app. A new immutable
    // release requires replacement of this one named app in its private daemon.
    const listed = String(run(config.node, [config.pm2, 'jlist'], { env: pm2Env })).trim();
    const jsonStart = listed.search(/\[\s*(?:\{|\])/);
    const apps = JSON.parse(jsonStart >= 0 ? listed.slice(jsonStart) : listed || '[]');
    if (!Array.isArray(apps)) throw new Error('PM2 did not return a valid process inventory');
    if (apps.some(app => app.name === appName)) run(config.node, [config.pm2, 'delete', appName], { env: pm2Env });
    run(config.node, [config.pm2, 'start', pm2File, '--only', appName, '--update-env'], { env: pm2Env });
  };
  try {
    replaceSymlink(currentLink, release.directory);
    if (preview) {
      atomicJson(mapFile, { ...oldMap, [target]: { directory: release.directory, ...release.metadata } });
      start(release.directory, release.metadata);
      if (config.previewSocket) await socketProbe(config.previewSocket, `/preview/${target}/api/release`, release.metadata.commit);
      else await probe(`http://127.0.0.1:${config.previewPort}/preview/${target}/api/release`, release.metadata.commit);
    } else {
      start(release.directory, release.metadata);
      if (release.metadata.legacy) await (options.legacyHealth || legacyHealth)(config);
      else {
        if (config.mainSocket) await socketProbe(config.mainSocket, '/api/release', release.metadata.commit);
        else await probe(`http://127.0.0.1:${config.mainPort}/api/release`, release.metadata.commit);
        if (config.mainPublicUrl) await probe(config.mainPublicUrl.replace(/\/$/, '') + '/api/release', release.metadata.commit);
      }
    }
    run(config.node, [config.pm2, 'save'], { env: pm2Env });
    const state = { ...release.metadata, previousRelease: previous?.releaseId || null, activatedAt: new Date().toISOString() };
    if (options.action === 'rollback' && previous?.commit) state.rollbackHold = { blockedCommit: previous.commit, reason: 'Manual rollback; wait for a new commit or resume' };
    atomicJson(currentFile, state);
    const historyFile = safeChild(config.stateRoot, 'history', target + '.jsonl');
    fs.mkdirSync(path.dirname(historyFile), { recursive: true, mode: 0o700 });
    fs.appendFileSync(historyFile, JSON.stringify({ ...state, action: options.action || 'deploy' }) + '\n', { mode: 0o600 });
    return state;
  } catch (error) {
    // Restore the real process and route, not just its symlink. Keep the failed release for diagnosis.
    if (preview) {
      atomicJson(mapFile, oldMap);
      if (previous) replaceSymlink(currentLink, readRelease(config, target, previous.releaseId).directory);
      else fs.rmSync(currentLink, { force: true });
    } else if (previous) {
      const oldRelease = readRelease(config, target, previous.releaseId);
      replaceSymlink(currentLink, oldRelease.directory);
      start(oldRelease.directory, oldRelease.metadata);
      if (oldRelease.metadata.legacy) await (options.legacyHealth || legacyHealth)(config);
      else if (config.mainSocket) await socketProbe(config.mainSocket, '/api/release', oldRelease.metadata.commit);
      else await probe(`http://127.0.0.1:${config.mainPort}/api/release`, oldRelease.metadata.commit);
    } else {
      throw new Error(error.message + '; no adopted previous release exists for automatic rollback');
    }
    if (previous) atomicJson(currentFile, previous);
    else fs.rmSync(currentFile, { force: true });
    try { run(config.node, [config.pm2, 'save'], { env: pm2Env }); } catch (_) { /* report original failure after runtime rollback */ }
    throw new Error(error.message + '; previous release restored');
  }
}

function adopt(config, source) {
  if (!path.isAbsolute(source || '') || !fs.existsSync(path.join(source, 'server.js'))) throw new Error('Adoption requires the exact running application directory');
  const currentFile = safeChild(config.stateRoot, 'targets', 'main.json');
  if (fs.existsSync(currentFile)) throw new Error('A baseline already exists; adoption cannot overwrite deployment history');
  const releaseId = 'legacy-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const directory = safeChild(config.stateRoot, 'releases', 'main', releaseId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  function copy(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (['public', 'lib', 'services', 'templates'].includes(relative) || runtimePath(relative + '/candidate.txt')) copy(path.join(current, entry.name), relative);
      } else if (entry.isFile() && runtimePath(relative)) {
        const destination = safeChild(directory, ...relative.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(current, entry.name), destination);
      }
    }
  }
  copy(source);
  const shared = safeChild(config.stateRoot, 'shared');
  fs.mkdirSync(shared, { recursive: true, mode: 0o700 });
  const env = safeChild(shared, 'main.env');
  if (!fs.existsSync(env)) fs.copyFileSync(path.join(source, '.env'), env);
  fs.chmodSync(env, 0o600);
  for (const relative of ['public/uploads', 'public/storage', 'logs']) {
    const persisted = safeChild(shared, relative.replaceAll('/', '-'));
    if (!fs.existsSync(persisted) && fs.existsSync(path.join(source, relative))) fs.cpSync(path.join(source, relative), persisted, { recursive: true, dereference: false });
  }
  const npm = path.join(path.dirname(config.node), 'npm');
  command(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, env: { ...process.env, PATH: path.dirname(config.node) + path.delimiter + process.env.PATH } });
  linkSharedState(config, directory);
  const version = loadJson(path.join(directory, 'package.json')).version || 'legacy';
  const metadata = { releaseId, target: 'main', ref: 'legacy-server', commit: null, version, legacy: true, environment: 'beta', createdAt: new Date().toISOString(), source };
  atomicJson(path.join(directory, 'release.json'), metadata);
  atomicJson(path.join(directory, 'release-manifest.json'), fileManifest(directory));
  atomicJson(currentFile, metadata);
  replaceSymlink(safeChild(config.stateRoot, 'current', 'main'), directory);
  return metadata;
}

async function deploy(config, ref, sha, options = {}) {
  const run = options.run || command;
  const target = targetForRef(ref);
  const preview = target !== 'main';
  const repo = fetchCommit(config, ref, sha, run);
  const releaseId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + sha.slice(0, 12);
  const directory = safeChild(config.stateRoot, 'releases', target, releaseId);
  if (fs.existsSync(directory)) throw new Error('Release id already exists; retry after one second');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  exportRuntime(repo, sha, directory, preview, run);
  const packageData = JSON.parse(run('git', ['--git-dir', repo.directory, 'show', sha + ':package.json']));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(packageData.version || '')) throw new Error('package.json requires a semantic release version');
  if (preview) {
    const configFile = path.join(directory, 'public/shared/js/app-config.json');
    const baseConfig = loadJson(configFile);
    atomicJson(configFile, sanitizedPreviewConfig(baseConfig));
  } else {
    // lifecycle scripts cannot execute during installation; native dependencies need explicit review.
    const npm = path.join(path.dirname(config.node), 'npm');
    run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, env: { ...process.env, PATH: path.dirname(config.node) + path.delimiter + process.env.PATH } });
    linkSharedState(config, directory);
  }
  const metadata = { releaseId, target, ref, commit: sha, version: packageData.version, environment: preview ? 'preview' : 'beta', createdAt: new Date().toISOString(), dataMode: preview ? 'browser-demo' : 'live' };
  atomicJson(path.join(directory, 'release.json'), metadata);
  atomicJson(path.join(directory, 'release-manifest.json'), fileManifest(directory));
  return activate(config, target, releaseId, options);
}

async function cli(argv = process.argv.slice(2)) {
  const action = argv.shift();
  const args = {};
  while (argv.length) {
    const key = argv.shift();
    if (!/^--[a-z]+$/.test(key) || !argv.length) throw new Error('Use --config, --ref, --sha, --target and --release pairs');
    args[key.slice(2)] = argv.shift();
  }
  const configPath = args.config || path.join(__dirname, 'deploy-config.json');
  const config = validateConfig(loadJson(configPath));
  fs.mkdirSync(config.stateRoot, { recursive: true, mode: 0o700 });
  const unlock = acquireLock(config.stateRoot);
  try {
    let result;
    if (action === 'deploy') result = await deploy(config, args.ref, args.sha);
    else if (action === 'adopt') result = adopt(config, args.source);
    else if (action === 'resume') {
      const target = args.target || 'main';
      if (target !== 'main' && !/^preview-[a-z0-9-]+$/.test(target)) throw new Error('Invalid target');
      const filename = safeChild(config.stateRoot, 'targets', target + '.json');
      result = loadJson(filename);
      delete result.rollbackHold;
      atomicJson(filename, result);
    }
    else if (action === 'rollback') {
      const target = args.target;
      if (target !== 'main' && !/^preview-[a-z0-9-]+$/.test(target || '')) throw new Error('Invalid rollback target');
      const current = loadJson(safeChild(config.stateRoot, 'targets', target + '.json'));
      const releaseId = args.release || current.previousRelease;
      if (!releaseId) throw new Error('No previous release is available');
      result = await activate(config, target, releaseId, { action: 'rollback' });
    } else if (action === 'status') {
      result = fs.readdirSync(safeChild(config.stateRoot, 'targets')).filter(name => name.endsWith('.json')).map(name => loadJson(safeChild(config.stateRoot, 'targets', name)));
    } else throw new Error('Supported actions: adopt, deploy, rollback, resume, status');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { unlock(); }
}
if (require.main === module) cli().catch(error => { console.error('[Deploy] ' + error.message); process.exitCode = 1; });
module.exports = { command, validateConfig, acquireLock, fetchCommit, exportRuntime, linkSharedState, ecosystem, health, socketRequest, healthSocket, legacyHealth, readRelease, activate, deploy, adopt, cli };
