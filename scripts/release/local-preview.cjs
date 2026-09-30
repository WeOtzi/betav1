#!/usr/bin/env node
'use strict';
// Local frontend development with a trusted fixture adapter. Does not load .env or start server.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gateway } = require('./preview-server.cjs');
const { atomicJson } = require('./runtime.cjs');

function startLocalPreview(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '../..'));
  if (!fs.existsSync(path.join(workspaceRoot, 'public/inicio/index.html'))) throw new Error('Invalid We Ötzi workspace');
  const bootstrap = options.bootstrap || path.join(__dirname, 'preview-bootstrap.js');
  if (!fs.existsSync(bootstrap)) throw new Error('The trusted preview fixture adapter is missing');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weotzi-local-preview-'));
  const target = 'preview-local-safe';
  const version = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')).version;
  fs.mkdirSync(path.join(stateRoot, 'control'), { mode: 0o700 });
  fs.copyFileSync(bootstrap, path.join(stateRoot, 'control/preview-bootstrap.js'));
  atomicJson(path.join(stateRoot, 'preview-map.json'), { [target]: { directory: workspaceRoot, target, ref: 'local', commit: 'local-safe', version, environment: 'preview', dataMode: 'browser-demo' } });
  const server = gateway({ stateRoot, workspaceRoot });
  const close = () => new Promise(resolve => server.close(() => {
    // mkdtemp produced this exact task-owned path; no paths from user input are removed.
    if (path.dirname(stateRoot) === path.resolve(os.tmpdir()) && path.basename(stateRoot).startsWith('weotzi-local-preview-')) fs.rmSync(stateRoot, { recursive: true, force: true });
    resolve();
  }));
  server.listen(options.port ?? 4647, '127.0.0.1', () => {
    if (!options.quiet) {
      console.log('We Ötzi · desarrollo seguro con datos ficticios');
      console.log(`http://localhost:${server.address().port}/preview/${target}/inicio/`);
      console.log('Editá public/ y refrescá el navegador. Emails y servicios reales permanecen desactivados.');
    }
  });
  return { server, stateRoot, target, close };
}
if (require.main === module) {
  const preview = startLocalPreview();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => preview.close().then(() => process.exit(0)));
}
module.exports = { startLocalPreview };
