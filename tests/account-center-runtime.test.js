const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('account center covers the nine Figma states and uses mobile-first reflow', () => {
  const html = read('public/artist/account/index.html');
  const css = read('public/shared/css/artist-account-ds.css');
  const js = read('public/shared/js/artist-account.js');

  for (const section of ['perfil', 'portafolio', 'cobros', 'disponibilidad', 'notificaciones', 'seguridad', 'integraciones', 'verificacion', 'configuracion']) {
    assert.match(html, new RegExp(`id="aac-${section}"`));
  }
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
  assert.match(css, /@media \(min-width:48rem\)/);
  assert.match(css, /@media \(min-width:64rem\)/);
  assert.match(css, /grid-template-columns:17rem minmax\(0,1fr\)/);
  assert.match(css, /font-size:clamp\(2rem,10vw,var\(--title-lg-size\)\)/);
  assert.match(css, /repeat\(3,3\.625rem\)/);
  assert.match(js, /NOTIF_EVENTS[\s\S]*'mensajes'[\s\S]*true, true, false/);
  assert.match(html, /<span class="aac-matrix-col">SMS<\/span>/);
  assert.match(html, /data-integration-row="instagram"/);
});

test('security surface uses Supabase MFA, visible sessions and an auditable deletion request', () => {
  const html = read('public/artist/account/index.html');
  const js = read('public/shared/js/artist-account.js');

  assert.match(js, /auth\.mfa\.enroll\(\{ factorType: 'totp'/);
  assert.match(js, /auth\.mfa\.challengeAndVerify/);
  assert.match(js, /auth\.mfa\.unenroll/);
  assert.match(js, /auth\.signOut\(\{ scope: 'others' \}\)/);
  assert.match(js, /D\.AccountSessions\.touch/);
  assert.match(js, /D\.AccountDeletionRequests\.request/);
  assert.match(html, /id="aac-sessions"/);
  assert.match(html, /id="aac-delete-dialog"/);
});

test('payment and document flows never collect raw card data and clean private storage', () => {
  const html = read('public/artist/account/index.html');
  const js = read('public/shared/js/artist-account.js');
  const repo = read('public/shared/js/data/account-repo.js');

  assert.doesNotMatch(html, /CVV|CVC|número completo de tarjeta"\s+id=/i);
  assert.match(html, /Referencia tokenizada del proveedor/);
  assert.match(repo, /metadata de tarjeta no permitida/);
  assert.match(repo, /provider_reference/);
  assert.match(js, /VerificationDocs\.replace/);
  assert.match(js, /removeFromStorage\('artist-verification'/);
  assert.match(js, /verification_cleanup_paths/);
  assert.match(js, /createSignedUrl\(doc\.storage_path, 60\)/);
  const deleteRecord = js.indexOf('await D.VerificationDocs.delete(btn.dataset.docDel)');
  const deleteObject = js.indexOf('await removeOrQueueVerificationPath(doc?.storage_path)', deleteRecord);
  assert.ok(deleteRecord > -1 && deleteObject > deleteRecord, 'delete the DB record before private storage cleanup');
});

test('account repository rejects raw card fields before touching PostgREST', async () => {
  let calls = 0;
  const data = {
    run: async () => { calls += 1; return { data: null }; }
  };
  const sandbox = { window: { WeotziData: data }, console };
  vm.runInNewContext(read('public/shared/js/data/account-repo.js'), sandbox, { filename: 'account-repo.js' });

  await assert.rejects(
    data.PaymentMethods.save('artist-user', {
      provider: 'stripe', methodType: 'card_token', providerReference: 'pm_safe',
      displayName: 'Visa', metadata: { billing: { Card_Number: '4111111111111111' } }
    }),
    /metadata de tarjeta no permitida/
  );
  await assert.rejects(
    data.PaymentMethods.save('artist-user', {
      provider: 'stripe', methodType: 'card_token', providerReference: '4111 1111 1111 1111',
      displayName: 'Visa', metadata: {}
    }),
    /parece un numero de tarjeta/
  );
  await assert.rejects(
    data.AccountIntegrations.save('artist-user', 'stripe', {
      status: 'pending', metadata: { oauth: { API_Key: 'secret-value' } }
    }),
    /secretos no permitidos/
  );
  assert.equal(calls, 0);
});

test('account runtime migration has least-privilege RLS and the demo seed is idempotent', () => {
  const migration = read('supabase/migrations/20260829133000_account_center_runtime.sql');
  const seed = read('supabase/seeds/20260829133500_account_center_isainaz_demo.sql');

  for (const table of ['artist_payment_methods', 'artist_financial_entries', 'artist_account_sessions', 'artist_integration_connections', 'artist_account_deletion_requests']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`));
  }
  assert.match(migration, /account_center_json_has_forbidden_keys/);
  assert.match(migration, /artist_payment_methods_reference_tokenized/);
  assert.match(migration, /array\['pan', 'card_number', 'cvv', 'cvc', 'security_code'\]/);
  assert.match(migration, /status in \('pendiente', 'rechazado'\)/);
  assert.match(seed, /lower\(username\) = 'isainazartattoo\.wo'/);
  assert.match(seed, /on conflict \(artist_user_id, provider, provider_reference\) do update/);
  assert.match(seed, /on conflict \(artist_user_id, external_reference\) do update/);
  assert.doesNotMatch(seed, /411111|"(?:card_number|cvv|cvc)"/i);
});
