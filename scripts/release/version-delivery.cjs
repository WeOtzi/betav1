'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const [version, ...description] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') || !description.length) {
  console.error('Uso: npm run version:delivery -- 2.1.1-valentina.perfil.1 "Descripción concreta del cambio y validación"');
  process.exit(1);
}
for (const name of ['package.json', 'package-lock.json']) {
  const file = path.join(root, name), json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
const file = path.join(root, 'docs/CHANGELOG.md');
let text = fs.readFileSync(file, 'utf8');
if (text.includes(`## [${version}]`)) throw new Error('La versión ya existe en el changelog; elegí una nueva entrega.');
const entry = `\n## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n- ${description.join(' ')}\n- Validación: completar con las pruebas reales antes del commit.\n- Rollback: revertir este commit; no cambiar datos reales desde una preview.\n`;
text = text.replace(/^(# [^\n]+\n)/, '$1' + entry + '\n');
fs.writeFileSync(file, text);
console.log(`Versión ${version} preparada. Completá validación y rollback, revisá el diff y hacé el commit.`);
