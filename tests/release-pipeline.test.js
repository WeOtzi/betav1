'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimePath, safeChild, targetForRef, atomicJson, sanitizedPreviewConfig } = require('../scripts/release/runtime.cjs');
const { validateConfig, fetchCommit, exportRuntime, activate, health, legacyHealth, ecosystem } = require('../scripts/release/deploy.cjs');
const { gateway, rewritePaths, CSP } = require('../scripts/release/preview-server.cjs');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weotzi-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function fixtureConfig(root) {
  return { stateRoot: root, repository: 'https://github.com/WeOtzi/betav1.git', node: path.join(root, 'node'), pm2: path.join(root, 'pm2'), mainPort: 4545, previewPort: 4670 };
}
function release(root, id, sha, target = 'main') {
  const directory = path.join(root, 'releases', target, id);
  fs.mkdirSync(directory, { recursive: true });
  const metadata = { releaseId: id, target, ref: target === 'main' ? 'main' : 'valentina/test', commit: sha, version: '3.0.0', environment: target === 'main' ? 'beta' : 'preview' };
  atomicJson(path.join(directory, 'release.json'), metadata);
  return { directory, metadata };
}

test('runtime allowlist excludes credentials, mutable data, agent directories and branch backends in previews', () => {
  for (const filename of ['.env', 'public/.env', 'public/uploads/picture.jpg', 'public/storage/x.json', 'scripts/secret.cjs', 'public/backend.php', 'lib/private-key.pem', 'public/id_rsa', 'public/a/../../.env', 'public\\a.js']) assert.equal(runtimePath(filename), false, filename);
  assert.equal(runtimePath('server.js'), true);
  assert.equal(runtimePath('lib/auth/supabase-auth.js'), true);
  assert.equal(runtimePath('public/shared/js/artist-auth.js', true), true);
  assert.equal(runtimePath('server.js', true), false);
  assert.equal(runtimePath('services/email-service.js', true), false);
});

test('paths and ref-derived deployment names resist traversal and slug collisions', () => {
  assert.throws(() => safeChild(os.tmpdir(), '../elsewhere'));
  assert.throws(() => targetForRef('../main'));
  assert.throws(() => targetForRef('a;rm -rf'));
  assert.equal(targetForRef('main'), 'main');
  assert.notEqual(targetForRef('valentina/a-b'), targetForRef('valentina/a/b'));
  assert.match(targetForRef('valentina/Perfil'), /^preview-valentina-perfil-[0-9a-f]{8}$/);
});

test('deployment config refuses public secret state, credential URLs and shared main/preview ports', () => {
  const config = fixtureConfig(path.resolve(os.tmpdir(), 'deploy'));
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, stateRoot: '/home/user/domains/site/public_html/deploy' }));
  assert.throws(() => validateConfig({ ...config, repository: 'https://token@github.com/WeOtzi/betav1.git' }));
  assert.throws(() => validateConfig({ ...config, previewPort: config.mainPort }));
});

test('preview configuration clears every live integration even if branch config contains secrets', () => {
  const preview = sanitizedPreviewConfig({ version: '3.0.0', supabase: { url: 'production', anonKey: 'key' }, n8n: { webhookUrl: 'secret' }, googleDrive: { serviceAccountJson: 'private' }, gemini: { apiKey: 'private' }, emailjs: { serviceId: 'live' }, registration: { presetPassword: 'password' }, features: { demoMode: false } });
  assert.equal(preview.features.demoMode, false);
  assert.equal(preview.features.emailNotifications, false);
  assert.equal(preview.supabase.url, 'https://preview.weotzi.invalid');
  assert.equal(preview.n8n.webhookUrl, '');
  assert.equal(JSON.stringify(preview).includes('private'), false);
  assert.equal(JSON.stringify(preview).includes('password'), false);
});

test('exact ref/SHA check rejects a delayed workflow after its branch moved', t => {
  const root = temporary(t), config = fixtureConfig(root);
  fs.mkdirSync(path.join(root, 'repository.git'));
  const calls = [];
  const run = (binary, args) => {
    calls.push(args);
    if (args.includes('get-url')) return config.repository + '\n';
    if (args.includes('rev-parse')) return 'b'.repeat(40);
    return '';
  };
  assert.throws(() => fetchCommit(config, 'valentina/profile', 'a'.repeat(40), run), /Branch moved/);
  assert.ok(calls.some(args => args.includes('+refs/heads/valentina/profile:refs/remotes/origin/valentina/profile')));
  assert.throws(() => fetchCommit(config, 'main', 'short', run), /full lowercase/);
});

test('tracked runtime export rejects Git symlinks rather than reading through them', t => {
  const root = temporary(t);
  assert.throws(() => exportRuntime({ directory: 'repo' }, 'a'.repeat(40), root, true, () => '120000 blob ' + 'a'.repeat(40) + '\tpublic/shared/leak.js\0'), /symlinks/);
  assert.equal(fs.existsSync(path.join(root, 'public/shared/leak.js')), false);
});

test('runtime export preserves binary bytes and previews exclude every backend blob', t => {
  const root = temporary(t), sha = 'a'.repeat(40), htmlBlob = 'b'.repeat(40), imageBlob = 'c'.repeat(40), serverBlob = 'd'.repeat(40);
  const binary = Buffer.from([0, 255, 137, 80, 78, 71, 13, 10]);
  const listing = `100644 blob ${htmlBlob}\tpublic/inicio/index.html\0` + `100644 blob ${imageBlob}\tpublic/shared/example.png\0` + `100644 blob ${serverBlob}\tserver.js\0`;
  const blobs = { [htmlBlob]: Buffer.from('<html>Preview</html>'), [imageBlob]: binary, [serverBlob]: Buffer.from('backend code') };
  const run = (_, args) => args.includes('ls-tree') ? listing : blobs[args.at(-1)];
  assert.equal(exportRuntime({ directory: 'repository' }, sha, root, true, run), 2);
  assert.deepEqual(fs.readFileSync(path.join(root, 'public/shared/example.png')), binary);
  assert.equal(fs.existsSync(path.join(root, 'server.js')), false);
});

test('release health requires both success and the deployed commit, not merely HTTP 200', async () => {
  await assert.rejects(health('http://localhost/api/release', 'expected', async () => ({ ok: true, json: async () => ({ ok: true, commit: 'old' }) }), 1), /health check failed/);
  const result = await health('http://localhost/api/release', 'expected', async () => ({ ok: true, json: async () => ({ ok: true, commit: 'expected' }) }), 1);
  assert.equal(result.commit, 'expected');
});

test('legacy rollback health waits for startup instead of treating the first refused connection as failure', async () => {
  let probes = 0;
  await legacyHealth({ mainPort: 4545 }, async () => {
    if (++probes < 3) throw new Error('ECONNREFUSED');
    return { ok: true, text: async () => '<html><h1>WE ÖTZI</h1></html>' };
  }, 3, 0);
  assert.equal(probes, 3);
  await assert.rejects(legacyHealth({ mainPort: 4545 }, async () => ({ ok: true, text: async () => 'unrelated HTTP 200' }), 1, 0), /did not recover/);
});

test('failed activation restarts the previous actual process and restores deployment state', async t => {
  const root = temporary(t), config = fixtureConfig(root);
  const previous = release(root, 'old', 'a'.repeat(40)), candidate = release(root, 'new', 'b'.repeat(40));
  atomicJson(path.join(root, 'targets/main.json'), previous.metadata);
  const launches = [];
  const commands = [];
  const run = (_, args, options) => {
    commands.push(args.slice(1));
    assert.equal(options?.env.PM2_HOME, path.join(root, 'pm2'));
    if (args.includes('jlist')) return JSON.stringify([{ name: 'weotzi-beta' }, { name: 'unrelated-app' }]);
    if (args.includes('start')) launches.push(JSON.parse(fs.readFileSync(args[2], 'utf8')).apps[0]);
    return '';
  };
  const probe = async (_, expected) => { if (expected === candidate.metadata.commit) throw new Error('candidate crashed'); return { ok: true }; };
  await assert.rejects(activate(config, 'main', 'new', { run, health: probe }), /previous release restored/);
  assert.deepEqual(launches.map(app => app.cwd), [candidate.directory, previous.directory]);
  assert.deepEqual(commands.filter(args => args[0] !== 'save').map(args => args[0]), ['jlist', 'delete', 'start', 'jlist', 'delete', 'start']);
  assert.ok(commands.filter(args => args[0] === 'delete').every(args => args[1] === 'weotzi-beta'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'targets/main.json'))).releaseId, 'old');
  assert.equal(fs.realpathSync(path.join(root, 'current/main')), fs.realpathSync(previous.directory));
});

test('manual rollback records a hold so auto-poll cannot immediately undo it', async t => {
  const root = temporary(t), config = fixtureConfig(root);
  const previous = release(root, 'old', 'a'.repeat(40)), current = release(root, 'new', 'b'.repeat(40));
  atomicJson(path.join(root, 'targets/main.json'), current.metadata);
  const state = await activate(config, 'main', previous.metadata.releaseId, { run: () => '', health: async () => ({ ok: true }), action: 'rollback' });
  assert.equal(state.rollbackHold.blockedCommit, current.metadata.commit);
  assert.equal(state.commit, previous.metadata.commit);
  assert.equal(state.previousRelease, current.metadata.releaseId);
});

test('main and preview processes use separate listeners and preview runs the trusted gateway only', () => {
  const config = fixtureConfig(path.resolve(os.tmpdir(), 'deploy'));
  const main = ecosystem(config, '/release/main', 'main', { commit: 'a'.repeat(40), version: '3.0.0' }).apps[0];
  const preview = ecosystem(config, '/release/preview', 'preview-valentina-test-12345678', {}).apps[0];
  assert.equal(main.env.HOST, '127.0.0.1');
  assert.equal(main.env.NODE_OPTIONS, '');
  assert.notEqual(main.env.PORT, preview.env.PORT);
  assert.equal(preview.script, path.join(config.stateRoot, 'control/preview-server.cjs'));
  assert.equal(preview.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  const socketConfig = { ...config, mainSocket: path.join(config.stateRoot, 'sockets/main.sock'), previewSocket: path.join(config.stateRoot, 'sockets/previews.sock'), pm2Home: path.join(config.stateRoot, 'pm2') };
  assert.equal(validateConfig(socketConfig), socketConfig);
  assert.equal(ecosystem(socketConfig, '/release/main', 'main', { version: '3.0.0' }).apps[0].env.LISTEN_SOCKET, socketConfig.mainSocket);
  assert.equal(ecosystem(socketConfig, '/release/preview', 'preview-valentina-test-12345678', {}).apps[0].env.PREVIEW_SOCKET, socketConfig.previewSocket);
  assert.throws(() => validateConfig({ ...socketConfig, mainSocket: path.join(os.tmpdir(), 'public.sock') }));
});

test('preview path rewrite preserves CDN and trusted bootstrap URLs', () => {
  const output = rewritePaths('<a href="/artist/dashboard">A</a><script src="https://cdn.jsdelivr.net/a.js"></script><script src="/__preview/bootstrap.js"></script>', '/preview/example');
  assert.ok(output.includes('href="/preview/example/artist/dashboard"'));
  assert.ok(output.includes('https://cdn.jsdelivr.net/a.js'));
  assert.ok(output.includes('src="/__preview/bootstrap.js"'));
});

test('trusted preview gateway serves branch UI and isolated config while denying APIs and traversal', async t => {
  const root = temporary(t), target = 'preview-valentina-test-12345678';
  const item = release(root, 'one', 'a'.repeat(40), target);
  fs.mkdirSync(path.join(item.directory, 'public/inicio'), { recursive: true });
  fs.mkdirSync(path.join(item.directory, 'public/shared/js'), { recursive: true });
  fs.writeFileSync(path.join(item.directory, 'public/inicio/index.html'), '<html><head><script>window.branchCode=true;</script></head><body><a href="/artist/dashboard">Artist</a></body></html>');
  atomicJson(path.join(item.directory, 'public/shared/js/app-config.json'), { supabase: { url: 'production', anonKey: 'private' } });
  fs.mkdirSync(path.join(root, 'control'));
  fs.writeFileSync(path.join(root, 'control/preview-bootstrap.js'), 'window.demoFixture=true;');
  atomicJson(path.join(root, 'preview-map.json'), { [target]: { directory: item.directory, ...item.metadata } });
  const server = gateway({ stateRoot: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port, prefix = '/preview/' + target;
  const page = await fetch(origin + prefix + '/inicio/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), CSP);
  const html = await page.text();
  assert.ok(html.indexOf('/__preview/bootstrap.js') < html.indexOf('window.branchCode'));
  assert.ok(html.includes('window.WEOTZI_PREVIEW=true'));
  assert.ok(html.includes(prefix + '/artist/dashboard'));
  const config = await (await fetch(origin + prefix + '/shared/js/app-config.json')).json();
  assert.equal(config.supabase.url, 'https://preview.weotzi.invalid');
  assert.equal(config.features.demoMode, false);
  const metadata = await (await fetch(origin + prefix + '/api/release')).json();
  assert.equal(metadata.commit, item.metadata.commit);
  assert.equal((await fetch(origin + prefix + '/api/admin/artists')).status, 403);
  assert.equal((await fetch(origin + prefix + '/api/email/events', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(origin + prefix + '/%2e%2e/%2e%2e/.env')).status, 404);
  assert.equal((await fetch(origin + prefix + '/shared/js/private-key.pem')).status, 404);
  assert.equal((await fetch(origin + '/__preview/bootstrap.js')).status, 200);
});
