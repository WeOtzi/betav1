'use strict';

// ===========================================================================
// Repositorio de Supplies (servidor) — sobre la capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Tablas: supply_vendors, supply_orders, supply_order_items (embebida),
// supply_order_events, studios / studio_locations (embebidas en el pedido).
//
// Usado por POST /api/supplies/notify, la deteccion de rol, el reset de
// contraseña (userType 'supplies') y el backoffice de vendors.
//
// Reglas:
//   - El destinatario de un aviso es SIEMPRE el email de auth.users del dueño
//     del vendor (supply_vendors.user_id). Nunca supply_vendors.contact_email.
//   - service-role (salta RLS): la autorizacion la hace el endpoint antes.
//   - Las tablas nacen en M5 (sin aplicar): el llamador degrada con
//     `isMissingSchemaError` de ./studios.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { getAuthUserContact } = require('./studios');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_PARTIES_SELECT = [
    '*',
    'studios(id,name,slug,user_id)',
    'supply_vendors(id,name,slug,user_id,currency)',
    'studio_locations(id,label,city)',
    'supply_order_items(id,product_name,quantity,received_quantity,unit_label,line_total)',
].join(',');

const VENDOR_ADMIN_SELECT = [
    'id', 'user_id', 'email', 'name', 'slug', 'country', 'city', 'currency',
    'platform_discount_pct', 'is_verified', 'is_active', 'profile_complete',
    'logo_image', 'created_at', 'updated_at',
].join(',');

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

const SuppliesRepo = {
    // Pedido con estudio, vendor, sede e items.
    getOrderWithParties(id) {
        return pgrest('supply_orders').select(ORDER_PARTIES_SELECT).eq('id', id).limit(1).single().execute();
    },

    // Ultimo evento del pedido hacia `toStatus` (quien cancelo, etc.).
    getLatestOrderEvent(orderId, toStatus) {
        return pgrest('supply_order_events')
            .select('id,from_status,to_status,actor_user_id,actor_role,note,created_at')
            .eq('order_id', orderId)
            .eq('to_status', toStatus)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
            .execute();
    },

    // Email de auth.users del dueño del vendor, o null si no tiene dueño.
    async getVendorOwnerContact(vendorId) {
        if (!isUuid(vendorId)) return null;
        const vendor = await pgrest('supply_vendors')
            .select('id,name,slug,user_id')
            .eq('id', vendorId)
            .limit(1)
            .single()
            .execute();
        if (!vendor || !vendor.user_id) return null;
        const user = await getAuthUserContact(vendor.user_id);
        if (!user || !user.email) return null;
        return {
            vendor_id: vendor.id,
            vendor_name: vendor.name || '',
            vendor_slug: vendor.slug || '',
            user_id: vendor.user_id,
            email: user.email,
            name: user.full_name || vendor.name || '',
        };
    },

    getVendorByUserId(uid) {
        if (!isUuid(uid)) return Promise.resolve(null);
        return pgrest('supply_vendors')
            .select('id,name,slug,user_id,is_verified,is_active')
            .eq('user_id', uid)
            .limit(1)
            .single()
            .execute();
    },

    // Vendors por email de login (supply_vendors.email, unico en minusculas).
    // Devuelve hasta 2 filas para que el llamador detecte ambiguedad.
    listVendorsByLoginEmail(email) {
        return pgrest('supply_vendors')
            .select('id,user_id,email')
            .eq('email', String(email || '').trim().toLowerCase())
            .limit(2)
            .execute();
    },

    // ---- backoffice ---------------------------------------------------------

    listVendors() {
        return pgrest('supply_vendors').select(VENDOR_ADMIN_SELECT).order('created_at', { ascending: false }).limit(500).execute();
    },

    // Solo is_verified / is_active (el endpoint filtra el resto).
    async updateVendorFlags(id, patch) {
        const rows = await pgrest('supply_vendors').eq('id', id).patch(patch);
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },
};

module.exports = { SuppliesRepo };
