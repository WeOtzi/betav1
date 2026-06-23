'use strict';

// ===========================================================================
// Capa PostgREST unificada (servidor)
// ---------------------------------------------------------------------------
// Cliente PostgREST minimo sobre `fetch` nativo. Es la UNICA fuente de acceso
// a datos del backend: reemplaza a los helpers dispersos que existian antes
// (`_supabaseFetch`, `supabaseQuery`, `fetchAdminTableRows`, los
// `supabaseConfig`/`serviceHeaders` duplicados, y los `fetch('${url}/rest/v1/..')`
// inline). No agrega dependencias: mismo patron REST + service-role que ya
// usaba server.js y lib/app-settings.js.
//
// Diseno: un query-builder encadenable inspirado en PostgREST/supabase-js, con
//   - `select` explicito,
//   - filtros PARAMETRIZADOS y escapados (evita inyeccion de filtro),
//   - `Prefer` / `Range` / `count` correctos,
//   - manejo de error homogeneo (Error con .status y cuerpo recortado; FK 23503).
//
// Uso:
//   const { pgrest } = require('./postgrest');
//   const rows = await pgrest('quotations_db')
//       .select('id,quote_id,client_email')
//       .eq('quote_id', quoteId).limit(1).execute();
//   await pgrest('quotations_db').eq('id', id).patch({ client_deleted_at: iso });
//   const { rows, count } = await pgrest('quotations_db').range(0, 49).count().execute();
//
// `pgrest(table, { key: 'anon' })` usa la anon key (respeta RLS); por defecto
// usa service-role (salta RLS), igual que el backend de hoy.
// `pgrest.raw(path, opts)` es el escape para paths PostgREST arbitrarios.
// ===========================================================================

function resolveConfig(key) {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error('SUPABASE_URL must be set in environment');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const apiKey = key === 'anon' ? (anonKey || serviceRoleKey) : serviceRoleKey;
    if (!apiKey) {
        throw new Error(
            `Supabase ${key === 'anon' ? 'anon' : 'service-role'} key must be set in environment`
        );
    }
    return { url, apiKey };
}

// Percent-encode robusto: encodeURIComponent NO escapa ( ) * , que SI son
// estructurales dentro de or=(...) / in.(...). Los forzamos para que ningun
// valor de filtro pueda romper la estructura del query (anti inyeccion).
function pctEncode(s) {
    return encodeURIComponent(s).replace(/[()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Escapa un valor de filtro PostgREST. Los valores se percent-encodean; para
// `in` se arma una lista entre parentesis con cada elemento entrecomillado y
// escapado (asi un email con comas/parentesis no rompe el filtro).
function encodeFilterValue(op, val) {
    if (op === 'in') {
        const arr = Array.isArray(val) ? val : [val];
        const list = arr
            .map((v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')
            .join(',');
        return pctEncode(`(${list})`);
    }
    if (op === 'is') return String(val); // null | true | false (sin encode)
    return pctEncode(String(val));
}

function parseContentRangeTotal(res) {
    const cr = res.headers.get('content-range') || '';
    const total = cr.split('/')[1];
    if (!total || total === '*') return null;
    const n = Number.parseInt(total, 10);
    return Number.isFinite(n) ? n : null;
}

class PostgrestQuery {
    constructor(table, opts = {}) {
        this.table = table;
        this.keyKind = opts.key === 'anon' ? 'anon' : 'service';
        this._select = null;
        this._filters = [];
        this._or = null;
        this._order = null;
        this._limit = null;
        this._range = null;
        this._onConflict = null;
        this._countMode = null;
        this._single = false;
    }

    select(cols = '*') { this._select = cols; return this; }

    _filter(op, col, val) { this._filters.push({ op, col, val }); return this; }
    eq(c, v) { return this._filter('eq', c, v); }
    neq(c, v) { return this._filter('neq', c, v); }
    gt(c, v) { return this._filter('gt', c, v); }
    gte(c, v) { return this._filter('gte', c, v); }
    lt(c, v) { return this._filter('lt', c, v); }
    lte(c, v) { return this._filter('lte', c, v); }
    like(c, v) { return this._filter('like', c, v); }
    ilike(c, v) { return this._filter('ilike', c, v); }
    is(c, v) { return this._filter('is', c, v); }
    in(c, arr) { return this._filter('in', c, arr); }

    // OR sobre condiciones parametrizadas: or([{col,op,val}, ...]) -> or=(col.op.val,...)
    // Cada valor se escapa; los separadores estructurales (`,` `.` parentesis) quedan literales.
    or(conditions) { this._or = conditions; return this; }

    order(col, { ascending = true } = {}) { this._order = `${col}.${ascending ? 'asc' : 'desc'}`; return this; }
    limit(n) { this._limit = n; return this; }
    range(from, to) { this._range = [from, to]; return this; }
    onConflict(cols) { this._onConflict = cols; return this; }
    count(mode = 'exact') { this._countMode = mode; return this; }
    single() { this._single = true; return this; }

    _queryString() {
        const parts = [];
        if (this._select) parts.push(`select=${encodeURIComponent(this._select)}`);
        for (const f of this._filters) {
            parts.push(`${f.col}=${f.op}.${encodeFilterValue(f.op, f.val)}`);
        }
        if (this._or && this._or.length) {
            const inner = this._or
                .map((c) => `${c.col}.${c.op}.${encodeFilterValue(c.op, c.val)}`)
                .join(',');
            parts.push(`or=(${inner})`);
        }
        if (this._order) parts.push(`order=${this._order}`);
        if (this._limit != null) parts.push(`limit=${this._limit}`);
        if (this._onConflict) parts.push(`on_conflict=${encodeURIComponent(this._onConflict)}`);
        return parts.join('&');
    }

    _buildPrefer(base) {
        const prefer = [];
        if (base) prefer.push(base);
        if (this._countMode) prefer.push(`count=${this._countMode}`);
        return prefer.join(',');
    }

    async _send(method, { body, preferBase } = {}) {
        const { url, apiKey } = resolveConfig(this.keyKind);
        const headers = {
            'Content-Type': 'application/json',
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
        };
        const prefer = this._buildPrefer(preferBase);
        if (prefer) headers.Prefer = prefer;
        if (this._range) headers.Range = `${this._range[0]}-${this._range[1]}`;

        const qs = this._queryString();
        const res = await fetch(`${url}/rest/v1/${this.table}${qs ? `?${qs}` : ''}`, {
            method,
            headers,
            body: body != null ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`PostgREST ${method} ${this.table} failed (${res.status}): ${text.slice(0, 300)}`);
            err.status = res.status;
            if (text.includes('23503')) err.code = '23503'; // FK violation
            throw err;
        }

        const count = this._countMode ? parseContentRangeTotal(res) : null;
        if (res.status === 204) return { rows: [], count };
        const text = await res.text();
        const rows = text ? JSON.parse(text) : [];
        return { rows, count };
    }

    // ---- terminal operations ------------------------------------------------
    async execute() {
        const { rows, count } = await this._send('GET');
        if (this._single) return rows.length ? rows[0] : null;
        if (this._countMode) return { rows, count };
        return rows;
    }

    async insert(values, { returning = true } = {}) {
        const { rows } = await this._send('POST', {
            body: values,
            preferBase: returning ? 'return=representation' : 'return=minimal',
        });
        return rows;
    }

    async upsert(values, { onConflict, returning = true } = {}) {
        if (onConflict) this.onConflict(onConflict);
        const { rows } = await this._send('POST', {
            body: values,
            preferBase: `resolution=merge-duplicates,${returning ? 'return=representation' : 'return=minimal'}`,
        });
        return rows;
    }

    async patch(patch, { returning = true } = {}) {
        const { rows } = await this._send('PATCH', {
            body: patch,
            preferBase: returning ? 'return=representation' : 'return=minimal',
        });
        return rows;
    }

    async delete({ returning = false } = {}) {
        const { rows } = await this._send('DELETE', {
            preferBase: returning ? 'return=representation' : 'return=minimal',
        });
        return rows;
    }
}

function pgrest(table, opts) {
    return new PostgrestQuery(table, opts);
}

// Escape hatch: ejecuta un path PostgREST arbitrario (reemplazo directo del
// viejo `_supabaseFetch(path, opts)`). Devuelve filas parseadas o null en 204.
pgrest.raw = async function raw(path, { method = 'GET', body, prefer, key, apiKey } = {}) {
    let url;
    let resolvedKey;
    if (apiKey) {
        // Clave explicita (p.ej. la anon key derivada de getHealthConfig).
        url = process.env.SUPABASE_URL;
        if (!url) throw new Error('SUPABASE_URL must be set in environment');
        resolvedKey = apiKey;
    } else {
        ({ url, apiKey: resolvedKey } = resolveConfig(key === 'anon' ? 'anon' : 'service'));
    }
    const headers = {
        'Content-Type': 'application/json',
        apikey: resolvedKey,
        Authorization: `Bearer ${resolvedKey}`,
    };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`PostgREST ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
        err.status = res.status;
        if (text.includes('23503')) err.code = '23503';
        throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
};

pgrest.parseContentRangeTotal = parseContentRangeTotal;
pgrest.encodeFilterValue = encodeFilterValue;

module.exports = { pgrest, parseContentRangeTotal, encodeFilterValue };
