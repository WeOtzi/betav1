'use strict';

// ===========================================================================
// Google Calendar · OAuth 2.0 (web server flow) y cliente HTTP de Google.
// ---------------------------------------------------------------------------
// Ronda 3b · grupo "gcal". Sin dependencias: crypto de Node + fetch nativo
// (inyectable para los tests, que nunca salen a la red).
//
//   - Configuración SOLO por variables de entorno (gcalConfig):
//       GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//       GOOGLE_OAUTH_REDIRECT_URI (default beta), GCAL_TOKEN_ENC_KEY
//       (32 bytes en base64 → AES-256-GCM).
//   - Refresh tokens cifrados con AES-256-GCM; el AAD es el user_id, así un
//     token cifrado no se puede "mover" a otro artista.
//   - `state` = blob cifrado+autenticado (AES-GCM con una subclave derivada)
//     que lleva user_id, nonce, code_verifier (PKCE) y vencimiento. El nonce
//     además va en una cookie httpOnly: el callback exige que coincidan, así
//     un link de callback ajeno no conecta un Google a otra cuenta.
//   - Nunca se loguean ni se devuelven tokens: los errores llevan solo el
//     código de error de Google (p. ej. invalid_grant).
// ===========================================================================

const crypto = require('crypto');

const DEFAULT_REDIRECT_URI = 'https://beta.weotzi.com/api/google-calendar/callback';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SCOPES = ['openid', 'email', CALENDAR_SCOPE];
const STATE_TTL_MS = 10 * 60 * 1000;
const NONCE_COOKIE = 'wo_gcal_oauth';
const NOT_CONFIGURED_MESSAGE = 'Google Calendar no está configurado';

class GcalError extends Error {
    constructor(code, message, status) {
        super(message || code);
        this.name = 'GcalError';
        this.code = code;
        if (status) this.status = status;
    }
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function decodeKey(raw) {
    const text = clean(raw);
    if (!text) return null;
    try {
        const buf = Buffer.from(text, 'base64');
        return buf.length === 32 ? buf : null;
    } catch (_) {
        return null;
    }
}

// Lee la configuración del entorno. `configured` solo es true con las cuatro
// piezas válidas (la URI de redirect tiene default). Nunca expone los valores.
function gcalConfig(env = process.env) {
    const clientId = clean(env.GOOGLE_OAUTH_CLIENT_ID);
    const clientSecret = clean(env.GOOGLE_OAUTH_CLIENT_SECRET);
    const redirectUri = clean(env.GOOGLE_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
    const key = decodeKey(env.GCAL_TOKEN_ENC_KEY);
    const missing = [];
    if (!clientId) missing.push('GOOGLE_OAUTH_CLIENT_ID');
    if (!clientSecret) missing.push('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!key) missing.push('GCAL_TOKEN_ENC_KEY');
    let redirectOk = false;
    try { redirectOk = /^https?:$/.test(new URL(redirectUri).protocol); } catch (_) { redirectOk = false; }
    if (!redirectOk) missing.push('GOOGLE_OAUTH_REDIRECT_URI');
    return {
        configured: missing.length === 0,
        missing,
        clientId,
        clientSecret,
        redirectUri,
        key,
        stateKey: key ? crypto.createHmac('sha256', key).update('weotzi-gcal-state-v1').digest() : null,
    };
}

// Página a la que vuelve el callback: misma base que la URI de redirect
// (sirve para beta.weotzi.com y para un despliegue bajo /beta).
function accountReturnPath(cfg, status, reason) {
    let base = '';
    try {
        base = new URL(cfg.redirectUri).pathname.replace(/\/api\/google-calendar\/callback\/?$/, '');
    } catch (_) { base = ''; }
    const query = status === 'ok' ? 'gcal=ok' : `gcal=error${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
    return `${base}/artist/account/#disponibilidad?${query}`;
}

/* ------------------------------- cifrado -------------------------------- */

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
    const norm = String(text).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(norm + '='.repeat((4 - (norm.length % 4)) % 4), 'base64');
}

// Formato: v1:<iv>:<tag>:<ciphertext> (base64url). AAD = user_id.
function encryptToken(plain, key, userId) {
    if (!key || key.length !== 32) throw new GcalError('not_configured', NOT_CONFIGURED_MESSAGE);
    if (typeof plain !== 'string' || !plain) throw new GcalError('invalid_token', 'Token vacío');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(String(userId || ''), 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${b64url(iv)}:${b64url(cipher.getAuthTag())}:${b64url(ct)}`;
}

function decryptToken(blob, key, userId) {
    if (!key || key.length !== 32) throw new GcalError('not_configured', NOT_CONFIGURED_MESSAGE);
    const parts = String(blob || '').split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new GcalError('token_corrupt', 'No pudimos leer la conexión guardada.');
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64url(parts[1]));
        decipher.setAAD(Buffer.from(String(userId || ''), 'utf8'));
        decipher.setAuthTag(fromB64url(parts[2]));
        return Buffer.concat([decipher.update(fromB64url(parts[3])), decipher.final()]).toString('utf8');
    } catch (_) {
        throw new GcalError('token_corrupt', 'No pudimos leer la conexión guardada.');
    }
}

/* ------------------------------ state + PKCE ----------------------------- */

function createPkce() {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

function createState(cfg, userId, { now = Date.now() } = {}) {
    if (!cfg.stateKey) throw new GcalError('not_configured', NOT_CONFIGURED_MESSAGE);
    const nonce = b64url(crypto.randomBytes(18));
    const pkce = createPkce();
    const payload = JSON.stringify({ u: String(userId), n: nonce, v: pkce.verifier, e: now + STATE_TTL_MS });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', cfg.stateKey, iv);
    cipher.setAAD(Buffer.from('weotzi-gcal-state', 'utf8'));
    const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const state = b64url(Buffer.concat([iv, cipher.getAuthTag(), ct]));
    return { state, nonce, codeChallenge: pkce.challenge };
}

// Devuelve { userId, nonce, codeVerifier } o lanza GcalError('state').
function verifyState(cfg, state, cookieNonce, { now = Date.now() } = {}) {
    if (!cfg.stateKey) throw new GcalError('not_configured', NOT_CONFIGURED_MESSAGE);
    let data;
    try {
        const raw = fromB64url(String(state || ''));
        if (raw.length < 29) throw new Error('short');
        const decipher = crypto.createDecipheriv('aes-256-gcm', cfg.stateKey, raw.subarray(0, 12));
        decipher.setAAD(Buffer.from('weotzi-gcal-state', 'utf8'));
        decipher.setAuthTag(raw.subarray(12, 28));
        data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    } catch (_) {
        throw new GcalError('state', 'El pedido de conexión no es válido.');
    }
    if (!data || typeof data.u !== 'string' || typeof data.n !== 'string' || typeof data.v !== 'string') {
        throw new GcalError('state', 'El pedido de conexión no es válido.');
    }
    if (!(Number(data.e) > now)) throw new GcalError('state_expired', 'El pedido de conexión venció. Probá de nuevo.');
    const a = Buffer.from(String(cookieNonce || ''));
    const b = Buffer.from(data.n);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new GcalError('state', 'El pedido de conexión no corresponde a este navegador.');
    }
    return { userId: data.u, nonce: data.n, codeVerifier: data.v };
}

function buildAuthorizeUrl(cfg, { state, codeChallenge }) {
    const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/* -------------------------------- cookies -------------------------------- */

function readCookie(header, name) {
    const parts = String(header || '').split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) {
            try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch (_) { return null; }
        }
    }
    return null;
}

function nonceCookie(value, { secure = true, clear = false } = {}) {
    const attrs = [
        `${NONCE_COOKIE}=${clear ? '' : encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${clear ? 0 : Math.floor(STATE_TTL_MS / 1000)}`,
    ];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}

/* ------------------------------ id_token --------------------------------- */

// El id_token llega directo del token endpoint de Google por TLS (OIDC §3.1.3.7
// permite no verificar la firma en ese caso); igual validamos aud e iss.
function emailFromIdToken(idToken, clientId) {
    try {
        const payload = JSON.parse(fromB64url(String(idToken || '').split('.')[1] || '').toString('utf8'));
        const issOk = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
        const audOk = Array.isArray(payload.aud) ? payload.aud.includes(clientId) : payload.aud === clientId;
        if (!issOk || !audOk) return null;
        return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    } catch (_) {
        return null;
    }
}

function hasCalendarScope(scope) {
    return String(scope || '').split(/\s+/).includes(CALENDAR_SCOPE);
}

/* ------------------------------ cliente HTTP ----------------------------- */

async function readJson(res) {
    const text = await res.text().catch(() => '');
    if (!text) return {};
    try { return JSON.parse(text); } catch (_) { return {}; }
}

function googleError(status, body, fallback) {
    const code = typeof body?.error === 'string' ? body.error
        : (body?.error?.status || body?.error?.errors?.[0]?.reason || fallback);
    const err = new GcalError(String(code || fallback || 'google_http'), `Google respondió ${status} (${code || 'error'})`, status);
    return err;
}

// deps: { fetch, cfg }. Todos los métodos devuelven datos parseados y lanzan
// GcalError (sin tokens en el mensaje).
function createGoogleClient({ fetch: fetchImpl = globalThis.fetch, cfg }) {
    async function form(url, fields) {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams(fields).toString(),
        });
        const body = await readJson(res);
        if (!res.ok) throw googleError(res.status, body, 'token_error');
        return body;
    }

    async function api(method, path, accessToken, { query, body } = {}) {
        const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
        const res = await fetchImpl(`${CALENDAR_API}${path}${qs}`, {
            method,
            headers: Object.assign(
                { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
                body ? { 'Content-Type': 'application/json' } : {}
            ),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 204) return null;
        const json = await readJson(res);
        if (!res.ok) throw googleError(res.status, json, 'google_http');
        return json;
    }

    const cal = (calendarId) => `/calendars/${encodeURIComponent(calendarId || 'primary')}/events`;

    return {
        exchangeCode(code, codeVerifier) {
            return form(TOKEN_ENDPOINT, {
                code: String(code),
                client_id: cfg.clientId,
                client_secret: cfg.clientSecret,
                redirect_uri: cfg.redirectUri,
                grant_type: 'authorization_code',
                code_verifier: codeVerifier,
            });
        },
        refreshAccessToken(refreshToken) {
            return form(TOKEN_ENDPOINT, {
                refresh_token: refreshToken,
                client_id: cfg.clientId,
                client_secret: cfg.clientSecret,
                grant_type: 'refresh_token',
            });
        },
        async revoke(token) {
            try {
                await form(REVOKE_ENDPOINT, { token });
                return true;
            } catch (err) {
                // invalid_token = ya estaba revocado: para nosotros es éxito.
                if (err.code === 'invalid_token') return true;
                throw err;
            }
        },
        insertEvent(accessToken, calendarId, event) {
            return api('POST', cal(calendarId), accessToken, { body: event });
        },
        updateEvent(accessToken, calendarId, eventId, event) {
            return api('PUT', `${cal(calendarId)}/${encodeURIComponent(eventId)}`, accessToken, { body: event });
        },
        async deleteEvent(accessToken, calendarId, eventId) {
            try {
                await api('DELETE', `${cal(calendarId)}/${encodeURIComponent(eventId)}`, accessToken);
            } catch (err) {
                if (err.status === 404 || err.status === 410) return; // ya no existe
                throw err;
            }
        },
        // Solo los campos necesarios para bloquear horarios: nunca títulos,
        // descripciones ni invitados de eventos ajenos.
        listEvents(accessToken, calendarId, { timeMin, timeMax, pageToken }) {
            const query = {
                timeMin,
                timeMax,
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '250',
                showDeleted: 'false',
                fields: 'nextPageToken,items(id,status,start,end,transparency,extendedProperties/private)',
            };
            if (pageToken) query.pageToken = pageToken;
            return api('GET', cal(calendarId), accessToken, { query });
        },
    };
}

module.exports = {
    AUTH_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    CALENDAR_API,
    CALENDAR_SCOPE,
    SCOPES,
    DEFAULT_REDIRECT_URI,
    NONCE_COOKIE,
    NOT_CONFIGURED_MESSAGE,
    STATE_TTL_MS,
    GcalError,
    gcalConfig,
    accountReturnPath,
    encryptToken,
    decryptToken,
    createPkce,
    createState,
    verifyState,
    buildAuthorizeUrl,
    readCookie,
    nonceCookie,
    emailFromIdToken,
    hasCalendarScope,
    createGoogleClient,
};
