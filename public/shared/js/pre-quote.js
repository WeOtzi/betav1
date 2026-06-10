/**
 * WE OTZI - PRE COTIZADOR
 */
(function () {
    'use strict';

    var PREQUOTE_HANDOFF_KEY = 'weotzi_prequote_handoff';
    var HANDOFF_TTL_MS = 30 * 60 * 1000;
    var SUBZONE_NONE = '__none__';
    var SUBZONE_WHOLE = '__whole__';
    var BODY_PARTS_TREE = [];

    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
    function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

    function showError(message) {
        var el = document.getElementById('prequote-error');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('hidden', !message);
    }

    function getSelectedBodyZone() {
        var select = document.getElementById('prequote-body-zone');
        if (!select || !select.value) return null;
        return BODY_PARTS_TREE.find(function (zone) { return String(zone.id) === select.value; }) || null;
    }

    function getSelectedSubzoneIds() {
        var container = document.getElementById('prequote-body-subzone');
        if (!container) return [];
        return Array.prototype.slice.call(container.querySelectorAll('input[type="checkbox"]:checked')).map(function (input) { return input.value; });
    }

    function buildBodyPartLabel() {
        var zone = getSelectedBodyZone();
        if (!zone) return '';
        var ids = getSelectedSubzoneIds();
        if (!ids.length) return '';
        var shared = window.WeotziQuotationShared || {};
        var format = shared.formatBodyPartLabel || function (z, s) { return s ? z + ': ' + s : z; };
        if (ids.includes(SUBZONE_NONE)) return zone.label;
        if (ids.includes(SUBZONE_WHOLE)) return format(zone.label, 'Zona entera');
        var selected = (zone.subparts || []).filter(function (sub) { return ids.includes(String(sub.id)); });
        return format(zone.label, selected.map(function (sub) { return sub.label; }).join(', '));
    }

    function collectInput() {
        return {
            tattoo_idea_description: document.getElementById('prequote-idea').value.trim(),
            tattoo_style: document.getElementById('prequote-style').value,
            tattoo_size: document.getElementById('prequote-size').value,
            tattoo_body_part: buildBodyPartLabel(),
            client_city_residence: document.getElementById('prequote-city').value.trim()
        };
    }

    function validateInput(input) {
        if (!input.tattoo_idea_description || input.tattoo_idea_description.length < 5) return 'Cuéntanos un poco más sobre la idea del tatuaje.';
        if (!input.tattoo_style) return 'Selecciona un estilo.';
        if (!input.tattoo_size) return 'Selecciona un tamaño.';
        var zone = getSelectedBodyZone();
        if (!zone) return 'Selecciona la zona del cuerpo.';
        if (zone.subparts && zone.subparts.length && !getSelectedSubzoneIds().length) return 'Marca al menos una subzona, "Sin subzona específica" o "Zona entera".';
        if (!input.client_city_residence) return 'Indica tu ciudad.';
        return null;
    }

    function populateStyleAndSize() {
        var shared = window.WeotziQuotationShared || {};
        var styleSelect = document.getElementById('prequote-style');
        var sizeSelect = document.getElementById('prequote-size');
        styleSelect.innerHTML = '<option value="">Selecciona un estilo</option>' + (shared.TATTOO_STYLE_OPTIONS || []).map(function (option) {
            return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('');
        sizeSelect.innerHTML = '<option value="">Selecciona un tamaño</option>' + (shared.TATTOO_SIZE_OPTIONS || []).map(function (option) {
            return '<option value="' + option.value + '">' + option.label + (option.subtitle ? ' · ' + option.subtitle : '') + '</option>';
        }).join('');
    }

    async function waitForConfigManager() {
        var start = Date.now();
        while (!window.ConfigManager && Date.now() - start < 3000) await new Promise(function (resolve) { setTimeout(resolve, 50); });
    }

    async function loadBodyParts() {
        await waitForConfigManager();
        if (!window.ConfigManager) return [];
        try {
            if (typeof window.ConfigManager.loadBodyPartsFromDB === 'function') {
                var dbParts = await window.ConfigManager.loadBodyPartsFromDB();
                if (Array.isArray(dbParts) && dbParts.length) return dbParts;
            }
            if (typeof window.ConfigManager.getBodyParts === 'function') {
                var local = window.ConfigManager.getBodyParts();
                if (Array.isArray(local)) return local;
            }
        } catch (err) {
            console.warn('[PreQuote] Could not load body parts:', err);
        }
        return [];
    }

    function populateBodyZones() {
        var select = document.getElementById('prequote-body-zone');
        if (!select) return;
        if (!BODY_PARTS_TREE.length) {
            select.innerHTML = '<option value="">No hay zonas disponibles</option>';
            select.disabled = true;
            return;
        }
        select.disabled = false;
        select.innerHTML = '<option value="">Selecciona una zona</option>' + BODY_PARTS_TREE.map(function (zone) {
            return '<option value="' + escapeHtml(zone.id) + '">' + escapeHtml(zone.label) + '</option>';
        }).join('');
    }

    function buildSubzoneCheckbox(value, label, special) {
        return '<label class="prequote-checkbox' + (special ? ' prequote-checkbox--special' : '') + '"><input type="checkbox" value="' + escapeHtml(value) + '"><span>' + escapeHtml(label) + '</span></label>';
    }

    function syncSubzoneStates() {
        var values = getSelectedSubzoneIds();
        var none = values.includes(SUBZONE_NONE);
        var whole = values.includes(SUBZONE_WHOLE);
        document.querySelectorAll('#prequote-body-subzone .prequote-checkbox').forEach(function (label) {
            var input = label.querySelector('input');
            var disabled = (none && input.value !== SUBZONE_NONE) || (whole && input.value !== SUBZONE_WHOLE);
            input.disabled = disabled;
            label.classList.toggle('prequote-checkbox--disabled', disabled);
            label.classList.toggle('prequote-checkbox--checked', input.checked);
        });
    }

    function handleSubzoneChange(event) {
        if (!event.target || event.target.type !== 'checkbox') return;
        var input = event.target;
        var container = document.getElementById('prequote-body-subzone');
        if (input.checked && (input.value === SUBZONE_NONE || input.value === SUBZONE_WHOLE)) {
            container.querySelectorAll('input[type="checkbox"]').forEach(function (other) { if (other !== input) other.checked = false; });
        } else if (input.checked) {
            container.querySelectorAll('input[value="' + SUBZONE_NONE + '"], input[value="' + SUBZONE_WHOLE + '"]').forEach(function (other) { other.checked = false; });
        }
        syncSubzoneStates();
    }

    function populateSubzones() {
        var container = document.getElementById('prequote-body-subzone');
        var zone = getSelectedBodyZone();
        if (!container) return;
        container.classList.toggle('prequote-checkbox-grid--empty', !zone);
        if (!zone) {
            container.innerHTML = '<p class="prequote-checkbox-empty">Selecciona una zona primero</p>';
            return;
        }
        var html = [buildSubzoneCheckbox(SUBZONE_NONE, 'Sin subzona específica', true)];
        if (zone.subparts && zone.subparts.length) {
            html.push(buildSubzoneCheckbox(SUBZONE_WHOLE, 'Zona entera (todas)', true));
            zone.subparts.forEach(function (sub) { html.push(buildSubzoneCheckbox(String(sub.id), sub.label, false)); });
        }
        container.innerHTML = html.join('');
        if (!zone.subparts || !zone.subparts.length) {
            var none = container.querySelector('input[value="' + SUBZONE_NONE + '"]');
            if (none) none.checked = true;
        }
        syncSubzoneStates();
    }

    function setupCityAutocomplete() {
        var input = document.getElementById('prequote-city');
        var shared = window.WeotziQuotationShared || {};
        if (input && typeof shared.attachCityAutocomplete === 'function') {
            shared.attachCityAutocomplete(input, { onSelect: function (city) { input.value = city.normalizedLocation; } });
        }
    }

    async function requestEstimate(input) {
        var response = await fetch('/api/pre-quote/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
        var data = await response.json().catch(function () { return null; });
        if (!response.ok || !data || !data.success) throw new Error((data && data.error) || 'No se pudo calcular el estimado.');
        return data;
    }

    function formatMoney(amount, currency) {
        try {
            return new Intl.NumberFormat('es', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Math.round(Number(amount) || 0));
        } catch (_) {
            return Math.round(Number(amount) || 0) + ' ' + (currency || 'USD');
        }
    }

    function renderArtistCard(artist) {
        var styles = Array.isArray(artist.styles_array) ? artist.styles_array.join(', ') : (artist.styles_array || '');
        var name = escapeHtml(artist.name || artist.username || 'Artista');
        return '<article class="artist-card prequote-artist-card">'
            + '<div class="artist-avatar-container">' + (artist.profile_picture ? '<img src="' + escapeHtml(artist.profile_picture) + '" alt="' + name + '" class="artist-profile-img-large">' : '<div class="artist-avatar"><i class="fa-solid fa-palette"></i></div>') + '</div>'
            + '<h3 class="artist-name">' + name + '</h3>'
            + '<div class="artist-meta"><span>' + escapeHtml(styles || 'Estilos por consultar') + '</span><span>•</span><span>' + escapeHtml(artist.ubicacion || artist.city || 'Ubicación por consultar') + '</span></div>'
            + '<div class="artist-price">' + escapeHtml(artist.session_price || 'Consultar') + ' / sesión</div>'
            + '<div class="actions-stack"><button class="btn btn-primary" type="button" data-prequote-cta="' + escapeHtml(artist.username || '') + '">Cotizar con este artista <i class="fa-solid fa-arrow-right"></i></button></div>'
            + '</article>';
    }

    function renderEstimate(input, data) {
        var results = document.getElementById('prequote-results');
        var estimate = data.estimate || {};
        var artists = data.suggestedArtists || [];
        results.innerHTML = '<div class="prequote-estimate-card">'
            + '<p class="technical-label">Estimado aproximado</p>'
            + '<h2 class="prequote-range">' + escapeHtml(formatMoney(estimate.minAmount, estimate.currency)) + ' — ' + escapeHtml(formatMoney(estimate.maxAmount, estimate.currency)) + '</h2>'
            + '<ul class="prequote-meta"><li><strong>' + estimate.estimatedSessionsMin + '-' + estimate.estimatedSessionsMax + ' sesiones</strong> estimadas según el tamaño</li><li>Basado en ' + estimate.sampleSize + ' artista(s) compatible(s)</li><li>Confianza ' + escapeHtml(estimate.confidence || 'baja') + '</li></ul>'
            + '<p class="prequote-disclaimer">Este es un estimado de referencia. El precio final lo define el artista según el detalle de la pieza, agenda y materiales.</p>'
            + '</div>'
            + '<div class="prequote-artists-section"><h3 class="prequote-section-title">Artistas sugeridos para tu idea</h3><div class="prequote-artists-grid">' + artists.map(renderArtistCard).join('') + '</div></div>';
        results.classList.remove('hidden');
        results.querySelectorAll('[data-prequote-cta]').forEach(function (button) {
            button.addEventListener('click', function () { startQuotationWithArtist(button.getAttribute('data-prequote-cta'), input, estimate); });
        });
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function startQuotationWithArtist(username, input, estimate) {
        var handoff = {
            source: 'prequote',
            expiresAt: Date.now() + HANDOFF_TTL_MS,
            formData: {
                tattoo_idea_description: input.tattoo_idea_description,
                tattoo_style: input.tattoo_style,
                tattoo_size: input.tattoo_size,
                tattoo_body_part: input.tattoo_body_part,
                client_city_residence: input.client_city_residence,
                client_budget_amount: String(Math.round(estimate.averageAmount || estimate.maxAmount || 0) || ''),
                client_budget_currency: estimate.currency || 'USD',
                tattoo_estimated_sessions: estimate.estimatedSessionsMin + '-' + estimate.estimatedSessionsMax
            }
        };
        localStorage.setItem(PREQUOTE_HANDOFF_KEY, JSON.stringify(handoff));
        window.location.href = '/quotation?artist=' + encodeURIComponent(username) + '&source=prequote';
    }

    async function handleSubmit(event) {
        event.preventDefault();
        showError('');
        var input = collectInput();
        var validation = validateInput(input);
        if (validation) return showError(validation);
        showLoading();
        try {
            renderEstimate(input, await requestEstimate(input));
        } catch (err) {
            console.error('[PreQuote] Estimate failed:', err);
            showError(err.message || 'No se pudo calcular el estimado.');
        } finally {
            hideLoading();
        }
    }

    ready(function () {
        populateStyleAndSize();
        document.getElementById('prequote-form')?.addEventListener('submit', handleSubmit);
        document.getElementById('prequote-body-zone')?.addEventListener('change', populateSubzones);
        document.getElementById('prequote-body-subzone')?.addEventListener('change', handleSubzoneChange);
        loadBodyParts().then(function (parts) {
            BODY_PARTS_TREE = Array.isArray(parts) ? parts : [];
            populateBodyZones();
            populateSubzones();
        });
        setupCityAutocomplete();
    });
})();
/**
 * WE ÖTZI - PRE COTIZADOR
 *
 * Captures basic tattoo inputs, calls /api/pre-quote/estimate, renders an
 * approximate price range and suggested artists, and hands off to the
 * existing /quotation flow with prefilled fields.
 */
(function () {
    'use strict';

    var PREQUOTE_HANDOFF_KEY = 'weotzi_prequote_handoff';
    var HANDOFF_TTL_MS = 30 * 60 * 1000;

    // Special subzone tokens. They are mutually exclusive with the rest.
    var SUBZONE_NONE = '__none__';   // "Sin subzona específica"
    var SUBZONE_WHOLE = '__whole__'; // "Zona entera"

    // Cache of body parts loaded from ConfigManager (Supabase + local fallback).
    var BODY_PARTS_TREE = [];

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    function showLoading() {
        var el = document.getElementById('loading-overlay');
        if (el) el.classList.remove('hidden');
    }

    function hideLoading() {
        var el = document.getElementById('loading-overlay');
        if (el) el.classList.add('hidden');
    }

    function showError(message) {
        var el = document.getElementById('prequote-error');
        if (!el) return;
        el.textContent = message || '';
        if (message) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }

    function getSelectedBodyZone() {
        var zoneSelect = document.getElementById('prequote-body-zone');
        if (!zoneSelect || !zoneSelect.value) return null;
        return BODY_PARTS_TREE.find(function (zone) { return String(zone.id) === zoneSelect.value; }) || null;
    }

    function getCheckedSubzoneInputs() {
        var container = document.getElementById('prequote-body-subzone');
        if (!container) return [];
        return Array.prototype.slice.call(container.querySelectorAll('input[type="checkbox"]:checked'));
    }

    function getSelectedSubzoneIds() {
        return getCheckedSubzoneInputs().map(function (input) { return input.value; });
    }

    function getSelectedSubzoneObjects(zone) {
        if (!zone || !zone.subparts) return [];
        var ids = getSelectedSubzoneIds();
        return zone.subparts.filter(function (sub) { return ids.indexOf(String(sub.id)) !== -1; });
    }

    function buildBodyPartLabel() {
        var zone = getSelectedBodyZone();
        if (!zone) return '';
        var ids = getSelectedSubzoneIds();
        if (!ids.length) return '';

        var shared = window.WeotziQuotationShared || {};
        var formatLabel = shared.formatBodyPartLabel || function (zoneLabel, subzoneLabel) {
            if (zoneLabel && subzoneLabel && zoneLabel.toLowerCase() !== subzoneLabel.toLowerCase()) {
                return zoneLabel + ': ' + subzoneLabel;
            }
            return zoneLabel || subzoneLabel || '';
        };

        if (ids.indexOf(SUBZONE_NONE) !== -1) {
            return zone.label || '';
        }
        if (ids.indexOf(SUBZONE_WHOLE) !== -1) {
            return formatLabel(zone.label, 'Zona entera');
        }
        var selected = getSelectedSubzoneObjects(zone);
        if (!selected.length) return zone.label || '';
        var subLabel = selected.map(function (sub) { return sub.label; }).join(', ');
        return formatLabel(zone.label, subLabel);
    }

    function collectInput() {
        return {
            tattoo_idea_description: document.getElementById('prequote-idea').value.trim(),
            tattoo_style: document.getElementById('prequote-style').value,
            tattoo_size: document.getElementById('prequote-size').value,
            tattoo_body_part: buildBodyPartLabel(),
            client_city_residence: document.getElementById('prequote-city').value.trim()
        };
    }

    function validateInput(input) {
        if (!input.tattoo_idea_description || input.tattoo_idea_description.length < 5) {
            return 'Cuéntanos un poco más sobre la idea del tatuaje (mínimo 5 caracteres).';
        }
        if (!input.tattoo_style) return 'Selecciona un estilo.';
        if (!input.tattoo_size) return 'Selecciona un tamaño.';
        var zone = getSelectedBodyZone();
        if (!zone) return 'Selecciona la zona del cuerpo.';
        if (zone.subparts && zone.subparts.length && !getSelectedSubzoneIds().length) {
            return 'Marca al menos una subzona, "Sin subzona específica" o "Zona entera".';
        }
        if (!input.tattoo_body_part) return 'Selecciona la zona del cuerpo.';
        if (!input.client_city_residence) return 'Indica tu ciudad (incluye el país, ej: "Bogotá, Colombia").';
        return null;
    }

    function populateSelectOptions() {
        var shared = window.WeotziQuotationShared || {};
        var styleSelect = document.getElementById('prequote-style');
        var sizeSelect = document.getElementById('prequote-size');

        if (styleSelect) {
            styleSelect.innerHTML = '<option value="">Selecciona un estilo</option>' +
                (shared.TATTOO_STYLE_OPTIONS || []).map(function (option) {
                    return '<option value="' + option.value + '">' + option.label + '</option>';
                }).join('');
        }

        if (sizeSelect) {
            sizeSelect.innerHTML = '<option value="">Selecciona un tamaño</option>' +
                (shared.TATTOO_SIZE_OPTIONS || []).map(function (option) {
                    var suffix = option.subtitle ? ' · ' + option.subtitle : '';
                    return '<option value="' + option.value + '">' + option.label + suffix + '</option>';
                }).join('');
        }
    }

    function populateBodyZoneSelect() {
        var zoneSelect = document.getElementById('prequote-body-zone');
        if (!zoneSelect) return;
        if (!BODY_PARTS_TREE || !BODY_PARTS_TREE.length) {
            zoneSelect.innerHTML = '<option value="">No hay zonas disponibles</option>';
            zoneSelect.disabled = true;
            return;
        }
        zoneSelect.disabled = false;
        zoneSelect.innerHTML = '<option value="">Selecciona una zona</option>' +
            BODY_PARTS_TREE.map(function (zone) {
                return '<option value="' + escapeHtml(zone.id) + '">' + escapeHtml(zone.label) + '</option>';
            }).join('');
    }

    function buildSubzoneCheckbox(value, label, modifier) {
        var extra = modifier ? ' prequote-checkbox--' + modifier : '';
        return [
            '<label class="prequote-checkbox' + extra + '" data-subzone="' + escapeHtml(value) + '">',
            '  <input type="checkbox" value="' + escapeHtml(value) + '">',
            '  <span>' + escapeHtml(label) + '</span>',
            '</label>'
        ].join('');
    }

    function syncSubzoneCheckboxStates() {
        var container = document.getElementById('prequote-body-subzone');
        if (!container) return;
        var labels = Array.prototype.slice.call(container.querySelectorAll('.prequote-checkbox'));
        var checkedValues = getSelectedSubzoneIds();
        var noneChecked = checkedValues.indexOf(SUBZONE_NONE) !== -1;
        var wholeChecked = checkedValues.indexOf(SUBZONE_WHOLE) !== -1;

        labels.forEach(function (label) {
            var input = label.querySelector('input[type="checkbox"]');
            if (!input) return;
            var value = input.value;
            var isSpecial = value === SUBZONE_NONE || value === SUBZONE_WHOLE;
            // Disable normal subzones when an exclusive option is checked
            var disable = false;
            if (noneChecked && value !== SUBZONE_NONE) disable = true;
            if (wholeChecked && value !== SUBZONE_WHOLE) disable = true;
            input.disabled = disable;
            label.classList.toggle('prequote-checkbox--disabled', disable);
            label.classList.toggle('prequote-checkbox--checked', input.checked);
            if (isSpecial) label.classList.add('prequote-checkbox--special');
        });
    }

    function handleSubzoneCheckboxChange(event) {
        var input = event.target;
        if (!input || input.type !== 'checkbox') return;
        var container = document.getElementById('prequote-body-subzone');
        if (!container) return;

        if (input.checked) {
            var value = input.value;
            // Exclusive options clear all other selections
            if (value === SUBZONE_NONE || value === SUBZONE_WHOLE) {
                Array.prototype.forEach.call(
                    container.querySelectorAll('input[type="checkbox"]'),
                    function (other) { if (other !== input) other.checked = false; }
                );
            } else {
                // Selecting a normal subzone clears the exclusive options
                Array.prototype.forEach.call(
                    container.querySelectorAll('input[value="' + SUBZONE_NONE + '"], input[value="' + SUBZONE_WHOLE + '"]'),
                    function (other) { other.checked = false; }
                );
            }
        }

        syncSubzoneCheckboxStates();
    }

    function populateBodySubzoneCheckboxes() {
        var container = document.getElementById('prequote-body-subzone');
        if (!container) return;
        var zone = getSelectedBodyZone();
        container.classList.remove('prequote-checkbox-grid--empty');

        if (!zone) {
            container.classList.add('prequote-checkbox-grid--empty');
            container.innerHTML = '<p class="prequote-checkbox-empty">Selecciona una zona primero</p>';
            return;
        }

        var hasSubparts = zone.subparts && zone.subparts.length;
        var html = [];
        // "Sin subzona específica" siempre disponible para mantener solo la zona
        html.push(buildSubzoneCheckbox(SUBZONE_NONE, 'Sin subzona específica', 'special'));
        // "Zona entera" sólo aplica cuando hay subzonas
        if (hasSubparts) {
            html.push(buildSubzoneCheckbox(SUBZONE_WHOLE, 'Zona entera (todas)', 'special'));
            zone.subparts.forEach(function (sub) {
                html.push(buildSubzoneCheckbox(String(sub.id), sub.label));
            });
        }
        container.innerHTML = html.join('');

        // Default to "Sin subzona específica" if the zone has no subparts at all
        if (!hasSubparts) {
            var defaultInput = container.querySelector('input[value="' + SUBZONE_NONE + '"]');
            if (defaultInput) defaultInput.checked = true;
        }

        syncSubzoneCheckboxStates();
    }

    async function waitForConfigManager(maxWait) {
        var timeout = maxWait || 3000;
        var start = Date.now();
        while (!window.ConfigManager && (Date.now() - start) < timeout) {
            await new Promise(function (r) { return setTimeout(r, 50); });
        }
    }

    async function loadBodyParts() {
        await waitForConfigManager();
        if (!window.ConfigManager) return [];
        try {
            if (typeof window.ConfigManager.loadBodyPartsFromDB === 'function') {
                var parts = await window.ConfigManager.loadBodyPartsFromDB();
                if (Array.isArray(parts) && parts.length) return parts;
            }
            if (typeof window.ConfigManager.getBodyParts === 'function') {
                var local = window.ConfigManager.getBodyParts();
                return Array.isArray(local) ? local : [];
            }
        } catch (err) {
            console.warn('[PreQuote] Could not load body parts:', err);
        }
        return [];
    }

    function setupCityAutocomplete() {
        var input = document.getElementById('prequote-city');
        if (!input) return;
        var shared = window.WeotziQuotationShared || {};
        if (typeof shared.attachCityAutocomplete !== 'function') return;
        shared.attachCityAutocomplete(input, {
            onSelect: function (city) {
                input.value = city.normalizedLocation;
            }
        });
    }

    async function requestEstimate(input) {
        var response = await fetch('/api/pre-quote/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
        var data = await response.json().catch(function () { return null; });
        if (!response.ok || !data || !data.success) {
            var message = (data && data.error) || 'No se pudo calcular el estimado. Intenta de nuevo.';
            throw new Error(message);
        }
        return data;
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatMoney(amount, currency) {
        if (!amount && amount !== 0) return '—';
        var rounded = Math.round(Number(amount));
        if (!isFinite(rounded)) return '—';
        try {
            return new Intl.NumberFormat('es', {
                style: 'currency',
                currency: currency || 'USD',
                maximumFractionDigits: 0
            }).format(rounded);
        } catch (e) {
            return rounded + ' ' + (currency || 'USD');
        }
    }

    function formatStyleLabel(value) {
        var shared = window.WeotziQuotationShared || {};
        if (shared.formatTattooStyleForDisplay) return shared.formatTattooStyleForDisplay(value);
        return value || '-';
    }

    function confidenceLabel(confidence) {
        if (confidence === 'alta') return 'Confianza alta';
        if (confidence === 'media') return 'Confianza media';
        return 'Confianza baja';
    }

    function fallbackTierMessage(tier) {
        if (tier === 1) return 'Basado en artistas con tu estilo en tu ciudad.';
        if (tier === 2) return 'Sin artistas exactos en tu ciudad — usamos artistas de tu país con el estilo elegido.';
        if (tier === 3) return 'Sin coincidencias locales — usamos artistas con tu estilo en otras ciudades.';
        if (tier === 4) return 'Sin artistas con tu estilo en tu ciudad — usamos artistas locales como referencia.';
        if (tier === 5) return 'Estimado preliminar a partir de artistas disponibles.';
        return 'Aún no tenemos artistas suficientes para un estimado preciso.';
    }

    function renderArtistCard(artist) {
        var shared = window.WeotziQuotationShared || {};
        var displayName = shared.toTitleCase ? shared.toTitleCase(artist.name || artist.username || '') : (artist.name || artist.username || '');
        var styles = Array.isArray(artist.styles_array) ? artist.styles_array.join(', ') : (artist.styles_array || '');
        var location = artist.ubicacion || artist.city || 'Ubicación por consultar';
        var price = artist.session_price || 'Consultar';
        var portfolioUrl = artist.portafolio || (artist.instagram ? 'https://www.instagram.com/' + String(artist.instagram).replace('@', '').trim() + '/' : '');

        var avatar = artist.profile_picture
            ? '<img src="' + escapeHtml(artist.profile_picture) + '" alt="' + escapeHtml(displayName) + '" class="artist-profile-img-large">'
            : '<div class="artist-avatar"><i class="fa-solid fa-palette"></i></div>';

        var portfolioBtn = portfolioUrl
            ? '<a href="' + escapeHtml(portfolioUrl) + '" target="_blank" rel="noopener" class="btn btn-secondary btn-small"><i class="fa-brands fa-instagram"></i> Ver Portfolio</a>'
            : '';

        return [
            '<article class="artist-card prequote-artist-card" data-username="' + escapeHtml(artist.username || '') + '">',
            '  <div class="artist-avatar-container">' + avatar + '</div>',
            '  <h3 class="artist-name">' + escapeHtml(displayName) + '</h3>',
            '  <div class="artist-meta">',
            '    <span>' + escapeHtml(styles || 'Estilos por consultar') + '</span>',
            styles ? '    <span>•</span>' : '',
            '    <span>' + escapeHtml(location) + '</span>',
            '  </div>',
            '  <div class="artist-price">' + escapeHtml(price) + ' / sesión</div>',
            '  <div class="actions-stack">',
            '    <button class="btn btn-primary" type="button" data-prequote-cta="' + escapeHtml(artist.username || '') + '">',
            '      Cotizar con este artista <i class="fa-solid fa-arrow-right"></i>',
            '    </button>',
            portfolioBtn,
            '  </div>',
            '</article>'
        ].filter(Boolean).join('\n');
    }

    function renderEstimate(input, data) {
        var resultsEl = document.getElementById('prequote-results');
        if (!resultsEl) return;

        var estimate = data.estimate || {};
        var artists = data.suggestedArtists || [];

        var rangeLabel = (estimate.minAmount === 0 && estimate.maxAmount === 0)
            ? 'Sin datos suficientes'
            : (formatMoney(estimate.minAmount, estimate.currency) + ' — ' + formatMoney(estimate.maxAmount, estimate.currency));

        var sessionLabel = estimate.estimatedSessionsMin === estimate.estimatedSessionsMax
            ? estimate.estimatedSessionsMin + ' sesión'
            : estimate.estimatedSessionsMin + '-' + estimate.estimatedSessionsMax + ' sesiones';

        var sampleLabel = estimate.sampleSize
            ? 'Basado en ' + estimate.sampleSize + ' artista' + (estimate.sampleSize === 1 ? '' : 's') + ' compatible' + (estimate.sampleSize === 1 ? '' : 's')
            : 'Aún no hay datos suficientes para el cálculo';

        resultsEl.innerHTML = [
            '<div class="prequote-estimate-card">',
            '  <p class="technical-label">Estimado aproximado</p>',
            '  <h2 class="prequote-range">' + escapeHtml(rangeLabel) + '</h2>',
            '  <ul class="prequote-meta">',
            '    <li><strong>' + escapeHtml(sessionLabel) + '</strong> estimadas según el tamaño</li>',
            '    <li>' + escapeHtml(sampleLabel) + '</li>',
            '    <li>' + escapeHtml(confidenceLabel(estimate.confidence) + ' · ' + fallbackTierMessage(estimate.fallbackTier || data.fallbackTier)) + '</li>',
            '  </ul>',
            '  <p class="prequote-disclaimer">',
            '    Este es un estimado de referencia. El precio final lo define el artista según el detalle de la pieza, agenda y materiales.',
            '  </p>',
            '</div>',
            artists.length
                ? '<div class="prequote-artists-section">'
                    + '  <h3 class="prequote-section-title">Artistas sugeridos para tu idea</h3>'
                    + '  <p class="subtitle">Selecciona uno para continuar la cotización con sus datos pre-cargados.</p>'
                    + '  <div class="prequote-artists-grid">'
                    + artists.map(renderArtistCard).join('\n')
                    + '  </div>'
                    + '</div>'
                : '<p class="prequote-empty">Aún no encontramos artistas activos para esta combinación. Puedes continuar a /quotation y buscar manualmente.</p>'
        ].join('\n');

        resultsEl.classList.remove('hidden');

        // Wire CTA buttons to handoff
        var buttons = resultsEl.querySelectorAll('[data-prequote-cta]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function (e) {
                var username = e.currentTarget.getAttribute('data-prequote-cta');
                if (!username) return;
                startQuotationWithArtist(username, input, estimate);
            });
        }

        try {
            resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {}
    }

    function startQuotationWithArtist(username, input, estimate) {
        var sessionsLabel = estimate && estimate.estimatedSessionsMin && estimate.estimatedSessionsMax
            ? (estimate.estimatedSessionsMin === estimate.estimatedSessionsMax
                ? String(estimate.estimatedSessionsMin)
                : estimate.estimatedSessionsMin + '-' + estimate.estimatedSessionsMax)
            : null;

        var budgetAmount = estimate ? Math.round(estimate.averageAmount || estimate.maxAmount || 0) : 0;

        var handoff = {
            source: 'prequote',
            expiresAt: Date.now() + HANDOFF_TTL_MS,
            formData: {
                tattoo_idea_description: input.tattoo_idea_description,
                tattoo_style: input.tattoo_style,
                tattoo_size: input.tattoo_size,
                tattoo_body_part: input.tattoo_body_part,
                client_city_residence: input.client_city_residence,
                client_budget_amount: budgetAmount ? String(budgetAmount) : '',
                client_budget_currency: (estimate && estimate.currency) || 'USD',
                tattoo_estimated_sessions: sessionsLabel,
                prequote_estimate_min: estimate ? estimate.minAmount : null,
                prequote_estimate_max: estimate ? estimate.maxAmount : null,
                prequote_confidence: estimate ? estimate.confidence : null
            }
        };

        try {
            localStorage.setItem(PREQUOTE_HANDOFF_KEY, JSON.stringify(handoff));
        } catch (e) {
            console.warn('No se pudo guardar el handoff en localStorage:', e);
        }
        window.location.href = '/quotation?artist=' + encodeURIComponent(username) + '&source=prequote';
    }

    async function handleSubmit(event) {
        event.preventDefault();
        showError('');

        var input = collectInput();
        var validation = validateInput(input);
        if (validation) {
            showError(validation);
            return;
        }

        showLoading();
        try {
            var data = await requestEstimate(input);
            renderEstimate(input, data);
        } catch (err) {
            console.error('[PreQuote] Estimate failed:', err);
            showError(err.message || 'No se pudo calcular el estimado. Intenta de nuevo.');
        } finally {
            hideLoading();
        }
    }

    ready(function () {
        populateSelectOptions();

        var form = document.getElementById('prequote-form');
        if (form) form.addEventListener('submit', handleSubmit);

        var zoneSelect = document.getElementById('prequote-body-zone');
        if (zoneSelect) {
            zoneSelect.addEventListener('change', populateBodySubzoneCheckboxes);
        }

        var subzoneContainer = document.getElementById('prequote-body-subzone');
        if (subzoneContainer) {
            subzoneContainer.addEventListener('change', handleSubzoneCheckboxChange);
        }

        // Async: load body parts from ConfigManager (Supabase + local fallback)
        loadBodyParts().then(function (parts) {
            BODY_PARTS_TREE = Array.isArray(parts) ? parts : [];
            populateBodyZoneSelect();
            populateBodySubzoneCheckboxes();
        });

        // Wire Google Places autocomplete on the city input. The helper polls
        // until window.google.maps.places is ready, so order is not an issue.
        setupCityAutocomplete();
    });

    // Expose for test/console use; not required by HTML now that we use addEventListener.
    window.startQuotationWithArtist = startQuotationWithArtist;
})();
