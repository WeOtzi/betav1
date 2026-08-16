/**
 * WE ÖTZI - PRE COTIZADOR
 *
 * Captura los datos básicos del tatuaje, llama a /api/pre-quote/estimate,
 * renderiza un rango aproximado de precio con artistas sugeridos y hace el
 * handoff al flujo /quotation con los campos pre-cargados
 * (localStorage `weotzi_prequote_handoff`, consumido por script.js).
 *
 * UI sobre el Design System Bauhaus (clases wo-* + prequote-*), íconos
 * Feather vía data-wo-icon (wo-icons.js hidrata también el DOM dinámico).
 */
(function () {
    'use strict';

    var PREQUOTE_HANDOFF_KEY = 'weotzi_prequote_handoff';
    var HANDOFF_TTL_MS = 30 * 60 * 1000;

    // Tokens especiales de subzona. Son mutuamente excluyentes con el resto.
    var SUBZONE_NONE = '__none__';   // "Sin subzona específica"
    var SUBZONE_WHOLE = '__whole__'; // "Zona entera"

    // Cache de zonas del cuerpo cargadas desde ConfigManager (Supabase + fallback local).
    var BODY_PARTS_TREE = [];

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
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
            return 'Contanos un poco más sobre la idea del tatuaje (mínimo 5 caracteres).';
        }
        if (!input.tattoo_style) return 'Seleccioná un estilo.';
        if (!input.tattoo_size) return 'Seleccioná un tamaño.';
        var zone = getSelectedBodyZone();
        if (!zone) return 'Seleccioná la zona del cuerpo.';
        if (zone.subparts && zone.subparts.length && !getSelectedSubzoneIds().length) {
            return 'Marcá al menos una subzona, "Sin subzona específica" o "Zona entera".';
        }
        if (!input.tattoo_body_part) return 'Seleccioná la zona del cuerpo.';
        if (!input.client_city_residence) return 'Indicá tu ciudad (incluí el país, ej: "Buenos Aires, Argentina").';
        return null;
    }

    function populateSelectOptions() {
        var shared = window.WeotziQuotationShared || {};
        var styleSelect = document.getElementById('prequote-style');
        var sizeSelect = document.getElementById('prequote-size');

        if (styleSelect) {
            styleSelect.innerHTML = '<option value="">Seleccioná un estilo</option>' +
                (shared.TATTOO_STYLE_OPTIONS || []).map(function (option) {
                    return '<option value="' + option.value + '">' + option.label + '</option>';
                }).join('');
        }

        if (sizeSelect) {
            sizeSelect.innerHTML = '<option value="">Seleccioná un tamaño</option>' +
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
        zoneSelect.innerHTML = '<option value="">Seleccioná una zona</option>' +
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
            // Deshabilita las subzonas normales cuando hay una opción excluyente marcada
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
            // Las opciones excluyentes limpian el resto de la selección
            if (value === SUBZONE_NONE || value === SUBZONE_WHOLE) {
                Array.prototype.forEach.call(
                    container.querySelectorAll('input[type="checkbox"]'),
                    function (other) { if (other !== input) other.checked = false; }
                );
            } else {
                // Marcar una subzona normal limpia las opciones excluyentes
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
            container.innerHTML = '<p class="prequote-checkbox-empty">Seleccioná una zona primero</p>';
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

        // Sin subpartes: marca "Sin subzona específica" por defecto
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
            var message = (data && data.error) || 'No se pudo calcular el estimado. Probá de nuevo.';
            throw new Error(message);
        }
        return data;
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

    function confidenceValue(confidence) {
        if (confidence === 'alta') return 'Alta';
        if (confidence === 'media') return 'Media';
        return 'Baja';
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
        var styles = Array.isArray(artist.styles_array) ? artist.styles_array.join(' · ') : (artist.styles_array || '');
        var location = artist.ubicacion || artist.city || 'Ubicación por consultar';
        var price = artist.session_price || 'Consultar';
        var portfolioUrl = artist.portafolio || (artist.instagram ? 'https://www.instagram.com/' + String(artist.instagram).replace('@', '').trim() + '/' : '');

        var avatar = artist.profile_picture
            ? '<img src="' + escapeHtml(artist.profile_picture) + '" alt="' + escapeHtml(displayName) + '">'
            : '<i data-wo-icon="pen-tool" aria-hidden="true"></i>';

        var portfolioBtn = portfolioUrl
            ? '<a href="' + escapeHtml(portfolioUrl) + '" target="_blank" rel="noopener" class="wo-btn wo-btn--ghost wo-btn--s"><i data-wo-icon="instagram" class="wo-icon-18" aria-hidden="true"></i> Ver portfolio</a>'
            : '';

        return [
            '<article class="wo-card wo-card--hover prequote-artist-card" data-username="' + escapeHtml(artist.username || '') + '">',
            '  <div class="wo-avatar wo-avatar--l wo-avatar--bordered prequote-artist-avatar">' + avatar + '</div>',
            '  <h3 class="prequote-artist-name">' + escapeHtml(displayName) + '</h3>',
            '  <p class="prequote-artist-meta wo-meta-s">' + escapeHtml([styles || 'Estilos por consultar', location].join(' · ')) + '</p>',
            '  <p class="prequote-artist-price">' + escapeHtml(price) + ' / sesión</p>',
            '  <div class="prequote-artist-actions">',
            '    <button class="wo-btn wo-btn--hard" type="button" data-prequote-cta="' + escapeHtml(artist.username || '') + '">',
            '      Cotizar con este artista →',
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
            : (formatMoney(estimate.minAmount, estimate.currency) + ' – ' + formatMoney(estimate.maxAmount, estimate.currency));

        var sessionLabel = estimate.estimatedSessionsMin === estimate.estimatedSessionsMax
            ? estimate.estimatedSessionsMin + ' sesión'
            : estimate.estimatedSessionsMin + '-' + estimate.estimatedSessionsMax + ' sesiones';

        var sampleLabel = estimate.sampleSize
            ? estimate.sampleSize + ' artista' + (estimate.sampleSize === 1 ? '' : 's') + ' compatible' + (estimate.sampleSize === 1 ? '' : 's')
            : 'Sin datos suficientes';

        function summaryItem(label, value) {
            return '<div class="prequote-summary-item"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
        }

        resultsEl.innerHTML = [
            '<div class="prequote-estimate-card">',
            '  <p class="wo-eyebrow">Estimado aproximado</p>',
            '  <h2 class="prequote-range">' + escapeHtml(rangeLabel) + '</h2>',
            '  <dl class="prequote-summary-grid">',
            summaryItem('Sesiones', sessionLabel + ' según el tamaño'),
            summaryItem('Muestra', sampleLabel),
            summaryItem('Confianza', confidenceValue(estimate.confidence)),
            summaryItem('Método', fallbackTierMessage(estimate.fallbackTier || data.fallbackTier)),
            '  </dl>',
            '  <p class="prequote-disclaimer">',
            '    Este es un estimado de referencia. El precio final lo define el artista según el detalle de la pieza, agenda y materiales.',
            '  </p>',
            '</div>',
            artists.length
                ? '<div class="prequote-artists-section">'
                    + '  <h3 class="wo-h2 prequote-artists-title">Artistas sugeridos para tu idea</h3>'
                    + '  <p class="prequote-artists-sub">Elegí uno para continuar la cotización con sus datos pre-cargados.</p>'
                    + '  <div class="prequote-artists-grid">'
                    + artists.map(renderArtistCard).join('\n')
                    + '  </div>'
                    + '</div>'
                : '<div class="wo-empty prequote-empty">'
                    + '  <p class="wo-empty-title">Sin artistas para esta combinación</p>'
                    + '  <p>Todavía no encontramos artistas activos para tu idea. Podés continuar en el cotizador y buscar manualmente.</p>'
                    + '  <a class="wo-btn wo-btn--ghost" href="/quotation">Ir al cotizador →</a>'
                    + '</div>'
        ].join('\n');

        resultsEl.classList.remove('hidden');

        // Conecta los CTA al handoff
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
            showError(err.message || 'No se pudo calcular el estimado. Probá de nuevo.');
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

        // Async: carga las zonas del cuerpo desde ConfigManager (Supabase + fallback local)
        loadBodyParts().then(function (parts) {
            BODY_PARTS_TREE = Array.isArray(parts) ? parts : [];
            populateBodyZoneSelect();
            populateBodySubzoneCheckboxes();
        });

        // Google Places autocomplete en el input de ciudad. El helper hace polling
        // hasta que window.google.maps.places está listo, así que el orden no importa.
        setupCityAutocomplete();
    });

    // Expuesto para tests/consola; el HTML ya no lo requiere (usa addEventListener).
    window.startQuotationWithArtist = startQuotationWithArtist;
})();
