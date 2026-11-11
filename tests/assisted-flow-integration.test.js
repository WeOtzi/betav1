'use strict';

// ===========================================================================
// Integración offline del flujo del servidor: modo asistido + validación de
// Instagram (services/artist-onboarding.js + services/instagram-verification.js).
// ---------------------------------------------------------------------------
// - lib/postgrest.js, lib/auth/supabase-auth.js, services/email-service.js y
//   lib/app-settings.js se reemplazan en require.cache ANTES de cargar los
//   servicios. Nada sale a la red: fetch solo puede llamar al servidor local.
// - El PostgREST falso guarda filas en memoria y respeta el esquema: tabla o
//   columna ausente responde como PostgREST (404 PGRST205 / 400 42703 /
//   400 PGRST204), valida uuid, NOT NULL y los CHECK de la migración
//   20261030120000, y emula el trigger que recalcula gallery_images.
// - Los handlers reales se montan en un express real (puerto efímero) con las
//   mismas rutas que server.js, y el flujo se recorre por HTTP de punta a punta.
// ===========================================================================

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const visibility = require('../public/shared/js/gallery-visibility.js');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const WEBHOOK_SECRET = 'n8n-shared-secret-for-tests';
const IG_TABLE = 'artist_instagram_verifications';
const IG_COLUMNS = ['instagram_verified_at', 'instagram_verified_handle'];
const IG_STATUSES = ['pending', 'verified', 'expired', 'cancelled', 'rejected'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^WO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const STEP_TITLES = [
    ['perfil', 'Completá tu perfil'],
    ['portafolio', 'Validá tu Instagram y tu portafolio'],
    ['compartir', 'Compartí tu perfil en Instagram'],
    ['retiro', 'Configurá un medio de retiro'],
    ['disponibilidad', 'Configurá tu disponibilidad'],
    ['notificaciones', 'Configurá tus notificaciones'],
    ['verificacion', 'Completá la verificación'],
    ['configuracion', 'Completá la configuración']
];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

// ---------------------------------------------------------------------------
// Esquema de las tablas que leen/escriben los dos servicios.
// ---------------------------------------------------------------------------
const SCHEMA = {
    artists_db: [
        'id', 'user_id', 'username', 'name', 'email', 'instagram', 'portafolio', 'profile_picture', 'whatsapp_number',
        'bio_description', 'city', 'country', 'work_type', 'estudios', 'studio_id', 'verification_state',
        'ms_profile_shared', 'gallery_feed_items', 'gallery_images', 'preferred_display_currency', 'profile_links',
        'instagram_verified_at', 'instagram_verified_handle'
    ],
    user_preferences: ['user_id', 'notification_prefs', 'privacy', 'app_settings', 'updated_at'],
    artist_payout_destinations: ['id', 'artist_user_id', 'active', 'method', 'created_at'],
    artist_verification_documents: ['id', 'artist_user_id', 'doc_type', 'status', 'created_at'],
    support_users_db: ['user_id', 'email', 'full_name', 'role', 'is_active'],
    [IG_TABLE]: [
        'id', 'artist_user_id', 'ig_handle', 'code_hash', 'status', 'email_sent_to', 'email_sent', 'attempts',
        'created_at', 'expires_at', 'verified_at', 'verified_via', 'verified_by', 'dm_sender_handle', 'note'
    ]
};
const PRIMARY_KEYS = { artists_db: 'user_id', user_preferences: 'user_id', support_users_db: 'user_id' };
const UUID_COLUMNS = {
    artists_db: ['id', 'user_id', 'studio_id'],
    user_preferences: ['user_id'],
    artist_payout_destinations: ['id', 'artist_user_id'],
    artist_verification_documents: ['id', 'artist_user_id'],
    support_users_db: ['user_id'],
    [IG_TABLE]: ['id', 'artist_user_id', 'verified_by']
};
const GALLERY_TRIGGER_COLUMNS = ['gallery_images', 'gallery_feed_items', 'instagram_verified_at', 'instagram_verified_handle'];

function pgError(method, table, status, payload) {
    const body = { code: payload.code, details: null, hint: null, message: payload.message };
    const err = new Error(`PostgREST ${method} ${table} failed (${status}): ${JSON.stringify(body)}`);
    err.status = status;
    return err;
}

function notNull(table, columns) {
    return (row) => {
        const col = columns.find((c) => row[c] == null);
        return col ? { code: '23502', message: `null value in column "${col}" of relation "${table}" violates not-null constraint` } : null;
    };
}

const CONSTRAINTS = {
    user_preferences: notNull('user_preferences', ['user_id', 'notification_prefs', 'privacy', 'app_settings', 'updated_at']),
    [IG_TABLE]: (row) => {
        const missing = notNull(IG_TABLE, ['artist_user_id', 'ig_handle', 'code_hash', 'status', 'email_sent', 'attempts', 'created_at', 'expires_at'])(row);
        if (missing) return missing;
        if (!IG_STATUSES.includes(row.status)) {
            return { code: '23514', message: `new row for relation "${IG_TABLE}" violates check constraint "${IG_TABLE}_status_check"` };
        }
        if (row.verified_via != null && !['dm_webhook', 'support'].includes(row.verified_via)) {
            return { code: '23514', message: `new row for relation "${IG_TABLE}" violates check constraint "${IG_TABLE}_verified_via_check"` };
        }
        if (!Number.isInteger(row.attempts)) return { code: '22P02', message: `invalid input syntax for type integer: "${row.attempts}"` };
        return null;
    }
};

function compareValues(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matchesFilter(row, f) {
    const v = row[f.col];
    switch (f.op) {
        case 'eq': return v != null && String(v) === String(f.val);
        case 'neq': return v != null && String(v) !== String(f.val); // NULL <> x es NULL en SQL
        case 'gt': return v != null && compareValues(v, f.val) > 0;
        case 'gte': return v != null && compareValues(v, f.val) >= 0;
        case 'lt': return v != null && compareValues(v, f.val) < 0;
        case 'lte': return v != null && compareValues(v, f.val) <= 0;
        case 'in': return v != null && (Array.isArray(f.val) ? f.val : [f.val]).map(String).includes(String(v));
        case 'is': return f.val === null || f.val === 'null' ? v == null : String(v) === String(f.val);
        default: throw new Error(`fake pgrest: filter ${f.op} not implemented`);
    }
}

// Cada sentencia es un viaje de red: cede el event loop antes de correr (así
// se intercalan las requests concurrentes) y después corre atómica, como en Postgres.
const roundTrip = () => new Promise((resolve) => setImmediate(resolve));

function sortRows(rows, { col, ascending }) {
    return rows.slice().sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return ascending ? 1 : -1; // NULLS LAST en asc, NULLS FIRST en desc
        if (bv == null) return ascending ? -1 : 1;
        const c = compareValues(av, bv);
        return ascending ? c : -c;
    });
}

// ---------------------------------------------------------------------------
// PostgREST en memoria
// ---------------------------------------------------------------------------
function createStore({ igTable = true, igColumns = true, profileLinks = true } = {}) {
    const schema = {};
    for (const [name, cols] of Object.entries(SCHEMA)) schema[name] = new Set(cols);
    if (!igTable) delete schema[IG_TABLE];
    if (!igColumns) IG_COLUMNS.forEach((c) => schema.artists_db.delete(c));
    if (!profileLinks) schema.artists_db.delete('profile_links');

    const tables = Object.fromEntries(Object.keys(SCHEMA).map((name) => [name, []]));
    const log = [];
    const hooks = { afterRead: null, beforePatch: null };
    let clock = 0;
    const dbNow = () => {
        clock = Math.max(Date.now(), clock + 1);
        return new Date(clock).toISOString();
    };

    const missingTable = (method, table) => pgError(method, table, 404, {
        code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache`
    });

    function checkRead(method, table, cols) {
        if (!schema[table]) throw missingTable(method, table);
        const col = cols.find((c) => !schema[table].has(c));
        if (col) throw pgError(method, table, 400, { code: '42703', message: `column ${table}.${col} does not exist` });
    }
    function checkWrite(method, table, rows) {
        if (!schema[table]) throw missingTable(method, table);
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw pgError(method, table, 400, { code: 'PGRST102', message: 'Empty or invalid json' });
            const col = Object.keys(row).find((c) => !schema[table].has(c));
            if (col) throw pgError(method, table, 400, { code: 'PGRST204', message: `Could not find the '${col}' column of '${table}' in the schema cache` });
        }
    }
    function checkUuid(method, table, col, value) {
        if (value == null || !(UUID_COLUMNS[table] || []).includes(col)) return;
        if (!UUID_RE.test(String(value))) throw pgError(method, table, 400, { code: '22P02', message: `invalid input syntax for type uuid: "${value}"` });
    }
    function checkRow(method, table, row) {
        for (const [col, value] of Object.entries(row)) checkUuid(method, table, col, value);
        const problem = CONSTRAINTS[table] ? CONSTRAINTS[table](row) : null;
        if (problem) throw pgError(method, table, 400, problem);
    }

    function withDefaults(table, values) {
        const now = dbNow();
        const defaults = {
            artists_db: { id: crypto.randomUUID(), ms_profile_shared: false, verification_state: 'No', gallery_images: [], gallery_feed_items: [], profile_links: {} },
            user_preferences: { notification_prefs: {}, privacy: {}, app_settings: {}, updated_at: now },
            artist_payout_destinations: { id: crypto.randomUUID(), active: true, created_at: now },
            artist_verification_documents: { id: crypto.randomUUID(), created_at: now },
            support_users_db: { is_active: true },
            [IG_TABLE]: { id: crypto.randomUUID(), status: 'pending', email_sent: false, attempts: 0, created_at: now }
        }[table] || {};
        const row = {};
        for (const col of schema[table]) row[col] = null;
        for (const [key, value] of Object.entries(defaults)) if (schema[table].has(key)) row[key] = value;
        return Object.assign(row, clone(values));
    }

    // Trigger trigger_sync_artist_gallery_feed_items: gallery_images = ítems
    // públicos del feed (con la migración) o todos (sin ella).
    function syncGallery(row) {
        const feed = Array.isArray(row.gallery_feed_items) ? row.gallery_feed_items : [];
        const state = {
            enforced: schema.artists_db.has('instagram_verified_at'),
            verified: row.instagram_verified_at != null,
            handle: row.instagram_verified_handle || null
        };
        row.gallery_images = feed.filter((item) => visibility.isPubliclyVisible(item, state)).map((item) => item.url);
    }

    function insertRows(method, table, values) {
        const list = (Array.isArray(values) ? values : [values]).map(clone);
        checkWrite(method, table, list);
        const created = list.map((v) => withDefaults(table, v));
        created.forEach((row) => checkRow(method, table, row));
        if (table === 'artists_db') created.forEach(syncGallery);
        tables[table].push(...created);
        return { list, created };
    }

    function query(table) {
        const st = { select: null, filters: [], order: null, limit: null, single: false, onConflict: null };
        const filterCols = () => st.filters.map((f) => f.col).concat(st.order ? [st.order.col] : []);
        const selected = () => (!st.select || st.select.trim() === '*'
            ? [...schema[table]]
            : st.select.split(',').map((c) => c.trim()).filter(Boolean));
        const matching = (method) => {
            for (const f of st.filters) {
                if (f.op === 'eq' || f.op === 'neq') checkUuid(method, table, f.col, f.val);
                if (f.op === 'in') (Array.isArray(f.val) ? f.val : [f.val]).forEach((v) => checkUuid(method, table, f.col, v));
            }
            return tables[table].filter((row) => st.filters.every((f) => matchesFilter(row, f)));
        };
        const record = (method, body, count) => log.push({
            method, table, filters: st.filters.map((f) => `${f.col}=${f.op}.${JSON.stringify(f.val)}`), body: clone(body), count
        });

        const q = {
            select(cols = '*') { st.select = cols; return q; },
            order(col, { ascending = true } = {}) { st.order = { col, ascending }; return q; },
            limit(n) { st.limit = n; return q; },
            single() { st.single = true; return q; },
            onConflict(cols) { st.onConflict = cols; return q; },
            or() { throw new Error('fake pgrest: or() not implemented'); },
            range() { throw new Error('fake pgrest: range() not implemented'); },
            count() { throw new Error('fake pgrest: count() not implemented'); },

            async execute() {
                await roundTrip();
                if (!schema[table]) throw missingTable('GET', table);
                const cols = selected();
                checkRead('GET', table, cols.concat(filterCols()));
                let rows = matching('GET');
                if (st.order) rows = sortRows(rows, st.order);
                if (st.limit != null) rows = rows.slice(0, st.limit);
                const out = rows.map((row) => Object.fromEntries(cols.map((c) => [c, row[c] === undefined ? null : clone(row[c])])));
                record('GET', null, out.length);
                // Gancho de prueba: simula otra escritura que llega justo después de esta lectura.
                if (hooks.afterRead) hooks.afterRead({ table, columns: st.select, filters: st.filters.map((f) => ({ ...f })) });
                return st.single ? out[0] || null : out;
            },

            async insert(values, { returning = true } = {}) {
                await roundTrip();
                const { list, created } = insertRows('POST', table, values);
                record('POST', list, created.length);
                return returning ? created.map(clone) : [];
            },

            async upsert(values, { onConflict, returning = true } = {}) {
                await roundTrip();
                const list = (Array.isArray(values) ? values : [values]).map(clone);
                checkWrite('POST', table, list);
                const keys = String(onConflict || st.onConflict || PRIMARY_KEYS[table] || 'id').split(',').map((k) => k.trim());
                const out = [];
                for (const value of list) {
                    const existing = tables[table].find((row) => keys.every((k) => row[k] != null && String(row[k]) === String(value[k])));
                    if (existing) {
                        const next = { ...existing, ...value };
                        if (table === 'user_preferences') next.updated_at = dbNow();
                        checkRow('POST', table, next);
                        if (table === 'artists_db') syncGallery(next);
                        Object.assign(existing, next);
                        out.push(existing);
                    } else {
                        out.push(...insertRows('POST', table, value).created);
                    }
                }
                record('UPSERT', list, out.length);
                return returning ? out.map(clone) : [];
            },

            async patch(values, { returning = true } = {}) {
                await roundTrip();
                // Gancho de prueba: otra escritura que llega justo antes de esta sentencia.
                if (hooks.beforePatch) hooks.beforePatch({ table, body: clone(values), filters: st.filters.map((f) => ({ ...f })) });
                if (!schema[table]) throw missingTable('PATCH', table);
                const body = clone(values);
                checkWrite('PATCH', table, [body]);
                checkRead('PATCH', table, filterCols());
                const rows = matching('PATCH');
                const nexts = rows.map((row) => ({ ...row, ...body }));
                nexts.forEach((next) => checkRow('PATCH', table, next)); // la sentencia es atómica
                if (table === 'artists_db' && Object.keys(body).some((k) => GALLERY_TRIGGER_COLUMNS.includes(k))) nexts.forEach(syncGallery);
                rows.forEach((row, i) => Object.assign(row, nexts[i]));
                record('PATCH', body, rows.length);
                return returning ? rows.map(clone) : [];
            },

            async delete({ returning = false } = {}) {
                await roundTrip();
                if (!schema[table]) throw missingTable('DELETE', table);
                checkRead('DELETE', table, filterCols());
                const rows = matching('DELETE');
                tables[table] = tables[table].filter((row) => !rows.includes(row));
                record('DELETE', null, rows.length);
                return returning ? rows.map(clone) : [];
            }
        };
        for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike']) {
            q[op] = (col, val) => { st.filters.push({ op, col, val }); return q; };
        }
        return q;
    }

    return {
        schema,
        tables,
        log,
        hooks,
        query,
        seed(table, values) { return insertRows('SEED', table, values).created.map(clone); },
        // Escritura "del navegador" (fuera de los servicios), con el trigger de la galería.
        externalPatch(table, predicate, values) {
            for (const row of tables[table].filter(predicate)) {
                Object.assign(row, clone(values));
                if (table === 'artists_db' && Object.keys(values).some((k) => GALLERY_TRIGGER_COLUMNS.includes(k))) syncGallery(row);
            }
        },
        row(table, predicate) { return tables[table].find(predicate) || null; },
        rows(table, predicate = () => true) { return tables[table] ? tables[table].filter(predicate) : []; },
        writes(table, since = 0) {
            return log.slice(since).filter((entry) => entry.method !== 'GET' && (!table || entry.table === table));
        }
    };
}

// ---------------------------------------------------------------------------
// Mundo compartido por los fakes
// ---------------------------------------------------------------------------
const USERS = {
    laura: { id: '1a000000-0000-4000-8000-000000000001', email: 'laura.auth@weotzi.test', created_at: daysAgo(2) },
    mateo: { id: '1a000000-0000-4000-8000-000000000002', email: 'mateo.auth@weotzi.test', created_at: daysAgo(30) },
    nina: { id: '1a000000-0000-4000-8000-000000000003', email: 'nina.auth@weotzi.test', created_at: daysAgo(5) },
    olivia: { id: '1a000000-0000-4000-8000-000000000004', email: 'olivia.auth@weotzi.test', created_at: daysAgo(6) },
    rocio: { id: '1a000000-0000-4000-8000-000000000005', email: 'rocio.auth@weotzi.test', created_at: daysAgo(1) },
    pablo: { id: '1a000000-0000-4000-8000-000000000009', email: 'pablo.auth@weotzi.test', created_at: daysAgo(3) },
    tomas: { id: '1a000000-0000-4000-8000-00000000000a', email: 'tomas.auth@weotzi.test', created_at: daysAgo(4) },
    valen: { id: '1a000000-0000-4000-8000-00000000000b', email: 'valen.auth@weotzi.test', created_at: daysAgo(4) },
    lucia: { id: '1a000000-0000-4000-8000-00000000000c', email: 'lucia.auth@weotzi.test', created_at: daysAgo(2) },
    client: { id: '1a000000-0000-4000-8000-000000000006', email: 'cliente@weotzi.test', created_at: daysAgo(1) },
    agent: { id: '1a000000-0000-4000-8000-000000000007', email: 'sofia.soporte@weotzi.test', created_at: daysAgo(400) },
    retired: { id: '1a000000-0000-4000-8000-000000000008', email: 'ex.soporte@weotzi.test', created_at: daysAgo(400) }
};
const tokenOf = (key) => `token-${key}`;

const world = {
    store: null,
    outbox: [],
    emailResult: { ok: true, provider: 'fake' },
    settings: { n8n_webhook_secret: WEBHOOK_SECRET }
};

// --- Captura de la consola (para verificar que el código nunca se loguea) ----
const consoleLines = [];
const originalConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => {
        consoleLines.push(args.map((a) => (typeof a === 'string' ? a : (a && a.stack) || JSON.stringify(a))).join(' '));
        if (process.env.FLOW_TEST_VERBOSE) originalConsole[level].apply(console, args);
    };
}

// --- Entorno determinístico ----------------------------------------------------
const ENV_KEYS = ['IG_VERIFY_WEBHOOK_SECRET', 'N8N_WEBHOOK_SECRET', 'PUBLIC_APP_URL', 'APP_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
ENV_KEYS.forEach((k) => { delete process.env[k]; });
process.env.PUBLIC_APP_URL = 'https://beta.weotzi.com';

// --- Fakes en require.cache --------------------------------------------------------
function installStub(relPath, exports) {
    const filename = require.resolve(path.join(root, relPath));
    assert.equal(require.cache[filename], undefined, `${relPath} was loaded before the stub was installed`);
    const stub = new Module(filename, module);
    stub.filename = filename;
    stub.paths = Module._nodeModulePaths(path.dirname(filename));
    stub.exports = exports;
    stub.loaded = true;
    require.cache[filename] = stub;
    return filename;
}

function fakePgrest(table, opts) {
    return world.store.query(table, opts);
}
fakePgrest.raw = async () => { throw new Error('fake pgrest: raw() is not used by these services'); };

function bearer(req) {
    const header = req && req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
}

async function fakeResolveBearerUser(req) {
    const token = bearer(req);
    const key = Object.keys(USERS).find((k) => tokenOf(k) === token);
    if (!key) return null;
    const user = USERS[key];
    return { id: user.id, email: user.email, raw: { id: user.id, email: user.email, created_at: user.created_at, aud: 'authenticated' } };
}

const STUBS = {
    postgrest: installStub('lib/postgrest.js', { pgrest: fakePgrest, parseContentRangeTotal: () => null, encodeFilterValue: (op, v) => String(v) }),
    auth: installStub('lib/auth/supabase-auth.js', {
        resolveBearerUser: fakeResolveBearerUser,
        verifyAdminCaller: async () => ({ ok: false, status: 403, error: 'Admin access requires the superadmin account' }),
        isSuperadminEmail: () => false,
        bearerToken: bearer
    }),
    email: installStub('services/email-service.js', {
        async sendEmail(eventId, payload, options) {
            world.outbox.push({ eventId, payload: clone(payload), options: clone(options) });
            if (world.emailResult instanceof Error) throw world.emailResult;
            return clone(world.emailResult);
        }
    }),
    settings: installStub('lib/app-settings.js', {
        async getSetting(key, { envFallback = null } = {}) {
            if (world.settings[key]) return world.settings[key];
            return envFallback && process.env[envFallback] ? process.env[envFallback] : null;
        },
        async getSettingMeta() { return { configured: false }; },
        async setSetting() { throw new Error('fake app-settings: setSetting is not used by these services'); },
        clearCache() {},
        verifyAdminCaller: async () => ({ ok: false, status: 403, error: 'Admin access requires the superadmin account' }),
        isSuperadminEmail: () => false
    })
};

const onboarding = require('../services/artist-onboarding');
const igVerification = require('../services/instagram-verification');
const express = require('express');

// --- Sin red: fetch solo puede ir al servidor de prueba ---------------------------
const realFetch = globalThis.fetch;
let baseUrl = null;
globalThis.fetch = (input, init) => {
    const url = String((input && input.url) || input);
    if (!baseUrl || !url.startsWith(baseUrl)) return Promise.reject(new Error(`offline test: blocked request to ${url}`));
    return realFetch(input, init);
};

// Las mismas rutas que server.js (bloque INSTAGRAM VALIDATION + ARTIST ONBOARDING).
const ROUTES = [
    ['get', '/api/artist/onboarding', 'artistOnboarding', 'getOnboarding'],
    ['post', '/api/artist/onboarding', 'artistOnboarding', 'patchOnboarding'],
    ['get', '/api/artist/instagram-verification', 'igVerification', 'getArtistVerification'],
    ['post', '/api/artist/instagram-verification', 'igVerification', 'requestArtistVerification'],
    ['post', '/api/instagram-verification/inbound', 'igVerification', 'handleInbound'],
    ['get', '/api/support/instagram-verifications', 'igVerification', 'listForSupport'],
    ['post', '/api/support/instagram-verifications/:id/confirm', 'igVerification', 'confirmForSupport'],
    ['post', '/api/support/instagram-verifications/:id/reject', 'igVerification', 'rejectForSupport']
];
const SERVICES = { artistOnboarding: onboarding, igVerification };

let server = null;

before(async () => {
    const app = express();
    app.use(express.json());
    for (const [method, route, service, handler] of ROUTES) app[method](route, SERVICES[service][handler]);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
    globalThis.fetch = realFetch;
    Object.assign(console, originalConsole);
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    for (const filename of Object.values(STUBS)) delete require.cache[filename];
});

async function call(method, url, { as, token, body, headers = {} } = {}) {
    const auth = as ? tokenOf(as) : token;
    const res = await fetch(baseUrl + url, {
        method,
        headers: {
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(auth ? { authorization: `Bearer ${auth}` } : {}),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, text };
}

const inbound = (body, token = WEBHOOK_SECRET) => call('POST', '/api/instagram-verification/inbound', {
    body, headers: token == null ? {} : { 'x-weotzi-webhook-token': token }
});

function assertCodeNotIn(code, texts, where) {
    const variants = [code, code.replace('-', ''), code.toLowerCase()];
    for (const [label, text] of Object.entries(texts)) {
        for (const variant of variants) {
            assert.ok(!String(text).includes(variant), `${where}: the code leaked into ${label}`);
        }
    }
}

const igRows = (userId) => world.store.rows(IG_TABLE, (r) => r.artist_user_id === userId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
const artistRow = (userId) => world.store.row('artists_db', (r) => r.user_id === userId);
const stepOf = (body, id) => body.steps.find((s) => s.id === id);
const checksOf = (step) => Object.fromEntries(step.checks.map((c) => [c.id, c.done]));

async function requestCode(as) {
    const sent = world.outbox.length;
    const res = await call('POST', '/api/artist/instagram-verification', { as, body: {} });
    assert.equal(res.status, 200, `${as} could not request a code: ${res.text}`);
    assert.equal(world.outbox.length, sent + 1);
    const code = world.outbox.at(-1).payload.verification_code;
    assert.match(code, CODE_RE);
    return { res, code };
}

// ---------------------------------------------------------------------------
// Datos semilla
// ---------------------------------------------------------------------------
const LAURA_FEED = [
    { url: 'https://cdn.weotzi.test/works/laura-manual-1.jpg', category: 'blackwork', title: 'Brazo' },
    { url: 'https://cdn.weotzi.test/instagram-import/laura/legacy-1.jpg', source: 'instagram', permalink: 'https://www.instagram.com/p/OLD1/', ig_legacy: true },
    { url: 'https://cdn.weotzi.test/instagram-import/laura/new-1.jpg', source: 'instagram', ig_handle: 'laura.tattoo', imported_at: '2026-10-29T10:00:00.000Z' },
    { url: 'https://cdn.weotzi.test/instagram-import/laura/new-2.jpg', source: 'instagram', ig_handle: 'laura.tattoo', imported_at: '2026-10-29T10:00:00.000Z' }
];

function seedArtist(store, key, overrides = {}) {
    const user = USERS[key];
    const name = key[0].toUpperCase() + key.slice(1);
    return store.seed('artists_db', {
        user_id: user.id,
        username: `${key}.wo`,
        name,
        email: `${key}.contacto@weotzi.test`,
        instagram: `@${name}.Ink`,
        gallery_feed_items: [
            { url: `https://cdn.weotzi.test/works/${key}-manual.jpg`, category: 'fineline' },
            { url: `https://cdn.weotzi.test/instagram-import/${key}/1.jpg`, source: 'instagram', ig_handle: `${key}.ink`, imported_at: '2026-10-29T10:00:00.000Z' }
        ],
        ...overrides
    });
}

function seedMainStore() {
    const store = createStore();
    seedArtist(store, 'laura', { instagram: '@Laura.Tattoo', gallery_feed_items: LAURA_FEED });
    store.seed('support_users_db', { user_id: USERS.agent.id, email: USERS.agent.email, full_name: 'Sofía', role: 'agent', is_active: true });
    store.seed('support_users_db', { user_id: USERS.retired.id, email: USERS.retired.email, full_name: 'Ex', role: 'agent', is_active: false });
    return store;
}

world.store = seedMainStore();

// ===========================================================================
// Tests
// ===========================================================================

test('the test app mounts the same handlers on the same routes as server.js', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    for (const [method, route, service, handler] of ROUTES) {
        const pattern = new RegExp(`app\\.${method}\\('${route.replace(/[/:]/g, (c) => `\\${c}`)}',\\s*(?:\\w+,\\s*)?${service}\\.${handler}\\)`);
        assert.match(source, pattern, `server.js should mount ${method.toUpperCase()} ${route} -> ${service}.${handler}`);
    }
    assert.equal(require.cache[STUBS.postgrest].exports.pgrest, fakePgrest);
});

test('auth: 401 without a valid bearer, 403 for a signed-in user without an artist profile', async () => {
    const logStart = world.store.log.length;
    const artistRoutes = [
        ['GET', '/api/artist/onboarding'],
        ['POST', '/api/artist/onboarding'],
        ['GET', '/api/artist/instagram-verification'],
        ['POST', '/api/artist/instagram-verification']
    ];
    for (const [method, url] of artistRoutes) {
        const body = method === 'POST' ? { assisted: { active: true }, handle: 'cliente.ig' } : undefined;
        const anonymous = await call(method, url, { body });
        assert.equal(anonymous.status, 401, `${method} ${url} without bearer`);
        assert.deepEqual(anonymous.body, { success: false, error: 'Authentication required' });

        const forged = await call(method, url, { token: 'forged-token', body });
        assert.equal(forged.status, 401, `${method} ${url} with an unknown token`);

        const client = await call(method, url, { as: 'client', body });
        assert.equal(client.status, 403, `${method} ${url} as a non-artist`);
        assert.deepEqual(client.body, { success: false, error: 'Artist profile required' });
    }
    for (const [method, url] of [
        ['GET', '/api/support/instagram-verifications'],
        ['POST', `/api/support/instagram-verifications/${crypto.randomUUID()}/confirm`],
        ['POST', `/api/support/instagram-verifications/${crypto.randomUUID()}/reject`]
    ]) {
        const anonymous = await call(method, url, { body: method === 'POST' ? { force: true } : undefined });
        assert.equal(anonymous.status, 401, `${method} ${url} without bearer`);
    }
    assert.deepEqual(world.store.writes(null, logStart), [], 'rejected callers must not write anything');
    assert.equal(world.outbox.length, 0, 'rejected callers must not trigger emails');
});

test('GET /api/artist/onboarding: default state of a fresh artist', async () => {
    const logStart = world.store.log.length;
    const res = await call('GET', '/api/artist/onboarding', { as: 'laura' });
    assert.equal(res.status, 200, res.text);
    const body = res.body;
    assert.equal(body.success, true);
    assert.equal(body.user_id, USERS.laura.id);
    assert.equal(body.username, 'laura.wo');
    assert.equal(body.artist_name, 'Laura');
    assert.equal(body.is_new, true);
    assert.equal(body.account_created_at, USERS.laura.created_at);
    assert.equal(body.new_window_days, 14);
    assert.equal(body.profile_url, 'https://beta.weotzi.com/artist/profile?artist=laura');
    assert.deepEqual(body.onboarding, {
        demo_suggestions: true,
        demo_auto_started_at: null,
        assisted: { active: false, started_at: null, completed_at: null, welcome_seen_at: null, acknowledged: {}, skipped: {} }
    });

    assert.equal(body.steps.length, 8);
    assert.deepEqual(body.steps.map((s) => [s.id, s.title]), STEP_TITLES);
    for (const step of body.steps) {
        assert.equal(step.status, 'pending', `${step.id} should start pending`);
        assert.ok(step.checks.length > 0);
        for (const c of step.checks) {
            assert.deepEqual(Object.keys(c).sort(), ['done', 'id', 'label', 'optional']);
            assert.equal(typeof c.label, 'string');
        }
    }
    assert.deepEqual(stepOf(body, 'perfil').checks.map((c) => [c.id, c.optional]),
        [['banner', false], ['foto', false], ['redes', false], ['whatsapp', false], ['email', false], ['bio', true]]);
    assert.equal(body.current_step, 'perfil');
    assert.equal(body.completed, false);
    assert.deepEqual(body.progress, { done: 0, total: 8 });

    assert.equal(body.instagram.available, true);
    assert.equal(body.instagram.status, 'none');
    assert.equal(body.instagram.handle, 'laura.tattoo');
    assert.equal(body.instagram.verified_handle, null);
    assert.equal(body.instagram.verified_at, null);
    assert.equal(body.instagram.expires_at, null);
    assert.equal(body.instagram.email_masked, null);
    assert.equal(body.instagram.pending_items, 2, 'two new Instagram photos wait for validation');
    assert.equal(body.instagram.legacy_items, 1);
    assert.deepEqual(checksOf(stepOf(body, 'portafolio')), { trabajos: true, instagram_validado: false, portafolio_validado: false });

    assert.deepEqual(world.store.writes('user_preferences', logStart), [], 'a GET must not create preferences');
    assert.deepEqual(world.store.writes('artists_db', logStart), []);
    // Sanity of the seed: the trigger keeps the new Instagram photos out of gallery_images.
    assert.deepEqual(artistRow(USERS.laura.id).gallery_images, [LAURA_FEED[0].url, LAURA_FEED[1].url]);
});

test('POST /api/artist/onboarding: assisted lifecycle keeps every other app_settings key', async (t) => {
    const original = {
        user_id: USERS.laura.id,
        notification_prefs: { quotes: { email: true, push: false } },
        privacy: { show_city: false },
        app_settings: {
            profile: { banner_url: 'https://cdn.weotzi.test/banners/laura.jpg', tiktok: '@laura.tk' },
            availability: { weekly: [{ day: 'lunes', enabled: true, start: '10:00', end: '18:00' }], locations: {} },
            reminders: [{ text: 'Comprar tinta', type: 'note', done: false }],
            recovery: { phone: '+5491100000000' },
            timezone: 'America/Argentina/Buenos_Aires',
            country: 'AR',
            onboarding: { demo_suggestions: true, demo_auto_started_at: '2026-10-28T12:00:00.000Z' }
        }
    };
    world.store.seed('user_preferences', original);
    const prefs = () => world.store.row('user_preferences', (r) => r.user_id === USERS.laura.id);
    const withoutOnboarding = (settings) => { const { onboarding: _ignored, ...rest } = settings; return rest; };
    const assertUntouched = (label) => {
        const row = prefs();
        assert.deepEqual(withoutOnboarding(row.app_settings), withoutOnboarding(original.app_settings), `${label}: other app_settings keys`);
        assert.deepEqual(row.notification_prefs, original.notification_prefs, `${label}: notification_prefs`);
        assert.deepEqual(row.privacy, original.privacy, `${label}: privacy`);
    };
    let startedAt = null;

    await t.test('assisted.active=true sets started_at and keeps the demo flags', async () => {
        const res = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { active: true } } });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.onboarding.assisted.active, true);
        startedAt = res.body.onboarding.assisted.started_at;
        assert.ok(Number.isFinite(Date.parse(startedAt)));
        assert.equal(res.body.onboarding.demo_auto_started_at, '2026-10-28T12:00:00.000Z');
        assert.equal(res.body.steps.length, 8);
        assert.equal(stepOf(res.body, 'notificaciones').status, 'done', 'saved notification_prefs complete the step');
        assert.equal(checksOf(stepOf(res.body, 'disponibilidad')).horarios, true);
        assert.equal(prefs().app_settings.onboarding.assisted.active, true);
        assert.equal(prefs().app_settings.onboarding.assisted.started_at, startedAt);
        assertUntouched('after active=true');
    });

    await t.test('acknowledge compartir marks ms_profile_shared and completes the step', async () => {
        const res = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { acknowledge: 'compartir' } } });
        assert.equal(res.status, 200, res.text);
        assert.ok(res.body.onboarding.assisted.acknowledged.compartir);
        assert.equal(stepOf(res.body, 'compartir').status, 'done');
        assert.equal(artistRow(USERS.laura.id).ms_profile_shared, true);
        assertUntouched('after acknowledge');
    });

    await t.test('skip and unskip retiro', async () => {
        const skipped = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { skip: 'retiro' } } });
        assert.equal(skipped.status, 200, skipped.text);
        assert.equal(stepOf(skipped.body, 'retiro').status, 'skipped');
        assert.ok(skipped.body.onboarding.assisted.skipped.retiro);
        assert.notEqual(skipped.body.current_step, 'retiro');

        const unskipped = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { unskip: 'retiro' } } });
        assert.equal(unskipped.status, 200, unskipped.text);
        assert.equal(stepOf(unskipped.body, 'retiro').status, 'pending');
        assert.deepEqual(unskipped.body.onboarding.assisted.skipped, {});
        assert.deepEqual(prefs().app_settings.onboarding.assisted.skipped, {});
        assert.ok(prefs().app_settings.onboarding.assisted.acknowledged.compartir, 'the earlier ack survives');
        assertUntouched('after unskip');
    });

    await t.test('invalid ack is a 400 without writes; an empty body writes nothing', async () => {
        const logStart = world.store.log.length;
        const bad = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { acknowledge: 'retiro' } } });
        assert.equal(bad.status, 400);
        assert.equal(bad.body.success, false);
        const empty = await call('POST', '/api/artist/onboarding', { as: 'laura', body: {} });
        assert.equal(empty.status, 200);
        assert.deepEqual(world.store.writes('user_preferences', logStart), []);
    });

    await t.test('demo_suggestions=false and a second active=true keep started_at', async () => {
        const res = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { demo_suggestions: false, assisted: { active: true } } });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.onboarding.demo_suggestions, false);
        assert.equal(res.body.onboarding.assisted.started_at, startedAt);
        assert.equal(prefs().app_settings.onboarding.demo_suggestions, false);
        assertUntouched('after demo_suggestions=false');
    });
});

// wo-assist.js skipLater() renders the next step at once and fires the POST
// without waiting, so tapping "más tarde" on two steps in a row overlaps two POSTs.
// patchOnboarding reads app_settings, merges and upserts the whole object, so it
// runs in a per-user queue: the second POST reads what the first one saved.
test('two overlapping onboarding POSTs keep both changes', async () => {
    seedArtist(world.store, 'pablo');
    world.store.seed('user_preferences', { user_id: USERS.pablo.id, app_settings: { timezone: 'America/Argentina/Buenos_Aires' } });
    const results = await Promise.all([
        call('POST', '/api/artist/onboarding', { as: 'pablo', body: { assisted: { skip: 'retiro' } } }),
        call('POST', '/api/artist/onboarding', { as: 'pablo', body: { assisted: { skip: 'verificacion' } } })
    ]);
    assert.ok(results.every((r) => r.status === 200), results.map((r) => r.text).join('\n'));
    const stored = world.store.row('user_preferences', (r) => r.user_id === USERS.pablo.id).app_settings.onboarding.assisted.skipped;
    assert.deepEqual(Object.keys(stored).sort(), ['retiro', 'verificacion'], 'both skips must be persisted');
    const state = await call('GET', '/api/artist/onboarding', { as: 'pablo' });
    assert.equal(stepOf(state.body, 'retiro').status, 'skipped');
    assert.equal(stepOf(state.body, 'verificacion').status, 'skipped');
});

test('POST /api/artist/onboarding creates the preferences row for an artist without one', async () => {
    seedArtist(world.store, 'rocio', { instagram: '@Rocio.Ink' });
    assert.equal(world.store.row('user_preferences', (r) => r.user_id === USERS.rocio.id), null);
    const res = await call('POST', '/api/artist/onboarding', { as: 'rocio', body: { assisted: { active: true } } });
    assert.equal(res.status, 200, res.text);
    const row = world.store.row('user_preferences', (r) => r.user_id === USERS.rocio.id);
    assert.ok(row, 'the upsert created the row');
    assert.equal(row.app_settings.onboarding.assisted.active, true);
    assert.deepEqual(row.notification_prefs, {});
});

test('Instagram validation: code by email, DM webhook, replay and onboarding checks', async (t) => {
    const laura = USERS.laura;
    let firstCode = null;
    let code = null;

    await t.test('GET state before asking for a code', async () => {
        const res = await call('GET', '/api/artist/instagram-verification', { as: 'laura' });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.success, true);
        assert.equal(res.body.available, true);
        assert.equal(res.body.status, 'none');
        assert.equal(res.body.handle, 'laura.tattoo');
        assert.equal(res.body.pending_items, 2);
        assert.deepEqual(res.body.instructions, { account: 'weotzi', follow_url: 'https://www.instagram.com/weotzi/', dm_url: 'https://ig.me/m/weotzi' });
    });

    await t.test('POST emails the code to the auth email and never returns it', async () => {
        const consoleStart = consoleLines.length;
        const { res, code: sent } = await requestCode('laura');
        firstCode = sent;
        assert.equal(res.body.success, true);
        assert.equal(res.body.status, 'pending');
        assert.equal(res.body.handle, 'laura.tattoo');
        assert.equal(res.body.email_sent, true);
        assert.equal(res.body.email_masked, igVerification.maskEmail(laura.email));
        const ttl = Date.parse(res.body.expires_at) - Date.now();
        assert.ok(ttl > 71.9 * HOUR && ttl <= 72 * HOUR, `expires in 72 h (got ${ttl} ms)`);

        const mail = world.outbox.at(-1);
        assert.equal(mail.eventId, 'instagram_verification_code');
        assert.deepEqual({ ...mail.payload, verification_code: '<code>' }, {
            artist_email: laura.email,
            artist_name: 'Laura',
            verification_code: '<code>',
            instagram_handle: '@laura.tattoo',
            expires_label: '72 horas',
            weotzi_instagram: '@weotzi',
            dm_url: 'https://ig.me/m/weotzi'
        });
        const rows = igRows(laura.id);
        assert.equal(rows.length, 1);
        assert.equal(mail.options.idempotencyKey, `ig-verify:${laura.id}:${rows[0].id}`);
        assert.equal(rows[0].code_hash, sha256(firstCode), 'only the sha256 is stored');
        assert.equal(rows[0].status, 'pending');
        assert.equal(rows[0].ig_handle, 'laura.tattoo');
        assert.equal(rows[0].email_sent, true);
        assert.equal(rows[0].email_sent_to, laura.email);
        assertCodeNotIn(firstCode, {
            'the HTTP response': res.text,
            'the database': JSON.stringify(world.store.tables),
            'the server logs': consoleLines.slice(consoleStart).join('\n')
        }, 'request');
    });

    await t.test('a second request replaces the previous pending code', async () => {
        const { res, code: sent } = await requestCode('laura');
        code = sent;
        assert.notEqual(code, firstCode);
        assertCodeNotIn(code, { 'the HTTP response': res.text }, 'second request');
        const rows = igRows(laura.id);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].status, 'cancelled');
        assert.equal(rows[1].status, 'pending');
        assert.equal(rows.filter((r) => r.status === 'pending').length, 1);
    });

    await t.test('state and onboarding while the code is pending', async () => {
        const state = await call('GET', '/api/artist/instagram-verification', { as: 'laura' });
        assert.equal(state.body.status, 'pending');
        assert.equal(state.body.expires_at, igRows(laura.id)[1].expires_at);
        assert.equal(state.body.email_masked, igVerification.maskEmail(laura.email));
        assertCodeNotIn(code, { 'the state response': state.text }, 'state');

        const onb = await call('GET', '/api/artist/onboarding', { as: 'laura' });
        assert.equal(onb.status, 200, onb.text);
        assert.equal(onb.body.instagram.status, 'pending');
        assert.equal(stepOf(onb.body, 'portafolio').status, 'pending');
        assert.deepEqual(checksOf(stepOf(onb.body, 'portafolio')), { trabajos: true, instagram_validado: false, portafolio_validado: false });
        assertCodeNotIn(code, { 'the onboarding response': onb.text }, 'onboarding');
    });

    await t.test('webhook with a missing or wrong token is refused before reading anything', async () => {
        const logStart = world.store.log.length;
        const dm = { sender_username: 'laura.tattoo', message_text: code, follows_business: true };
        const missing = await inbound(dm, null);
        assert.equal(missing.status, 401);
        const wrong = await inbound(dm, 'not-the-secret');
        assert.equal(wrong.status, 401);
        assert.equal(wrong.body.success, false);
        assert.equal(world.store.log.length, logStart, 'no query ran for a refused webhook');

        // IG_VERIFY_WEBHOOK_SECRET takes precedence over the shared n8n secret.
        process.env.IG_VERIFY_WEBHOOK_SECRET = 'ig-own-secret';
        try {
            assert.equal((await inbound({ sender_username: 'laura.tattoo', message_text: 'hola' })).status, 401);
            const own = await inbound({ sender_username: 'laura.tattoo', message_text: 'hola' }, 'ig-own-secret');
            assert.equal(own.status, 200);
            assert.equal(own.body.reason, 'no_code');
        } finally {
            delete process.env.IG_VERIFY_WEBHOOK_SECRET;
        }
        assert.equal(artistRow(laura.id).instagram_verified_at, null);
        assert.equal(igRows(laura.id)[1].status, 'pending');
    });

    await t.test('a DM from another account does not validate', async () => {
        const res = await inbound({ sender_username: 'impostor.ink', message_text: `hola, mi código es ${code}`, follows_business: true });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, verified: false, reason: 'handle_mismatch' });
        const row = igRows(laura.id)[1];
        assert.equal(row.status, 'pending');
        assert.equal(row.attempts, 1);
        assert.equal(row.dm_sender_handle, 'impostor.ink');
        assert.equal(artistRow(laura.id).instagram_verified_at, null);
    });

    await t.test('the replaced code and a DM from a non-follower do not validate', async () => {
        const replaced = await inbound({ sender_username: '@Laura.Tattoo', message_text: firstCode, follows_business: true });
        assert.deepEqual(replaced.body, { success: true, verified: false, reason: 'code_not_pending' });
        const notFollowing = await inbound({ sender_username: 'laura.tattoo', message_text: code, follows_business: false });
        assert.deepEqual(notFollowing.body, { success: true, verified: false, reason: 'not_following' });
        assert.equal(artistRow(laura.id).instagram_verified_at, null);
        assert.equal(igRows(laura.id)[1].status, 'pending');
    });

    let verifiedAt = null;
    let logAfterVerify = 0;

    await t.test('right sender + code validates and writes only the verification columns', async () => {
        const feedBefore = clone(artistRow(laura.id).gallery_feed_items);
        const logStart = world.store.log.length;
        const res = await inbound({ sender_username: '@Laura.Tattoo', message_text: `hola!! te mando el código ${code.toLowerCase()} gracias`, follows_business: true });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.body, { success: true, verified: true, reason: 'verified' });

        const artist = artistRow(laura.id);
        verifiedAt = artist.instagram_verified_at;
        assert.ok(Number.isFinite(Date.parse(verifiedAt)));
        assert.equal(artist.instagram_verified_handle, 'laura.tattoo', 'stored lowercase and without @');
        const artistPatches = world.store.writes('artists_db', logStart);
        assert.equal(artistPatches.length, 1, 'one write to artists_db');
        assert.deepEqual(artistPatches[0].body, { instagram_verified_at: verifiedAt, instagram_verified_handle: 'laura.tattoo' },
            'gallery_feed_items is not rewritten: the trigger also fires on the verification columns');
        assert.ok(!world.store.log.slice(logStart).some((e) => e.method === 'GET' && e.table === 'artists_db'), 'the feed is not read to validate');
        assert.deepEqual(artist.gallery_feed_items, feedBefore);
        assert.deepEqual(artist.gallery_images, LAURA_FEED.map((item) => item.url), 'the new Instagram photos are public now');

        const row = igRows(laura.id)[1];
        assert.equal(row.status, 'verified');
        assert.equal(row.verified_via, 'dm_webhook');
        assert.equal(row.verified_at, verifiedAt);
        assert.equal(row.dm_sender_handle, 'laura.tattoo');
        logAfterVerify = world.store.log.length;
    });

    await t.test('replaying the same DM has no further effect', async () => {
        const replay = await inbound({ sender_username: 'laura.tattoo', message_text: code, follows_business: true });
        assert.equal(replay.status, 200);
        assert.deepEqual(replay.body, { success: true, verified: false, reason: 'code_not_pending' });
        assert.deepEqual(world.store.writes('artists_db', logAfterVerify), []);
        assert.equal(artistRow(laura.id).instagram_verified_at, verifiedAt);
        assert.equal(igRows(laura.id)[1].verified_at, verifiedAt);
    });

    await t.test('onboarding: the portafolio checks flip to done', async () => {
        const onb = await call('GET', '/api/artist/onboarding', { as: 'laura' });
        assert.equal(onb.status, 200, onb.text);
        assert.equal(onb.body.instagram.available, true);
        assert.equal(onb.body.instagram.status, 'verified');
        assert.equal(onb.body.instagram.verified_handle, 'laura.tattoo');
        assert.equal(onb.body.instagram.verified_at, verifiedAt);
        assert.equal(onb.body.instagram.pending_items, 0);
        assert.equal(onb.body.instagram.legacy_items, 1);
        assert.deepEqual(checksOf(stepOf(onb.body, 'portafolio')), { trabajos: true, instagram_validado: true, portafolio_validado: true });
        assert.equal(stepOf(onb.body, 'portafolio').status, 'done');
    });

    await t.test('asking again for the validated handle is a 409 without email', async () => {
        const sent = world.outbox.length;
        const rows = igRows(laura.id).length;
        const res = await call('POST', '/api/artist/instagram-verification', { as: 'laura', body: { handle: '@LAURA.TATTOO' } });
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'IG_ALREADY_VERIFIED');
        assert.equal(world.outbox.length, sent);
        assert.equal(igRows(laura.id).length, rows);
    });
});

test('support queue: non-support callers are refused, agents list, confirm and reject', async (t) => {
    seedArtist(world.store, 'mateo');
    seedArtist(world.store, 'nina');
    const mateoCode = (await requestCode('mateo')).code;
    const ninaCode = (await requestCode('nina')).code;
    const mateoRow = () => igRows(USERS.mateo.id).at(-1);
    const ninaRow = () => igRows(USERS.nina.id).at(-1);
    const base = '/api/support/instagram-verifications';

    await t.test('artists and inactive agents get 403 and change nothing', async () => {
        const logStart = world.store.log.length;
        for (const as of ['laura', 'retired']) {
            const list = await call('GET', `${base}?status=all`, { as });
            assert.equal(list.status, 403, `${as} list`);
            assert.deepEqual(list.body, { success: false, error: 'Support agent access required' });
            assert.equal((await call('POST', `${base}/${mateoRow().id}/confirm`, { as, body: { force: true } })).status, 403);
            assert.equal((await call('POST', `${base}/${mateoRow().id}/reject`, { as, body: { note: 'x' } })).status, 403);
        }
        assert.deepEqual(world.store.writes(null, logStart), []);
        assert.equal(mateoRow().status, 'pending');
    });

    await t.test('the agent lists the queue without codes or hashes', async () => {
        const res = await call('GET', base, { as: 'agent' });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.success, true);
        assert.ok(res.body.items.every((i) => i.status === 'pending'), 'default filter is pending');
        const ids = res.body.items.map((i) => i.id);
        assert.ok(ids.includes(mateoRow().id) && ids.includes(ninaRow().id));
        assert.ok(!ids.includes(igRows(USERS.laura.id)[1].id), 'validated rows are not pending');
        const item = res.body.items.find((i) => i.id === mateoRow().id);
        for (const key of ['id', 'artist_user_id', 'artist_name', 'username', 'ig_handle', 'status', 'created_at', 'expires_at', 'verified_at', 'verified_via', 'email_masked', 'pending_items']) {
            assert.ok(Object.prototype.hasOwnProperty.call(item, key), `item.${key}`);
        }
        assert.equal(item.artist_user_id, USERS.mateo.id);
        assert.equal(item.artist_name, 'Mateo');
        assert.equal(item.username, 'mateo.wo');
        assert.equal(item.ig_handle, 'mateo.ink');
        assert.equal(item.email_masked, igVerification.maskEmail(USERS.mateo.email));
        assert.equal(item.pending_items, 1);
        assert.ok(!res.text.includes('code_hash') && !res.text.includes(mateoRow().code_hash));
        assertCodeNotIn(mateoCode, { 'the support list': res.text }, 'support list');
        assertCodeNotIn(ninaCode, { 'the support list': res.text }, 'support list');

        const verified = await call('GET', `${base}?status=verified`, { as: 'agent' });
        const lauraItem = verified.body.items.find((i) => i.artist_user_id === USERS.laura.id);
        assert.equal(lauraItem.verified_via, 'dm_webhook');
        const all = await call('GET', `${base}?status=all`, { as: 'agent' });
        assert.ok(all.body.items.some((i) => i.status === 'cancelled'));
        assert.equal((await call('GET', `${base}?status=bogus`, { as: 'agent' })).status, 400);
    });

    await t.test('confirm validates its input', async () => {
        const url = `${base}/${mateoRow().id}/confirm`;
        const noCode = await call('POST', url, { as: 'agent', body: {} });
        assert.equal(noCode.status, 400);
        assert.equal(noCode.body.code, 'IG_CODE_REQUIRED');
        const otherCode = mateoCode === 'WO-AAAAAA' ? 'WO-BBBBBB' : 'WO-AAAAAA';
        const mismatch = await call('POST', url, { as: 'agent', body: { code: otherCode } });
        assert.equal(mismatch.status, 400);
        assert.equal(mismatch.body.code, 'IG_CODE_MISMATCH');
        const invalid = await call('POST', url, { as: 'agent', body: { code: 'hola' } });
        assert.equal(invalid.body.code, 'IG_CODE_INVALID');
        assert.equal((await call('POST', `${base}/not-a-uuid/confirm`, { as: 'agent', body: { force: true } })).status, 400);
        assert.equal((await call('POST', `${base}/${crypto.randomUUID()}/confirm`, { as: 'agent', body: { force: true } })).status, 404);
        assert.equal(mateoRow().status, 'pending');
        assert.equal(artistRow(USERS.mateo.id).instagram_verified_at, null);
    });

    await t.test('confirm with the code validates the artist', async () => {
        const feedBefore = clone(artistRow(USERS.mateo.id).gallery_feed_items);
        const logStart = world.store.log.length;
        const res = await call('POST', `${base}/${mateoRow().id}/confirm`, { as: 'agent', body: { code: mateoCode.toLowerCase(), note: 'Revisado por DM' } });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.success, true);
        assert.equal(res.body.status, 'verified');
        assert.equal(res.body.ig_handle, 'mateo.ink');
        const row = mateoRow();
        assert.equal(row.status, 'verified');
        assert.equal(row.verified_via, 'support');
        assert.equal(row.verified_by, USERS.agent.id);
        assert.equal(row.note, 'Revisado por DM');
        const artist = artistRow(USERS.mateo.id);
        assert.equal(artist.instagram_verified_at, res.body.verified_at);
        assert.equal(artist.instagram_verified_handle, 'mateo.ink');
        const patches = world.store.writes('artists_db', logStart);
        assert.equal(patches.length, 1);
        assert.deepEqual(Object.keys(patches[0].body).sort(), ['instagram_verified_at', 'instagram_verified_handle']);
        assert.deepEqual(artist.gallery_feed_items, feedBefore);
        assert.ok(artist.gallery_images.includes('https://cdn.weotzi.test/instagram-import/mateo/1.jpg'));

        assert.equal((await call('POST', `${base}/${row.id}/confirm`, { as: 'agent', body: { force: true } })).status, 409);
        const lateDm = await inbound({ sender_username: 'mateo.ink', message_text: mateoCode });
        assert.equal(lateDm.body.verified, false);
        assert.equal(lateDm.body.reason, 'code_not_pending');

        const onb = await call('GET', '/api/artist/onboarding', { as: 'mateo' });
        assert.equal(onb.status, 200, onb.text);
        assert.equal(onb.body.is_new, false, 'account older than 14 days');
        assert.equal(onb.body.instagram.status, 'verified');
        assert.equal(onb.body.instagram.pending_items, 0);
    });

    await t.test('reject keeps the artist unvalidated', async () => {
        const id = ninaRow().id;
        const res = await call('POST', `${base}/${id}/reject`, { as: 'agent', body: { note: 'La cuenta no coincide' } });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.body, { success: true, id, status: 'rejected' });
        assert.equal(ninaRow().status, 'rejected');
        assert.equal(ninaRow().note, 'La cuenta no coincide');
        assert.equal(ninaRow().verified_by, USERS.agent.id);
        assert.equal(artistRow(USERS.nina.id).instagram_verified_at, null);
        assert.equal((await call('POST', `${base}/${id}/reject`, { as: 'agent', body: {} })).status, 409);
        assert.equal((await call('POST', `${base}/${crypto.randomUUID()}/reject`, { as: 'agent', body: {} })).status, 404);

        const dm = await inbound({ sender_username: 'nina.ink', message_text: ninaCode });
        assert.deepEqual(dm.body, { success: true, verified: false, reason: 'code_not_pending' });
        assert.equal(artistRow(USERS.nina.id).instagram_verified_at, null);
        const state = await call('GET', '/api/artist/instagram-verification', { as: 'nina' });
        assert.equal(state.body.status, 'none');
    });

    await t.test('an expired code needs force to be confirmed', async () => {
        await requestCode('nina');
        const row = world.store.row(IG_TABLE, (r) => r.id === ninaRow().id);
        row.expires_at = new Date(Date.now() - HOUR).toISOString();
        const code = world.outbox.at(-1).payload.verification_code;
        const noForce = await call('POST', `${base}/${row.id}/confirm`, { as: 'agent', body: { code } });
        assert.equal(noForce.status, 409);
        assert.equal(noForce.body.code, 'IG_CODE_EXPIRED');
        assert.equal(artistRow(USERS.nina.id).instagram_verified_at, null);
        const forced = await call('POST', `${base}/${row.id}/confirm`, { as: 'agent', body: { code, force: true } });
        assert.equal(forced.status, 200, forced.text);
        assert.equal(artistRow(USERS.nina.id).instagram_verified_handle, 'nina.ink');
    });
});

let racedDeliveries = null;

test('simultaneous deliveries of the same DM validate exactly once', async () => {
    seedArtist(world.store, 'olivia');
    const { code } = await requestCode('olivia');
    const logStart = world.store.log.length;
    const dm = { sender_username: 'olivia.ink', message_text: code, follows_business: true };
    const results = await Promise.all([inbound(dm), inbound(dm), inbound(dm)]);
    racedDeliveries = results;
    assert.ok(results.every((r) => r.status === 200), results.map((r) => r.text).join('\n'));
    assert.equal(results.filter((r) => r.body.verified === true).length, 1);
    assert.ok(results.filter((r) => !r.body.verified).every((r) => r.body.success === true && r.body.verified === false));
    const verifyWrites = world.store.writes('artists_db', logStart).filter((w) => w.body && w.body.instagram_verified_at);
    assert.equal(verifyWrites.length, 1, 'artists_db is validated once');
    assert.equal(igRows(USERS.olivia.id).at(-1).status, 'verified');
});

// A delivery that loses markVerified's claim answers the same documented reason
// as a sequential replay ('code_not_pending'), so a DM automation that branches
// on `reason` sees one value for the same situation.
test('a delivery that loses the claim reports the documented reason', () => {
    assert.ok(racedDeliveries, 'runs after the simultaneous-deliveries test');
    const losers = racedDeliveries.filter((r) => !r.body.verified);
    assert.ok(losers.length > 0);
    assert.deepEqual([...new Set(losers.map((r) => r.body.reason))], ['code_not_pending']);
});

// requestArtistVerificationHandler inserts the new row and then cancels only the
// OLDER pending rows of the artist (created_at < its own). Two overlapping
// requests (two tabs or devices) no longer cancel each other: the newer code stays live.
test('two overlapping code requests leave exactly one live code', async () => {
    seedArtist(world.store, 'tomas');
    const sent = world.outbox.length;
    const results = await Promise.all([
        call('POST', '/api/artist/instagram-verification', { as: 'tomas', body: {} }),
        call('POST', '/api/artist/instagram-verification', { as: 'tomas', body: {} })
    ]);
    assert.ok(results.every((r) => r.status === 200 && r.body.status === 'pending'), results.map((r) => r.text).join('\n'));
    assert.equal(world.outbox.length, sent + 2, 'both requests emailed a code');
    const pending = igRows(USERS.tomas.id).filter((r) => r.status === 'pending');
    assert.equal(pending.length, 1, `exactly one code must stay valid (statuses: ${igRows(USERS.tomas.id).map((r) => r.status).join(', ')})`);
    assert.equal(pending[0].id, igRows(USERS.tomas.id).at(-1).id, 'the newer code is the one that stays live');
    const state = await call('GET', '/api/artist/instagram-verification', { as: 'tomas' });
    assert.equal(state.body.status, 'pending', 'the artist was told a code is on its way');
    const liveMail = world.outbox.slice(sent).find((m) => m.options.idempotencyKey === `ig-verify:${USERS.tomas.id}:${pending[0].id}`);
    assert.ok(liveMail, 'the live code was emailed');
    const dm = await inbound({ sender_username: 'tomas.ink', message_text: liveMail.payload.verification_code, follows_business: true });
    assert.deepEqual(dm.body, { success: true, verified: true, reason: 'verified' });
});

// markVerified patches only instagram_verified_at / instagram_verified_handle:
// the migration's trigger fires on those columns and recalculates gallery_images.
// Writing back a copy of gallery_feed_items read earlier would revert a gallery
// edit the artist saves in the meantime.
test('validating does not revert a gallery edit saved at the same moment', async (t) => {
    seedArtist(world.store, 'valen');
    const { code } = await requestCode('valen');
    const newWork = { url: 'https://cdn.weotzi.test/works/valen-just-uploaded.jpg', category: 'fineline' };
    t.after(() => { world.store.hooks.beforePatch = null; });
    world.store.hooks.beforePatch = ({ table, body, filters }) => {
        const forValen = filters.some((f) => f.col === 'user_id' && f.val === USERS.valen.id);
        if (table !== 'artists_db' || !forValen || !('instagram_verified_at' in body)) return;
        world.store.hooks.beforePatch = null;
        // The artist uploads a work from the dashboard right now (browser write, own RLS session),
        // after the webhook started and just before the verification patch lands.
        const current = artistRow(USERS.valen.id).gallery_feed_items;
        world.store.externalPatch('artists_db', (r) => r.user_id === USERS.valen.id, { gallery_feed_items: current.concat(newWork) });
    };
    const res = await inbound({ sender_username: 'valen.ink', message_text: code });
    assert.equal(res.body.verified, true, res.text);
    assert.equal(world.store.hooks.beforePatch, null, 'the browser write was injected');
    const artist = artistRow(USERS.valen.id);
    assert.equal(artist.instagram_verified_handle, 'valen.ink');
    assert.ok(artist.gallery_feed_items.some((item) => item.url === newWork.url), 'the work uploaded meanwhile must survive');
    assert.ok(artist.gallery_images.includes(newWork.url), 'the trigger recalculated gallery_images with the new work');
    assert.ok(artist.gallery_images.includes('https://cdn.weotzi.test/instagram-import/valen/1.jpg'), 'the validated account photo is public');
});

// The artist asked for a code with a typo in Mi perfil and then fixed the handle.
// That code can only be sent from the old account, so the state must not say
// "pending" for the corrected one: it answers 'none' and a new code replaces the old.
test('a pending code for a handle the artist has since changed is not reported as pending', async () => {
    const lucia = USERS.lucia;
    seedArtist(world.store, 'lucia', { instagram: '@lucia.tatoo' });
    const { code: oldCode } = await requestCode('lucia');
    assert.equal(igRows(lucia.id).at(-1).ig_handle, 'lucia.tatoo');
    world.store.externalPatch('artists_db', (r) => r.user_id === lucia.id, { instagram: '@Lucia.Tattoo' });

    const state = await call('GET', '/api/artist/instagram-verification', { as: 'lucia' });
    assert.equal(state.status, 200, state.text);
    assert.equal(state.body.status, 'none', 'the live code belongs to the old handle');
    assert.equal(state.body.handle, 'lucia.tattoo');
    assert.equal(state.body.expires_at, null);
    assert.equal(state.body.email_masked, null);
    const onb = await call('GET', '/api/artist/onboarding', { as: 'lucia' });
    assert.equal(onb.body.instagram.status, 'none');

    const { res, code } = await requestCode('lucia');
    assert.equal(res.body.handle, 'lucia.tattoo');
    assert.deepEqual(igRows(lucia.id).map((r) => [r.ig_handle, r.status]), [['lucia.tatoo', 'cancelled'], ['lucia.tattoo', 'pending']]);
    assert.equal((await call('GET', '/api/artist/instagram-verification', { as: 'lucia' })).body.status, 'pending');
    assert.equal((await inbound({ sender_username: 'lucia.tatoo', message_text: oldCode })).body.reason, 'code_not_pending');
    const dm = await inbound({ sender_username: 'lucia.tattoo', message_text: code });
    assert.deepEqual(dm.body, { success: true, verified: true, reason: 'verified' });
    assert.equal(artistRow(lucia.id).instagram_verified_handle, 'lucia.tattoo');
});

test('an expired code is reported by the webhook and the state', async () => {
    const { code } = await requestCode('rocio');
    const row = igRows(USERS.rocio.id).at(-1);
    world.store.row(IG_TABLE, (r) => r.id === row.id).expires_at = new Date(Date.now() - 60 * 1000).toISOString();
    const dm = await inbound({ sender_username: 'rocio.ink', message_text: code });
    assert.deepEqual(dm.body, { success: true, verified: false, reason: 'code_expired' });
    assert.equal(igRows(USERS.rocio.id).at(-1).status, 'expired', 'stale codes are expired lazily');
    assert.equal(artistRow(USERS.rocio.id).instagram_verified_at, null);
    const state = await call('GET', '/api/artist/instagram-verification', { as: 'rocio' });
    assert.equal(state.body.status, 'expired');
    const onb = await call('GET', '/api/artist/onboarding', { as: 'rocio' });
    assert.equal(onb.body.instagram.status, 'expired');
});

test('a failed email keeps the code pending and answers email_sent:false', async (t) => {
    t.after(() => { world.emailResult = { ok: true, provider: 'fake' }; });
    for (const failure of [{ ok: false, error: 'provider down' }, new Error('SMTP timeout')]) {
        world.emailResult = failure;
        const consoleStart = consoleLines.length;
        const { res, code } = await requestCode('rocio');
        assert.equal(res.body.success, true);
        assert.equal(res.body.email_sent, false);
        const row = igRows(USERS.rocio.id).at(-1);
        assert.equal(row.status, 'pending');
        assert.equal(row.email_sent, false);
        assertCodeNotIn(code, { 'the HTTP response': res.text, 'the server logs': consoleLines.slice(consoleStart).join('\n') }, 'email failure');
    }
});

test('migration not applied: Instagram endpoints answer 503, onboarding keeps answering 200', async (t) => {
    const mainStore = world.store;
    t.after(() => { world.store = mainStore; });
    world.store = createStore({ igTable: false, igColumns: false, profileLinks: false });
    seedArtist(world.store, 'laura', { instagram: '@Laura.Tattoo', gallery_feed_items: LAURA_FEED, preferred_display_currency: 'ARS' });
    world.store.seed('support_users_db', { user_id: USERS.agent.id, email: USERS.agent.email, full_name: 'Sofía', role: 'agent', is_active: true });
    const unavailable = (res, label) => {
        assert.equal(res.status, 503, `${label}: ${res.text}`);
        assert.equal(res.body.success, false);
        assert.equal(res.body.code, 'IG_VERIFICATION_UNAVAILABLE');
    };

    await t.test('onboarding GET and POST still work with instagram.available=false', async () => {
        const res = await call('GET', '/api/artist/onboarding', { as: 'laura' });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.success, true);
        assert.equal(res.body.steps.length, 8);
        assert.equal(res.body.instagram.available, false);
        assert.equal(res.body.instagram.status, 'none');
        const portafolio = stepOf(res.body, 'portafolio');
        assert.equal(checksOf(portafolio).instagram_validado, false);
        assert.deepEqual(portafolio.checks.map((c) => [c.id, c.label, c.optional]), [
            ['trabajos', 'Al menos un trabajo en tu portafolio', false],
            ['instagram_validado', 'Instagram validado (se habilita pronto)', true],
            ['portafolio_validado', 'Fotos de Instagram validadas (se habilita pronto)', true]
        ]);
        assert.equal(portafolio.status, 'done', 'with at least one work the step completes while Instagram validation is unavailable');
        assert.equal(checksOf(stepOf(res.body, 'configuracion')).moneda, true, 'optional columns that exist are still read');
        const post = await call('POST', '/api/artist/onboarding', { as: 'laura', body: { assisted: { active: true } } });
        assert.equal(post.status, 200, post.text);
        assert.equal(post.body.onboarding.assisted.active, true);
        assert.equal(post.body.instagram.available, false);
    });

    await t.test('artist, webhook and support endpoints answer IG_VERIFICATION_UNAVAILABLE', async () => {
        const sent = world.outbox.length;
        unavailable(await call('GET', '/api/artist/instagram-verification', { as: 'laura' }), 'artist GET');
        unavailable(await call('POST', '/api/artist/instagram-verification', { as: 'laura', body: {} }), 'artist POST');
        assert.equal(world.outbox.length, sent, 'no code is emailed when it cannot be stored');
        assert.equal((await inbound({ sender_username: 'laura.tattoo', message_text: 'WO-ABCDEF' }, 'wrong')).status, 401);
        unavailable(await inbound({ sender_username: 'laura.tattoo', message_text: 'WO-ABCDEF' }), 'webhook');
        unavailable(await call('GET', '/api/support/instagram-verifications', { as: 'agent' }), 'support list');
        unavailable(await call('POST', `/api/support/instagram-verifications/${crypto.randomUUID()}/confirm`, { as: 'agent', body: { force: true } }), 'support confirm');
        unavailable(await call('POST', `/api/support/instagram-verifications/${crypto.randomUUID()}/reject`, { as: 'agent', body: {} }), 'support reject');
        assert.equal(artistRow(USERS.laura.id).gallery_images.length, LAURA_FEED.length, 'nothing is hidden before the migration');
    });
});

test('half-applied migration (columns but no table): 503 without emailing a code', async (t) => {
    const mainStore = world.store;
    t.after(() => { world.store = mainStore; });
    world.store = createStore({ igTable: false, igColumns: true });
    seedArtist(world.store, 'laura', { instagram: '@Laura.Tattoo', gallery_feed_items: LAURA_FEED });
    const sent = world.outbox.length;
    const get = await call('GET', '/api/artist/instagram-verification', { as: 'laura' });
    assert.equal(get.status, 503);
    assert.equal(get.body.code, 'IG_VERIFICATION_UNAVAILABLE');
    const post = await call('POST', '/api/artist/instagram-verification', { as: 'laura', body: {} });
    assert.equal(post.status, 503);
    assert.equal(post.body.code, 'IG_VERIFICATION_UNAVAILABLE');
    assert.equal(world.outbox.length, sent);
    const onb = await call('GET', '/api/artist/onboarding', { as: 'laura' });
    assert.equal(onb.status, 200, onb.text);
    assert.equal(onb.body.instagram.available, false);
});
