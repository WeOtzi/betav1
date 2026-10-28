'use strict';
// Figma final del flujo de artista (oct 2026) · área "cuenta" (/artist/account).
// Cubre la lógica pura del Wallet y de Disponibilidad por ubicación, la
// migración (no aplicada) del Wallet, las fixtures del preview y el markup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const W = require('../public/shared/js/wallet-model.js');
const AV = require('../public/shared/js/account-availability-model.js');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

function sampleMovements() {
    return [
        { kind: 'withdrawal', status: 'processing', amount: 500, currency: 'USD', title: 'Retiro a Cuenta bancaria USD', occurred_at: daysAgo(1) },
        { kind: 'release', status: 'completed', amount: 1240, currency: 'USD', title: 'Fondos liberados — Martín', occurred_at: daysAgo(2) },
        { kind: 'payment', status: 'awaiting_release', amount: 360, currency: 'USD', title: 'Pago — Lucía', counterparty_name: 'Lucía', release_at: new Date(NOW + 18 * 3600000).toISOString(), occurred_at: daysAgo(3) },
        { kind: 'withdrawal', status: 'completed', amount: 900, currency: 'USD', title: 'Retiro a Lemon', occurred_at: daysAgo(8) },
        { kind: 'payment', status: 'pending_service', amount: 680, currency: 'USD', title: 'Pago — Sofía', counterparty_name: 'Sofía', service_date: '2026-11-06', occurred_at: daysAgo(9) },
        { kind: 'release', status: 'completed', amount: 980, currency: 'USD', title: 'Fondos liberados — Paula', occurred_at: daysAgo(11) },
        { kind: 'fee', status: 'completed', amount: 60, currency: 'USD', title: 'Comisión We Ötzi', occurred_at: daysAgo(13) },
        { kind: 'dispute', status: 'blocked', amount: 700, currency: 'USD', title: 'Disputa abierta — Costa Ink', counterparty_name: 'Costa Ink Collective', occurred_at: daysAgo(16) },
        { kind: 'payment', status: 'pending_service', amount: 220, currency: 'USD', title: 'Pago — Mateo', counterparty_name: 'Mateo', service_date: '2026-11-17', occurred_at: daysAgo(18) },
        { kind: 'release', status: 'completed', amount: 480, currency: 'USD', title: 'Fondos liberados — Rocío', occurred_at: daysAgo(21) },
        { kind: 'payment', status: 'blocked', amount: 1200, currency: 'USD', title: 'Pago — Costa Ink', counterparty_name: 'Costa Ink Collective', occurred_at: daysAgo(30) },
        { kind: 'release', status: 'completed', amount: 999, currency: 'EUR', title: 'Otra moneda', occurred_at: daysAgo(4) }
    ].map(W.normalizeMovement);
}

test('wallet: el resumen replica el saldo de la RPC y los cuatro estados del Figma', () => {
    const s = W.summarize(sampleMovements(), 'USD', NOW);
    assert.equal(s.available, 1240);          // 2700 liberado − 1400 retiros − 60 comisión
    assert.equal(s.pendingService, 900);
    assert.equal(s.awaitingRelease, 360);
    assert.equal(s.blocked, 700);
    assert.equal(s.inWithdrawal, 500);
    assert.equal(s.activeDisputes, 1);
    assert.equal(s.nextReleaseHours, 18);
    assert.equal(s.blockedCounterparty, 'Costa Ink Collective');
    assert.equal(W.summarize(sampleMovements(), 'EUR', NOW).available, 999);
    assert.equal(W.primaryCurrency(sampleMovements(), 'ARS'), 'USD');
    assert.equal(W.primaryCurrency(sampleMovements(), 'EUR'), 'EUR');
});

test('wallet: próximas liberaciones, filtros de actividad y presentación', () => {
    const list = W.upcomingReleases(sampleMovements());
    assert.deepEqual(list.map((m) => m.status), ['pending_service', 'pending_service', 'awaiting_release', 'blocked']);
    assert.deepEqual(list.slice(0, 2).map((m) => m.counterparty), ['Sofía', 'Mateo']);
    assert.equal(W.releaseView(list[0], NOW).label, 'Pendiente por realizar');
    assert.equal(W.releaseView(list[0], NOW).meta, 'Servicio: 6 nov 2026');
    assert.equal(W.releaseView(list[2], NOW).meta, 'Liberación automática en 18 h');
    assert.equal(W.releaseView(list[3], NOW).label, 'Bloqueado por disputa');

    const all = W.activity(sampleMovements(), 'todos');
    assert.equal(all[0].title, 'Retiro a Cuenta bancaria USD');
    assert.deepEqual(W.activity(sampleMovements(), 'retiros').map((m) => m.kind), ['withdrawal', 'withdrawal']);
    assert.equal(W.activity(sampleMovements(), 'comisiones').length, 1);
    assert.equal(W.activity(sampleMovements(), 'disputas')[0].kind, 'dispute');
    assert.equal(W.activity(sampleMovements(), 'liberaciones').length, 4);

    assert.deepEqual(W.movementView(all.find((m) => m.kind === 'release')), { icon: '↓', tone: 'success', sign: '+', statusLabel: 'Completado' });
    assert.equal(W.movementView(all.find((m) => m.kind === 'fee')).icon, '%');
    assert.equal(W.movementView(all.find((m) => m.kind === 'dispute')).statusLabel, 'Bloqueados');
    assert.equal(W.movementView(all[0]).statusLabel, 'En proceso');
});

test('wallet: montos con números europeos y validaciones de retiro y destino', () => {
    assert.equal(W.formatMoney(1240, 'usd'), 'USD 1.240');
    assert.equal(W.formatMoney(1240.5, 'USD'), 'USD 1.240,50');
    assert.equal(W.formatMoney(1200000, 'ARS'), 'ARS 1.200.000');
    assert.equal(W.parseAmount('1.240'), 1240);
    assert.equal(W.parseAmount('1.240,50'), 1240.5);
    assert.equal(W.parseAmount('240,5'), 240.5);
    assert.equal(W.parseAmount('12.5'), 12.5);
    assert.equal(W.parseAmount('1,240.50'), 1240.5);
    assert.ok(Number.isNaN(W.parseAmount('abc')));

    const verified = { verification_status: 'verified' };
    assert.equal(W.validateWithdrawal(100, 1240, null), 'Agregá un destino de retiro.');
    assert.equal(W.validateWithdrawal(100, 1240, { verification_status: 'pending' }), 'El destino todavía no está verificado.');
    assert.equal(W.validateWithdrawal(0, 1240, verified), 'Ingresá un monto mayor a cero.');
    assert.equal(W.validateWithdrawal(2000, 1240, verified), 'El monto supera tu saldo disponible.');
    assert.equal(W.validateWithdrawal(1240, 1240, verified), null);

    assert.equal(W.validateDestination({ method: 'lemon', holderName: 'Ana', currency: 'USD', accountIdentifier: 'lemon.ana' }).ok, true);
    assert.equal(W.validateDestination({ method: 'paypal', holderName: 'Ana', currency: 'USD', accountIdentifier: 'ana@x.com' }).errors.method, 'Elegí un método disponible.');
    assert.ok(W.validateDestination({ method: 'bank_usd', holderName: '', currency: 'USD', accountIdentifier: '12' }).errors.holderName);
    assert.equal(W.maskIdentifier('ES91 0049 0001 5123 4567 7734'), '···· 7734');
});

test('wallet: modo derivado desde cotizaciones y ledger histórico', () => {
    const quotes = [
        { quote_id: 'Q1', quote_status: 'client_approved', final_budget_amount: null, artist_budget_amount: 250, artist_budget_currency: 'USD', client_full_name: 'Sofía', client_preferred_date: '2026-11-07', updated_at: daysAgo(1) },
        { quote_id: 'Q2', quote_status: 'artist_completed', final_budget_amount: 180, final_budget_currency: 'USD', client_full_name: 'Lucía', artist_completed_at: new Date(NOW - 54 * 3600000).toISOString() },
        { quote_id: 'Q3', quote_status: 'completed', final_budget_amount: 1240, final_budget_currency: 'USD', client_full_name: 'Martín', client_completed_at: daysAgo(2) },
        { quote_id: 'Q4', quote_status: 'pending', final_budget_amount: 900 }
    ];
    const derived = W.fromQuotations(quotes, { includeCompleted: true });
    assert.deepEqual(derived.map((m) => `${m.quoteId}:${m.kind}:${m.status}`), ['Q1:payment:pending_service', 'Q2:payment:awaiting_release', 'Q3:release:completed']);
    assert.equal(W.hoursUntil(derived[1].releaseAt, NOW), W.AUTO_RELEASE_HOURS - 54);
    assert.equal(W.fromQuotations(quotes, { includeCompleted: false }).length, 2);

    const fe = W.fromFinancialEntries([
        { id: 1, entry_type: 'income', amount: 1240, currency: 'USD', status: 'completed', title: 'Retrato' },
        { id: 2, entry_type: 'payout', amount: -1178, currency: 'USD', status: 'completed', title: 'Transferencia' },
        { id: 3, entry_type: 'fee', amount: -62, currency: 'USD', status: 'completed', title: 'Comisión' },
        { id: 4, entry_type: 'income', amount: 10, currency: 'USD', status: 'completed', title: 'Resumen', metadata_json: { summary_only: true } }
    ]);
    assert.deepEqual(fe.map((m) => m.kind), ['release', 'withdrawal', 'fee']);
    assert.equal(W.summarize(fe, 'USD').available, 0);
});

test('disponibilidad: horarios, ubicaciones y textos de las pestañas del Figma 801:571', () => {
    const cdmxWeekly = AV.normalizeWeekly(AV.DAYS.map(([day]) => ({
        day, enabled: day !== 'domingo', start: day === 'sabado' ? '12:00' : '11:00', end: day === 'sabado' ? '18:00' : '20:00'
    })));
    assert.equal(AV.weeklyHours(cdmxWeekly), 51);
    assert.equal(AV.activeDays(cdmxWeekly), 6);
    assert.equal(AV.isHalfDay(cdmxWeekly[5]), true);
    assert.equal(AV.isHalfDay(cdmxWeekly[0]), false);
    assert.deepEqual(AV.validateWeekly([{ day: 'lunes', enabled: true, start: '20:00', end: '11:00' }]), ['Lunes: la hora de fin tiene que ser posterior al inicio.']);
    assert.equal(AV.normalizeWeekly(null).filter((d) => d.enabled).length, 5);
    assert.equal(AV.normalizeWeekly({ lunes: { enabled: true, start: '09:00', end: '13:00' } })[0].start, '09:00');

    assert.equal(AV.formatRange('2026-10-12', '2026-10-26'), '12 — 26 oct 2026');
    assert.equal(AV.formatRange('2026-10-28', '2026-11-03'), '28 oct — 3 nov 2026');
    assert.equal(AV.formatRange('2026-12-20', '2027-01-04'), '20 dic 2026 — 4 ene 2027');

    const base = { id: 'a', period_type: 'current', sort_order: 0, studio_name: 'Tinta Roja — Palermo', city: 'Buenos Aires', agenda_status: 'open' };
    const priv = { id: 'b', period_type: 'current', sort_order: 1, studio_name: 'Estudio privado — Villa Crespo', agenda_status: 'open' };
    const cdmx = { id: 'c', period_type: 'upcoming', city: 'Ciudad de México', country: 'México', studio_name: 'Tinta Negra Studio', neighborhood: 'Roma Norte', agenda_status: 'open', start_date: '2026-10-26', end_date: '2026-11-09' };
    const berlin = { id: 'd', period_type: 'upcoming', city: 'Berlín', country: 'Alemania', studio_name: 'Blut & Tinte', agenda_status: 'closed', start_date: '2026-12-27', end_date: '2027-01-10' };
    const paris = { id: 'e', period_type: 'upcoming', city: 'París', country: 'Francia', studio_name: 'Atelier Encre', agenda_status: 'waitlist', start_date: '2026-12-07', end_date: '2026-12-13' };
    const all = [berlin, cdmx, priv, base, paris];
    assert.deepEqual(AV.sortLocations(all).map((l) => l.id), ['a', 'b', 'c', 'e', 'd']);
    assert.equal(AV.locationKind(base, all), 'Estudio base');
    assert.equal(AV.locationKind(priv, all), 'Estudio privado');
    assert.equal(AV.locationKind(cdmx, all), 'Travel');
    assert.equal(AV.locationTitle(cdmx), 'Ciudad de México, MX');
    assert.equal(AV.locationTitle(berlin), 'Berlín, DE');
    assert.equal(AV.locationDetail(cdmx), 'Tinta Negra Studio · Roma Norte');
    assert.equal(AV.cityShort(cdmx), 'CDMX');
    assert.equal(AV.locationSubtitle(base, AV.defaultWeekly()), '5 días · Permanente');
    assert.equal(AV.locationSubtitle(cdmx, cdmxWeekly), '6 días · 26 oct — 9 nov 2026');
    assert.equal(AV.locationSubtitle(berlin, cdmxWeekly), 'Pausada');
    assert.equal(AV.locationSubtitle(paris, cdmxWeekly), 'Lista de espera · 7 — 13 dic 2026');
    assert.equal(AV.statusLabel('waitlist'), 'Lista de espera');
    assert.equal(AV.defaultLocation(all, '2026-10-28').id, 'c');
    assert.equal(AV.defaultLocation([base, berlin], '2026-10-28').id, 'a');

    const patch = AV.availabilityPatch({ weekly: [], locations: { x: { weekly: [] } } }, base, cdmxWeekly, true);
    assert.equal(patch.locations.a.weekly.length, 7);
    assert.ok(patch.locations.x, 'conserva los horarios de otras ubicaciones');
    assert.equal(patch.weekly.length, 7, 'la base espeja el formato histórico availability.weekly');
    assert.deepEqual(AV.scheduleFor(patch, base, true), AV.normalizeWeekly(cdmxWeekly));

    assert.equal(AV.validateUpcoming({ city: 'Lisboa', studioName: 'Alfama', startDate: '2026-12-10', endDate: '2026-12-01' }).errors.dates, 'La fecha de fin tiene que ser posterior al inicio.');
    assert.equal(AV.validateUpcoming({ city: 'Lisboa', studioName: 'Alfama', startDate: '2026-12-10', endDate: '2026-12-20' }, '2026-10-28').ok, true);
});

test('migración del Wallet: aditiva, con RLS mínima, retiro con lock y reversa completa', () => {
    const sql = read('supabase/migrations/20261028150000_artist_wallet.sql');
    const down = read('supabase/rollbacks/20261028150000_artist_wallet.down.sql');
    for (const table of ['artist_payout_destinations', 'artist_wallet_movements', 'wallet_card_waitlist']) {
        assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon`));
        assert.match(down, new RegExp(`drop table if exists public\\.${table}`));
    }
    assert.match(sql, /grant select on table public\.artist_wallet_movements to authenticated/);
    assert.doesNotMatch(sql, /grant[^;]*insert[^;]*artist_wallet_movements/i, 'el artista no inserta movimientos directo');
    assert.match(sql, /security definer[\s\S]*pg_advisory_xact_lock/);
    assert.match(sql, /insufficient balance/);
    assert.match(sql, /verification_status <> 'verified'/);
    assert.match(sql, /new\.verification_status := 'pending'/);
    assert.match(sql, /where is_default and active/);
    assert.doesNotMatch(sql, /card_number|cvv/i);
    for (const fn of ['request_artist_wallet_withdrawal', 'artist_wallet_available_balance', 'set_artist_default_payout_destination', 'guard_artist_payout_destination']) {
        assert.match(down, new RegExp(`drop function if exists public\\.${fn}`));
    }
    const ts = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.includes('artist_wallet'));
    assert.deepEqual(ts, ['20261028150000_artist_wallet.sql']);
});

test('repositorio: valida destinos y lista de espera antes de tocar PostgREST', async () => {
    let calls = 0;
    const data = { run: async () => { calls += 1; return { data: null }; } };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data }, console }, { filename: 'account-repo.js' });
    await assert.rejects(data.PayoutDestinations.save('u', { method: 'paypal', accountIdentifier: 'x@y.com' }), /metodo no disponible/);
    await assert.rejects(data.PayoutDestinations.save('u', { method: 'lemon', accountIdentifier: '12' }), /identificador invalido/);
    await assert.rejects(data.PayoutDestinations.save('u', { method: 'lemon', accountIdentifier: 'lemon.ana', metadata: { card: { CVV: '123' } } }), /tarjeta no permitida/);
    await assert.rejects(data.CardWaitlist.join('u', 'no-es-mail'), /email invalido/);
    await assert.rejects(data.WalletMovements.requestWithdrawal({ destinationId: 'd', amount: 0 }), /datos invalidos/);
    await assert.rejects(data.AvailabilityLocations.setAgendaStatus('u', 'l', 'borrada'), /estado invalido/);
    assert.equal(calls, 0);
    for (const repo of ['PayoutDestinations', 'WalletMovements', 'CardWaitlist', 'AvailabilityLocations', 'AccountProfile']) {
        assert.ok(data[repo], repo + ' expuesto en WeotziData');
    }
});

test('fixtures del preview: tablas nuevas, RPC de retiro con saldo y ubicaciones sumadas al asignar', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/cuenta.js'), sandbox, { filename: 'cuenta.js' });
    const ext = sandbox.WoDemoFixtureExtensions.cuenta;
    const ctx = {
        tables: { user_preferences: [{ app_settings: {} }], artist_account_sessions: [], artist_verification_documents: [] },
        rpcs: {}, TABLES: [], identity: { userId: 'artist-1' }, helpers: { DAY: 86400000 }
    };
    ext(ctx);
    for (const t of ['artist_payout_destinations', 'artist_wallet_movements', 'wallet_card_waitlist']) assert.ok(ctx.TABLES.includes(t));
    const moves = ctx.tables.artist_wallet_movements.map(W.normalizeMovement);
    const s = W.summarize(moves, 'USD');
    assert.deepEqual([s.available, s.pendingService, s.awaitingRelease, s.blocked, s.inWithdrawal], [1240, 900, 360, 700, 500]);
    assert.equal(ctx.tables.artist_verification_documents.length, 3);
    assert.ok(ctx.tables.user_preferences[0].app_settings.availability.locations);

    // El preview asigna su ubicación base después de build(): se suman las de la cuenta.
    assert.equal(Object.keys(ctx.tables).includes('artist_tattoo_locations'), false);
    ctx.tables.artist_tattoo_locations = [{ id: 'preview-location', period_type: 'current', sort_order: 0 }];
    assert.equal(ctx.tables.artist_tattoo_locations.length, 4);

    const rows = { artist_wallet_movements: ctx.tables.artist_wallet_movements, artist_payout_destinations: ctx.tables.artist_payout_destinations };
    const store = { rows: (n) => rows[n], insert: (n, list) => { const out = list.map((r, i) => Object.assign({ id: 'new-' + i }, r)); rows[n].push(...out); return out; } };
    const lemon = ctx.tables.artist_payout_destinations.find((d) => d.method === 'lemon');
    assert.throws(() => ctx.rpcs.request_artist_wallet_withdrawal({ p_destination_id: lemon.id, p_amount: 5000, p_currency: 'USD' }, store, { userId: 'artist-1' }), /insufficient balance/);
    const row = ctx.rpcs.request_artist_wallet_withdrawal({ p_destination_id: lemon.id, p_amount: 240.5, p_currency: 'USD' }, store, { userId: 'artist-1' });
    assert.equal(row.status, 'processing');
    assert.equal(W.summarize(rows.artist_wallet_movements.map(W.normalizeMovement), 'USD').available, 999.5);
});

test('markup: ocho secciones del Figma, sin Integraciones, y orden de carga de la capa de datos', () => {
    const html = read('public/artist/account/index.html');
    const labels = [...html.matchAll(/data-aac-nav="([a-z]+)"><i[^>]*><\/i><span>([^<]+)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(labels, ['perfil:Mi Perfil', 'portafolio:Portafolio', 'cobros:Cobros y facturación', 'disponibilidad:Disponibilidad',
        'notificaciones:Notificaciones', 'seguridad:Seguridad y Privacidad', 'verificacion:Verificación', 'configuracion:Configuración']);
    assert.doesNotMatch(html, /integraciones|Integraciones/);
    for (const id of ['wal-dest-dialog', 'wal-card-dialog', 'av-travel-dialog', 'aac-phone-dialog', 'aac-question-dialog', 'av-saved']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    const order = ['config-manager.js', 'postgrest-client.js', 'account-repo.js', 'wallet-model.js', 'account-availability-model.js', 'wallet-account.js', 'artist-account.js'];
    const positions = order.map((f) => html.indexOf(f));
    assert.ok(positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1])), 'orden de scripts: ' + positions.join(','));
    const js = read('public/shared/js/artist-account.js') + read('public/shared/js/wallet-account.js');
    assert.doesNotMatch(js, /fetch\(['"`][^'"`]*\/rest\/v1/);
    assert.doesNotMatch(js, /_supabase\.from\(/);
});

// ---------------------------------------------------------------------------
// Ronda 1 de corrección (auditoría independiente del área cuenta)
// ---------------------------------------------------------------------------

test('wallet: un número de tarjeta nunca se guarda como destino de retiro (modelo)', () => {
    const base = { method: 'lemon', holderName: 'Ana', currency: 'USD' };
    for (const pan of ['4111 1111 1111 1111', '4111-1111-1111-1111', '5555555555554444', '378282246310005', '6011111111111117']) {
        assert.equal(W.looksLikeCardNumber(pan), true, pan);
        const check = W.validateDestination({ ...base, accountIdentifier: pan });
        assert.equal(check.ok, false, pan);
        assert.match(check.errors.accountIdentifier, /No ingreses números de tarjeta/);
    }
    // CBU (22 dígitos), IBAN, alias y cuentas ACH que no pasan Luhn siguen valiendo.
    for (const ok of ['0170099220000067797370', 'ES9100490001512345677734', 'lemon.ana.4821', '000123451190', '4111111111111112']) {
        assert.equal(W.looksLikeCardNumber(ok), false, ok);
        assert.equal(W.validateDestination({ ...base, accountIdentifier: ok }).ok, true, ok);
    }
});

test('repositorio: PayoutDestinations.save rechaza un PAN antes de tocar PostgREST', async () => {
    let calls = 0;
    const data = { run: async () => { calls += 1; return { data: null }; } };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data }, console }, { filename: 'account-repo.js' });
    await assert.rejects(data.PayoutDestinations.save('u', { method: 'lemon', accountIdentifier: '4111 1111 1111 1111' }), /numero de tarjeta/);
    await assert.rejects(data.PayoutDestinations.save('u', { method: 'bank_usd', accountIdentifier: '5555-5555-5555-4444' }), /numero de tarjeta/);
    assert.equal(calls, 0);
});

test('repositorio: Prefs.saveSection encola las escrituras y no pierde cambios seguidos', async () => {
    let stored = { user_id: 'u', app_settings: { theme: 'light' } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const delays = [30, 5, 20, 1, 15, 2, 25, 3, 10, 4];
    let n = 0;
    const data = {
        run: async (label, build) => {
            const ms = delays[n++ % delays.length];
            if (label === 'prefs.get') { await wait(ms); return { data: JSON.parse(JSON.stringify(stored)) }; }
            if (label === 'prefs.saveSection') {
                let row = null;
                const chain = { select: () => ({ maybeSingle: () => chain }) };
                build({ from: () => ({ upsert: (rows) => { row = rows[0]; return chain; } }) });
                await wait(ms);
                stored = Object.assign({}, stored, row);
                return { data: JSON.parse(JSON.stringify(stored)) };
            }
            return { data: null };
        }
    };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data }, console, setTimeout }, { filename: 'account-repo.js' });
    const results = await Promise.all([
        data.Prefs.saveSection('u', 'app_settings', { timezone: 'Europe/Madrid' }),
        data.Prefs.saveSection('u', 'app_settings', { date_format: 'AAAA-MM-DD' }),
        data.Prefs.saveSection('u', 'app_settings', { page_size: '50' }),
        data.Prefs.saveSection('u', 'app_settings', { density: 'compact' }),
        data.Prefs.saveSection('u', 'app_settings', { reduce_motion: true })
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(stored.app_settings)), {
        theme: 'light', timezone: 'Europe/Madrid', date_format: 'AAAA-MM-DD', page_size: '50', density: 'compact', reduce_motion: true
    });
    assert.equal(results[4].app_settings.reduce_motion, true);
    // Una sección inválida falla sin cortar la cola.
    await assert.rejects(data.Prefs.saveSection('u', 'otra', {}), /seccion invalida/);
    await data.Prefs.saveSection('u', 'notification_prefs', { mensajes: { email: false } });
    assert.deepEqual(JSON.parse(JSON.stringify(stored.notification_prefs)), { mensajes: { email: false } });
});

test('markup y runtime: correcciones de la auditoría (Figma 801:565/569/570/571/575)', () => {
    const html = read('public/artist/account/index.html');
    const js = read('public/shared/js/artist-account.js');
    const wallet = read('public/shared/js/wallet-account.js');
    const css = read('public/shared/css/artist-account-ds.css');
    const walletCss = read('public/shared/css/wallet-account.css');

    // Mi perfil termina en Sitio web + GUARDAR CAMBIOS; Oficio y tarifa queda plegado debajo.
    const perfil = html.slice(html.indexOf('id="aac-perfil"'), html.indexOf('id="aac-portafolio"'));
    const save = perfil.indexOf('id="aac-profile-save"');
    assert.ok(save > perfil.indexOf('id="aac-website"'), 'el botón va después de Sitio web');
    assert.ok(perfil.indexOf('<details class="aac-more" id="aac-oficio">') > save, 'Oficio y tarifa plegado debajo del botón');
    assert.match(perfil, /id="aac-oficio-save"/);
    assert.match(js, /async function saveOficio\(\)/);

    // Los diálogos enfocan el título al abrir (sin anillo de foco en la ×).
    const dialogs = (html.match(/<dialog /g) || []).length;
    assert.equal((html.match(/tabindex="-1" autofocus/g) || []).length, dialogs);
    // Viñetas de la Card como formas CSS, no glifos.
    assert.doesNotMatch(html, /wal-bullet[^>]*>[■▲●]</);
    assert.match(walletCss, /\.wal-bullet--triangle\{[^}]*clip-path/);
    // La ayuda de "nunca datos de tarjeta" queda para lectores de pantalla.
    assert.match(html, /class="wo-sr-only" id="wal-dest-identifier-help">Nunca ingreses datos de tarjeta/);
    assert.doesNotMatch(wallet, /'Elegido'/);

    // Disponibilidad: el estado por URL espera las ubicaciones y el banner nombra la editada.
    assert.match(js, /openStateFromQuery\(availabilityReady\)/);
    assert.match(js, /await availabilityReady;/);
    assert.match(js, /avState\.locations\.find\(\(l\) => l\.id === edited\[0\]\)/);
    assert.match(html, /id="av-tabs-wrap"/);

    // Seguridad: sin "Cerrar sesión" por dispositivo que en realidad cerraba todas.
    assert.doesNotMatch(js, /data-session-revoke/);
    assert.match(js, /auth\.signOut\(\{ scope: 'others' \}\)/);

    // Retiro rápido sigue al predeterminado; editar un destino con otro método renueva el nombre.
    assert.match(wallet, /state\.quickManual = false/);
    assert.match(wallet, /existing\.method === input\.method/);

    // CSS: sin margen de body, dropzones neutras y border-box, filas de accesibilidad de 56px.
    assert.match(css, /body\.aac-page\{margin:0;/);
    assert.match(css, /\.aac-drop\{[^}]*box-sizing:border-box/);
    assert.match(css, /\.aac-togglerow\{[^}]*box-sizing:border-box;min-height:56px/);
    assert.match(walletCss, /\.wal-dest-name \.wal-mono-s\{[^}]*font-family:var\(--font-mono\)/);
    assert.match(walletCss, /\.wal-balance\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    for (const sheet of [css, walletCss]) assert.doesNotMatch(sheet, /@media\s*\(max-width/);
});

// ---------------------------------------------------------------------------
// Ronda 2 de corrección (auditoría independiente del área cuenta)
// ---------------------------------------------------------------------------

test('wallet: un PAN con puntos, guiones bajos u otros separadores también se rechaza (modelo)', () => {
    const base = { method: 'lemon', holderName: 'Ana', currency: 'USD' };
    for (const pan of ['4111.1111.1111.1111', '4111_1111_1111_1111', '5555.5555-5555_4444', ' 4111 . 1111 . 1111 . 1111 ', '4111/1111/1111/1111', '４１１１１１１１１１１１１１１１']) {
        assert.equal(W.looksLikeCardNumber(pan), true, pan);
        const check = W.validateDestination({ ...base, accountIdentifier: pan });
        assert.equal(check.ok, false, pan);
        assert.match(check.errors.accountIdentifier, /No ingreses números de tarjeta/, pan);
    }
    // Alias con puntos y CBU con separadores siguen valiendo.
    for (const ok of ['lemon.ana.4821', 'ana_tattoo.usd', '0170.0992.2000.0067.7973.70', '000.123.451.190', '4111.1111.1111.1112']) {
        assert.equal(W.looksLikeCardNumber(ok), false, ok);
        assert.equal(W.validateDestination({ ...base, accountIdentifier: ok }).ok, true, ok);
    }
});

test('repositorio: PayoutDestinations.save rechaza un PAN con puntos o guiones bajos antes de tocar PostgREST', async () => {
    let calls = 0;
    const data = { run: async () => { calls += 1; return { data: null }; } };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data }, console }, { filename: 'account-repo.js' });
    for (const pan of ['4111.1111.1111.1111', '4111_1111_1111_1111', '5555.5555.5555.4444', '4111/1111/1111/1111']) {
        await assert.rejects(data.PayoutDestinations.save('u', { method: 'lemon', accountIdentifier: pan }), /numero de tarjeta/, pan);
    }
    assert.equal(calls, 0);
    // Un alias con puntos sí llega a PostgREST.
    await data.PayoutDestinations.save('u', { method: 'lemon', accountIdentifier: 'lemon.ana.4821', holderName: 'Ana' }).catch(() => {});
    assert.ok(calls > 0);
});

test('verificación: REEMPLAZAR/SUBIR deshabilitados también quedan ocultos en reposo (Figma 801:573)', () => {
    const css = read('public/shared/css/artist-account-ds.css');
    assert.match(css, /\.aac-doc-action\{[^}]*opacity:0/);
    // La regla :disabled ya no fija la opacidad en reposo (antes ganaba por especificidad).
    const disabledRest = css.match(/(^|\})\s*\.aac-doc-action:disabled\{([^}]*)\}/m);
    assert.ok(disabledRest, 'existe la regla .aac-doc-action:disabled');
    assert.doesNotMatch(disabledRest[2], /opacity/);
    // Atenuada solo al pasar el mouse / con foco en la fila, o en táctiles.
    assert.match(css, /\.aac-doc:hover \.aac-doc-action:disabled,\.aac-doc:focus-within \.aac-doc-action:disabled\{opacity:var\(--opacity-disabled\)\}/);
    assert.match(css, /@media \(hover:none\)\{\.aac-doc-action:disabled\{opacity:var\(--opacity-disabled\)\}\}/);
});
