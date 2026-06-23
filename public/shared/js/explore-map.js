/**
 * EXPLORE MAP - Pagina /explore
 * Muestra a todos los artistas registrados en un mapa Google Maps
 * con un panel lateral estilo Airbnb. Reusa el modulo WeOtziGeocoder
 * y el ConfigManager existente.
 */
(function () {
    'use strict';

    var STATE = {
        all: [],
        filtered: [],
        currentFilters: {
            style: null,
            country: null,
            priceRange: null,
            language: null,
            experience: null
        },
        view: 'map',
        markers: new Map(),
        activeArtistId: null,
        map: null,
        overlayClass: null,
        studioOverlayClass: null,
        infoWindow: null,
        // Studios layer: fetched once, toggleable.
        studios: [],
        studioMarkers: new Map(),
        showStudios: true
    };

    var TOP_STYLES = [
        { label: 'Realismo', icon: 'fa-solid fa-eye' },
        { label: 'Tradicional', icon: 'fa-solid fa-anchor' },
        { label: 'Fine Line', icon: 'fa-solid fa-pen-nib' },
        { label: 'Blackwork', icon: 'fa-solid fa-brush' },
        { label: 'Minimalista', icon: 'fa-solid fa-minus' },
        { label: 'Japones', icon: 'fa-solid fa-dragon' },
        { label: 'Geometrico', icon: 'fa-solid fa-shapes' },
        { label: 'Acuarela', icon: 'fa-solid fa-droplet' },
        { label: 'Black & Grey', icon: 'fa-solid fa-circle-half-stroke' },
        { label: 'Microrealismo', icon: 'fa-solid fa-magnifying-glass' },
        { label: 'Hiperrealismo', icon: 'fa-solid fa-eye' },
        { label: 'Ornamental', icon: 'fa-solid fa-fan' },
        { label: 'Mandala', icon: 'fa-solid fa-circle-dot' },
        { label: 'Tribal', icon: 'fa-solid fa-bolt' },
        { label: 'Polinesio', icon: 'fa-solid fa-water' },
        { label: 'Maori', icon: 'fa-solid fa-shield-halved' },
        { label: 'Haida', icon: 'fa-solid fa-feather' },
        { label: 'Celta', icon: 'fa-solid fa-ring' },
        { label: 'Nordico / Viking', icon: 'fa-solid fa-mountain' },
        { label: 'Lettering', icon: 'fa-solid fa-font' },
        { label: 'Blackletter / Gotico', icon: 'fa-solid fa-book' },
        { label: 'Caligrafia', icon: 'fa-solid fa-pen-fancy' },
        { label: 'Ignorant', icon: 'fa-solid fa-pencil' },
        { label: 'Handpoke / Stick and Poke', icon: 'fa-solid fa-hand-point-up' },
        { label: 'Abstracto', icon: 'fa-solid fa-shapes' },
        { label: 'Sketch / Boceto', icon: 'fa-solid fa-pencil' },
        { label: 'Etching / Grabado', icon: 'fa-solid fa-layer-group' },
        { label: 'Woodcut / Xilografia', icon: 'fa-solid fa-tree' },
        { label: 'Linework', icon: 'fa-solid fa-pen-nib' },
        { label: 'Ilustracion botanica', icon: 'fa-solid fa-leaf' },
        { label: 'Floral', icon: 'fa-solid fa-spa' },
        { label: 'Fineline botanico', icon: 'fa-solid fa-seedling' },
        { label: 'Biomecanico', icon: 'fa-solid fa-gears' },
        { label: 'Bioorganico', icon: 'fa-solid fa-dna' },
        { label: 'Horror', icon: 'fa-solid fa-ghost' },
        { label: 'Dark Art', icon: 'fa-solid fa-moon' },
        { label: 'Glitch', icon: 'fa-solid fa-wave-square' },
        { label: 'Pixel Art', icon: 'fa-solid fa-border-all' },
        { label: 'Graffiti', icon: 'fa-solid fa-spray-can' },
        { label: 'Pop Art', icon: 'fa-solid fa-star' },
        { label: 'Art Nouveau', icon: 'fa-solid fa-fan' },
        { label: 'Art Deco', icon: 'fa-solid fa-gem' },
        { label: 'Barroco', icon: 'fa-solid fa-landmark' },
        { label: 'Abstract Brush', icon: 'fa-solid fa-brush' },
        { label: 'Patchwork', icon: 'fa-solid fa-table-cells-large' },
        { label: 'Religious / Sacro', icon: 'fa-solid fa-church' },
        { label: 'Ornamental Blackwork', icon: 'fa-solid fa-circle' },
        { label: 'Pointillism', icon: 'fa-solid fa-braille' }
    ];

    var BAUHAUS_MAP_STYLE_LIGHT = [
        { elementType: 'geometry', stylers: [{ color: '#f0ede4' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#f0ede4' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#5c5c5c' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#0A0A0A' }, { weight: 1 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#0A0A0A' }, { weight: 0.4 }] },
        { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#0A0A0A' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dcd8cb' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8a8675' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e9e6dc' }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    var BAUHAUS_MAP_STYLE_DARK = [
        { elementType: 'geometry', stylers: [{ color: '#141414' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#141414' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#7a7a7a' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#F2F0E9' }, { weight: 1 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#F2F0E9' }, { weight: 0.3 }] },
        { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#F2F0E9' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A0A0A' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5a5a5a' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#1c1c1c' }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    function currentMapStyle() {
        var theme = document.body.getAttribute('data-theme') || 'light';
        return theme === 'dark' ? BAUHAUS_MAP_STYLE_DARK : BAUHAUS_MAP_STYLE_LIGHT;
    }

    function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
    function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

    function parseStyles(styles) {
        if (!styles) return [];
        if (Array.isArray(styles)) return styles;
        if (typeof styles === 'string') {
            try { if (styles.startsWith('[')) return JSON.parse(styles); } catch (e) {}
            return styles.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        }
        return [];
    }

    function parsePrice(priceStr) {
        if (!priceStr) return 0;
        var match = String(priceStr).match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toTitleCase(str) {
        if (!str) return '';
        return String(str).split(' ')
            .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
            .join(' ');
    }

    // Builds a Google Maps "directions to" URL from an artist row. Prefers
    // place_id (most precise), then formatted address + lat/lng, then just
    // coordinates. Returns null if there's nothing geographic to point at.
    function buildDirectionsUrl(artist) {
        var lat = Number(artist && artist.latitude);
        var lng = Number(artist && artist.longitude);
        var placeId = artist && artist.google_place_id;
        var addr = artist && (artist.formatted_address || '').trim();

        if (placeId) {
            var base = 'https://www.google.com/maps/dir/?api=1&destination=';
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return base + lat + '%2C' + lng + '&destination_place_id=' + encodeURIComponent(placeId);
            }
            return base + encodeURIComponent(addr || '') + '&destination_place_id=' + encodeURIComponent(placeId);
        }
        if (addr) {
            return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);
        }
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + '%2C' + lng;
        }
        return null;
    }

    function waitForConfigManager(maxWait) {
        maxWait = maxWait || 5000;
        return new Promise(function (resolve) {
            var start = Date.now();
            (function poll() {
                if (window.ConfigManager) return resolve();
                if (Date.now() - start > maxWait) return resolve();
                setTimeout(poll, 50);
            })();
        });
    }

    async function fetchArtists() {
        var supabase = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!supabase || window.ConfigManager.isDemoMode()) {
            console.warn('[explore-map] Demo mode or no Supabase. Using empty list.');
            return [];
        }
        // Prefer the artists_with_location view: it COALESCEs the studio's
        // address (when work_type ∈ {studio, both} and studio_id is set) onto
        // the artist's row, so we get one ready-to-render record per artist.
        // Falls back to artists_db if the view isn't deployed yet.
        var viewCols = [
            'user_id', 'username', 'name', 'profile_picture', 'styles_array',
            'session_price', 'years_experience', 'languages', 'bio_description',
            'is_recommended', 'work_type', 'studio_id', 'location_source',
            'studio_name', 'studio_phone', 'studio_website',
            'country', 'country_code', 'state_province', 'city', 'locality',
            'street', 'street_number', 'unit', 'postal_code', 'formatted_address',
            'latitude', 'longitude', 'google_place_id', 'geocoded_at'
        ].join(',');

        var resp = await WeotziData.from('artists_with_location').select(viewCols);

        if (resp.error) {
            console.warn('[explore-map] artists_with_location view unavailable, falling back to artists_db:', resp.error.message);
            var fallbackCols = 'user_id,username,name,profile_picture,styles_array,city,country,ubicacion,session_price,years_experience,languages,bio_description,is_recommended,latitude,longitude,formatted_address,locality,street,street_number,postal_code,work_type,studio_id';
            resp = await WeotziData.from('artists_db').select(fallbackCols);
        }
        if (resp.error) {
            console.error('[explore-map] Supabase error:', resp.error);
            return [];
        }
        return (resp.data || []).map(function (a) {
            return Object.assign({}, a, {
                languages: a.languages || ['Español'],
                country: a.country || 'Desconocido'
            });
        });
    }

    function applyFilters() {
        var f = STATE.currentFilters;
        STATE.filtered = STATE.all.filter(function (a) {
            if (f.style) {
                var styles = parseStyles(a.styles_array).map(function (s) { return s.toLowerCase(); });
                if (!styles.some(function (s) { return s.includes(f.style.toLowerCase()); })) return false;
            }
            if (f.country && a.country !== f.country) return false;
            if (f.language) {
                var langs = Array.isArray(a.languages) ? a.languages : [a.languages];
                if (!langs.includes(f.language)) return false;
            }
            if (f.experience) {
                var years = parseInt(a.years_experience, 10) || 0;
                if (f.experience === 'junior' && (years < 1 || years > 3)) return false;
                if (f.experience === 'mid' && (years < 4 || years > 7)) return false;
                if (f.experience === 'senior' && years < 8) return false;
            }
            if (f.priceRange) {
                var p = parsePrice(a.session_price);
                if (f.priceRange === 'low' && p > 200) return false;
                if (f.priceRange === 'medium' && (p < 200 || p > 800)) return false;
                if (f.priceRange === 'high' && p < 800) return false;
            }
            return true;
        });
        renderList();
        renderMarkers();
    }

    function initFilterUI() {
        var pillsContainer = document.getElementById('style-filter-pills');
        if (pillsContainer) {
            // Build the style pills HTML.
            var stylePillsHtml = TOP_STYLES.map(function (s) {
                var count = STATE.all.filter(function (a) {
                    return parseStyles(a.styles_array).some(function (x) { return x.toLowerCase() === s.label.toLowerCase(); });
                }).length;
                return '<button class="filter-pill" data-style="' + escapeHtml(s.label) + '">'
                    + '<i class="' + s.icon + '"></i>'
                    + '<span>' + escapeHtml(s.label) + '</span>'
                    + '<span class="pill-count">(' + count + ')</span>'
                    + '</button>';
            }).join('');

            // Plus a separator button that toggles the studios layer.
            var studioToggleHtml = '<button class="filter-pill is-active" id="toggle-studios-btn" type="button" aria-pressed="true" title="Mostrar/ocultar estudios">'
                + '<i class="fa-solid fa-building"></i>'
                + '<span>Estudios</span>'
                + '</button>';

            pillsContainer.innerHTML = stylePillsHtml + studioToggleHtml;

            pillsContainer.addEventListener('click', function (e) {
                var btn = e.target.closest('.filter-pill');
                if (!btn) return;
                // Studios toggle bypasses the style filter logic.
                if (btn.id === 'toggle-studios-btn') {
                    toggleStudiosLayer();
                    return;
                }
                var style = btn.dataset.style;
                STATE.currentFilters.style = STATE.currentFilters.style === style ? null : style;
                document.querySelectorAll('.filter-pill').forEach(function (b) {
                    if (b.id === 'toggle-studios-btn') return; // skip the toggle when re-styling
                    b.classList.toggle('is-active', b.dataset.style === STATE.currentFilters.style);
                });
                applyFilters();
            });
        }

        var countrySelect = document.getElementById('filter-country');
        if (countrySelect) {
            var countries = Array.from(new Set(STATE.all.map(function (a) { return a.country; }).filter(Boolean))).sort();
            countries.forEach(function (c) {
                var n = STATE.all.filter(function (a) { return a.country === c; }).length;
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c + ' (' + n + ')';
                countrySelect.appendChild(opt);
            });
            countrySelect.addEventListener('change', function () {
                STATE.currentFilters.country = countrySelect.value || null;
                applyFilters();
            });
        }

        var langSelect = document.getElementById('filter-language');
        if (langSelect) {
            var langs = [];
            STATE.all.forEach(function (a) {
                if (a.languages) langs.push.apply(langs, Array.isArray(a.languages) ? a.languages : [a.languages]);
            });
            Array.from(new Set(langs)).sort().forEach(function (l) {
                var opt = document.createElement('option');
                opt.value = l; opt.textContent = l;
                langSelect.appendChild(opt);
            });
            langSelect.addEventListener('change', function () {
                STATE.currentFilters.language = langSelect.value || null;
                applyFilters();
            });
        }

        var priceSelect = document.getElementById('filter-price');
        if (priceSelect) priceSelect.addEventListener('change', function () {
            STATE.currentFilters.priceRange = priceSelect.value || null; applyFilters();
        });

        var expSelect = document.getElementById('filter-experience');
        if (expSelect) expSelect.addEventListener('change', function () {
            STATE.currentFilters.experience = expSelect.value || null; applyFilters();
        });

        var clearBtn = document.getElementById('explore-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            STATE.currentFilters = { style: null, country: null, priceRange: null, language: null, experience: null };
            ['filter-country', 'filter-price', 'filter-language', 'filter-experience'].forEach(function (id) {
                var el = document.getElementById(id); if (el) el.value = '';
            });
            document.querySelectorAll('.filter-pill.is-active').forEach(function (b) { b.classList.remove('is-active'); });
            applyFilters();
        });
    }

    function initTabs() {
        document.querySelectorAll('.explore-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                STATE.view = btn.dataset.view;
                document.querySelectorAll('.explore-tab').forEach(function (b) {
                    var on = b.dataset.view === STATE.view;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                document.getElementById('explore-main').dataset.view = STATE.view;
                if (STATE.view === 'map' && STATE.map) {
                    setTimeout(function () { google.maps.event.trigger(STATE.map, 'resize'); }, 50);
                }
            });
        });
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
        else console.warn('[explore-map] Missing modal element:', id);
        return el;
    }

    function setBioHtml(id, value, emptyMessage) {
        var el = document.getElementById(id);
        if (!el) {
            console.warn('[explore-map] Missing modal element:', id);
            return null;
        }

        if (window.BioFormatting) {
            window.BioFormatting.renderBioHtml(el, value, { emptyMessage: emptyMessage });
            return el;
        }

        el.textContent = value || emptyMessage || '';
        return el;
    }

    function safeCssEscape(value) {
        var str = String(value == null ? '' : value);
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            try { return CSS.escape(str); } catch (e) { /* fall through */ }
        }
        return str.replace(/[^a-zA-Z0-9_-]/g, function (ch) {
            return '\\' + ch;
        });
    }

    function openArtistModal(artist) {
        if (!artist) {
            console.warn('[explore-map] openArtistModal called without artist');
            return;
        }
        console.log('[explore-map] openArtistModal:', artist.username || artist.user_id);

        var backdrop = document.getElementById('artist-modal-backdrop');
        if (!backdrop) {
            console.error('[explore-map] Modal backdrop #artist-modal-backdrop not found in DOM');
            return;
        }

        try {
            STATE.activeArtistId = artist.user_id;

            document.querySelectorAll('.bauhaus-pin-wrap').forEach(function (w) { w.classList.remove('is-active'); });
            var m = STATE.markers.get(artist.user_id);
            if (m && m.wrap) m.wrap.classList.add('is-active');

            document.querySelectorAll('.explore-card').forEach(function (c) { c.classList.remove('is-active'); });
            if (artist.user_id) {
                var card = document.querySelector('.explore-card[data-user-id="' + safeCssEscape(artist.user_id) + '"]');
                if (card) card.classList.add('is-active');
            }

            var cover = document.getElementById('modal-cover');
            if (cover) cover.style.backgroundImage = artist.profile_picture
                ? 'url("' + artist.profile_picture + '")'
                : 'none';

            var stylesEl = document.getElementById('modal-styles');
            if (stylesEl) {
                var stylesArr = parseStyles(artist.styles_array).slice(0, 5);
                stylesEl.innerHTML = stylesArr.map(function (s) {
                    return '<span class="tag-mini">' + escapeHtml(s) + '</span>';
                }).join('');
            }

            setText('modal-artist-name', toTitleCase(artist.name || artist.username || 'Artista'));

            // Source badge: studio name when affiliated, "Independiente" otherwise.
            var badgeEl = document.getElementById('modal-source-badge');
            if (badgeEl) {
                if (artist.location_source === 'studio' && artist.studio_name) {
                    badgeEl.textContent = 'Estudio · ' + artist.studio_name;
                    badgeEl.classList.add('is-studio');
                    badgeEl.classList.remove('is-independent');
                    badgeEl.hidden = false;
                } else if (artist.work_type === 'independent' || artist.location_source === 'independent') {
                    badgeEl.textContent = 'Independiente';
                    badgeEl.classList.add('is-independent');
                    badgeEl.classList.remove('is-studio');
                    badgeEl.hidden = false;
                } else {
                    badgeEl.hidden = true;
                }
            }

            var location = [artist.city, artist.country].filter(Boolean).map(toTitleCase).join(', ') || 'Ubicación no disponible';
            setText('modal-location', location);

            // Detailed street address row (only when we actually have one).
            var addrRow = document.getElementById('modal-address-row');
            var addr = (artist.formatted_address || '').trim();
            if (!addr) {
                var parts = [
                    [artist.street, artist.street_number].filter(Boolean).join(' '),
                    artist.unit,
                    artist.locality,
                    artist.postal_code
                ].filter(Boolean);
                addr = parts.join(', ');
            }
            if (addrRow) {
                if (addr) {
                    setText('modal-address', addr);
                    addrRow.hidden = false;
                } else {
                    addrRow.hidden = true;
                }
            }

            // "Cómo llegar" button: only show when we have coordinates or a
            // formatted address Google can parse.
            var directionsEl = document.getElementById('modal-cta-directions');
            if (directionsEl) {
                var directionsUrl = buildDirectionsUrl(artist);
                if (directionsUrl) {
                    directionsEl.href = directionsUrl;
                    directionsEl.hidden = false;
                } else {
                    directionsEl.removeAttribute('href');
                    directionsEl.hidden = true;
                }
            }

            var exp = artist.years_experience ? artist.years_experience + ' años exp.' : 'Experiencia no especificada';
            setText('modal-experience', exp);

            setBioHtml('modal-bio', artist.bio_description, 'Este artista todavia no escribio una bio.');

            var price = artist.session_price ? String(artist.session_price).replace(',00', '') : 'Consultar';
            setText('modal-price', price);

            var quoteBtn = document.getElementById('modal-cta-quote');
            var profileBtn = document.getElementById('modal-cta-profile');
            var username = artist.username || '';
            if (quoteBtn) quoteBtn.onclick = function () {
                window.location.href = '/quotation?artist=' + encodeURIComponent(username);
            };
            if (profileBtn) profileBtn.onclick = function () {
                window.location.href = '/artist/profile?artist=' + encodeURIComponent(username);
            };
        } catch (err) {
            console.error('[explore-map] Error populating modal, opening anyway:', err);
        }

        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }

    function closeArtistModal() {
        var backdrop = document.getElementById('artist-modal-backdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
        if (STATE.activeArtistId) {
            var m = STATE.markers.get(STATE.activeArtistId);
            if (m && m.wrap) m.wrap.classList.remove('is-active');
        }
        var card = document.querySelector('.explore-card.is-active');
        if (card) card.classList.remove('is-active');
        STATE.activeArtistId = null;
    }

    function renderList() {
        var listEl = document.getElementById('explore-list');
        var emptyEl = document.getElementById('explore-list-empty');
        var countEl = document.getElementById('explore-results-count');
        if (!listEl) return;

        if (countEl) {
            var n = STATE.filtered.length;
            countEl.textContent = (n < 1000 ? String(n).padStart(3, '0') : String(n)) + ' Artistas';
        }
        updateAtlasCounter();

        if (STATE.filtered.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        listEl.innerHTML = STATE.filtered.map(function (a, idx) {
            var styles = parseStyles(a.styles_array).slice(0, 3);
            var img = a.profile_picture
                ? 'style="background-image: url(\'' + escapeHtml(a.profile_picture) + '\')"'
                : '';
            var imgClass = a.profile_picture ? '' : ' no-image';
            var price = a.session_price ? String(a.session_price).replace(',00', '') : 'Consultar';
            var indexLabel = '№ ' + String(idx + 1).padStart(3, '0');
            return '<article class="explore-card" data-user-id="' + escapeHtml(a.user_id) + '" data-index="' + escapeHtml(indexLabel) + '">'
                +   '<div class="explore-card-img' + imgClass + '" ' + img + '></div>'
                +   '<div class="explore-card-body">'
                +     '<div class="explore-card-styles">'
                +       styles.map(function (s) { return '<span class="tag-mini">' + escapeHtml(s) + '</span>'; }).join('')
                +     '</div>'
                +     '<h3 class="explore-card-name">' + escapeHtml(toTitleCase(a.name || a.username)) + '</h3>'
                +     '<div class="explore-card-meta">' + escapeHtml(toTitleCase(a.city || a.country || 'Ubicación reservada')) + '</div>'
                +     '<span class="explore-card-price">' + escapeHtml(price) + '</span>'
                +   '</div>'
                + '</article>';
        }).join('');

        listEl.querySelectorAll('.explore-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var userId = card.dataset.userId;
                var artist = STATE.all.find(function (a) { return a.user_id === userId; });
                if (artist) openArtistModal(artist);
            });
            card.addEventListener('mouseenter', function () {
                var userId = card.dataset.userId;
                highlightMarker(userId, true);
            });
            card.addEventListener('mouseleave', function () {
                var userId = card.dataset.userId;
                highlightMarker(userId, false);
            });
        });
    }

    function highlightMarker(userId, on) {
        var m = STATE.markers.get(userId);
        if (!m || !m.wrap) return;
        m.wrap.classList.toggle('is-active', !!on);
    }

    async function initMap() {
        var mapEl = document.getElementById('explore-map');
        if (!mapEl) return;

        try {
            await window.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] });
        } catch (err) {
            console.warn('[explore-map] Could not load Google Maps:', err);
            var emptyEl = document.getElementById('explore-map-empty');
            if (emptyEl) {
                emptyEl.textContent = 'Mapa no disponible (configura Google Maps API key).';
                emptyEl.classList.remove('hidden');
            }
            return;
        }

        var isDark = document.body.getAttribute('data-theme') === 'dark';
        STATE.map = new google.maps.Map(mapEl, {
            center: { lat: 4, lng: -55 },
            zoom: 3,
            minZoom: 2,
            disableDefaultUI: true,
            zoomControl: true,
            zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_BOTTOM
            },
            styles: currentMapStyle(),
            backgroundColor: isDark ? '#0A0A0A' : '#f0ede4',
            gestureHandling: 'greedy',
            clickableIcons: false
        });

        // Re-style on theme toggle.
        var themeObserver = new MutationObserver(function () {
            if (!STATE.map) return;
            STATE.map.setOptions({ styles: currentMapStyle() });
        });
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

        document.getElementById('explore-map-empty')?.classList.add('hidden');

        defineOverlayClass();
        await renderMarkers();
        await renderStudioMarkers();
    }

    // ---- Studios layer ------------------------------------------------
    async function fetchStudios() {
        var supabase = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!supabase || window.ConfigManager.isDemoMode()) return [];
        // Studios with their primary location's coords (resolved through FK).
        // We query studio_locations directly and JOIN the studios columns we need.
        var resp = await WeotziData
            .from('studio_locations')
            .select('id, studio_id, label, is_primary, latitude, longitude, formatted_address, city, country, studios:studio_id(id, slug, name, tagline, cover_image, instagram, website)')
            .eq('is_active', true)
            .eq('is_primary', true)
            .not('latitude', 'is', null);
        if (resp.error) {
            console.warn('[explore-map] studios fetch failed:', resp.error.message);
            return [];
        }
        return (resp.data || []).map(function (loc) {
            return {
                id:        loc.studios && loc.studios.id,
                slug:      loc.studios && loc.studios.slug,
                name:      (loc.studios && loc.studios.name) || 'Estudio',
                tagline:   loc.studios && loc.studios.tagline,
                cover:     loc.studios && loc.studios.cover_image,
                instagram: loc.studios && loc.studios.instagram,
                website:   loc.studios && loc.studios.website,
                location_label:    loc.label,
                formatted_address: loc.formatted_address,
                city:      loc.city,
                country:   loc.country,
                latitude:  loc.latitude,
                longitude: loc.longitude
            };
        });
    }

    function defineStudioOverlayClass() {
        if (STATE.studioOverlayClass) return;
        function StudioOverlay(position, html, onClick) {
            this.position = position; this.html = html; this.onClick = onClick; this.div = null;
        }
        StudioOverlay.prototype = new google.maps.OverlayView();
        StudioOverlay.prototype.onAdd = function () {
            var div = document.createElement('div');
            div.className = 'bauhaus-pin-wrap is-studio';
            div.innerHTML = this.html;
            var handler = this.onClick;
            ['click', 'touchend', 'mousedown', 'pointerdown'].forEach(function (ev) {
                div.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: false });
            });
            div.addEventListener('click', function (e) {
                if (e) e.stopPropagation();
                if (typeof handler === 'function') handler();
            });
            this.div = div;
            var panes = this.getPanes();
            (panes && (panes.overlayMouseTarget || panes.floatPane)).appendChild(div);
        };
        StudioOverlay.prototype.draw = function () {
            if (!this.div) return;
            var proj = this.getProjection();
            if (!proj) return;
            var p = proj.fromLatLngToDivPixel(this.position);
            if (!p) return;
            this.div.style.left = p.x + 'px';
            this.div.style.top  = p.y + 'px';
        };
        StudioOverlay.prototype.onRemove = function () {
            if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
            this.div = null;
        };
        STATE.studioOverlayClass = StudioOverlay;
    }

    async function renderStudioMarkers() {
        if (!STATE.map) return;
        // Tear down existing.
        STATE.studioMarkers.forEach(function (m) { try { m.overlay.setMap(null); } catch (e) {} });
        STATE.studioMarkers.clear();
        if (!STATE.showStudios) return;

        if (STATE.studios.length === 0) {
            STATE.studios = await fetchStudios();
        }

        defineStudioOverlayClass();
        STATE.studios.forEach(function (s) {
            var lat = Number(s.latitude), lng = Number(s.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            var html = '<div class="bauhaus-pin bauhaus-pin-studio" title="' + escapeHtml(s.formatted_address || '') + '">'
                     + '<i class="fa-solid fa-building" style="margin-right:4px;"></i>'
                     + escapeHtml(s.name)
                     + '</div>';
            var overlay = new STATE.studioOverlayClass(
                new google.maps.LatLng(lat, lng),
                html,
                function () {
                    var ref = s.slug || s.id;
                    if (ref) window.open('/studio/profile?studio=' + encodeURIComponent(ref), '_blank');
                }
            );
            overlay.setMap(STATE.map);
            STATE.studioMarkers.set(s.id, { overlay: overlay, studio: s });
        });
    }

    function toggleStudiosLayer() {
        STATE.showStudios = !STATE.showStudios;
        var btn = document.getElementById('toggle-studios-btn');
        if (btn) {
            btn.classList.toggle('is-active', STATE.showStudios);
            btn.setAttribute('aria-pressed', STATE.showStudios ? 'true' : 'false');
        }
        renderStudioMarkers();
    }

    function defineOverlayClass() {
        if (STATE.overlayClass) return;
        function PriceOverlay(position, html, onClick, options) {
            this.position = position;
            this.html = html;
            this.onClick = onClick;
            this.options = options || {};
            this.onReady = (options && options.onReady) || null;
            this.div = null;
        }
        PriceOverlay.prototype = new google.maps.OverlayView();
        PriceOverlay.prototype.onAdd = function () {
            var div = document.createElement('div');
            div.className = 'bauhaus-pin-wrap';
            if (this.options.recommended) div.classList.add('is-recommended');
            div.innerHTML = this.html;
            var handler = this.onClick;
            var clickHandler = function (event) {
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                if (typeof handler === 'function') handler();
            };
            // Stop click bubbling so the map doesn't swallow our click.
            ['click', 'touchend', 'mousedown', 'pointerdown'].forEach(function (ev) {
                div.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: false });
            });
            div.addEventListener('click', clickHandler);
            div.addEventListener('touchend', clickHandler, { passive: false });

            this.div = div;
            // overlayMouseTarget is the right pane for clickable map overlays — it
            // sits above the map but below floatPane (which is reserved for InfoWindows).
            var panes = this.getPanes();
            var pane = panes && (panes.overlayMouseTarget || panes.floatPane);
            if (pane) pane.appendChild(div);
            // Tell the caller the DOM node is ready (onAdd may be deferred to
            // map-idle on the very first render — we don't want to race on it).
            if (typeof this.onReady === 'function') {
                try { this.onReady(div); } catch (e) {}
            }
        };
        PriceOverlay.prototype.draw = function () {
            if (!this.div) return;
            var proj = this.getProjection();
            if (!proj) return;
            var p = proj.fromLatLngToDivPixel(this.position);
            if (!p) return;
            this.div.style.left = p.x + 'px';
            this.div.style.top = p.y + 'px';
        };
        PriceOverlay.prototype.onRemove = function () {
            if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
            this.div = null;
        };
        PriceOverlay.prototype.getDiv = function () { return this.div; };
        STATE.overlayClass = PriceOverlay;
    }

    function persistGeocode(userId, lat, lng, displayName) {
        return fetch('/api/artists/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                latitude: lat,
                longitude: lng,
                geocoded_address: displayName || null
            })
        })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (data) {
                if (!data.success) console.warn('[explore-map] Geocode persist failed:', userId, data.error);
                return data;
            })
            .catch(function (err) {
                console.warn('[explore-map] Geocode persist error:', userId, err);
                return null;
            });
    }

    function fitBoundsSafely(points) {
        if (!STATE.map || !points || points.length === 0) return;
        if (points.length === 1) {
            STATE.map.setCenter({ lat: points[0].lat, lng: points[0].lng });
            STATE.map.setZoom(8);
            return;
        }
        var bounds = new google.maps.LatLngBounds();
        points.forEach(function (p) { bounds.extend({ lat: p.lat, lng: p.lng }); });
        STATE.map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
        google.maps.event.addListenerOnce(STATE.map, 'idle', function () {
            if (STATE.map.getZoom() > 12) STATE.map.setZoom(12);
        });
    }

    async function renderMarkers() {
        if (!STATE.map) return;

        // Clear any pre-existing overlays.
        STATE.markers.forEach(function (m) { try { m.overlay.setMap(null); } catch (e) {} });
        STATE.markers.clear();

        var plotted = [];
        var pendingGeocode = [];

        STATE.filtered.forEach(function (artist) {
            var lat = Number(artist.latitude);
            var lng = Number(artist.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                plotArtistMarker(artist, lat, lng);
                plotted.push({ lat: lat, lng: lng });
            } else if (artist.city || artist.country) {
                pendingGeocode.push(artist);
            }
        });

        fitBoundsSafely(plotted);

        // Geocode missing artists with a debounced re-fit so the map zooms to
        // include new pins as they trickle in (rate-limited by the geocoder).
        if (!pendingGeocode.length) return;

        var refitTimer = null;
        var scheduleRefit = function () {
            if (refitTimer) clearTimeout(refitTimer);
            refitTimer = setTimeout(function () { fitBoundsSafely(plotted); }, 250);
        };

        for (var i = 0; i < pendingGeocode.length; i++) {
            var artist = pendingGeocode[i];
            var query = [artist.city, artist.country].filter(Boolean).join(', ');
            if (!query) continue;
            try {
                var point = await window.WeOtziGeocoder.geocodeQuery(query);
                if (!point) continue;
                artist.latitude = point.lat;
                artist.longitude = point.lng;
                plotArtistMarker(artist, point.lat, point.lng);
                plotted.push({ lat: point.lat, lng: point.lng });
                scheduleRefit();
                persistGeocode(artist.user_id, point.lat, point.lng, point.displayName);
            } catch (err) {
                console.warn('[explore-map] Geocode loop error:', err);
            }
        }
    }

    function formatPriceShort(rawPrice) {
        if (!rawPrice) return '$$';
        var n = parsePrice(rawPrice);
        if (!n) return String(rawPrice).replace(',00', '');
        if (n >= 1000) return '$' + Math.round(n / 100) / 10 + 'k';
        return '$' + n;
    }

    function plotArtistMarker(artist, lat, lng) {
        var label = formatPriceShort(artist.session_price);
        var html = '<div class="bauhaus-pin">' + escapeHtml(label) + '</div>';
        var artistRef = artist;
        // Pre-register the marker entry so highlightMarker etc. can find it
        // even if onAdd hasn't fired yet (Google Maps may defer onAdd until
        // the map is fully idle on the very first render).
        var entry = { overlay: null, wrap: null, artist: artistRef };
        STATE.markers.set(artistRef.user_id, entry);

        var overlay = new STATE.overlayClass(
            new google.maps.LatLng(lat, lng),
            html,
            function () { openArtistModal(artistRef); },
            {
                recommended: !!artist.is_recommended,
                onReady: function (div) { entry.wrap = div; }
            }
        );
        entry.overlay = overlay;
        overlay.setMap(STATE.map);

        // Best-effort sync capture in case onReady already fired.
        if (!entry.wrap && overlay.getDiv) entry.wrap = overlay.getDiv();
    }

    function updateAtlasCounter() {
        var valueEl = document.getElementById('atlas-counter-value');
        var countriesEl = document.getElementById('atlas-counter-countries');
        if (valueEl) {
            var count = STATE.filtered.length;
            valueEl.textContent = count < 1000
                ? String(count).padStart(3, '0')
                : String(count);
        }
        if (countriesEl) {
            var countries = new Set();
            STATE.filtered.forEach(function (a) { if (a.country) countries.add(a.country); });
            countriesEl.textContent = countries.size;
        }
    }

    document.addEventListener('DOMContentLoaded', async function () {
        var modalBackdrop = document.getElementById('artist-modal-backdrop');
        var modalCloseBtn = document.getElementById('modal-close-btn');
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeArtistModal);
        if (modalBackdrop) modalBackdrop.addEventListener('click', function (e) {
            if (e.target === modalBackdrop) closeArtistModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeArtistModal();
        });

        showLoading();
        try {
            await waitForConfigManager();
            STATE.all = await fetchArtists();
            console.log('[explore-map] Loaded', STATE.all.length, 'artists');

            initFilterUI();
            initTabs();
            applyFilters();

            initMap();
        } catch (err) {
            console.error('[explore-map] Init failed:', err);
        } finally {
            hideLoading();
        }
    });

    window.__exploreMap = STATE;
})();
