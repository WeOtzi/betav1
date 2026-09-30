'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
function git(...args) { return execFileSync('git', args, {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const log = fs.readFileSync(path.join(root,'docs/CHANGELOG.md'),'utf8');
const failures = [];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) failures.push('package.json debe tener versión semántica.');
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) failures.push('package-lock.json debe coincidir con la versión.');
if (!log.includes(`## [${pkg.version}]`)) failures.push('Falta entrada de esta versión en docs/CHANGELOG.md.');
const paths = git('ls-files','-z').split('\0').filter(Boolean);
for (const name of paths) {
  if (/(^|\/)(\.env(?:\..*)?|\.server-credentials)$/.test(name) && !/(^|\/)\.env\.example$/.test(name)) failures.push(`Archivo privado versionado: ${name}`);
  if (/\.(clixml|dpapi|pem|key)$/.test(name)) failures.push(`Credencial versionada: ${name}`);
  const p = path.join(root,name);
  if (!fs.existsSync(p) || fs.statSync(p).size > 5e6 || !/\.(js|cjs|mjs|json|py|ps1|md|yml|yaml|env|example|html|sh)$/.test(name)) continue;
  const text = fs.readFileSync(p,'utf8');
  if (/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text)) failures.push(`Clave privada encontrada: ${name}`);
  if (/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}\b/.test(text)) failures.push(`Token GitHub encontrado: ${name}`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role === 'service_role') failures.push(`Supabase service_role encontrado: ${name}`); } catch {}
  }
}
const base = process.env.POLICY_BASE;
if (base && !/^0+$/.test(base) && /^[a-f0-9]{40}$/.test(base)) {
  let previous;
  try { previous = JSON.parse(git('show',`${base}:package.json`)); } catch {}
  const changed = git('diff','--name-only',base,'HEAD').split('\n');
  if (changed.some(p=>/^(public\/|server\.js|lib\/|services\/|scripts\/release\/|deployments\/)/.test(p))) {
    if (previous?.version === pkg.version) failures.push('Una entrega de código necesita nueva versión.');
    if (!changed.includes('docs/CHANGELOG.md')) failures.push('Una entrega de código necesita changelog actualizado.');
  }
  const commits = git('log','--no-merges','--format=%H',`${base}..HEAD`).split('\n').filter(Boolean);
  for (const sha of commits) {
    const message = git('show','-s','--format=%B',sha);
    if (!/^(feat|fix|docs|chore|refactor|test|revert)(?:\([^\n]+\))?: .{8,}/.test(message) || !/Version: \d+\.\d+\.\d+/.test(message) || !/Validation:|Validación:/.test(message)) failures.push(`Commit sin descripción, versión o validación: ${sha.slice(0,7)}`);
  }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log(`Política de entrega aprobada: ${pkg.version}; ${paths.length} archivos revisados.`);
