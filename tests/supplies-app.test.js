// App Supplies (/supplies/*): identidad (supplies-auth.js), wizard de
// registro (supplies-register.js), panel (supplies-dashboard.js) y markup.
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → Supplies.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// Los objetos creados dentro de la VM tienen otro Object.prototype.
const plain = value => JSON.parse(JSON.stringify(value));

const authSource = read('public/shared/js/supplies-auth.js');
const Register = require('../public/shared/js/supplies-register.js');
const Dashboard = require('../public/shared/js/supplies-dashboard.js');
const Kit = require('../public/shared/js/studio-admin-kit.js');

// ---------------------------------------------------------------
// supplies-auth.js (VM con cliente falso, como studio-identity-flows)
// ---------------------------------------------------------------
const user = { id: 'vendor-user', email: 'ventas@insumos.test', user_metadata: {} };
const vendorRow = { id: '11111111-1111-4111-8111-111111111111', user_id: user.id, name: 'Tinta Sur', currency: 'ARS', is_verified: false };

function authHarness(options = {}) {
    const calls = [];
    const client = {
        auth: {
            getSession: async () => ({ data: { session: options.session || null } }),
            signUp: async payload => { calls.push(['signup', payload]); return { data: options.signup || { user, session: null } }; },
            signInWithPassword: async () => ({ data: { session: options.session || { user } } }),
            updateUser: async payload => { calls.push(['updateUser', payload]); return { data: { user } }; },
            resetPasswordForEmail: async (...args) => { calls.push(['reset', ...args]); return {}; },
            verifyOtp: async payload => { calls.push(['verifyOtp', payload]); return {}; },
            signOut: async () => { calls.push(['signOut']); return {}; }
        }
    };
    const Supplies = {
        getVendorByUserId: async uid => {
            calls.push(['getVendorByUserId', uid]);
            if (options.unavailable) return { data: null, error: null, unavailable: true };
            return { data: uid === user.id ? (options.vendor || null) : null, error: null };
        },
        completeRegistration: async profile => {
            calls.push(['rpc', 'complete_supply_vendor_registration', profile]);
            return options.rpcError ? { data: null, error: options.rpcError } : { data: vendorRow, error: null };
        }
    };
    const window = {
        location: { pathname: options.pathname || '/supplies/register', search: options.search || '', hash: options.hash || '', origin: 'https://weotzi.com', href: '' },
        WeotziData: { getClient: () => client, Supplies },
        ConfigManager: { ready: async () => { calls.push(['ready']); } }
    };
    const statusEl = { hidden: true, className: '', textContent: '' };
    const document = { addEventListener() {}, getElementById: id => (id === 'dashboard-status' || id === 'login-status' ? statusEl : null) };
    vm.runInNewContext(authSource, { window, document, URLSearchParams, console: { error() {}, warn() {} } });
    return { auth: window.WeOtziSuppliesAuth, window, calls, statusEl };
}

const profile = {
    name: 'Tinta Sur', currency: 'ARS', platform_discount_pct: 10, benefits: ['Envío en 24 h'],
    private: { legal_name: 'Tinta Sur SRL', tax_id: '30-12345678-9' }
};

test('alta sin sesión: signUp con user_type supplies y borrador sin email ni contraseña', async () => {
    const h = authHarness();
    const result = await h.auth.register({ ...profile, email: user.email, password: 'clave-segura' });
    assert.equal(result.confirmationRequired, true);
    const signup = h.calls.find(call => call[0] === 'signup')[1];
    assert.equal(signup.options.data.user_type, 'supplies');
    const draft = signup.options.data.supplies_registration;
    assert.equal(draft.name, 'Tinta Sur');
    assert.equal(draft.password, undefined);
    assert.equal(draft.email, undefined);
    assert.deepEqual(plain(draft.private), { legal_name: 'Tinta Sur SRL', tax_id: '30-12345678-9' });
    assert.equal(signup.options.emailRedirectTo, 'https://weotzi.com/supplies/login?confirmed=1');
    assert.equal(h.calls.some(call => call[0] === 'rpc'), false, 'sin sesión no se escribe en la base');
});

test('sin la migración M5 no se crea ninguna cuenta (handle_new_user crearía un artista)', async () => {
    const h = authHarness({ unavailable: true });
    await assert.rejects(h.auth.register({ ...profile, email: user.email, password: 'clave-segura' }), /falta aplicar una migración/);
    assert.equal(h.calls.some(call => call[0] === 'signup'), false);
    assert.equal(await h.auth.isAvailable(), false);
});

test('el borrador solo lleva la lista blanca del perfil', () => {
    const h = authHarness();
    const draft = h.auth.sanitizeDraft({ name: 'X', email: 'a@b.c', password: 'secreto', is_verified: true, user_id: 'otro', slug: 'x', tax_id: '20-1' });
    assert.deepEqual(Object.keys(draft).sort(), ['name', 'private']);
    assert.deepEqual(plain(draft.private), { tax_id: '20-1' });
});

test('con sesión confirmada y borrador, completa el registro una vez y limpia la metadata', async () => {
    const session = { user: { ...user, user_metadata: { supplies_registration: { name: 'Tinta Sur', currency: 'ARS' } } } };
    const h = authHarness({ pathname: '/supplies/login', search: '?confirmed=1', session });
    const vendor = await h.auth.check();
    assert.equal(vendor.id, vendorRow.id);
    assert.equal(h.auth.getCurrent().id, vendorRow.id);
    const rpc = h.calls.filter(call => call[0] === 'rpc');
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0][2].name, 'Tinta Sur');
    assert.equal(h.calls.at(-1)[0], 'updateUser');
    assert.equal(h.calls.at(-1)[1].data.supplies_registration, null);
    assert.equal(h.window.location.href, '/supplies/dashboard');
});

test('si la RPC falla, el borrador queda para reintentar', async () => {
    const h = authHarness({ session: { user }, rpcError: { message: 'Base no disponible' } });
    await assert.rejects(h.auth.register({ ...profile, email: user.email }), { message: 'Base no disponible' });
    assert.equal(h.calls.some(call => call[0] === 'updateUser'), false);
});

test('el panel sin sesión va al login; con sesión y sin tienda, al registro', async () => {
    const anon = authHarness({ pathname: '/supplies/dashboard' });
    await anon.auth.check();
    assert.equal(anon.window.location.href, '/supplies/login');
    const noVendor = authHarness({ pathname: '/supplies/dashboard', session: { user } });
    await noVendor.auth.check();
    assert.equal(noVendor.window.location.href, '/supplies/register?complete=1');
    const withVendor = authHarness({ pathname: '/supplies/dashboard', session: { user }, vendor: vendorRow });
    assert.equal((await withVendor.auth.check()).id, vendorRow.id);
    assert.equal(withVendor.window.location.href, '');
});

test('migración pendiente en el panel: mensaje claro y sin redirigir en loop', async () => {
    const h = authHarness({ pathname: '/supplies/dashboard', session: { user }, unavailable: true });
    assert.equal(await h.auth.check(), null);
    assert.equal(h.window.location.href, '');
    assert.equal(h.auth.isUnavailable(), true);
    assert.equal(h.statusEl.hidden, false);
    assert.match(h.statusEl.textContent, /falta aplicar una migración/);
});

test('otra cuenta abierta no puede quedarse con el registro', async () => {
    const h = authHarness({ session: { user } });
    await assert.rejects(h.auth.register({ ...profile, email: 'otro@insumos.test' }), /otra cuenta abierta/);
    assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
});

test('el prefijo /beta sobrevive a confirmación, recuperación y redirecciones', async () => {
    const h = authHarness({ pathname: '/beta/supplies/register' });
    await h.auth.register({ ...profile, email: user.email, password: 'clave-segura' });
    await h.auth.requestPasswordReset(user.email);
    assert.equal(h.calls.find(call => call[0] === 'signup')[1].options.emailRedirectTo, 'https://weotzi.com/beta/supplies/login?confirmed=1');
    assert.equal(h.calls.find(call => call[0] === 'reset')[2].redirectTo, 'https://weotzi.com/beta/supplies/login?recovery=1');
    assert.equal(h.auth.appUrl('/supplies/dashboard'), '/beta/supplies/dashboard');
});

test('recuperación: no redirige la sesión y exige sesión para cambiar la contraseña', async () => {
    const h = authHarness({ pathname: '/supplies/login', search: '?recovery=1', session: { user }, vendor: vendorRow });
    await h.auth.check();
    assert.equal(h.auth.isRecovery(), true);
    assert.equal(h.window.location.href, '');
    await h.auth.changePassword('clave-nueva-1');
    assert.equal(h.calls.at(-1)[1].password, 'clave-nueva-1');
    const expired = authHarness();
    await assert.rejects(expired.auth.changePassword('clave-nueva-1'), /enlace venció/);
    await expired.auth.verifyRecoveryCode(user.email, ' 123456 ');
    assert.equal(expired.calls.find(call => call[0] === 'verifyOtp')[1].token, '123456');
});

test('login de una cuenta sin tienda Supplies explica cómo seguir', async () => {
    const h = authHarness({ pathname: '/supplies/login', session: { user } });
    await assert.rejects(h.auth.login(user.email, 'clave-segura'), /Registrar tu tienda/);
});

// ---------------------------------------------------------------
// supplies-register.js (helpers puros)
// ---------------------------------------------------------------
test('wizard: valida cada paso con mensajes en español', () => {
    assert.match(Register.validateStep(1, { email: 'mal' }), /email/);
    assert.match(Register.validateStep(1, { email: 'a@b.co', password: 'corta' }), /8 caracteres/);
    assert.match(Register.validateStep(1, { email: 'a@b.co', password: 'clave-larga', passwordConfirm: 'otra-clave' }), /no coinciden/);
    assert.equal(Register.validateStep(1, { email: 'a@b.co' }, { hasSession: true }), null);
    assert.match(Register.validateStep(2, { name: 'X' }), /entre 2 y 160/);
    assert.match(Register.validateStep(2, { name: 'Tinta Sur', website: 'javascript:alert(1)' }), /http/);
    assert.equal(Register.validateStep(2, { name: 'Tinta Sur', website: 'https://tintasur.com' }), null);
    assert.match(Register.validateStep(3, { currency: 'ARS', discount: '75' }), /entre 0 y 60/);
    assert.match(Register.validateStep(3, { currency: 'ARS', discount: '10', shipsTo: 'Argentina' }), /2 letras/);
    assert.match(Register.validateStep(3, { currency: 'ARS', leadTime: '2.5' }), /días enteros/);
    assert.match(Register.validateStep(3, { currency: 'ARS', benefits: Array.from({ length: 11 }, (_, i) => 'b' + i) }), /hasta 10/);
    assert.equal(Register.validateStep(3, { currency: 'ARS', discount: '12,5', minOrder: '1.500,50', shipsTo: 'ar, uy', leadTime: '3' }), null);
});

test('wizard: arma el perfil de complete_supply_vendor_registration', () => {
    const payload = Register.buildPayload({
        email: ' ventas@insumos.test ', password: 'clave-segura', name: ' Tinta Sur ', description: '',
        currency: 'usd', discount: '12,5', minOrder: '1.500,50', freeShipping: '', leadTime: '3',
        shipsTo: 'ar, uy AR', benefits: [' Envío en 24 h ', ''], legalName: 'Tinta Sur SRL', taxId: '', billingEmail: 'fact@insumos.test'
    });
    assert.equal(payload.email, 'ventas@insumos.test');
    assert.equal(payload.name, 'Tinta Sur');
    assert.equal(payload.currency, 'USD');
    assert.equal(payload.platform_discount_pct, 12.5);
    assert.equal(payload.min_order_amount, 1500.5);
    assert.equal('free_shipping_threshold' in payload, false);
    assert.equal('description' in payload, false);
    assert.equal(payload.lead_time_days, 3);
    assert.deepEqual(payload.ships_to_countries, ['AR', 'UY']);
    assert.deepEqual(payload.benefits, ['Envío en 24 h']);
    assert.deepEqual(payload.private, { legal_name: 'Tinta Sur SRL', billing_email: 'fact@insumos.test' });
});

// ---------------------------------------------------------------
// supplies-dashboard.js (helpers puros y acciones de pedido)
// ---------------------------------------------------------------
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

test('acciones del proveedor por estado (máquina de vendor_update_supply_order)', () => {
    assert.deepEqual(Dashboard.orderActions('submitted'), ['confirm', 'reject']);
    assert.deepEqual(Dashboard.orderActions('confirmed'), ['ship', 'cancel']);
    assert.deepEqual(Dashboard.orderActions('shipped'), ['deliver']);
    for (const status of ['delivered', 'received', 'rejected', 'cancelled', 'raro']) {
        assert.deepEqual(Dashboard.orderActions(status), [], status);
    }
});

test('cada acción avisa con un kind que /api/supplies/notify acepta', () => {
    const server = read('server.js');
    const block = server.slice(server.indexOf('const SUPPLY_NOTIFY_STATUS'), server.indexOf('};', server.indexOf('const SUPPLY_NOTIFY_STATUS')));
    const vendorSide = server.slice(server.indexOf('const SUPPLY_VENDOR_SIDE_KINDS'), server.indexOf(';', server.indexOf('const SUPPLY_VENDOR_SIDE_KINDS')));
    assert.equal(Dashboard.NOTIFY_PATH, '/api/supplies/notify');
    for (const [action, kind] of Object.entries(Dashboard.ACTION_KIND)) {
        assert.match(kind, /^order_/);
        assert.match(block, new RegExp('\\b' + kind + ':'), action + ' → ' + kind + ' no figura en SUPPLY_NOTIFY_STATUS');
        if (action !== 'cancel') assert.match(vendorSide, new RegExp("'" + kind + "'"), kind + ' debería ser del lado del vendor');
    }
    assert.deepEqual(Object.keys(Dashboard.ACTION_KIND).sort(), ['cancel', 'confirm', 'deliver', 'reject', 'ship']);
});

test('runOrderAction: primero la RPC, después postNotify {kind, order_id}', async () => {
    const calls = [];
    const env = {
        client: { id: 'client' },
        data: { Supplies: { vendorUpdateOrder: async (...args) => { calls.push(['rpc', ...args]); return { data: { order_id: ORDER_ID, status: 'confirmed' }, error: null }; } } },
        kit: { unwrap: Kit.unwrap, postNotify: async (...args) => { calls.push(['notify', ...args]); return { ok: true, sent: true }; } }
    };
    const result = await Dashboard.runOrderAction(env, ORDER_ID, 'confirm', { shippingAmount: 1500, estimatedDelivery: '2026-11-05', note: 'Sale mañana' });
    assert.equal(result.order.status, 'confirmed');
    assert.deepEqual(calls.map(c => c[0]), ['rpc', 'notify']);
    assert.deepEqual(calls[0].slice(1), [ORDER_ID, 'confirm', { shippingAmount: 1500, estimatedDelivery: '2026-11-05', note: 'Sale mañana' }]);
    assert.deepEqual(calls[1].slice(1), ['/api/supplies/notify', { kind: 'order_confirmed', order_id: ORDER_ID }, env.client]);
    for (const [action, kind] of [['reject', 'order_rejected'], ['ship', 'order_shipped'], ['deliver', 'order_delivered'], ['cancel', 'order_cancelled']]) {
        calls.length = 0;
        await Dashboard.runOrderAction(env, ORDER_ID, action, {});
        assert.deepEqual(calls[1][2], { kind, order_id: ORDER_ID });
    }
});

test('runOrderAction: si la RPC falla no se avisa a nadie y el error conserva el código', async () => {
    const calls = [];
    const env = {
        data: { Supplies: { vendorUpdateOrder: async () => ({ data: null, error: { code: '23514', message: 'Stock insuficiente para Tinta negra.' } }) } },
        kit: { unwrap: Kit.unwrap, postNotify: async (...args) => { calls.push(args); return { ok: true }; } }
    };
    await assert.rejects(Dashboard.runOrderAction(env, ORDER_ID, 'confirm', {}), err => err.code === '23514' && /Stock insuficiente/.test(err.message));
    assert.equal(calls.length, 0);
    await assert.rejects(Dashboard.runOrderAction(env, ORDER_ID, 'borrar', {}), /Acción inválida/);
    await assert.rejects(Dashboard.runOrderAction(env, 'no-uuid', 'confirm', {}), /Pedido inválido/);
});

test('envío gratis y avisos de stock usan la misma regla que el servidor', () => {
    const vendor = { free_shipping_threshold: 100000 };
    assert.equal(Dashboard.freeShippingApplies({ subtotal: 120000, discount_amount: 20000 }, vendor), true);
    assert.equal(Dashboard.freeShippingApplies({ subtotal: 120000, discount_amount: 20000.01 }, vendor), false);
    assert.equal(Dashboard.freeShippingApplies({ subtotal: 999999, discount_amount: 0 }, { free_shipping_threshold: null }), false);
    const order = { supply_order_items: [
        { product_id: 'a', product_name: 'Tinta negra', quantity: 5 },
        { product_id: 'b', product_name: 'Guantes', quantity: 2 },
        { product_id: 'c', product_name: 'Film', quantity: 9 }
    ] };
    const warnings = Dashboard.stockWarnings(order, { a: { stock_quantity: 3 }, b: { stock_quantity: null }, c: { stock_quantity: 9 } });
    assert.deepEqual(warnings, [{ name: 'Tinta negra', stock: 3, quantity: 5 }]);
});

test('filtros de pedidos por estado y búsqueda', () => {
    const orders = [
        { id: '1', status: 'submitted', order_number: 'P-2026-00001', studios: { name: 'Bang Bang', city: 'CABA' } },
        { id: '2', status: 'confirmed', order_number: 'P-2026-00002', studios: { name: 'Lobo Tattoo', city: 'Rosario' } },
        { id: '3', status: 'submitted', order_number: 'P-2026-00003', studios: { name: 'Lobo Tattoo' }, tracking_code: 'OCA-9' }
    ];
    assert.deepEqual(Dashboard.filterOrders(orders, { status: 'submitted' }).map(o => o.id), ['1', '3']);
    assert.deepEqual(Dashboard.filterOrders(orders, { status: 'all', query: 'lobo' }).map(o => o.id), ['2', '3']);
    assert.deepEqual(Dashboard.filterOrders(orders, { query: 'oca-9' }).map(o => o.id), ['3']);
    assert.deepEqual(Dashboard.countByStatus(orders), { all: 3, submitted: 2, confirmed: 1 });
});

test('producto: valida, normaliza números y bloquea URLs que no son http(s)', () => {
    const vendor = { currency: 'ARS' };
    const bad = Dashboard.validateProduct({ name: '', category: 'nada', price: '-1', image_url: 'javascript:alert(1)', track_stock: true, stock_quantity: '' }, vendor);
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['category', 'image_url', 'name', 'price', 'stock_quantity']);
    const good = Dashboard.validateProduct({
        name: ' Cartuchos RL 0.35 ', category: 'needles_cartridges', price: '12.345,6', pack_size: 20, sku: '', unit_label: 'caja',
        min_order_qty: null, track_stock: false, stock_quantity: 10, image_url: 'https://cdn.test/img.webp'
    }, vendor);
    assert.equal(good.ok, true);
    assert.equal(good.payload.name, 'Cartuchos RL 0.35');
    assert.equal(good.payload.price, 12345.6);
    assert.equal(good.payload.sku, null);
    assert.equal(good.payload.stock_quantity, null, 'sin control de stock se guarda null');
    assert.equal(good.payload.min_order_qty, 1);
    assert.equal(good.payload.currency, 'ARS');
    assert.equal(good.payload.image_url, 'https://cdn.test/img.webp');
});

test('escalones: monto repetido, rango y aviso de tope del 60%', () => {
    const vendor = { currency: 'ARS', platform_discount_pct: 50 };
    const tiers = [{ id: 't1', min_subtotal: 100000, discount_pct: 5 }];
    assert.match(Dashboard.validateTier({ min_subtotal: '100000', discount_pct: '5' }, tiers, vendor, null).errors.min_subtotal, /Ya tenés/);
    assert.equal(Dashboard.validateTier({ min_subtotal: '100000', discount_pct: '6' }, tiers, vendor, 't1').ok, true, 'editar el mismo escalón no choca');
    assert.match(Dashboard.validateTier({ min_subtotal: '1', discount_pct: '61' }, [], vendor, null).errors.discount_pct, /hasta 60/);
    const capped = Dashboard.validateTier({ min_subtotal: '200000', discount_pct: '15' }, tiers, vendor, null);
    assert.equal(capped.ok, true);
    assert.match(capped.warnings[0], /60%/);
    assert.equal(capped.payload.currency, 'ARS');
});

test('condiciones y perfil: límites del esquema y perfil completo', () => {
    assert.match(Dashboard.validateConditions({ platform_discount_pct: '61' }).errors.platform_discount_pct, /entre 0 y 60/);
    const conditions = Dashboard.validateConditions({ platform_discount_pct: '', min_order_amount: '5000', free_shipping_threshold: '', benefits: [' A ', '', 'B'] });
    assert.deepEqual(conditions.payload, { platform_discount_pct: 0, min_order_amount: 5000, free_shipping_threshold: null, benefits: ['A', 'B'] });
    const profileBad = Dashboard.validateProfile({ name: 'T', website: 'ftp://x', ships_to_countries: 'Argentina', lead_time_days: 400 });
    assert.deepEqual(Object.keys(profileBad.errors).sort(), ['lead_time_days', 'name', 'ships_to_countries', 'website']);
    const profileGood = Dashboard.validateProfile({
        name: 'Tinta Sur', description: 'Insumos', logo_image: 'https://cdn.test/logo.png', phone: '+54 11', country: 'Argentina',
        ships_to_countries: 'ar,uy', lead_time_days: 2
    });
    assert.equal(profileGood.ok, true);
    assert.deepEqual(profileGood.payload.ships_to_countries, ['AR', 'UY']);
    assert.equal(profileGood.payload.profile_complete, true);
    assert.equal('currency' in profileGood.payload, false, 'la moneda bloqueada no se envía');
    assert.match(Dashboard.validatePrivate({ billing_email: 'no-es-mail' }).errors.billing_email, /facturación/);
});

test('clientes: una fila por estudio con totales por moneda (nunca sumados entre monedas)', () => {
    const rows = Dashboard.aggregateCustomers([
        { studio_id: 's1', studio_name: 'Bang Bang', orders: 2, last_order_at: '2026-10-01T10:00:00Z', currency: 'ARS', total: 1000.1 },
        { studio_id: 's1', studio_name: 'Bang Bang', orders: 1, last_order_at: '2026-10-20T10:00:00Z', currency: 'USD', total: 50 },
        { studio_id: 's2', studio_name: 'Lobo', orders: 1, last_order_at: '2026-09-01T10:00:00Z', currency: 'ARS', total: 0.2 }
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].studio_id, 's1');
    assert.equal(rows[0].orders, 3);
    assert.equal(rows[0].last_order_at, '2026-10-20T10:00:00Z');
    assert.deepEqual(rows[0].totals, { ARS: 1000.1, USD: 50 });
    assert.deepEqual(rows[1].totals, { ARS: 0.2 });
});

test('reportes: resumen de ventas y top productos solo de pedidos vendidos', () => {
    const sum = Dashboard.salesSummary([
        { month: '2026-09-01', currency: 'ARS', orders: 2, units: 10, gross: 1000, discounts: 100, shipping: 50, net: 950 },
        { month: '2026-10-01', currency: 'ARS', orders: 1, units: 2.5, gross: 0.1, discounts: 0, shipping: 0, net: 0.2 },
        { month: '2026-10-01', currency: 'USD', orders: 1, units: 1, gross: 10, discounts: 1, shipping: 0, net: 9 }
    ]);
    assert.equal(sum.orders, 4);
    assert.equal(sum.units, 13.5);
    assert.deepEqual(sum.net, { ARS: 950.2, USD: 9 });
    const top = Dashboard.aggregateTopProducts([
        { id: 'o1', status: 'received', currency: 'ARS', supply_order_items: [{ product_id: 'p1', product_name: 'Tinta', quantity: 3, line_total: 300 }, { product_id: 'p2', product_name: 'Guantes', quantity: 10, line_total: 100 }] },
        { id: 'o2', status: 'confirmed', currency: 'ARS', supply_order_items: [{ product_id: 'p1', product_name: 'Tinta', quantity: 8, line_total: 800 }] },
        { id: 'o3', status: 'cancelled', currency: 'ARS', supply_order_items: [{ product_id: 'p2', product_name: 'Guantes', quantity: 99, line_total: 990 }] },
        { id: 'o4', status: 'submitted', currency: 'ARS', supply_order_items: [{ product_id: 'p2', product_name: 'Guantes', quantity: 99, line_total: 990 }] }
    ], 10);
    assert.deepEqual(top.map(t => [t.product_id, t.units, t.orders]), [['p1', 11, 2], ['p2', 10, 1]]);
    assert.deepEqual(top[0].totals, { ARS: 1100 });
});

test('checklist de la tienda apunta a la pestaña que la completa', () => {
    const items = Dashboard.profileChecklist({ name: 'T', logo_image: 'https://x/l.png', description: 'd', benefits: [] }, [{ is_active: false }]);
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    assert.equal(byId.identity.done, true);
    assert.equal(byId.catalog.done, false);
    assert.equal(byId.catalog.tab, 'catalogo');
    assert.equal(byId.benefits.done, false);
    for (const item of items) assert.ok(Dashboard.TABS.includes(item.tab));
});

// ---------------------------------------------------------------
// Markup y convenciones
// ---------------------------------------------------------------
const pages = {
    register: { html: read('public/supplies/register/index.html'), script: 'supplies-register.js' },
    login: { html: read('public/supplies/login/index.html'), script: null },
    dashboard: { html: read('public/supplies/dashboard/index.html'), script: 'supplies-dashboard.js' }
};

test('las tres páginas siguen la estructura y el stack CSS del contrato', () => {
    for (const [name, page] of Object.entries(pages)) {
        const { html } = page;
        assert.match(html, /<body data-theme="light">\s*<div class="studio-page supplies-page[^"]*">/, name);
        const css = [...html.matchAll(/<link rel="stylesheet" href="(\/shared\/css\/[^"]+)">/g)].map(m => m[1]);
        assert.deepEqual(css, ['/shared/css/styles.css', '/shared/css/studio.css', '/shared/css/studio-admin-kit.css', '/shared/css/supplies.css'], name);
        assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, name);
        const scripts = [...html.matchAll(/<script src="\/shared\/js\/([^"]+)"/g)].map(m => m[1]).filter(s => s !== 'support-loader.js');
        const expected = ['config-manager.js', 'data/postgrest-client.js', 'data/supplies-repo.js', 'studio-admin-kit.js']
            .concat(name === 'dashboard' ? ['weotzi-uploader.js'] : [])
            .concat(['supplies-auth.js'])
            .concat(page.script ? [page.script] : []);
        assert.deepEqual(scripts, expected, name);
        assert.match(html, /<html lang="es">/);
    }
});

test('el panel tiene las 8 pestañas del contrato, cada una con su panel y su root', () => {
    const html = pages.dashboard.html;
    const tabs = [...html.matchAll(/class="studio-dash-tab[^"]*" data-tab="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual(tabs, ['inicio', 'pedidos', 'catalogo', 'beneficios', 'clientes', 'reportes', 'perfil', 'cuenta']);
    assert.deepEqual(tabs, Dashboard.TABS);
    const labels = [...html.matchAll(/data-tab="[a-z]+"[^>]*><span class="dot"><\/span> ([^<]+)<\/a>/g)].map(m => m[1].trim());
    assert.deepEqual(labels, ['Inicio', 'Pedidos', 'Catálogo', 'Beneficios', 'Clientes', 'Reportes', 'Perfil', 'Cuenta']);
    for (const tab of tabs) {
        const start = html.indexOf('data-panel="' + tab + '"');
        assert.ok(start > 0, 'falta el panel ' + tab);
        const end = html.indexOf('</section>', start);
        assert.match(html.slice(start, end), /data-module-root/, 'el panel ' + tab + ' no tiene [data-module-root]');
    }
    assert.match(html, /class="studio-page supplies-page supplies-dashboard"/);
});

test('el registro es un wizard de 3 pasos: cuenta, negocio y comercial', () => {
    const html = pages.register.html;
    const steps = [...html.matchAll(/class="studio-wizard-pill[^"]*" data-step="(\d)">([^<]+)</g)].map(m => m[2].trim());
    assert.deepEqual(steps, ['1 · Cuenta', '2 · Negocio', '3 · Comercial']);
    assert.equal(Register.TOTAL_STEPS, 3);
    assert.match(html, /en revisión hasta que el equipo de We Ötzi la verifique/);
});

test('el login ofrece recuperación por enlace y por código', () => {
    const html = pages.login.html;
    assert.match(html, /id="supplies-recovery-form"/);
    assert.match(html, /auth\.requestPasswordReset\(email\)/);
    assert.match(html, /auth\.verifyRecoveryCode\(/);
    assert.match(html, /auth\.isRecovery\(\)/);
});

test('acceso a datos solo por WeotziData.Supplies; imágenes a supply-photos/<vendor_id>', () => {
    const files = ['supplies-auth.js', 'supplies-register.js', 'supplies-dashboard.js'].map(f => read('public/shared/js/' + f));
    for (const src of files.concat(Object.values(pages).map(p => p.html))) {
        assert.doesNotMatch(src, /_supabase\.from\(|\.from\(['"]supply_|fetch\(\s*['"`][^'"`]*\/rest\/v1/);
    }
    const dashboard = files[2];
    assert.equal(Dashboard.PHOTO_BUCKET, 'supply-photos');
    assert.match(dashboard, /WeOtziUploader\.attach\(imageInput, \{\s*supabase: S\.client,\s*bucket: PHOTO_BUCKET,\s*pathPrefix: S\.vendor\.id/);
    assert.match(dashboard, /uploader\.attach\(input, \{ supabase: S\.client, bucket: PHOTO_BUCKET, pathPrefix: S\.vendor\.id/);
    // Toda acción de pedido pasa por runOrderAction (RPC + postNotify).
    assert.equal((dashboard.match(/vendorUpdateOrder\(/g) || []).length, 1);
    assert.match(dashboard, /kit\.postNotify\(NOTIFY_PATH, \{ kind, order_id: orderId \}, client\)/);
});

test('las interpolaciones de datos en el panel pasan por escape o safeUrl', () => {
    const dashboard = read('public/shared/js/supplies-dashboard.js');
    // src/href armados con datos: siempre detrás de httpUrl → kit.safeUrl.
    for (const m of dashboard.matchAll(/(src|href)="' \+ ([^+]+?) \+ '"/g)) {
        assert.match(m[2], /^ha\((src|logo|item\.tab|httpUrl)/, 'atributo sin sanitizar: ' + m[0]);
    }
    assert.doesNotMatch(dashboard, /innerHTML = [^;]*\$\{/, 'sin template literals crudos en innerHTML');
});

// ---------------------------------------------------------------
// Contratos de API: lo que llaman los scripts existe en el kit, el repo
// y los diccionarios (un nombre mal escrito rompe solo en el navegador).
// ---------------------------------------------------------------
const repoSource = read('public/shared/js/data/supplies-repo.js');
const RepoNode = require('../public/shared/js/data/supplies-repo.js');
const dashboardSource = read('public/shared/js/supplies-dashboard.js');
const registerSource = read('public/shared/js/supplies-register.js');

function loadRepoApi() {
    const window = { WeotziData: { from() { return {}; }, getClient() { return {}; } } };
    vm.runInNewContext(repoSource, { window, console: { error() {}, warn() {} } });
    return window.WeotziData.Supplies;
}

test('los scripts solo usan funciones del kit y métodos de WeotziData.Supplies que existen', () => {
    const repo = loadRepoApi();
    assert.ok(repo, 'supplies-repo.js no expuso WeotziData.Supplies');
    const kitNames = new Set([...dashboardSource.matchAll(/\bK\(\)\.(\w+)/g)].map(m => m[1]));
    for (const m of registerSource.matchAll(/\b(?:k|kit)\.(\w+)/g)) kitNames.add(m[1]);
    for (const m of authSource.matchAll(/\bkit\?\.(\w+)/g)) kitNames.add(m[1]);
    assert.ok(kitNames.size > 30, 'el regex no encontró llamadas al kit');
    for (const name of kitNames) assert.ok(name in Kit, 'WeOtziStudioKit.' + name + ' no existe');

    const repoNames = new Set([...dashboardSource.matchAll(/\bSup\(\)\.(\w+)/g)].map(m => m[1]));
    for (const m of dashboardSource.matchAll(/\bSupplies\.(\w+)\(/g)) repoNames.add(m[1]);
    for (const m of authSource.matchAll(/\brepo\(\)\.(\w+)/g)) repoNames.add(m[1]);
    assert.ok(repoNames.size > 10, 'el regex no encontró llamadas al repo');
    for (const name of repoNames) assert.equal(typeof repo[name], 'function', 'WeotziData.Supplies.' + name + ' no existe');

    const uploader = read('public/shared/js/weotzi-uploader.js');
    assert.match(uploader, /function attach\(input, options\)/);
    assert.match(uploader, /^\s+attach,$/m);
});

test('los diccionarios de etiquetas que usa el panel existen y cubren el esquema de M5', () => {
    const dicts = new Set();
    for (const re of [/\blabel\('(\w+)'/g, /statusBadge\('(\w+)'/g, /optionsHtml\('(\w+)'/g, /\bbadge: '(\w+)'/g]) {
        for (const m of dashboardSource.matchAll(re)) dicts.add(m[1]);
    }
    assert.deepEqual([...dicts].sort(), ['periodPreset', 'supplyActorRole', 'supplyCategory', 'supplyOrderStatus', 'vendorStatus']);
    for (const name of dicts) assert.ok(Kit.LABELS[name], 'LABELS.' + name + ' no existe');
    // Las mismas categorías y estados que los CHECK de la migración M5.
    const m5 = read('supabase/migrations/20261030204000_supplies_marketplace.sql');
    const quoted = s => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    const catStart = m5.indexOf('category text not null check (category in (');
    assert.ok(catStart > 0, 'no encontré el CHECK de categorías en M5');
    const categories = quoted(m5.slice(catStart, m5.indexOf(')),', catStart)));
    assert.deepEqual(Object.keys(Kit.LABELS.supplyCategory), categories);
    const statusStart = m5.indexOf("'submitted', 'confirmed', 'rejected'");
    assert.ok(statusStart > 0, 'no encontré el CHECK de estados de pedido en M5');
    const statuses = quoted(m5.slice(statusStart, m5.indexOf('\n', statusStart)));
    assert.deepEqual(Object.keys(Kit.LABELS.supplyOrderStatus).sort(), statuses.sort());
});

// ---------------------------------------------------------------
// Panel completo en una VM: DOM mínimo + kit real + repo falso
// ---------------------------------------------------------------
const VENDOR_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_2 = '44444444-4444-4444-8444-444444444444';
const flush = async (n = 25) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

function fakeNode(selector) {
    return {
        selector, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, className: '',
        dataset: {}, attrs: {}, listeners: {}, kids: new Map(),
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelector(sel) { if (!this.kids.has(sel)) this.kids.set(sel, fakeNode(sel)); return this.kids.get(sel); },
        querySelectorAll() { return []; },
        appendChild(child) { return child; },
        contains() { return true; },
        closest() { return null; },
        focus() {}
    };
}

function dashboardHarness(options = {}) {
    const calls = [];
    const now = new Date().toISOString();
    const vendor = Object.assign({
        id: VENDOR_ID, name: 'Tinta <Sur>', slug: 'tinta-sur-33333333', email: 'ventas@insumos.test', currency: 'ARS',
        is_verified: false, is_active: true, platform_discount_pct: 10, benefits: ['Envío en 24 h'],
        free_shipping_threshold: 100000, min_order_amount: 5000, country: 'Argentina', city: 'CABA', ships_to_countries: ['AR']
    }, options.vendor || {});
    const orders = [
        { id: ORDER_ID, order_number: 'P-2026-00001', status: 'submitted', currency: 'ARS', subtotal: 120000, discount_amount: 12000, shipping_amount: 0, total: 108000, submitted_at: now, studios: { name: 'Bang <Bang>', city: 'CABA' } },
        { id: ORDER_2, order_number: 'P-2026-00002', status: 'received', currency: 'ARS', subtotal: 30000, discount_amount: 3000, shipping_amount: 1500, total: 28500, submitted_at: now, confirmed_at: now, studios: { name: 'Lobo Tattoo', city: 'Rosario' } }
    ];
    const items = [{ id: 'i1', product_id: 'p1', product_name: 'Tinta negra', sku: 'TN-1', quantity: 5, unit_label: 'frasco', unit_price: 6000, line_discount: 600, line_total: 5400 }];
    const products = [
        { id: 'p1', name: 'Tinta negra', brand: 'Dynamic', sku: 'TN-1', category: 'inks', price: 6000, currency: 'ARS', stock_quantity: 3, min_order_qty: 1, unit_label: 'frasco', is_active: true },
        { id: 'p2', name: 'Guantes viejos', category: 'gloves', price: 100, currency: 'ARS', stock_quantity: null, min_order_qty: 1, unit_label: 'caja', is_active: false }
    ];
    const month = now.slice(0, 7) + '-01';
    const result = (name, value) => async (...args) => {
        calls.push([name, ...args]);
        return { data: typeof value === 'function' ? value(...args) : value, error: null };
    };
    const Supplies = {
        listOrdersForVendor: result('listOrdersForVendor', () => orders),
        listProducts: result('listProducts', () => products),
        listTiers: result('listTiers', () => [{ id: 't1', vendor_id: VENDOR_ID, min_subtotal: 200000, discount_pct: 5, currency: 'ARS', label: 'Mayorista' }]),
        getOrder: result('getOrder', id => Object.assign({}, orders.find(o => o.id === id), { supply_order_items: items, supply_order_events: [] })),
        vendorSalesMonthly: result('vendorSalesMonthly', () => [{ vendor_id: VENDOR_ID, month, currency: 'ARS', orders: 1, units: 5, gross: 30000, discounts: 3000, shipping: 1500, net: 28500 }]),
        vendorCustomers: result('vendorCustomers', () => [{ vendor_id: VENDOR_ID, studio_id: 's1', studio_name: 'Bang <Bang>', orders: 1, last_order_at: now, currency: 'ARS', total: 28500 }]),
        getVendorPrivate: result('getVendorPrivate', () => ({ vendor_id: VENDOR_ID, legal_name: 'Tinta Sur <SRL>' })),
        estimateOrder: RepoNode.estimateOrder
    };
    const client = { auth: { getSession: async () => ({ data: { session: { user: { email: vendor.email } } } }) } };
    const auth = {
        ready: async () => { calls.push(['ready']); return client; },
        getCurrent: () => null,
        check: async () => (options.unavailable ? null : vendor),
        isUnavailable: () => !!options.unavailable,
        remember() {},
        changePassword: async () => {},
        logout: async () => {}
    };
    const nodes = new Map();
    const node = sel => { if (!nodes.has(sel)) nodes.set(sel, fakeNode(sel)); return nodes.get(sel); };
    const root = tab => node('.studio-dash-panel[data-panel="' + tab + '"]').querySelector('[data-module-root]');
    Dashboard.TABS.forEach(tab => { root(tab).innerHTML = '<p class="studio-help" data-module-loading>Cargando…</p>'; });
    const document = {
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelector: sel => (sel === '.supplies-dashboard' && options.noShell ? null : node(sel)),
        querySelectorAll: sel => (sel === '.studio-dash-panel [data-module-root]' ? Dashboard.TABS.map(root) : []),
        getElementById: id => node('#' + id),
        createElement: tag => fakeNode(tag)
    };
    const window = {
        document,
        history: { state: null, replaceState(state, title, url) { calls.push(['replaceState', url]); } },
        location: { pathname: '/supplies/dashboard', search: options.search || '', hash: options.hash || '' },
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        WeOtziStudioKit: Kit,
        WeotziData: { Supplies },
        WeOtziSuppliesAuth: auth
    };
    vm.runInNewContext(dashboardSource, { window, URLSearchParams, console: { error() {}, warn() {}, log() {} } });
    const api = window.WeOtziSuppliesDashboard;
    return {
        api, calls, window, vendor, root, node,
        boot: async () => { await api.boot(); await flush(); },
        goTo: async tab => {
            window.location.hash = '#' + tab;
            (window.listeners.hashchange || []).forEach(fn => fn());
            await flush();
        }
    };
}

test('panel: arranca en Inicio con el aviso de revisión, KPIs y pedidos por confirmar escapados', async () => {
    const h = dashboardHarness();
    assert.equal(typeof h.window.document.listeners.DOMContentLoaded[0], 'function', 'el panel arranca en DOMContentLoaded');
    await h.boot();
    const html = h.root('inicio').innerHTML;
    assert.match(html, /Tu cuenta está en revisión: los estudios todavía no ven tu catálogo/);
    assert.match(html, /Completá tu tienda/);
    assert.match(html, /Por confirmar/);
    assert.match(html, /P-2026-00001/);
    assert.match(html, /Bang &lt;Bang&gt;/);
    assert.doesNotMatch(html, /Bang <Bang>/);
    assert.doesNotMatch(html, /studio-status-error/);
    assert.match(h.node('#vendor-name-display').innerHTML, /Tinta &lt;Sur&gt;/);
    assert.equal(h.node('#vendor-status-label').textContent, 'En revisión');
    assert.equal(h.node('.studio-dash-tab[data-tab="pedidos"]').querySelector('.sk-tab-badge').textContent, '1');
    const sales = h.calls.find(c => c[0] === 'vendorSalesMonthly');
    assert.equal(sales[1], VENDOR_ID);
    assert.match(sales[2], /^\d{4}-\d{2}-01$/);
    assert.ok(h.calls.some(c => c[0] === 'listOrdersForVendor' && c[1] === VENDOR_ID));
    assert.ok(h.calls.some(c => c[0] === 'listProducts' && c[1] === VENDOR_ID && c[2].includeInactive === true));
});

test('panel: cada pestaña se arma con el kit real, sin errores y con los datos escapados', async () => {
    const h = dashboardHarness();
    await h.boot();
    const noError = tab => assert.doesNotMatch(h.root(tab).innerHTML, /studio-status-error/, tab);

    await h.goTo('pedidos');
    noError('pedidos');
    const table = h.root('pedidos').querySelector('[data-orders-table]').innerHTML;
    assert.match(table, /P-2026-00001/);
    assert.match(table, /P-2026-00002/);
    assert.match(table, /Solicitado/);
    assert.match(h.root('pedidos').querySelector('[data-order-chips]').innerHTML, /Por confirmar <span class="sk-chip-count">1<\/span>/);

    await h.goTo('catalogo');
    noError('catalogo');
    const products = h.root('catalogo').querySelector('[data-products-table]').innerHTML;
    assert.match(products, /Tinta negra/);
    assert.doesNotMatch(products, /Guantes viejos/, 'los archivados se ocultan por defecto');
    assert.equal(h.root('catalogo').querySelector('[data-catalog-summary]').textContent, '1 producto activo · 1 archivados · precios en ARS');

    await h.goTo('beneficios');
    noError('beneficios');
    assert.match(h.root('beneficios').innerHTML, /Condiciones para estudios/);
    assert.match(h.root('beneficios').querySelector('[data-tiers]').innerHTML, /Mayorista/);
    const preview = h.root('beneficios').querySelector('[data-preview]').innerHTML;
    assert.match(preview, /We Ötzi/);
    assert.match(preview, /Envío en 24 h/);
    assert.match(preview, /Tinta &lt;Sur&gt;/);
    assert.match(h.root('beneficios').querySelector('[data-sim-result]').textContent, /Escribí un subtotal/);

    await h.goTo('clientes');
    noError('clientes');
    assert.match(h.root('clientes').innerHTML, /Estudios clientes/);
    assert.match(h.root('clientes').innerHTML, /Bang &lt;Bang&gt;/);

    await h.goTo('reportes');
    noError('reportes');
    assert.match(h.root('reportes').querySelector('[data-report-body]').innerHTML, /Ventas netas/);
    assert.match(h.root('reportes').querySelector('[data-top-products]').innerHTML, /Tinta negra/);
    assert.ok(h.calls.some(c => c[0] === 'getOrder' && c[1] === ORDER_2), 'top productos lee las líneas de los pedidos vendidos');
    assert.equal(h.calls.some(c => c[0] === 'getOrder' && c[1] === ORDER_ID), false, 'un pedido sin confirmar no cuenta como venta');

    await h.goTo('perfil');
    noError('perfil');
    assert.match(h.root('perfil').innerHTML, /Perfil público/);
    assert.match(h.root('perfil').innerHTML, /Tinta Sur &lt;SRL&gt;/);
    assert.match(h.root('perfil').innerHTML, /Para cambiar la moneda escribinos a soporte/, 'con productos cargados la moneda queda fija');

    await h.goTo('cuenta');
    noError('cuenta');
    assert.match(h.root('cuenta').innerHTML, /En revisión/);
    assert.equal(h.node('#account-email').textContent, 'ventas@insumos.test');
});

test('panel: cuenta verificada sin aviso de revisión; desactivada con su aviso', async () => {
    const verified = dashboardHarness({ vendor: { is_verified: true } });
    await verified.boot();
    assert.doesNotMatch(verified.root('inicio').innerHTML, /en revisión/i);
    const inactive = dashboardHarness({ vendor: { is_verified: true, is_active: false } });
    await inactive.boot();
    assert.match(inactive.root('inicio').innerHTML, /Tu cuenta está desactivada/);
});

test('panel: el enlace ?pedido=<id> abre Pedidos y saca el parámetro de la URL', async () => {
    const h = dashboardHarness({ search: '?pedido=' + ORDER_ID + '&utm=mail' });
    await h.boot();
    assert.match(h.root('pedidos').querySelector('[data-orders-table]').innerHTML, /P-2026-00001/);
    assert.equal(h.calls.filter(c => c[0] === 'replaceState').at(-1)[1], '/supplies/dashboard?utm=mail#pedidos');
    assert.equal(h.root('inicio').innerHTML, '<p class="studio-help" data-module-loading>Cargando…</p>', 'Inicio no se renderizó');
});

test('panel: con la migración pendiente no consulta nada y deja los paneles vacíos', async () => {
    const h = dashboardHarness({ unavailable: true });
    await h.boot();
    for (const tab of Dashboard.TABS) assert.equal(h.root(tab).innerHTML, '', tab);
    assert.deepEqual(h.calls.map(c => c[0]), ['ready']);
    const outside = dashboardHarness({ noShell: true });
    await outside.boot();
    assert.deepEqual(outside.calls, [], 'fuera del panel no arranca');
});

test('drawer de pedido: notas y productos escapados, envío gratis y acciones por estado', async () => {
    const h = dashboardHarness();
    await h.boot();
    const base = {
        id: ORDER_ID, order_number: 'P-2026-00001', status: 'submitted', currency: 'ARS', subtotal: 120000, discount_amount: 12000,
        platform_discount_pct: 10, tier_discount_pct: 0, shipping_amount: 0, total: 108000, submitted_at: '2026-10-29T12:00:00Z',
        notes: '<img src=x onerror=alert(1)>', studios: { name: 'Bang', city: 'CABA' }, studio_locations: { label: 'Sede <Centro>' },
        supply_order_items: [{ product_name: '<b>Tinta</b>', quantity: 2, received_quantity: 1, unit_price: 100, line_discount: 10, line_total: 190, unit_label: 'frasco' }],
        supply_order_events: [{ created_at: '2026-10-29T12:00:00Z', from_status: null, to_status: 'submitted', actor_role: 'studio', note: '<i>urgente</i>' }]
    };
    const html = h.api.orderDetailHtml(base);
    assert.doesNotMatch(html, /<img src=x|<b>Tinta|<i>urgente/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;b&gt;Tinta&lt;\/b&gt;/);
    assert.match(html, /Sede &lt;Centro&gt;/);
    assert.match(html, /Gratis \(supera/, '108.000 neto supera el umbral de 100.000');
    assert.doesNotMatch(html, /Faltante/, 'sin recibir no hay columna de recibido');
    const received = h.api.orderDetailHtml(Object.assign({}, base, { status: 'received', shipping_amount: 1500 }));
    assert.match(received, /Faltante/);
    assert.doesNotMatch(received, /Gratis \(supera/);

    const buttons = status => [...h.api.actionButtonsHtml({ status }).matchAll(/data-order-action="(\w+)"/g)].map(m => m[1]).sort();
    assert.deepEqual(buttons('submitted'), ['confirm', 'reject']);
    assert.deepEqual(buttons('confirmed'), ['cancel', 'ship']);
    assert.deepEqual(buttons('shipped'), ['deliver']);
    assert.deepEqual(buttons('delivered'), []);
    assert.match(h.api.actionButtonsHtml({ status: 'delivered' }), /Esperando que el estudio confirme la recepción/);
});

test('helpers: montos con coma decimal, países ISO-2 y resumen del wizard', () => {
    assert.equal(Dashboard.parseAmount('1.234,50'), 1234.5);
    assert.equal(Dashboard.parseAmount(12), 12);
    assert.equal(Dashboard.parseAmount(''), null);
    assert.ok(Number.isNaN(Dashboard.parseAmount('doce')));
    assert.deepEqual(plain(Dashboard.parseCountries(['ar', 'UY', 'ar', 'Uruguay'])), { items: ['AR', 'UY'], invalid: ['Uruguay'] });
    assert.equal(Register.toAmount('1.234,5'), 1234.5);
    assert.equal(Register.toAmount(''), null);
    assert.equal(Register.toAmount('abc'), undefined);
    assert.deepEqual(plain(Register.parseCountries('ar; UY  ar, Chile')), { items: ['AR', 'UY'], invalid: ['Chile'] });
    const rows = Object.fromEntries(Register.summaryRows({
        name: 'Tinta Sur', email: 'a@b.co', city: 'CABA', country: 'Argentina', currency: 'ars', discount: '10',
        minOrder: '', freeShipping: '100000', shipsTo: '', benefits: ['A', ' ', 'B']
    }, Kit.fmtMoney));
    assert.equal(rows['Moneda'], 'ARS');
    assert.equal(rows['Ubicación'], 'CABA, Argentina');
    assert.equal(rows['Descuento We Ötzi'], '10 %');
    assert.equal(rows['Compra mínima'], 'Sin mínimo');
    assert.equal(rows['Envío gratis desde'], Kit.fmtMoney(100000, 'ARS'));
    assert.equal(rows['Envíos a'], 'Todos los países');
    assert.equal(rows['Beneficios'], '2');
});
