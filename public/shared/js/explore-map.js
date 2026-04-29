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
        infoWindow: null
    };

    var TOP_STYLES = [
        { label: 'Realismo', icon: 'fa-solid fa-eye' },
        { label: 'Tradicional', icon: 'fa-solid fa-anchor' },
        { label: 'Fine Line', icon: 'fa-solid fa-pen-nib' },
        { label: 'Blackwork', icon: 'fa-solid fa-brush' },
        { label: 'Minimalista', icon: 'fa-solid fa-minus' },
        { label: 'Japones', icon: 'fa-solid fa-dragon' },
        { label: 'Geometrico', icon: 'fa-solid fa-shapes' },
        { label: 'Acuarela', icon: 'fa-solid fa-droplet' }
    ];

    var BAUHAUS_MAP_STYLE = [
        { elementType: 'geometry', stylers: [{ color: '#f3f3f3' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#000000' }, { weight: 0.8 }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e6e6e6' }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

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
        var resp = await supabase
            .from('artists_db')
            .select('user_id,username,name,profile_picture,styles_array,city,country,ubicacion,session_price,years_experience,languages,bio_description,is_recommended,latitude,longitude');
        if (resp.error) {
            console.error('[explore-map] Supabase error:', resp.error);
            return [];
        }
        return (resp.data || []).map(function (a) {
            return Object.assign({}, a, {
                languages: a.languages || ['Espanol'],
                country: a.country || (a.ubicacion ? a.ubicacion.split(', ').pop() : 'Desconocido')
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
            pillsContainer.innerHTML = TOP_STYLES.map(function (s) {
                var count = STATE.all.filter(function (a) {
                    return parseStyles(a.styles_array).some(function (x) { return x.toLowerCase() === s.label.toLowerCase(); });
                }).length;
                return '<button class="filter-pill" data-style="' + escapeHtml(s.label) + '">'
                    + '<i class="' + s.icon + '"></i>'
                    + '<span>' + escapeHtml(s.label) + '</span>'
                    + '<span class="pill-count">(' + count + ')</span>'
                    + '</button>';
            }).join('');

            pillsContainer.addEventListener('click', function (e) {
                var btn = e.target.closest('.filter-pill');
                if (!btn) return;
                var style = btn.dataset.style;
                STATE.currentFilters.style = STATE.currentFilters.style === style ? null : style;
                document.querySelectorAll('.filter-pill').forEach(function (b) {
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

    function openArtistModal(artist) {
        if (!artist) return;
        STATE.activeArtistId = artist.user_id;

        document.querySelectorAll('.bauhaus-pin-wrap').forEach(function (w) { w.classList.remove('is-active'); });
        var m = STATE.markers.get(artist.user_id);
        if (m && m.wrap) m.wrap.classList.add('is-active');

        document.querySelectorAll('.explore-card').forEach(function (c) { c.classList.remove('is-active'); });
        var card = document.querySelector('.explore-card[data-user-id="' + CSS.escape(artist.user_id) + '"]');
        if (card) card.classList.add('is-active');

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

        document.getElementById('modal-artist-name').textContent = toTitleCase(artist.name || artist.username || 'Artista');

        var location = [artist.city, artist.country].filter(Boolean).map(toTitleCase).join(', ') || (artist.ubicacion || 'Ubicacion no disponible');
        document.getElementById('modal-location').textContent = location;

        var exp = artist.years_experience ? artist.years_experience + ' anos exp.' : 'Experiencia no especificada';
        document.getElementById('modal-experience').textContent = exp;

        var bio = (artist.bio_description || '').trim();
        document.getElementById('modal-bio').textContent = bio ? (bio.length > 220 ? bio.slice(0, 220) + '...' : bio) : 'Este artista todavia no escribio una bio.';

        var price = artist.session_price ? String(artist.session_price).replace(',00', '') : 'Consultar';
        document.getElementById('modal-price').textContent = price;

        var quoteBtn = document.getElementById('modal-cta-quote');
        var profileBtn = document.getElementById('modal-cta-profile');
        if (quoteBtn) quoteBtn.onclick = function () {
            window.location.href = '/quotation?artist=' + encodeURIComponent(artist.username);
        };
        if (profileBtn) profileBtn.onclick = function () {
            window.location.href = '/artist/profile?artist=' + encodeURIComponent(artist.username);
        };

        var backdrop = document.getElementById('artist-modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
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

        if (countEl) countEl.textContent = STATE.filtered.length + ' artistas';

        if (STATE.filtered.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        listEl.innerHTML = STATE.filtered.map(function (a) {
            var styles = parseStyles(a.styles_array).slice(0, 3);
            var img = a.profile_picture
                ? 'style="background-image: url(\'' + escapeHtml(a.profile_picture) + '\')"'
                : '';
            var imgClass = a.profile_picture ? '' : ' no-image';
            var price = a.session_price ? String(a.session_price).replace(',00', '') : 'Consultar';
            return '<article class="explore-card" data-user-id="' + escapeHtml(a.user_id) + '">'
                +   '<div class="explore-card-img' + imgClass + '" ' + img + '></div>'
                +   '<div class="explore-card-body">'
                +     '<div class="explore-card-styles">'
                +       styles.map(function (s) { return '<span class="tag-mini">' + escapeHtml(s) + '</span>'; }).join('')
                +     '</div>'
                +     '<h3 class="explore-card-name">' + escapeHtml(toTitleCase(a.name || a.username)) + '</h3>'
                +     '<div class="explore-card-meta">' + escapeHtml(toTitleCase(a.city || a.country || '')) + '</div>'
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

        STATE.map = new google.maps.Map(mapEl, {
            center: { lat: -15, lng: -60 },
            zoom: 3,
            disableDefaultUI: true,
            zoomControl: true,
            styles: BAUHAUS_MAP_STYLE,
            backgroundColor: '#f3f3f3'
        });

        document.getElementById('explore-map-empty')?.classList.add('hidden');

        defineOverlayClass();
        await renderMarkers();
    }

    function defineOverlayClass() {
        if (STATE.overlayClass) return;
        function PriceOverlay(position, html, onClick) {
            this.position = position;
            this.html = html;
            this.onClick = onClick;
            this.div = null;
        }
        PriceOverlay.prototype = new google.maps.OverlayView();
        PriceOverlay.prototype.onAdd = function () {
            var div = document.createElement('div');
            div.className = 'bauhaus-pin-wrap';
            div.innerHTML = this.html;
            div.addEventListener('click', this.onClick);
            this.div = div;
            this.getPanes().floatPane.appendChild(div);
        };
        PriceOverlay.prototype.draw = function () {
            if (!this.div) return;
            var proj = this.getProjection();
            if (!proj) return;
            var p = proj.fromLatLngToDivPixel(this.position);
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

    async function renderMarkers() {
        if (!STATE.map) return;

        STATE.markers.forEach(function (m) { try { m.overlay.setMap(null); } catch (e) {} });
        STATE.markers.clear();

        var bounds = new google.maps.LatLngBounds();
        var anyPlotted = false;
        var pendingGeocode = [];

        STATE.filtered.forEach(function (artist) {
            var lat = Number(artist.latitude);
            var lng = Number(artist.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                plotArtistMarker(artist, lat, lng);
                bounds.extend({ lat: lat, lng: lng });
                anyPlotted = true;
            } else if (artist.city || artist.country) {
                pendingGeocode.push(artist);
            }
        });

        if (anyPlotted) {
            STATE.map.fitBounds(bounds, 64);
            google.maps.event.addListenerOnce(STATE.map, 'idle', function () {
                if (STATE.map.getZoom() > 11) STATE.map.setZoom(11);
            });
        }

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
                persistGeocode(artist.user_id, point.lat, point.lng, point.displayName);
            } catch (err) {
                console.warn('[explore-map] Geocode loop error:', err);
            }
        }
    }

    function plotArtistMarker(artist, lat, lng) {
        var price = artist.session_price ? String(artist.session_price).replace(',00', '') : '$$';
        var html = '<div class="bauhaus-pin">' + escapeHtml(price) + '</div>';
        var overlay = new STATE.overlayClass(
            new google.maps.LatLng(lat, lng),
            html,
            function () { openArtistModal(artist); }
        );
        overlay.setMap(STATE.map);

        setTimeout(function () {
            var wrap = overlay.getDiv && overlay.getDiv();
            STATE.markers.set(artist.user_id, { overlay: overlay, wrap: wrap, artist: artist });
        }, 50);
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
