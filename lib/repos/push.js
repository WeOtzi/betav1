'use strict';

// ── push ──
// Repositorio del frente "push" (servidor, service-role vía lib/postgrest.js):
//   - push_subscriptions: suscripciones Web Push por navegador;
//   - user_notifications: avisos del usuario (in-app + dedupe del push);
//   - búsqueda del user_id de un destinatario por email según su rol.
// Migración 20261116170000_push_notifications.sql.

const { pgrest } = require('../postgrest');

const SUBSCRIPTION_COLUMNS = 'id,user_id,endpoint,p256dh,auth,failure_count';
const ROLE_TABLES = { artist: 'artists_db', client: 'clients_db', studio: 'studios' };
// Una cuenta con demasiados navegadores suscriptos no puede frenar el envío.
const MAX_SUBSCRIPTIONS_PER_USER = 12;

// ilike sin comodines: % y _ se escapan para que un email no matchee a otro.
function exactIlike(value) {
    return String(value || '').trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

function isConflict(error) {
    return !!error && (error.status === 409 || /23505/.test(String(error.message || '')));
}

const PushRepo = {
    MAX_SUBSCRIPTIONS_PER_USER,

    listSubscriptions(userId) {
        return pgrest('push_subscriptions').select(SUBSCRIPTION_COLUMNS)
            .eq('user_id', userId).order('updated_at', { ascending: false })
            .limit(MAX_SUBSCRIPTIONS_PER_USER).execute();
    },

    // Un endpoint pertenece a un solo usuario: si otro inicia sesión en el
    // mismo navegador, la fila pasa a ser suya (y deja de avisarle al anterior).
    async upsertSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
        const rows = await pgrest('push_subscriptions').upsert({
            user_id: userId, endpoint, p256dh, auth,
            user_agent: userAgent || null,
            failure_count: 0,
            updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });
        return Array.isArray(rows) ? rows[0] || null : null;
    },

    async countSubscriptions(userId) {
        const { count } = await pgrest('push_subscriptions').select('id').eq('user_id', userId).count().range(0, 0).execute();
        return Number(count) || 0;
    },

    async deleteOldestSubscriptions(userId, keep) {
        const rows = await pgrest('push_subscriptions').select('id').eq('user_id', userId)
            .order('updated_at', { ascending: false }).limit(200).execute();
        const extra = (rows || []).slice(keep).map(row => row.id);
        if (extra.length) await pgrest('push_subscriptions').in('id', extra).delete();
        return extra.length;
    },

    deleteByEndpoint(endpoint, userId) {
        let query = pgrest('push_subscriptions').eq('endpoint', endpoint);
        if (userId) query = query.eq('user_id', userId);
        return query.delete({ returning: true });
    },

    deleteById(id) {
        return pgrest('push_subscriptions').eq('id', id).delete();
    },

    markSuccess(id) {
        const now = new Date().toISOString();
        return pgrest('push_subscriptions').eq('id', id)
            .patch({ last_success_at: now, failure_count: 0, updated_at: now }, { returning: false });
    },

    markFailure(id, failureCount) {
        return pgrest('push_subscriptions').eq('id', id)
            .patch({ failure_count: Math.max(0, Number(failureCount) || 0) + 1 }, { returning: false });
    },

    // Rotación de la suscripción (pushsubscriptionchange): solo el navegador
    // que tenía la suscripción anterior (conoce su endpoint Y su secreto
    // `auth`, que nunca sale hacia el servicio push) puede reemplazarla.
    async replaceEndpoint(oldEndpoint, oldAuth, next) {
        const rows = await pgrest('push_subscriptions').eq('endpoint', oldEndpoint).eq('auth', oldAuth).patch({
            endpoint: next.endpoint, p256dh: next.p256dh, auth: next.auth,
            failure_count: 0, updated_at: new Date().toISOString()
        });
        return Array.isArray(rows) ? rows[0] || null : null;
    },

    /**
     * Inserta el aviso. Devuelve la fila, o null si ya existía uno con la
     * misma dedupe_key para ese usuario (no se vuelve a avisar).
     */
    async insertNotification(row) {
        try {
            const rows = await pgrest('user_notifications').insert(row);
            return Array.isArray(rows) ? rows[0] || null : null;
        } catch (error) {
            if (isConflict(error)) return null;
            throw error;
        }
    },

    pruneNotifications(beforeIso) {
        return pgrest('user_notifications').lt('created_at', beforeIso).delete();
    },

    /** user_id de la cuenta con ese email en la tabla del rol (o null). */
    async findUserIdByEmail(role, email) {
        const table = ROLE_TABLES[role];
        if (!table || !email) return null;
        const row = await pgrest(table).select('user_id').ilike('email', exactIlike(email)).limit(1).single().execute();
        return row && row.user_id ? row.user_id : null;
    }
};

module.exports = { PushRepo, exactIlike, isConflict };
