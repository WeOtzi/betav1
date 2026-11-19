#!/usr/bin/env node
'use strict';
// Arma el contexto de la imagen Docker de beta (VPS / Easypanel) con EXACTAMENTE
// los mismos archivos que publica el pipeline de Hostinger: reutiliza
// exportRuntime() y runtimePath() de deploy.cjs/runtime.cjs, así nunca entran
// .env, credenciales, uploads, logs, *.md, *.sql ni nada fuera de la lista
// permitida (server.js, package*.json, public/, lib/, services/, templates/).
//
// Uso: node scripts/release/export-image-context.cjs --sha <40 hex> --out <dir vacío> [--git-dir .git]
const fs = require('node:fs');
const path = require('node:path');
const { command, exportRuntime } = require('./deploy.cjs');

function parse(argv) {
  const options = { gitDir: '.git' };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--sha') { options.sha = value; index++; }
    else if (flag === '--out') { options.out = value; index++; }
    else if (flag === '--git-dir') { options.gitDir = value; index++; }
    else throw new Error('Opción desconocida: ' + flag);
  }
  if (!/^[a-f0-9]{40}$/.test(options.sha || '')) throw new Error('--sha necesita el SHA completo en minúsculas');
  if (!options.out) throw new Error('--out es obligatorio');
  return options;
}

function exportImageContext({ sha, out, gitDir = '.git' }, run = command) {
  const directory = path.resolve(out);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('El directorio de salida debe estar vacío');
  fs.mkdirSync(directory, { recursive: true });
  const repo = { directory: path.resolve(gitDir) };
  // El commit tiene que existir en el repo local (checkout del workflow).
  const resolved = run('git', ['--git-dir', repo.directory, 'rev-parse', '--verify', sha + '^{commit}']).trim();
  if (resolved !== sha) throw new Error('El commit pedido no coincide con el del repositorio');
  const count = exportRuntime(repo, sha, directory, false, run);
  // exportRuntime escribe con modo 0600; la imagen corre como usuario sin privilegios
  // y los archivos se copian como root, así que se dejan legibles (0644 / dirs 0755).
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { fs.chmodSync(full, 0o755); walk(full); }
      else fs.chmodSync(full, 0o644);
    }
  };
  walk(directory);
  return count;
}

function cli(argv = process.argv.slice(2)) {
  const options = parse(argv);
  const count = exportImageContext(options);
  process.stdout.write(`Contexto de imagen listo: ${count} archivos de ${options.sha.slice(0, 12)} en ${path.resolve(options.out)}\n`);
}

if (require.main === module) {
  try { cli(); } catch (error) { process.stderr.write(error.message + '\n'); process.exit(1); }
}

module.exports = { parse, exportImageContext, cli };
