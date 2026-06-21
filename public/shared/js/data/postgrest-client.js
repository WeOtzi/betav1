/**
 * WE OTZI - Capa PostgREST unificada (frontend)
 * ----------------------------------------------
 * Envuelve el cliente supabase-js AUTENTICADO (el singleton que crea
 * config-manager.js en window._supabase / ConfigManager.getSupabaseClient).
 * supabase-js ya es un wrapper de PostgREST; aqui agregamos:
 *   - una unica forma de obtener el cliente (sin re-crear clients por modulo),
 *   - manejo de error homogeneo (`run`),
 *   - helpers de filtro seguros (escape para .or(), evita inyeccion — doc §4-B).
 *
 * Debe cargarse DESPUES de config-manager.js y del SDK supabase-js, y ANTES de
 * quotations-repo.js y de los modulos de pagina. Expone `window.WeotziData`.
 */
(function () {
    'use strict';

    // Devuelve el cliente supabase-js autenticado (singleton) o null.
    function getClient() {
        if (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function') {
            const client = window.ConfigManager.getSupabaseClient();
            if (client) return client;
        }
        if (window._supabase) return window._supabase;
        console.error('[WeotziData] Cliente Supabase no disponible (config-manager no cargado).');
        return null;
    }

    // Ejecuta un builder de supabase-js que resuelve a { data, error[, count] } y
    // normaliza el error en una excepcion con etiqueta. Devuelve { data, count }.
    async function run(label, builder) {
        const client = getClient();
        if (!client) throw new Error(`[${label}] Supabase client unavailable`);
        const res = await builder(client);
        const { data, error, count } = res || {};
        if (error) {
            const err = new Error(`[${label}] ${error.message || 'PostgREST error'}`);
            err.cause = error;
            err.code = error.code;
            throw err;
        }
        return { data: data || null, count: typeof count === 'number' ? count : null };
    }

    // Escapa un valor para incrustarlo en una condicion .or() de PostgREST.
    // Las comas, parentesis y puntos son estructurales en la mini-gramatica de
    // PostgREST; envolvemos en comillas dobles y escapamos comillas internas.
    function orValue(v) {
        return '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    window.WeotziData = window.WeotziData || {};
    window.WeotziData.getClient = getClient;
    window.WeotziData.run = run;
    window.WeotziData.orValue = orValue;
})();
