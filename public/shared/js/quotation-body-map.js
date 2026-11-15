/**
 * WE ÖTZI · Cotizador · Paso "¿Dónde quieres llevarlo?" (frente cot-pasos)
 * ------------------------------------------------------------------------
 * Controlador de la pantalla 03 de /quotation:
 *
 *   - Silueta humana (frente y espalda) con una <path> por parte individual.
 *     Al pasar el mouse la parte se colorea y muestra su nombre; con clic, toque
 *     o teclado (flechas + Espacio) se selecciona y queda coloreada.
 *   - Grilla de zonas completas (brazo, pierna, torso…) con foto. Al elegir una
 *     se abre su ficha: lado (izquierdo / derecho / ambos), nivel de dolor,
 *     subpartes marcadas que se pueden desmarcar y datos de la zona. Al
 *     confirmar vuelve la grilla con la zona resaltada, igual que la silueta.
 *   - Resumen de lo elegido debajo de la silueta.
 *
 * La lógica vive en WoQuotationBodyModel (pura, testeada) y el dibujo en
 * WoQuotationBodyFigure. script.js conserva el estado (selectedBodyParts) y
 * escribe tattoo_body_part / tattoo_body_side: acá solo se avisa con onChange.
 *
 * Fotos de la grilla: /shared/assets/ronda2/cot-pasos/zona-<part_id>.webp
 * (manifiesto docs/plans/ronda2-assets/cot-pasos.json). Si falta el archivo se
 * prueba body_parts.image_url y, si tampoco, queda la silueta recortada.
 *
 * Expone window.WoQuotationBody.
 */
(function () {
    'use strict';

    var ASSET_BASE = '/shared/assets/ronda2/cot-pasos/';
    var ZONE_PHOTOS = { brazo: 'zona-brazo.webp', pierna: 'zona-pierna.webp', torso: 'zona-torso.webp', espalda: 'zona-espalda.webp', cabeza: 'zona-cabeza.webp' };
    // Recorte de la silueta que ilustra cada zona cuando no hay foto.
    var ZONE_CROPS = {
        cabeza: { view: 'front', box: '52 2 96 88' },
        torso: { view: 'front', box: '36 72 128 160' },
        espalda: { view: 'back', box: '36 72 128 164' },
        brazo: { view: 'front', box: '24 72 152 216' },
        pierna: { view: 'front', box: '44 184 112 272' }
    };
    var DEFAULT_CROP = { view: 'front', box: '24 4 152 454' };
    var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';
    var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></svg>';
    var IDLE_STATUS = 'Toca una parte de la silueta o elige una zona completa.';

    var state = null;
    var guardInstalled = false;
    // Fotos que ya fallaron en esta visita: no se vuelven a pedir.
    var failedImages = {};

    function model() { return window.WoQuotationBodyModel; }
    function figure() { return window.WoQuotationBodyFigure; }

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeImage(url) {
        var value = String(url || '').trim();
        return /^https:\/\//i.test(value) || /^\/(?!\/)/.test(value) ? value : '';
    }

    function mounted() {
        return !!(state && state.host && document.body && document.body.contains(state.host));
    }

    // ---------- Silueta ----------
    // Parte del catálogo que representa una forma del dibujo (o null si esa
    // parte no existe en body_parts: la forma queda inerte).
    function shapePart(shape) {
        var M = model();
        for (var i = 0; i < shape.candidates.length; i++) {
            var part = M.partById(state.catalog, shape.candidates[i]);
            if (part) return part;
        }
        return null;
    }

    function resolveShape(shape) {
        var part = shapePart(shape);
        if (!part) return null;
        if (!part.sides.length) return { part: part, sides: [null] };
        if (shape.side) return part.sides.indexOf(shape.side) !== -1 ? { part: part, sides: [shape.side] } : null;
        // Forma central de una parte con lado: representa ambos.
        return { part: part, sides: part.sides.slice() };
    }

    function shapeLabel(resolved) {
        var M = model();
        var side = resolved.sides.length === 1 ? resolved.sides[0] : null;
        return M.partLabel(state.catalog, resolved.part.id, side);
    }

    function painText(part) {
        var M = model();
        return part.pain === null ? '' : 'Dolor ' + part.pain + '/10 · ' + M.painLabel(part.pain).toLowerCase();
    }

    function figureHtml(view) {
        var F = figure();
        var first = true;
        var paths = F.shapes(view.id).map(function (shape, index) {
            var resolved = resolveShape(shape);
            var attrs = ' d="' + shape.d + '"' + (shape.transform ? ' transform="' + shape.transform + '"' : '');
            if (!resolved) return '<path class="qp-fig-part is-inert" aria-hidden="true"' + attrs + '/>';
            var tabindex = first ? '0' : '-1';
            first = false;
            return '<path class="qp-fig-part" role="checkbox" aria-checked="false" tabindex="' + tabindex + '"' +
                ' data-qp-shape="' + view.id + ':' + index + '"' +
                ' data-part="' + esc(resolved.part.id) + '"' +
                (shape.side ? ' data-side="' + shape.side + '"' : '') +
                ' aria-label="' + esc(shapeLabel(resolved)) + '"' + attrs + '/>';
        }).join('');
        var decor = (F.DECOR[view.id] || []).map(function (d) { return '<path class="qp-fig-decor" aria-hidden="true" d="' + d + '"/>'; }).join('');
        return '' +
            '<figure class="qp-fig">' +
                '<svg class="qp-fig-svg" viewBox="' + F.VIEWBOX + '" xmlns="http://www.w3.org/2000/svg" role="group"' +
                    ' aria-label="Silueta de ' + (view.id === 'front' ? 'frente' : 'espalda') + ': usa las flechas para moverte y Espacio para elegir" data-qp-view="' + view.id + '">' +
                    decor + paths +
                '</svg>' +
                '<figcaption class="qp-fig-caption">' + esc(view.label) + '</figcaption>' +
            '</figure>';
    }

    function layoutHtml() {
        var F = figure();
        return '' +
            '<div class="qp-body-layout">' +
                '<aside class="qp-body-aside" aria-label="Silueta del cuerpo">' +
                    '<p class="qp-body-status" data-qp-status role="status">' + esc(IDLE_STATUS) + '</p>' +
                    '<div class="qp-body-figures" data-qp-figures>' +
                        F.VIEWS.map(figureHtml).join('') +
                        '<span class="qp-fig-tip" data-qp-tip hidden></span>' +
                    '</div>' +
                    '<div class="qp-body-summary" data-qp-summary></div>' +
                '</aside>' +
                // La grilla se dibuja una sola vez y se oculta mientras hay una
                // ficha abierta: así las fotos no se recargan ni parpadean.
                '<div class="qp-body-main" data-qp-main>' +
                    '<div data-qp-grid>' + gridHtml() + '</div>' +
                    '<div data-qp-panel-slot class="hidden"></div>' +
                '</div>' +
            '</div>';
    }

    // Selección que se muestra: con la ficha abierta, lo que quedaría al
    // confirmar (así desmarcar una subparte se ve al instante en la silueta).
    function shownSelection() {
        var M = model();
        if (!state.openZone) return state.selection;
        if (!M.validateDraft(state.catalog, state.openZone, state.draft).ok) return state.selection;
        return M.applyZone(state.selection, state.catalog, state.openZone, state.draft);
    }

    function paintFigures() {
        var M = model();
        var shown = shownSelection();
        // Ficha abierta a la que todavía le falta el lado: la zona se insinúa
        // completa (ambos lados) para que se vea qué se está eligiendo.
        var pendingZone = state.openZone && !M.validateDraft(state.catalog, state.openZone, state.draft).ok ? state.openZone : null;
        var nodes = state.host.querySelectorAll('.qp-fig-part[data-part]');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var partId = node.getAttribute('data-part');
            var part = M.partById(state.catalog, partId);
            var side = node.getAttribute('data-side');
            var sides = !part || !part.sides.length ? [null] : (side ? [side] : part.sides);
            var on = sides.some(function (s) { return M.has(shown, partId, s); });
            var committed = sides.some(function (s) { return M.has(state.selection, partId, s); });
            node.classList.toggle('is-selected', on);
            node.classList.toggle('is-preview', on !== committed);
            var hinted = !!part && (
                (!!state.hintZone && part.zoneId === state.hintZone) ||
                (!!pendingZone && part.zoneId === pendingZone && state.draft.parts.indexOf(part.id) !== -1));
            node.classList.toggle('is-hint', hinted);
            node.setAttribute('aria-checked', on ? 'true' : 'false');
        }
    }

    // ---------- Resumen (debajo de la silueta) ----------
    function summaryHtml() {
        var M = model();
        var info = M.describe(state.selection, state.catalog);
        if (!info.count) {
            return '<p class="qp-sum-title">Tu selección</p><p class="qp-sum-empty">Aún no has elegido ninguna parte.</p>';
        }
        var pain = info.pain
            ? '<span class="qp-sum-pain">Dolor ' + (info.pain.min === info.pain.max ? info.pain.max : info.pain.min + '–' + info.pain.max) + '/10</span>'
            : '';
        return '' +
            '<p class="qp-sum-title">Tu selección ' + pain + '</p>' +
            '<ul class="qp-sum-list">' +
            info.zones.map(function (zone) {
                return '' +
                    '<li class="qp-sum-item">' +
                        '<button type="button" class="qp-sum-edit" data-qp-edit-zone="' + esc(zone.id) + '" aria-label="Editar ' + esc(zone.label) + ': ' + esc(zone.summary) + '">' +
                            '<strong>' + esc(zone.label) + '</strong> <span>' + esc(zone.summary) + '</span>' +
                        '</button>' +
                        '<button type="button" class="qp-sum-remove" data-qp-remove-zone="' + esc(zone.id) + '" aria-label="Quitar ' + esc(zone.label) + '">' + CLOSE_SVG + '</button>' +
                    '</li>';
            }).join('') +
            '</ul>' +
            (info.zones.length > 1 ? '<button type="button" class="q-inline-link qp-sum-clear" data-qp-clear>Quitar todo</button>' : '');
    }

    function renderSummary() {
        var box = state.host.querySelector('[data-qp-summary]');
        if (box) box.innerHTML = summaryHtml();
    }

    // ---------- Grilla de zonas ----------
    function zoneFallbackSvg(zone) {
        var F = figure();
        var crop = ZONE_CROPS[zone.id] || DEFAULT_CROP;
        var paths = F.shapes(crop.view).map(function (shape) {
            var part = shapePart(shape);
            var on = part && part.zoneId === zone.id;
            return '<path class="qp-mini-part' + (on ? ' is-on' : '') + '" d="' + shape.d + '"' + (shape.transform ? ' transform="' + shape.transform + '"' : '') + '/>';
        }).join('');
        return '<svg class="qp-mini-svg" viewBox="' + crop.box + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + paths + '</svg>';
    }

    function zoneStateText(zoneId) {
        var M = model();
        var info = M.describe(state.selection, state.catalog).zones.filter(function (zone) { return zone.id === zoneId; })[0];
        return info ? info.summary : '';
    }

    function tileLabel(zone, summary) {
        return zone.label + (summary ? '. En tu selección: ' + summary + '. Pulsa para editar.' : '. Pulsa para elegir lado y subpartes.');
    }

    function tileStateText(zone, summary) {
        return summary || (zone.parts.length > 1 ? zone.parts.length + ' subpartes' : '');
    }

    function zoneTileHtml(zone) {
        var summary = zoneStateText(zone.id);
        var selected = !!summary;
        // Foto local del frente → la de body_parts → (sin foto) silueta recortada.
        var candidates = [ZONE_PHOTOS[zone.id] ? ASSET_BASE + ZONE_PHOTOS[zone.id] : '', safeImage(zone.image)]
            .filter(function (url) { return url && !failedImages[url]; });
        return '' +
            '<button type="button" class="q-zone-tile qp-zone-tile' + (selected ? ' is-selected' : '') + '"' +
                ' data-qp-zone="' + esc(zone.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' +
                ' aria-label="' + esc(tileLabel(zone, summary)) + '">' +
                '<span class="q-zone-media qp-zone-media">' +
                    '<span class="qp-zone-fallback">' + zoneFallbackSvg(zone) + '</span>' +
                    (candidates.length ? '<img class="qp-zone-img" src="' + esc(candidates[0]) + '"' + (candidates[1] ? ' data-qp-alt-src="' + esc(candidates[1]) + '"' : '') + ' alt="" loading="lazy" decoding="async">' : '') +
                    '<span class="qp-zone-check" aria-hidden="true">' + CHECK_SVG + '</span>' +
                '</span>' +
                '<span class="q-zone-label">' + esc(zone.label) + '</span>' +
                '<span class="qp-zone-state">' + esc(tileStateText(zone, summary)) + '</span>' +
            '</button>';
    }

    // Actualiza las tarjetas ya dibujadas (sin reconstruirlas ni recargar fotos).
    function updateTiles() {
        var M = model();
        var tiles = state.host.querySelectorAll('[data-qp-zone]');
        for (var i = 0; i < tiles.length; i++) {
            var zone = M.zoneById(state.catalog, tiles[i].getAttribute('data-qp-zone'));
            if (!zone) continue;
            var summary = zoneStateText(zone.id);
            tiles[i].classList.toggle('is-selected', !!summary);
            tiles[i].setAttribute('aria-pressed', summary ? 'true' : 'false');
            tiles[i].setAttribute('aria-label', tileLabel(zone, summary));
            var label = tiles[i].querySelector('.qp-zone-state');
            if (label) label.textContent = tileStateText(zone, summary);
        }
    }

    function gridHtml() {
        if (!state.catalog.zones.length) return '<p class="empty-sheet-msg">No hay zonas configuradas.</p>';
        return '' +
            '<p class="qp-grid-hint">Elige una zona completa para ver su lado y sus subpartes, o marca partes sueltas en la silueta.</p>' +
            '<div class="q-zone-grid qp-zone-grid" id="body-zones-grid">' +
                state.catalog.zones.map(zoneTileHtml).join('') +
            '</div>';
    }

    // ---------- Ficha de una zona ----------
    function painTier(level) {
        return level <= 3 ? 'low' : level <= 6 ? 'mid' : level <= 8 ? 'high' : 'max';
    }

    function painMeterHtml(range) {
        var M = model();
        if (!range) return '';
        var cells = '';
        for (var i = 1; i <= 10; i++) {
            cells += '<span class="qp-pain-cell' + (i <= range.max ? ' is-on' : '') + '"></span>';
        }
        var value = range.min === range.max ? String(range.max) : range.min + '–' + range.max;
        return '' +
            '<div class="qp-pain qp-pain--' + painTier(range.max) + '" role="img" aria-label="Nivel de dolor: ' + value + ' sobre 10, ' + M.painLabel(range.max).toLowerCase() + '">' +
                '<span class="qp-pain-label">Nivel de dolor</span>' +
                '<span class="qp-pain-meter" aria-hidden="true">' + cells + '</span>' +
                '<span class="qp-pain-value">' + value + '/10 · ' + esc(M.painLabel(range.max)) + '</span>' +
            '</div>';
    }

    function sideFieldHtml(zone) {
        var M = model();
        if (!M.needsSide(state.catalog, zone.id, state.draft.parts)) return '';
        var sided = zone.parts.filter(function (part) { return part.sides.length > 0; });
        var onlySome = sided.length < zone.parts.length;
        var options = [['left', 'Izquierdo'], ['right', 'Derecho'], ['both', 'Ambos']].filter(function (option) {
            if (option[0] === 'both') return sided.some(function (part) { return part.sides.length === 2; });
            return sided.some(function (part) { return part.sides.indexOf(option[0]) !== -1; });
        });
        return '' +
            '<fieldset class="qp-panel-field" data-qp-side-field>' +
                '<legend class="q-block-label">¿De qué lado?' +
                    (onlySome ? ' <span class="qp-panel-note">Aplica a ' + esc(sided.map(function (part) { return part.label; }).join(', ')) + '</span>' : '') +
                '</legend>' +
                '<div class="q-chips qp-side-options">' +
                    options.map(function (option) {
                        return '' +
                            '<label class="qp-choice">' +
                                '<input type="radio" name="qp-side" value="' + option[0] + '" data-qp-side' + (state.draft.side === option[0] ? ' checked' : '') + '>' +
                                '<span class="q-chip qp-choice-chip">' + option[1] + '</span>' +
                            '</label>';
                    }).join('') +
                '</div>' +
            '</fieldset>';
    }

    function partsFieldHtml(zone) {
        if (zone.parts.length <= 1) return '';
        return '' +
            '<fieldset class="qp-panel-field">' +
                '<legend class="q-block-label">Subpartes incluidas <span class="qp-panel-note">Desmarca las que no quieras</span></legend>' +
                '<div class="qp-parts">' +
                    zone.parts.map(function (part) {
                        var checked = state.draft.parts.indexOf(part.id) !== -1;
                        var tip = [part.pain !== null ? painText(part) : '', part.description].filter(Boolean).join(' — ');
                        return '' +
                            '<label class="qp-part"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
                                '<input type="checkbox" value="' + esc(part.id) + '" data-qp-part aria-label="' + esc(part.label + (part.pain !== null ? ', dolor ' + part.pain + ' de 10' : '')) + '"' + (checked ? ' checked' : '') + '>' +
                                '<span class="qp-part-box" aria-hidden="true">' + CHECK_SVG + '</span>' +
                                '<span class="qp-part-name">' + esc(part.label) + '</span>' +
                                (part.pain !== null ? '<span class="qp-part-pain qp-part-pain--' + painTier(part.pain) + '" aria-hidden="true">' + part.pain + '</span>' : '') +
                            '</label>';
                    }).join('') +
                '</div>' +
            '</fieldset>';
    }

    function firstText(zone, key) {
        if (zone[key]) return zone[key];
        for (var i = 0; i < zone.parts.length; i++) {
            if (state.draft.parts.indexOf(zone.parts[i].id) !== -1 && zone.parts[i][key]) return zone.parts[i][key];
        }
        return '';
    }

    function infoHtml(zone) {
        var rows = [
            ['Sobre la zona', firstText(zone, 'description')],
            ['Cómo se siente', firstText(zone, 'experienceInfo')],
            ['Ideal para', firstText(zone, 'tattooInfo')],
            ['Dato curioso', firstText(zone, 'funFact')]
        ].filter(function (row) { return row[1]; });
        if (!rows.length) return '';
        return '' +
            '<dl class="qp-panel-info">' +
                rows.map(function (row) {
                    return '<div class="qp-info' + (row[0] === 'Dato curioso' ? ' qp-info--fact' : '') + '"><dt>' + row[0] + '</dt><dd>' + esc(row[1]) + '</dd></div>';
                }).join('') +
            '</dl>';
    }

    function panelHtml() {
        var M = model();
        var zone = M.zoneById(state.catalog, state.openZone);
        if (!zone) return '';
        var editing = M.zoneState(state.selection, state.catalog, zone.id).selected;
        var range = M.painRange(state.catalog, state.draft.parts.length ? state.draft.parts : zone.parts.map(function (part) { return part.id; }));
        return '' +
            '<section class="qp-zone-panel" data-qp-panel aria-labelledby="qp-panel-title">' +
                '<button type="button" class="q-inline-link qp-panel-back" data-qp-action="cancel">Volver a las zonas</button>' +
                '<header class="qp-panel-head">' +
                    '<h2 class="qp-panel-title" id="qp-panel-title" tabindex="-1">' + esc(zone.label) + '</h2>' +
                    painMeterHtml(range) +
                '</header>' +
                '<div class="qp-panel-body">' +
                    '<div class="qp-panel-form">' +
                        sideFieldHtml(zone) +
                        partsFieldHtml(zone) +
                        '<p class="qp-panel-error" data-qp-error role="alert"' + (state.error ? '' : ' hidden') + '>' + esc(state.error || '') + '</p>' +
                        '<div class="qp-panel-actions">' +
                            '<button type="button" class="wo-btn wo-btn--hard" data-qp-action="confirm">' + (editing ? 'Guardar cambios' : 'Confirmar parte') + '</button>' +
                            (editing ? '<button type="button" class="wo-btn wo-btn--ghost" data-qp-action="remove">Quitar esta zona</button>' : '') +
                        '</div>' +
                    '</div>' +
                    infoHtml(zone) +
                '</div>' +
            '</section>';
    }

    // Muestra la ficha de la zona abierta o la grilla (que solo se actualiza).
    function renderMain() {
        var grid = state.host.querySelector('[data-qp-grid]');
        var slot = state.host.querySelector('[data-qp-panel-slot]');
        if (!grid || !slot) return;
        var open = !!state.openZone;
        slot.innerHTML = open ? panelHtml() : '';
        slot.classList.toggle('hidden', !open);
        grid.classList.toggle('hidden', open);
        updateTiles();
    }

    function setStatus(message) {
        var node = state.host.querySelector('[data-qp-status]');
        if (node && node.textContent !== message) node.textContent = message;
    }

    function refresh() {
        paintFigures();
        renderSummary();
    }

    // ---------- Cambios de selección ----------
    function commit(next) {
        var M = model();
        state.selection = M.sanitize(next, state.catalog);
        if (typeof state.onChange === 'function') {
            state.onChange(state.selection.slice(), M.describe(state.selection, state.catalog));
        }
    }

    function focusNode(node, preventScroll) {
        if (node && typeof node.focus === 'function') node.focus({ preventScroll: !!preventScroll });
    }

    function focusIn(selector, preventScroll) {
        focusNode(state.host.querySelector(selector), preventScroll);
    }

    // Busca por valor de atributo sin armar un selector con datos del catálogo.
    function findByAttribute(name, value) {
        var nodes = state.host.querySelectorAll('[' + name + ']');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute(name) === String(value)) return nodes[i];
        }
        return null;
    }

    function scrollBehavior() {
        var reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return reduce ? 'auto' : 'smooth';
    }

    function openZone(zoneId, presetParts) {
        var M = model();
        var zone = M.zoneById(state.catalog, zoneId);
        if (!zone) return;
        state.openZone = zone.id;
        state.draft = M.draftForZone(state.selection, state.catalog, zone.id);
        if (Array.isArray(presetParts) && presetParts.length) state.draft.parts = presetParts.slice();
        state.dirty = false;
        state.error = '';
        state.hintZone = null;
        renderMain();
        refresh();
        setStatus(zone.label + (M.needsSide(state.catalog, zone.id) ? ': elige el lado, revisa las subpartes y confirma.' : ': revisa las subpartes y confirma.'));
        // En pantallas chicas la ficha queda debajo de la silueta: se trae a la
        // vista (desde arriba si no entra completa).
        var panel = state.host.querySelector('[data-qp-panel]');
        if (panel && typeof panel.scrollIntoView === 'function') {
            var fits = panel.getBoundingClientRect().height <= (window.innerHeight || 0);
            panel.scrollIntoView({ block: fits ? 'nearest' : 'start', behavior: scrollBehavior() });
        }
        focusIn('#qp-panel-title', true);
    }

    function closePanel(focusZoneId) {
        state.openZone = null;
        state.draft = null;
        state.dirty = false;
        state.error = '';
        renderMain();
        refresh();
        if (focusZoneId) focusNode(findByAttribute('data-qp-zone', focusZoneId));
    }

    // Confirma la ficha abierta. Devuelve false (y muestra el motivo) si falta algo.
    function confirmPanel() {
        var M = model();
        if (!state.openZone) return true;
        var check = M.validateDraft(state.catalog, state.openZone, state.draft);
        if (!check.ok) {
            state.error = check.message;
            var error = state.host.querySelector('[data-qp-error]');
            if (error) { error.textContent = check.message; error.hidden = false; }
            focusIn(check.reason === 'side' ? '[data-qp-side]' : '[data-qp-part]');
            return false;
        }
        var zone = M.zoneById(state.catalog, state.openZone);
        commit(M.applyZone(state.selection, state.catalog, state.openZone, state.draft));
        var zoneId = state.openZone;
        closePanel(zoneId);
        setStatus('Listo: ' + zone.label + ' · ' + zoneStateText(zoneId) + '.');
        return true;
    }

    function removeZone(zoneId) {
        var M = model();
        var zone = M.zoneById(state.catalog, zoneId);
        commit(M.removeZone(state.selection, state.catalog, zoneId));
        if (state.openZone === zoneId) closePanel(zoneId);
        else { renderMain(); refresh(); }
        if (zone) setStatus('Quitaste ' + zone.label + ' de tu selección.');
    }

    function togglePart(partId, side) {
        var M = model();
        var part = M.partById(state.catalog, partId);
        if (!part) return;
        var sides = !part.sides.length ? [null] : (side ? [side] : part.sides);
        var anyOn = sides.some(function (s) { return M.has(state.selection, part.id, s); });
        var next = state.selection;
        sides.forEach(function (s) {
            if (M.has(next, part.id, s) === anyOn) next = M.toggle(next, state.catalog, part.id, s);
        });
        commit(next);
        // La ficha abierta de esa zona se actualiza con lo recién marcado.
        if (state.openZone === part.zoneId) {
            state.draft = M.draftForZone(state.selection, state.catalog, part.zoneId);
            state.error = '';
        }
        renderMain();
        refresh();
        var label = M.partLabel(state.catalog, part.id, sides.length === 1 ? sides[0] : null);
        setStatus(anyOn ? 'Quitaste ' + label + '.' : 'Elegiste ' + label + '.' + (part.pain !== null ? ' ' + painText(part) + '.' : ''));
    }

    // ---------- Eventos ----------
    function shapeFromEvent(event) {
        var target = event.target;
        if (!target || !target.getAttribute || !target.classList || !target.classList.contains('qp-fig-part')) return null;
        return target.getAttribute('data-part') ? target : null;
    }

    function describeNode(node) {
        var M = model();
        var part = M.partById(state.catalog, node.getAttribute('data-part'));
        if (!part) return '';
        var label = node.getAttribute('aria-label') || part.label;
        return label + (part.pain !== null ? ' — ' + painText(part) : '');
    }

    function showTip(node, event) {
        var tip = state.host.querySelector('[data-qp-tip]');
        var box = state.host.querySelector('[data-qp-figures]');
        if (!tip || !box) return;
        tip.textContent = node.getAttribute('aria-label') || '';
        tip.hidden = false;
        var rect = box.getBoundingClientRect();
        // El cartel va centrado sobre el puntero sin salirse de la caja.
        var margin = Math.min(78, rect.width / 2);
        var x = Math.min(Math.max(event.clientX - rect.left, margin), rect.width - margin);
        var y = Math.max(event.clientY - rect.top - 14, 22);
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hideTip() {
        var tip = state.host.querySelector('[data-qp-tip]');
        if (tip) tip.hidden = true;
    }

    function moveFocus(node, step) {
        var svg = node.ownerSVGElement;
        if (!svg) return;
        var all = Array.prototype.slice.call(svg.querySelectorAll('.qp-fig-part[data-part]'));
        var index = all.indexOf(node);
        if (index === -1) return;
        var target = step === 'first' ? all[0] : step === 'last' ? all[all.length - 1] : all[(index + step + all.length) % all.length];
        all.forEach(function (item) { item.setAttribute('tabindex', item === target ? '0' : '-1'); });
        target.focus();
    }

    function onClick(event) {
        if (!mounted()) return;
        var target = event.target;
        var shape = shapeFromEvent(event);
        if (shape) {
            togglePart(shape.getAttribute('data-part'), shape.getAttribute('data-side'));
            return;
        }
        var el = target && target.closest ? target.closest('[data-qp-zone],[data-qp-action],[data-qp-edit-zone],[data-qp-remove-zone],[data-qp-clear]') : null;
        if (!el || !state.host.contains(el)) return;
        if (el.hasAttribute('data-qp-zone')) return openZone(el.getAttribute('data-qp-zone'));
        if (el.hasAttribute('data-qp-edit-zone')) return openZone(el.getAttribute('data-qp-edit-zone'));
        if (el.hasAttribute('data-qp-remove-zone')) return removeZone(el.getAttribute('data-qp-remove-zone'));
        if (el.hasAttribute('data-qp-clear')) {
            commit([]);
            if (state.openZone) closePanel(); else { renderMain(); refresh(); }
            setStatus('Quitaste todas las partes.');
            return;
        }
        var action = el.getAttribute('data-qp-action');
        if (action === 'confirm') confirmPanel();
        else if (action === 'cancel') { var zoneId = state.openZone; closePanel(zoneId); setStatus(IDLE_STATUS); }
        else if (action === 'remove') removeZone(state.openZone);
    }

    function onChange(event) {
        if (!mounted() || !state.openZone) return;
        var target = event.target;
        if (!target || !target.hasAttribute) return;
        var M = model();
        if (target.hasAttribute('data-qp-side')) {
            state.draft.side = target.value;
        } else if (target.hasAttribute('data-qp-part')) {
            var zone = M.zoneById(state.catalog, state.openZone);
            var boxes = state.host.querySelectorAll('[data-qp-part]');
            var checked = [];
            for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) checked.push(boxes[i].value);
            state.draft.parts = zone.parts.map(function (part) { return part.id; }).filter(function (id) { return checked.indexOf(id) !== -1; });
            // El campo de lado aparece o desaparece según lo marcado.
            var hadSide = !!state.host.querySelector('[data-qp-side-field]');
            if (hadSide !== M.needsSide(state.catalog, zone.id, state.draft.parts)) {
                var focusValue = target.value;
                renderMain();
                var again = state.host.querySelectorAll('[data-qp-part]');
                for (var j = 0; j < again.length; j++) if (again[j].value === focusValue) again[j].focus();
            }
        } else {
            return;
        }
        state.dirty = true;
        state.error = '';
        var error = state.host.querySelector('[data-qp-error]');
        if (error) error.hidden = true;
        paintFigures();
    }

    function onKeydown(event) {
        if (!mounted()) return;
        var shape = shapeFromEvent(event);
        if (!shape) {
            if (event.key === 'Escape' && state.openZone) { var zoneId = state.openZone; closePanel(zoneId); setStatus(IDLE_STATUS); }
            // Enter sobre un botón del selector lo activa (el atajo global del
            // wizard lo usaría para "Continuar").
            if (event.key === 'Enter' && event.target && event.target.tagName === 'BUTTON') event.stopPropagation();
            return;
        }
        var key = event.key;
        if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
            event.preventDefault();
            event.stopPropagation(); // Enter no debe disparar "Continuar".
            var shapeId = shape.getAttribute('data-qp-shape');
            togglePart(shape.getAttribute('data-part'), shape.getAttribute('data-side'));
            focusNode(findByAttribute('data-qp-shape', shapeId));
        } else if (key === 'ArrowDown' || key === 'ArrowRight') {
            event.preventDefault();
            moveFocus(shape, 1);
        } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
            event.preventDefault();
            moveFocus(shape, -1);
        } else if (key === 'Home') {
            event.preventDefault();
            moveFocus(shape, 'first');
        } else if (key === 'End') {
            event.preventDefault();
            moveFocus(shape, 'last');
        }
    }

    function onPointerOver(event) {
        if (!mounted()) return;
        var shape = shapeFromEvent(event);
        if (shape && event.pointerType !== 'touch') {
            showTip(shape, event);
            setStatus(describeNode(shape));
            return;
        }
        var tile = event.target && event.target.closest ? event.target.closest('[data-qp-zone]') : null;
        var hint = tile && state.host.contains(tile) ? tile.getAttribute('data-qp-zone') : null;
        if (hint !== state.hintZone) { state.hintZone = hint; paintFigures(); }
    }

    function onPointerMove(event) {
        if (!mounted()) return;
        var shape = shapeFromEvent(event);
        if (shape && event.pointerType !== 'touch') showTip(shape, event);
    }

    function onPointerOut(event) {
        if (!mounted()) return;
        if (shapeFromEvent(event)) hideTip();
        var tile = event.target && event.target.closest ? event.target.closest('[data-qp-zone]') : null;
        if (tile && state.hintZone && !(event.relatedTarget && tile.contains(event.relatedTarget))) {
            state.hintZone = null;
            paintFigures();
        }
    }

    function onFocusIn(event) {
        if (!mounted()) return;
        var shape = shapeFromEvent(event);
        if (shape) setStatus(describeNode(shape));
    }

    // Foto de zona que no carga: se prueba la de body_parts y, si tampoco,
    // se quita para dejar a la vista la silueta recortada.
    function onImageError(event) {
        var img = event.target;
        if (!img || img.tagName !== 'IMG' || !img.classList.contains('qp-zone-img')) return;
        var failed = img.getAttribute('src');
        if (failed) failedImages[failed] = true;
        var alt = img.getAttribute('data-qp-alt-src');
        if (alt) {
            img.removeAttribute('data-qp-alt-src');
            img.src = alt;
        } else if (img.parentNode) {
            img.parentNode.removeChild(img);
        }
    }

    function bind(host) {
        if (host._woBodyBound) return;
        host._woBodyBound = true;
        host.addEventListener('click', onClick);
        host.addEventListener('change', onChange);
        host.addEventListener('keydown', onKeydown);
        host.addEventListener('pointerover', onPointerOver);
        host.addEventListener('pointermove', onPointerMove);
        host.addEventListener('pointerout', onPointerOut);
        host.addEventListener('focusin', onFocusIn);
        host.addEventListener('error', onImageError, true);
    }

    // "Continuar" con una ficha abierta. Si el cliente la estaba completando (la
    // tocó, o todavía no eligió nada más) se confirma sola y el wizard sigue; si
    // le falta el lado, no avanza y se muestra qué falta. Una ficha que solo se
    // abrió para mirar, con otra selección ya hecha, se cierra sin agregar nada.
    // Devuelve false cuando hay que frenar el avance.
    function resolveOpenPanel() {
        if (!mounted() || !state.openZone) return true;
        if (!state.dirty && state.selection.length) {
            closePanel();
            return true;
        }
        return confirmPanel();
    }

    // Se engancha en captura para correr antes del onclick del botón.
    function installContinueGuard() {
        if (guardInstalled) return;
        guardInstalled = true;
        document.addEventListener('click', function (event) {
            var button = event.target && event.target.closest ? event.target.closest('#continue-btn') : null;
            if (!button) return;
            if (!resolveOpenPanel()) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    /**
     * Monta el selector en `host`.
     * @param {HTMLElement} host
     * @param {{tree:Array, selection:Array, bodyPart?:string, bodySide?:string,
     *          onChange:function(Array, object)}} options
     * @returns {Array} selección normalizada (migra borradores viejos)
     */
    function mount(host, options) {
        var M = model();
        var opts = options || {};
        if (!host) return Array.isArray(opts.selection) ? opts.selection : [];
        if (!M || !figure()) {
            host.innerHTML = '<p class="empty-sheet-msg">No pudimos cargar el selector de zonas. Recarga la página.</p>';
            return Array.isArray(opts.selection) ? opts.selection : [];
        }
        var catalog = M.createCatalog(opts.tree);
        var selection = M.fromLegacy(opts.selection, catalog);
        var pending = [];
        // Sin selección pero con texto guardado (pre-cotizador o borrador
        // viejo): se recupera lo que se pueda leer.
        if (!selection.length && opts.bodyPart) {
            var parsed = M.parseText(opts.bodyPart, opts.bodySide, catalog);
            selection = parsed.selection;
            pending = parsed.pending;
        }
        state = {
            host: host,
            catalog: catalog,
            selection: selection,
            onChange: opts.onChange,
            openZone: null,
            draft: null,
            dirty: false,
            error: '',
            hintZone: null
        };
        host.classList.add('qp-body');
        host.innerHTML = layoutHtml();
        bind(host);
        installContinueGuard();
        renderMain();
        refresh();
        // Zona conocida a la que solo le falta el lado: se abre su ficha.
        if (pending.length) openZone(pending[0].zoneId, pending[0].parts);
        return selection.slice();
    }

    function describe(selection, tree) {
        var M = model();
        if (!M) return null;
        var catalog = tree ? M.createCatalog(tree) : (state ? state.catalog : M.createCatalog([]));
        return M.describe(selection, catalog);
    }

    function reset() {
        if (!mounted()) return;
        state.selection = [];
        state.openZone = null;
        state.draft = null;
        state.dirty = false;
        state.error = '';
        renderMain();
        refresh();
        setStatus(IDLE_STATUS);
    }

    // Solo para tests (node:test + vm): arma el HTML de un estado dado sin DOM.
    function htmlFor(options) {
        var M = model();
        var opts = options || {};
        var previous = state;
        var catalog = M.createCatalog(opts.tree);
        state = {
            host: null,
            catalog: catalog,
            selection: M.sanitize(opts.selection, catalog),
            openZone: opts.openZone || null,
            draft: null,
            dirty: false,
            error: opts.error || '',
            hintZone: null
        };
        if (state.openZone) state.draft = opts.draft || M.draftForZone(state.selection, catalog, state.openZone);
        try {
            return { layout: layoutHtml(), main: state.openZone ? panelHtml() : gridHtml(), summary: summaryHtml() };
        } finally {
            state = previous;
        }
    }

    window.WoQuotationBody = {
        ASSET_BASE: ASSET_BASE,
        ZONE_PHOTOS: ZONE_PHOTOS,
        ZONE_CROPS: ZONE_CROPS,
        htmlFor: htmlFor,
        mount: mount,
        describe: describe,
        reset: reset,
        resolveOpenPanel: resolveOpenPanel,
        isPanelOpen: function () { return mounted() && !!state.openZone; }
    };
})();
