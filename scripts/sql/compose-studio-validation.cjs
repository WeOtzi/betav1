#!/usr/bin/env node
// Arma un único script SQL para validar las migraciones de la plataforma de
// Estudios (+ Store) contra una base real SIN persistir nada: abre una
// transacción, aplica la cadena de migraciones, corre los tests SQL (cada uno
// entre SAVEPOINT y ROLLBACK TO) y termina con ROLLBACK.
//
// Uso:
//   node scripts/sql/compose-studio-validation.cjs > validation.sql
//   (pegar validation.sql en el SQL Editor de Supabase y ejecutar)
//
// Opciones:
//   --rollbacks   después de los tests aplica los rollbacks en orden inverso
//                 (sigue todo dentro de la misma transacción que se revierte).
//   --no-store    omite store_core y M6 (studio_store).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const args = new Set(process.argv.slice(2));
const withStore = !args.has('--no-store');

const MIGRATIONS = [
    ...(withStore ? ['supabase/migrations/20261030150000_store_core.sql'] : []),
    'supabase/migrations/20261030200000_studio_affiliations.sql',
    'supabase/migrations/20261030201000_studio_contracts.sql',
    'supabase/migrations/20261030202000_studio_agenda_inventory.sql',
    'supabase/migrations/20261030203000_studio_finance.sql',
    'supabase/migrations/20261030204000_supplies_marketplace.sql',
    ...(withStore ? ['supabase/migrations/20261030205000_studio_store.sql'] : []),
];
const TESTS = [
    'supabase/tests/studio_affiliations_contracts.sql',
    'supabase/tests/studio_agenda_inventory_finance.sql',
    'supabase/tests/supplies_marketplace.sql',
    'supabase/tests/studio_operations_workflows.sql',
    'scripts/test-studio-identity-transactions.sql',
];

// Quita las líneas de control de transacción propias de cada archivo para
// encadenarlos en una sola transacción.
function body(file) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    return text.split('\n')
        .filter((line) => !/^\s*(begin|commit|rollback|start transaction)\s*;\s*$/i.test(line))
        .join('\n');
}

const out = [
    '-- Generado por scripts/sql/compose-studio-validation.cjs. NO persiste: termina en ROLLBACK.',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '300s';",
];
for (const file of MIGRATIONS) out.push(`\n-- ===== ${file} =====`, body(file));
TESTS.forEach((file, i) => {
    out.push(`\n-- ===== ${file} =====`, `savepoint t${i};`, body(file), 'reset role;', `rollback to savepoint t${i};`);
});
if (args.has('--rollbacks')) {
    for (const file of MIGRATIONS.slice().reverse()) {
        const down = file.replace('supabase/migrations/', 'supabase/rollbacks/').replace(/\.sql$/, '.down.sql');
        if (fs.existsSync(path.join(root, down))) out.push(`\n-- ===== ${down} =====`, body(down));
    }
}
out.push("\nselect 'VALIDACION ESTUDIOS: OK (todo se revierte)' as resultado;", 'rollback;', '');
process.stdout.write(out.join('\n'));
