/**
 * WE ÖTZI — Página pública de una cotización compartida
 * ------------------------------------------------------
 * /cotizacion/<token>  (ronda 2 · frente cot-detalle · [P30])
 *
 * El artista le manda el enlace a su cliente (Instagram, WhatsApp…). Sin
 * cuenta se ve la cotización —propuesta, desglose, términos y artista; el
 * servidor nunca entrega datos de salud ni de contacto— y se puede descargar
 * como PDF o imagen. La página invita a registrarse o iniciar sesión para
 * chatear, responder la propuesta y contar con soporte: al volver con sesión
 * (returnTo), la cotización se vincula a la cuenta
 * (POST /api/cot-detalle/public/:token/claim).
 *
 * Requiere config-manager.js, data/quotation-info-repo.js,
 * quote-share-model.js y quote-share-sheet.js.
 */
(function () {
    'use strict';

    var SM = window.WoQuoteShareModel;
    var Sheet = window.WoQuoteSheet;
    var CLAIM_INTENT_KEY = 'wo:quote-share:claim';
    var CLAIM_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
    var state = { token: '', sheet: null, viewer: null, view: null, claiming: false };

    function repo() { return (window.WeotziData && window.WeotziData.QuotationInfo) || window.WoQuotationInfoRepo; }
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var p = window.location.pathname || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }
    function appUrl(path) { return basePath() + path; }
    function root() { return document.getElementById('wqp-root'); }

    function shareUrl() {
        return window.location.origin + basePath() + SM.sharePath(state.token);
    }
    function authUrl(page) {
        return appUrl('/client/' + page + '?returnTo=' + encodeURIComponent(SM.sharePath(state.token)));
    }

    // Intención de vincular: se guarda al salir hacia el registro o el login y
    // se consume al volver con sesión (también si el correo de confirmación
    // abre otra pestaña). Vale 24 h y solo para este mismo enlace.
    function rememberClaimIntent() {
        try { window.localStorage.setItem(CLAIM_INTENT_KEY, JSON.stringify({ token: state.token, at: Date.now() })); } catch (_) { /* sin almacenamiento */ }
    }
    function takeClaimIntent() {
        try {
            var raw = window.localStorage.getItem(CLAIM_INTENT_KEY);
            var intent = raw ? JSON.parse(raw) : null;
            if (!intent || intent.token !== state.token) return false;
            window.localStorage.removeItem(CLAIM_INTENT_KEY);
            return Date.now() - Number(intent.at || 0) < CLAIM_INTENT_TTL_MS;
        } catch (_) { /* sin almacenamiento */ }
        return false;
    }

    // ------------------------------------------------------------ estados sin hoja
    var STATES = {
        invalid: {
            title: 'Este enlace no es válido',
            copy: 'Revisa que hayas copiado el enlace completo. Si el problema sigue, pídele a tu artista que te lo envíe de nuevo.'
        },
        not_found: {
            title: 'No encontramos esta cotización',
            copy: 'Puede que el enlace esté incompleto o que la cotización ya no exista. Pídele a tu artista un enlace nuevo.'
        },
        expired: {
            title: 'Este enlace venció',
            copy: 'Los enlaces de cotización tienen fecha de vencimiento. Pídele a tu artista uno nuevo para verla.'
        },
        revoked: {
            title: 'Tu artista desactivó este enlace',
            copy: 'Pídele uno nuevo para ver la cotización. Si ya tienes cuenta, también puedes verla desde tu panel.'
        },
        busy: {
            title: 'Demasiados intentos',
            copy: 'Espera unos minutos y vuelve a abrir el enlace.',
            retry: true
        },
        error: {
            title: 'No pudimos cargar la cotización',
            copy: 'Revisa tu conexión y vuelve a intentarlo.',
            retry: true
        }
    };

    function renderState(key) {
        var s = STATES[key] || STATES.error;
        var el = root();
        el.className = 'wqp-main is-message';
        el.innerHTML = '<div class="wqp-state">'
            + '<span class="wqs-mark" aria-hidden="true"><i></i><i></i><i></i></span>'
            + '<h1>' + esc(s.title) + '</h1><p>' + esc(s.copy) + '</p>'
            + (s.retry
                ? '<button class="wo-btn wo-btn--s" type="button" data-wqp="retry">Reintentar</button>'
                : '<a class="wo-btn wo-btn--s" href="' + esc(appUrl('/client/login')) + '">Iniciar sesión</a>')
            + '</div>';
        document.title = 'We Ötzi · ' + s.title;
    }

    // ------------------------------------------------------------ tarjeta de cuenta
    function ctaHtml() {
        var sheet = state.sheet || {};
        var viewer = state.viewer || {};
        var artist = (sheet.artist && sheet.artist.name) || 'tu artista';
        var quoteId = sheet.quote_id || '';
        var dashboard = appUrl('/client/dashboard?quote=' + encodeURIComponent(quoteId));
        var chat = appUrl('/client/chats?quote=' + encodeURIComponent(quoteId));
        var feedback = '<p class="wqp-feedback" id="wqp-feedback" role="status" aria-live="polite" hidden></p>';

        function card(kicker, title, body, actions, note) {
            return '<section class="wqp-card wqp-card--cta" aria-labelledby="wqp-cta-title">'
                + '<p class="wqp-kicker">' + esc(kicker) + '</p>'
                + '<h2 id="wqp-cta-title">' + esc(title) + '</h2>'
                + body + feedback
                + '<div class="wqp-actions">' + actions + '</div>'
                + (note ? '<p class="wqp-note">' + esc(note) + '</p>' : '')
                + '</section>';
        }
        var benefits = '<ul class="wqp-benefits">'
            + '<li>Chatea con ' + esc(artist) + ' sin salir de We Ötzi.</li>'
            + '<li>Acepta o rechaza la propuesta y coordina tus sesiones.</li>'
            + '<li>Cuenta con el soporte de We Ötzi si algo sale mal.</li>'
            + '<li>Guarda tus cotizaciones y reseñas en un solo lugar.</li>'
            + '</ul>';

        if (viewer.signed_in && viewer.linked) {
            return card('Tu cuenta', 'Esta cotización ya está en tu cuenta',
                '<p>Desde tu panel puedes responder la propuesta, chatear con ' + esc(artist) + ' y seguir tus sesiones.</p>',
                '<a class="wo-btn wo-btn--accent" href="' + esc(dashboard) + '">Abrir en mi panel</a>'
                + '<a class="wo-btn wo-btn--ghost" href="' + esc(chat) + '">Chatear con el artista</a>');
        }
        if (viewer.signed_in && viewer.can_claim) {
            return card('Tu cuenta', 'Vincula esta cotización a tu cuenta', benefits,
                '<button class="wo-btn wo-btn--accent" type="button" data-wqp="claim">Vincular a mi cuenta</button>',
                'Queda guardada en tu panel de cliente.');
        }
        if (viewer.signed_in && viewer.reason === 'own') {
            return card('Vista del cliente', 'Así ve tu cliente la cotización',
                '<p>Comparte este enlace con tu cliente. Cuando cree su cuenta, la cotización queda vinculada y pueden chatear.</p>',
                '<a class="wo-btn wo-btn--accent" href="' + esc(appUrl('/my-quotations/detail?quote=' + encodeURIComponent(quoteId))) + '">Volver al detalle</a>');
        }
        if (viewer.signed_in && viewer.reason === 'not_client') {
            return card('Cuenta de cliente', 'Necesitas una cuenta de cliente',
                '<p>Iniciaste sesión con una cuenta que no es de cliente. Crea tu cuenta de cliente para vincular esta cotización y chatear con ' + esc(artist) + '.</p>',
                '<a class="wo-btn wo-btn--accent" href="' + esc(authUrl('register')) + '" data-wqp="auth">Crear cuenta de cliente</a>');
        }
        if (viewer.signed_in) {
            // claimed · email_unverified · email_mismatch: el servidor explica el motivo.
            return card('Tu cuenta', 'No pudimos vincular esta cotización',
                '<p>' + esc(viewer.message || 'Esta cotización no se puede vincular a tu cuenta.') + '</p>',
                '<a class="wo-btn wo-btn--ghost" href="' + esc(authUrl('login')) + '" data-wqp="auth">Entrar con otra cuenta</a>');
        }
        if (sheet.claim && sheet.claim.linked) {
            return card('¿Es tu cotización?', 'Inicia sesión para responder',
                '<p>Esta cotización ya está vinculada a una cuenta. Entra con ella para responder la propuesta y chatear con ' + esc(artist) + '.</p>',
                '<a class="wo-btn wo-btn--accent" href="' + esc(authUrl('login')) + '" data-wqp="auth">Iniciar sesión</a>');
        }
        return card('Gratis · 1 minuto', 'Crea tu cuenta para responder y chatear', benefits,
            '<a class="wo-btn wo-btn--accent" href="' + esc(authUrl('register')) + '" data-wqp="auth">Crear mi cuenta</a>'
            + '<a class="wo-btn wo-btn--ghost" href="' + esc(authUrl('login')) + '" data-wqp="auth">Ya tengo cuenta</a>',
            'Al entrar, esta cotización queda vinculada a tu cuenta.');
    }

    function downloadsHtml() {
        return '<section class="wqp-card" aria-labelledby="wqp-save-title">'
            + '<p class="wqp-kicker">Guárdala</p>'
            + '<h2 id="wqp-save-title">Descarga la cotización</h2>'
            + '<div class="wqp-actions">'
                + '<button class="wo-btn wo-btn--s" type="button" data-wqp="pdf">Descargar PDF</button>'
                + '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-wqp="image">Descargar imagen</button>'
            + '</div>'
            + '<p class="wqp-note">El PDF se guarda desde el diálogo de impresión: elige «Guardar como PDF».</p>'
            + '</section>';
    }

    function render() {
        var el = root();
        el.className = 'wqp-main';
        // En pantalla la hoja no repite el enlace (ya estás en él); el PDF y la imagen sí.
        var screenView = SM.view(state.sheet, { url: '' });
        state.view = SM.view(state.sheet, { url: shareUrl() });
        el.innerHTML = '<div class="wqp-sheet">' + Sheet.html(screenView) + '</div>'
            + '<aside class="wqp-aside" aria-label="Tu cuenta y descargas">' + ctaHtml() + downloadsHtml() + '</aside>';
        document.title = 'We Ötzi · ' + screenView.title + (screenView.ref ? ' · ' + screenView.ref : '');
        var login = document.getElementById('wqp-login-link');
        if (login) {
            var signedIn = !!(state.viewer && state.viewer.signed_in);
            login.textContent = signedIn ? 'Mi panel' : 'Iniciar sesión';
            login.href = signedIn ? appUrl('/client/dashboard') : authUrl('login');
        }
    }

    function feedback(message, kind) {
        var el = document.getElementById('wqp-feedback');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'wqp-feedback' + (kind ? ' is-' + kind : '');
        el.hidden = !message;
    }

    // ------------------------------------------------------------ acciones
    async function claim(button) {
        if (state.claiming) return;
        state.claiming = true;
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
        feedback('Vinculando la cotización a tu cuenta…');
        try {
            await repo().claimShared(state.token);
            state.viewer = Object.assign({}, state.viewer, { signed_in: true, linked: true, can_claim: false, reason: null });
            if (state.sheet && state.sheet.claim) state.sheet.claim.linked = true;
            render();
            feedback('Listo: la cotización ya está en tu cuenta.', 'ok');
        } catch (error) {
            if (button && button.isConnected) { button.disabled = false; button.setAttribute('aria-busy', 'false'); }
            feedback((error && error.message) || 'No pudimos vincular la cotización. Vuelve a intentarlo.', 'error');
        } finally {
            state.claiming = false;
        }
    }

    async function withBusy(button, task, failMessage) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            await task();
        } catch (error) {
            feedback((error && error.message) || failMessage, 'error');
        } finally {
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
        }
    }

    document.addEventListener('click', function (event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-wqp]') : null;
        if (!target) return;
        var action = target.getAttribute('data-wqp');
        if (action === 'retry') { load(); return; }
        if (action === 'auth') { rememberClaimIntent(); return; }   // sigue el enlace
        if (action === 'claim') { claim(target); return; }
        if (action === 'pdf') withBusy(target, function () { return Sheet.print(state.view); }, 'No pudimos preparar el PDF.');
        if (action === 'image') withBusy(target, function () { return Sheet.downloadPng(state.view); }, 'No pudimos generar la imagen.');
    });

    // ------------------------------------------------------------ carga
    async function load() {
        var el = root();
        el.className = 'wqp-main is-message';
        el.innerHTML = '<div class="wqp-state"><span class="wqp-loading-mark" aria-hidden="true"></span><p role="status">Cargando tu cotización…</p></div>';
        try {
            if (window.ConfigManager && typeof window.ConfigManager.ready === 'function') {
                // La sesión es opcional: si la configuración tarda, se muestra igual.
                await Promise.race([
                    Promise.resolve(window.ConfigManager.ready()).catch(function () {}),
                    new Promise(function (resolve) { window.setTimeout(resolve, 4000); })
                ]);
            }
            var body = await repo().publicSheet(state.token);
            state.sheet = body.sheet || {};
            state.viewer = body.viewer || { signed_in: false };
            render();
            // Volvió del registro o del login que abrió desde acá: se vincula sola.
            if (state.viewer.signed_in && state.viewer.can_claim && takeClaimIntent()) {
                claim(document.querySelector('[data-wqp="claim"]'));
            }
        } catch (error) {
            var status = error && error.status;
            if (status === 410) renderState(error.code === 'revoked' ? 'revoked' : 'expired');
            else if (status === 404) renderState('not_found');
            else if (status === 429) renderState('busy');
            else renderState('error');
        }
    }

    function init() {
        if (!SM || !Sheet || !repo()) { renderState('error'); return; }
        state.token = SM.tokenFromPath(window.location.pathname);
        if (!state.token) { renderState('invalid'); return; }
        load();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
