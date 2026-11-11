'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const BRANCH = 'valentina/rediseno-laura';
const WORKSPACE = 'C:/WeOtzi-Dev/weotzi-unified';
const REPOSITORY = 'WeOtzi/betav1';
const ORIGIN = 'https://github.com/WeOtzi/betav1.git';
const PREVIEW = 'https://preview.weotzi.chat';
const REQUIRED = ['package.json', 'package-lock.json', 'docs/CHANGELOG.md'];
const normalized = value => String(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

function guard(repo, session) {
  if (session.platform !== 'win32' || session.user.toLowerCase() !== 'dev') throw new Error('La publicación debe ejecutarse desde Windows Dev, en la sesión de Valen. No uses la sesión de Isaí.');
  if (normalized(repo.root) !== normalized(WORKSPACE)) throw new Error('Abre C:\\WeOtzi-Dev\\weotzi-unified en OpenCode; no uses otro clon ni un worktree.');
  if (repo.branch !== BRANCH || repo.upstream !== 'origin/' + BRANCH || repo.origin !== ORIGIN) throw new Error('Rama, upstream u origen incorrectos. Se conserva el trabajo; no se crea ni cambia ninguna rama.');
  if (repo.conflicts) throw new Error('Hay conflictos de Git pendientes. No se publica.');
}

function scope(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Indica solo los archivos de esta tarea mediante --files.');
  for (const file of files) {
    if (!file || file.startsWith('-') || path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes('\\') || file.split('/').some(x => !x || x === '.' || x === '..') || /(^|\/)(?:\.git|\.env(?:\..*)?|uploads|storage|secrets)(\/|$)|\.(?:clixml|dpapi|pem|key)$/i.test(file)) throw new Error('Ruta no permitida para la entrega: ' + file);
  }
  for (const file of REQUIRED) if (!files.includes(file)) throw new Error('La entrega necesita versión y changelog: falta ' + file);
  return [...new Set(files)];
}

function ciProof(runs, sha) {
  return (runs.workflow_runs || []).filter(run => run.head_sha === sha && run.head_branch === BRANCH && run.event === 'push' && String(run.path || '').split('@')[0] === '.github/workflows/verify.yml' && run.name === 'Verify delivery').sort((a, b) => b.id - a.id)[0];
}

async function waitForPublication(io, expectedSha, version, timeoutMs = 15 * 60 * 1000) {
  const started = io.now();
  let phase = '';
  while (io.now() - started <= timeoutMs) {
    const repo = io.inspect();
    if (repo.branch !== BRANCH || repo.head !== expectedSha) throw new Error('La rama o HEAD cambió durante la verificación. No se declara publicada otra entrega.');
    const proof = ciProof(io.runs(expectedSha), expectedSha);
    if (proof?.status === 'completed' && proof.conclusion !== 'success') throw new Error('CI no aprobó el commit ' + expectedSha + ': ' + proof.conclusion + '. Corregí la causa; no hagas force push.');
    if (proof?.status === 'completed' && proof.conclusion === 'success') {
      let release;
      try { release = await io.release(); } catch (_) { /* A restart is not publication success. */ }
      const remote = io.remoteHead();
      if (remote !== expectedSha) throw new Error('La rama remota avanzó a otro commit. Conservá el trabajo y revisá antes de continuar.');
      if (release?.ok === true && release.environment === 'preview' && release.dataMode === 'browser-demo' && release.commit === expectedSha && release.version === version) return { ok: true, branch: BRANCH, commit: expectedSha, version, ci: proof.html_url, url: PREVIEW + '/inicio/' };
      if (phase !== 'publication') { io.log('CI aprobado; esperando la misma SHA en preview.weotzi.chat.'); phase = 'publication'; }
    } else if (phase !== 'ci') { io.log('Esperando Verify delivery del push de esta SHA.'); phase = 'ci'; }
    await io.sleep(15000);
  }
  throw new Error('Todavía no se confirmó la publicación. El commit se conserva. Ejecutá npm run valen:wait para continuar verificando, sin crear otro commit.');
}

async function publish(io, options) {
  const before = io.inspect();
  guard(before, io.session);
  if (io.login() !== 'valen-rozes') throw new Error('GitHub debe estar vinculado a valen-rozes desde Windows Dev. No copies credenciales de Isaí.');
  const files = scope(options.files);
  if (!/^(?:feat|fix|docs|chore|refactor|test|revert)(?:\([^\n]+\))?: .{8,}$/.test(options.title || '') || !options.validation?.trim() || /[\r\n]/.test(options.title + options.validation)) throw new Error('Indica --title convencional y --validation con la evidencia de esta tarea, en una línea cada uno.');
  if (!/^\d+\.\d+\.\d+-valentina\.rediseno-laura\.\d+$/.test(before.version) || before.version === io.committedVersion()) throw new Error('Prepara una versión única con npm run version:delivery y completa el changelog antes de entregar.');
  if (io.staged().some(file => !files.includes(file))) throw new Error('Hay archivos staged ajenos a la lista de esta tarea. Se conservan; no se hace commit.');
  const snapshot = io.snapshot(files);
  io.npm('test');
  io.npm('run', 'check:release');
  guard(io.inspect(), io.session);
  if (io.inspect().head !== before.head || io.snapshot(files) !== snapshot) throw new Error('Los archivos o HEAD cambiaron durante las pruebas. Revisá y volvé a probar antes de hacer commit.');
  io.git(['add', '--', ...files]);
  io.npm('run', 'check:release'); // Includes newly tracked files in the credential scan.
  const staged = io.staged();
  if (!staged.length || staged.some(file => !files.includes(file))) throw new Error('El área staged no coincide con esta entrega. No se hace commit.');
  guard(io.inspect(), io.session);
  const message = options.title + '\n\nVersion: ' + before.version + '\nValidación: ' + options.validation + '\nRollback: revertir este commit con una nueva entrega versionada; no modificar bases de datos ni main.';
  io.git(['commit', '-m', message]);
  const sha = io.inspect().head;
  guard(io.inspect(), io.session);
  // Force this command to use the gh identity checked above, without changing stored credentials.
  io.git(['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', BRANCH]);
  io.log('Commit enviado: ' + sha);
  return waitForPublication(io, sha, before.version);
}

function createIO(root = path.resolve(__dirname, '../..')) {
  function run(binary, args, inherit = false) {
    const result = cp.spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) throw new Error(binary + ' no terminó correctamente' + (result.status === null ? '.' : ' (salida ' + result.status + ').') + ' Revisá su salida en esta sesión.');
    return (result.stdout || '').trim();
  }
  const git = args => run('git', args);
  const optional = args => { try { return git(args); } catch (_) { return ''; } };
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(file => file && file.endsWith('.js') && fs.existsSync(file));
  return {
    session: { platform: process.platform, user: os.userInfo().username },
    inspect: () => ({ root: git(['rev-parse', '--show-toplevel']), branch: git(['branch', '--show-current']), upstream: optional(['rev-parse', '--abbrev-ref', '@{upstream}']), origin: git(['remote', 'get-url', 'origin']), head: git(['rev-parse', 'HEAD']), version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, conflicts: Boolean(git(['diff', '--name-only', '--diff-filter=U'])), dirty: Boolean(git(['status', '--porcelain'])) }),
    git,
    npm: (...args) => { if (!npmCli) throw new Error('No se encontró npm junto a Node. Ejecutá desde la terminal de Windows Dev con Node.js y npm instalados.'); run(process.execPath, [npmCli, ...args], true); },
    login: () => run('gh', ['api', 'user', '--jq', '.login']),
    staged: () => git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean),
    snapshot: files => {
      const hash = crypto.createHash('sha256');
      for (const file of [...files].sort()) { const full = path.join(root, file); hash.update(file); if (!fs.existsSync(full)) { hash.update('deleted'); continue; } if (!fs.lstatSync(full).isFile()) throw new Error('Solo se admiten archivos normales: ' + file); hash.update(fs.readFileSync(full)); }
      return hash.digest('hex');
    },
    committedVersion: () => JSON.parse(git(['show', 'HEAD:package.json'])).version,
    runs: sha => JSON.parse(run('gh', ['api', 'repos/' + REPOSITORY + '/actions/runs?head_sha=' + sha + '&event=push&per_page=30'])),
    remoteHead: () => git(['ls-remote', 'origin', 'refs/heads/' + BRANCH]).split(/\s/)[0],
    release: async () => { const response = await fetch(PREVIEW + '/api/release', { signal: AbortSignal.timeout(10000), redirect: 'error' }); if (!response.ok) throw new Error('Preview no disponible'); return response.json(); },
    now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), log: message => console.log(message)
  };
}

async function status(io) {
  const repo = io.inspect();
  let sessionReady = true, reason = '', login = '';
  try { guard(repo, io.session); login = io.login(); if (login !== 'valen-rozes') throw new Error('La cuenta de GitHub no es valen-rozes.'); } catch (error) { sessionReady = false; reason = error.message; }
  let release = {}, remote = '';
  try { release = await io.release(); remote = io.remoteHead(); } catch (_) { reason ||= 'No se pudo consultar la publicación o la rama remota.'; }
  let ciPassed = false;
  try { const proof = ciProof(io.runs(repo.head), repo.head); ciPassed = proof?.status === 'completed' && proof.conclusion === 'success'; } catch (_) { /* A missing CI proof is not success. */ }
  return { session: io.session, root: repo.root, branch: repo.branch, upstream: repo.upstream, github: login, canPublishHere: sessionReady, reason, pendingChanges: repo.dirty, localCommit: repo.head, remoteCommit: remote, publishedCommit: release.commit || '', ciPassed, synchronized: !repo.dirty && ciPassed && repo.head === remote && remote === release.commit && release.environment === 'preview' && release.version === repo.version, preview: PREVIEW + '/inicio/' };
}

function parse(argv) {
  const action = argv.shift() || 'status', options = {};
  while (argv.length) { const flag = argv.shift(); if (flag === '--files') { options.files = argv.splice(0); break; } if (!['--title', '--validation'].includes(flag) || !argv.length) throw new Error('Usa status, verify, wait o publish --title "fix(...): ..." --validation "..." --files archivo ...'); options[flag.slice(2)] = argv.shift(); }
  return { action, options };
}
async function cli(argv = process.argv.slice(2), io = createIO()) {
  const { action, options } = parse([...argv]);
  let result;
  if (action === 'publish') result = await publish(io, options);
  else if (action === 'wait') { const repo = io.inspect(); guard(repo, io.session); if (io.login() !== 'valen-rozes') throw new Error('Usa tu GitHub valen-rozes.'); result = await waitForPublication(io, repo.head, repo.version); }
  else if (action === 'status' || action === 'verify') { result = await status(io); if (action === 'verify' && (!result.canPublishHere || !result.synchronized)) throw new Error(JSON.stringify(result, null, 2)); }
  else throw new Error('Acción no válida. Usa status, verify, wait o publish.');
  io.log(JSON.stringify(result, null, 2));
  return result;
}
if (require.main === module) cli().catch(error => { console.error('[Valentina] ' + error.message); process.exitCode = 1; });
module.exports = { BRANCH, WORKSPACE, ORIGIN, guard, scope, ciProof, waitForPublication, publish, status, parse, createIO, cli };
