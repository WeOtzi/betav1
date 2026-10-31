/**
 * Fixtures de preview/demo · área "acceso" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * El área (bienvenida, login, crear cuenta, registro y recuperar acceso) no
 * necesita tablas nuevas: trabaja sobre artists_db, clients_db, tattoo_styles y
 * studios, que el preview ya siembra. Las columnas nuevas de artists_db
 * (profile_links, newsletter_topics · migración 20261028100000) las acepta el
 * emulador PostgREST sin esquema, así que el guardado del registro funciona.
 *
 * Parámetros de QA (solo en preview/demo):
 *   /artist/login?state=login        formulario aunque exista la sesión ficticia
 *   /artist/login?postauth=v1|v2|v3  loader post-auth sin redirigir
 *   /registerclosedbeta?state=signup formulario sin el aviso de sesión activa
 *   /register-artist?step=1..8&state=nuevo|estilos|instagram|cargado|estudio|todas|aceptado
 *   /recover?step=1..4&email=...
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['acceso'] = function (ctx) {
        void ctx;
    };
}(typeof self !== 'undefined' ? self : this));
