#!/usr/bin/env node
'use strict';
// Cron invokes this trusted controller. Public Git/GitHub reads require no token or SSH secret.
const fs = require('node:fs');
const path = require('node:path');
const { command, validateConfig, acquireLock, fetchCommit, deploy } = require('./deploy.cjs');
const { targetForRef, safeChild, atomicJson } = require('./runtime.cjs');

function readJson(filename, fallback = {}) { return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : fallback; }
function repositoryId(url) {
  const match = String(url).match(/(?:github\.com[:/])([A-Za-z0-9_.-]+\/[^/]+)\.git$/);
  if (!match) throw new Error('GitHub repository is required');
  return match[1];
}
function parseHeads(output) {
  const heads = {};
  for (const line of String(output).trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{40})\s+refs\/heads\/(.+)$/);
    if (match && (match[2] === 'main' || /^valentina\/[A-Za-z0-9][A-Za-z0-9_./-]{0,150}$/.test(match[2]))) {
      targetForRef(match[2]);
      heads[match[2]] = match[1];
    }
  }
  return heads;
}
function sameTrustedGates(repo, sha, mainSha, run = command) {
  for (const filename of ['.github/workflows/verify.yml', 'scripts/release/check-policy.cjs']) {
    const mainBlob = run('git', ['--git-dir', repo.directory, 'rev-parse', mainSha + ':' + filename]).trim();
    const branchBlob = run('git', ['--git-dir', repo.directory, 'rev-parse', sha + ':' + filename]).trim();
    if (mainBlob !== branchBlob) return { ok: false, reason: 'Branch modifies trusted verification gates: ' + filename };
  }
  const mainPackage = JSON.parse(run('git', ['--git-dir', repo.directory, 'show', mainSha + ':package.json']));
  const branchPackage = JSON.parse(run('git', ['--git-dir', repo.directory, 'show', sha + ':package.json']));
  if (!mainPackage.scripts?.test || mainPackage.scripts.test !== branchPackage.scripts?.test) return { ok: false, reason: 'Branch modifies the trusted npm test command' };
  return { ok: true };
}

class PublicGithub {
  constructor(cache, options = {}) {
    this.cache = cache;
    this.fetch = options.fetch || fetch;
    this.now = options.now || Date.now;
  }
  async get(apiPath, ttl = 0) {
    if (!apiPath.startsWith('/repos/') || apiPath.includes('://')) throw new Error('Only repository GitHub API paths are supported');
    const now = this.now();
    if ((this.cache.backoffUntil || 0) > now) {
      const error = new Error('GitHub public API backoff is active'); error.retryAt = this.cache.backoffUntil; throw error;
    }
    this.cache.http ||= {};
    const existing = this.cache.http[apiPath];
    if (existing && now - existing.at < ttl) return existing.data;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'WeOtzi-verified-release-poller', 'X-GitHub-Api-Version': '2022-11-28' };
    if (existing?.etag) headers['If-None-Match'] = existing.etag;
    const response = await this.fetch('https://api.github.com' + apiPath, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (response.status === 304 && existing) { existing.at = now; return existing.data; }
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      const until = Math.max(now + 60000, Number.isFinite(reset) && reset > now ? reset : now + (retryAfter || 15 * 60000));
      this.cache.backoffUntil = until;
      const error = new Error('GitHub public API rate limit; no release was approved'); error.retryAt = until; throw error;
    }
    if (!response.ok) throw new Error('GitHub public API returned ' + response.status);
    const data = await response.json();
    this.cache.http[apiPath] = { at: now, etag: response.headers.get('etag'), data };
    const entries = Object.entries(this.cache.http).sort((a, b) => b[1].at - a[1].at);
    this.cache.http = Object.fromEntries(entries.slice(0, 35));
    return data;
  }
}

async function verifiedRun(client, repoId, ref, sha) {
  const workflow = await client.get('/repos/' + repoId + '/actions/workflows/verify.yml', 60 * 60000);
  if (workflow.path !== '.github/workflows/verify.yml' || workflow.name !== 'Verify delivery' || !workflow.id || workflow.state !== 'active') return { ok: false, reason: 'Expected Verify delivery workflow is missing or inactive' };
  const runs = await client.get('/repos/' + repoId + '/actions/workflows/' + workflow.id + '/runs?head_sha=' + sha + '&event=push&per_page=20');
  const exactRuns = (runs.workflow_runs || []).filter(run => run.workflow_id === workflow.id && run.head_sha === sha && run.head_branch === ref && run.event === 'push' && String(run.path || '').split('@')[0] === workflow.path);
  exactRuns.sort((a, b) => b.id - a.id || (b.run_attempt || 1) - (a.run_attempt || 1));
  const run = exactRuns[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') return { ok: false, reason: run ? 'Exact CI run is ' + run.status + '/' + run.conclusion : 'No exact SHA push CI run exists' };
  const jobs = await client.get('/repos/' + repoId + '/actions/runs/' + run.id + '/attempts/' + (run.run_attempt || 1) + '/jobs?per_page=30');
  if (!(jobs.jobs || []).some(job => job.name === 'Tests and release policy' && job.status === 'completed' && job.conclusion === 'success' && job.head_sha === sha)) return { ok: false, reason: 'Expected Tests and release policy job did not prove success for this SHA' };
  return { ok: true, runId: run.id, workflowId: workflow.id, url: run.html_url };
}

function log(config, message, now = Date.now()) {
  const filename = safeChild(config.stateRoot, 'logs', 'poll.log');
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  if (fs.existsSync(filename) && fs.statSync(filename).size > 128 * 1024) fs.renameSync(filename, filename + '.previous');
  fs.appendFileSync(filename, new Date(now).toISOString() + ' ' + message.replace(/[\r\n]/g, ' ').slice(0, 500) + '\n', { mode: 0o600 });
}

async function poll(config, options = {}) {
  const run = options.run || command, now = options.now || Date.now;
  const cacheFile = safeChild(config.stateRoot, 'poll-cache.json');
  const cache = options.cache || readJson(cacheFile);
  cache.branches ||= {};
  const client = options.client || new PublicGithub(cache, { now, fetch: options.fetch });
  const heads = parseHeads(run('git', ['ls-remote', '--heads', config.repository], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }));
  if (!heads.main) throw new Error('Repository does not advertise main');
  const repoId = repositoryId(config.repository);
  const results = [];
  let mainRepo;
  try {
    for (const [ref, sha] of Object.entries(heads).sort(([a], [b]) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b))) {
      const target = targetForRef(ref);
      const current = readJson(safeChild(config.stateRoot, 'targets', target + '.json'));
      if (current.commit === sha || current.rollbackHold?.blockedCommit === sha) continue;
      const prior = cache.branches[ref];
      if (prior?.sha === sha && prior.mainSha === heads.main && prior.retryAt > now()) continue;
      try {
        mainRepo ||= (options.fetchCommit || fetchCommit)(config, 'main', heads.main, run);
        const repo = ref === 'main' ? mainRepo : (options.fetchCommit || fetchCommit)(config, ref, sha, run);
        const gates = (options.trustedGates || sameTrustedGates)(repo, sha, heads.main, run);
        if (!gates.ok) {
          cache.branches[ref] = { sha, mainSha: heads.main, retryAt: now() + 24 * 60 * 60000, reason: gates.reason };
          log(config, ref + ': blocked — ' + gates.reason, now());
          results.push({ ref, sha, status: 'blocked', reason: gates.reason });
          continue;
        }
        const proof = await verifiedRun(client, repoId, ref, sha);
        if (!proof.ok) {
          const failures = prior?.sha === sha ? (prior.failures || 0) + 1 : 1;
          cache.branches[ref] = { sha, mainSha: heads.main, failures, retryAt: now() + Math.min(15 * 60000, 60000 * 2 ** Math.min(failures, 4)), reason: proof.reason };
          if (!prior || prior.reason !== proof.reason) log(config, ref + ': waiting — ' + proof.reason, now());
          results.push({ ref, sha, status: 'waiting', reason: proof.reason });
          continue;
        }
        const state = await (options.deploy || deploy)(config, ref, sha, { run });
        cache.branches[ref] = { sha, mainSha: heads.main, verifiedAt: now(), ciRunId: proof.runId, ciUrl: proof.url };
        log(config, ref + ': deployed ' + sha.slice(0, 12) + ' · ' + state.releaseId + ' · CI ' + proof.runId, now());
        results.push({ ref, sha, status: 'deployed', releaseId: state.releaseId, ciUrl: proof.url });
      } catch (error) {
        cache.branches[ref] = { sha, mainSha: heads.main, retryAt: error.retryAt || now() + 5 * 60000, reason: error.message };
        log(config, ref + ': error — ' + error.message, now());
        results.push({ ref, sha, status: 'error', reason: error.message });
        if (error.retryAt) break;
      }
    }
    return results;
  } finally { atomicJson(cacheFile, cache); }
}

async function cli(argv = process.argv.slice(2)) {
  const configPath = argv[0] === '--config' && argv[1] ? argv[1] : path.join(__dirname, 'deploy-config.json');
  const config = validateConfig(readJson(configPath));
  fs.mkdirSync(config.stateRoot, { recursive: true, mode: 0o700 });
  // One lock spans Git reads and deploy(), which does not acquire another lock itself.
  const unlock = acquireLock(config.stateRoot);
  try {
    const result = await poll(config);
    if (result.length) console.log(JSON.stringify(result));
    return result;
  } finally { unlock(); }
}
if (require.main === module) cli().catch(error => { console.error('[Poll] ' + error.message); process.exitCode = 1; });
module.exports = { repositoryId, parseHeads, sameTrustedGates, PublicGithub, verifiedRun, poll, cli };
