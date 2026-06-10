// ============================================
// WE ÖTZI - SUPPORT CHAT LOADER
// Carga dinámicamente CSS + JS del widget en cualquier página
// que incluya config-manager.js. Evita editar cada HTML entry point.
// ============================================

(function () {
    'use strict';

    // Gate por entorno / ruta
    // - /support/dashboard: el dashboard de soporte no debe mostrar el widget (sería recursivo)
    // - /support/login: login de agentes de soporte, no aplica
    // - /backoffice: admin interno
    const excludedPaths = ['/support/dashboard', '/support/login', '/backoffice'];
    const currentPath = window.location.pathname.toLowerCase();
    if (excludedPaths.some(p => currentPath.includes(p))) {
        console.log('[support-loader] skipped on', currentPath);
        return;
    }

    // Detección de opt-out: data-no-support-chat en <html> o <body>
    if (document.documentElement.dataset.noSupportChat !== undefined ||
        (document.body && document.body.dataset.noSupportChat !== undefined)) {
        return;
    }

    function loadCSS(href) {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function loadJS(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.defer = true;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function start() {
        // Esperar ConfigManager si existe (para leer feature flag)
        if (window.ConfigManager?.ready) {
            try { await ConfigManager.ready(); } catch {}
            const enabled = ConfigManager.getValue?.('supportChat.enabled', true);
            if (enabled === false) {
                console.log('[support-loader] disabled via config');
                return;
            }
        }

        loadCSS('/shared/css/support-chat.css');
        try {
            await loadJS('/shared/js/support-chat.js');
        } catch (err) {
            console.warn('[support-loader] failed to load widget:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
