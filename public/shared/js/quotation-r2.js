/**
 * WE ÖTZI · Cotizador /quotation · ronda 2 (frente cot-form) — interfaz.
 * ---------------------------------------------------------------------------
 * script.js llama a estos hooks (todos opcionales: si este archivo no carga,
 * el wizard sigue funcionando con sus controles anteriores):
 *
 *   birthControlHtml / bindBirth / readBirth      fecha de nacimiento (día · mes · año)
 *   markInvalid / clearInvalid                    campo faltante en rojo + foco (P18)
 *   aiEnabled / aiTileHtml / openAiPanel          referencia generada con IA (P7)
 *   openProfile                                   perfil reducido del artista (P19)
 *   loadLocations / locationBlockHtml / chooseLocation   sede o ciudad (P27)
 *   successHtml                                   pantalla "Solicitud enviada" (P16)
 *   takeReuseHandoff                              "Cotizar con otro artista" (P32)
 *
 * Requiere quotation-r2-model.js. Todo dato de usuario o de artista se escapa.
 */
(function () {
    'use strict';

    var M = window.WoQuotationR2Model;
    if (!M) return;

    var REUSE_KEY = 'weotzi_quotation_reuse';
    var AI_DISCLAIMER = 'Es solo una referencia visual para conversar con tu artista: no es el diseño final ni un compromiso sobre el resultado.';

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function byId(id) { return document.getElementById(id); }
    function appUrl(path) {
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base + path;
    }
    function httpsUrl(value) { return typeof value === 'string' && /^https:\/\//i.test(value) ? value : ''; }
    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
    }

    // =====================================================================
    // Modal accesible (perfil del artista, IA, sede)
    // =====================================================================
    var openModals = [];

    function focusable(root) {
        return Array.prototype.slice.call(root.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    }

    function openModal(options) {
        var previous = document.activeElement;
        var overlay = document.createElement('div');
        overlay.className = 'q-r2-overlay';
        overlay.innerHTML =
            '<div class="q-r2-modal ' + esc(options.className || '') + '" role="dialog" aria-modal="true" aria-labelledby="' + esc(options.id) + '-title">' +
                '<header class="q-r2-modal-head">' +
                    '<h2 class="q-r2-modal-title" id="' + esc(options.id) + '-title" tabindex="-1">' + esc(options.title) + '</h2>' +
                    '<button type="button" class="q-r2-modal-close" data-r2-close aria-label="Cerrar">' +
                        '<i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i></button>' +
                '</header>' +
                '<div class="q-r2-modal-body">' + (options.bodyHtml || '') + '</div>' +
                (options.footHtml ? '<footer class="q-r2-modal-foot">' + options.footHtml + '</footer>' : '') +
            '</div>';
        var closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            openModals = openModals.filter(function (m) { return m !== api; });
            if (!openModals.length) document.body.style.overflow = '';
            if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
            if (typeof options.onClose === 'function') options.onClose(result);
        }
        function onKey(event) {
            if (openModals[openModals.length - 1] !== api) return;
            if (event.key === 'Escape') { event.stopPropagation(); close(null); return; }
            if (event.key !== 'Tab') return;
            var items = focusable(overlay);
            if (!items.length) return;
            var first = items[0];
            var last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) close(null); });
        overlay.addEventListener('click', function (event) {
            var btn = event.target.closest && event.target.closest('[data-r2-close]');
            if (btn) close(null);
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        var api = { el: overlay, close: close };
        openModals.push(api);
        var title = overlay.querySelector('.q-r2-modal-title');
        if (title) title.focus();
        return api;
    }

    // =====================================================================
    // P15 · Fecha de nacimiento: día · mes · año en campos separados
    // =====================================================================
    function optionList(items, selected, placeholder) {
        return '<option value="">' + esc(placeholder) + '</option>' + items.map(function (item) {
            return '<option value="' + esc(item.value) + '"' + (String(item.value) === String(selected) ? ' selected' : '') + '>' + esc(item.label) + '</option>';
        }).join('');
    }

    function dayItems(year, month) {
        var out = [];
        for (var d = 1; d <= M.daysInMonth(year, month); d++) out.push({ value: d, label: String(d) });
        return out;
    }

    function birthControlHtml(value) {
        var parts = M.parseBirthDate(value);
        var months = M.MONTHS_LONG.map(function (name, i) { return { value: i + 1, label: name }; });
        var years = M.birthYears().map(function (y) { return { value: y, label: String(y) }; });
        return '' +
            '<div class="q-birth" id="q-birth" role="group" aria-label="Fecha de nacimiento">' +
                '<label class="q-birth-field"><span class="q-birth-label">Día</span>' +
                    '<select id="q-birth-day" class="wo-select" autocomplete="bday-day">' + optionList(dayItems(parts.year, parts.month), parts.day, 'Día') + '</select></label>' +
                '<label class="q-birth-field q-birth-field--month"><span class="q-birth-label">Mes</span>' +
                    '<select id="q-birth-month" class="wo-select" autocomplete="bday-month">' + optionList(months, parts.month, 'Mes') + '</select></label>' +
                '<label class="q-birth-field"><span class="q-birth-label">Año</span>' +
                    '<select id="q-birth-year" class="wo-select" autocomplete="bday-year">' + optionList(years, parts.year, 'Año') + '</select></label>' +
            '</div>' +
            '<p class="q-block-help" id="q-birth-help">Necesitas tener al menos ' + M.MIN_AGE + ' años para cotizar un tatuaje.</p>' +
            '<div id="q-birth-notice" class="q-birth-notice hidden" role="status" aria-live="polite"></div>';
    }

    function readBirth() {
        var day = byId('q-birth-day');
        var month = byId('q-birth-month');
        var year = byId('q-birth-year');
        if (!day || !month || !year) return null;
        var parts = { day: Number(day.value) || null, month: Number(month.value) || null, year: Number(year.value) || null };
        var status = M.birthStatus(parts);
        return { parts: parts, status: status, value: status.valid ? M.formatBirthDate(parts) : null };
    }

    function renderBirthNotice(status) {
        var notice = byId('q-birth-notice');
        if (!notice) return;
        if (status.complete && (!status.real || status.tooYoung)) {
            notice.className = 'q-birth-notice wo-alert wo-alert--error';
            notice.innerHTML = '<i data-wo-icon="alert-triangle" class="wo-icon-18" aria-hidden="true"></i><p>' +
                (status.real
                    ? 'Para cotizar un tatuaje necesitas tener al menos ' + M.MIN_AGE + ' años. Elige otra fecha.'
                    : 'Esa fecha no existe. Revisa el día y el mes.') + '</p>';
        } else if (status.minor) {
            notice.className = 'q-birth-notice wo-alert wo-alert--warning';
            notice.innerHTML = '<i data-wo-icon="info" class="wo-icon-18" aria-hidden="true"></i><div>' +
                '<p><strong>Eres menor de edad.</strong> Para tatuarte necesitas la autorización de tu madre, tu padre o tu representante legal.</p>' +
                '<p>El artista verá en tu solicitud que es de una persona menor de edad y te pedirá esa autorización.</p></div>';
        } else {
            notice.className = 'q-birth-notice hidden';
            notice.innerHTML = '';
        }
    }

    function bindBirth(onChange) {
        var day = byId('q-birth-day');
        var month = byId('q-birth-month');
        var year = byId('q-birth-year');
        if (!day || !month || !year) return;
        function sync() {
            // Los días se ajustan al mes y al año elegidos (28–31).
            var chosen = Number(day.value) || null;
            var max = M.daysInMonth(Number(year.value) || null, Number(month.value) || null);
            if (day.options.length - 1 !== max) {
                day.innerHTML = optionList(dayItems(Number(year.value) || null, Number(month.value) || null), chosen && chosen <= max ? chosen : '', 'Día');
            }
            var current = readBirth();
            renderBirthNotice(current.status);
            if (typeof onChange === 'function') onChange(current);
        }
        [day, month, year].forEach(function (el) { el.addEventListener('change', sync); });
        var initial = readBirth();
        if (initial) renderBirthNotice(initial.status);
    }

    // =====================================================================
    // P18 · Falta un dato: se resalta en rojo, con mensaje y foco
    // =====================================================================
    function clearInvalid(root) {
        var scope = root || document;
        scope.querySelectorAll('.q-field-error').forEach(function (el) { el.remove(); });
        scope.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
        scope.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
            el.removeAttribute('aria-invalid');
            if (el.dataset && el.dataset.r2Describedby) {
                el.removeAttribute('aria-describedby');
                delete el.dataset.r2Describedby;
            }
        });
    }

    function clearBlock(block) {
        if (!block) return;
        clearInvalid(block);
        block.classList.remove('is-invalid');
        block.removeAttribute('aria-invalid');
    }

    /**
     * errors: [{ message, block, el }] en el orden de la pantalla. `block` es el
     * bloque de la pregunta y `el` el control (si es un campo de texto o select).
     * Marca todos y enfoca el primero.
     */
    function markInvalid(errors) {
        var list = (errors || []).filter(function (e) { return e && (e.block || e.el); });
        var firstTarget = null;
        list.forEach(function (error, index) {
            var block = error.block || (error.el && error.el.closest && error.el.closest('.q-block')) || error.el;
            var control = error.el && error.el !== block ? error.el : null;
            if (!block) return;
            clearBlock(block);
            block.classList.add('is-invalid');
            var messageId = 'q-error-' + (block.id || index);
            var message = document.createElement('p');
            message.className = 'q-field-error';
            message.id = messageId;
            message.setAttribute('role', index === 0 ? 'alert' : 'note');
            message.innerHTML = '<i data-wo-icon="alert-circle" class="wo-icon-18" aria-hidden="true"></i><span>' + esc(error.message || 'Completa este dato.') + '</span>';
            block.appendChild(message);

            var target = control;
            if (control) {
                control.classList.add('is-invalid');
                control.setAttribute('aria-invalid', 'true');
                if (!control.getAttribute('aria-describedby')) {
                    control.setAttribute('aria-describedby', messageId);
                    control.dataset.r2Describedby = '1';
                }
            } else {
                // Grupo de opciones (botones, tarjetas): el estado va en el bloque.
                block.setAttribute('aria-invalid', 'true');
                target = block.querySelector('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not(.hidden), select:not([disabled]), textarea:not([disabled])');
                if (!target) { block.setAttribute('tabindex', '-1'); target = block; }
            }
            if (!firstTarget) firstTarget = target;

            // El rojo se va cuando la persona corrige: al escribir o elegir en un
            // campo; en un grupo de opciones (botones, tarjetas), al tocar una.
            var events = control ? ['input', 'change'] : ['input', 'change', 'click'];
            var release = function () {
                clearBlock(block);
                events.forEach(function (name) { block.removeEventListener(name, release); });
            };
            // El click que llega del propio "Continuar" ya pasó: se escucha desde el próximo.
            setTimeout(function () {
                events.forEach(function (name) { block.addEventListener(name, release); });
            }, 0);
        });
        if (firstTarget) {
            if (typeof firstTarget.focus === 'function') firstTarget.focus({ preventScroll: true });
            var scrollEl = firstTarget.closest ? (firstTarget.closest('.q-block') || firstTarget) : firstTarget;
            if (scrollEl && typeof scrollEl.scrollIntoView === 'function') scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return list.length;
    }

    // =====================================================================
    // P7 · Referencia generada con IA (solo referencial)
    // =====================================================================
    function aiEnabled() {
        try {
            var cm = window.ConfigManager;
            if (cm && typeof cm.getValue === 'function') return cm.getValue('gemini.enabled') === true;
            return !!(window.CONFIG && window.CONFIG.gemini && window.CONFIG.gemini.enabled === true);
        } catch (_) { return false; }
    }

    function aiTileHtml() {
        return '<i data-wo-icon="zap" aria-hidden="true"></i><span>Generar referencia con IA</span><small>Solo referencial</small>';
    }

    function dataUrlToFile(dataUrl, name) {
        var match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
        if (!match) return null;
        var binary = atob(match[2]);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
        return new File([bytes], name + '.' + ext, { type: match[1] });
    }

    /**
     * ctx: { request(body) → Promise<{ image }>, payload() → { idea, styles, body_part, color },
     *        onUse(file) → Promise|void, canAdd() → boolean }
     */
    function openAiPanel(ctx) {
        var payload = ctx.payload();
        var idea = String(payload.idea || '').trim();
        var state = { busy: false, image: null };
        var modal = openModal({
            id: 'q-ai',
            className: 'q-r2-modal--ai',
            title: 'Generar una referencia con IA',
            bodyHtml:
                '<p class="q-ai-copy">Creamos una imagen a partir de tu idea, tu estilo y la zona que elegiste.</p>' +
                '<p class="q-ai-disclaimer"><i data-wo-icon="info" class="wo-icon-18" aria-hidden="true"></i><span><strong>Solo referencial.</strong> ' + esc(AI_DISCLAIMER) + '</span></p>' +
                '<div class="q-ai-idea"><span class="q-block-label">Tu idea</span><p>' + (idea ? esc(idea.slice(0, 280)) + (idea.length > 280 ? '…' : '') : 'Todavía no escribiste tu idea.') + '</p></div>' +
                '<div class="q-ai-stage" id="q-ai-stage" aria-live="polite"></div>' +
                '<p class="q-ai-error hidden" id="q-ai-error" role="alert"></p>',
            footHtml:
                '<button type="button" class="wo-btn wo-btn--hard btn-primary" id="q-ai-generate">' +
                    '<i data-wo-icon="zap" class="wo-icon-18" aria-hidden="true"></i> <span>Generar imagen</span></button>' +
                '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard hidden" id="q-ai-use">Usar como referencia</button>' +
                '<button type="button" class="wo-btn wo-btn--ghost btn-secondary" data-r2-close>Cancelar</button>'
        });
        var root = modal.el;
        var stage = root.querySelector('#q-ai-stage');
        var errorEl = root.querySelector('#q-ai-error');
        var generateBtn = root.querySelector('#q-ai-generate');
        var useBtn = root.querySelector('#q-ai-use');

        function showError(message) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
        function setBusy(busy) {
            state.busy = busy;
            generateBtn.disabled = busy;
            useBtn.disabled = busy;
            if (busy) {
                generateBtn.setAttribute('aria-busy', 'true');
                stage.innerHTML = '<div class="q-ai-loading"><div class="wo-spinner" aria-hidden="true"></div><p>Generando tu referencia… puede tardar hasta un minuto.</p></div>';
            } else {
                generateBtn.removeAttribute('aria-busy');
            }
        }
        function generate() {
            if (state.busy) return;
            errorEl.classList.add('hidden');
            if (idea.length < 10) {
                showError('Primero cuéntanos tu idea (paso 01) con un poco más de detalle.');
                return;
            }
            setBusy(true);
            ctx.request(payload).then(function (data) {
                var src = data && typeof data.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.image) ? data.image : '';
                if (!src) throw new Error('No pudimos generar la imagen. Inténtalo de nuevo.');
                state.image = src;
                stage.innerHTML = '<figure class="q-ai-result"><img src="' + esc(src) + '" alt="Referencia generada con IA a partir de tu idea">' +
                    '<figcaption class="q-ai-badge"><i data-wo-icon="zap" aria-hidden="true"></i> Generada con IA · solo referencial</figcaption></figure>';
                useBtn.classList.remove('hidden');
                generateBtn.querySelector('span').textContent = 'Generar otra';
            }).catch(function (error) {
                stage.innerHTML = '';
                showError((error && error.message) || 'No pudimos generar la imagen. Inténtalo de nuevo.');
            }).then(function () { setBusy(false); });
        }
        generateBtn.addEventListener('click', generate);
        useBtn.addEventListener('click', function () {
            if (state.busy || !state.image) return;
            if (!ctx.canAdd()) { showError('Ya tienes 4 referencias. Quita una para agregar esta.'); return; }
            var file = dataUrlToFile(state.image, 'referencia-ia');
            if (!file) { showError('No pudimos preparar la imagen. Genera otra.'); return; }
            useBtn.disabled = true;
            Promise.resolve(ctx.onUse(file)).then(function () { modal.close('used'); }, function () {
                useBtn.disabled = false;
                showError('No pudimos agregar la imagen. Inténtalo de nuevo.');
            });
        });
        return modal;
    }

    // =====================================================================
    // P19 · Perfil reducido del artista (centrado en su portfolio)
    // =====================================================================
    function badgesHtml(s) {
        return M.suggestionBadges(s).map(function (b) {
            return '<span class="q-sug-badge q-sug-badge--' + esc(b.key) + '"><i data-wo-icon="' + esc(b.icon) + '" aria-hidden="true"></i>' + esc(b.label) + '</span>';
        }).join('');
    }

    function tagsHtml(s) {
        var tags = M.suggestionTags(s);
        if (!tags.length) return '';
        return '<ul class="q-sug-why" aria-label="Por qué te lo sugerimos">' + tags.map(function (t) {
            return '<li class="q-sug-tag q-sug-tag--' + esc(t.tone) + '">' + esc(t.label) + '</li>';
        }).join('') + '</ul>';
    }

    function profileHref(s) {
        return appUrl('/artist/profile?artist=' + encodeURIComponent((s && s.username) || ''));
    }

    /** options: { canChoose, onChoose() } */
    function openProfile(s, options) {
        var opts = options || {};
        var name = s.name || s.username || 'Artista';
        var picture = httpsUrl(s.profile_picture);
        var place = [s.city, s.country].filter(Boolean).join(', ');
        var styles = Array.isArray(s.styles) ? s.styles.filter(Boolean).slice(0, 4) : [];
        var items = M.portfolioItems(s, 12);
        var facts = [
            s.studio ? ['briefcase', s.studio] : null,
            place ? ['map-pin', place] : null,
            s.years_experience ? ['clock', s.years_experience + (/[a-zñ]/i.test(String(s.years_experience)) ? '' : ' años de experiencia')] : null
        ].filter(Boolean);
        var gallery = items.length
            ? '<ul class="q-prof-grid" aria-label="Trabajos de ' + esc(name) + '">' + items.map(function (item, i) {
                return '<li class="q-prof-item"><img src="' + esc(item.url) + '" alt="' + esc(item.caption || ('Trabajo ' + (i + 1) + ' de ' + name)) + '" loading="lazy" referrerpolicy="no-referrer">' +
                    (item.caption ? '<p class="q-prof-caption">' + esc(item.caption) + '</p>' : '') + '</li>';
            }).join('') + '</ul>'
            : '<div class="q-prof-empty"><i data-wo-icon="image" aria-hidden="true"></i><p>Este artista todavía no cargó trabajos en su portfolio. Puedes ver su perfil completo.</p></div>';

        var modal = openModal({
            id: 'q-prof',
            className: 'q-r2-modal--profile',
            title: name,
            bodyHtml:
                '<div class="q-prof-head">' +
                    '<span class="q-sug-avatar q-prof-avatar" aria-hidden="true">' + (picture
                        ? '<img src="' + esc(picture) + '" alt="" referrerpolicy="no-referrer">' : esc(initials(name))) + '</span>' +
                    '<div class="q-prof-id">' +
                        '<div class="q-sug-badges">' + (s.verified ? '<span class="q-sug-verified"><i data-wo-icon="check-circle" aria-hidden="true"></i> Verificado</span>' : '') + badgesHtml(s) + '</div>' +
                        (styles.length ? '<p class="q-sug-styles">' + styles.map(esc).join(' · ') + '</p>' : '') +
                        (facts.length ? '<ul class="q-prof-facts">' + facts.map(function (f) {
                            return '<li><i data-wo-icon="' + f[0] + '" class="wo-icon-18" aria-hidden="true"></i>' + esc(f[1]) + '</li>';
                        }).join('') + '</ul>' : '') +
                    '</div>' +
                '</div>' +
                tagsHtml(s) +
                (s.bio ? '<p class="q-prof-bio">' + esc(s.bio) + '</p>' : '') +
                '<h3 class="q-block-label q-prof-section">Portfolio</h3>' + gallery,
            footHtml:
                (opts.canChoose === false ? '' :
                    '<button type="button" class="wo-btn wo-btn--hard btn-primary" id="q-prof-choose">Enviar mi solicitud a este artista</button>') +
                '<a class="wo-btn wo-btn--ghost btn-secondary" href="' + esc(profileHref(s)) + '" target="_blank" rel="noopener">' +
                    'Ver perfil completo <i data-wo-icon="external-link" class="wo-icon-18" aria-hidden="true"></i>' +
                    '<span class="wo-sr-only"> (se abre en otra pestaña)</span></a>'
        });
        var choose = modal.el.querySelector('#q-prof-choose');
        if (choose) {
            choose.addEventListener('click', function () {
                modal.close('choose');
                if (typeof opts.onChoose === 'function') opts.onChoose();
            });
        }
        return modal;
    }

    // =====================================================================
    // P27 · Sede o ciudad donde tatuarse
    // =====================================================================
    var locationCache = {};

    function loadLocations(artistId) {
        var id = String(artistId || '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve([]);
        if (!locationCache[id]) {
            locationCache[id] = fetch(appUrl('/api/quotations/artist-locations?artist_id=' + encodeURIComponent(id)), { headers: { Accept: 'application/json' } })
                .then(function (response) { return response.ok ? response.json() : { options: [] }; })
                .then(function (data) { return Array.isArray(data.options) ? data.options : []; })
                .catch(function () { delete locationCache[id]; return []; });
        }
        return locationCache[id];
    }

    function locationMeta(option) {
        var parts = [M.locationKind(option), M.locationDates(option)];
        if (option.agenda === 'waitlist') parts.push('lista de espera');
        if (option.agenda === 'closed') parts.push('agenda cerrada por ahora');
        return parts.filter(Boolean).join(' · ');
    }

    function locationOptionsHtml(options, selectedKey, name) {
        var rows = [{ key: '', label: 'Sin preferencia', meta: 'Lo defines después con el artista' }].concat(
            options.map(function (o) { return { key: o.key, label: o.label, meta: locationMeta(o) }; }));
        return '<div class="q-loc-list">' + rows.map(function (row) {
            var checked = String(selectedKey || '') === String(row.key);
            return '<label class="q-loc-option' + (checked ? ' is-selected' : '') + '">' +
                '<input type="radio" name="' + esc(name) + '" value="' + esc(row.key) + '"' + (checked ? ' checked' : '') + '>' +
                '<span class="q-loc-text"><strong>' + esc(row.label) + '</strong>' + (row.meta ? '<small>' + esc(row.meta) + '</small>' : '') + '</span></label>';
        }).join('') + '</div>';
    }

    // Bloque dentro de "Cuéntanos los detalles" (cotización con artista elegido).
    function locationBlockHtml(options, selectedKey) {
        return '<fieldset class="q-loc" id="q-loc">' +
            '<legend class="q-block-label">¿Dónde quieres tatuarte?</legend>' +
            '<p class="q-block-help q-loc-help">Este artista tatúa en más de un lugar. Elige la sede o ciudad que prefieres; el artista confirma la disponibilidad.</p>' +
            locationOptionsHtml(options, selectedKey, 'q-loc') +
            '</fieldset>';
    }

    function bindLocationBlock(root, onChange) {
        if (!root) return;
        root.addEventListener('change', function (event) {
            var input = event.target;
            if (!input || input.type !== 'radio') return;
            root.querySelectorAll('.q-loc-option').forEach(function (label) {
                label.classList.toggle('is-selected', label.contains(input) && input.checked);
            });
            if (typeof onChange === 'function') onChange(input.value || null);
        });
    }

    // Artista elegido entre los sugeridos: la sede se pregunta antes de enviar.
    // Resuelve con la llave elegida ('' = sin preferencia) o null si se cancela.
    function chooseLocation(artistName, options) {
        return new Promise(function (resolve) {
            var settled = false;
            var modal = openModal({
                id: 'q-locm',
                className: 'q-r2-modal--location',
                title: '¿Dónde quieres tatuarte?',
                bodyHtml:
                    '<p class="q-ai-copy">' + esc(artistName || 'Este artista') + ' tatúa en más de un lugar. Elige la sede o ciudad que prefieres; el artista confirma la disponibilidad.</p>' +
                    '<fieldset class="q-loc"><legend class="wo-sr-only">Sede o ciudad</legend>' + locationOptionsHtml(options, '', 'q-locm') + '</fieldset>',
                footHtml:
                    '<button type="button" class="wo-btn wo-btn--hard btn-primary" id="q-locm-ok">Enviar mi solicitud</button>' +
                    '<button type="button" class="wo-btn wo-btn--ghost btn-secondary" data-r2-close>Volver</button>',
                onClose: function () { if (!settled) { settled = true; resolve(null); } }
            });
            bindLocationBlock(modal.el.querySelector('.q-loc'));
            modal.el.querySelector('#q-locm-ok').addEventListener('click', function () {
                var checked = modal.el.querySelector('input[name="q-locm"]:checked');
                settled = true;
                modal.close('ok');
                resolve(checked ? checked.value : '');
            });
        });
    }

    // =====================================================================
    // P16 · "Solicitud enviada": código corto + beneficios de la cuenta
    // =====================================================================
    function benefitRows(list, soon) {
        return list.map(function (b) {
            return '<li class="q-ok-benefit' + (soon ? ' is-soon' : '') + '">' +
                '<span class="q-ok-benefit-icon" aria-hidden="true"><i data-wo-icon="' + esc(b.icon) + '"></i></span>' +
                '<span class="q-ok-benefit-text"><strong>' + esc(b.title) + (soon ? ' <em class="q-ok-soon">Próximamente</em>' : '') + '</strong>' +
                '<small>' + esc(b.text) + '</small></span></li>';
        }).join('');
    }

    /**
     * data: { code, artistName, loggedIn, warningsHtml, minor, location }
     * Los botones usan las funciones globales del wizard (resetQuotation,
     * goToClientRegistration, showSuccessWithoutAccount).
     */
    function successHtml(data) {
        var d = data || {};
        var code = String(d.code || '');
        var message = d.artistName
            ? '<strong>' + esc(d.artistName) + '</strong> recibió tu solicitud. Te avisamos por correo cuando responda.'
            : 'Recibimos tu solicitud. Te avisamos por correo cuando haya novedades.';
        var actions = d.loggedIn
            ? '<a class="wo-btn wo-btn--hard btn-primary" href="' + esc(appUrl('/client/dashboard')) + '"><i data-wo-icon="grid" class="wo-icon-18" aria-hidden="true"></i> Ver mis cotizaciones</a>' +
              '<button type="button" class="wo-btn wo-btn--ghost btn-secondary" onclick="resetQuotation()"><i data-wo-icon="rotate-ccw" class="wo-icon-18" aria-hidden="true"></i> Cotizar otro tatuaje</button>'
            : '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard btn-primary btn-create-account" onclick="goToClientRegistration()"><i data-wo-icon="user-plus" class="wo-icon-18" aria-hidden="true"></i> Crear mi cuenta gratis</button>' +
              '<button type="button" class="wo-btn wo-btn--ghost btn-secondary btn-skip-account" onclick="showSuccessWithoutAccount()">Continuar sin cuenta <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></button>';
        return '' +
            '<section class="step active q-ok" id="step-success" aria-labelledby="success-title">' +
                '<div class="q-ok-main">' +
                    '<div class="q-ok-marks" aria-hidden="true"><span class="q-ok-square"><i data-wo-icon="check"></i></span><span class="q-ok-circle"></span><span class="q-ok-triangle"></span></div>' +
                    '<p class="q-ok-eyebrow">Listo</p>' +
                    '<h1 id="success-title" class="q-ok-title" tabindex="-1">Solicitud enviada</h1>' +
                    '<p class="q-ok-msg">' + message + '</p>' +
                    (code ? '<div class="q-ok-code"><span class="q-ok-code-label">Código de tu solicitud</span>' +
                        '<span class="q-ok-code-value" id="q-ok-code" aria-label="Código ' + esc(code.split('').join(' ')) + '">' + esc(code) + '</span>' +
                        '<button type="button" class="q-ok-copy" id="q-ok-copy" aria-label="Copiar el código de tu solicitud"><i data-wo-icon="copy" class="wo-icon-18" aria-hidden="true"></i><span>Copiar</span></button></div>' : '') +
                    (d.location ? '<p class="q-ok-detail"><i data-wo-icon="map-pin" class="wo-icon-18" aria-hidden="true"></i> Sede preferida: ' + esc(d.location) + '</p>' : '') +
                    (d.minor ? '<p class="q-ok-detail q-ok-detail--minor"><i data-wo-icon="info" class="wo-icon-18" aria-hidden="true"></i> Recuerda que, al ser menor de edad, necesitas la autorización de tu madre, tu padre o tu representante legal.</p>' : '') +
                    (d.warningsHtml || '') +
                    '<div class="q-ok-actions">' + actions + '</div>' +
                '</div>' +
                '<aside class="q-ok-side" aria-labelledby="q-ok-side-title">' +
                    '<h2 class="q-ok-side-title" id="q-ok-side-title">' + (d.loggedIn ? 'Lo que tienes con tu cuenta' : 'Con una cuenta gratuita') + '</h2>' +
                    '<ul class="q-ok-benefits">' + benefitRows(M.ACCOUNT_BENEFITS, false) + '</ul>' +
                    '<ul class="q-ok-benefits q-ok-benefits--soon" aria-label="Beneficios que llegan pronto">' + benefitRows(M.COMING_SOON_BENEFITS, true) + '</ul>' +
                '</aside>' +
            '</section>';
    }

    function bindSuccess() {
        var btn = byId('q-ok-copy');
        var value = byId('q-ok-code');
        if (!btn || !value) return;
        btn.addEventListener('click', function () {
            var label = btn.querySelector('span');
            var done = function (ok) {
                if (label) label.textContent = ok ? 'Copiado' : 'Copia el código';
                setTimeout(function () { if (label) label.textContent = 'Copiar'; }, 2000);
            };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(value.textContent || '').then(function () { done(true); }, function () { done(false); });
                } else { done(false); }
            } catch (_) { done(false); }
        });
    }

    // =====================================================================
    // P32 · "Cotizar con otro artista": borrador clonado por el servidor
    // =====================================================================
    function takeReuseHandoff() {
        try {
            var raw = localStorage.getItem(REUSE_KEY);
            if (!raw) return null;
            localStorage.removeItem(REUSE_KEY);
            var handoff = JSON.parse(raw);
            if (!handoff || !handoff.draft || !handoff.expiresAt || handoff.expiresAt < Date.now()) return null;
            var draft = handoff.draft;
            if (!/^[0-9a-f-]{36}$/i.test(String(draft.submission_key || '')) || !draft.form || typeof draft.form !== 'object') return null;
            return draft;
        } catch (_) {
            try { localStorage.removeItem(REUSE_KEY); } catch (__) { /* modo privado */ }
            return null;
        }
    }

    window.WoQuotationR2 = {
        REUSE_KEY: REUSE_KEY,
        AI_LABEL: 'Generada con IA · solo referencial',
        esc: esc,
        openModal: openModal,
        birthControlHtml: birthControlHtml,
        bindBirth: bindBirth,
        readBirth: readBirth,
        markInvalid: markInvalid,
        clearInvalid: clearInvalid,
        aiEnabled: aiEnabled,
        aiTileHtml: aiTileHtml,
        openAiPanel: openAiPanel,
        badgesHtml: badgesHtml,
        tagsHtml: tagsHtml,
        profileHref: profileHref,
        openProfile: openProfile,
        loadLocations: loadLocations,
        locationBlockHtml: locationBlockHtml,
        bindLocationBlock: bindLocationBlock,
        chooseLocation: chooseLocation,
        successHtml: successHtml,
        bindSuccess: bindSuccess,
        takeReuseHandoff: takeReuseHandoff
    };
})();
