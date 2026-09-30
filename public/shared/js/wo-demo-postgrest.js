/**
 * WE OTZI - Emulador PostgREST en memoria (modo demo)
 * ---------------------------------------------------
 * Resuelve en el navegador las requests que supabase-js manda a
 * `/rest/v1/<tabla>?select=...&col=eq.x` contra un conjunto de tablas de
 * ejemplo, sin tocar Supabase. Soporta el subconjunto de PostgREST que usa la
 * capa de datos del proyecto (`WeotziData.*` y los `.from()` de página):
 *
 *   - select con columnas, alias y recursos embebidos (`alias:rel!hint(cols)`),
 *     resueltos con un mapa de relaciones explícito;
 *   - filtros eq/neq/gt/gte/lt/lte/like/ilike/is/in (+ `not.` y `or=(...)`);
 *   - order (asc/desc, nullsfirst/nullslast), limit, offset;
 *   - `Prefer: count=exact` (content-range), HEAD, `Accept: vnd.pgrst.object`
 *     (single / maybeSingle con el mismo 406 PGRST116 que devuelve PostgREST);
 *   - insert / upsert (`on_conflict`) / update / delete con
 *     `Prefer: return=representation`;
 *   - RPC (`/rest/v1/rpc/<fn>`) con handlers JS y vistas calculadas.
 *
 * Es un módulo puro (sin DOM): se carga en el navegador como
 * `window.WoDemoPostgrest` y en Node (tests) con `require`.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoDemoPostgrest = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ------------------------------ utils ------------------------------ */
    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function uuid() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // Quita espacios fuera de comillas dobles (postgrest-js hace lo mismo con
    // el `select` antes de mandarlo).
    function stripSpaces(str) {
        var out = '', quoted = false;
        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (ch === '"') quoted = !quoted;
            if (quoted || !/\s/.test(ch)) out += ch;
        }
        return out;
    }

    // Divide por `sep` a nivel 0 de paréntesis y fuera de comillas.
    function splitTopLevel(str, sep) {
        var parts = [], depth = 0, cur = '', quoted = false;
        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (ch === '"') quoted = !quoted;
            if (!quoted) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
            }
            cur += ch;
        }
        if (cur !== '') parts.push(cur);
        return parts;
    }

    function unquote(value) {
        var s = String(value);
        if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
            return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return s;
    }

    /* ------------------------------ select ------------------------------ */
    // "*,alias:rel!hint(a,b,child(c))" → [{ name, alias, hint, children }]
    function parseSelect(select) {
        var src = stripSpaces(select == null || select === '' ? '*' : String(select));
        return splitTopLevel(src, ',').filter(Boolean).map(function (item) {
            var node = { name: item, alias: null, hint: null, children: null };
            var open = item.indexOf('(');
            if (open !== -1) {
                node.children = parseSelect(item.slice(open + 1, item.lastIndexOf(')')));
                node.name = item.slice(0, open);
            }
            var cast = node.name.indexOf('::');
            if (cast !== -1) node.name = node.name.slice(0, cast);
            var colon = node.name.indexOf(':');
            if (colon !== -1) { node.alias = node.name.slice(0, colon); node.name = node.name.slice(colon + 1); }
            var bang = node.name.indexOf('!');
            if (bang !== -1) { node.hint = node.name.slice(bang + 1); node.name = node.name.slice(0, bang); }
            return node;
        });
    }

    /* ------------------------------ filtros ------------------------------ */
    var FILTER_OPS = { eq: 1, neq: 1, gt: 1, gte: 1, lt: 1, lte: 1, like: 1, ilike: 1, is: 1, in: 1, cs: 1, cd: 1, fts: 1, plfts: 1, phfts: 1, wfts: 1 };

    // "not.eq.3" | "in.(1,2)" | "is.null" → { col, op, value, negated }
    function parseFilter(col, raw) {
        var s = String(raw), negated = false;
        if (s.indexOf('not.') === 0) { negated = true; s = s.slice(4); }
        var dot = s.indexOf('.');
        if (dot === -1) return null;
        var op = s.slice(0, dot);
        if (!FILTER_OPS[op]) return null;
        return { col: col, op: op, value: s.slice(dot + 1), negated: negated };
    }

    // "(a.eq.1,b.ilike.*x*,and(c.eq.2,d.eq.3))" → árbol { or: [...] }
    function parseLogic(kind, raw) {
        var body = String(raw).trim();
        if (body[0] === '(' && body[body.length - 1] === ')') body = body.slice(1, -1);
        var items = splitTopLevel(body, ',').map(function (part) {
            var m = /^(and|or)\((.*)\)$/.exec(part);
            if (m) return parseLogic(m[1], '(' + m[2] + ')');
            var negated = false, p = part;
            if (p.indexOf('not.') === 0) { negated = true; p = p.slice(4); }
            var first = p.indexOf('.');
            if (first === -1) return null;
            var col = p.slice(0, first);
            var f = parseFilter(col, p.slice(first + 1));
            if (f && negated) f.negated = !f.negated;
            return f;
        }).filter(Boolean);
        var node = {}; node[kind] = items; return node;
    }

    function parseOrder(raw) {
        return String(raw).split(',').filter(Boolean).map(function (part) {
            var bits = part.split('.');
            var col = bits[0];
            var asc = bits.indexOf('desc') === -1;
            var nullsFirst = bits.indexOf('nullsfirst') !== -1 ? true : bits.indexOf('nullslast') !== -1 ? false : !asc;
            return { col: col, asc: asc, nullsFirst: nullsFirst };
        });
    }

    // Query string → { select, filters, order, limit, offset, onConflict, columns }
    function parseQuery(search) {
        var q = { select: '*', filters: [], order: [], limit: null, offset: 0, onConflict: null };
        var s = String(search || '');
        if (s[0] === '?') s = s.slice(1);
        if (!s) return q;
        s.split('&').forEach(function (pair) {
            if (!pair) return;
            var eq = pair.indexOf('=');
            var key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, ' ');
            var value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, '%20'));
            if (key === 'select') q.select = value;
            else if (key === 'order') q.order = parseOrder(value);
            else if (key === 'limit') q.limit = parseInt(value, 10);
            else if (key === 'offset') q.offset = parseInt(value, 10) || 0;
            else if (key === 'on_conflict') q.onConflict = value.split(',');
            else if (key === 'columns') q.columns = value.split(',');
            else if (key === 'or' || key === 'and') q.filters.push(parseLogic(key, value));
            else {
                var f = parseFilter(key, value);
                if (f) q.filters.push(f);
            }
        });
        return q;
    }

    /* ---------------------------- evaluación ---------------------------- */
    var ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

    function coerce(rowValue, filterValue) {
        if (typeof rowValue === 'number') { var n = Number(filterValue); return isNaN(n) ? filterValue : n; }
        if (typeof rowValue === 'boolean') return filterValue === 'true' ? true : filterValue === 'false' ? false : filterValue;
        return filterValue;
    }

    function compare(a, b) {
        if (a == null && b == null) return 0;
        if (a == null) return -1;
        if (b == null) return 1;
        if (typeof a === 'string' && typeof b === 'string' && ISO_DATE.test(a) && ISO_DATE.test(b)) {
            var ta = Date.parse(a), tb = Date.parse(b);
            if (!isNaN(ta) && !isNaN(tb)) return ta === tb ? 0 : ta < tb ? -1 : 1;
        }
        if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
        var sa = String(a), sb = String(b);
        return sa === sb ? 0 : sa < sb ? -1 : 1;
    }

    function likeToRegex(pattern, insensitive) {
        var re = String(pattern).replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.');
        return new RegExp('^' + re + '$', insensitive ? 'i' : '');
    }

    function matchOne(row, f) {
        if (f.or) return f.or.some(function (sub) { return matchOne(row, sub); });
        if (f.and) return f.and.every(function (sub) { return matchOne(row, sub); });
        var v = row[f.col];
        var raw = f.value;
        var result;
        switch (f.op) {
            case 'eq': result = v != null && compare(v, coerce(v, unquote(raw))) === 0; break;
            case 'neq': result = v == null || compare(v, coerce(v, unquote(raw))) !== 0; break;
            case 'gt': result = v != null && compare(v, coerce(v, raw)) > 0; break;
            case 'gte': result = v != null && compare(v, coerce(v, raw)) >= 0; break;
            case 'lt': result = v != null && compare(v, coerce(v, raw)) < 0; break;
            case 'lte': result = v != null && compare(v, coerce(v, raw)) <= 0; break;
            case 'like': result = v != null && likeToRegex(unquote(raw), false).test(String(v)); break;
            case 'ilike': result = v != null && likeToRegex(unquote(raw), true).test(String(v)); break;
            case 'is':
                if (raw === 'null') result = v == null;
                else if (raw === 'true') result = v === true;
                else if (raw === 'false') result = v === false;
                else result = false;
                break;
            case 'in': {
                var list = raw;
                if (list[0] === '(' && list[list.length - 1] === ')') list = list.slice(1, -1);
                var wanted = splitTopLevel(list, ',').map(unquote);
                result = v != null && wanted.some(function (w) { return compare(v, coerce(v, w)) === 0; });
                break;
            }
            case 'cs': {
                // contiene (arrays): cs.{a,b}
                var needles = String(raw).replace(/^\{|\}$/g, '').split(',').map(unquote).filter(Boolean);
                result = Array.isArray(v) && needles.every(function (n) { return v.map(String).indexOf(n) !== -1; });
                break;
            }
            default: result = true;
        }
        return f.negated ? !result : result;
    }

    function applyFilters(rows, filters) {
        if (!filters || !filters.length) return rows.slice();
        return rows.filter(function (row) { return filters.every(function (f) { return matchOne(row, f); }); });
    }

    function applyOrder(rows, order) {
        if (!order || !order.length) return rows;
        var sorted = rows.slice();
        sorted.sort(function (a, b) {
            for (var i = 0; i < order.length; i++) {
                var o = order[i], va = a[o.col], vb = b[o.col];
                var aNull = va == null, bNull = vb == null;
                if (aNull && bNull) continue;
                if (aNull) return o.nullsFirst ? -1 : 1;
                if (bNull) return o.nullsFirst ? 1 : -1;
                var c = compare(va, vb);
                if (c !== 0) return o.asc ? c : -c;
            }
            return 0;
        });
        return sorted;
    }

    /* ------------------------------ proyección ------------------------------ */
    function relationFor(relations, table, key) {
        var map = relations[table];
        return map && map[key] ? map[key] : null;
    }

    function project(row, nodes, table, ctx) {
        var out = {};
        var innerFails = false;
        nodes.forEach(function (node) {
            var rel = relationFor(ctx.relations, table, node.name);
            if (rel || node.children) {
                var key = node.alias || node.name;
                if (!rel) { out[key] = node.children ? [] : null; return; }
                var related = ctx.rows(rel.table).filter(function (child) {
                    return child[rel.foreignKey] != null && compare(child[rel.foreignKey], row[rel.localKey]) === 0;
                });
                var childNodes = node.children || parseSelect('*');
                var projected = related.map(function (child) { return project(child, childNodes, rel.table, ctx); });
                if (rel.many) out[key] = projected;
                else out[key] = projected.length ? projected[0] : null;
                if (node.hint === 'inner' && (rel.many ? !projected.length : !projected.length)) innerFails = true;
                return;
            }
            if (node.name === '*') { Object.keys(row).forEach(function (k) { if (!(k in out)) out[k] = row[k]; }); return; }
            var name = node.name;
            var arrow = name.indexOf('->');
            if (arrow !== -1) {
                // col->>key / col->key sobre jsonb
                var base = name.slice(0, arrow);
                var path = name.slice(arrow).split(/->>?/).filter(Boolean);
                var val = row[base];
                path.forEach(function (p) { val = val != null ? val[p] : undefined; });
                out[node.alias || path[path.length - 1]] = val === undefined ? null : val;
                return;
            }
            out[node.alias || name] = row[name] === undefined ? null : row[name];
        });
        return innerFails ? null : out;
    }

    /* ------------------------------ store ------------------------------ */
    function createStore(opts) {
        opts = opts || {};
        var tables = {};
        var relations = opts.relations || {};
        var rpcs = opts.rpcs || {};
        var views = opts.views || {};
        var listeners = [];
        var seq = 1;

        function load(data) {
            Object.keys(data || {}).forEach(function (name) { tables[name] = clone(data[name]) || []; });
        }
        function has(name) {
            return Object.prototype.hasOwnProperty.call(tables, name) || Object.prototype.hasOwnProperty.call(views, name);
        }
        function rows(name) {
            if (Object.prototype.hasOwnProperty.call(views, name)) return views[name](api) || [];
            if (!tables[name]) tables[name] = [];
            return tables[name];
        }
        function emit(table, action) {
            listeners.forEach(function (fn) { try { fn(table, action); } catch (e) { /* listener ajeno */ } });
        }
        function nextId(name) {
            var list = tables[name] || [];
            var numeric = list.length && list.every(function (r) { return typeof r.id === 'number'; });
            if (numeric) return list.reduce(function (m, r) { return Math.max(m, r.id); }, 0) + 1;
            if (!list.length) return uuid();
            return uuid();
        }
        function withDefaults(name, row) {
            var out = Object.assign({}, row);
            if (out.id == null) out.id = nextId(name);
            var nowIso = new Date().toISOString();
            if (!('created_at' in out) || out.created_at == null) out.created_at = nowIso;
            if ('updated_at' in out && out.updated_at == null) out.updated_at = nowIso;
            return out;
        }

        var api = {
            load: load, has: has, rows: rows, relations: relations, rpcs: rpcs, views: views,
            dump: function () { return clone(tables); },
            onChange: function (fn) { listeners.push(fn); },
            tables: function () { return Object.keys(tables); },
            insert: function (name, list, onConflict) {
                var arr = Array.isArray(list) ? list : [list];
                var target = rows(name);
                var inserted = arr.map(function (raw) {
                    var row = withDefaults(name, raw);
                    if (onConflict && onConflict.length) {
                        var existing = target.find(function (r) {
                            return onConflict.every(function (col) { return r[col] != null && compare(r[col], row[col]) === 0; });
                        });
                        if (existing) { Object.assign(existing, raw, { updated_at: new Date().toISOString() }); return existing; }
                    }
                    target.push(row);
                    return row;
                });
                emit(name, 'insert');
                return inserted;
            },
            update: function (name, filters, patch) {
                var matched = applyFilters(rows(name), filters);
                matched.forEach(function (row) {
                    Object.assign(row, patch);
                    if ('updated_at' in row && !('updated_at' in patch)) row.updated_at = new Date().toISOString();
                });
                if (matched.length) emit(name, 'update');
                return matched;
            },
            remove: function (name, filters) {
                var target = rows(name);
                var matched = applyFilters(target, filters);
                matched.forEach(function (row) { var i = target.indexOf(row); if (i !== -1) target.splice(i, 1); });
                if (matched.length) emit(name, 'delete');
                return matched;
            },
            select: function (name, query) {
                var q = typeof query === 'string' ? parseQuery(query) : (query || parseQuery(''));
                var nodes = parseSelect(q.select);
                var filtered = applyOrder(applyFilters(rows(name), q.filters), q.order);
                var total = filtered.length;
                var page = filtered.slice(q.offset || 0, q.limit != null ? (q.offset || 0) + q.limit : undefined);
                var projected = page.map(function (row) { return project(row, nodes, name, api); }).filter(function (r) { return r !== null; });
                return { rows: projected, total: total, query: q };
            },
            handle: handle,
            nextSeq: function () { return seq++; }
        };

        function headerOf(headers, key) {
            if (!headers) return '';
            if (typeof headers.get === 'function') return headers.get(key) || '';
            var lower = key.toLowerCase();
            for (var k in headers) if (k.toLowerCase() === lower) return headers[k] || '';
            return '';
        }

        function respond(status, body, extra) {
            var headers = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extra || {});
            return { status: status, headers: headers, body: body === undefined ? null : JSON.stringify(body) };
        }

        function objectResponse(list, wantsObject, status, extra) {
            if (!wantsObject) return respond(status, list, extra);
            if (list.length === 1) return respond(status, list[0], extra);
            return respond(406, {
                code: 'PGRST116',
                details: 'The result contains ' + list.length + ' rows',
                hint: null,
                message: 'JSON object requested, multiple (or no) rows returned'
            }, extra);
        }

        // req: { method, path, search, headers, body, ctx }
        function handle(req) {
            var method = String(req.method || 'GET').toUpperCase();
            var path = String(req.path || '').replace(/^\/+|\/+$/g, '');
            var prefer = headerOf(req.headers, 'prefer');
            var accept = headerOf(req.headers, 'accept');
            var wantsObject = accept.indexOf('vnd.pgrst.object') !== -1;
            var wantsRepresentation = prefer.indexOf('return=representation') !== -1;
            var wantsCount = prefer.indexOf('count=') !== -1;
            var body = req.body;
            if (typeof body === 'string' && body !== '') { try { body = JSON.parse(body); } catch (e) { body = null; } }
            var q = parseQuery(req.search);
            var ctx = req.ctx || {};

            if (path.indexOf('rpc/') === 0) {
                var fn = path.slice(4);
                var handler = rpcs[fn];
                var args = body && typeof body === 'object' ? body : {};
                if (method === 'GET') {
                    // rpc por GET (get:true): args en la query
                    args = {}; String(req.search || '').replace(/^\?/, '').split('&').forEach(function (p) {
                        if (!p) return; var e = p.indexOf('='); args[decodeURIComponent(p.slice(0, e))] = decodeURIComponent(p.slice(e + 1));
                    });
                }
                if (!handler) return respond(200, null);
                var result = handler(args, api, ctx);
                if (Array.isArray(result)) {
                    var projectedRpc = applyOrder(applyFilters(result, q.filters), q.order);
                    if (q.limit != null) projectedRpc = projectedRpc.slice(q.offset || 0, (q.offset || 0) + q.limit);
                    return objectResponse(projectedRpc, wantsObject, 200);
                }
                if (wantsObject) return respond(200, result == null ? null : result);
                return respond(200, result === undefined ? null : result);
            }

            var table = path;
            if (!has(table)) {
                if (method === 'GET' || method === 'HEAD') return respond(200, [], { 'content-range': '*/0' });
                // Escrituras a tablas reales: no-op con eco para que la UI siga.
                var echo = body == null ? [] : (Array.isArray(body) ? body : [body]).map(function (r) { return withDefaults(table, r); });
                if (method === 'DELETE') return respond(wantsRepresentation ? 200 : 204, wantsRepresentation ? [] : undefined);
                return wantsRepresentation ? objectResponse(echo, wantsObject, method === 'POST' ? 201 : 200) : respond(method === 'POST' ? 201 : 204);
            }

            if (method === 'GET' || method === 'HEAD') {
                var res = api.select(table, q);
                var range = res.rows.length ? (q.offset || 0) + '-' + ((q.offset || 0) + res.rows.length - 1) : '*';
                var extra = { 'content-range': range + '/' + (wantsCount ? res.total : '*') };
                if (method === 'HEAD') return { status: 200, headers: Object.assign({ 'content-type': 'application/json' }, extra), body: null };
                return objectResponse(res.rows, wantsObject, 200, extra);
            }

            if (method === 'POST') {
                var isUpsert = prefer.indexOf('resolution=merge-duplicates') !== -1 || prefer.indexOf('resolution=ignore-duplicates') !== -1;
                var inserted = api.insert(table, body == null ? [] : body, isUpsert ? (q.onConflict || ['id']) : null);
                if (!wantsRepresentation) return respond(201, undefined);
                var nodes = parseSelect(q.select);
                return objectResponse(inserted.map(function (r) { return project(r, nodes, table, api); }), wantsObject, 201);
            }

            if (method === 'PATCH') {
                var updated = api.update(table, q.filters, body && typeof body === 'object' ? body : {});
                if (!wantsRepresentation) return respond(204, undefined);
                var nodesP = parseSelect(q.select);
                return objectResponse(updated.map(function (r) { return project(r, nodesP, table, api); }), wantsObject, 200);
            }

            if (method === 'DELETE') {
                var removed = api.remove(table, q.filters);
                if (!wantsRepresentation) return respond(204, undefined);
                var nodesD = parseSelect(q.select);
                return objectResponse(removed.map(function (r) { return project(r, nodesD, table, api); }), wantsObject, 200);
            }

            return respond(405, { message: 'Método no soportado en el demo: ' + method });
        }

        if (opts.tables) load(opts.tables);
        return api;
    }

    return {
        createStore: createStore,
        parseSelect: parseSelect,
        parseQuery: parseQuery,
        parseFilter: parseFilter,
        applyFilters: applyFilters,
        applyOrder: applyOrder,
        project: project,
        compare: compare,
        uuid: uuid
    };
}));
