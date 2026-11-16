/**
 * Fixtures de preview/demo · área "pii-studios".
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 * Migración 20261115200100: studios tiene privilegios por columna y el dueño
 * lee su fila completa (email, teléfono interno, datos de verificación) con la
 * RPC security definer get_my_studio(). Aquí se emula:
 *   - get_my_studio(): el estudio del usuario con sesión (ctx.userId); sin
 *     sesión → []. Los filtros/select de la consulta (.select().eq()
 *     .maybeSingle() de studios-repo) los aplica el emulador sobre el array.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['pii-studios'] = function (ctx) {
        if (!ctx.rpcs) ctx.rpcs = {};
        function clone(row) { return JSON.parse(JSON.stringify(row)); }

        ctx.rpcs.get_my_studio = function (args, store, rpcCtx) {
            var uid = rpcCtx && rpcCtx.userId;
            if (!uid) return [];
            return store.rows('studios')
                .filter(function (s) { return s && s.user_id === uid; })
                .map(clone);
        };
    };
})(typeof self !== 'undefined' ? self : this);
