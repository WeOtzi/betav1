'use strict';

// ===========================================================================
// Store · registro de adaptadores de pago
// ---------------------------------------------------------------------------
// Cada proveedor es un adaptador con esta interfaz:
//   {
//     id,                       // 'manual' | 'stripe' | 'mercado_pago' (igual al check de store_orders.payment_provider)
//     label,                    // nombre visible
//     isConfigured() -> bool,   // claves cargadas en el entorno
//     createCheckout(order) -> { mode, instructions?, redirectUrl? },
//     parseWebhook?(rawBody, headers) -> null | { kind: 'payment_succeeded', orderId, reference, amount, currency },
//     verifyWebhook?(rawBody, headers) -> bool,   // HMAC con crypto.timingSafeEqual
//   }
// Si el adaptador recibe webhooks (`parseWebhook`), `verifyWebhook` es
// obligatorio: el endpoint nunca parsea un cuerpo sin verificar la firma.
// v1 solo trae `manual` (el vendedor o soporte confirma el pago desde la UI; no
// tiene webhook). Stripe y Mercado Pago se enchufan con registerProvider.
// ===========================================================================

const crypto = require('node:crypto');

const PROVIDER_IDS = Object.freeze(['manual', 'stripe', 'mercado_pago']);

function interfaceError(message) {
    const e = new TypeError(`[store-payments] ${message}`);
    e.code = 'INVALID_PROVIDER';
    return e;
}

function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') throw interfaceError('El adaptador tiene que ser un objeto.');
    if (!PROVIDER_IDS.includes(adapter.id)) {
        throw interfaceError(`id no soportado: ${String(adapter.id)}. Valores válidos: ${PROVIDER_IDS.join(', ')}.`);
    }
    if (typeof adapter.label !== 'string' || !adapter.label.trim()) throw interfaceError(`${adapter.id}: falta label.`);
    if (typeof adapter.isConfigured !== 'function') throw interfaceError(`${adapter.id}: falta isConfigured().`);
    if (typeof adapter.createCheckout !== 'function') throw interfaceError(`${adapter.id}: falta createCheckout(order).`);
    if (adapter.parseWebhook != null && typeof adapter.parseWebhook !== 'function') {
        throw interfaceError(`${adapter.id}: parseWebhook tiene que ser una función.`);
    }
    if (adapter.verifyWebhook != null && typeof adapter.verifyWebhook !== 'function') {
        throw interfaceError(`${adapter.id}: verifyWebhook tiene que ser una función.`);
    }
    if (adapter.parseWebhook && !adapter.verifyWebhook) {
        throw interfaceError(`${adapter.id}: un adaptador con parseWebhook necesita verifyWebhook(rawBody, headers).`);
    }
}

// Registro aislado (los tests crean el suyo; el server usa el default).
function createRegistry() {
    const providers = new Map();

    function registerProvider(adapter, { replace = false } = {}) {
        validateAdapter(adapter);
        if (providers.has(adapter.id) && !replace) {
            throw interfaceError(`${adapter.id}: ya hay un adaptador registrado con ese id.`);
        }
        const frozen = Object.freeze({ ...adapter });
        providers.set(adapter.id, frozen);
        return frozen;
    }

    function getProvider(id) {
        return typeof id === 'string' && providers.has(id) ? providers.get(id) : null;
    }

    // Resumen sin funciones: apto para mostrar o loguear.
    function listProviders() {
        return [...providers.values()].map((p) => ({
            id: p.id,
            label: p.label,
            configured: isProviderConfigured(p),
            webhooks: typeof p.parseWebhook === 'function',
        }));
    }

    return { registerProvider, getProvider, listProviders };
}

// isConfigured() de un adaptador nunca tumba un request: si lanza, cuenta como no configurado.
function isProviderConfigured(provider) {
    try { return Boolean(provider && provider.isConfigured()); } catch { return false; }
}

// Helper para adaptadores reales: compara la firma HMAC del cuerpo crudo en
// tiempo constante. `signature` llega en `encoding` (hex por defecto).
function verifyHmacSignature({ rawBody, signature, secret, algorithm = 'sha256', encoding = 'hex' } = {}) {
    if (!secret || typeof signature !== 'string' || !signature.trim()) return false;
    if (!Buffer.isBuffer(rawBody)) return false;
    let expected;
    let given;
    try {
        expected = crypto.createHmac(algorithm, secret).update(rawBody).digest();
        given = Buffer.from(signature.trim(), encoding);
    } catch {
        return false;
    }
    if (given.length !== expected.length) return false;
    return crypto.timingSafeEqual(given, expected);
}

// Adaptador `manual`: el comprador paga por fuera siguiendo las instrucciones
// (snapshot en el pedido) y el vendedor o soporte confirma. Sin webhook.
const manualProvider = {
    id: 'manual',
    label: 'Pago manual',
    isConfigured: () => true,
    createCheckout(order) {
        return {
            mode: 'manual',
            instructions: (order && typeof order.payment_instructions === 'string') ? order.payment_instructions : '',
        };
    },
};

const defaultRegistry = createRegistry();
defaultRegistry.registerProvider(manualProvider);

module.exports = {
    PROVIDER_IDS,
    createRegistry,
    validateAdapter,
    isProviderConfigured,
    verifyHmacSignature,
    manualProvider,
    defaultRegistry,
    registerProvider: defaultRegistry.registerProvider,
    getProvider: defaultRegistry.getProvider,
    listProviders: defaultRegistry.listProviders,
};
