/**
 * Fixtures de preview/demo · área "oportunidades" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 * Agregá filas a ctx.tables[<tabla>] (y el nombre a ctx.TABLES si la tabla es nueva)
 * para que la pantalla funcione en el preview local sin backend real.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['oportunidades'] = function (ctx) {
        void ctx;
    };
}(typeof self !== 'undefined' ? self : this));
