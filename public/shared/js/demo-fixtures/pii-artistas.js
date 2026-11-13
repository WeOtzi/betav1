/**
 * Fixtures de preview/demo · área "pii-artistas" (ronda 3c).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 * Migración 20261113106000: artists_db tiene privilegios por columna y las
 * columnas privadas (email, fecha de nacimiento, WhatsApp, dirección exacta…)
 * se leen por dos RPC security definer. Acá se emulan:
 *   - get_my_artist_profile(): fila completa del usuario con sesión
 *     (ctx.userId); sin sesión → []. Los filtros/select de la consulta los
 *     aplica el emulador sobre el array devuelto.
 *   - support_list_artists(p_user_ids): filas completas (el demo no tiene
 *     datos reales; la RPC real exige is_support_user()).
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['pii-artistas'] = function (ctx) {
        if (!ctx.rpcs) ctx.rpcs = {};
        function clone(row) { return JSON.parse(JSON.stringify(row)); }

        ctx.rpcs.get_my_artist_profile = function (args, store, rpcCtx) {
            var uid = rpcCtx && rpcCtx.userId;
            if (!uid) return [];
            return store.rows('artists_db')
                .filter(function (a) { return a && a.user_id === uid; })
                .map(clone);
        };

        // upsert_my_artist_profile(p_profile): fila propia (user_id = sesión),
        // solo columnas editables (misma lista que la migración).
        var EDITABLE = ['name', 'username', 'email', 'ubicacion', 'city', 'country', 'country_code',
            'state_province', 'locality', 'street', 'street_number', 'unit', 'postal_code',
            'formatted_address', 'google_place_id', 'latitude', 'longitude', 'geocoded_at',
            'styles_array', 'estilo', 'portafolio', 'instagram', 'bio_description', 'estudios',
            'studio_id', 'work_type', 'session_price', 'session_price_amount', 'session_price_currency',
            'birth_date', 'subscribed_newsletter', 'years_experience', 'registration_step'];
        ctx.rpcs.upsert_my_artist_profile = function (args, store, rpcCtx) {
            var uid = rpcCtx && rpcCtx.userId;
            if (!uid) throw Object.assign(new Error('Necesitás iniciar sesión para guardar tu perfil.'), { code: '42501' });
            var input = (args && args.p_profile) || {};
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch (e) { input = {}; } }
            var patch = {};
            EDITABLE.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(input, k)) patch[k] = input[k]; });
            if (Object.prototype.hasOwnProperty.call(input, 'registration_status')) patch.registration_status = 'pendiente de validacion';
            if (Object.prototype.hasOwnProperty.call(input, 'registration_submitted_at')) patch.registration_submitted_at = new Date().toISOString();
            var row = store.rows('artists_db').find(function (a) { return a && a.user_id === uid; });
            if (row) Object.assign(row, patch);
            else row = store.insert('artists_db', [Object.assign({ user_id: uid }, patch)])[0] || Object.assign({ user_id: uid }, patch);
            return { id: row.id || null, user_id: row.user_id, username: row.username || null,
                name: row.name || null, registration_status: row.registration_status || null };
        };

        ctx.rpcs.support_list_artists = function (args, store) {
            var ids = args && args.p_user_ids;
            if (typeof ids === 'string') {
                try { ids = JSON.parse(ids); } catch (e) { ids = ids.replace(/[{}]/g, '').split(','); }
            }
            var wanted = Array.isArray(ids) && ids.length ? ids.map(String) : null;
            return store.rows('artists_db')
                .filter(function (a) { return !wanted || wanted.indexOf(String(a.user_id)) !== -1; })
                .map(clone);
        };
    };
})(typeof self !== 'undefined' ? self : this);
