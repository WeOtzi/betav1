/**
 * WE ÖTZI · Cotizador · Paso "¿Qué tamaño imaginas?" (frente cot-pasos)
 * ---------------------------------------------------------------------
 * Tarjetas de tamaño con foto de referencia real (micro … manga) y la opción
 * "No estoy seguro" con una casilla que se marca al elegirla.
 *
 * Las fotos viven en /shared/assets/ronda2/cot-pasos/tamano-<clave>.webp
 * (manifiesto: docs/plans/ronda2-assets/cot-pasos.json). Si el archivo falta,
 * queda a la vista una ilustración propia: la silueta del cotizador con una
 * marca a escala del tamaño (1 unidad del dibujo ≈ 0,4 cm de un cuerpo real).
 *
 * script.js sigue siendo dueño del valor (formData.tattoo_size, vía
 * handleOptionSelect): este módulo solo dibuja y sincroniza el estado visual.
 * Expone window.WoQuotationSize.
 */
(function () {
    'use strict';

    var ASSET_BASE = '/shared/assets/ronda2/cot-pasos/';
    var UNSURE_VALUE = 'No estoy seguro';
    var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';

    // Marca a escala sobre la silueta (vista de frente). `parts` pinta partes
    // completas (mangas); `mark` es una elipse sobre el torso.
    var SCALE_MARKS = {
        micro: { mark: { cx: 84, cy: 100, rx: 3.5, ry: 3.5 } },
        pequeno: { mark: { cx: 84, cy: 104, rx: 9, ry: 8 } },
        mediano: { mark: { cx: 86, cy: 112, rx: 15, ry: 18 } },
        grande: { mark: { cx: 100, cy: 126, rx: 26, ry: 32 } },
        xl: { mark: { cx: 100, cy: 140, rx: 32, ry: 54 } },
        'media-manga': { parts: ['hombro', 'brazo_superior', 'codo'] },
        manga: { parts: ['hombro', 'brazo_superior', 'codo', 'antebrazo', 'muneca'] }
    };

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Mismo formato con el que handleOptionSelect guarda el valor.
    function titleCase(value) {
        var shared = window.WeotziQuotationShared;
        if (shared && typeof shared.toTitleCase === 'function') return shared.toTitleCase(String(value || ''));
        return String(value || '').split(' ').map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    }

    function isSelected(current, value) {
        return !!current && current === titleCase(value);
    }

    // Ilustración de respaldo: torso y brazos de la silueta con la marca.
    function scaleSvg(key) {
        var figure = window.WoQuotationBodyFigure;
        var spec = SCALE_MARKS[key];
        if (!figure || !spec) return '';
        var paths = figure.shapes('front').map(function (shape) {
            var on = spec.parts && shape.side === 'left' && spec.parts.indexOf(shape.part) !== -1;
            return '<path class="qp-scale-part' + (on ? ' is-on' : '') + '" d="' + shape.d + '"' +
                (shape.transform ? ' transform="' + shape.transform + '"' : '') + '/>';
        }).join('');
        var mark = spec.mark
            ? '<ellipse class="qp-scale-mark" cx="' + spec.mark.cx + '" cy="' + spec.mark.cy + '" rx="' + spec.mark.rx + '" ry="' + spec.mark.ry + '"/>'
            : '';
        // Encuadre: de los hombros a las muñecas, completo dentro de la tarjeta.
        return '<svg class="qp-scale-svg" viewBox="24 62 152 186" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + paths + mark + '</svg>';
    }

    function fallbackHtml(option) {
        var svg = scaleSvg(option.img);
        if (svg) return svg;
        // Sin la silueta cargada: el indicador punteado del diseño original.
        return '<span class="q-size-indicator q-size-indicator--' + esc(option.ind || 'm') + '" aria-hidden="true"></span>';
    }

    function cardHtml(field, option, current) {
        var selected = isSelected(current, option.value);
        var image = option.img ? ASSET_BASE + 'tamano-' + option.img + '.webp' : '';
        return '' +
            '<button type="button" class="q-size-card qp-size-card' + (selected ? ' is-selected' : '') + '"' +
                ' data-field="' + esc(field) + '" data-value="' + esc(option.value) + '"' +
                ' aria-pressed="' + (selected ? 'true' : 'false') + '" onclick="WoQuotationSize.pick(this)">' +
                '<span class="qp-size-media">' +
                    '<span class="qp-size-fallback">' + fallbackHtml(option) + '</span>' +
                    (image ? '<img class="qp-size-img" src="' + esc(image) + '" alt="" loading="lazy" decoding="async" onerror="WoQuotationSize.imageFailed(this)">' : '') +
                    '<span class="qp-size-check" aria-hidden="true">' + CHECK_SVG + '</span>' +
                '</span>' +
                '<span class="q-size-name">' + esc(option.label) + '</span>' +
                '<span class="q-size-range">' + esc(option.subtitle || '') + '</span>' +
            '</button>';
    }

    function unsureHtml(field, current) {
        var selected = isSelected(current, UNSURE_VALUE);
        return '' +
            '<button type="button" class="q-size-card qp-size-card qp-size-card--unsure' + (selected ? ' is-selected' : '') + '"' +
                ' data-field="' + esc(field) + '" data-value="' + esc(UNSURE_VALUE) + '"' +
                ' aria-pressed="' + (selected ? 'true' : 'false') + '" onclick="WoQuotationSize.pick(this)">' +
                '<span class="qp-size-unsure-box" aria-hidden="true">' + CHECK_SVG + '</span>' +
                '<span class="q-size-name">No estoy seguro</span>' +
                '<span class="q-size-range">El artista te ayuda a definirlo</span>' +
            '</button>';
    }

    /**
     * HTML del control de tamaño.
     * @param {{field:string, value:(string|null), options:Array<{label,value,subtitle,ind,img}>}} config
     */
    function render(config) {
        var field = config && config.field ? config.field : 'tattoo_size';
        var options = config && Array.isArray(config.options) ? config.options : [];
        var current = config ? config.value : null;
        return '' +
            '<div class="q-size-grid qp-size-grid" role="group" aria-label="Tamaño del tatuaje">' +
                options.map(function (option) { return cardHtml(field, option, current); }).join('') +
                unsureHtml(field, current) +
            '</div>';
    }

    // Deja aria-pressed igual que la clase que marca handleOptionSelect.
    function sync(container) {
        var scope = container || document;
        var cards = scope.querySelectorAll('.qp-size-card[data-value]');
        for (var i = 0; i < cards.length; i++) {
            cards[i].setAttribute('aria-pressed', cards[i].classList.contains('is-selected') ? 'true' : 'false');
        }
    }

    function pick(button) {
        if (!button) return;
        var field = button.getAttribute('data-field');
        var value = button.getAttribute('data-value');
        var grid = button.closest ? button.closest('.qp-size-grid') : null;
        if (typeof window.handleOptionSelect === 'function') {
            window.handleOptionSelect(field, value);
        } else if (grid) {
            // Sin el wizard (pruebas): se marca solo de forma visual.
            var cards = grid.querySelectorAll('.qp-size-card[data-value]');
            for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('is-selected', cards[i] === button);
        }
        sync(grid);
    }

    // Foto ausente o rota: se quita y queda la ilustración de respaldo.
    function imageFailed(img) {
        if (img && img.parentNode) img.parentNode.removeChild(img);
    }

    window.WoQuotationSize = {
        ASSET_BASE: ASSET_BASE,
        UNSURE_VALUE: UNSURE_VALUE,
        SCALE_MARKS: SCALE_MARKS,
        render: render,
        pick: pick,
        sync: sync,
        imageFailed: imageFailed
    };
})();
