'use strict';

// ===========================================================================
// Repositorio de la Store (servidor) sobre la capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Lo usan los endpoints de services/store-orders.js: descargas firmadas de
// licencias, checkout delegado al adaptador de pagos, mantenimiento por cron y
// webhook de proveedores. Todo corre con service-role (salta RLS): la
// autorizacion (titular/comprador, token de cron, firma del webhook) la hacen
// los handlers ANTES de llamar a estos metodos. Selects siempre explicitos.
//
// Las escrituras de negocio (pagos, mantenimiento) van por RPC, nunca por
// PATCH directo: el SQL es la unica fuente de las reglas de estado y wallet.
// La unica escritura directa es `store_download_events`, que es un log que
// escribe solo el servidor (alta y, si se paso del tope, baja de la propia fila).
// ===========================================================================

const { pgrest } = require('../postgrest');

const STORE_SERVER_SELECTS = Object.freeze({
    order: 'id,order_number,seller_type,seller_id,channel,buyer_user_id,status,fulfillment_method,currency,total_amount,payment_provider,expected_collector,payment_instructions,seller_contact,expires_at,created_at',
    orderItem: 'id,order_id,product_id,variant_id,kind,title,variant_label,license_tier,unit_price,quantity,line_total',
    license: 'id,order_id,order_item_id,product_id,tier,holder_user_id,revoked_at,used_at',
    licenseOrder: 'id,buyer_user_id',
    asset: 'id,product_id,kind,storage_path,file_name,mime_type',
});

const StoreRepo = {
    // Pedido + sus items (v1: un item por pedido). Devuelve null si no existe.
    async getOrderWithItems(id) {
        const order = await pgrest('store_orders')
            .select(STORE_SERVER_SELECTS.order)
            .eq('id', id).limit(1).single().execute();
        if (!order) return null;
        const items = await pgrest('store_order_items')
            .select(STORE_SERVER_SELECTS.orderItem)
            .eq('order_id', id)
            .order('created_at', { ascending: true })
            .execute();
        return { ...order, items: Array.isArray(items) ? items : [] };
    },

    // Licencia visible para `userId`: es el titular (`holder_user_id`) o el
    // comprador del pedido que la emitio. Devuelve la licencia con
    // `access: 'holder'|'buyer'`, o null si no existe o no le pertenece (el
    // endpoint responde 403 en ambos casos, sin revelar si existe).
    async getLicenseForHolder(licenseId, userId) {
        if (!licenseId || !userId) return null;
        const license = await pgrest('store_licenses')
            .select(STORE_SERVER_SELECTS.license)
            .eq('id', licenseId).limit(1).single().execute();
        if (!license) return null;
        if (license.holder_user_id && license.holder_user_id === userId) {
            return { ...license, access: 'holder' };
        }
        if (!license.order_id) return null;
        const order = await pgrest('store_orders')
            .select(STORE_SERVER_SELECTS.licenseOrder)
            .eq('id', license.order_id).limit(1).single().execute();
        if (order && order.buyer_user_id && order.buyer_user_id === userId) {
            return { ...license, access: 'buyer' };
        }
        return null;
    },

    getAsset(assetId) {
        return pgrest('store_design_assets')
            .select(STORE_SERVER_SELECTS.asset)
            .eq('id', assetId).limit(1).single().execute();
    },

    // Descargas de la licencia desde `since` (ISO). El handler pasa la ventana
    // movil de 24 h; sin `since`, cuenta las ultimas 24 h desde ahora. Usa el
    // total de Content-Range; si no viene, cae al largo de las filas leidas
    // (limit = tope + 1, alcanza para decidir el 429).
    async countDownloadsToday(licenseId, { since, cap = 50 } = {}) {
        const from = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { rows, count } = await pgrest('store_download_events')
            .select('id')
            .eq('license_id', licenseId)
            .gte('created_at', from)
            .limit(cap + 1)
            .count('exact')
            .execute();
        if (Number.isFinite(count)) return count;
        return Array.isArray(rows) ? rows.length : 0;
    },

    // Devuelve { id } de la fila insertada (o null): el handler la borra si,
    // contada junto con las demas, pasa el tope diario.
    async insertDownloadEvent({ licenseId, assetId, userId }) {
        const rows = await pgrest('store_download_events').select('id').insert({
            license_id: licenseId,
            asset_id: assetId,
            user_id: userId,
        }, { returning: true });
        const row = Array.isArray(rows) ? rows[0] : rows;
        return row && row.id ? { id: row.id } : null;
    },

    deleteDownloadEvent(id) {
        return pgrest('store_download_events').eq('id', id).delete();
    },

    // RPC de servicio: devuelve {expired, flagged, delivered, released, failed:[ids]}.
    runMaintenance() {
        return pgrest.raw('rpc/run_store_maintenance', { method: 'POST', body: {} });
    },

    // RPC de servicio: confirma el pago informado por un proveedor real. Monto
    // y moneda tienen que coincidir con el pedido (lo valida el SQL).
    confirmProviderPayment({ orderId, provider, reference, amount, currency }) {
        return pgrest.raw('rpc/confirm_store_order_payment_as_provider', {
            method: 'POST',
            body: {
                p_order_id: orderId,
                p_provider: provider,
                p_reference: reference,
                p_amount: amount,
                p_currency: currency,
            },
        });
    },
};

// Extrae el codigo `store:<codigo>` de un error de PostgREST/RPC (o null).
function storeErrorCode(err) {
    const text = String((err && (err.message || err)) || '');
    const match = text.match(/store:([a-z_]+)/);
    return match ? match[1] : null;
}

module.exports = { StoreRepo, STORE_SERVER_SELECTS, storeErrorCode };
