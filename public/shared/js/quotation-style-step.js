/**
 * WE ÖTZI · Cotizador · Paso "¿Qué estilo estás buscando?" (frente cot-pasos)
 * --------------------------------------------------------------------------
 * Dibuja la grilla de estilos de /quotation:
 *   - con artista elegido, primero los estilos que trabaja, con la insignia
 *     "Artista";
 *   - sin artista, primero los que el sistema sugiere al analizar la idea que
 *     el cliente escribió en el paso anterior, con la etiqueta "Recomendado".
 * El orden y las etiquetas salen de WoQuotationStyleModel (lógica pura).
 * script.js conserva la selección (formData.tattoo_style) y llama a render().
 *
 * Requiere: quotation-style-model.js. Expone window.WoQuotationStyle.
 */
(function () {
    'use strict';

    var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';
    var PLACEHOLDER_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M30 6l12 12-20 20-14 4 4-14z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 10l12 12" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
    // Con el catálogo completo (60 estilos) la grilla ocupa 12 filas: se muestran
    // las 2 primeras (recomendados o del artista primero) y el resto se despliega.
    var COLLAPSED_COUNT = 10;
    var BADGES = {
        artist: { label: 'Artista', spoken: 'Estilo que trabaja el artista' },
        recommended: { label: 'Recomendado', spoken: 'Recomendado según tu idea' }
    };

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Solo URLs de imagen seguras (https o rutas locales del sitio).
    function safeImage(url) {
        var value = String(url || '').trim();
        return /^https:\/\//i.test(value) || /^\/(?!\/)/.test(value) ? value : '';
    }

    function fallbackCover(name) {
        var model = window.WoQuotationStyleModel;
        return model && typeof model.fallbackCover === 'function' ? safeImage(model.fallbackCover(name)) : '';
    }

    function arrange(styles, ctx) {
        var model = window.WoQuotationStyleModel;
        var list = Array.isArray(styles) ? styles : [];
        if (!model) {
            return { mode: 'plain', artistCount: 0, recommendedCount: 0, items: list.map(function (style) { return { style: style, badge: null, matches: [] }; }) };
        }
        return model.arrangeStyles(list, {
            artistStyles: ctx && ctx.artistStyles,
            idea: ctx && ctx.idea
        });
    }

    function joinNames(names) {
        if (names.length <= 1) return names.join('');
        return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
    }

    function hintText(view, ctx) {
        if (view.mode === 'artist') {
            var who = ctx && ctx.artistName ? String(ctx.artistName).trim() : '';
            return 'Primero ves los estilos que trabaja ' + (who || 'el artista que elegiste') + ', marcados con «Artista».';
        }
        if (view.mode === 'recommended') {
            var names = view.items.filter(function (item) { return item.badge === 'recommended'; })
                .map(function (item) { return item.style.name; });
            return 'Según tu idea te recomendamos ' + joinNames(names) + '. Están primero, con la etiqueta «Recomendado».';
        }
        return '';
    }

    function cardHtml(item, selected) {
        var style = item.style;
        var badge = item.badge ? BADGES[item.badge] : null;
        var own = safeImage(style.cover_image_url);
        var fallback = fallbackCover(style.name);
        var image = own || fallback;
        // Si la portada del catálogo falla (enlace caído), se prueba la foto propia.
        var cover = image
            ? '<img src="' + esc(image) + '" alt="" class="style-card-img" loading="lazy"' +
                (own && fallback ? ' data-fallback="' + esc(fallback) + '"' : '') + '>'
            : '<span class="style-card-placeholder">' + PLACEHOLDER_SVG + '</span>';
        var reason = item.badge === 'recommended' && item.matches && item.matches.length
            ? ' Por: ' + item.matches.join(', ') + '.'
            : '';
        var spoken = style.name + (badge ? '. ' + badge.spoken + '.' : '') + reason;

        return '' +
            '<div class="style-card-wrap' + (item.badge ? ' qp-style--' + item.badge : '') + '">' +
                '<button type="button" class="style-card' + (selected ? ' selected' : '') + '"' +
                    ' data-style-id="' + esc(style.id) + '"' +
                    (item.badge ? ' data-style-badge="' + item.badge + '"' : '') +
                    ' aria-label="' + esc(spoken) + '"' +
                    (reason ? ' title="' + esc(reason.trim()) + '"' : '') +
                    ' aria-pressed="' + (selected ? 'true' : 'false') + '">' +
                    '<span class="style-card-cover">' + cover + '</span>' +
                    (badge ? '<span class="qp-style-badge qp-style-badge--' + item.badge + '">' + badge.label + '</span>' : '') +
                    // Siempre presente; el CSS lo muestra solo en la tarjeta elegida.
                    '<span class="style-check" aria-hidden="true">' + CHECK_SVG + '</span>' +
                '</button>' +
                '<p class="style-card-title' + (selected ? ' is-selected' : '') + '">' + esc(style.name) + '</p>' +
            '</div>';
    }

    function updateSelection(grid, isSelected) {
        var cards = grid.querySelectorAll('.style-card[data-style-id]');
        for (var i = 0; i < cards.length; i++) {
            var selected = !!isSelected(cards[i].getAttribute('data-style-id'));
            cards[i].classList.toggle('selected', selected);
            cards[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
            var title = cards[i].parentNode ? cards[i].parentNode.querySelector('.style-card-title') : null;
            if (title) title.classList.toggle('is-selected', selected);
        }
    }

    function ensureHint(grid) {
        var parent = grid.parentNode;
        if (!parent) return null;
        var hint = parent.querySelector('.qp-style-hint');
        if (!hint) {
            hint = document.createElement('p');
            hint.className = 'qp-style-hint';
            hint.setAttribute('role', 'status');
            parent.insertBefore(hint, grid);
        }
        return hint;
    }

    // Botón "Ver los N estilos restantes" / "Ver menos estilos", debajo de la grilla.
    function ensureMore(grid) {
        var parent = grid.parentNode;
        if (!parent) return null;
        var more = parent.querySelector('.qp-style-more');
        if (!more) {
            more = document.createElement('button');
            more.type = 'button';
            more.className = 'wo-btn wo-btn--ghost wo-btn--s qp-style-more';
            more.addEventListener('click', function () {
                var expanded = grid.dataset.styleExpanded === '1';
                grid.dataset.styleExpanded = expanded ? '0' : '1';
                var args = grid._woStyleArgs;
                if (args) render(grid, args.styles, args.ctx);
                if (expanded && typeof grid.scrollIntoView === 'function') grid.scrollIntoView({ block: 'nearest' });
            });
            if (grid.nextSibling) parent.insertBefore(more, grid.nextSibling);
            else parent.appendChild(more);
        }
        return more;
    }

    function bind(grid, ctx) {
        grid._woStyleCtx = ctx;
        if (grid._woStyleBound) return;
        grid._woStyleBound = true;
        grid.addEventListener('click', function (event) {
            var target = event.target && event.target.closest ? event.target.closest('.style-card[data-style-id]') : null;
            if (!target || !grid.contains(target)) return;
            var current = grid._woStyleCtx;
            if (current && typeof current.onToggle === 'function') current.onToggle(target.getAttribute('data-style-id'));
        });
        // Una portada rota no deja la tarjeta vacía: vuelve al ícono.
        grid.addEventListener('error', function (event) {
            var img = event.target;
            if (!img || img.tagName !== 'IMG' || !img.classList.contains('style-card-img')) return;
            var next = img.getAttribute('data-fallback');
            if (next) {
                img.removeAttribute('data-fallback');
                img.setAttribute('src', next);
                return;
            }
            var cover = img.parentNode;
            if (cover) cover.innerHTML = '<span class="style-card-placeholder">' + PLACEHOLDER_SVG + '</span>';
        }, true);
    }

    /**
     * @param {HTMLElement} grid  #styles-grid
     * @param {Array} styles      estilos raíz de tattoo_styles
     * @param {{artistName?:string, artistStyles?:*, idea?:string,
     *          isSelected?:function(string):boolean, onToggle?:function(string)}} ctx
     */
    function render(grid, styles, ctx) {
        if (!grid) return null;
        var view = arrange(styles, ctx);
        var isSelected = ctx && typeof ctx.isSelected === 'function' ? ctx.isSelected : function () { return false; };

        // El re-render tras cada clic no debe perder el foco del teclado.
        var active = document.activeElement;
        var focusedId = active && grid.contains(active) ? active.getAttribute('data-style-id') : null;

        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', 'Estilos de tatuaje');
        grid.dataset.styleMode = view.mode;
        bind(grid, ctx || {});

        var hint = ensureHint(grid);
        if (hint) {
            var text = hintText(view, ctx);
            if (hint.textContent !== text) hint.textContent = text;
            hint.hidden = !text;
        }

        // Mismo orden que lo ya dibujado (un clic en una tarjeta): solo se
        // actualiza el estado, sin reconstruir la grilla ni recargar portadas.
        grid._woStyleArgs = { styles: styles, ctx: ctx };
        var total = view.items.length;
        var collapsible = total > COLLAPSED_COUNT + 2;
        var expanded = !collapsible || grid.dataset.styleExpanded === '1';
        // Plegada: las primeras COLLAPSED_COUNT y, siempre, las ya elegidas.
        var shown = expanded ? view.items : view.items.filter(function (item, index) {
            return index < COLLAPSED_COUNT || !!isSelected(item.style.id);
        });
        var more = ensureMore(grid);
        if (more) {
            more.hidden = !collapsible;
            more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            more.textContent = expanded ? 'Ver menos estilos' : 'Ver los ' + (total - shown.length) + ' estilos restantes';
        }
        var orderKey = shown.map(function (item) { return item.style.id + ':' + (item.badge || '') + ':' + (item.matches || []).join(','); }).join('|');
        if (grid._woStyleKey === orderKey && grid.querySelector('.style-card[data-style-id]')) {
            updateSelection(grid, isSelected);
            return view;
        }
        grid._woStyleKey = orderKey;
        grid.innerHTML = shown.map(function (item) { return cardHtml(item, !!isSelected(item.style.id)); }).join('');

        if (focusedId) {
            var buttons = grid.querySelectorAll('.style-card[data-style-id]');
            for (var i = 0; i < buttons.length; i++) {
                if (buttons[i].getAttribute('data-style-id') === focusedId) {
                    buttons[i].focus({ preventScroll: true });
                    break;
                }
            }
        }
        return view;
    }

    window.WoQuotationStyle = {
        arrange: arrange,
        hintText: hintText,
        cardHtml: cardHtml,
        COLLAPSED_COUNT: COLLAPSED_COUNT,
        render: render
    };
})();
