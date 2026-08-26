/**
 * WE OTZI - Loader post-auth compartido (rediseño Bauhaus 2026)
 * -------------------------------------------------------------
 * Overlay de pantalla completa que se muestra tras autenticarse o completar un
 * flujo (registro, recuperación, selección de rol) mientras se redirige.
 * Frames Figma 239:2514 / 243:2917 / 415:1733: fondo crema, eyebrow mono con
 * mensaje según rol y puntos animados.
 *
 * Uso (requiere tokens.css cargado en la página):
 *   WoPostAuthLoader.show({ role: 'artist'|'client', targetUrl, message, delayMs })
 * `message` pisa el mensaje por rol; delayMs default 1400ms.
 */
(function () {
    'use strict';

    const MESSAGES = {
        artist: 'Organizando tu agenda',
        client: 'Explorando artistas',
        default: 'Preparando tu espacio',
    };

    function ensureStyles() {
        if (document.getElementById('wo-postauth-loader-styles')) return;
        const style = document.createElement('style');
        style.id = 'wo-postauth-loader-styles';
        style.textContent = [
            '.wo-postauth-loader{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-6,24px);background:var(--surface-page,#faf6ef);}',
            '.wo-postauth-loader__marks{display:flex;gap:8px;}',
            '.wo-postauth-loader__marks span{width:14px;height:14px;display:inline-block;}',
            '.wo-postauth-loader__marks .m-sq{background:var(--brand-red,#d92b2b);}',
            '.wo-postauth-loader__marks .m-ci{background:var(--brand-yellow,#f2b90d);border-radius:999px;}',
            '.wo-postauth-loader__marks .m-tr{width:0;height:0;background:none;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid var(--brand-blue,#1f4fd8);}',
            '.wo-postauth-loader__msg{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-primary,#141414);}',
            '.wo-postauth-loader__dots::after{content:"";animation:wo-pal-dots 1.2s steps(4,end) infinite;}',
            '@keyframes wo-pal-dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}',
        ].join('\n');
        document.head.appendChild(style);
    }

    function show(opts) {
        const { role, targetUrl, message, delayMs = 1400 } = opts || {};
        ensureStyles();
        let el = document.querySelector('.wo-postauth-loader');
        if (!el) {
            el = document.createElement('div');
            el.className = 'wo-postauth-loader';
            el.setAttribute('role', 'status');
            el.innerHTML =
                '<div class="wo-postauth-loader__marks" aria-hidden="true"><span class="m-sq"></span><span class="m-ci"></span><span class="m-tr"></span></div>' +
                '<p class="wo-postauth-loader__msg"><span class="wo-postauth-loader__text"></span><span class="wo-postauth-loader__dots"></span></p>';
            document.body.appendChild(el);
        }
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

    window.WoPostAuthLoader = { show, hide };
})();
