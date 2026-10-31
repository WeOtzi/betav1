/**
 * WE OTZI - Licencias de la Store (/store/license/)
 * -------------------------------------------------
 * Contrato: docs/plans/2026-10-30-store-artista.md (§3 y §8.4, fila license).
 *
 *   ?id=<licencia>      requireSession + getLicense → certificado imprimible
 *                       (licenseView): nivel, titular, diseño, autor, fecha,
 *                       código, estado de uso y los términos completos de su
 *                       versión. Botón «Imprimir» y estilos @media print.
 *                       La salida depende de quién mira: el vendedor vuelve
 *                       al pedido en su Store, quien compró a Mis compras y
 *                       el resto a «Verificá un código →».
 *   ?verificar=<código> público, sin sesión: verifyLicense → válida, usada,
 *                       revocada o no encontrada, con iniciales del titular.
 *                       Form para verificar otro código.
 *
 * Nunca se usa ?code= (client-auth.js lo toma como callback de OAuth): el
 * parámetro es WeotziStoreModel.VERIFY_PARAM. Sin QR (sin dependencias).
 * Datos: SOLO WeotziData.Store y WeotziStoreShell.
 */
(function () {
    'use strict';

    var M = window.WeotziStoreModel;
    var S = window.WeotziStoreShell;
    var Store = window.WeotziData && window.WeotziData.Store;

    function $(id) { return document.getElementById(id); }
    function esc(v) { return S.esc(v); }

    var STATES = ['stb-loading', 'stb-message', 'stb-cert', 'stb-verify'];
    function showState(id, focusEl) {
        STATES.forEach(function (s) { var el = $(s); if (el) el.hidden = s !== id; });
        S.hydrateIcons($(id));
        if (focusEl) { try { focusEl.focus({ preventScroll: false }); } catch (e) { focusEl.focus(); } }
    }

    function showMessage(opts) {
        var links = opts.links || [];
        var extra = links.length
            ? '<div class="stb-block"><ul class="stb-auth-links">' + links.map(function (l) { return '<li><a class="stb-link" href="' + esc(l.href) + '">' + esc(l.label) + '</a></li>'; }).join('') + '</ul></div>'
            : '';
        $('stb-message').innerHTML =
            '<header class="sts-header"><p class="sts-eyebrow">Store · Licencias</p><h1 class="sts-title" id="stb-message-title" tabindex="-1">' + esc(opts.heading || 'Licencia') + '</h1></header>' +
            '<div class="sts-panel">' + S.emptyState({ icon: opts.icon || 'award', title: opts.title, text: opts.text, actionLabel: opts.actionLabel, actionHref: opts.actionHref }) + extra + '</div>';
        showState('stb-message', $('stb-message-title'));
    }

    function clausesHtml(list) {
        return '<ol class="stb-clauses">' + (list || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ol>';
    }

    function authorHtml(view) {
        if (!view.sellerName && !view.sellerHandle) return '—';
        var name = esc(view.sellerName || view.sellerHandle);
        var handle = view.sellerHandle && view.storeUrl
            ? ' (<a class="stb-link" href="' + esc(view.storeUrl) + '">' + esc(view.sellerHandle) + '</a>)'
            : (view.sellerHandle && view.sellerName ? ' (' + esc(view.sellerHandle) + ')' : '');
        return name + handle;
    }

    function useText(view) {
        if (view.revoked) return 'Revocada';
        if (view.used) return 'Usada el ' + (view.usedLabel || '') + (view.usedNote ? ' · ' + view.usedNote : '');
        return 'Uso disponible: cubre un solo tatuaje.';
    }

    /* ------------------------------------------------------------------ */
    /* Certificado                                                         */
    /* ------------------------------------------------------------------ */

    // Link de salida según quién mira el certificado: el vendedor vuelve al
    // pedido en su Store, quien compró a Mis compras y cualquier otra persona
    // (soporte, el titular de un regalo) va a la verificación pública.
    function certificateNav(license, viewer) {
        var uid = viewer && viewer.user && viewer.user.id != null ? String(viewer.user.id) : null;
        var order = license.store_orders || null;
        var orderId = (order && order.id) || license.order_id || null;
        if (uid && license.seller_type === 'artist' && String(license.seller_id) === uid) {
            return { label: '← Pedido en tu Store', className: 'stb-back',
                href: S.appPath('/artist/store/?tab=pedidos' + (orderId ? '&pedido=' + encodeURIComponent(orderId) : '')) };
        }
        if (uid && order && String(order.buyer_user_id) === uid) {
            return { label: '← Mis compras', className: 'stb-back', href: orderId ? M.purchasesUrl(orderId) : M.purchasesUrl() };
        }
        return { label: 'Verificá un código →', className: 'stb-link', href: S.appPath('/store/license/') };
    }

    function renderCertificate(license, viewer) {
        var view = M.licenseView(license);
        var order = license.store_orders || null;
        var nav = certificateNav(license, viewer);
        var terms = view.terms;
        var verifyAbs = view.verifyUrl ? window.location.origin + view.verifyUrl : '';
        var revoked = view.revoked
            ? '<p class="wo-alert wo-alert--error">' + esc('Esta licencia fue revocada' + (view.revokeReason ? ' (' + view.revokeReason + ')' : '') + '. Ya no es válida.') + '</p>'
            : '';
        var termsHtml = terms
            ? '<section class="stb-cert-terms" aria-labelledby="stb-cert-terms-title">' +
                '<h2 id="stb-cert-terms-title">Términos de la licencia · v' + esc(terms.version) + '</h2>' +
                '<p>' + esc(terms.intro) + '</p>' +
                '<h3>' + esc(terms.title) + '</h3>' + clausesHtml(terms.clauses) +
                '<h3>' + esc(terms.commonTitle) + '</h3>' + clausesHtml(terms.common) +
              '</section>'
            : '';
        $('stb-cert').innerHTML =
            '<div class="stb-inline-actions sts-no-print">' +
                '<a class="' + nav.className + '" href="' + esc(nav.href) + '">' + esc(nav.label) + '</a>' +
                '<button class="wo-btn wo-btn--hard wo-btn--s" type="button" data-stb-print><i data-wo-icon="printer" class="wo-icon-18" aria-hidden="true"></i>Imprimir</button>' +
            '</div>' +
            revoked +
            '<article class="stb-cert">' +
                '<header class="stb-cert-head">' +
                    '<div class="sts-stack">' +
                        '<div class="stb-cert-brand"><span class="wo-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>WE ÖTZI</div>' +
                        '<p class="sts-eyebrow">Certificado de licencia de uso</p>' +
                        '<h1 class="stb-cert-title" id="stb-cert-title" tabindex="-1">Licencia ' + esc(view.tierLabel) + '</h1>' +
                        '<p class="stb-cert-design">«' + esc(view.designTitle) + '»</p>' +
                    '</div>' +
                    '<span class="' + esc(view.statusTag) + '">' + esc(view.statusLabel) + '</span>' +
                '</header>' +
                (view.tierSummary ? '<p class="stb-text">' + esc(view.tierSummary) + '</p>' : '') +
                '<dl class="sts-kv">' +
                    '<dt>Titular</dt><dd>' + esc(view.holderName || '—') + '</dd>' +
                    '<dt>Diseño</dt><dd>' + esc(view.designTitle || '—') + '</dd>' +
                    '<dt>Autor</dt><dd>' + authorHtml(view) + '</dd>' +
                    '<dt>Nivel</dt><dd>Licencia ' + esc(view.tierLabel) + '</dd>' +
                    '<dt>Emitida</dt><dd>' + esc(view.issuedLabel || '—') + '</dd>' +
                    (order && order.order_number ? '<dt>Pedido</dt><dd>' + esc('#' + order.order_number) + '</dd>' : '') +
                    '<dt>Términos</dt><dd>' + esc(view.termsLabel) + '</dd>' +
                    '<dt>Uso</dt><dd>' + esc(useText(view)) + '</dd>' +
                '</dl>' +
                '<div class="stb-cert-code">' +
                    '<span class="stb-meta">Código de verificación</span>' +
                    '<strong>' + esc(view.code || '—') + '</strong>' +
                    (verifyAbs ? '<span class="stb-text stb-text--s">Cualquiera puede verificarla en <a class="stb-link" href="' + esc(view.verifyUrl) + '">' + esc(verifyAbs) + '</a></span>' : '') +
                '</div>' +
                termsHtml +
                '<p class="stb-cert-foot">' + esc('La autoría y los derechos morales del diseño son de ' + (view.sellerName || 'su autor') +
                    '. Esta licencia es un permiso de uso emitido por la Store de We Ötzi y no transfiere la propiedad intelectual.') + '</p>' +
            '</article>';
        S.setTitle('Certificado · ' + (view.designTitle || 'Licencia'));
        showState('stb-cert', $('stb-cert-title'));
    }

    function loadCertificate(id) {
        var returnTo = '/store/license/' + (window.location.search || '');
        return S.requireSession({ returnTo: returnTo }).then(function (session) {
            if (!session) {
                var links = S.loginLinks(returnTo);
                showMessage({ icon: 'lock', heading: 'Certificado de licencia', title: 'Ingresá para ver tu certificado.',
                    text: 'Los certificados están en la cuenta de quien compró la licencia. Si te pasaron un código, también lo podés verificar sin cuenta.',
                    actionLabel: 'Ingresá →', actionHref: links.client,
                    links: [{ label: 'Creá tu cuenta →', href: links.register }, { label: '¿Sos artista? Ingresá →', href: links.artist },
                        { label: 'Verificá un código →', href: S.appPath('/store/license/') }] });
                return null;
            }
            return Promise.all([Store.getLicense(id), S.viewer()]).then(function (res) {
                var license = res[0];
                if (!license) {
                    showMessage({ icon: 'search', heading: 'Certificado de licencia', title: 'No encontramos este certificado.',
                        text: 'Puede que sea de otra cuenta o que el enlace esté incompleto. Si tenés el código, verificalo.',
                        actionLabel: 'Verificá un código →', actionHref: '/store/license/' });
                    return null;
                }
                renderCertificate(license, res[1]);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Verificación pública                                                */
    /* ------------------------------------------------------------------ */

    function verifyCopy(result, view) {
        if (!result || result.found === false || view.status === 'invalid') {
            return { title: 'No encontramos una licencia con ese código.', text: 'Revisá que esté bien escrito: WOL, cuatro caracteres, guion y otros cuatro. Si el problema sigue, consultalo con quien te pasó el código.' };
        }
        if (view.revoked) return { title: 'Licencia revocada', text: 'El código existe, pero la licencia ya no es válida: el pedido se reembolsó o la revocó soporte.' };
        if (view.used) return { title: 'Licencia válida · ya usada', text: 'La licencia es auténtica y ya se usó el ' + (view.usedLabel || '') + '. Cada licencia cubre un solo tatuaje.' };
        return { title: 'Licencia válida', text: 'La licencia es auténtica y tiene el uso disponible: cubre un solo tatuaje.' };
    }

    function renderVerifyResult(code, result) {
        var box = $('stb-verify-result');
        var view = M.licenseView(Object.assign({ code: code }, result || { valid: false, found: false }));
        // verifyLicense devuelve null solo si falló la consulta (no lanza).
        var failed = result == null;
        var copy = failed
            ? { title: 'No pudimos verificar el código ahora.', text: 'Probá de nuevo en unos minutos.' }
            : verifyCopy(result, view);
        var found = !failed && result.found !== false && view.status !== 'invalid';
        var tag = found ? view.statusTag : (failed ? 'wo-tag wo-tag--soft' : 'wo-tag wo-tag--urgent');
        var tagLabel = found ? view.statusLabel : (failed ? 'Sin verificar' : 'Código no válido');
        box.innerHTML =
            '<div class="stb-verify">' +
                '<div class="stb-verify-status"><span class="' + esc(tag) + '">' + esc(tagLabel) + '</span><span class="stb-license-code">' + esc(code) + '</span></div>' +
                '<h2 class="stb-verify-title" id="stb-verify-result-title" tabindex="-1">' + esc(copy.title) + '</h2>' +
                '<p class="stb-text">' + esc(copy.text) + '</p>' +
                (found ? '<dl class="sts-kv">' +
                    '<dt>Diseño</dt><dd>' + esc(view.designTitle || '—') + '</dd>' +
                    '<dt>Autor</dt><dd>' + authorHtml(view) + '</dd>' +
                    '<dt>Nivel</dt><dd>Licencia ' + esc(view.tierLabel) + '</dd>' +
                    '<dt>Titular</dt><dd>' + esc(view.holderInitials || '—') + '</dd>' +
                    '<dt>Emitida</dt><dd>' + esc(view.issuedLabel || '—') + '</dd>' +
                    '<dt>Términos</dt><dd>' + esc(view.termsLabel) + '</dd>' +
                    '<dt>Uso</dt><dd>' + esc(view.revoked ? 'Revocada' : (view.used ? 'Usada el ' + (view.usedLabel || '') : 'Uso disponible')) + '</dd>' +
                '</dl>' : '') +
            '</div>';
        box.hidden = false;
        S.hydrateIcons(box);
    }

    function setVerifyError(message) {
        var input = $('stb-verify-code');
        var slot = $('stb-verify-code-error');
        if (message) {
            slot.textContent = message;
            slot.hidden = false;
            input.classList.add('wo-input--error');
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'stb-verify-code-help stb-verify-code-error');
        } else {
            slot.textContent = '';
            slot.hidden = true;
            input.classList.remove('wo-input--error');
            input.removeAttribute('aria-invalid');
            input.setAttribute('aria-describedby', 'stb-verify-code-help');
        }
    }

    function verify(rawCode, opts) {
        opts = opts || {};
        var code = M.normalizeLicenseCode(rawCode);
        var input = $('stb-verify-code');
        S.setTitle('Verificar licencia');
        if (!code) {
            $('stb-verify-result').hidden = true;
            if (input) input.value = rawCode || '';
            setVerifyError('Ingresá un código con el formato WOL-XXXX-XXXX.');
            showState('stb-verify', input);
            return Promise.resolve();
        }
        setVerifyError(null);
        if (input) input.value = code;
        var btn = $('stb-verify-submit');
        S.setBusy(btn, true, 'Verificando…');
        return Store.verifyLicense(code).then(function (result) {
            renderVerifyResult(code, result);
            showState('stb-verify', opts.focusResult === false ? null : $('stb-verify-result-title'));
        }).catch(function () {
            renderVerifyResult(code, null);
            showState('stb-verify', $('stb-verify-result-title'));
        }).then(function () { S.setBusy(btn, false); });
    }

    function showVerifyForm() {
        $('stb-verify-result').hidden = true;
        setVerifyError(null);
        S.setTitle('Verificar licencia');
        showState('stb-verify');
    }

    function onVerifySubmit(e) {
        e.preventDefault();
        var raw = String($('stb-verify-code').value || '').trim();
        var code = M.normalizeLicenseCode(raw);
        var params = {};
        params[M.VERIFY_PARAM] = code || null;
        params.id = null;
        if (code) S.setParams(params, { push: true });
        verify(raw);
    }

    /* ------------------------------------------------------------------ */
    /* Arranque                                                            */
    /* ------------------------------------------------------------------ */

    function route() {
        var code = S.param(M.VERIFY_PARAM);
        var id = S.param('id');
        if (code != null) return verify(code);
        if (id) return loadCertificate(id);
        showVerifyForm();
        return Promise.resolve();
    }

    function init() {
        if (!M || !S || !Store) {
            if (window.console) console.error('[store-license] Faltan store-model.js, store-shell.js o data/store-repo.js.');
            return;
        }
        $('stb-verify-form').addEventListener('submit', onVerifySubmit);
        document.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('[data-stb-print]')) { e.preventDefault(); window.print(); }
        });
        window.addEventListener('popstate', function () { route(); });

        S.mountStoreTopbar('store-topbar', {});
        S.isStoreEnabled().then(function (enabled) {
            if (!enabled) {
                showMessage({ icon: 'clock', title: 'La Store todavía no está disponible.', text: 'Estamos terminando de prepararla. Volvé a mirarla en unos días.',
                    actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
                return null;
            }
            return route();
        }).catch(function (err) {
            if (window.console) console.error('[store-license]', err);
            showMessage({ icon: 'alert-circle', title: 'No pudimos cargar la licencia.', text: 'Probá de nuevo en unos minutos.',
                actionLabel: 'Verificá un código →', actionHref: '/store/license/' });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
