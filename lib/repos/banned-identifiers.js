'use strict';

// ===========================================================================
// Repositorio de huellas baneadas (servidor) — capa PostgREST, service-role.
// ---------------------------------------------------------------------------
// Tabla public.banned_identifiers (migración 20261118130000): solo HMAC
// (lib/ban-identifiers.js), único (kind, value_hmac). Sin acceso para anon ni
// authenticated: todo pasa por el servidor.
// ===========================================================================

const { pgrest } = require('../postgrest');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HMAC_RE = /^[0-9a-f]{64}$/;
const KINDS = new Set(['email', 'phone', 'instagram', 'document', 'face']);

function validList(identifiers) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(identifiers) ? identifiers : []) {
        if (!item || !KINDS.has(item.kind) || !HMAC_RE.test(String(item.value_hmac || ''))) continue;
        const key = `${item.kind}:${item.value_hmac}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind: item.kind, value_hmac: item.value_hmac });
    }
    return out;
}

const BannedIdentifiersRepo = {
    // Guarda las huellas de la sanción. Una huella que ya existe (de esta u
    // otra sanción) se deja como está. Devuelve las filas nuevas.
    async upsertIdentifiers(sanctionId, identifiers) {
        if (!UUID_RE.test(String(sanctionId || ''))) throw new Error('sanction_id inválido');
        const rows = validList(identifiers).map((item) => ({ sanction_id: sanctionId, ...item }));
        if (!rows.length) return [];
        const out = await pgrest.raw('banned_identifiers?on_conflict=kind,value_hmac&select=id,kind,sanction_id', {
            method: 'POST',
            body: rows,
            prefer: 'resolution=ignore-duplicates,return=representation'
        });
        return Array.isArray(out) ? out : [];
    },

    // Coincidencias: [{ kind, value_hmac, sanction_id, sanction_user_id }].
    async findMatches(identifiers) {
        const list = validList(identifiers);
        if (!list.length) return [];
        const rows = await pgrest('banned_identifiers')
            .select('kind,value_hmac,sanction_id,account_sanctions(user_id,status)')
            .in('value_hmac', list.map((i) => i.value_hmac))
            .limit(50)
            .execute();
        const wanted = new Set(list.map((i) => `${i.kind}:${i.value_hmac}`));
        return (Array.isArray(rows) ? rows : [])
            .filter((r) => wanted.has(`${r.kind}:${r.value_hmac}`))
            .map((r) => ({
                kind: r.kind,
                value_hmac: r.value_hmac,
                sanction_id: r.sanction_id,
                sanction_user_id: (r.account_sanctions && r.account_sanctions.user_id) || null
            }));
    },

    async deleteBySanction(sanctionId) {
        if (!UUID_RE.test(String(sanctionId || ''))) return 0;
        const rows = await pgrest('banned_identifiers').eq('sanction_id', sanctionId).delete({ returning: true });
        return Array.isArray(rows) ? rows.length : 0;
    },

    async countBySanction(sanctionId) {
        if (!UUID_RE.test(String(sanctionId || ''))) return 0;
        const rows = await pgrest('banned_identifiers').select('kind').eq('sanction_id', sanctionId).limit(50).execute();
        return Array.isArray(rows) ? rows.length : 0;
    }
};

module.exports = { BannedIdentifiersRepo, _internal: { validList } };
