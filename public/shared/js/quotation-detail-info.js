/**
 * WE ÖTZI — Información del cliente, contacto y exportación en el expediente
 * ---------------------------------------------------------------------------
 * Ronda 2 · frente cot-detalle. Se monta en los huecos que deja
 * quotation-detail-figma.js cuando emite `wo:quotation-detail-rendered`
 * ({ quote, stage, readOnly, user }):
 *
 *   #qd-identity-actions   "Ver perfil del cliente" si el cliente tiene cuenta [P6]
 *   #qd-client-info-slot   · Datos del cliente: edad (y "menor de edad"), cover
 *                            up, primer tatuaje, condiciones médicas y alergias.
 *                            Se muestran SIEMPRE al artista de la cotización [N10].
 *                          · Contacto: email, WhatsApp, Instagram y preferencia.
 *                            Lo entrega el servidor solo si el artista está
 *                            verificado y el cliente no rechazó la cotización
 *                            (las manuales siempre) [P20/P23]. Acá NO se lee de
 *                            la fila: se pide a GET /api/cot-detalle/.../info.
 *                          · Compartir y exportar: Copiar enlace, Descargar PDF,
 *                            Descargar imagen [P30] y Denunciar (lo activa
 *                            wo-report.js, frente "denuncias").
 *
 * Requiere quotation-detail-model.js, quote-share-*.js y
 * data/quotation-info-repo.js. Debe cargarse ANTES de quotation-detail-figma.js
 * para escuchar su primer render.
 */
(function () {
    'use strict';

    var M = window.QuotationDetailModel;
    var SM = window.WoQuoteShareModel;
    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    var last = null;                                  // último detail del evento
    var cache = { key: null, info: null, error: null, loading: null };
    var busy = {};
    var scrolledToContact = false;

    function repo() { return (window.WeotziData && window.WeotziData.QuotationInfo) || window.WoQuotationInfoRepo || null; }
    function share() { return window.WoQuoteShare || null; }
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
    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }
    function safeHref(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        try {
            var url = new URL(raw, window.location.origin);
            return ['http:', 'https:', 'mailto:'].indexOf(url.protocol) !== -1 ? url.href : '';
        } catch (_) {
            return '';
        }
    }
    function toast(message, opts) {
        var el = document.getElementById('qd-toast');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('is-error', !!(opts && opts.error));
        el.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(function () { el.hidden = true; }, 4600);
    }
    function quoteKey(quote) {
        return quote ? String(quote.quote_id || quote.id) + '|' + String(quote.quote_status || '') + '|' + String(quote.client_user_id || '') : '';
    }

    // ------------------------------------------------------------ datos del servidor
    async function loadInfo(force) {
        if (!last || !last.quote) return;
        var key = quoteKey(last.quote);
        if (!force && cache.key === key && (cache.info || cache.loading)) return cache.loading || undefined;
        cache = { key: key, info: null, error: null, loading: null };
        if (isPreview() || last.readOnly) {
            // Vista de demostración / estado simulado: sin servidor. Se muestra el
            // contacto de los datos de ejemplo como lo vería un artista verificado.
            cache.info = {
                preview: true,
                manual: M.isManualQuote(last.quote),
                contact: {
                    visible: last.quote.quote_status !== 'client_rejected' || M.isManualQuote(last.quote),
                    reason: M.isManualQuote(last.quote) ? 'manual' : (last.quote.quote_status === 'client_rejected' ? 'client_rejected' : 'verified'),
                    email: last.quote.client_email || null, whatsapp: last.quote.client_whatsapp || null,
                    instagram: last.quote.client_instagram || null, preference: last.quote.client_contact_preference || null
                },
                client: { registered: !!last.quote.client_user_id },
                share: { available: false, shareable: false, links: [] }
            };
            if (!cache.info.contact.visible) Object.assign(cache.info.contact, { email: null, whatsapp: null, instagram: null, preference: null });
            return undefined;
        }
        var R = repo();
        if (!R || !last.quote.quote_id) { cache.error = new Error('sin repositorio'); return undefined; }
        cache.loading = R.info(last.quote.quote_id)
            .then(function (body) { if (cache.key === key) cache.info = body; })
            .catch(function (error) { if (cache.key === key) cache.error = error; })
            .then(function () { if (cache.key === key) cache.loading = null; });
        return cache.loading;
    }

    // ------------------------------------------------------------ marcado
    function factsHtml(quote) {
        var facts = M.clientFacts(quote, new Date());
        var minor = facts.some(function (f) { return f.key === 'age' && f.alert; });
        return '<div class="qdi-panel qdi-client">'
            + '<div class="qdi-head"><h2 class="qd-section-label" id="qdi-title">Datos del cliente</h2>'
            + (minor ? '<span class="qdi-flag qdi-flag--alert">Menor de edad</span>' : '') + '</div>'
            + '<dl class="qdi-facts">' + facts.map(function (f) {
                return '<div class="qdi-fact' + (f.wide ? ' is-wide' : '') + (f.alert ? ' is-alert' : '') + (f.highlight ? ' is-highlight' : '') + '">'
                    + '<dt class="qd-label">' + esc(f.label) + '</dt><dd>' + esc(f.value) + '</dd></div>';
            }).join('') + '</dl>'
            + '<p class="qdi-note">' + (M.isManualQuote(quote)
                ? 'Cotización manual: aquí aparece solo lo que cargaste al crearla.'
                : 'Lo declaró el cliente al pedir la cotización. Confírmalo antes de tatuar.') + '</p>'
            + (minor ? '<p class="qdi-note qdi-note--alert">Es menor de edad: pide la autorización de su madre, padre o tutor antes de agendar.</p>' : '')
            + '</div>';
    }

    function lockedHtml(title, copy, cta) {
        return '<div class="qdi-locked"><span class="qdi-lock" aria-hidden="true">'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>'
            + '<div><strong>' + esc(title) + '</strong><p>' + esc(copy) + '</p>' + (cta || '') + '</div></div>';
    }

    function contactBodyHtml() {
        if (cache.error && !cache.info) {
            return '<p class="qdi-muted">No pudimos cargar el contacto.</p>'
                + '<button class="qd-btn" type="button" data-qdi="retry">Reintentar</button>';
        }
        if (!cache.info) return '<p class="qdi-muted" role="status">Cargando contacto…</p>';
        var contact = cache.info.contact || {};
        if (!contact.visible) {
            if (contact.reason === 'client_rejected') {
                return lockedHtml('Contacto no disponible',
                    'El cliente rechazó esta cotización: sus datos de contacto ya no se muestran.');
            }
            var requested = contact.verification_state === 'Requested';
            return lockedHtml(
                requested ? 'Tu verificación está en revisión' : 'Verifica tu perfil para ver el contacto',
                requested
                    ? 'Cuando aprobemos tu perfil verás aquí el email, WhatsApp e Instagram del cliente. Mientras tanto, escríbele por el chat de la cotización.'
                    : 'El email, WhatsApp e Instagram del cliente se muestran solo a tatuadores con el perfil verificado. Mientras tanto, escríbele por el chat de la cotización.',
                '<a class="qd-btn qd-btn--accent" href="' + esc(appUrl('/artist/account#verificacion')) + '">'
                    + (requested ? 'Ver estado de la verificación' : 'Verificar mi perfil') + '</a>');
        }
        var rows = M.contactRows(contact);
        if (!rows.length) return '<p class="qdi-muted">' + (contact.reason === 'manual' ? 'No cargaste datos de contacto en esta cotización.' : 'El cliente no dejó datos de contacto.') + '</p>';
        return '<dl class="qdi-contact-list">' + rows.map(function (row) {
            var href = row.href ? safeHref(row.href) : '';
            var external = href && href.indexOf('mailto:') !== 0;
            return '<div class="qdi-contact-row"><dt class="qd-label">' + esc(row.label) + '</dt><dd>'
                + (href ? '<a href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(row.value) + '</a>' : esc(row.value))
                + '</dd></div>';
        }).join('') + '</dl>'
            + '<p class="qdi-note">' + (contact.reason === 'manual'
                ? 'Contacto que cargaste al crear la cotización.'
                : 'Lo ves porque tu perfil está verificado. Úsalo solo para esta cotización.') + '</p>';
    }

    function shareStatusText() {
        if (!cache.info) return cache.error ? '' : 'Consultando enlaces…';
        if (cache.info.preview) return 'No disponible en la vista de demostración.';
        var info = cache.info.share || {};
        if (info.available === false) return 'Los enlaces públicos se activan con la próxima actualización.';
        if (info.shareable === false) return 'Esta solicitud todavía no se puede compartir.';
        var S = share();
        return S ? S.linksStatus(info.links) : '';
    }

    function shareHtml(quote) {
        var quoteId = quote.quote_id || '';
        var info = cache.info && cache.info.share;
        var disabled = !quoteId || !share() || (cache.info && (cache.info.preview || (info && info.shareable === false)));
        var linkOff = disabled || (info && info.available === false);
        var hasLinks = !!(info && Array.isArray(info.links) && info.links.length);
        var label = 'Cotización ' + quoteId + (quote.client_full_name ? ' · ' + quote.client_full_name : '');
        return '<section class="qdi-share" aria-labelledby="qdi-share-title">'
            + '<div class="qdi-share-copy"><h2 class="qd-section-label" id="qdi-share-title">Compartir y exportar</h2>'
            + '<p class="qdi-share-lead">Envíale la cotización a tu cliente por Instagram o WhatsApp, aunque no tenga cuenta.</p>'
            + '<p class="qdi-share-status" id="qdi-share-status" role="status" aria-live="polite">' + esc(shareStatusText()) + '</p></div>'
            + '<div class="qdi-share-actions">'
                + '<button class="qd-btn qd-btn--accent" type="button" data-qdi="copy"' + (linkOff ? ' disabled' : '') + '>Copiar enlace</button>'
                + '<button class="qd-btn" type="button" data-qdi="pdf"' + (disabled ? ' disabled' : '') + '>Descargar PDF</button>'
                + '<button class="qd-btn" type="button" data-qdi="image"' + (disabled ? ' disabled' : '') + '>Descargar imagen</button>'
                + '<button class="qd-btn qd-btn--quiet" type="button" data-qdi="share-options" aria-haspopup="dialog"' + (linkOff ? ' disabled' : '') + '>'
                    + (hasLinks ? 'Gestionar enlace' : 'Opciones del enlace') + '</button>'
                + '<button class="qd-btn qd-btn--quiet qdi-report" type="button" data-wo-report data-kind="quotation" data-id="' + esc(quoteId) + '" data-label="' + esc(label) + '">Denunciar</button>'
            + '</div></section>';
    }

    function identityActionsHtml(quote) {
        if (quote.client_user_id) {
            return '<button class="qd-btn" type="button" data-qdi="client-profile" aria-haspopup="dialog">Ver perfil del cliente</button>';
        }
        return '<span class="qdi-flag" title="Todavía no creó su cuenta en We Ötzi">Cliente sin cuenta</span>';
    }

    function render() {
        if (!last || !last.quote || !M) return;
        var quote = last.quote;
        var identity = document.getElementById('qd-identity-actions');
        if (identity) identity.innerHTML = identityActionsHtml(quote);
        var slot = document.getElementById('qd-client-info-slot');
        if (!slot) return;
        slot.innerHTML = '<section class="qdi" aria-labelledby="qdi-title">'
            + factsHtml(quote)
            + '<div class="qdi-panel qdi-contact" id="qd-contacto" aria-live="polite"><h2 class="qd-section-label">Contacto del cliente</h2>' + contactBodyHtml() + '</div>'
            + '</section>'
            + shareHtml(quote);
        // "Contactar" del listado llega con #contacto: se lleva la vista al panel una vez.
        if (!scrolledToContact && cache.info && window.location.hash === '#contacto' && typeof slot.querySelector === 'function') {
            scrolledToContact = true;
            var panel = slot.querySelector('#qd-contacto');
            if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'center' });
        }
    }

    // ------------------------------------------------------------ perfil del cliente (P6)
    function monthYear(value) {
        var d = value ? new Date(value) : null;
        return d && !Number.isNaN(d.getTime()) ? MONTHS[d.getMonth()] + ' de ' + d.getFullYear() : '';
    }
    function starsHtml(rating) {
        var n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        return '<span class="qdi-stars" role="img" aria-label="' + n + ' de 5 estrellas"><span aria-hidden="true">' + '★★★★★'.slice(0, n) + '<i>' + '★★★★★'.slice(n) + '</i></span></span>';
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function profileBodyHtml(profile) {
        var p = profile || {};
        var w = p.with_artist || {};
        var place = [p.city, p.country].filter(Boolean).join(', ');
        var since = monthYear(p.member_since);
        var photo = safeHref(p.photo_url);
        var stats = [
            ['Cotizaciones contigo', w.quotations || 0],
            ['Completadas', w.completed || 0],
            ['Sesiones realizadas', w.sessions_done || 0],
            ['Sesiones agendadas', w.sessions_scheduled || 0]
        ];
        // Hasta 3 reseñas: el modal entra sin scroll en un alto de 720 px.
        var reviews = (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 3);
        return '<div class="qdi-profile-head">'
                + (photo && photo.indexOf('mailto:') !== 0
                    ? '<img class="qdi-profile-photo" src="' + esc(photo) + '" alt="" width="72" height="72" referrerpolicy="no-referrer">'
                    : '<span class="qdi-profile-photo qdi-profile-photo--initials" aria-hidden="true">' + esc(M.initials(p.name)) + '</span>')
                + '<div><h2 class="wo-modal-title" id="qdi-profile-title">' + esc(p.name || 'Cliente') + '</h2>'
                + '<p class="qdi-profile-meta">' + esc([p.username ? '@' + String(p.username).replace(/^@+/, '') : '', place, since ? 'Miembro desde ' + since : ''].filter(Boolean).join(' · ') || 'Cliente de We Ötzi') + '</p></div>'
            + '</div>'
            + '<dl class="qdi-profile-stats">' + stats.map(function (s) {
                return '<div><dt class="qd-label">' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>';
            }).join('') + '</dl>'
            + (w.first_quote_at ? '<p class="qdi-note">Primera cotización contigo: ' + esc(SM ? SM.dateLong(w.first_quote_at) : M.dayMonthYear(w.first_quote_at)) + '.</p>' : '')
            + '<div class="qdi-profile-reviews"><h3 class="qd-section-label">Reseñas que dejó' + (p.reviews_count ? ' · ' + esc(p.reviews_count) : '') + '</h3>'
            + (reviews.length ? '<ul>' + reviews.map(function (r) {
                return '<li>' + starsHtml(r.rating)
                    + (r.comment ? '<p>' + esc(r.comment) + '</p>' : '')
                    + '<small>' + esc([(r.about_type === 'studio' ? 'Sobre el estudio ' : 'Sobre ') + r.about, r.created_at ? (SM ? SM.dateLong(r.created_at) : M.dayMonthYear(r.created_at)) : ''].filter(Boolean).join(' · ')) + '</small></li>';
            }).join('') + '</ul>'
                + (p.reviews_count > reviews.length ? '<p class="qdi-note">Mostramos las ' + plural(reviews.length, 'más reciente', 'más recientes') + '.</p>' : '')
                : '<p class="qdi-muted">Todavía no dejó reseñas públicas.</p>')
            + '</div>'
            + '<p class="qdi-note">El contacto del cliente se muestra en la cotización, según la verificación de tu perfil.</p>';
    }

    function openClientProfile(trigger) {
        if (!last || !last.quote) return;
        var quote = last.quote;
        var overlay = document.createElement('div');
        overlay.className = 'wo-overlay qdi-profile-overlay';
        overlay.innerHTML = '<div class="wo-modal qdi-profile" role="dialog" aria-modal="true" aria-labelledby="qdi-profile-title" aria-busy="true">'
            + '<div class="qdi-profile-body"><h2 class="wo-modal-title" id="qdi-profile-title">' + esc(quote.client_full_name || 'Cliente') + '</h2>'
            + '<p class="qdi-muted" role="status">Cargando perfil…</p></div>'
            + '<div class="wo-modal-actions"><button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-qdi-close>Cerrar</button></div></div>';
        (document.getElementById('qd-dialog-root') || document.body).appendChild(overlay);
        var modal = overlay.querySelector('.qdi-profile');
        var body = overlay.querySelector('.qdi-profile-body');
        var closeBtn = overlay.querySelector('[data-qdi-close]');
        function close() {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            if (trigger && trigger.isConnected) trigger.focus();
            else { var again = document.querySelector('[data-qdi="client-profile"]'); if (again) again.focus(); }
        }
        function onKey(event) {
            if (event.key === 'Escape') close();
            if (event.key === 'Tab') { event.preventDefault(); closeBtn.focus(); }
        }
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) close(); });
        closeBtn.addEventListener('click', close);
        window.setTimeout(function () { closeBtn.focus(); }, 30);

        var task;
        if (isPreview() || last.readOnly) {
            task = Promise.resolve({ profile: { name: quote.client_full_name, city: quote.client_city_residence, with_artist: { quotations: 1 }, reviews: [], reviews_count: 0 } });
        } else {
            var R = repo();
            task = R ? R.clientProfile(quote.quote_id) : Promise.reject(new Error('No pudimos cargar el perfil del cliente.'));
        }
        task.then(function (res) {
            if (!overlay.isConnected) return;
            body.innerHTML = profileBodyHtml(res.profile);
        }).catch(function (error) {
            if (!overlay.isConnected) return;
            body.innerHTML = '<h2 class="wo-modal-title" id="qdi-profile-title">' + esc(quote.client_full_name || 'Cliente') + '</h2>'
                + '<p class="qdi-muted" role="alert">' + esc((error && error.message) || 'No pudimos cargar el perfil del cliente.') + '</p>';
        }).then(function () { modal.setAttribute('aria-busy', 'false'); });
    }

    // ------------------------------------------------------------ acciones
    async function withBusy(button, task) {
        var name = button.getAttribute('data-qdi');
        if (busy[name]) return;
        busy[name] = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            await task();
        } catch (error) {
            toast((error && error.message) || 'No pudimos completar la acción.', { error: true });
        } finally {
            busy[name] = false;
            if (button.isConnected) { button.disabled = false; button.setAttribute('aria-busy', 'false'); }
        }
    }

    async function refreshAfterShare() {
        await loadInfo(true);
        render();
    }

    function onAction(button) {
        var action = button.getAttribute('data-qdi');
        if (!last || !last.quote) return;
        var quoteId = last.quote.quote_id;
        var S = share();
        if (action === 'retry') {
            loadInfo(true).then(render);
            render();
        } else if (action === 'client-profile') {
            openClientProfile(button);
        } else if (action === 'share-options') {
            if (S) S.openDialog({ quoteId: quoteId, clientName: last.quote.client_full_name || '', onChange: refreshAfterShare });
        } else if (action === 'copy') {
            withBusy(button, async function () {
                var links = cache.info && cache.info.share && cache.info.share.links;
                var result = await S.copyLink(quoteId, { links: Array.isArray(links) ? links : undefined });
                await refreshAfterShare();
                if (result.copied) {
                    toast(result.created ? 'Enlace creado y copiado. Pégalo en el chat con tu cliente.' : 'Enlace copiado. Pégalo en el chat con tu cliente.');
                } else {
                    // Sin permiso de portapapeles: se muestra el enlace para copiarlo a mano.
                    S.openDialog({ quoteId: quoteId, clientName: last.quote.client_full_name || '', onChange: refreshAfterShare });
                }
            });
        } else if (action === 'pdf') {
            withBusy(button, function () { return S.downloadPdf(quoteId); });
        } else if (action === 'image') {
            withBusy(button, async function () {
                await S.downloadImage(quoteId);
                toast('Imagen descargada.');
            });
        }
    }

    // "Denunciar" lo activa wo-report.js (frente "denuncias"). Si esa página no
    // lo cargó, se intenta cargarlo una vez; si no existe, se avisa.
    var reportLoad = null;
    function reportModulePresent() {
        return !!(window.WoReport || document.querySelector('script[src*="wo-report"]'));
    }
    function onReportClick(button, event) {
        if (reportModulePresent()) return;
        event.preventDefault();
        if (!reportLoad) {
            reportLoad = new Promise(function (resolve, reject) {
                var script = document.createElement('script');
                script.src = appUrl('/shared/js/wo-report.js');
                script.onload = resolve;
                script.onerror = function () { script.remove(); reject(new Error('sin módulo')); };
                document.head.appendChild(script);
            });
        }
        reportLoad.then(function () {
            if (button.isConnected) button.click();
        }).catch(function () {
            reportLoad = null;
            toast('Las denuncias todavía no están disponibles aquí. Escríbenos desde el chat de soporte y cuéntanos qué pasó.', { error: true });
        });
    }

    document.addEventListener('click', function (event) {
        var target = event.target && event.target.closest ? event.target : null;
        if (!target) return;
        var report = target.closest('.qdi-report[data-wo-report]');
        if (report) { onReportClick(report, event); return; }
        var button = target.closest('[data-qdi]');
        if (button && (button.closest('#qd-client-info-slot') || button.closest('#qd-identity-actions'))) onAction(button);
    });

    document.addEventListener('wo:quotation-detail-rendered', function (event) {
        last = event.detail || null;
        if (!last || !last.quote) return;
        var pending = loadInfo(false);
        render();
        if (pending && typeof pending.then === 'function') pending.then(render);
    });

    window.WoQuotationDetailInfo = { render: render, reload: function () { return loadInfo(true).then(render); } };
})();
