'use strict';

// ── favoritos (ronda 2 · P22) ──
// Lecturas de servidor (service-role vía lib/postgrest.js) sobre las listas de
// favoritos. El navegador lee y escribe sus listas directo por RLS
// (window.WeotziData.FavoriteLists); aquí viven solo los AGREGADOS que
// consumen otros módulos del servidor, sobre las funciones públicas de la
// migración 20261116190000_favoritos_listas.sql:
//
//   artistSaveCounts(ids)          "veces guardado" por artista. Es el dato
//                                  que usa el cálculo Most Wanted del perfil.
//                                  RPC public.favorite_artist_save_counts(uuid[])
//   targetSaveCounts(kind, ids)    veces guardado por destino (diseño, merch,
//                                  estudio, artista).
//                                  RPC public.favorite_target_save_counts(text, text[])
//
// Ninguna expone quién guardó: solo cantidades. Si la migración todavía no
// está aplicada devuelven ceros (el perfil no se rompe por eso).

const { pgrest } = require('../postgrest');

const KINDS = Object.freeze(['artist', 'design', 'merch', 'studio']);
const MAX_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asList(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
}

// uuids válidos, en minúsculas, sin repetir y con tope.
function cleanArtistIds(ids) {
    const seen = new Set();
    for (const raw of asList(ids)) {
        const id = String(raw == null ? '' : raw).trim().toLowerCase();
        if (UUID_RE.test(id)) seen.add(id);
        if (seen.size >= MAX_IDS) break;
    }
    return [...seen];
}

// ids de destino no vacíos, sin repetir y con tope (artist → minúsculas).
function cleanTargetIds(kind, ids) {
    const seen = new Set();
    for (const raw of asList(ids)) {
        let id = String(raw == null ? '' : raw).trim();
        if (!id || id.length > 200) continue;
        if (kind === 'artist') id = id.toLowerCase();
        seen.add(id);
        if (seen.size >= MAX_IDS) break;
    }
    return [...seen];
}

function count(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// La función todavía no existe en la base (deploy sin migración).
function isMissingFunction(err) {
    const text = String((err && err.message) || '');
    return (err && err.status === 404) || /PGRST202|42883|could not find the function/i.test(text);
}

function createFavoritosRepo(deps = {}) {
    const rpc = deps.rpc || ((name, body) => pgrest.raw(`rpc/${name}`, { method: 'POST', body }));

    return {
        /**
         * Veces guardado por artista.
         * @param {string[]|string} artistUserIds artists_db.user_id
         * @returns {Promise<Map<string, {saved: number, items: number, total: number}>>}
         *   saved = personas que guardaron al artista; items = guardados de sus
         *   diseños/merch; total = saved + items. Todo id pedido viene en el Map.
         */
        async artistSaveCounts(artistUserIds) {
            const ids = cleanArtistIds(artistUserIds);
            const out = new Map(ids.map((id) => [id, { saved: 0, items: 0, total: 0 }]));
            if (!ids.length) return out;
            let rows;
            try {
                rows = await rpc('favorite_artist_save_counts', { p_artist_user_ids: ids });
            } catch (err) {
                if (isMissingFunction(err)) return out;
                throw err;
            }
            for (const row of asList(rows)) {
                const id = String((row && row.artist_user_id) || '').toLowerCase();
                if (!out.has(id)) continue;
                const saved = count(row.saved_count);
                const items = count(row.items_saved_count);
                out.set(id, { saved, items, total: saved + items });
            }
            return out;
        },

        /** Atajo: el contador de un solo artista. */
        async artistSaveCount(artistUserId) {
            const map = await this.artistSaveCounts([artistUserId]);
            const first = map.values().next();
            return first.done ? { saved: 0, items: 0, total: 0 } : first.value;
        },

        /**
         * Veces guardado por destino (personas distintas).
         * @param {'artist'|'design'|'merch'|'studio'} kind
         * @param {string[]|string} targetIds
         * @returns {Promise<Map<string, number>>}
         */
        async targetSaveCounts(kind, targetIds) {
            const k = String(kind || '').trim().toLowerCase();
            if (!KINDS.includes(k)) return new Map();
            const ids = cleanTargetIds(k, targetIds);
            const out = new Map(ids.map((id) => [id, 0]));
            if (!ids.length) return out;
            let rows;
            try {
                rows = await rpc('favorite_target_save_counts', { p_kind: k, p_target_ids: ids });
            } catch (err) {
                if (isMissingFunction(err)) return out;
                throw err;
            }
            for (const row of asList(rows)) {
                const id = String((row && row.target_id) || '');
                if (out.has(id)) out.set(id, count(row.saved_count));
            }
            return out;
        }
    };
}

const FavoritosRepo = createFavoritosRepo();

module.exports = { FavoritosRepo, createFavoritosRepo, cleanArtistIds, cleanTargetIds, isMissingFunction, KINDS, MAX_IDS };
