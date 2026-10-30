'use strict';

// ===========================================================================
// Store · endpoints del servidor
// ---------------------------------------------------------------------------
//   POST /api/store/licenses/:licenseId/assets/:assetId/url  descarga firmada (300 s)
//   POST /api/store/orders/:id/checkout                      delega al adaptador de pago
//   POST /api/store/maintenance                              cron (X-Cron-Token)
//   POST /api/store/payments/webhook/:provider               webhook con body crudo
//
// Handlers puros con `deps` inyectables (resolveUser, repo, providers, now,
// env, sign) para testearlos sin red. Responden { success, error } con
// mensajes en español; los 500 son genéricos y el detalle queda en el log.
// Las reglas de negocio (estados, wallet, licencias) viven en las RPC del SQL:
// acá solo se autoriza, se valida la forma y se delega.
// ===========================================================================

const crypto = require('node:crypto');
const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const { StoreRepo, storeErrorCode } = require('../lib/repos/store');
const { signStorageObject } = require('../lib/storage-sign');
const storePayments = require('./store-payments');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOWNLOAD_BUCKET = 'store-design-files';
const DOWNLOAD_EXPIRES_IN = 300; // fijo: el cliente no lo elige
const DOWNLOAD_DAILY_LIMIT = 50;
const DOWNLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const STORE_WEBHOOK_PREFIX = '/api/store/payments/webhook/';

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function send(res, status, body) {
    return res.status(status).json(body);
}

function fail(res, status, error) {
    return send(res, status, { success: false, error });
}

function noStore(res) {
    if (res && typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
}

// Comparación en tiempo constante: se hashean los dos lados para igualar el
// largo antes de timingSafeEqual (así tampoco se filtra el largo del token).
function safeTokenEqual(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
    const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

// Para el `skip` de apiLimiter: montado en app.use('/api/', ...), baseUrl es
// '/api' y path el resto ('/store/payments/webhook/<provider>').
function isStoreWebhookRequest(req) {
    const path = `${(req && req.baseUrl) || ''}${(req && req.path) || ''}`;
    return path.startsWith(STORE_WEBHOOK_PREFIX);
}

function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

// Lo que ve el adaptador: sin ids de usuario ni datos que no necesita.
function checkoutOrder(order) {
    return {
        id: order.id,
        order_number: order.order_number,
        currency: order.currency,
        total_amount: order.total_amount,
        payment_instructions: order.payment_instructions || '',
        seller_contact: order.seller_contact || '',
        expires_at: order.expires_at || null,
        items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
            kind: item.kind,
            title: item.title,
            variant_label: item.variant_label || null,
            license_tier: item.license_tier || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
        })),
    };
}

// La respuesta del adaptador se valida antes de devolverla: modo conocido por
// forma y, si redirige, solo a https (nada de javascript: ni http:).
function normalizeCheckout(result) {
    if (!result || typeof result !== 'object') return null;
    if (typeof result.mode !== 'string' || !/^[a-z_]{1,32}$/.test(result.mode)) return null;
    const checkout = { mode: result.mode };
    if (result.instructions != null) checkout.instructions = String(result.instructions).slice(0, 4000);
    if (result.redirectUrl != null) {
        if (!isHttpsUrl(result.redirectUrl)) return null;
        checkout.redirectUrl = result.redirectUrl;
    }
    if (checkout.mode === 'redirect' && !checkout.redirectUrl) return null;
    return checkout;
}

// Evento de pago que devuelve parseWebhook: { kind, orderId, reference, amount, currency }.
function normalizePaymentEvent(event) {
    const orderId = event.orderId;
    const reference = typeof event.reference === 'string' ? event.reference.trim() : '';
    const amount = Number(event.amount);
    const currency = typeof event.currency === 'string' ? event.currency.trim().toUpperCase() : '';
    if (!isUuid(orderId)) return null;
    if (!reference || reference.length > 200) return null;
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) return null;
    if (!/^[A-Z]{3}$/.test(currency)) return null;
    return { orderId, reference, amount, currency };
}

function createHandlers(deps = {}) {
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const repo = deps.repo || StoreRepo;
    const providers = deps.providers || storePayments.defaultRegistry;
    const now = typeof deps.now === 'function' ? deps.now : () => new Date();
    const env = deps.env || process.env;
    const sign = deps.sign || signStorageObject;
    const log = deps.logger || console;

    function nowMs() {
        const value = now();
        return value instanceof Date ? value.getTime() : Number(value);
    }

    function isExpired(expiresAt) {
        if (!expiresAt) return false;
        const at = Date.parse(expiresAt);
        return Number.isFinite(at) && at <= nowMs();
    }

    // POST /api/store/licenses/:licenseId/assets/:assetId/url
    async function handleDownloadUrl(req, res) {
        noStore(res);
        try {
            const user = await resolveUser(req);
            if (!user || !user.id) return fail(res, 401, 'Iniciá sesión para descargar tus archivos.');

            const { licenseId, assetId } = req.params || {};
            if (!isUuid(licenseId) || !isUuid(assetId)) return fail(res, 400, 'El enlace de descarga no es válido.');

            // Titular o comprador del pedido; si no existe o es ajena, 403 sin distinguir.
            const license = await repo.getLicenseForHolder(licenseId, user.id);
            if (!license) return fail(res, 403, 'No tenés acceso a esta licencia.');
            if (license.revoked_at) return fail(res, 410, 'Esta licencia fue revocada y sus archivos ya no se pueden descargar.');

            const asset = await repo.getAsset(assetId);
            if (!asset || !asset.storage_path || !license.product_id || asset.product_id !== license.product_id) {
                return fail(res, 404, 'No encontramos ese archivo en tu licencia.');
            }

            // Ventana móvil de 24 h. Si el conteo no es un número, se corta (falla cerrado).
            const since = new Date(nowMs() - DOWNLOAD_WINDOW_MS).toISOString();
            const countOpts = { since, cap: DOWNLOAD_DAILY_LIMIT };
            const limitReached = () => fail(res, 429, `Llegaste al tope de ${DOWNLOAD_DAILY_LIMIT} descargas por día para esta licencia. Probá de nuevo mañana.`);
            const used = Number(await repo.countDownloadsToday(licenseId, countOpts));
            if (!(used < DOWNLOAD_DAILY_LIMIT)) return limitReached();

            // Registro primero y recuento después, incluyendo la fila propia: con
            // requests en paralelo cada una ve las que se insertaron antes que
            // ella, así que nunca pasan más de 50. Si se pasa, borra su fila y
            // responde 429 (ante una ráfaga justo en el tope puede rechazar de
            // más, nunca de menos).
            const event = await repo.insertDownloadEvent({ licenseId, assetId, userId: user.id });
            const total = Number(await repo.countDownloadsToday(licenseId, countOpts));
            if (!(total <= DOWNLOAD_DAILY_LIMIT)) {
                if (event && event.id) {
                    try { await repo.deleteDownloadEvent(event.id); }
                    catch (e) { log.error('[store] download event rollback failed:', e && e.message); }
                }
                return limitReached();
            }

            const url = await sign(DOWNLOAD_BUCKET, asset.storage_path, {
                expiresIn: DOWNLOAD_EXPIRES_IN,
                download: asset.file_name || true,
            });
            return send(res, 200, { success: true, url, expires_in: DOWNLOAD_EXPIRES_IN });
        } catch (e) {
            log.error('[store] download url failed:', e && e.message);
            return fail(res, 500, 'No pudimos preparar la descarga. Intentá de nuevo en unos minutos.');
        }
    }

    // POST /api/store/orders/:id/checkout
    async function handleCheckout(req, res) {
        noStore(res);
        try {
            const user = await resolveUser(req);
            if (!user || !user.id) return fail(res, 401, 'Iniciá sesión para pagar tu pedido.');

            const orderId = req.params && req.params.id;
            if (!isUuid(orderId)) return fail(res, 400, 'El pedido no es válido.');

            const order = await repo.getOrderWithItems(orderId);
            if (!order || !order.buyer_user_id || order.buyer_user_id !== user.id) {
                return fail(res, 404, 'No encontramos ese pedido.');
            }
            if (order.status !== 'pending_payment' || isExpired(order.expires_at)) {
                return fail(res, 409, 'Este pedido ya no admite pagos.');
            }

            const provider = providers.getProvider(order.payment_provider || 'manual');
            if (!provider || !storePayments.isProviderConfigured(provider)) {
                return fail(res, 503, 'Ese medio de pago no está disponible por ahora.');
            }

            const checkout = normalizeCheckout(await provider.createCheckout(checkoutOrder(order)));
            if (!checkout) {
                log.error('[store] checkout: respuesta inválida del adaptador', provider.id);
                return fail(res, 502, 'No pudimos iniciar el pago. Intentá de nuevo.');
            }
            return send(res, 200, { success: true, checkout });
        } catch (e) {
            log.error('[store] checkout failed:', e && e.message);
            return fail(res, 500, 'No pudimos iniciar el pago. Intentá de nuevo.');
        }
    }

    // POST /api/store/maintenance (job de n8n, cada hora)
    async function handleMaintenance(req, res) {
        noStore(res);
        const expected = env.CRON_API_TOKEN;
        if (typeof expected !== 'string' || !expected.trim()) {
            return fail(res, 503, 'El mantenimiento de la Store no está configurado.');
        }
        const provided = req.headers && req.headers['x-cron-token'];
        if (!safeTokenEqual(provided, expected)) return fail(res, 401, 'El token de cron no es válido.');
        try {
            const result = await repo.runMaintenance();
            return send(res, 200, { success: true, result: result || null });
        } catch (e) {
            log.error('[store] maintenance failed:', e && e.message);
            return fail(res, 500, 'No pudimos correr el mantenimiento de la Store.');
        }
    }

    // POST /api/store/payments/webhook/:provider (body crudo: express.raw)
    async function handleWebhook(req, res) {
        noStore(res);
        const providerId = req.params && req.params.provider;
        const provider = typeof providerId === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(providerId)
            ? providers.getProvider(providerId)
            : null;
        if (!provider || typeof provider.parseWebhook !== 'function' || typeof provider.verifyWebhook !== 'function') {
            return fail(res, 404, 'No encontramos ese proveedor de pagos.');
        }
        if (!storePayments.isProviderConfigured(provider)) {
            return fail(res, 503, 'Ese proveedor de pagos no está configurado.');
        }
        const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
        if (!rawBody || !rawBody.length) return fail(res, 400, 'El aviso de pago llegó vacío.');
        const headers = req.headers || {};

        // 1) Firma sobre los bytes exactos. Cualquier cosa distinta de `true` es rechazo.
        let verified = false;
        try { verified = (await provider.verifyWebhook(rawBody, headers)) === true; } catch { verified = false; }
        if (!verified) return fail(res, 401, 'La firma del aviso de pago no es válida.');

        // 2) Parseo: un cuerpo ilegible es 400 (reintentar no lo arregla).
        let event;
        try {
            event = await provider.parseWebhook(rawBody, headers);
        } catch (e) {
            log.error('[store] webhook parse failed:', provider.id, e && e.message);
            return fail(res, 400, 'No pudimos leer el aviso de pago.');
        }
        if (!event || event.kind !== 'payment_succeeded') return send(res, 200, { success: true, ignored: true });
        const payment = normalizePaymentEvent(event);
        if (!payment) return fail(res, 400, 'El aviso de pago no es válido.');

        // 3) Confirmación por RPC de servicio (idempotente por referencia).
        try {
            await repo.confirmProviderPayment({ ...payment, provider: provider.id });
            return send(res, 200, { success: true });
        } catch (e) {
            const code = storeErrorCode(e);
            log.error('[store] webhook confirm failed:', provider.id, code || (e && e.message));
            if (code) return fail(res, 422, 'No pudimos aplicar el pago a ese pedido.');
            return fail(res, 500, 'No pudimos procesar el aviso de pago.');
        }
    }

    return { handleDownloadUrl, handleCheckout, handleMaintenance, handleWebhook };
}

const defaultHandlers = createHandlers();

module.exports = {
    createHandlers,
    handleDownloadUrl: defaultHandlers.handleDownloadUrl,
    handleCheckout: defaultHandlers.handleCheckout,
    handleMaintenance: defaultHandlers.handleMaintenance,
    handleWebhook: defaultHandlers.handleWebhook,
    isStoreWebhookRequest,
    safeTokenEqual,
    normalizeCheckout,
    normalizePaymentEvent,
    STORE_WEBHOOK_PREFIX,
    DOWNLOAD_BUCKET,
    DOWNLOAD_EXPIRES_IN,
    DOWNLOAD_DAILY_LIMIT,
    UUID_RE,
};
