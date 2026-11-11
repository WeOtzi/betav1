'use strict';

// ===========================================================================
// Firma de objetos privados de Supabase Storage (servidor)
// ---------------------------------------------------------------------------
// Emite URLs firmadas con service role para buckets privados (hoy:
// `store-design-files` de la Store). Centraliza la config y los headers con el
// mismo patron que lib/instagram-import.js (supabaseConfig + serviceHeaders),
// para que ningun endpoint arme a mano `fetch('/storage/v1/...')`.
//
// API de Storage:
//   POST /storage/v1/object/sign/<bucket>/<path>   body { expiresIn }
//   -> { signedURL: '/object/sign/<bucket>/<path>?token=...' }
// El path que devuelve viene decodificado, asi que el href final se arma igual
// que supabase-js (`encodeURI(base + signedURL)`) y despues se agrega
// `&download=<nombre>` con encodeURIComponent, para que un nombre con `&` o `#`
// no rompa el query.
// ===========================================================================

const SIGN_TIMEOUT_MS = 10000;
const MAX_EXPIRES_IN = 7 * 24 * 60 * 60; // tope de Storage: 1 semana

function storageConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url: url.replace(/\/+$/, ''), serviceRoleKey };
}

function serviceHeaders(extra = {}) {
    const { serviceRoleKey } = storageConfig();
    return {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        ...extra
    };
}

function signError(code, message, status) {
    const e = new Error(message || code);
    e.code = code;
    if (status) e.status = status;
    return e;
}

// Bucket: el formato de ids de Supabase. Path: relativo, sin segmentos vacios
// ni `..`, y sin caracteres que cambien el significado de la URL (`?`, `#`,
// `%`, `\`) o de control. Las rutas de la Store salen de sanitizeFilename, asi
// que un path que no pasa esto es un dato corrupto, no un archivo legitimo.
function assertBucket(bucket) {
    if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) {
        throw signError('INVALID_BUCKET', 'Invalid storage bucket');
    }
}

function assertObjectPath(path) {
    if (typeof path !== 'string' || !path || path.length > 1024) {
        throw signError('INVALID_PATH', 'Invalid storage path');
    }
    // eslint-disable-next-line no-control-regex
    if (/[?#%\\\u0000-\u001f\u007f]/.test(path) || path.startsWith('/')) {
        throw signError('INVALID_PATH', 'Invalid storage path');
    }
    if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw signError('INVALID_PATH', 'Invalid storage path');
    }
}

/**
 * Firma un objeto de Storage con service role.
 * @param {string} bucket
 * @param {string} path  path dentro del bucket (sin el bucket)
 * @param {{ expiresIn: number, download?: string|boolean }} opts
 * @returns {Promise<string>} href absoluto listo para el navegador
 */
async function signStorageObject(bucket, path, { expiresIn, download } = {}) {
    assertBucket(bucket);
    assertObjectPath(path);
    if (!Number.isInteger(expiresIn) || expiresIn <= 0 || expiresIn > MAX_EXPIRES_IN) {
        throw signError('INVALID_EXPIRES_IN', 'expiresIn must be a positive integer (seconds)');
    }

    const { url } = storageConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIGN_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`, {
            method: 'POST',
            headers: serviceHeaders(),
            body: JSON.stringify({ expiresIn }),
            signal: controller.signal
        });
    } catch (e) {
        if (e && e.name === 'AbortError') {
            throw signError('STORAGE_SIGN_TIMEOUT', `Storage sign timed out after ${SIGN_TIMEOUT_MS}ms`, 504);
        }
        throw e;
    } finally {
        clearTimeout(timeout);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw signError('STORAGE_SIGN_FAILED', `Storage sign failed (${res.status}): ${body.slice(0, 200)}`, res.status === 404 ? 404 : 502);
    }

    const data = await res.json().catch(() => null);
    const signedPath = data && (data.signedURL || data.signedUrl);
    if (typeof signedPath !== 'string' || !signedPath.startsWith('/')) {
        throw signError('STORAGE_SIGN_FAILED', 'Storage sign returned no signedURL', 502);
    }

    let href = encodeURI(`${url}/storage/v1${signedPath}`);
    if (download) {
        const name = download === true ? '' : String(download);
        href += `${href.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
    }
    return href;
}

module.exports = { signStorageObject, storageConfig, SIGN_TIMEOUT_MS };
