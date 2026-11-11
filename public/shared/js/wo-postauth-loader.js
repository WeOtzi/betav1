/**
 * WE OTZI - Loader post-auth compartido (Figma final del flujo de artista, oct 2026)
 * -------------------------------------------------------------------------------
 * Overlay de pantalla completa que se muestra tras autenticarse o completar un
 * flujo mientras se redirige al panel. Frames "Registro - 09 Organizando tu
 * agenda": Variante 01 (801:1099), Variante 2 (2001:3335) y Variante 3
 * (2001:4308). Las tres variantes comparten el mismo diseño: spinner circular
 * de 120px con arco azul, marca We Ötzi grande y leyenda mono.
 *
 * Flujos (data-variant sólo identifica el origen para QA/analytics):
 *   v1 · login con email/contraseña  → dashboard
 *   v2 · "Ya iniciaste sesión" → Dashboard
 *   v3 · registro 08 "Ir a tu panel" → dashboard
 *
 * Uso (requiere tokens.css cargado en la página):
 *   WoPostAuthLoader.show({ role: 'artist'|'client', targetUrl, message, delayMs, variant })
 * `message` pisa el mensaje por rol; delayMs default 1400ms.
 *
 * QA en preview: `?postauth=v1|v2|v3` muestra el loader sin redirigir, pero
 * sólo cuando la página corre en el preview local (window.WEOTZI_PREVIEW) o en
 * modo demo; en producción el parámetro se ignora.
 */
(function () {
    'use strict';

    const MESSAGES = {
        artist: 'Organizando tu agenda…',
        client: 'Explorando artistas…',
        default: 'Preparando tu espacio…',
    };

    function ensureStyles() {
        if (document.getElementById('wo-postauth-loader-styles')) return;
        const style = document.createElement('style');
        style.id = 'wo-postauth-loader-styles';
        style.textContent = [
            '.wo-postauth-loader{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--surface-page,#faf8f3);padding:var(--space-4,16px);box-sizing:border-box}',
            '.wo-postauth-loader__group{display:flex;flex-direction:column;align-items:center;transform:translateY(-29px)}',
            '.wo-postauth-loader__spinner{width:120px;height:120px;box-sizing:border-box;border-radius:50%;border:8.5px solid var(--neutral-200,#e8e3d7);border-right-color:var(--blue-500,#0041c4);transform:rotate(-30deg);animation:wo-pal-spin 1.1s linear infinite}',
            '.wo-postauth-loader__brand{display:flex;align-items:center;gap:14px;margin-top:18px;height:48px}',
            '.wo-postauth-loader__brand .m-sq{width:26px;height:26px;background:var(--red-300,#e63a1f);flex:none}',
            '.wo-postauth-loader__brand .m-ci{width:26px;height:26px;border-radius:50%;background:var(--yellow-300,#f2b519);flex:none}',
            '.wo-postauth-loader__brand .m-tr{width:0;height:0;border-left:13.6px solid transparent;border-right:13.6px solid transparent;border-bottom:24px solid var(--blue-400,#0055ff);flex:none}',
            '.wo-postauth-loader__name{margin-left:6px;font-family:var(--font-display,"Archivo Black",sans-serif);font-size:44px;line-height:1;letter-spacing:0.04em;color:var(--ink,#001125);white-space:nowrap}',
            '.wo-postauth-loader__msg{margin:28px 0 0;font-family:var(--font-mono,"JetBrains Mono",monospace);font-size:13px;line-height:17px;letter-spacing:0.12em;text-transform:uppercase;color:var(--neutral-400,#5a5449);text-align:center}',
            '@keyframes wo-pal-spin{to{transform:rotate(330deg)}}',
            '@media (prefers-reduced-motion:reduce){.wo-postauth-loader__spinner{animation-duration:3s}}',
            '@media (max-width:480px){.wo-postauth-loader__brand{gap:10px}.wo-postauth-loader__brand .m-sq,.wo-postauth-loader__brand .m-ci{width:20px;height:20px}.wo-postauth-loader__brand .m-tr{border-left-width:10.5px;border-right-width:10.5px;border-bottom-width:18px}.wo-postauth-loader__name{font-size:32px}}',
        ].join('\n');
        document.head.appendChild(style);
    }

    function show(opts) {
        const { role, targetUrl, message, delayMs = 1400, variant } = opts || {};
        ensureStyles();
        let el = document.querySelector('.wo-postauth-loader');
        if (!el) {
            el = document.createElement('div');
            el.className = 'wo-postauth-loader';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML =
                '<div class="wo-postauth-loader__group">' +
                    '<div class="wo-postauth-loader__spinner" aria-hidden="true"></div>' +
                    '<div class="wo-postauth-loader__brand" aria-hidden="true"><span class="m-sq"></span><span class="m-ci"></span><span class="m-tr"></span><span class="wo-postauth-loader__name">WE ÖTZI</span></div>' +
                    '<p class="wo-postauth-loader__msg"><span class="wo-postauth-loader__text"></span></p>' +
                '</div>';
            document.body.appendChild(el);
        }
        if (variant) el.setAttribute('data-variant', String(variant));
        const text = message || MESSAGES[role] || MESSAGES.default;
        el.querySelector('.wo-postauth-loader__text').textContent = text;
        if (targetUrl) {
            window.setTimeout(function () { window.location.href = targetUrl; }, delayMs);
        }
        return el;
    }

    function hide() {
        const el = document.querySelector('.wo-postauth-loader');
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // Parámetro de QA: sólo en preview/demo, nunca redirige.
    function isPreviewContext() {
        if (window.WEOTZI_PREVIEW === true) return true;
        try { return window.sessionStorage.getItem('wo_demo_mode') === '1'; } catch (_) { return false; }
    }

    function autostartFromQuery() {
        let variant = null;
        try { variant = new URLSearchParams(window.location.search).get('postauth'); } catch (_) { variant = null; }
        if (!variant || !/^v[123]$/.test(variant) || !isPreviewContext()) return;
        show({ role: 'artist', variant: variant });
    }

    window.WoPostAuthLoader = { show, hide };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autostartFromQuery);
    else autostartFromQuery();
})();
