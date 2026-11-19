'use strict';
// Beta en el VPS (Easypanel): contexto de imagen, Dockerfile, workflow de publicación y deployer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, exportImageContext } = require('../scripts/release/export-image-context.cjs');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SHA = 'b'.repeat(40);

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weotzi-vps-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fakeGit(files) {
  const blobs = Object.keys(files).map((name, index) => ({ name, blob: String(index).padStart(40, '0') }));
  return (binary, args) => {
    assert.equal(binary, 'git');
    const verb = args[2];
    if (verb === 'rev-parse') return SHA + '\n';
    if (verb === 'ls-tree') return blobs.map(({ name, blob }) => `100644 blob ${blob}\t${name}`).join('\0') + '\0';
    if (verb === 'cat-file') {
      const found = blobs.find(({ blob }) => blob === args[4]);
      return Buffer.from(files[found.name]);
    }
    throw new Error('git inesperado: ' + args.join(' '));
  };
}

test('el contexto de la imagen usa la misma lista permitida que Hostinger y nunca trae secretos', (t) => {
  const out = path.join(temporary(t), 'context');
  const files = {
    'server.js': 'app', 'package.json': '{}', 'package-lock.json': '{}',
    'public/inicio/index.html': '<h1>We Ötzi</h1>', 'lib/a.js': 'x', 'services/b.js': 'y', 'templates/email/c.html': 'z',
    '.env': 'SECRET=1', 'public/.env.local': 'SECRET=1', '.server-credentials': 'x', 'lib/secret-thing.js': 'x',
    'docs/README.md': 'x', 'scripts/release/deploy.cjs': 'x', 'supabase/migrations/1.sql': 'x', 'tests/a.test.js': 'x',
    'deployments/vps/Dockerfile': 'x', 'public/uploads/a.jpg': 'x',
  };
  const count = exportImageContext({ sha: SHA, out, gitDir: 'repo.git' }, fakeGit(files));
  assert.equal(count, 7);
  const exported = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else exported.push(rel);
    }
  };
  walk(out);
  assert.deepEqual(exported.sort(), ['lib/a.js', 'package-lock.json', 'package.json', 'public/inicio/index.html', 'server.js', 'services/b.js', 'templates/email/c.html']);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(out, 'server.js')).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(out, 'lib')).mode & 0o777, 0o755);
  }
});

test('el contexto exige un SHA completo, un directorio vacío y que el commit coincida', (t) => {
  assert.throws(() => parse(['--sha', 'abc', '--out', 'x']), /SHA completo/);
  assert.throws(() => parse(['--sha', SHA]), /--out/);
  assert.throws(() => parse(['--sha', SHA, '--out', 'x', '--raro', '1']), /desconocida/);
  const busy = temporary(t);
  fs.writeFileSync(path.join(busy, 'algo'), 'x');
  assert.throws(() => exportImageContext({ sha: SHA, out: busy }, fakeGit({})), /vacío/);
  const other = (binary, args) => (args[2] === 'rev-parse' ? 'c'.repeat(40) : '');
  assert.throws(() => exportImageContext({ sha: SHA, out: path.join(temporary(t), 'o') }, other), /no coincide/);
});

test('el Dockerfile del VPS: Node 22 con glibc, sin privilegios, escucha hacia afuera y se chequea por /api/release', () => {
  const dockerfile = read('deployments/vps/Dockerfile');
  const froms = dockerfile.match(/^FROM\s+\S+/gm);
  assert.ok(froms.length >= 2);
  for (const from of froms) {
    assert.match(from, /node:22-/);
    assert.match(from, /@sha256:[0-9a-f]{64}$/, 'base fijada por digest');
    assert.doesNotMatch(from, /alpine/i, 'sharp ya corre con glibc; Alpine no está probado');
  }
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /PORT=4545/);
  assert.match(dockerfile, /NGROK_AUTOSTART=false/);
  assert.match(dockerfile, /RELEASE_COMMIT=\$\{RELEASE_COMMIT\}/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/release/);
  assert.doesNotMatch(dockerfile, /LISTEN_SOCKET/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*\.env/);
  assert.equal(fs.existsSync(path.join(ROOT, 'Dockerfile')), false, 'el Dockerfile viejo de la raíz no debe volver (le faltaban lib/ y services/)');
});

test('la imagen solo se publica después del gate de CI de un push a main, sin secretos de producción', () => {
  const workflow = read('.github/workflows/publish-image.yml');
  const verify = read('.github/workflows/verify.yml');
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \["Verify delivery"\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/);
  assert.match(verify, /^name: Verify delivery$/m);
  assert.match(verify, /name: Tests and release policy/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /select\(\.name == "Tests and release policy" and \.head_sha == \$ENV\.SHA\)/);
  assert.match(workflow, /export-image-context\.cjs --sha "\$SHA"/);
  assert.match(workflow, /-f deployments\/vps\/Dockerfile/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\./, 'solo se usa github.token');
  for (const action of workflow.match(/uses: \S+/g)) assert.match(action, /@[0-9a-f]{40}$/, 'acciones fijadas por SHA: ' + action);
  const checkout = verify.match(/actions\/checkout@[0-9a-f]{40}/)[0];
  assert.ok(workflow.includes(checkout), 'mismo checkout fijado que verify.yml');
});

test('el deployer del VPS espera el mismo workflow, job e imagen que publica GitHub', () => {
  const deployer = read('deployments/vps/beta-deployer.py');
  assert.match(deployer, /WORKFLOW_FILE = "verify\.yml"/);
  assert.match(deployer, /WORKFLOW_NAME = "Verify delivery"/);
  assert.match(deployer, /GATE_JOB = "Tests and release policy"/);
  assert.match(deployer, /"WEOTZI_IMAGE", "ghcr\.io\/weotzi\/betav1"/);
  assert.doesNotMatch(deployer, /:sha-\{sha\}/, 'nunca se despliega por etiqueta');
  const workflow = read('.github/workflows/publish-image.yml');
  assert.match(workflow, /IMAGE: ghcr\.io\/weotzi\/betav1/);
  assert.match(workflow, /"\$IMAGE:sha-\$SHA"/);
  // El VPS despliega por el digest que anota el job oficial, no por la etiqueta (mutable).
  assert.match(deployer, /PUBLISH_FILE = "publish-image\.yml"/);
  const jobName = deployer.match(/PUBLISH_JOB = "([^"]+)"/)[1];
  assert.match(workflow, new RegExp('name: ' + jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'));
  const annotation = deployer.match(/DIGEST_ANNOTATION = "([^"]+)"/)[1];
  assert.ok(workflow.includes(`::notice title=${annotation}::$digest`), 'el workflow anota el digest con el título que lee el deployer');
  assert.match(deployer, /f"\{IMAGE\}@\{digest\}"/);
  assert.doesNotMatch(deployer, /open\([^)]*beta\.env/, 'el deployer no lee las variables secretas');
});

test('apagado ordenado: SIGTERM cierra el servidor y espera las peticiones en curso', () => {
  const server = read('server.js');
  assert.match(server, /const httpServer = app\.listen\(/);
  assert.match(server, /process\.once\('SIGTERM', \(\) => gracefulShutdown\('SIGTERM', 0\)\)/);
  assert.match(server, /httpServer\.close\(/);
  assert.match(server, /SHUTDOWN_GRACE_MS/);
  const ngrok = read('lib/local-ngrok.js');
  assert.doesNotMatch(ngrok, /process\.once\('SIGTERM'/, 'ngrok no debe cortar el proceso antes del cierre ordenado');
  assert.doesNotMatch(ngrok, /process\.exit\(/);
  assert.match(ngrok, /process\.once\('exit', stopLocalNgrok\)/);
  // El deployer da a Swarm un margen mayor que el cierre de la app.
  assert.match(read('deployments/vps/beta-deployer.py'), /STOP_GRACE = "25s"/);
});
