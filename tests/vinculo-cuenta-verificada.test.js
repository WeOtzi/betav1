'use strict';
// Vínculo de una cotización a una cuenta de cliente (2.5.2): todas las vías
// usan el mismo criterio que isEmailVerified (lib/cot-cliente.js) — correo
// confirmado y sin la marca de QA qa_unverified_email.
//
//   1. create_manual_quotation (SQL)      → migración 20261117110000
//   2. hide / complete del cliente        → services/account-modes canClaimByEmail
//   3. cotizador web                      → services/quotation-intake normalizeIntake
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isEmailVerified } = require('../lib/cot-cliente');
const { canClaimByEmail, clientProfile } = require('../services/account-modes');
const { normalizeIntake } = require('../services/quotation-intake');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const EMAIL = 'cliente@example.test';
const CONFIRMED = '2026-11-16T12:00:00Z';
const accounts = {
    confirmada: { id: 'u-ok', email: EMAIL, raw: { email_confirmed_at: CONFIRMED } },
    sinConfirmar: { id: 'u-unc', email: EMAIL, raw: { email_confirmed_at: null } },
    sinRaw: { id: 'u-raw', email: EMAIL },
    qaApp: { id: 'u-qa1', email: EMAIL, raw: { email_confirmed_at: CONFIRMED, app_metadata: { qa_unverified_email: true } } },
    qaUser: { id: 'u-qa2', email: EMAIL, raw: { email_confirmed_at: CONFIRMED, user_metadata: { qa_unverified_email: 'true' } } }
};
const unverified = ['sinConfirmar', 'sinRaw', 'qaApp', 'qaUser'];

// ------------------------------------------------------------ hide / complete

test('canClaimByEmail: la cuenta confirmada reclama la cotización sin dueño con su correo', () => {
    const q = { client_email: ' Cliente@Example.test ', client_user_id: null };
    assert.equal(canClaimByEmail(accounts.confirmada, q), true);
});

test('canClaimByEmail: ninguna cuenta sin verificar reclama por correo', () => {
    const q = { client_email: EMAIL, client_user_id: null };
    for (const key of unverified) {
        assert.equal(canClaimByEmail(accounts[key], q), false, key);
        assert.equal(isEmailVerified(accounts[key]), false, key);
    }
});

test('canClaimByEmail: nunca con otra cuenta ya vinculada, otro correo o sin correo', () => {
    assert.equal(canClaimByEmail(accounts.confirmada, { client_email: EMAIL, client_user_id: 'otra' }), false);
    assert.equal(canClaimByEmail(accounts.confirmada, { client_email: 'otro@example.test', client_user_id: null }), false);
    assert.equal(canClaimByEmail(accounts.confirmada, { client_email: '', client_user_id: null }), false);
    assert.equal(canClaimByEmail(null, { client_email: EMAIL, client_user_id: null }), false);
});

test('clientProfile marca email_verified con el mismo criterio', () => {
    assert.equal(clientProfile(accounts.confirmada).email_verified, true);
    for (const key of unverified) assert.equal(clientProfile(accounts[key]).email_verified, false, key);
});

test('hide y complete solo vinculan por correo a través de canClaimByEmail', () => {
    const server = read('server.js');
    for (const route of ['/hide', '/complete']) {
        const start = server.indexOf(`app.post('/api/client/quotations/:quoteId${route}'`);
        assert.ok(start > 0, route);
        const end = server.indexOf('\napp.', start + 10);
        const handler = server.slice(start, end);
        assert.match(handler, /accountModes\.canClaimByEmail\(caller, quotation\)/, route);
        assert.match(handler, /claimForClient\(quotation\.id, caller\.id\)/, route);
        assert.doesNotMatch(handler, /client_email\s*(===|==)/, route);
    }
});

// ------------------------------------------------------------ cotizador web

const intakeBody = () => ({
    submission_key: '9a2c7a2e-5d4b-4c1e-8f3a-2b6d7e8f9a01',
    mode: 'submit',
    quotation: {
        artist_id: 'artist-user', client_full_name: 'Cliente', client_email: 'Cliente@Example.test',
        tattoo_idea_description: 'Idea', tattoo_style: { style_name: 'Realismo' }, tattoo_body_part: 'Brazo', tattoo_size: 'Mediano'
    }
});
const artist = { user_id: 'artist-user', username: 'real.wo', name: 'Real', email: 'artist@example.test', registration_status: 'pendiente de validacion' };

test('cotizador: con la cuenta confirmada la cotización nace vinculada', () => {
    assert.equal(normalizeIntake(intakeBody(), accounts.confirmada, artist).q.client_user_id, 'u-ok');
});

test('cotizador: con una cuenta sin verificar la cotización queda como invitado', () => {
    for (const key of unverified) {
        assert.equal(normalizeIntake(intakeBody(), accounts[key], artist).q.client_user_id, null, key);
    }
});

test('cotizador: una cuenta confirmada con otro correo no se vincula', () => {
    const other = { id: 'u-other', email: 'otro@example.test', raw: { email_confirmed_at: CONFIRMED } };
    assert.equal(normalizeIntake(intakeBody(), other, artist).q.client_user_id, null);
});

// ------------------------------------------------------------ create_manual_quotation

const MIGRATION = 'supabase/migrations/20261117110000_manual_quote_vinculo_cuenta_verificada.sql';
const ROLLBACK = 'supabase/rollbacks/20261117110000_manual_quote_vinculo_cuenta_verificada.down.sql';

// Condiciones del where que elige la cuenta (una por línea, sin espacios).
function accountFilter(sql, marker) {
    const start = sql.indexOf(marker);
    assert.ok(start >= 0, marker);
    const block = sql.slice(start, sql.indexOf('limit 1;', start));
    return block.split('\n')
        .map((line) => line.trim().replace(/^(where|and)\s+/, ''))
        .filter((line) => /^(lower\(btrim\(u\.email\)\)|u\.|coalesce\(u\.)/.test(line))
        .map((line) => line.replace(/= (v_email|q\.client_email)$/, '= :email'))
        .sort();
}

function functionBody(sql) {
    const start = sql.indexOf('as $function$') + 'as $function$'.length;
    return sql.slice(start, sql.lastIndexOf('$function$;'));
}

test('create_manual_quotation usa el mismo filtro de cuenta que link_quotation_contact', () => {
    const migration = read(MIGRATION);
    const linkContact = read('supabase/migrations/20261116110200_cot_form_r2_vinculo_contacto.sql');
    const mine = accountFilter(migration, 'select u.id into q.client_user_id');
    const reference = accountFilter(linkContact, 'select u.id into v_account');
    assert.deepEqual(mine, reference);
    for (const cond of ['u.email_confirmed_at is not null', "coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'",
        "coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'"]) {
        assert.ok(mine.includes(cond), cond);
    }
    assert.match(migration, /join public\.clients_db c on c\.user_id = u\.id/);
    assert.doesNotMatch(functionBody(migration), /where lower\(c\.email\) = q\.client_email/);
});

test('la migración solo cambia el bloque del vínculo y la reversa restaura la función anterior', () => {
    const migration = functionBody(read(MIGRATION));
    const rollback = functionBody(read(ROLLBACK));
    assert.match(rollback, /from public\.clients_db c\n\s+where lower\(c\.email\) = q\.client_email/);
    const linkBlock = /  q\.client_user_id := null;\n[\s\S]*?  end if;\n/;
    assert.equal(migration.replace(linkBlock, ''), rollback.replace(linkBlock, ''));
    assert.match(read(MIGRATION), /^begin;$/m);
    assert.match(read(ROLLBACK), /^commit;$/m);
});
