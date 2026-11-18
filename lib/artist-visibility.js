'use strict';

// ===========================================================================
// Visibilidad pública del artista (servidor).
// ---------------------------------------------------------------------------
// Un artista es público si terminó el alta (registration_status distinto de
// 'incompleto', null incluido) y no tiene una sanción (sanction_state =
// 'none'). Es el mismo predicado que public.artist_is_public() en la base
// (migración 20261118130000_account_sanctions.sql), que usan las políticas
// RLS, las vistas y las funciones públicas.
//
// Las lecturas del servidor con service role se saltan la RLS: por eso cada
// camino que elige un artista para algo nuevo (sugerencias del cotizador,
// cotización directa, flash, turnos) aplica este filtro. Requiere la columna
// artists_db.sanction_state (la migración se aplica antes del deploy).
// ===========================================================================

const SANCTION_COLUMN = 'sanction_state';

// Condiciones del or() de lib/postgrest.js: neq solo no trae los null
// (perfiles legacy sin estado de alta).
const PUBLISHED_OR = Object.freeze([
    Object.freeze({ col: 'registration_status', op: 'is', val: null }),
    Object.freeze({ col: 'registration_status', op: 'neq', val: 'incompleto' })
]);

/** ¿La fila de artists_db es pública? Sin sanction_state cuenta como 'none'. */
function isPublicArtist(row) {
    if (!row || typeof row !== 'object') return false;
    if (String(row.registration_status == null ? '' : row.registration_status).toLowerCase() === 'incompleto') return false;
    const state = row.sanction_state == null || row.sanction_state === '' ? 'none' : String(row.sanction_state);
    return state === 'none';
}

/**
 * Agrega a una consulta de pgrest sobre artists_db el filtro de alta
 * publicada y sin sanción. Ojo: or() de pgrest reemplaza un or() anterior.
 */
function applyPublicFilter(query) {
    return query.or(PUBLISHED_OR).eq(SANCTION_COLUMN, 'none');
}

/** Suma sanction_state a una lista de columnas (string 'a,b' o array), sin duplicar. */
function withSanctionColumn(columns) {
    const list = Array.isArray(columns)
        ? columns.slice()
        : String(columns || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!list.includes(SANCTION_COLUMN)) list.push(SANCTION_COLUMN);
    return Array.isArray(columns) ? list : list.join(',');
}

/**
 * Forma canónica (8-4-4-4-12, minúsculas) de un uuid tal como lo acepta
 * Postgres: guiones en cualquier posición entre grupos y llaves opcionales
 * ('A0EE-BC99-9C0B-…'::uuid es el mismo id). Devuelve null si no son
 * exactamente 32 dígitos hex. Las guardas comparan y consultan con esta forma
 * para que una variante del id no esquive el chequeo de visibilidad.
 */
function canonicalUuid(value) {
    if (value == null) return null;
    let raw = String(value).trim().toLowerCase();
    if (raw.startsWith('{') && raw.endsWith('}')) raw = raw.slice(1, -1);
    const hex = raw.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/.test(hex)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = {
    SANCTION_COLUMN,
    canonicalUuid,
    PUBLISHED_OR,
    isPublicArtist,
    applyPublicFilter,
    withSanctionColumn
};
