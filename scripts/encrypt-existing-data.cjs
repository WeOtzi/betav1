#!/usr/bin/env node
'use strict';

// ===========================================================================
// Cifra los datos sensibles que ya existen en la base (ronda 3c · "cifrado").
// ---------------------------------------------------------------------------
// Idempotente. DRY-RUN por defecto: solo cuenta, no escribe ni muestra valores.
//
//   node scripts/encrypt-existing-data.cjs                 # dry-run (conteos)
//   node scripts/encrypt-existing-data.cjs --apply         # cifra + verifica fila por fila
//   node scripts/encrypt-existing-data.cjs --verify        # descifra todo y compara (sin escribir)
//   node scripts/encrypt-existing-data.cjs --restore-plaintext --apply
//                                                          # vuelve a escribir el dato en claro
//                                                          # (solo para revertir la migración)
//
// Qué cubre:
//   - artist_payout_destinations.account_identifier → account_identifier_enc
//     (+ _key_id, _last4). Filas cifradas con una clave vieja se ROTAN a la
//     primaria (DATA_ENC_KEY_ID). Nunca borra la columna en claro: eso lo hace
//     la migración separada supabase/pending/20261113104500_… tras --verify.
//   - app_settings.apify_token → sobre cifrado (lib/app-settings.js lo descifra).
//
// Requiere en el entorno (.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// DATA_ENC_KEY (y DATA_ENC_PREVIOUS_KEYS durante una rotación).
// Corre con service_role: el trigger guard_artist_payout_destination no toca
// el estado de verificación (migración 20261113104000).
// ===========================================================================

const fieldCrypto = require('../lib/field-crypto');
const { identifierContext } = require('../lib/cifrado-payouts');

const APIFY_KEY = 'apify_token';

// Nunca loguea el mensaje crudo de PostgREST: un check violation incluye la fila.
function safeError(err) {
    if (!err) return 'error';
    if (err.code && !/^\d/.test(String(err.code))) return String(err.code);
    if (err.status) return 'HTTP ' + err.status;
    return /verificación|sobre/.test(String(err.message)) ? String(err.message) : 'error';
}

function normalize(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '');
}

// Qué hay que hacer con una fila de destinos.
//   encrypt  dato en claro sin sobre
//   rotate   sobre con una clave que no es la primaria
//   last4    sobre ok pero sin últimos 4
//   ok       nada que hacer
//   orphan   sin dato en claro ni sobre (no debería existir)
function planRow(row, crypto) {
    if (row.account_identifier_enc) {
        if (crypto.needsRotation(row.account_identifier_enc)) return 'rotate';
        if (!row.account_identifier_last4) return 'last4';
        return 'ok';
    }
    if (row.account_identifier) return 'encrypt';
    return 'orphan';
}

async function processPayouts({ db, crypto, apply, log = console, pageSize = 200 }) {
    const counts = { total: 0, encrypt: 0, rotate: 0, last4: 0, ok: 0, orphan: 0, written: 0, verified: 0, failed: 0, skipped_concurrent: 0 };
    const failures = [];
    let afterId = null;
    for (;;) {
        const rows = await db.listForEncryption({ afterId, limit: pageSize });
        if (!rows || !rows.length) break;
        for (const row of rows) {
            counts.total += 1;
            const plan = planRow(row, crypto);
            counts[plan] += 1;
            if (!apply || plan === 'ok' || plan === 'orphan') continue;
            const ctx = identifierContext(row.artist_user_id);
            try {
                let plaintext;
                let patch;
                if (plan === 'encrypt') {
                    plaintext = String(row.account_identifier);
                    patch = {
                        account_identifier_enc: crypto.encrypt(plaintext, ctx),
                        account_identifier_key_id: crypto.primaryKeyId,
                        account_identifier_last4: fieldCrypto.last4(plaintext) || null
                    };
                } else {
                    plaintext = crypto.decrypt(row.account_identifier_enc, ctx);
                    if (row.account_identifier && normalize(row.account_identifier) !== normalize(plaintext)) {
                        throw new Error('el sobre no coincide con la columna en claro');
                    }
                    patch = plan === 'rotate'
                        ? { account_identifier_enc: crypto.encrypt(plaintext, ctx), account_identifier_key_id: crypto.primaryKeyId, account_identifier_last4: fieldCrypto.last4(plaintext) || null }
                        : { account_identifier_last4: fieldCrypto.last4(plaintext) || null };
                }
                const written = await db.patchById(row.id, patch, { account_identifier_enc: row.account_identifier_enc || null });
                if (!written) { counts.skipped_concurrent += 1; continue; }
                counts.written += 1;
                // Verificación: lo que quedó guardado descifra al original.
                const back = crypto.decrypt(written.account_identifier_enc, ctx);
                if (back !== plaintext) throw new Error('la verificación no devolvió el original');
                counts.verified += 1;
            } catch (err) {
                counts.failed += 1;
                failures.push({ id: row.id, plan, error: safeError(err) });
            }
        }
        afterId = rows[rows.length - 1].id;
        if (rows.length < pageSize) break;
    }
    if (failures.length) log.warn('[encrypt] fallas (sin valores):', JSON.stringify(failures.slice(0, 50)));
    return { counts, failures };
}

// Descifra cada sobre y lo compara con la columna en claro (si todavía está).
async function verifyPayouts({ db, crypto, pageSize = 200 }) {
    const out = { total: 0, encrypted: 0, matches: 0, mismatches: 0, undecryptable: 0, plaintext_only: 0, stale_key: 0, ready_for_cleanup: false, problems: [] };
    let afterId = null;
    for (;;) {
        const rows = await db.listForEncryption({ afterId, limit: pageSize });
        if (!rows || !rows.length) break;
        for (const row of rows) {
            out.total += 1;
            if (!row.account_identifier_enc) {
                if (row.account_identifier) { out.plaintext_only += 1; out.problems.push({ id: row.id, problem: 'sin cifrar' }); }
                continue;
            }
            out.encrypted += 1;
            if (crypto.needsRotation(row.account_identifier_enc)) out.stale_key += 1;
            try {
                const value = crypto.decrypt(row.account_identifier_enc, identifierContext(row.artist_user_id));
                if (row.account_identifier && normalize(row.account_identifier) !== normalize(value)) {
                    out.mismatches += 1; out.problems.push({ id: row.id, problem: 'no coincide' });
                } else if (row.account_identifier_last4 !== (fieldCrypto.last4(value) || null)) {
                    out.mismatches += 1; out.problems.push({ id: row.id, problem: 'last4 distinto' });
                } else {
                    out.matches += 1;
                }
            } catch (err) {
                out.undecryptable += 1; out.problems.push({ id: row.id, problem: err.code || 'no descifra' });
            }
        }
        afterId = rows[rows.length - 1].id;
        if (rows.length < pageSize) break;
    }
    out.ready_for_cleanup = out.plaintext_only === 0 && out.mismatches === 0 && out.undecryptable === 0;
    return out;
}

// Reversa: escribe el valor descifrado en la columna en claro.
async function restorePlaintext({ db, crypto, apply, pageSize = 200 }) {
    const out = { candidates: 0, restored: 0, failed: 0 };
    let afterId = null;
    for (;;) {
        const rows = await db.listForEncryption({ afterId, limit: pageSize });
        if (!rows || !rows.length) break;
        for (const row of rows) {
            if (!row.account_identifier_enc || row.account_identifier) continue;
            out.candidates += 1;
            if (!apply) continue;
            try {
                const value = crypto.decrypt(row.account_identifier_enc, identifierContext(row.artist_user_id));
                const written = await db.patchById(row.id, { account_identifier: value }, { account_identifier_enc: row.account_identifier_enc });
                if (written) out.restored += 1;
            } catch (_) {
                out.failed += 1;
            }
        }
        afterId = rows[rows.length - 1].id;
        if (rows.length < pageSize) break;
    }
    return out;
}

// apify_token en app_settings.
async function processAppSettings({ settings, crypto, apply, mode }) {
    const row = await settings.read(APIFY_KEY);
    const value = row && row.setting_value ? String(row.setting_value) : '';
    const result = { key: APIFY_KEY, state: !value ? 'absent' : (fieldCrypto.isEnvelope(value) ? 'encrypted' : 'plaintext'), written: false, verified: null };
    const ctx = fieldCrypto.contextFor('app_settings', 'setting_value', APIFY_KEY);
    if (result.state === 'encrypted') {
        try {
            crypto.decrypt(value, ctx);
            result.verified = true;
            if (apply && mode === 'encrypt' && crypto.needsRotation(value)) {
                const next = crypto.reencrypt(value, ctx);
                await settings.write(APIFY_KEY, next);
                result.written = true;
                result.verified = crypto.decrypt((await settings.read(APIFY_KEY)).setting_value, ctx) === crypto.decrypt(value, ctx);
            }
        } catch (_) { result.verified = false; }
        if (apply && mode === 'restore') {
            await settings.write(APIFY_KEY, crypto.decrypt(value, ctx));
            result.written = true;
        }
        return result;
    }
    if (result.state === 'plaintext' && apply && mode === 'encrypt') {
        await settings.write(APIFY_KEY, crypto.encrypt(value, ctx));
        result.written = true;
        const back = await settings.read(APIFY_KEY);
        result.verified = !!back && crypto.decrypt(back.setting_value, ctx) === value;
    }
    return result;
}

function parseArgs(argv) {
    const args = new Set(argv);
    return {
        apply: args.has('--apply'),
        verify: args.has('--verify'),
        restore: args.has('--restore-plaintext'),
        help: args.has('--help') || args.has('-h')
    };
}

async function main() {
    try { require('dotenv').config(); } catch (_) { /* opcional */ }
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('Uso: node scripts/encrypt-existing-data.cjs [--apply] [--verify] [--restore-plaintext --apply]');
        return 0;
    }
    const crypto = fieldCrypto.createFieldCrypto();
    if (!crypto.configured) {
        console.error(`[encrypt] ${fieldCrypto.NOT_CONFIGURED_MESSAGE} ${crypto.problems.join('; ')}`);
        return 2;
    }
    const { pgrest } = require('../lib/postgrest');
    const { PayoutDestinationsRepo } = require('../lib/repos/payout-destinations');
    const settings = {
        read: (key) => pgrest('app_settings').select('setting_key,setting_value').eq('setting_key', key).limit(1).single().execute(),
        write: (key, value) => pgrest('app_settings').eq('setting_key', key).patch({ setting_value: value, updated_at: new Date().toISOString() }, { returning: false })
    };
    console.log(`[encrypt] clave primaria: ${crypto.primaryKeyId} · claves conocidas: ${crypto.knownKeyIds().join(', ')}`);

    if (opts.restore) {
        const out = await restorePlaintext({ db: PayoutDestinationsRepo, crypto, apply: opts.apply });
        const apify = await processAppSettings({ settings, crypto, apply: opts.apply, mode: 'restore' });
        console.log(`[encrypt] ${opts.apply ? 'RESTAURADO' : 'DRY-RUN restaurar'}:`, JSON.stringify({ payouts: out, apify: { state: apify.state, written: apify.written } }));
        return out.failed ? 1 : 0;
    }

    if (opts.verify) {
        const out = await verifyPayouts({ db: PayoutDestinationsRepo, crypto });
        const apify = await processAppSettings({ settings, crypto, apply: false, mode: 'verify' });
        console.log('[encrypt] VERIFICACIÓN destinos:', JSON.stringify(Object.assign({}, out, { problems: out.problems.slice(0, 50) })));
        console.log('[encrypt] VERIFICACIÓN apify_token:', JSON.stringify({ state: apify.state, decrypts: apify.verified }));
        const ok = out.ready_for_cleanup && apify.state !== 'plaintext' && apify.verified !== false;
        console.log(ok ? '[encrypt] 0 discrepancias: listo para la limpieza (supabase/pending/20261113104500_…).'
            : '[encrypt] HAY discrepancias: NO aplicar la limpieza.');
        return ok ? 0 : 1;
    }

    const payouts = await processPayouts({ db: PayoutDestinationsRepo, crypto, apply: opts.apply });
    const apify = await processAppSettings({ settings, crypto, apply: opts.apply, mode: 'encrypt' });
    console.log(`[encrypt] ${opts.apply ? 'APLICADO' : 'DRY-RUN (no se escribió nada; usá --apply)'}`);
    console.log('[encrypt] artist_payout_destinations:', JSON.stringify(payouts.counts));
    console.log('[encrypt] app_settings.apify_token:', JSON.stringify(apify));
    if (opts.apply) console.log('[encrypt] Siguiente paso: node scripts/encrypt-existing-data.cjs --verify');
    return payouts.counts.failed || apify.verified === false ? 1 : 0;
}

if (require.main === module) {
    main().then((code) => { process.exitCode = code; }).catch((err) => {
        console.error('[encrypt] error:', safeError(err));
        process.exitCode = 1;
    });
}

module.exports = { safeError, planRow, processPayouts, verifyPayouts, restorePlaintext, processAppSettings, parseArgs };
