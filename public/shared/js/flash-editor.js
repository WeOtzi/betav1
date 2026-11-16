/**
 * WE ÖTZI · Flash Tattoos · diálogo "Datos del flash" del editor de galería
 * ------------------------------------------------------------------------
 * Lo usan el dashboard (dashboard-gallery.js) y la cuenta del artista
 * (artist-account.js). Edita título, precio + moneda, tamaño (alto × ancho en
 * cm o un texto), zonas sugeridas, "Disponible" y "Se tatúa una sola vez" /
 * "Se repite". Los datos se guardan dentro del ítem de gallery_feed_items
 * (ver flash-model.js); quien abre el diálogo persiste el feed.
 *
 *   WoFlashEditor.open(item, { onSave(nextItem) → Promise|void })
 *
 * Requiere flash-model.js (window.WoFlash) y shared/css/flash.css.
 */
(function () {
    'use strict';

    var F = window.WoFlash;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function readForm(form) {
        var data = new FormData(form);
        return {
            is_flash: data.get('is_flash') === '1',
            title: data.get('title') || '',
            price: data.get('price') || '',
            currency: data.get('currency') || 'USD',
            size_h_cm: data.get('size_h_cm') || '',
            size_w_cm: data.get('size_w_cm') || '',
            size_text: data.get('size_text') || '',
            zones: String(data.get('zones') || '').split(','),
            available: data.get('available') === '1',
            mode: data.get('mode') === 'repeat' ? 'repeat' : 'unique'
        };
    }

    function showErrors(form, errors) {
        form.querySelectorAll('.wo-error-msg[data-for]').forEach(function (el) { el.remove(); });
        form.querySelectorAll('.wo-input--error').forEach(function (el) {
            el.classList.remove('wo-input--error');
            el.removeAttribute('aria-invalid');
        });
        var first = null;
        Object.keys(errors).forEach(function (key) {
            var input = form.querySelector('[name="' + key + '"]');
            if (!input) return;
            input.classList.add('wo-input--error');
            input.setAttribute('aria-invalid', 'true');
            var msg = document.createElement('p');
            msg.className = 'wo-error-msg';
            msg.setAttribute('data-for', key);
            msg.id = 'wo-flash-err-' + key;
            msg.textContent = errors[key];
            input.setAttribute('aria-describedby', msg.id);
            (input.closest('.wo-field') || input.parentNode).appendChild(msg);
            if (!first) first = input;
        });
        if (first) first.focus();
        return !first;
    }

    function open(item, opts) {
        if (!F || !item) return null;
        var o = opts || {};
        var view = F.flashOf(item);
        var raw = item.flash && typeof item.flash === 'object' ? F.sanitizeFlash(item.flash) : F.sanitizeFlash({});
        var isFlash = !!view;
        var previous = document.querySelector('.wo-flash-dlg');
        if (previous) previous.remove();
        var lastFocus = document.activeElement;
        var currencies = F.CURRENCIES.slice();
        if (raw.currency && currencies.indexOf(raw.currency) === -1) currencies.unshift(raw.currency);

        var overlay = document.createElement('div');
        overlay.className = 'wo-flash-dlg';
        overlay.innerHTML =
            '<form class="wo-flash-dlg-card" role="dialog" aria-modal="true" aria-labelledby="wo-flash-dlg-title" novalidate>' +
                '<div class="wo-flash-dlg-head">' +
                    (item.url && item.kind !== 'video' ? '<img class="wo-flash-dlg-thumb" src="' + esc(item.url) + '" alt="" width="64" height="64">' : '') +
                    '<div><p class="wo-label">Flash Tattoos</p><h2 class="wo-flash-dlg-title" id="wo-flash-dlg-title">Datos del flash</h2>' +
                    '<p class="wo-help">Con precio, el flash muestra "Reservar este flash" en tu perfil público.</p></div>' +
                '</div>' +
                '<label class="wo-check"><input type="checkbox" name="is_flash" value="1"' + (isFlash ? ' checked' : '') + '> Es un flash (diseño listo con precio fijo)</label>' +
                '<fieldset class="wo-flash-dlg-body"' + (isFlash ? '' : ' disabled') + '>' +
                    '<div class="wo-field"><label class="wo-label" for="wo-flash-title">Título <span class="req">*</span></label>' +
                        '<input class="wo-input" id="wo-flash-title" name="title" maxlength="' + F.TITLE_MAX + '" value="' + esc(item.title || '') + '" placeholder="Golondrina tradicional"></div>' +
                    '<div class="wo-flash-dlg-row">' +
                        '<div class="wo-field"><label class="wo-label" for="wo-flash-price">Precio <span class="req">*</span></label>' +
                            '<input class="wo-input" id="wo-flash-price" name="price" inputmode="decimal" autocomplete="off" value="' + esc(raw.price != null ? F.groupThousands(raw.price) : '') + '" placeholder="120"></div>' +
                        '<div class="wo-field"><label class="wo-label" for="wo-flash-currency">Moneda</label>' +
                            '<select class="wo-select" id="wo-flash-currency" name="currency">' + currencies.map(function (c) {
                                return '<option value="' + esc(c) + '"' + (c === raw.currency ? ' selected' : '') + '>' + esc(c) + '</option>';
                            }).join('') + '</select></div>' +
                    '</div>' +
                    '<div class="wo-flash-dlg-row">' +
                        '<div class="wo-field"><label class="wo-label" for="wo-flash-h">Alto (cm)</label>' +
                            '<input class="wo-input" id="wo-flash-h" name="size_h_cm" inputmode="decimal" value="' + esc(raw.size_h_cm || '') + '" placeholder="10"></div>' +
                        '<div class="wo-field"><label class="wo-label" for="wo-flash-w">Ancho (cm)</label>' +
                            '<input class="wo-input" id="wo-flash-w" name="size_w_cm" inputmode="decimal" value="' + esc(raw.size_w_cm || '') + '" placeholder="8"></div>' +
                    '</div>' +
                    '<div class="wo-field"><label class="wo-label" for="wo-flash-size-text">Tamaño en palabras (opcional)</label>' +
                        '<input class="wo-input" id="wo-flash-size-text" name="size_text" maxlength="40" value="' + esc(raw.size_text || '') + '" placeholder="Del tamaño de la palma"></div>' +
                    '<div class="wo-field"><label class="wo-label" for="wo-flash-zones">Zonas sugeridas (opcional)</label>' +
                        '<input class="wo-input" id="wo-flash-zones" name="zones" maxlength="240" value="' + esc(raw.zones.join(', ')) + '" placeholder="Antebrazo, Pantorrilla">' +
                        '<p class="wo-help">Separa las zonas con comas. El cliente las ve primero al elegir dónde tatuarlo.</p></div>' +
                    '<label class="wo-check"><input type="checkbox" name="available" value="1"' + (raw.available !== false ? ' checked' : '') + '> Disponible para reservar</label>' +
                    '<div class="wo-flash-dlg-modes" role="radiogroup" aria-label="¿Cuántas veces se tatúa?">' +
                        '<label class="wo-radio"><input type="radio" name="mode" value="unique"' + (raw.mode !== 'repeat' ? ' checked' : '') + '> Se tatúa una sola vez (único)</label>' +
                        '<label class="wo-radio"><input type="radio" name="mode" value="repeat"' + (raw.mode === 'repeat' ? ' checked' : '') + '> Se repite</label>' +
                    '</div>' +
                    '<p class="wo-help">Un flash único pasa a "Reservado" cuando el cliente aprueba el acuerdo. Si después se cancela, vuelve a estar disponible.</p>' +
                '</fieldset>' +
                '<div class="wo-flash-dlg-actions">' +
                    '<button type="button" class="wo-btn wo-btn--ghost" data-flash-cancel>Cancelar</button>' +
                    '<button type="submit" class="wo-btn wo-btn--accent wo-btn--hard" data-flash-save>Guardar</button>' +
                '</div>' +
            '</form>';

        var form = overlay.querySelector('form');
        var body = overlay.querySelector('fieldset');
        var toggle = overlay.querySelector('[name="is_flash"]');
        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
            if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (_) { /* foco opcional */ } }
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
            if (e.key !== 'Tab') return;
            var focusables = Array.prototype.filter.call(overlay.querySelectorAll('input, select, button'), function (el) { return !el.disabled; });
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        toggle.addEventListener('change', function () { body.disabled = !toggle.checked; });
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
        overlay.querySelector('[data-flash-cancel]').addEventListener('click', close);
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var values = readForm(form);
            if (!showErrors(form, F.validateForm(values))) return;
            var next = F.applyForm(item, values);
            var save = overlay.querySelector('[data-flash-save]');
            save.disabled = true;
            Promise.resolve(typeof o.onSave === 'function' ? o.onSave(next) : null)
                .then(function () { close(); })
                .catch(function () { save.disabled = false; });
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        setTimeout(function () {
            var target = isFlash ? overlay.querySelector('[name="title"]') : toggle;
            try { target.focus(); } catch (_) { /* foco opcional */ }
        }, 30);
        return overlay;
    }

    window.WoFlashEditor = { open: open, readForm: readForm };
})();
