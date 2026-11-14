'use strict';

// Ronda 3c · grupo "cifrado": cifrado de datos sensibles en el servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const FC = require('../lib/field-crypto');
const Payouts = require('../lib/cifrado-payouts');
const Script = require('../scripts/encrypt-existing-data.cjs');
const AppSettings = require('../lib/app-settings');
const W = require('../public/shared/js/wallet-model.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const key = () => nodeCrypto.randomBytes(32).toString('base64');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CTX = FC.contextFor('artist_payout_destinations', 'account_identifier', OWNER);

function cryptoWith(env) { return FC.createFieldCrypto({ env }); }

// ---------------------------------------------------------------- field-crypto

test('roundtrip: AES-256-GCM con sobre wo1 e IV distinto en cada cifrado', () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    assert.equal(c.configured, true);
    assert.equal(c.primaryKeyId, 'k1');
    const a = c.encrypt('ES91 0049 0001 5123 4567 7734', CTX);
    const b = c.encrypt('ES91 0049 0001 5123 4567 7734', CTX);
    assert.match(a, /^wo1:k1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.notEqual(a, b, 'IV aleatorio');
    assert.ok(!a.includes('7734') && !a.includes('ES91'), 'el sobre no deja ver el dato');
    assert.equal(c.decrypt(a, CTX), 'ES91 0049 0001 5123 4567 7734');
    assert.equal(c.decrypt(c.encrypt('ñandú·alias', CTX), CTX), 'ñandú·alias');
    assert.equal(FC.isEnvelope(a), true);
    assert.equal(FC.isEnvelope('ES9100490001'), false);
});

test('clave errónea, contexto ajeno o dato alterado: DECRYPT_FAILED sin detalles', () => {
    const k = key();
    const c = cryptoWith({ DATA_ENC_KEY: k });
    const env = c.encrypt('0000003100010000000001', CTX);
    const wrong = cryptoWith({ DATA_ENC_KEY: key() });
    assert.throws(() => wrong.decrypt(env, CTX), (e) => e.code === 'DECRYPT_FAILED' && !/0000003100/.test(e.message));
    assert.throws(() => c.decrypt(env, FC.contextFor('artist_payout_destinations', 'account_identifier', OTHER)), { code: 'DECRYPT_FAILED' });
    const parts = env.split(':');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    assert.throws(() => c.decrypt(parts.join(':'), CTX), { code: 'DECRYPT_FAILED' });
    assert.throws(() => c.decrypt('wo1:k1:no-es-valido', CTX), { code: 'BAD_ENVELOPE' });
    assert.throws(() => c.encrypt('x', ''), { code: 'CONTEXT_REQUIRED' });
});

test('sin clave (o con una inválida) no está configurado y responde 503', () => {
    for (const env of [{}, { DATA_ENC_KEY: 'corta' }, { DATA_ENC_KEY: nodeCrypto.randomBytes(16).toString('base64') }, { DATA_ENC_KEY: key(), DATA_ENC_KEY_ID: 'id con espacios' }]) {
        const c = cryptoWith(env);
        assert.equal(c.configured, false);
        assert.throws(() => c.encrypt('1234', CTX), (e) => e.code === 'NOT_CONFIGURED' && e.status === 503);
    }
    assert.deepEqual(FC.fieldCryptoConfig({}).missing, ['DATA_ENC_KEY']);
    const cfg = FC.fieldCryptoConfig({ DATA_ENC_KEY: key(), DATA_ENC_PREVIOUS_KEYS: 'k0=basura' });
    assert.equal(cfg.configured, true, 'una clave vieja inválida no apaga el cifrado');
    assert.ok(cfg.problems.some((p) => /PREVIOUS/.test(p)));
});

test('rotación: la clave vieja descifra, needsRotation y reencrypt pasan a la primaria', () => {
    const k1 = key();
    const k2 = key();
    const before = cryptoWith({ DATA_ENC_KEY: k1, DATA_ENC_KEY_ID: 'k1' });
    const old = before.encrypt('lemon.ana.4821', CTX);
    const rotated = cryptoWith({ DATA_ENC_KEY: k2, DATA_ENC_KEY_ID: 'k2', DATA_ENC_PREVIOUS_KEYS: `k1=${k1}` });
    assert.deepEqual(rotated.knownKeyIds().sort(), ['k1', 'k2']);
    assert.equal(rotated.needsRotation(old), true);
    assert.equal(rotated.decrypt(old, CTX), 'lemon.ana.4821');
    const fresh = rotated.reencrypt(old, CTX);
    assert.equal(rotated.keyIdOf(fresh), 'k2');
    assert.equal(rotated.needsRotation(fresh), false);
    assert.equal(rotated.decrypt(fresh, CTX), 'lemon.ana.4821');
    const withoutOld = cryptoWith({ DATA_ENC_KEY: k2, DATA_ENC_KEY_ID: 'k2' });
    assert.throws(() => withoutOld.decrypt(old, CTX), { code: 'KEY_NOT_FOUND' });
    assert.equal(cryptoWith({ DATA_ENC_KEY: k2, DATA_ENC_KEY_ID: 'k2', DATA_ENC_PREVIOUS_KEYS: `k2=${k1}` }).configured, false, 'id repetido');
});

test('máscara: últimos 4 alfanuméricos, en servidor y navegador', () => {
    assert.equal(FC.last4('ES91 0049 0001 5123 4567 7734'), '7734');
    assert.equal(FC.last4('lemon.demo.4821'), '4821');
    assert.equal(FC.last4('ab'), 'ab');
    assert.equal(FC.maskIdentifier('0000003100010000000001'), '···· 0001');
    assert.equal(FC.maskTail(''), '');
    assert.equal(W.maskDestination({ account_identifier_last4: '7734' }), '···· 7734');
    assert.equal(W.maskDestination({ account_identifier: 'ES91 0049 7734' }), '···· 7734', 'compatibilidad con filas viejas');
    assert.equal(W.destinationLast4(null), '');
    assert.equal(W.validateDestination({ method: 'lemon', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: '' }, { keepIdentifier: true }).ok, true);
    assert.equal(W.validateDestination({ method: 'lemon', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: '' }).ok, false);
});

// ---------------------------------------------------------------- servicio de destinos

function fakeDb(rows = []) {
    const audit = [];
    return {
        rows,
        audit,
        isMissingColumnError: () => false,
        async listByOwner(userId) { return rows.filter((r) => r.artist_user_id === userId && r.active).map((r) => Object.assign({}, r)); },
        async getSensitive(id) { const r = rows.find((x) => x.id === id); return r ? Object.assign({}, r) : null; },
        async insert(row) { rows.push(Object.assign({}, row)); return Object.assign({}, row); },
        async update(id, ownerId, patch) {
            const r = rows.find((x) => x.id === id && x.artist_user_id === ownerId);
            if (!r) return null;
            Object.assign(r, patch);
            return Object.assign({}, r);
        },
        async logAccess(entry) { audit.push(entry); return true; }
    };
}

const quiet = { warn() {}, error() {} };

test('alta: guarda solo el sobre + últimos 4, pending, y el navegador no recibe el dato', async () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    const db = fakeDb();
    const svc = Payouts.createPayoutDestinationService({ crypto: c, db, log: quiet });
    const out = await svc.create(OWNER, { method: 'bank_international', holderName: 'Ana Pérez', currency: 'EUR', accountIdentifier: 'ES91 0049 0001 5123 4567 7734', label: 'Santander' });
    const stored = db.rows[0];
    assert.equal(stored.account_identifier, null);
    assert.match(stored.account_identifier_enc, /^wo1:k1:/);
    assert.equal(stored.account_identifier_key_id, 'k1');
    assert.equal(stored.account_identifier_last4, '7734');
    assert.equal(stored.verification_status, 'pending');
    assert.equal(stored.is_default, true, 'primer destino = predeterminado');
    assert.equal(c.decrypt(stored.account_identifier_enc, CTX), 'ES91 0049 0001 5123 4567 7734');
    for (const k of ['account_identifier', 'account_identifier_enc', 'account_identifier_key_id']) assert.equal(k in out, false, k);
    assert.equal(out.account_identifier_mask, '···· 7734');
    const listed = await svc.list(OWNER);
    assert.equal(JSON.stringify(listed).includes('ES91'), false);
    assert.equal(JSON.stringify(listed).includes('wo1:'), false);
});

test('alta: valida como el navegador (tarjeta, método, identificador) y sin clave da 503', async () => {
    const svc = Payouts.createPayoutDestinationService({ crypto: cryptoWith({ DATA_ENC_KEY: key() }), db: fakeDb(), log: quiet });
    await assert.rejects(svc.create(OWNER, { method: 'lemon', holderName: 'Ana', currency: 'USD', accountIdentifier: '4111 1111 1111 1111' }), /tarjeta/);
    await assert.rejects(svc.create(OWNER, { method: 'paypal', holderName: 'Ana', currency: 'USD', accountIdentifier: 'ana@x.com' }), /método/);
    await assert.rejects(svc.create(OWNER, { method: 'lemon', holderName: 'Ana', currency: 'USD', accountIdentifier: '12' }), (e) => e.status === 400);
    await assert.rejects(svc.create(OWNER, { method: 'lemon', holderName: 'Ana', currency: 'USD', accountIdentifier: 'lemon.ana', metadata: { card: { CVV: '1' } } }), /tarjeta/);
    const off = Payouts.createPayoutDestinationService({ crypto: cryptoWith({}), db: fakeDb(), log: quiet });
    await assert.rejects(off.create(OWNER, { method: 'lemon', holderName: 'Ana', currency: 'USD', accountIdentifier: 'lemon.ana' }), (e) => e.status === 503);
    const r = Payouts.errorResponse(new FC.FieldCryptoError('NOT_CONFIGURED', FC.NOT_CONFIGURED_MESSAGE, 503), 'x');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /DATA_ENC_KEY/);
    assert.deepEqual(await off.list(OWNER), [], 'el listado (solo máscaras) funciona sin clave');
});

test('edición: vacío conserva la cuenta; cambiarla re-cifra y vuelve a pending; fila legada se cifra', async () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    const id = nodeCrypto.randomUUID();
    const legacyId = nodeCrypto.randomUUID();
    const db = fakeDb([
        { id, artist_user_id: OWNER, method: 'lemon', currency: 'USD', active: true, is_default: true, verification_status: 'verified', verified_at: 'x', account_identifier: null, account_identifier_enc: c.encrypt('lemon.ana.4821', CTX), account_identifier_key_id: 'k1', account_identifier_last4: '4821' },
        { id: legacyId, artist_user_id: OWNER, method: 'bank_usd', currency: 'USD', active: true, is_default: false, verification_status: 'verified', verified_at: 'y', account_identifier: '000123451190', account_identifier_enc: null, account_identifier_key_id: null, account_identifier_last4: null }
    ]);
    const svc = Payouts.createPayoutDestinationService({ crypto: c, db, log: quiet });
    await svc.update(OWNER, id, { method: 'lemon', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: '', label: 'Lemon' });
    assert.equal(db.rows[0].verification_status, 'verified', 'cambiar el titular no resetea');
    assert.equal(c.decrypt(db.rows[0].account_identifier_enc, CTX), 'lemon.ana.4821');
    await svc.update(OWNER, id, { method: 'lemon', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: 'lemon.ana.4821' });
    assert.equal(db.rows[0].verification_status, 'verified', 'mismo número: no resetea');
    await svc.update(OWNER, id, { method: 'lemon', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: 'lemon.ana.9999' });
    assert.equal(db.rows[0].verification_status, 'pending');
    assert.equal(db.rows[0].account_identifier_last4, '9999');
    await svc.update(OWNER, legacyId, { method: 'bank_usd', holderName: 'Ana Pérez', currency: 'USD', accountIdentifier: '' });
    assert.equal(db.rows[1].account_identifier, null, 'la edición limpia el dato en claro legado');
    assert.equal(c.decrypt(db.rows[1].account_identifier_enc, CTX), '000123451190');
    assert.equal(db.rows[1].verification_status, 'verified');
    await assert.rejects(svc.update(OTHER, id, { method: 'lemon', holderName: 'Otro', currency: 'USD', accountIdentifier: '' }), (e) => e.status === 404);
});

test('ver completo: solo el dueño o soporte con motivo, y queda auditado', async () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    const id = nodeCrypto.randomUUID();
    const db = fakeDb([{ id, artist_user_id: OWNER, method: 'lemon', currency: 'USD', active: true, account_identifier: null, account_identifier_enc: c.encrypt('lemon.ana.4821', CTX), account_identifier_key_id: 'k1', account_identifier_last4: '4821' }]);
    const svc = Payouts.createPayoutDestinationService({ crypto: c, db, log: quiet });
    assert.deepEqual(await svc.revealForOwner(OWNER, id), { id, account_identifier: 'lemon.ana.4821' });
    await assert.rejects(svc.revealForOwner(OTHER, id), (e) => e.status === 404);
    await assert.rejects(svc.revealForSupport(OTHER, id, {}), /para qué/);
    assert.equal((await svc.revealForSupport(OTHER, id, { purpose: 'withdrawal_settlement' })).account_identifier, 'lemon.ana.4821');
    assert.deepEqual(db.audit.map((a) => [a.accessor_role, a.purpose, a.owner_user_id]), [['owner', 'owner_view', OWNER], ['support', 'withdrawal_settlement', OWNER]]);
    assert.equal(JSON.stringify(db.audit).includes('lemon.ana'), false, 'la auditoría no guarda el dato');
    await assert.rejects(svc.revealForOwner(OWNER, 'no-uuid'), (e) => e.status === 400);
    const limiter = Payouts.createRevealLimiter({ max: 2, windowMs: 1000, now: () => 0 });
    assert.deepEqual([limiter('a'), limiter('a'), limiter('a'), limiter('b')], [true, true, false, true]);
});

// ---------------------------------------------------------------- script de datos existentes

function scriptDb(rows) {
    const writes = [];
    return {
        rows,
        writes,
        async listForEncryption({ afterId, limit }) {
            return rows.slice().sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !afterId || r.id > afterId).slice(0, limit).map((r) => Object.assign({}, r));
        },
        async patchById(id, patch, expected) {
            const r = rows.find((x) => x.id === id);
            if (!r || (expected && 'account_identifier_enc' in expected && (r.account_identifier_enc || null) !== (expected.account_identifier_enc || null))) return null;
            writes.push(id);
            Object.assign(r, patch);
            return Object.assign({}, r);
        }
    };
}

test('script: dry-run no escribe; --apply cifra, verifica y es idempotente; --verify habilita la limpieza', async () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    const ids = ['a', 'b', 'c'].map((p) => p + nodeCrypto.randomUUID().slice(1));
    const db = scriptDb([
        { id: ids[0], artist_user_id: OWNER, account_identifier: 'ES91 0049 0001 5123 4567 7734', account_identifier_enc: null, account_identifier_key_id: null, account_identifier_last4: null },
        { id: ids[1], artist_user_id: OTHER, account_identifier: 'lemon.otro.1234', account_identifier_enc: null, account_identifier_key_id: null, account_identifier_last4: null },
        { id: ids[2], artist_user_id: OWNER, account_identifier: null, account_identifier_enc: c.encrypt('ya.cifrado.5555', CTX), account_identifier_key_id: 'k1', account_identifier_last4: '5555' }
    ]);
    const log = { warn() {} };
    const dry = await Script.processPayouts({ db, crypto: c, apply: false, log, pageSize: 2 });
    assert.deepEqual([dry.counts.total, dry.counts.encrypt, dry.counts.ok, dry.counts.written], [3, 2, 1, 0]);
    assert.equal(db.writes.length, 0);
    const before = await Script.verifyPayouts({ db, crypto: c });
    assert.equal(before.ready_for_cleanup, false);
    assert.equal(before.plaintext_only, 2);

    const run = await Script.processPayouts({ db, crypto: c, apply: true, log, pageSize: 2 });
    assert.deepEqual([run.counts.written, run.counts.verified, run.counts.failed], [2, 2, 0]);
    assert.equal(db.rows[0].account_identifier, 'ES91 0049 0001 5123 4567 7734', 'el script nunca borra el dato en claro');
    assert.equal(db.rows[0].account_identifier_last4, '7734');
    assert.equal(c.decrypt(db.rows[1].account_identifier_enc, FC.contextFor('artist_payout_destinations', 'account_identifier', OTHER)), 'lemon.otro.1234');

    const again = await Script.processPayouts({ db, crypto: c, apply: true, log });
    assert.deepEqual([again.counts.ok, again.counts.written], [3, 0], 'idempotente');
    const after = await Script.verifyPayouts({ db, crypto: c });
    assert.deepEqual([after.encrypted, after.matches, after.mismatches, after.undecryptable, after.ready_for_cleanup], [3, 3, 0, 0, true]);

    db.rows[1].account_identifier = 'lemon.otro.0000'; // alguien cambió el dato en claro
    const bad = await Script.verifyPayouts({ db, crypto: c });
    assert.equal(bad.ready_for_cleanup, false);
    assert.deepEqual(bad.problems.map((p) => p.problem), ['no coincide']);
    assert.equal(JSON.stringify(bad).includes('lemon.otro'), false, 'el reporte no muestra valores');
});

test('script: rota a la clave nueva y restaura el dato en claro para revertir', async () => {
    const k1 = key();
    const old = cryptoWith({ DATA_ENC_KEY: k1 });
    const id = nodeCrypto.randomUUID();
    const db = scriptDb([{ id, artist_user_id: OWNER, account_identifier: null, account_identifier_enc: old.encrypt('lemon.ana.4821', CTX), account_identifier_key_id: 'k1', account_identifier_last4: '4821' }]);
    const next = cryptoWith({ DATA_ENC_KEY: key(), DATA_ENC_KEY_ID: 'k2', DATA_ENC_PREVIOUS_KEYS: `k1=${k1}` });
    const run = await Script.processPayouts({ db, crypto: next, apply: true, log: { warn() {} } });
    assert.deepEqual([run.counts.rotate, run.counts.verified], [1, 1]);
    assert.equal(next.keyIdOf(db.rows[0].account_identifier_enc), 'k2');
    assert.equal(db.rows[0].account_identifier_key_id, 'k2');
    const dry = await Script.restorePlaintext({ db, crypto: next, apply: false });
    assert.deepEqual([dry.candidates, dry.restored], [1, 0]);
    const restored = await Script.restorePlaintext({ db, crypto: next, apply: true });
    assert.equal(restored.restored, 1);
    assert.equal(db.rows[0].account_identifier, 'lemon.ana.4821');
    assert.equal(Script.safeError({ message: 'PostgREST PATCH failed (400): Failing row contains (lemon.ana.4821)', status: 400 }), 'HTTP 400');
    assert.deepEqual(Script.parseArgs(['--apply']), { apply: true, verify: false, restore: false, help: false });
});

test('apify_token: se cifra en app_settings, se verifica y se descifra al leer', async () => {
    const c = cryptoWith({ DATA_ENC_KEY: key() });
    const store = { apify_token: { setting_key: 'apify_token', setting_value: 'apify_api_SECRETO123' } };
    const settings = { read: async (k) => store[k] || null, write: async (k, v) => { store[k].setting_value = v; } };
    const dry = await Script.processAppSettings({ settings, crypto: c, apply: false, mode: 'encrypt' });
    assert.deepEqual([dry.state, dry.written], ['plaintext', false]);
    const run = await Script.processAppSettings({ settings, crypto: c, apply: true, mode: 'encrypt' });
    assert.deepEqual([run.written, run.verified], [true, true]);
    assert.ok(FC.isEnvelope(store.apify_token.setting_value));
    assert.equal(AppSettings.decodeSettingValue('apify_token', store.apify_token.setting_value, c), 'apify_api_SECRETO123');
    assert.equal(AppSettings.decodeSettingValue('apify_token', store.apify_token.setting_value, cryptoWith({ DATA_ENC_KEY: key() })), null, 'otra clave → null');
    assert.equal(AppSettings.encodeSettingValue('website_url', 'https://weotzi.com', c), 'https://weotzi.com');
    assert.ok(FC.isEnvelope(AppSettings.encodeSettingValue('apify_token', 'apify_api_x', c)));
    assert.equal(AppSettings.encodeSettingValue('apify_token', 'apify_api_x', cryptoWith({})), 'apify_api_x', 'sin clave se guarda como antes');
    assert.equal(AppSettings.isSecretSettingKey('billionmail_api_key'), true);
    assert.equal(AppSettings.isSecretSettingKey('email_routing'), true);
    assert.equal(AppSettings.isSecretSettingKey('store_platform_fee_pct'), false);
});

// ---------------------------------------------------------------- migración y navegador

test('migración 20261113104000: aditiva, columnas cifradas, privilegios por columna, secretos de app_settings y reversa', () => {
    const sql = read('supabase/migrations/20261113104000_field_encryption.sql');
    const down = read('supabase/rollbacks/20261113104000_field_encryption.down.sql');
    for (const col of ['account_identifier_enc', 'account_identifier_key_id', 'account_identifier_last4']) {
        assert.match(sql, new RegExp(`add column if not exists ${col} text`));
        assert.match(down, new RegExp(`drop column if exists ${col}`));
    }
    assert.match(sql, /alter column account_identifier drop not null/);
    assert.match(sql, /revoke select, insert, update on table public\.artist_payout_destinations from authenticated/);
    const grant = sql.match(/grant select \(([^)]+)\)\s+on table public\.artist_payout_destinations to authenticated/);
    assert.ok(grant, 'grant por columna');
    assert.doesNotMatch(grant[1], /account_identifier[,\s)](?!_)|account_identifier_enc|account_identifier_key_id/);
    assert.match(grant[1], /account_identifier_last4/);
    assert.match(sql, /grant update \(is_default, active\)/);
    assert.match(sql, /auth\.role\(\), ''\) = 'service_role'/);
    assert.match(sql, /coalesce\(v_dest\.account_identifier_last4/);
    assert.match(sql, /v_row\.account_identifier := null;[\s\S]*v_row\.account_identifier_enc := null;/);
    assert.match(sql, /create table if not exists public\.sensitive_data_access_log/);
    assert.match(sql, /alter table public\.sensitive_data_access_log enable row level security/);
    assert.match(sql, /app_setting_is_secret\(setting_key\)/);
    assert.match(sql, /p_key in \('apify_token', 'email_routing'\)/);
    assert.doesNotMatch(sql, /drop column[^;]*account_identifier\b(?!_)/i, 'no borra la columna en claro');
    assert.doesNotMatch(sql, /set account_identifier = null/i, 'la limpieza va en una migración aparte');
    assert.match(down, /--restore-plaintext/);
    // La limpieza vive fuera de migrations/ hasta que el dueño confirme.
    const pending = read('supabase/pending/20261113104500_drop_plaintext_payout_identifier.sql');
    assert.match(pending, /NO APLICAR/);
    assert.match(pending, /disable trigger trg_guard_artist_payout_destination/);
    assert.match(pending, /artist_payout_destinations_no_plaintext/);
    assert.equal(fs.existsSync(path.join(root, 'supabase/migrations/20261113104500_drop_plaintext_payout_identifier.sql')), false);
});

test('navegador: el repo nunca expone el dato completo y las fixtures solo tienen los últimos 4', async () => {
    const calls = [];
    const data = {
        run: async (label, build) => {
            calls.push(label);
            const rows = [{ id: 'd1', artist_user_id: 'u', account_identifier: 'ES9100490001512345677734', is_default: true, created_at: '2026-01-01' }];
            const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; } };
            build({ from: () => chain });
            return { data: rows };
        }
    };
    // Sin backend (preview): fetch responde 403 { preview: true } → cae a PostgREST.
    const fetch = async () => ({ status: 403, json: async () => ({ preview: true }) });
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data, location: { pathname: '/artist/account' } }, console, fetch }, { filename: 'account-repo.js' });
    const list = await data.PayoutDestinations.list('u');
    assert.equal(list[0].account_identifier, undefined);
    assert.equal(list[0].account_identifier_mask, '···· 7734');
    assert.deepEqual(calls, ['payoutdest.list']);
    assert.equal(JSON.stringify(await data.PayoutDestinations.reveal('d1')), JSON.stringify({ available: false, value: null }));

    // Con backend: usa el servidor y no toca PostgREST.
    const seen = [];
    const data2 = { run: async () => { throw new Error('no debería usar PostgREST'); } };
    const fetch2 = async (url, init) => { seen.push(`${init.method} ${url}`); return { status: 200, json: async () => ({ success: true, destinations: [{ id: 'd2', account_identifier_last4: '4821', is_default: false }] }) }; };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data2, location: { pathname: '/beta/artist/account' } }, console, fetch: fetch2 }, { filename: 'account-repo.js' });
    const list2 = await data2.PayoutDestinations.list('u');
    assert.equal(list2[0].account_identifier_mask, '···· 4821');
    assert.deepEqual(seen, ['GET /beta/api/payout-destinations']);

    const fixtures = read('public/shared/js/demo-fixtures/cuenta.js');
    assert.doesNotMatch(fixtures, /account_identifier:/);
    assert.match(fixtures, /account_identifier_last4: '7734'/);
    const wallet = read('public/shared/js/wallet-account.js');
    assert.doesNotMatch(wallet, /dest\.account_identifier\b(?!_)/, 'la UI no precarga ni muestra el número completo');
    const support = read('public/shared/js/data/support-verification-repo.js');
    assert.match(support, /var DEST_SELECT = '[^']*account_identifier_last4/);
    assert.match(support, /\/api\/support\/payout-destinations\//);
});

test('server.js: bloque cifrado con endpoints del dueño y de soporte', () => {
    const server = read('server.js');
    const block = server.slice(server.indexOf('// ── cifrado ──'), server.indexOf('// ── fin cifrado ──'));
    assert.ok(block.length > 100);
    for (const route of ["app.get('/api/payout-destinations'", "app.post('/api/payout-destinations'", "app.patch('/api/payout-destinations/:id'",
        "app.delete('/api/payout-destinations/:id'", "app.post('/api/payout-destinations/:id/reveal'", "app.post('/api/support/payout-destinations/:id/reveal'"]) {
        assert.ok(block.includes(route), route);
    }
    assert.match(block, /_getActiveSupportAgent\(req\)/);
    assert.match(block, /Cache-Control', 'no-store'/);
    const env = read('.env.example');
    assert.match(env, /^DATA_ENC_KEY=/m);
    assert.match(env, /DATA_ENC_PREVIOUS_KEYS/);
    assert.match(read('deployments/DEPLOY.md'), /DATA_ENC_KEY/);
});
