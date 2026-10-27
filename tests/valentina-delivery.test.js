'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BRANCH, WORKSPACE, ORIGIN, guard, scope, publish, waitForPublication, status } = require('../scripts/release/valentina-delivery.cjs');
const files = ['public/inicio/index.html', 'package.json', 'package-lock.json', 'docs/CHANGELOG.md'];
const options = { title: 'fix(inicio): ajustar el formulario', validation: 'Navegador desktop y móvil comprobados.', files };
function fixture() {
  const state = { head: 'a'.repeat(40), remote: 'a'.repeat(40), version: '2.2.3-valentina.rediseno-laura.4', staged: [], snapshot: 'stable', clock: 0, dirty: true };
  const events = [];
  const io = {
    session: { platform: 'win32', user: 'Dev' },
    inspect: () => ({ root: WORKSPACE, branch: BRANCH, upstream: 'origin/' + BRANCH, origin: ORIGIN, head: state.head, version: state.version, dirty: state.dirty, conflicts: false }),
    login: () => 'valen-rozes', committedVersion: () => '2.2.3-valentina.rediseno-laura.3', staged: () => state.staged, snapshot: () => state.snapshot,
    npm: (...args) => events.push(['npm', ...args]),
    git: args => { events.push(['git', ...args]); if (args[0] === 'add') state.staged = files; if (args[0] === 'commit') { state.head = 'b'.repeat(40); state.dirty = false; } if (args.includes('push')) state.remote = state.head; },
    remoteHead: () => state.remote,
    runs: sha => ({ workflow_runs: [{ id: 1, head_sha: sha, head_branch: BRANCH, event: 'push', path: '.github/workflows/verify.yml', name: 'Verify delivery', status: 'completed', conclusion: 'success', html_url: 'https://github.com/WeOtzi/betav1/actions/runs/1' }] }),
    release: async () => ({ ok: true, environment: 'preview', dataMode: 'browser-demo', commit: state.head, version: state.version }),
    now: () => state.clock, sleep: async ms => { state.clock += ms; }, log: () => {}
  };
  return { io, state, events };
}
test('delivery tests before committing, scopes files and pushes only the permanent branch', async () => {
  const { io, events } = fixture();
  const result = await publish(io, options);
  assert.equal(result.commit, 'b'.repeat(40));
  assert.deepEqual(events.slice(0, 3), [['npm', 'test'], ['npm', 'run', 'check:release'], ['git', 'add', '--', ...files]]);
  const push = events.find(event => event.includes('push'));
  assert.deepEqual(push.slice(-3), ['push', 'origin', BRANCH]);
  assert(push.includes('credential.helper=!gh auth git-credential'));
  const commit = events.find(event => event[1] === 'commit');
  assert.match(commit[3], /Version: 2\.2\.3-valentina\.rediseno-laura\.4/);
  assert.match(commit[3], /Validación:/);
  assert(!events.some(event => event.includes('merge') || event.includes('switch') || event.includes('branch')));
});
test('owner Windows session, wrong clone, wrong branch and wrong GitHub identity cannot publish', async () => {
  for (const kind of ['owner', 'workspace', 'branch', 'github']) {
    const { io, events } = fixture();
    if (kind === 'owner') io.session.user = 'Isaí';
    if (kind === 'github') io.login = () => 'owner';
    if (kind === 'workspace' || kind === 'branch') { const read = io.inspect; io.inspect = () => ({ ...read(), ...(kind === 'workspace' ? { root: 'C:/dev/weotzi-unified' } : { branch: 'main' }) }); }
    await assert.rejects(publish(io, options));
    assert.deepEqual(events, []);
  }
});
test('failing tests leave Git untouched and do not push', async () => {
  const { io, events } = fixture(); io.npm = () => { throw new Error('Test failed'); };
  await assert.rejects(publish(io, options), /Test failed/);
  assert.deepEqual(events, []);
});
test('credential policy failure after staging prevents both commit and push', async () => {
  const { io, events, state } = fixture(); let policies = 0;
  io.npm = (...args) => { if (args.includes('check:release') && ++policies === 2) throw new Error('New file rejected by policy'); };
  await assert.rejects(publish(io, options), /rejected by policy/);
  assert.deepEqual(state.staged, files);
  assert.equal(events.length, 1);
  assert.equal(events[0][1], 'add');
});
test('a failed push preserves the commit and never reports publication', async () => {
  const { io, state } = fixture(); const git = io.git; let checkedRelease = false;
  io.git = args => { if (args.includes('push')) throw new Error('Push rejected'); git(args); };
  io.release = async () => { checkedRelease = true; return {}; };
  await assert.rejects(publish(io, options), /Push rejected/);
  assert.equal(state.head, 'b'.repeat(40));
  assert.equal(state.remote, 'a'.repeat(40));
  assert.equal(checkedRelease, false);
});
test('concurrent edits or branch switches abort before staging or committing', async () => {
  for (const kind of ['file', 'branch']) {
    const { io, state, events } = fixture(); const read = io.inspect; let switched = false;
    io.inspect = () => ({ ...read(), ...(switched ? { branch: 'main' } : {}) });
    io.npm = () => { if (kind === 'file') state.snapshot = 'edited'; else switched = true; };
    await assert.rejects(publish(io, options));
    assert.deepEqual(events, []);
  }
});
test('unrelated staged work and reused versions are preserved without committing', async () => {
  for (const kind of ['staged', 'version']) {
    const { io, state, events } = fixture();
    if (kind === 'staged') state.staged = ['unrelated.js']; else io.committedVersion = () => state.version;
    await assert.rejects(publish(io, options)); assert.deepEqual(events, []);
  }
});
test('scope rejects credentials, traversal, absolute paths and missing version files', () => {
  for (const file of ['.env', 'secrets/key.json', '../outside.js', 'C:/private.txt', '--all']) assert.throws(() => scope([...files, file]));
  assert.throws(() => scope(['public/inicio/index.html']));
});
test('an old publication or PR-only CI cannot be mistaken for this delivery', async () => {
  for (const kind of ['old-release', 'pr', 'version']) {
    const { io } = fixture();
    if (kind === 'old-release') io.release = async () => ({ ok: true, environment: 'preview', commit: 'old' });
    if (kind === 'version') io.release = async () => ({ ok: true, environment: 'preview', dataMode: 'browser-demo', commit: 'a'.repeat(40), version: 'old' });
    if (kind === 'pr') { const runs = io.runs; io.runs = sha => ({ workflow_runs: runs(sha).workflow_runs.map(run => ({ ...run, event: 'pull_request' })) }); }
    await assert.rejects(waitForPublication(io, 'a'.repeat(40), '2.2.3-valentina.rediseno-laura.4', 1), /Todavía no/);
  }
});
test('failed CI stops and a later successful CI plus exact release completes the wait', async () => {
  const failed = fixture(); const runs = failed.io.runs;
  failed.io.runs = sha => ({ workflow_runs: runs(sha).workflow_runs.map(run => ({ ...run, conclusion: 'failure' })) });
  await assert.rejects(waitForPublication(failed.io, failed.state.head, failed.state.version), /CI no aprobó/);
  const pending = fixture(); const good = pending.io.runs; let calls = 0;
  pending.io.runs = sha => ++calls === 1 ? { workflow_runs: [] } : good(sha);
  const result = await waitForPublication(pending.io, pending.state.head, pending.state.version);
  assert.equal(result.ok, true); assert.equal(calls, 2);
});
test('verification distinguishes synchronized commits from uncommitted changes', async () => {
  const { io, state } = fixture(); state.dirty = false;
  assert.equal((await status(io)).synchronized, true);
  state.dirty = true;
  assert.equal((await status(io)).synchronized, false);
  assert.throws(() => guard({ ...io.inspect(), conflicts: true }, io.session), /conflictos/);
});
