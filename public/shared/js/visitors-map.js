/**
 * visitors-map.js
 * Real-time visitor map for the artist dashboard.
 *
 * Data source: `artist_profile_visits` (Supabase), aggregates from
 * `artist_profile_visits_daily` for the "Histórico" period.
 *
 * Activates after dashboard.js dispatches `wo:dashboard-ready`.
 * Subscribes to Supabase Realtime so new visits appear live on the map,
 * in the "Últimas visitas" feed and stat counters.
 *
 * Design: Bauhaus (mono grid, hard borders, black/white).
 */
(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------
    const FEED_MAX = 15;                 // Max items in the live feed sidebar
    const MAX_MARKERS = 500;             // Safety cap on DOM markers
    const BAUHAUS_MAP_STYLE = [          // Minimal monochrome styling
        { elementType: 'geometry', stylers: [{ color: '#f3f3f3' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#000000' }, { weight: 0.8 }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e6e6e6' }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    let supabase = null;
    let artistId = null;
    let currentPeriod = 'today';
    let map = null;
    let markers = [];
    let chart = null;
    let realtimeChannel = null;
    let currentVisits = [];  // Most recent `refreshAll()` result cache

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------
    window.addEventListener('wo:dashboard-ready', function (ev) {
        const detail = ev.detail || {};
        if (!detail.currentUser?.id) {
            console.warn('[visitors-map] wo:dashboard-ready fired without currentUser.id');
            return;
        }
        supabase = detail.supabase || window._supabase || null;
        artistId = detail.currentUser.id;
        init().catch(err => console.error('[visitors-map] init failed:', err));
    });

    async function init() {
        if (!document.getElementById('block-visitors-map')) return;
        if (!supabase) {
            console.warn('[visitors-map] No supabase client available — aborting');
            return;
        }

        bindPeriodTabs();
        await ensureGoogleMaps();
        await refreshAll();
        subscribeRealtime();
    }

    // ------------------------------------------------------------------
    // Google Maps loader — reuses the Maps JS that dashboard.js loads
    // ------------------------------------------------------------------
    function ensureGoogleMaps() {
        return new Promise(resolve => {
            const canvas = document.getElementById('visitors-map');
            if (!canvas) return resolve();

            const tryInit = () => {
                if (window.google?.maps?.Map) {
                    try {
                        map = new google.maps.Map(canvas, {
                            center: { lat: 10, lng: 0 },
                            zoom: 2,
                            disableDefaultUI: true,
                            zoomControl: true,
                            styles: BAUHAUS_MAP_STYLE,
                            backgroundColor: '#f3f3f3'
                        });
                        resolve();
                    } catch (err) {
                        console.warn('[visitors-map] Google Maps init failed:', err);
                        resolve();
                    }
                    return true;
                }
                return false;
            };

            if (tryInit()) return;
            // Poll until google.maps becomes available (dashboard may load it lazily)
            let waited = 0;
            const iv = setInterval(() => {
                waited += 200;
                if (tryInit() || waited >= 15000) {
                    clearInterval(iv);
                    if (waited >= 15000) {
                        console.warn('[visitors-map] Google Maps not available after 15s; continuing without map');
                        resolve();
                    }
                }
            }, 200);
        });
    }

    // ------------------------------------------------------------------
    // Period tabs
    // ------------------------------------------------------------------
    function bindPeriodTabs() {
        const tabs = document.querySelectorAll('.visitors-period-btn');
        tabs.forEach(btn => {
            btn.addEventListener('click', async () => {
                const period = btn.getAttribute('data-period');
                if (!period || period === currentPeriod) return;
                currentPeriod = period;
                tabs.forEach(b => {
                    const active = b === btn;
                    b.classList.toggle('is-active', active);
                    b.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                await refreshAll();
            });
        });
    }

    function rangeStartForPeriod(p) {
        const now = new Date();
        if (p === 'today') {
            const d = new Date(now); d.setHours(0, 0, 0, 0);
            return d;
        }
        if (p === 'week')  return new Date(Date.now() - 7  * 86400000);
        if (p === 'month') return new Date(Date.now() - 30 * 86400000);
        return null; // 'all' → use daily aggregates
    }

    // ------------------------------------------------------------------
    // Data loading
    // ------------------------------------------------------------------
    async function refreshAll() {
        const since = rangeStartForPeriod(currentPeriod);
        let visits = [];

        try {
            if (since) {
                const { data, error } = await WeotziData.ArtistVisits.listVisitsByArtistSince(artistId, since.toISOString(), MAX_MARKERS);
                if (error) throw error;
                visits = data || [];
            } else {
                visits = await loadHistoricalFromDaily();
            }
        } catch (err) {
            console.error('[visitors-map] refreshAll query failed:', err);
        }

        currentVisits = visits;
        renderStats(visits);
        renderMarkers(visits);
        renderFeed(visits.slice(0, FEED_MAX));
        renderTops(visits);
        renderChart(visits);
    }

    async function loadHistoricalFromDaily() {
        try {
            const { data, error } = await WeotziData.ArtistVisits.listDailyVisitsByArtist(artistId, 1000);
            if (error) throw error;
            // Expand each aggregated row into a synthetic "visit" for consistent rendering.
            return (data || []).map(row => ({
                id: `${row.artist_id}|${row.day}|${row.country}|${row.city}|${row.device_type}`,
                country: row.country,
                city: row.city,
                latitude: null,
                longitude: null,
                device_type: row.device_type,
                os: null,
                browser: null,
                created_at: row.day + 'T00:00:00Z',
                _aggCount: row.visits_count,
                _aggUnique: row.unique_visitors,
                _aggregate: true
            }));
        } catch (err) {
            console.error('[visitors-map] loadHistoricalFromDaily failed:', err);
            return [];
        }
    }

    // ------------------------------------------------------------------
    // Stats
    // ------------------------------------------------------------------
    function renderStats(visits) {
        const isAgg = visits.length > 0 && visits[0]._aggregate;
        const total = isAgg ? sum(visits, v => v._aggCount || 0) : visits.length;
        const unique = isAgg
            ? sum(visits, v => v._aggUnique || 0)
            : countDistinct(visits, v => v.ip_hash || v.device_fingerprint || v.id);
        const countries = countDistinct(visits.filter(v => v.country), v => v.country);
        const cities = countDistinct(visits.filter(v => v.city), v => `${v.country}|${v.city}`);

        setText('vs-total', total);
        setText('vs-unique', unique);
        setText('vs-countries', countries);
        setText('vs-cities', cities);
    }

    // ------------------------------------------------------------------
    // Markers
    // ------------------------------------------------------------------
    function clearMarkers() {
        markers.forEach(m => { try { m.setMap(null); } catch (_) {} });
        markers = [];
    }

    function renderMarkers(visits) {
        if (!map || !window.google?.maps) return;
        clearMarkers();

        const withCoords = visits.filter(v => v.latitude != null && v.longitude != null);
        withCoords.slice(0, MAX_MARKERS).forEach(v => {
            try {
                const marker = new google.maps.Marker({
                    position: { lat: Number(v.latitude), lng: Number(v.longitude) },
                    map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 6,
                        fillColor: '#3ecf8e',
                        fillOpacity: 0.9,
                        strokeColor: '#000',
                        strokeWeight: 1.5
                    },
                    title: `${v.city || ''}${v.city && v.country ? ', ' : ''}${v.country || ''}`.trim() || 'Visita'
                });
                markers.push(marker);
            } catch (err) {
                // Skip malformed rows silently
            }
        });

        // Auto-fit bounds if we have any markers
        if (withCoords.length > 0) {
            try {
                const bounds = new google.maps.LatLngBounds();
                withCoords.forEach(v => bounds.extend({ lat: Number(v.latitude), lng: Number(v.longitude) }));
                map.fitBounds(bounds, 64);
                // But cap max zoom so a single marker doesn't zoom in too far
                const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
                    if (map.getZoom() > 6) map.setZoom(6);
                });
            } catch (_) {}
        }
    }

    function addPulseMarker(v) {
        if (!map || !window.google?.maps) return;
        if (v.latitude == null || v.longitude == null) return;

        try {
            const marker = new google.maps.Marker({
                position: { lat: Number(v.latitude), lng: Number(v.longitude) },
                map,
                animation: google.maps.Animation.DROP,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 7,
                    fillColor: '#3ecf8e',
                    fillOpacity: 1,
                    strokeColor: '#000',
                    strokeWeight: 2
                },
                title: `${v.city || ''}${v.city && v.country ? ', ' : ''}${v.country || ''}`.trim() || 'Nueva visita'
            });
            markers.push(marker);

            // Cap the marker list so the dashboard doesn't grow unbounded in long live sessions
            if (markers.length > MAX_MARKERS) {
                const old = markers.shift();
                try { old.setMap(null); } catch (_) {}
            }
        } catch (err) {
            console.warn('[visitors-map] addPulseMarker failed:', err);
        }
    }

    // ------------------------------------------------------------------
    // Live feed
    // ------------------------------------------------------------------
    function renderFeed(visits) {
        const list = document.getElementById('visitors-live-feed');
        const empty = document.getElementById('visitors-empty');
        if (!list) return;
        list.innerHTML = '';
        if (!visits.length) {
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;
        visits.forEach(v => list.appendChild(buildFeedItem(v)));
    }

    function prependFeed(v) {
        const list = document.getElementById('visitors-live-feed');
        const empty = document.getElementById('visitors-empty');
        if (!list) return;
        if (empty) empty.hidden = true;
        list.insertBefore(buildFeedItem(v), list.firstChild);
        // Trim to max size
        while (list.children.length > FEED_MAX) list.removeChild(list.lastChild);
    }

    function buildFeedItem(v) {
        const li = document.createElement('li');
        li.className = 'visitor-feed-item';
        const place = [v.city, v.country].filter(Boolean).join(', ') || 'Ubicación desconocida';
        const device = [v.device_type, v.os].filter(Boolean).join(' · ') || 'Dispositivo desconocido';
        const when = v._aggregate ? formatDay(v.created_at) : timeAgo(v.created_at);
        li.innerHTML = `
            <div class="visitor-feed-place">${escapeHtml(place)}</div>
            <div class="visitor-feed-meta">${escapeHtml(device)}<span class="visitor-feed-when">${escapeHtml(when)}</span></div>
        `;
        return li;
    }

    // ------------------------------------------------------------------
    // Top countries / cities
    // ------------------------------------------------------------------
    function renderTops(visits) {
        const isAgg = visits.length > 0 && visits[0]._aggregate;
        const weight = v => isAgg ? (v._aggCount || 1) : 1;

        const byCountry = new Map();
        const byCity = new Map();
        visits.forEach(v => {
            if (v.country) byCountry.set(v.country, (byCountry.get(v.country) || 0) + weight(v));
            if (v.city) {
                const key = `${v.country || '—'} / ${v.city}`;
                byCity.set(key, (byCity.get(key) || 0) + weight(v));
            }
        });

        paintTopList('visitors-top-countries', byCountry);
        paintTopList('visitors-top-cities', byCity);
    }

    function paintTopList(elId, map5) {
        const el = document.getElementById(elId);
        if (!el) return;
        const items = [...map5.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        el.innerHTML = items.length
            ? items.map(([name, count]) =>
                `<li><span class="top-name">${escapeHtml(name)}</span><span class="top-count">${count}</span></li>`
              ).join('')
            : `<li class="top-empty">Sin datos</li>`;
    }

    // ------------------------------------------------------------------
    // Chart.js — evolution
    // ------------------------------------------------------------------
    function renderChart(visits) {
        const canvas = document.getElementById('visitors-evolution-chart');
        if (!canvas || !window.Chart) return;

        const { labels, data } = bucketVisits(visits, currentPeriod);

        if (chart) { chart.destroy(); chart = null; }

        chart = new window.Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Visitas',
                    data,
                    borderColor: '#000000',
                    backgroundColor: 'rgba(62, 207, 142, 0.25)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.25,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#3ecf8e',
                    pointBorderColor: '#000'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    function bucketVisits(visits, period) {
        const isAgg = visits.length > 0 && visits[0]._aggregate;

        if (period === 'today') {
            // 24 hourly buckets
            const buckets = new Array(24).fill(0);
            visits.forEach(v => {
                const d = new Date(v.created_at);
                const h = d.getHours();
                buckets[h] += isAgg ? (v._aggCount || 0) : 1;
            });
            return {
                labels: buckets.map((_, i) => `${String(i).padStart(2, '0')}:00`),
                data: buckets
            };
        }

        // Default: daily buckets
        const daysBack = period === 'week' ? 7 : period === 'month' ? 30 : 90;
        const buckets = {};
        for (let i = daysBack - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            buckets[ymd(d)] = 0;
        }
        visits.forEach(v => {
            const key = ymd(new Date(v.created_at));
            if (buckets.hasOwnProperty(key)) {
                buckets[key] += isAgg ? (v._aggCount || 0) : 1;
            }
        });
        const keys = Object.keys(buckets);
        return {
            labels: keys.map(k => k.slice(5)), // MM-DD
            data: keys.map(k => buckets[k])
        };
    }

    // ------------------------------------------------------------------
    // Realtime
    // ------------------------------------------------------------------
    function subscribeRealtime() {
        if (!supabase?.channel) return;
        try {
            realtimeChannel = WeotziData
                .channel(`artist_profile_visits:${artistId}`)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'artist_profile_visits',
                    filter: `artist_id=eq.${artistId}`
                }, payload => onNewVisit(payload.new))
                .subscribe(status => {
                    const liveEl = document.getElementById('visitors-live');
                    if (liveEl) {
                        liveEl.textContent = status === 'SUBSCRIBED' ? '● En vivo' : '● Sin conexión';
                        liveEl.classList.toggle('is-offline', status !== 'SUBSCRIBED');
                    }
                });
        } catch (err) {
            console.warn('[visitors-map] Realtime subscribe failed:', err);
        }
    }

    function onNewVisit(v) {
        if (!v || v.artist_id !== artistId) return;

        // Respect the currently selected period (a visit outside the window is ignored)
        const since = rangeStartForPeriod(currentPeriod);
        if (since && new Date(v.created_at) < since) return;

        currentVisits = [v, ...currentVisits].slice(0, MAX_MARKERS);
        addPulseMarker(v);
        prependFeed(v);

        // Incremental stat updates
        bumpStat('vs-total', 1);
        const prevCountries = new Set(currentVisits.slice(1).map(x => x.country).filter(Boolean));
        const prevCities = new Set(currentVisits.slice(1).map(x => x.city ? `${x.country}|${x.city}` : null).filter(Boolean));
        if (v.country && !prevCountries.has(v.country)) bumpStat('vs-countries', 1);
        if (v.city && !prevCities.has(`${v.country}|${v.city}`)) bumpStat('vs-cities', 1);
        // Unique visitors: approximate bump if the fingerprint/ip is new among current cache
        const uniqKey = v.ip_hash || v.device_fingerprint;
        if (uniqKey) {
            const prevUniq = new Set(
                currentVisits.slice(1).map(x => x.ip_hash || x.device_fingerprint).filter(Boolean)
            );
            if (!prevUniq.has(uniqKey)) bumpStat('vs-unique', 1);
        }

        // Re-render tops and chart (cheap for <500 visits)
        renderTops(currentVisits);
        renderChart(currentVisits);
    }

    // ------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------
    function sum(arr, fn) { return arr.reduce((a, v) => a + fn(v), 0); }
    function countDistinct(arr, fn) {
        const s = new Set();
        arr.forEach(v => { const k = fn(v); if (k) s.add(k); });
        return s.size;
    }
    function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = String(v); }
    function bumpStat(id, by) {
        const el = document.getElementById(id); if (!el) return;
        el.textContent = String((parseInt(el.textContent, 10) || 0) + by);
    }
    function ymd(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function formatDay(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
    }
    function timeAgo(iso) {
        const diff = Math.max(0, Date.now() - new Date(iso).getTime());
        const s = Math.floor(diff / 1000);
        if (s < 60) return 'ahora';
        const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
        const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
        return new Date(iso).toLocaleDateString();
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Expose a tiny debug hook (optional)
    window.__visitorsMapDebug = {
        get state() { return { artistId, currentPeriod, visitsCount: currentVisits.length, markerCount: markers.length }; },
        refresh: () => refreshAll()
    };
})();
