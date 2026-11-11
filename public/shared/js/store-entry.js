/**
 * WE OTZI - Entrada a la Store en páginas compartidas
 * ---------------------------------------------------
 * Script liviano: muestra los elementos marcados con [data-store-entry] (les
 * quita `hidden`) solo cuando la Store está habilitada. Contrato:
 * docs/plans/2026-10-30-store-artista.md §8.5.
 *
 *   Gate completo (si la página cargó data/store-repo.js):
 *     WeotziData.Store.featureEnabled() && await WeotziData.Store.isAvailable()
 *   Gate liviano (sin el repo): features.store === true en app-config.json
 *     (ConfigManager.getValue) o el preview/demo.
 *
 * Los elementos nacen con `hidden` en el HTML: sin JS, con el flag apagado o
 * si algo falla, siguen ocultos. Los href absolutos reciben el base path
 * (/beta, preview) de forma idempotente.
 *
 * Carga: <script src="/shared/js/store-entry.js" defer></script>, después de
 * config-manager.js. Expone window.WeotziStoreEntry = { gate, reveal, refresh }.
 */
(function () {
    'use strict';

    var SELECTOR = '[data-store-entry]';
    var READY_TIMEOUT_MS = 8000;

    function isPreviewEnv() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }

    function flagEnabled() {
        if (isPreviewEnv()) return true;
        var CM = window.ConfigManager;
        if (!CM || typeof CM.getValue !== 'function') return false;
        try { return CM.getValue('features.store', false) === true; }
        catch (e) { return false; }
    }

    function storeRepo() {
        var S = window.WeotziData && window.WeotziData.Store;
        return S && typeof S.featureEnabled === 'function' && typeof S.isAvailable === 'function' ? S : null;
    }

    // ConfigManager.ready() resuelve cuando app-config.json ya se mezcló. Con
    // un tope, para no colgar la página si la config nunca llega.
    function whenConfigReady() {
        var CM = window.ConfigManager;
        if (!CM || typeof CM.ready !== 'function') return Promise.resolve();
        var ready;
        try { ready = Promise.resolve(CM.ready()); } catch (e) { return Promise.resolve(); }
        var timeout = new Promise(function (resolve) { setTimeout(resolve, READY_TIMEOUT_MS); });
        return Promise.race([ready, timeout]).then(function () {}, function () {});
    }

    function gate() {
        return whenConfigReady().then(function () {
            var S = storeRepo();
            if (!S) return flagEnabled();
            if (!S.featureEnabled()) return false;
            return Promise.resolve(S.isAvailable()).then(function (ok) { return ok === true; }, function () { return false; });
        }).catch(function () { return false; });
    }

    function appPath(p) {
        var base = String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }

    function reveal(root) {
        var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        var nodes = scope.querySelectorAll(SELECTOR);
        Array.prototype.forEach.call(nodes, function (el) {
            var href = el.getAttribute && el.getAttribute('href');
            if (href) el.setAttribute('href', appPath(href));
            el.hidden = false;
        });
        return nodes.length;
    }

    var pending = null;
    function refresh() {
        if (pending) return pending;
        pending = gate().then(function (on) {
            pending = null;
            if (on) reveal(document);
            return on;
        }, function () { pending = null; return false; });
        return pending;
    }

    window.WeotziStoreEntry = { gate: gate, reveal: reveal, refresh: refresh };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
    else refresh();
})();
