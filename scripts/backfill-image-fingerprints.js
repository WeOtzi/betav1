#!/usr/bin/env node
'use strict';

// ===========================================================================
// Carga inicial de huellas de imágenes (fase 2 · plan §2.1).
// ---------------------------------------------------------------------------
// Marca como «sucios» en image_fingerprint_queue a todos los dueños con
// imágenes (artistas con gallery_feed_items, estudios con photo_feed_items y
// vendedores de la tienda). El trabajo del servidor los procesa solo, de a 20
// por minuto. Con --run, además corre los ciclos aquí mismo hasta vaciar la
// cola (necesita `sharp` instalado).
//
// Uso (desde la raíz del repo, con .env cargado; requiere la migración
// 20261118140000_image_fingerprints aplicada):
//   node scripts/backfill-image-fingerprints.js --dry-run   # solo cuenta, no escribe
//   node scripts/backfill-image-fingerprints.js             # encola a todos los dueños
//   node scripts/backfill-image-fingerprints.js --run       # encola y procesa hasta vaciar la cola
//   node scripts/backfill-image-fingerprints.js --run --max-cycles=50
//
// No imprime secretos, ids de personas ni URLs: solo conteos.
// ===========================================================================

require('dotenv').config();

const { ImageFingerprintsRepo } = require('../lib/repos/image-fingerprints');
const Decoder = require('../lib/image-decode');
const { runFingerprintCycle } = require('../lib/image-fingerprint-job');

function parseArgs(argv) {
    const args = { dryRun: false, run: false, maxCycles: 100 };
    for (const arg of argv) {
        if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--run') args.run = true;
        else if (arg.startsWith('--max-cycles=')) args.maxCycles = Math.max(1, Number.parseInt(arg.split('=')[1], 10) || 100);
        else if (arg === '--help' || arg === '-h') args.help = true;
        else throw new Error(`Opción desconocida: ${arg}`);
    }
    return args;
}

function countBy(list, key) {
    const out = {};
    for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1;
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('Uso: node scripts/backfill-image-fingerprints.js [--dry-run] [--run] [--max-cycles=N]');
        return;
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
    }

    const owners = await ImageFingerprintsRepo.listOwnersWithImages();
    console.log('[backfill] dueños con imágenes:', JSON.stringify(countBy(owners, 'source_table')));
    if (args.dryRun) {
        console.log('[backfill] --dry-run: no se escribió nada.');
        return;
    }

    const queued = await ImageFingerprintsRepo.enqueueOwners(owners);
    console.log(`[backfill] encolados: ${queued}`);
    if (!args.run) {
        console.log('[backfill] el trabajo del servidor los procesará (20 por minuto). Usa --run para procesarlos ahora.');
        return;
    }

    if (!Decoder.isAvailable()) {
        console.warn('[backfill] sharp no está instalado: no se pueden calcular huellas aquí. Quedan en la cola.');
        process.exitCode = 2;
        return;
    }
    const totals = { owners: 0, fingerprinted: 0, removed: 0, alerts: 0, failed_owners: 0 };
    for (let cycle = 1; cycle <= args.maxCycles; cycle++) {
        const result = await runFingerprintCycle();
        for (const k of Object.keys(totals)) totals[k] += Number(result[k]) || 0;
        console.log(`[backfill] ciclo ${cycle}: dueños ${result.owners}, huellas ${result.fingerprinted}, alertas ${result.alerts}`);
        if (!result.owners) break;
    }
    const left = await ImageFingerprintsRepo.countQueue();
    // Los dueños con descargas fallidas o errores quedan en la cola con espera
    // creciente (2–30 min, hasta 5 intentos): el trabajo del servidor los retoma.
    console.log('[backfill] total:', JSON.stringify(totals), `· en cola (incluye reintentos con espera): ${left}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[backfill] error:', String((err && err.message) || err).slice(0, 300));
        process.exitCode = 1;
    });
}

module.exports = { parseArgs };
