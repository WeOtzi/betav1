'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PublicGithub, parseHeads, sameTrustedGates, verifiedRun, poll } = require('../scripts/release/poll.cjs');
const { atomicJson, targetForRef } = require('../scripts/release/runtime.cjs');

const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40);
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weotzi-poll-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function config(root) { return { stateRoot: root, repository: 'https://github.com/WeOtzi/betav1.git' }; }
function proofClient(options = {}) {
  return { async get(route) {
    if (route.endsWith('/actions/workflows/verify.yml')) return { id: 7, path: '.github/workflows/verify.yml', name: 'Verify delivery', state: 'active', ...options.workflow };
    if (route.includes('/jobs?')) return { jobs: [{ name: 'Tests and release policy', status: 'completed', conclusion: 'success', head_sha: SHA, ...options.job }] };
    return { workflow_runs: [{ id: 11, workflow_id: 7, head_sha: SHA, head_branch: 'main', event: 'push', path: '.github/workflows/verify.yml', status: 'completed', conclusion: 'success', run_attempt: 1, html_url: 'https://github.com/WeOtzi/betav1/actions/runs/11', ...options.run }] };
  } };
}

test('poller accepts only main and Valentina heads and ignores tags or unrelated branches', () => {
  const heads = parseHeads(`${SHA}\trefs/heads/main\n${OTHER}\trefs/heads/valentina/profile\n${OTHER}\trefs/heads/codex/other\n${OTHER}\trefs/tags/v3\n${OTHER}\trefs/heads/test`);
  assert.deepEqual(heads, { main: SHA, 'valentina/profile': OTHER });
});
test('CI proof requires correct workflow, SHA, branch, push event, completed run and verified job', async () => {
  assert.equal((await verifiedRun(proofClient(), 'WeOtzi/betav1', 'main', SHA)).ok, true);
  for (const options of [
    { workflow: { path: '.github/workflows/spoof.yml' } },
    { run: { head_sha: OTHER } }, { run: { head_branch: 'valentina/other' } }, { run: { event: 'pull_request' } },
    { run: { workflow_id: 8 } }, { run: { status: 'in_progress' } }, { run: { conclusion: 'failure' } },
    { job: { name: 'fake success' } }, { job: { conclusion: 'skipped' } }, { job: { head_sha: OTHER } }
  ]) assert.equal((await verifiedRun(proofClient(options), 'WeOtzi/betav1', 'main', SHA)).ok, false, JSON.stringify(options));
});
test('preview branches cannot replace trusted workflow, policy or npm test command', () => {
  function runner(changed) {
    return (_, args) => {
      const object = args.at(-1), branch = object.startsWith(OTHER);
      if (args.includes('show')) return JSON.stringify({ scripts: { test: branch && changed === 'test' ? 'echo success' : 'node --test tests/*.test.js' } });
      return branch && object.endsWith(changed || 'none') ? OTHER : SHA;
    };
  }
  assert.equal(sameTrustedGates({ directory: 'repository' }, OTHER, SHA, runner()).ok, true);
  for (const changed of ['.github/workflows/verify.yml', 'scripts/release/check-policy.cjs', 'test']) assert.equal(sameTrustedGates({ directory: 'repository' }, OTHER, SHA, runner(changed)).ok, false);
});
test('anonymous GitHub cache uses ETag and remembers rate-limit backoff without granting approval', async () => {
  let now = 100000, calls = 0;
  const cache = {};
  const client = new PublicGithub(cache, { now: () => now, fetch: async (_, options) => {
    calls++;
    if (calls === 1) return { ok: true, status: 200, headers: new Headers({ etag: 'etag-one' }), json: async () => ({ state: 'active' }) };
    if (calls === 2) { assert.equal(options.headers['If-None-Match'], 'etag-one'); return { ok: false, status: 304, headers: new Headers() }; }
    return { ok: false, status: 429, headers: new Headers({ 'retry-after': '120' }) };
  } });
  assert.equal((await client.get('/repos/WeOtzi/betav1/actions/workflows/verify.yml')).state, 'active');
  now++;
  assert.equal((await client.get('/repos/WeOtzi/betav1/actions/workflows/verify.yml')).state, 'active');
  await assert.rejects(client.get('/repos/WeOtzi/betav1/actions/workflows/verify.yml'), /rate limit/);
  assert.ok(cache.backoffUntil > now);
  await assert.rejects(client.get('/repos/WeOtzi/betav1/actions/workflows/verify.yml'), /backoff/);
  assert.equal(calls, 3);
});
test('poller never republishes the rolled-back SHA and makes no API requests for it', async t => {
  const root = temporary(t);
  atomicJson(path.join(root, 'targets/main.json'), { commit: OTHER, rollbackHold: { blockedCommit: SHA } });
  const results = await poll(config(root), { run: () => SHA + '\trefs/heads/main', client: { get: async () => { throw new Error('Unexpected CI call'); } }, deploy: async () => { throw new Error('Unexpected deploy'); } });
  assert.deepEqual(results, []);
});
test('poller deploys exactly a successful proven SHA and caches pending runs with backoff', async t => {
  const root = temporary(t), published = [];
  const options = {
    now: () => 100000,
    run: () => SHA + '\trefs/heads/main',
    fetchCommit: () => ({ directory: 'repository' }), trustedGates: () => ({ ok: true }), client: proofClient(),
    deploy: async (_, ref, sha) => { published.push({ ref, sha }); return { releaseId: 'release-one' }; }
  };
  assert.equal((await poll(config(root), options))[0].status, 'deployed');
  assert.deepEqual(published, [{ ref: 'main', sha: SHA }]);
  const nextRoot = temporary(t);
  const waiting = await poll(config(nextRoot), { ...options, client: proofClient({ run: { conclusion: null, status: 'in_progress' } }) });
  assert.equal(waiting[0].status, 'waiting');
  const saved = JSON.parse(fs.readFileSync(path.join(nextRoot, 'poll-cache.json')));
  assert.ok(saved.branches.main.retryAt > 100000);
  assert.equal(published.length, 1);
});
test('poller rejects altered gates even if an attacker supplies a green CI response', async t => {
  const root = temporary(t), target = targetForRef('valentina/test');
  atomicJson(path.join(root, 'targets/main.json'), { commit: SHA });
  const results = await poll(config(root), {
    run: () => `${SHA}\trefs/heads/main\n${OTHER}\trefs/heads/valentina/test`, fetchCommit: () => ({ directory: 'repository' }),
    trustedGates: () => ({ ok: false, reason: 'Altered workflow' }), client: proofClient(), deploy: async () => { throw new Error('Must not deploy'); }
  });
  assert.equal(results[0].status, 'blocked');
  assert.equal(fs.existsSync(path.join(root, 'targets', target + '.json')), false);
});
