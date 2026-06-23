/**
 * EXPLORE GLOBE â€” Page /explore/globe
 *
 * Premium global discovery experience powered by COBE (vendored at
 * /shared/vendor/cobe/index.esm.js). Renders the entire We Ã–tzi roster
 * on an interactive WebGL globe with:
 *
 *   - Auto-rotation that pauses on hover/drag/touch.
 *   - Bauhaus-styled DOM labels anchored to each artist (or cluster) â€”
 *     positioned manually so we don't depend on CSS Anchor Positioning
 *     (which is Chromium-only). Labels are clickable (open modal),
 *     fade as they rotate to the back of the globe.
 *   - Country/city clustering so dense areas don't drown the page in
 *     overlapping labels.
 *   - Synced side panel (Airbnb-style list) â€” clicking a card focuses
 *     and selects that artist on the globe and renders a connecting
 *     arc from We Ã–tzi HQ to the artist's location.
 *   - Reuses the same modal+CTAs (Cotizar / Ver perfil / CÃ³mo llegar)
 *     pattern from /explore (Google Maps view).
 *
 * Why COBE projection is reimplemented locally:
 *   COBE's `createGlobe` does the projection internally for rendering
 *   markers/arcs but does NOT expose a "where is this lat/lng on screen"
 *   API. Since we keep our own copy of phi/theta (driven by us via
 *   onRender), we can use the exact same projection math here to know
 *   where each label should sit pixel-for-pixel. Math intentionally
 *   mirrors `O(t)` and `U([lat, lng])` from the upstream library.
 */

import createGlobe from '/shared/vendor/cobe/index.esm.js';

(function () {
    'use strict';

    // -------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------
    const TOP_STYLES = [
        { label: 'Realismo',     icon: 'fa-solid fa-eye' },
        { label: 'Tradicional',  icon: 'fa-solid fa-anchor' },
        { label: 'Fine Line',    icon: 'fa-solid fa-pen-nib' },
        { label: 'Blackwork',    icon: 'fa-solid fa-brush' },
        { label: 'Minimalista',  icon: 'fa-solid fa-minus' },
        { label: 'JaponÃ©s',      icon: 'fa-solid fa-dragon' },
        { label: 'GeomÃ©trico',   icon: 'fa-solid fa-shapes' },
        { label: 'Acuarela',     icon: 'fa-solid fa-droplet' },
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

    // Origin point used as the source of arcs when an artist is selected.
    // Buenos Aires is We Ã–tzi HQ; if we ever want to use the visitor's IP
    // location as the source, swap this with a fetch to /api/client-info.
    const HQ = { name: 'We Ã–tzi HQ', lat: -34.6037, lng: -58.3816 };

    // View modes â€” drive every render in the page.
    //   GLOBAL:   no artist selected. Show all artists as tiny illuminated
    //             dots, plus a quiet web of connection arcs. The spotlight
    //             loop highlights one random visible artist at a time.
    //   SELECTED: one artist selected. Show only its itinerary stops as
    //             pins, with arcs of light between them. Spotlight pauses.
    const VIEW_GLOBAL = 'global';
    const VIEW_SELECTED = 'selected';

    // Spotlight cadence â€” how long a single name is on screen and how
    // long we wait between spotlights. The total cycle has to give the
    // user a beat of "huh, who's that?" without becoming busy.
    const SPOTLIGHT_VISIBLE_MS = 2000;
    const SPOTLIGHT_GAP_MS     = 600;
    const SPOTLIGHT_FADE_MS    = 280;
    // When the spotlight artist has 2+ itinerary stops we cycle through
    // them in cronological order: each stop is on screen for STOP_MS,
    // and the transition between them is a plane animation lasting
    // FLIGHT_MS. The carousel ends after the last stop fades out.
    const CAROUSEL_STOP_MS     = 3000;
    const CAROUSEL_FLIGHT_MS   = 1600;
    // Spacing between concentric rings of pins that share a city.
    // The first ring sits at this radius, the second at 2×, etc.
    // 0.55° ≈ 60 km — close enough to read as "same city" but far enough
    // for adjacent dots to not visually merge.
    const PIN_JITTER_DEG       = 0.55;

    // Globe colors (RGB 0..1 floats â€” COBE convention).
    // `baseColor` is the LAND DOTS color (not the globe sphere). Brighter
    // than the previous value so continents read clearly from a distance
    // even before the user starts to interact.
    const COLOR_BG       = [0.45, 0.42, 0.38];   // legible land dots from far
    const COLOR_GLOW     = [0.55, 0.18, 0.12];   // soft red atmosphere glow
    const COLOR_MARKER   = [1.0, 0.73, 0.26];    // default marker = yellow
    const COLOR_ARC      = [0.23, 0.52, 1.0];    // arc default = blue
    const COLOR_RECOMMEND = [0.89, 0.24, 0.16];  // recommended = primary red
    const COLOR_CLUSTER   = [0.89, 0.24, 0.16];  // city/country cluster = primary red (matches label)
    // Itinerary visuals: per-location pins + arcs of light between them.
    const COLOR_ITIN      = [0.96, 0.85, 0.42];  // soft gold for itinerary pins
    const COLOR_ITIN_ARC  = [1.0, 0.78, 0.20];   // brighter gold for arcs of light

    // Auto-rotation speed (radians per frame at 60fps). When the user has
    // `prefers-reduced-motion: reduce` set we still rotate, but ~3x slower
    // so the motion is perceptible without being jittery.
    const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const AUTOROTATE_SPEED = PREFERS_REDUCED_MOTION ? 0.0009 : 0.0028;
    // Drag sensitivity â€” pixels to radians.
    const DRAG_SENSITIVITY = 0.005;
    // Inertia decay for momentum after release.
    const INERTIA_DECAY = 0.94;
    // Theta clamp so the user can't roll the globe upside down.
    const THETA_CLAMP = Math.PI / 2.4;

    // -------------------------------------------------------------
    // State
    // -------------------------------------------------------------
    const STATE = {
        artistsAll: [],         // every fetched artist (with location or not)
        artistsGeo: [],         // artists with valid (lat, lng)
        filtered: [],           // post-filter subset
        filters: {
            style: null, country: null, priceRange: null,
            language: null, experience: null
        },
        clusters: [],           // [{ id, label, lat, lng, country, city, count, artistIds[] }]
        labelEntries: [],       // [{ id, kind: 'artist'|'cluster', el, ref }]
        labelById: new Map(),

        selectedArtistId: null,
        // Cached itinerary for the currently selected artist:
        //   { artistId, entries: [{ id, period_type, studio_name, city,
        //     start_date, end_date, lat, lng, formatted_address, agenda_status }] }
        // We keep it on STATE so the render loop can re-project the points
        // every frame without re-fetching, and so the card and the globe
        // stay in lockstep.
        selectedItinerary: null,
        // We keep a separate map of itinerary marker entries so they can be
        // projected/positioned by the same renderLabels machinery as the
        // main artist labels, without polluting STATE.markers.
        itineraryById: new Map(),

        // Spotlight state --------------------------------------------
        // Single rotating DOM label that highlights one random visible
        // artist at a time in GLOBAL mode, then fades and rotates to
        // another. The element is created lazily inside the labels layer.
        spotlightArtist: null,
        spotlightHideAt: 0,
        spotlightCooldownAt: 0,
        spotlightEl: null,
        // Anchor in world coords (lat,lng) the chip is currently pinned
        // to. Defaults to the artist's home; while the carousel runs it
        // follows the current itinerary stop so the chip "moves" along
        // with the plane.
        spotlightAnchor: null,
        // Carousel — when an artist has 2+ itinerary stops we cycle
        // through them in cronological order, 3s per stop, animating a
        // plane between them.
        spotlightItinerary: null,        // entries[] for the active artist
        spotlightItineraryIndex: 0,      // which stop is currently shown
        spotlightCarouselTimer: 0,       // setTimeout handle
        // Plane animation between stops — one in flight at a time.
        planeEl: null,
        planeAnimation: null,            // { from, to, startedAt, duration, onArrive }

        // Itinerary cache so the spotlight can pull a previously fetched
        // schedule instantly. Map<user_id, entries[]>. Populated lazily:
        //   - selectArtist() seeds it for the user-clicked artist
        //   - showSpotlight() does a background fetch for the picked one
        // entries[] follows the same shape as fetchArtistItinerary()
        // returns. Empty array means "fetched but no entries".
        itineraryCache: new Map(),

        // Globe runtime
        canvas: null,
        labelsLayer: null,
        globe: null,
        size: { width: 0, height: 0 },
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        offset: [0, 0],
        scale: 1.0,

        // Camera
        phi: 0,
        theta: -0.18,
        // Always start with auto-rotate ON. The globe is the centerpiece of
        // the page and the gentle rotation is what cues the user that it's
        // interactive. `prefers-reduced-motion` is honored by lowering the
        // speed (see AUTOROTATE_SPEED), not by stopping the motion entirely.
        autoRotate: true,
        pointerDown: false,
        lastPointer: null,
        velocityPhi: 0,
        velocityTheta: 0,
        lastFrameAt: 0,

        // Resume auto-rotation N ms after the last user interaction.
        resumeAutoRotateAt: 0,
        AUTOROTATE_RESUME_MS: 1800
    };

    // -------------------------------------------------------------
    // Tiny utilities (kept local so this module has no dependencies
    // beyond ConfigManager + createGlobe).
    // -------------------------------------------------------------
    function $(id) { return document.getElementById(id); }
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function bioPlainSnippet(value, maxLength, fallback = '') {
        if (window.BioFormatting) {
            return window.BioFormatting.getBioPlainTextSnippet(value, maxLength, fallback);
        }

        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const parser = document.createElement('div');
        parser.innerHTML = raw
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
        const text = (parser.textContent || parser.innerText || raw)
            .replace(/\r/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return text.length > maxLength ? text.slice(0, maxLength).trimEnd() + '...' : text;
    }
    function setBioHtml(id, value, emptyMessage) {
        const el = $(id);
        if (!el) return null;
        if (window.BioFormatting) {
            window.BioFormatting.renderBioHtml(el, value, { emptyMessage });
        } else {
            el.textContent = bioPlainSnippet(value, 1000, emptyMessage);
        }
        return el;
    }
    function toTitleCase(str) {
        if (!str) return '';
        return String(str).split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }
    function parseStyles(styles) {
        if (!styles) return [];
        if (Array.isArray(styles)) return styles;
        if (typeof styles === 'string') {
            try { if (styles.startsWith('[')) return JSON.parse(styles); } catch {}
            return styles.split(',').map(s => s.trim()).filter(Boolean);
        }
        return [];
    }
    function parsePrice(priceStr) {
        if (!priceStr) return 0;
        const m = String(priceStr).match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
    }
    function shortPrice(p) {
        if (!p) return '$$';
        const n = parsePrice(p);
        if (!n) return String(p).replace(',00', '');
        if (n >= 1000) return '$' + Math.round(n / 100) / 10 + 'k';
        return '$' + n;
    }
    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
    function pad3(n) { return n < 1000 ? String(n).padStart(3, '0') : String(n); }

    // Single source of truth for the page mode. EVERY render function
    // branches off this, so there's never a stale state where pins from
    // GLOBAL mode linger after a selection (or vice versa).
    function getViewMode() {
        return STATE.selectedArtistId ? VIEW_SELECTED : VIEW_GLOBAL;
    }

    // Stable per-artist jitter so two artists in the same city don't
    // render as one merged dot. Instead of pure noise we lay them out in
    // a concentric spiral around the city centroid: 1 in the center, the
    // next 6 on a small ring, then 12 on a larger ring, etc. The result
    // looks intentional rather than dithered (the previous noise version
    // made cities look "fuzzy"). The map is rebuilt whenever the filtered
    // artist set changes (in applyFilters â†’ buildJitterMap()).
    let JITTER_MAP = new Map();

    function buildJitterMap() {
        JITTER_MAP = new Map();
        const cityGroups = new Map();
        STATE.filtered.forEach(a => {
            const lat = Number(a.latitude), lng = Number(a.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            // Group by rounded coords (â‰ˆ same city). Country|city would
            // miss artists who share a city but recorded it differently
            // ("CDMX" vs "Ciudad de Mexico"); rounded coords groups them.
            const key = lat.toFixed(2) + '|' + lng.toFixed(2);
            if (!cityGroups.has(key)) cityGroups.set(key, []);
            cityGroups.get(key).push(a);
        });

        cityGroups.forEach(group => {
            // Single artist in this city â€” sit them on the exact coord.
            if (group.length === 1) {
                JITTER_MAP.set(group[0].user_id, [0, 0]);
                return;
            }
            // Stable order so the spiral pattern doesn't twitch when
            // an unrelated artist is added/removed.
            group.sort((a, b) => String(a.user_id).localeCompare(String(b.user_id)));

            // Spiral lay-out: index 0 â†’ center; next 6 â†’ ring 1; next 12 â†’ ring 2; etc.
            // Each tier holds (tier * 6) slots so packing matches a hex-ish ring.
            for (let i = 0; i < group.length; i++) {
                if (i === 0) {
                    JITTER_MAP.set(group[i].user_id, [0, 0]);
                    continue;
                }
                let tier = 0, posInTier = i, tierSize = 1;
                while (posInTier >= tierSize) {
                    posInTier -= tierSize;
                    tier++;
                    tierSize = tier * 6;
                }
                const angleStep = (2 * Math.PI) / tierSize;
                // Rotate alternate tiers half-step so dots don't all sit on
                // a single radial line.
                const angle = posInTier * angleStep + (tier % 2 ? angleStep / 2 : 0);
                const r = tier * (PIN_JITTER_DEG * 0.55); // ring spacing
                JITTER_MAP.set(group[i].user_id, [
                    Math.sin(angle) * r,           // dlat (north-south)
                    Math.cos(angle) * r            // dlng (east-west)
                ]);
            }
        });
    }

    function getJitter(userId, axis) {
        const v = JITTER_MAP.get(userId);
        if (!v) return 0;
        return axis === 'lat' ? v[0] : v[1];
    }

    function waitForConfigManager(maxWait = 5000) {
        return new Promise(resolve => {
            const start = Date.now();
            (function poll() {
                if (window.ConfigManager) return resolve();
                if (Date.now() - start > maxWait) return resolve();
                setTimeout(poll, 50);
            })();
        });
    }

    // -------------------------------------------------------------
    // Data: fetch artists from Supabase
    // -------------------------------------------------------------
    async function fetchArtists() {
        const supabase = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!supabase || window.ConfigManager.isDemoMode()) {
            console.warn('[explore-globe] Demo mode or no Supabase. Empty roster.');
            return [];
        }

        const cols = [
            'user_id', 'username', 'name', 'profile_picture', 'styles_array',
            'session_price', 'years_experience', 'languages', 'bio_description',
            'is_recommended', 'work_type', 'studio_id', 'location_source',
            'studio_name', 'studio_phone', 'studio_website',
            'country', 'country_code', 'state_province', 'city', 'locality',
            'street', 'street_number', 'unit', 'postal_code', 'formatted_address',
            'latitude', 'longitude', 'google_place_id', 'geocoded_at'
        ].join(',');

        let resp = await WeotziData.from('artists_with_location').select(cols);
        if (resp.error) {
            console.warn('[explore-globe] artists_with_location unavailable, falling back:', resp.error.message);
            const fallbackCols = 'user_id,username,name,profile_picture,styles_array,city,country,session_price,years_experience,languages,bio_description,is_recommended,latitude,longitude,formatted_address,locality,street,street_number,postal_code,work_type,studio_id,location_source,studio_name';
            resp = await WeotziData.from('artists_db').select(fallbackCols);
        }
        if (resp.error) {
            console.error('[explore-globe] Supabase error:', resp.error);
            return [];
        }
        return (resp.data || []).map(a => Object.assign({}, a, {
            languages: a.languages || ['EspaÃ±ol'],
            country: a.country || 'Desconocido'
        }));
    }

    // -------------------------------------------------------------
    // Itinerary: fetches every "current" + "upcoming" tattoo location
    // for an artist and resolves coordinates in two phases:
    //   1. studio_id      -> studio_locations (primary) lat/lng
    //   2. plain city only -> WeOtziGeocoder (cached on the client)
    //
    // Returns an array of entries already in cronological order:
    //   current (sort_order ascending), then upcoming (start_date ascending).
    // Each entry: { id, period_type, studio_name, city, start_date, end_date,
    //   agenda_status, lat, lng, formatted_address, source }
    // `source` is 'studio' or 'geocoded' so the UI can pick a different
    // visual treatment if needed.
    // -------------------------------------------------------------
    async function fetchArtistItinerary(userId) {
        if (STATE.itineraryCache.has(userId)) {
            return STATE.itineraryCache.get(userId);
        }
        const supabase = window.ConfigManager && window.ConfigManager.getSupabaseClient();
        if (!supabase || !userId) return [];

        let resp = await WeotziData
            .from('artist_tattoo_locations')
            .select('id, period_type, studio_name, city, start_date, end_date, agenda_status, sort_order, studio_id')
            .eq('artist_user_id', userId);
        if (resp.error || !Array.isArray(resp.data) || !resp.data.length) {
            if (resp.error) console.warn('[explore-globe] itinerary fetch failed:', resp.error.message);
            // Cache the empty result so we don't re-hit the DB every time
            // a spotlight cycles back to an artist with no schedule.
            STATE.itineraryCache.set(userId, []);
            return [];
        }

        const rows = resp.data.slice();
        // Sort: current first (sort_order asc), then upcoming by start_date asc.
        rows.sort((a, b) => {
            const ap = a.period_type === 'current' ? 0 : 1;
            const bp = b.period_type === 'current' ? 0 : 1;
            if (ap !== bp) return ap - bp;
            if (a.period_type === 'current') return (a.sort_order || 0) - (b.sort_order || 0);
            const ad = a.start_date ? new Date(a.start_date).getTime() : 0;
            const bd = b.start_date ? new Date(b.start_date).getTime() : 0;
            return ad - bd;
        });

        // Phase 1: bulk-fetch primary studio_locations for entries that
        // reference a studio. One round-trip for all of them.
        const studioIds = [...new Set(rows.map(r => r.studio_id).filter(Boolean))];
        const studioCoords = new Map();
        if (studioIds.length) {
            const slResp = await WeotziData
                .from('studio_locations')
                .select('studio_id, latitude, longitude, formatted_address, city, country')
                .in('studio_id', studioIds)
                .eq('is_primary', true);
            if (!slResp.error && Array.isArray(slResp.data)) {
                slResp.data.forEach(sl => studioCoords.set(sl.studio_id, sl));
            }
        }

        // Phase 2: enrich every row with coords. Geocode the city only
        // when we couldn't resolve via studio_locations. We run geocodes
        // sequentially (the geocoder rate-limits anyway) so we don't burst
        // into OVER_QUERY_LIMIT.
        const enriched = [];
        for (const r of rows) {
            const item = {
                id: r.id,
                period_type: r.period_type,
                studio_name: r.studio_name,
                city: r.city,
                start_date: r.start_date,
                end_date: r.end_date,
                agenda_status: r.agenda_status,
                lat: null, lng: null,
                formatted_address: null,
                source: null
            };
            if (r.studio_id && studioCoords.has(r.studio_id)) {
                const sl = studioCoords.get(r.studio_id);
                item.lat = Number(sl.latitude);
                item.lng = Number(sl.longitude);
                item.formatted_address = sl.formatted_address || [sl.city, sl.country].filter(Boolean).join(', ');
                item.source = 'studio';
            } else if (r.city && window.WeOtziGeocoder && window.WeOtziGeocoder.geocodeQuery) {
                try {
                    const point = await window.WeOtziGeocoder.geocodeQuery(r.city);
                    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
                        item.lat = point.lat;
                        item.lng = point.lng;
                        item.formatted_address = point.displayName || r.city;
                        item.source = 'geocoded';
                    }
                } catch (err) { /* silent â€” we just skip this entry */ }
            }
            if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) enriched.push(item);
        }
        // Cache so subsequent spotlights or selections render instantly.
        STATE.itineraryCache.set(userId, enriched);
        return enriched;
    }

    // Date helpers â€” the itinerary card needs to render compact ranges
    // (e.g. "12 nov Â· 03 dic" or "Desde feb 2027").
    function formatItineraryDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    }
    function formatItineraryRange(entry) {
        if (entry.period_type === 'current') {
            return entry.agenda_status === 'closed' ? 'Agenda cerrada' : 'Agenda abierta';
        }
        const from = formatItineraryDate(entry.start_date);
        const to = formatItineraryDate(entry.end_date);
        if (from && to) return `${from} â†’ ${to}`;
        if (from) return `Desde ${from}`;
        if (to) return `Hasta ${to}`;
        return 'PrÃ³ximamente';
    }

    // -------------------------------------------------------------
    // Filter logic (mirrors /explore)
    // -------------------------------------------------------------
    function passesFilters(a, f) {
        if (f.style) {
            const styles = parseStyles(a.styles_array).map(s => s.toLowerCase());
            if (!styles.some(s => s.includes(f.style.toLowerCase()))) return false;
        }
        if (f.country && a.country !== f.country) return false;
        if (f.language) {
            const langs = Array.isArray(a.languages) ? a.languages : [a.languages];
            if (!langs.includes(f.language)) return false;
        }
        if (f.experience) {
            const y = parseInt(a.years_experience, 10) || 0;
            if (f.experience === 'junior' && (y < 1 || y > 3)) return false;
            if (f.experience === 'mid'    && (y < 4 || y > 7)) return false;
            if (f.experience === 'senior' && y < 8) return false;
        }
        if (f.priceRange) {
            const p = parsePrice(a.session_price);
            if (f.priceRange === 'low' && p > 200) return false;
            if (f.priceRange === 'medium' && (p < 200 || p > 800)) return false;
            if (f.priceRange === 'high' && p < 800) return false;
        }
        return true;
    }

    function applyFilters() {
        STATE.filtered = STATE.artistsGeo.filter(a => passesFilters(a, STATE.filters));
        // Recompute the spiral lay-out for the (possibly) new set of
        // filtered artists. Doing it here means every render — markers,
        // arcs, spotlight pick — pulls jitter from the same fresh map.
        buildJitterMap();
        renderPanel();
        renderLabels();
        updateGlobeData();
        updateCounters();
    }

    // -------------------------------------------------------------
    // Counters
    // -------------------------------------------------------------
    function updateCounters() {
        const countries = new Set();
        const cities = new Set();
        STATE.filtered.forEach(a => {
            if (a.country) countries.add(a.country);
            if (a.city) cities.add(`${a.country}|${a.city}`);
        });
        const total = STATE.filtered.length;
        const countryEl = $('globe-counter-countries');
        const cityEl = $('globe-counter-cities');
        const valueEl = $('globe-counter-value');
        const panelCount = $('globe-panel-count');
        if (valueEl) valueEl.textContent = pad3(total);
        if (countryEl) countryEl.textContent = countries.size;
        if (cityEl) cityEl.textContent = cities.size;
        if (panelCount) panelCount.textContent = pad3(total);
    }

    // -------------------------------------------------------------
    // Filter UI
    // -------------------------------------------------------------
    function initFilterUI() {
        const pills = $('globe-style-pills');
        if (pills) {
            const stylePillsHtml = TOP_STYLES.map(s => {
                const count = STATE.artistsAll.filter(a =>
                    parseStyles(a.styles_array).some(x => x.toLowerCase() === s.label.toLowerCase())
                ).length;
                return `<button class="filter-pill" data-style="${escapeHtml(s.label)}" type="button">
                    <i class="${s.icon}"></i>
                    <span>${escapeHtml(s.label)}</span>
                    <span class="pill-count">(${count})</span>
                </button>`;
            }).join('');
            pills.innerHTML = stylePillsHtml;

            pills.addEventListener('click', e => {
                const btn = e.target.closest('.filter-pill');
                if (!btn) return;
                const style = btn.dataset.style;
                STATE.filters.style = STATE.filters.style === style ? null : style;
                pills.querySelectorAll('.filter-pill').forEach(b =>
                    b.classList.toggle('is-active', b.dataset.style === STATE.filters.style)
                );
                applyFilters();
            });
        }

        const country = $('globe-filter-country');
        if (country) {
            const countries = [...new Set(STATE.artistsAll.map(a => a.country).filter(Boolean))].sort();
            countries.forEach(c => {
                const n = STATE.artistsAll.filter(a => a.country === c).length;
                const opt = document.createElement('option');
                opt.value = c; opt.textContent = `${c} (${n})`;
                country.appendChild(opt);
            });
            country.addEventListener('change', () => {
                STATE.filters.country = country.value || null;
                applyFilters();
            });
        }

        const lang = $('globe-filter-language');
        if (lang) {
            const langs = [];
            STATE.artistsAll.forEach(a => {
                if (a.languages) langs.push(...(Array.isArray(a.languages) ? a.languages : [a.languages]));
            });
            [...new Set(langs)].sort().forEach(l => {
                const opt = document.createElement('option');
                opt.value = l; opt.textContent = l;
                lang.appendChild(opt);
            });
            lang.addEventListener('change', () => {
                STATE.filters.language = lang.value || null;
                applyFilters();
            });
        }

        const price = $('globe-filter-price');
        if (price) price.addEventListener('change', () => {
            STATE.filters.priceRange = price.value || null; applyFilters();
        });
        const exp = $('globe-filter-experience');
        if (exp) exp.addEventListener('change', () => {
            STATE.filters.experience = exp.value || null; applyFilters();
        });

        const clearBtn = $('globe-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', clearFilters);

        // "Limpiar filtros" button inside empty state.
        const empty = $('globe-empty');
        if (empty) empty.addEventListener('click', e => {
            const trigger = e.target.closest('[data-action="clear-filters"]');
            if (trigger) clearFilters();
        });
    }

    function clearFilters() {
        STATE.filters = { style: null, country: null, priceRange: null, language: null, experience: null };
        ['globe-filter-country', 'globe-filter-price', 'globe-filter-language', 'globe-filter-experience']
            .forEach(id => { const el = $(id); if (el) el.value = ''; });
        document.querySelectorAll('.globe-filter-pills .filter-pill.is-active')
            .forEach(b => b.classList.remove('is-active'));
        applyFilters();
    }

    // -------------------------------------------------------------
    // Side panel rendering
    // -------------------------------------------------------------
    function renderPanel() {
        const list = $('globe-panel-list');
        const empty = $('globe-panel-empty');
        if (!list) return;

        if (STATE.filtered.length === 0) {
            list.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            const sceneEmpty = $('globe-empty');
            if (sceneEmpty && STATE.artistsGeo.length > 0) sceneEmpty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');
        const sceneEmpty = $('globe-empty');
        if (sceneEmpty) sceneEmpty.classList.add('hidden');

        list.innerHTML = STATE.filtered.map(a => {
            const styles = parseStyles(a.styles_array).slice(0, 3);
            const cover = a.profile_picture
                ? `style="background-image:url('${escapeHtml(a.profile_picture)}')"`
                : '';
            const coverClass = a.profile_picture ? '' : ' no-image';
            const price = a.session_price ? String(a.session_price).replace(',00', '') : 'Consultar';
            const recBadge = a.is_recommended
                ? '<span class="globe-card-recommended-tag">Recomendado</span>'
                : '';
            const isActive = STATE.selectedArtistId === a.user_id ? ' is-active' : '';

            return `<article class="globe-card${isActive}" data-user-id="${escapeHtml(a.user_id)}" role="listitem">
                ${recBadge}
                <div class="globe-card-img${coverClass}" ${cover}></div>
                <div class="globe-card-body">
                    <div class="globe-card-styles">
                        ${styles.map(s => `<span class="tag-mini">${escapeHtml(s)}</span>`).join('')}
                    </div>
                    <h3 class="globe-card-name">${escapeHtml(toTitleCase(a.name || a.username))}</h3>
                    <div class="globe-card-meta">${escapeHtml(toTitleCase(a.city || a.country || 'Sin ubicaciÃ³n'))}</div>
                    <span class="globe-card-price">${escapeHtml(price)}</span>
                </div>
            </article>`;
        }).join('');

        list.querySelectorAll('.globe-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.userId;
                const artist = STATE.artistsGeo.find(a => a.user_id === id);
                if (!artist) return;
                selectArtist(artist, { focus: true, openModal: false });
            });
        });
    }

    // -------------------------------------------------------------
    // COBE projection â€” kept in sync with phi/theta/state.size
    // (mirrors the math in cobe@2.0.1 dist/index.esm.js).
    // -------------------------------------------------------------
    function latLngToXYZ(lat, lng) {
        const phi = lat * Math.PI / 180;
        const theta = lng * Math.PI / 180 - Math.PI;
        const cosPhi = Math.cos(phi);
        return [-cosPhi * Math.cos(theta), Math.sin(phi), cosPhi * Math.sin(theta)];
    }

    // Project a raw 3D point (already on or near the unit sphere) to
    // canvas-space pixels, using the same camera math the COBE shaders
    // use internally. Returns { x, y, frontFacing }.
    //
    // We split this from projectLatLng so the plane animation — which
    // walks a 3D bézier curve between two stops — can reuse the camera
    // matrix without doing the lat/lng round-trip every frame.
    function project3D(xyz) {
        const tx = xyz[0], ty = xyz[1], tz = xyz[2];

        const cosTheta = Math.cos(STATE.theta);
        const cosPhi   = Math.cos(STATE.phi);
        const sinTheta = Math.sin(STATE.theta);
        const sinPhi   = Math.sin(STATE.phi);

        const c = cosPhi * tx + sinPhi * tz;
        const s = sinPhi * sinTheta * tx + cosTheta * ty - cosPhi * sinTheta * tz;
        const z = -sinPhi * cosTheta * tx + sinTheta * ty + cosPhi * cosTheta * tz;

        const w = STATE.size.width || 1;
        const h = STATE.size.height || 1;
        const dpr = STATE.dpr;
        const scale = STATE.scale;
        const offset = STATE.offset;

        // Match the fragment shader's NDC mapping so DOM overlays align
        // pixel-for-pixel with what COBE renders.
        const ndcX = (c / (w / h) * scale + offset[0] * scale * dpr / w);
        const ndcY = (-s * scale + offset[1] * scale * dpr / h);

        return {
            x: (ndcX + 1) * 0.5 * w,
            y: (ndcY + 1) * 0.5 * h,
            frontFacing: z >= 0
        };
    }

    // Project a (lat, lng) to canvas pixels, lifting the point slightly
    // off the surface so labels don't kiss the silhouette of the globe.
    function projectLatLng(lat, lng) {
        const t = latLngToXYZ(lat, lng);
        const r = 0.86;
        return project3D([t[0] * r, t[1] * r, t[2] * r]);
    }

    // -------------------------------------------------------------
    // Label DOM management
    //
    // The page intentionally has NO permanent text labels on the globe.
    //   - GLOBAL mode shows only illuminated dots; one rotating spotlight
    //     reveals the name of a random visible artist for ~2s.
    //   - SELECTED mode shows only the artist's itinerary pins; the card
    //     on the left is the source of truth for names/dates.
    // We keep this stub so that any leftover labels from earlier code are
    // wiped on every applyFilters() call.
    // -------------------------------------------------------------
    function renderLabels() {
        if (!STATE.labelsLayer) return;
        STATE.labelById.forEach(el => { try { el.remove(); } catch (e) {} });
        STATE.labelById.clear();
        STATE.labelEntries = [];
    }

    function updateLabelPositions() {
        // Nothing to reposition besides the spotlight; that's handled in
        // positionSpotlight() which is called from the RAF loop.
    }

    // -------------------------------------------------------------
    // Selection + selected-card preview + arc
    // -------------------------------------------------------------
    function selectArtist(artist, opts = {}) {
        // If a previous spotlight (random picker) was running, tear it
        // down before we install the selected artist's spotlight — that
        // keeps both modes from racing on the same DOM node.
        if (STATE.spotlightArtist && (!artist || STATE.spotlightArtist.user_id !== artist.user_id)) {
            hideSpotlight();
        }

        STATE.selectedArtistId = artist ? artist.user_id : null;
        // Reset itinerary every time so we don't flash a previous artist's
        // dots on the globe while the new query is in flight.
        STATE.selectedItinerary = null;

        if (artist && opts.focus) focusOn(Number(artist.latitude), Number(artist.longitude));

        renderSelectedCard(artist);
        updateGlobeData(); // refresh arcs + marker emphasis

        // Sync side panel highlight.
        document.querySelectorAll('.globe-card.is-active').forEach(c => c.classList.remove('is-active'));
        if (artist) {
            const card = document.querySelector(`.globe-card[data-user-id="${cssEscape(artist.user_id)}"]`);
            if (card) {
                card.classList.add('is-active');
                // Scroll into view if user came from a click on the globe.
                if (opts.focus) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }

        if (artist && opts.openModal) openArtistModal(artist);

        // Kick off the spotlight for the selected artist so the chip +
        // carousel + plane animation mirror the GLOBAL view experience.
        // showSpotlight() reads itineraryCache: if entries are already
        // there it starts the carousel right away; otherwise it shows
        // the simple chip and upgrades when the fetch returns.
        if (artist) {
            showSpotlight(artist);
            loadItineraryFor(artist);
        }
    }

    async function loadItineraryFor(artist) {
        const targetId = artist.user_id;
        try {
            const entries = await fetchArtistItinerary(targetId);
            // If the user moved on to a different artist while we were
            // fetching, ignore this stale response.
            if (STATE.selectedArtistId !== targetId) return;
            STATE.selectedItinerary = { artistId: targetId, entries };
            renderItineraryList(entries, artist);
            updateGlobeData();
            // Re-focus on the FIRST stop of the itinerary (which may differ
            // from the artist's home city — e.g. they're on a guest spot).
            // This keeps the page promise of "go to the place they're at".
            if (entries.length) {
                focusOn(entries[0].lat, entries[0].lng);
            }
            // Upgrade the spotlight to a full carousel now that we have
            // entries. If the simple chip was already showing, this
            // swaps it in place without a flash.
            if (entries.length >= 2 && STATE.spotlightArtist === artist
                && !STATE.spotlightItinerary) {
                cancelCarousel();
                startCarousel(artist, entries);
            } else if (entries.length === 1 && STATE.spotlightArtist === artist
                && !STATE.spotlightItinerary) {
                renderSimpleSpotlight(artist, entries[0]);
            }
        } catch (err) {
            console.warn('[explore-globe] loadItineraryFor failed:', err);
        }
    }

    function clearSelection() {
        STATE.selectedArtistId = null;
        STATE.selectedItinerary = null;
        // Hide the selected-artist spotlight chip + plane. The GLOBAL
        // random picker will pick someone else next tick.
        hideSpotlight();
        renderSelectedCard(null);
        renderItineraryList([], null);
        updateGlobeData();
        document.querySelectorAll('.globe-card.is-active').forEach(c => c.classList.remove('is-active'));
        // Returning to GLOBAL view immediately resumes the gentle
        // auto-rotation so the spotlight loop can do its thing.
        STATE.autoRotate = true;
        STATE.resumeAutoRotateAt = 0;
    }

    function renderSelectedCard(artist) {
        const card  = $('globe-selected-card');
        const stage = document.querySelector('.globe-stage');
        if (!card) return;
        // Helper: re-measure the canvas + flag a COBE resize for the
        // next frame. The ResizeObserver already does this when it
        // notices the stage size change, but it can lag a frame; calling
        // it manually here makes the layout swap visually instant.
        const reflowGlobe = () => {
            requestAnimationFrame(() => {
                try {
                    measureCanvas();
                    STATE.pendingResize = true;
                } catch (e) {}
            });
        };
        if (!artist) {
            card.classList.add('hidden');
            if (stage) stage.classList.remove('has-selection');
            reflowGlobe();
            return;
        }
        card.classList.remove('hidden');
        if (stage) stage.classList.add('has-selection');
        reflowGlobe();

        const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
        const setHidden = (id, hidden) => { const el = $(id); if (el) el.hidden = hidden; };

        const cover = $('globe-selected-cover');
        if (cover) {
            // Setting `backgroundImage = ''` clears the inline style so the
            // .no-image CSS rule (Bauhaus pattern) takes over. Setting 'none'
            // would beat the CSS via specificity and leave a flat gray box.
            cover.style.backgroundImage = artist.profile_picture
                ? `url("${artist.profile_picture}")`
                : '';
            cover.classList.toggle('no-image', !artist.profile_picture);
        }

        // Recomendado tag (top-right ribbon).
        const rec = $('globe-selected-recommended');
        if (rec) rec.hidden = !artist.is_recommended;

        const name = toTitleCase(artist.name || artist.username || 'Artista');
        const location = [artist.city, artist.country].filter(Boolean).map(toTitleCase).join(', ')
            || 'UbicaciÃ³n reservada';
        setText('globe-selected-name', name);
        setText('globe-selected-location', location);

        // Source pill: "Estudio Â· X" or "Independiente". Sits next to the
        // location eyebrow so the user knows where the artist works.
        const sourceEl = $('globe-selected-source');
        if (sourceEl) {
            if (artist.location_source === 'studio' && artist.studio_name) {
                sourceEl.textContent = artist.studio_name;
                sourceEl.classList.add('is-studio');
                sourceEl.classList.remove('is-independent');
                sourceEl.hidden = false;
            } else if (artist.work_type === 'independent' || artist.location_source === 'independent') {
                sourceEl.textContent = 'Independiente';
                sourceEl.classList.add('is-independent');
                sourceEl.classList.remove('is-studio');
                sourceEl.hidden = false;
            } else {
                sourceEl.hidden = true;
            }
        }

        // Style tags (4 max so they fit on one row).
        const stylesEl = $('globe-selected-styles');
        if (stylesEl) {
            const styles = parseStyles(artist.styles_array).slice(0, 4);
            stylesEl.innerHTML = styles.map(s =>
                `<span class="tag-mini">${escapeHtml(s)}</span>`
            ).join('');
        }

        // Bio: short snippet (140 chars) â€” keeps the card from growing too tall.
        const bio = bioPlainSnippet(artist.bio_description, 140, '');
        const bioEl = $('globe-selected-bio');
        if (bioEl) {
            if (bio) {
                bioEl.textContent = bio;
                bioEl.hidden = false;
            } else {
                bioEl.hidden = true;
            }
        }

        // Facts row: experience, languages, street address. Each fact hides
        // itself when the underlying value is missing so the card stays tidy.
        const expVal = artist.years_experience
            ? `${artist.years_experience} aÃ±os exp.`
            : null;
        if (expVal) setText('globe-selected-experience', expVal);
        setHidden('globe-selected-experience',
            !expVal && false /* always show parent toggle below */);
        $('globe-selected-facts')?.querySelector('[data-fact="experience"]')
            ?.toggleAttribute('hidden', !expVal);

        const langs = Array.isArray(artist.languages)
            ? artist.languages.filter(Boolean)
            : (artist.languages ? [artist.languages] : []);
        const langText = langs.length ? langs.join(' Â· ') : null;
        if (langText) setText('globe-selected-languages', langText);
        $('globe-selected-facts')?.querySelector('[data-fact="languages"]')
            ?.toggleAttribute('hidden', !langText);

        // Street address: prefer formatted_address, fall back to manual parts.
        let addr = (artist.formatted_address || '').trim();
        if (!addr) {
            addr = [
                [artist.street, artist.street_number].filter(Boolean).join(' '),
                artist.unit, artist.locality, artist.postal_code
            ].filter(Boolean).join(', ');
        }
        if (addr) setText('globe-selected-address', addr);
        $('globe-selected-facts')?.querySelector('[data-fact="address"]')
            ?.toggleAttribute('hidden', !addr);

        const price = artist.session_price
            ? String(artist.session_price).replace(',00', '')
            : 'Consultar';
        setText('globe-selected-price', price);

        // "CÃ³mo llegar" â€” only visible when we can build a Google Maps URL.
        const directions = $('globe-selected-directions');
        if (directions) {
            const url = buildDirectionsUrl(artist);
            if (url) {
                directions.href = url;
                directions.hidden = false;
            } else {
                directions.removeAttribute('href');
                directions.hidden = true;
            }
        }
    }

    // -------------------------------------------------------------
    // Itinerary list inside the selected card.
    // Each row is a button so the user can click a destination and have
    // the globe focus on it without leaving the page.
    // -------------------------------------------------------------
    function renderItineraryList(entries, artist) {
        const section = $('globe-selected-itinerary');
        const list = $('globe-selected-itinerary-list');
        if (!section || !list) return;

        if (!entries || !entries.length) {
            section.hidden = true;
            list.innerHTML = '';
            return;
        }
        section.hidden = false;

        list.innerHTML = entries.map((entry, idx) => {
            const dot = entry.period_type === 'current' ? 'current' : 'upcoming';
            const order = String(idx + 1).padStart(2, '0');
            const venue = entry.studio_name || entry.city || 'Sin estudio';
            const where = [entry.city, entry.formatted_address && entry.formatted_address !== entry.city ? entry.formatted_address : null]
                .filter(Boolean).join(' Â· ') || (entry.city || '');
            const range = formatItineraryRange(entry);
            return `<li class="itinerary-row" data-itinerary-id="${escapeHtml(entry.id)}" data-period="${escapeHtml(entry.period_type)}">
                <button type="button" class="itinerary-row-btn">
                    <span class="itinerary-order">${order}</span>
                    <span class="itinerary-dot dot-${escapeHtml(dot)}" aria-hidden="true"></span>
                    <span class="itinerary-body">
                        <span class="itinerary-venue">${escapeHtml(venue)}</span>
                        <span class="itinerary-where">${escapeHtml(where)}</span>
                        <span class="itinerary-range">${escapeHtml(range)}</span>
                    </span>
                </button>
            </li>`;
        }).join('');

        // Wire click â†’ focus globe on that destination.
        list.querySelectorAll('.itinerary-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.dataset.itineraryId;
                const item = entries.find(e => String(e.id) === String(id));
                if (item) focusOn(item.lat, item.lng);
            });
        });
    }

    // Returns the value of `current` rotated by whole 2π so it lands
    // within ±π of `target`. Used so the camera lerp always takes the
    // short path around the globe, even when `current` has accumulated
    // many full rotations from auto-rotate or drag input.
    function nearestAngle(current, target) {
        const TAU = Math.PI * 2;
        let c = current;
        // These two while loops will terminate quickly because each
        // iteration shrinks |c - target| by 2π.
        while (c - target >  Math.PI) c -= TAU;
        while (target - c >  Math.PI) c += TAU;
        return c;
    }

    // Focus the globe so a (lat, lng) ends at the front-center of the
    // viewport.
    //
    // Derivation: COBE applies the rotation `R_x(theta) ∘ R_y(phi)` to
    // each point in world space, then projects. We want this rotation
    // to map our target world-vector P = latLngToXYZ(lat, lng) onto
    // the screen-forward axis [0, 0, +1].
    //
    // Solving R_x(theta)·R_y(phi)·P = [0, 0, 1] with P =
    // latLngToXYZ(lat, lng) = [cosLat·cos(lng), sin(lat),
    // -cosLat·sin(lng)] (after collapsing the `-π` shift inside
    // latLngToXYZ) yields:
    //
    //   theta = lat · π/180          (positive lat ⇒ tilt to show the north)
    //   phi   = -π/2 - lng · π/180   (rotates the longitude to the front)
    //
    // The previous formulas (lng·π/180 - π and -lat·π/180) were off by
    // up to 180° depending on the longitude, which is why some stops
    // appeared centered and others didn't.
    function focusOn(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const newTargetPhi   = -Math.PI / 2 - lng * Math.PI / 180;
        const newTargetTheta = lat * Math.PI / 180;
        // Re-base STATE.phi so the lerp toward newTargetPhi takes the
        // short path around the globe. Without this, accumulated phi
        // (from auto-rotate / drag) can make the lerp crawl across
        // the back of the globe instead of taking the closer route.
        STATE.phi = nearestAngle(STATE.phi, newTargetPhi);
        STATE.targetPhi   = newTargetPhi;
        STATE.targetTheta = clamp(newTargetTheta, -THETA_CLAMP, THETA_CLAMP);
        STATE.autoRotate = false;
        STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;
    }

    // -------------------------------------------------------------
    // Spotlight loop
    //
    // Every SPOTLIGHT_VISIBLE_MS+SPOTLIGHT_GAP_MS we pick a random artist
    // whose dot is currently front-facing on the globe and reveal their
    // name on a single floating label that fades in/out. The intent is
    // a slow, magazine-style reveal of WHO is on the globe, without
    // burying it in permanent labels.
    //
    // This runs ONLY in GLOBAL view; entering SELECTED hides the label
    // immediately and the loop becomes a no-op until the user clears.
    // -------------------------------------------------------------
    function ensureSpotlightEl() {
        if (STATE.spotlightEl) return STATE.spotlightEl;
        if (!STATE.labelsLayer) return null;
        const el = document.createElement('div');
        el.className = 'globe-spotlight';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.hidden = true;
        // Click on the spotlighted name = select that artist (lets the
        // visitor act on the curiosity the spotlight just created).
        const handle = (e) => {
            if (e && e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            const a = STATE.spotlightArtist;
            if (a) selectArtist(a, { focus: true, openModal: false });
        };
        el.addEventListener('click', handle);
        el.addEventListener('keydown', handle);
        STATE.labelsLayer.appendChild(el);
        STATE.spotlightEl = el;
        return el;
    }

    function pickSpotlightCandidate() {
        if (!STATE.filtered.length) return null;
        // Build the pool of artists whose dots are currently on the front
        // hemisphere of the globe so we never highlight someone the user
        // can't see.
        const pool = [];
        for (const a of STATE.filtered) {
            const lat = Number(a.latitude);
            const lng = Number(a.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const p = projectLatLng(lat + getJitter(a.user_id, 'lat'),
                                    lng + getJitter(a.user_id, 'lng'));
            if (!p.frontFacing) continue;
            // Also require the projected pixel to be inside (or close to)
            // the canvas, otherwise the label would render off-screen.
            if (p.x < 20 || p.x > STATE.size.width - 20) continue;
            if (p.y < 20 || p.y > STATE.size.height - 20) continue;
            pool.push(a);
            // Weighted entries — artists with a cached multi-stop
            // itinerary are far more interesting (they unlock the
            // carousel + plane animation), so we skew the pick toward
            // them. Recommended artists get a smaller bump.
            const cached = STATE.itineraryCache.get(a.user_id);
            if (cached && cached.length >= 2) {
                // 4 extra entries → ~5x the weight of a vanilla artist.
                pool.push(a, a, a, a);
            }
            if (a.is_recommended) pool.push(a);
        }
        if (!pool.length) return null;
        // Avoid showing the same artist back-to-back when possible.
        let pick = pool[Math.floor(Math.random() * pool.length)];
        if (STATE.spotlightArtist
            && pick.user_id === STATE.spotlightArtist.user_id
            && pool.length > 1) {
            pick = pool[(pool.indexOf(pick) + 1) % pool.length];
        }
        return pick;
    }

    function showSpotlight(artist) {
        const el = ensureSpotlightEl();
        if (!el || !artist) return;
        STATE.spotlightArtist = artist;
        // Default anchor is the artist's home dot; the carousel will
        // override this with each itinerary stop's coords.
        STATE.spotlightAnchor = {
            lat: Number(artist.latitude),
            lng: Number(artist.longitude)
        };
        // Reset any previous carousel run.
        cancelCarousel();

        // If the itinerary is cached and has 2+ stops, kick off the
        // carousel right now. Single-stop artists fall through to the
        // simple chip; the carousel takes over later if the fetch
        // returns more entries.
        const cached = STATE.itineraryCache.get(artist.user_id);
        if (cached && cached.length >= 2) {
            startCarousel(artist, cached);
        } else {
            renderSimpleSpotlight(artist, cached && cached.length === 1 ? cached[0] : null);
        }

        el.hidden = false;
        // Force a reflow so the entry animation plays even when the
        // element was already on screen for a previous pick.
        void el.offsetWidth;
        el.classList.remove('is-leaving');
        el.classList.add('is-visible');
        positionSpotlight();
        updateGlobeData();

        // Background-fetch the itinerary the first time we see this
        // artist. If it returns 2+ stops we upgrade the simple chip to
        // a carousel; if 1, we update the chip with the date.
        if (!STATE.itineraryCache.has(artist.user_id)) {
            fetchArtistItinerary(artist.user_id).then(entries => {
                if (STATE.spotlightArtist !== artist) return;
                if (!entries) return;
                if (entries.length >= 2) {
                    cancelCarousel();
                    startCarousel(artist, entries);
                } else if (entries.length === 1) {
                    renderSimpleSpotlight(artist, entries[0]);
                }
                positionSpotlight();
                updateGlobeData();
            }).catch(() => { /* silent — we still have name + city */ });
        }
    }

    // Simple chip — used when the artist has no itinerary or just one
    // stop. SPOTLIGHT_VISIBLE_MS rules the lifetime; tickSpotlight()
    // fades it out when the timer is up.
    function renderSimpleSpotlight(artist, singleEntry) {
        const el = STATE.spotlightEl;
        if (!el) return;
        STATE.spotlightHideAt = performance.now() + SPOTLIGHT_VISIBLE_MS;

        const name = toTitleCase(artist.name || artist.username || 'Artista');
        const where = singleEntry
            ? toTitleCase(singleEntry.studio_name || singleEntry.city || '')
            : toTitleCase(artist.city || artist.country || '');
        const recBadge = artist.is_recommended
            ? '<span class="globe-spotlight-badge">Recomendado</span>'
            : '';
        const dateLine = singleEntry
            ? '<span class="globe-spotlight-date">' + escapeHtml(formatItineraryRange(singleEntry)) + '</span>'
            : '';

        el.innerHTML = ''
            + recBadge
            + '<span class="globe-spotlight-name">' + escapeHtml(name) + '</span>'
            + (where ? '<span class="globe-spotlight-meta">' + escapeHtml(where) + '</span>' : '')
            + dateLine;

        // Anchor is the entry's coords if we have one, otherwise home.
        if (singleEntry) {
            STATE.spotlightAnchor = { lat: singleEntry.lat, lng: singleEntry.lng };
        }
    }

    // ----------------------------------------------------------------
    // Carousel: cycles through an artist's itinerary one stop at a time,
    // CAROUSEL_STOP_MS per stop, animating a plane along the bézier of
    // each transition. The chip's anchor follows the active stop so the
    // text floats where the plane just landed.
    // ----------------------------------------------------------------
    function startCarousel(artist, entries) {
        STATE.spotlightItinerary = entries;
        STATE.spotlightItineraryIndex = 0;
        // tickSpotlight() shouldn't auto-hide while the carousel runs;
        // we hide it ourselves at the end.
        STATE.spotlightHideAt = 0;
        showCarouselEntry(artist, 0);
        scheduleNextCarouselStep();
    }

    function cancelCarousel() {
        if (STATE.spotlightCarouselTimer) {
            clearTimeout(STATE.spotlightCarouselTimer);
            STATE.spotlightCarouselTimer = 0;
        }
        STATE.spotlightItinerary = null;
        STATE.spotlightItineraryIndex = 0;
        // Cancel any in-flight plane so we don't have a ghost flying
        // around after the user clicks away.
        if (STATE.planeEl) STATE.planeEl.hidden = true;
        STATE.planeAnimation = null;
    }

    function showCarouselEntry(artist, idx) {
        const el = STATE.spotlightEl;
        const entries = STATE.spotlightItinerary;
        if (!el || !entries || idx < 0 || idx >= entries.length) return;
        const entry = entries[idx];

        const name = toTitleCase(artist.name || artist.username || 'Artista');
        const recBadge = artist.is_recommended
            ? '<span class="globe-spotlight-badge">Recomendado</span>'
            : '';
        const place = toTitleCase(entry.studio_name || entry.city || '—');
        const range = formatItineraryRange(entry);
        const periodCls = entry.period_type === 'current' ? 'is-current' : 'is-upcoming';
        const periodTxt = entry.period_type === 'current' ? 'Aquí ahora' : 'Próximamente';

        el.innerHTML = ''
            + recBadge
            + '<span class="globe-spotlight-name">' + escapeHtml(name) + '</span>'
            + '<span class="globe-spotlight-counter">'
            +     'Destino ' + (idx + 1) + ' / ' + entries.length
            + '</span>'
            + '<div class="globe-spotlight-stop">'
            +    '<span class="globe-spotlight-period ' + periodCls + '">' + escapeHtml(periodTxt) + '</span>'
            +    '<span class="globe-spotlight-place">' + escapeHtml(place) + '</span>'
            +    '<span class="globe-spotlight-date">' + escapeHtml(range) + '</span>'
            + '</div>';

        // The chip now floats over THIS stop's coords (where the plane
        // just landed), not the artist's home city.
        STATE.spotlightAnchor = { lat: entry.lat, lng: entry.lng };

        // Center the globe on this stop. Without this, only the FIRST
        // stop (centered by loadItineraryFor) and the destinations
        // entered via flyPlane get focus — direct chip swaps (e.g.
        // when a cached itinerary kicks off the carousel before
        // loadItineraryFor returns) would leave the globe wherever
        // it was. Calling focusOn here makes every stop predictable.
        focusOn(entry.lat, entry.lng);
    }

    function scheduleNextCarouselStep() {
        if (STATE.spotlightCarouselTimer) clearTimeout(STATE.spotlightCarouselTimer);
        STATE.spotlightCarouselTimer = setTimeout(advanceCarousel, CAROUSEL_STOP_MS);
    }

    function advanceCarousel() {
        const entries = STATE.spotlightItinerary;
        const cur = STATE.spotlightItineraryIndex;
        if (!entries) return;
        let next = cur + 1;

        if (next >= entries.length) {
            // End of the cycle. SELECTED mode loops back to the first
            // stop so the user can keep watching the artist's tour for
            // as long as they want. GLOBAL mode hides the spotlight so
            // the random picker can move on to someone else.
            if (getViewMode() === VIEW_SELECTED && entries.length >= 2) {
                next = 0;
            } else {
                hideSpotlight();
                return;
            }
        }
        const fromEntry = entries[cur];
        const toEntry = entries[next];
        // Fly the plane between the stops; when it lands, swap the chip
        // and refresh the globe so the new active stop's pin inflates.
        flyPlane(fromEntry, toEntry, () => {
            STATE.spotlightItineraryIndex = next;
            showCarouselEntry(STATE.spotlightArtist, next);
            updateGlobeData();
            scheduleNextCarouselStep();
        });
    }

    // ----------------------------------------------------------------
    // Plane animation along a 3D bézier between two stops. We pick a
    // mid-point lifted off the sphere so the curve arches through the
    // sky, mirroring the visual of COBE's arc renderer.
    // ----------------------------------------------------------------
    // SVG drawn from a 3/4 perspective view (as if seen from above-behind
    // the plane). The fuselage, wings and tail are separate paths so we
    // can shade them differently — that's what makes a flat icon read
    // as 3D. The tip of the nose sits at (32, 18); the SVG box is 64×64
    // and we center it via translate(-50%, -50%) on the wrapper.
    const PLANE_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="plane-fuselage" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"  stop-color="#fff8dc"/>
      <stop offset="0.55" stop-color="#f4b942"/>
      <stop offset="1"  stop-color="#7a4a00"/>
    </linearGradient>
    <linearGradient id="plane-wing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe06a"/>
      <stop offset="1" stop-color="#a87e1f"/>
    </linearGradient>
    <linearGradient id="plane-tail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff8dc"/>
      <stop offset="1" stop-color="#a87e1f"/>
    </linearGradient>
  </defs>
  <!-- Cast shadow under the plane (gives the 3D float feel). -->
  <ellipse cx="32" cy="58" rx="14" ry="2.2" fill="#000" opacity="0.45"/>
  <!-- Tail fin (vertical stabilizer) -->
  <path d="M30 30 L34 30 L34 50 L31 52 L30 50 Z" fill="url(#plane-tail)" stroke="#0a0a0a" stroke-width="0.8"/>
  <!-- Horizontal stabilizer -->
  <path d="M22 49 L42 49 L40 52 L24 52 Z" fill="url(#plane-wing)" stroke="#0a0a0a" stroke-width="0.8"/>
  <!-- Main wings (perspective: closer wing larger) -->
  <path d="M8 36 L32 30 L56 36 L56 40 L34 38 L8 40 Z" fill="url(#plane-wing)" stroke="#0a0a0a" stroke-width="0.9"/>
  <!-- Fuselage -->
  <path d="M32 8 C 35 8 37 12 37 22 L37 50 L32 53 L27 50 L27 22 C 27 12 29 8 32 8 Z"
        fill="url(#plane-fuselage)" stroke="#0a0a0a" stroke-width="1"/>
  <!-- Cockpit window -->
  <path d="M30 14 C 31 13 33 13 34 14 L34 19 L30 19 Z" fill="#1a1a1a"/>
  <!-- Engine accents -->
  <circle cx="20" cy="38" r="1.6" fill="#0a0a0a"/>
  <circle cx="44" cy="38" r="1.6" fill="#0a0a0a"/>
</svg>`.trim();

    function ensurePlaneEl() {
        if (STATE.planeEl) return STATE.planeEl;
        if (!STATE.labelsLayer) return null;
        // Outer wrapper holds left/top + heading rotation; inner div
        // holds the perspective container; inner-inner SVG holds the
        // pitch + bank rotations. Splitting the transforms into nested
        // elements lets each rotate around a clean axis without the
        // others interfering.
        const el = document.createElement('div');
        el.className = 'globe-plane';
        el.hidden = true;
        el.innerHTML = '<div class="globe-plane-rot">'
                     +    '<div class="globe-plane-tilt">' + PLANE_SVG + '</div>'
                     +  '</div>';
        STATE.labelsLayer.appendChild(el);
        STATE.planeEl = el;
        return el;
    }

    function flyPlane(fromEntry, toEntry, onArrive) {
        const el = ensurePlaneEl();
        if (!el) { onArrive && onArrive(); return; }
        STATE.planeAnimation = {
            from: { lat: fromEntry.lat, lng: fromEntry.lng },
            to:   { lat: toEntry.lat,   lng: toEntry.lng },
            startedAt: performance.now(),
            duration: CAROUSEL_FLIGHT_MS,
            onArrive,
            // Smoothing buffers: pitch and bank are derived from
            // numerical derivatives, which are noisy on small steps.
            // We low-pass filter them so the 3D rotation looks
            // intentional, not jittery.
            smoothedPitch: 0,
            smoothedBank:  0,
            // First-frame flag: tickPlane() needs it to rebase
            // STATE.phi the first time so the camera takes the short
            // path to the plane's starting orientation, instead of
            // potentially swinging the long way around.
            firstFrame: true
        };
        el.hidden = false;
    }

    function tickPlane() {
        const a = STATE.planeAnimation;
        const el = STATE.planeEl;
        if (!a || !el) return;
        const t = clamp((performance.now() - a.startedAt) / a.duration, 0, 1);
        // easeInOutQuad — gives the plane a satisfying takeoff/landing.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // ----- Path: same QUADRATIC BÉZIER that COBE renders -----
        // COBE's arc shader uses a quadratic bézier (not SLERP, not a
        // great-circle): start and end sit on a sphere of radius
        // (ee + markerElevation) = 0.8 + 0.06 = 0.86, and the control
        // point is `normalize(from + to) * (ee + arcHeight)` =
        // `normalize(from + to) * (0.8 + 0.36) = 1.16`.
        // We follow the exact same curve so the plane visibly rides
        // on top of the yellow arc, regardless of distance.
        // The plane sits a hair higher (0.88 / 1.18) so it doesn't
        // merge into the arc line itself.
        const F = latLngToXYZ(a.from.lat, a.from.lng);
        const T = latLngToXYZ(a.to.lat,   a.to.lng);
        const f3 = [F[0] * 0.88, F[1] * 0.88, F[2] * 0.88];
        const t3 = [T[0] * 0.88, T[1] * 0.88, T[2] * 0.88];
        // Midpoint: the *direction* of (F+T) normalized, then lifted
        // to the arc-apex altitude. This is what makes the curve
        // arch above the chord rather than cut through the sphere.
        const sumX = F[0] + T[0], sumY = F[1] + T[1], sumZ = F[2] + T[2];
        const sumLen = Math.hypot(sumX, sumY, sumZ) || 1e-6;
        const M = [sumX / sumLen * 1.18, sumY / sumLen * 1.18, sumZ / sumLen * 1.18];

        const bezierAt = (u) => {
            const uu = 1 - u;
            return [
                uu * uu * f3[0] + 2 * uu * u * M[0] + u * u * t3[0],
                uu * uu * f3[1] + 2 * uu * u * M[1] + u * u * t3[1],
                uu * uu * f3[2] + 2 * uu * u * M[2] + u * u * t3[2]
            ];
        };

        const p3 = bezierAt(eased);
        const screen = project3D(p3);

        // ----- Camera follow -----
        // Keep the globe rotating *with* the plane during the flight.
        // We solve the inverse of COBE's rotation for the plane's
        // current 3D position, so the camera always frames the plane
        // dead-center.
        //
        // For a unit point [nx, ny, nz] (the plane direction):
        //   theta = arcsin(ny)
        //   phi   = atan2(-nx, nz)
        // (derived by inverting tx = -sinPhi·cosTheta,
        //               ty = sinTheta,
        //               tz = cosPhi·cosTheta — the same formulas
        // focusOn() uses, just solved for phi/theta given the point.)
        const radius = Math.hypot(p3[0], p3[1], p3[2]) || 1;
        const nx = p3[0] / radius;
        const ny = clamp(p3[1] / radius, -1, 1);
        const nz = p3[2] / radius;
        const desiredTheta = clamp(Math.asin(ny), -THETA_CLAMP, THETA_CLAMP);
        const desiredPhi   = Math.atan2(-nx, nz);
        if (a.firstFrame) {
            STATE.phi = nearestAngle(STATE.phi, desiredPhi);
            a.firstFrame = false;
        }
        STATE.targetPhi   = nearestAngle(desiredPhi, STATE.phi);
        STATE.targetTheta = desiredTheta;
        // While the plane is flying we own the camera; don't let
        // auto-rotate or the resume-timer interfere.
        STATE.autoRotate = false;
        STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;

        // Sample two extra points along the curve so we can derive the
        // plane's *heading* (yaw on screen) and its *bank/pitch* (how
        // the curve bends in 3D). Three samples (behind, here, ahead)
        // are enough to estimate both first-order direction and the
        // small second-order curvature.
        const dt = 0.04;
        const eAhead  = Math.min(1, eased + dt);
        const eBehind = Math.max(0, eased - dt);
        const pAhead  = bezierAt(eAhead);
        const pBehind = bezierAt(eBehind);
        const screenAhead  = project3D(pAhead);
        const screenBehind = project3D(pBehind);

        // ---- Heading (yaw) ----
        // Direction of travel in screen space — what makes the nose
        // point along the path.
        const dx = screenAhead.x - screen.x;
        const dy = screenAhead.y - screen.y;
        // SVG nose points up (-Y); CSS rotation of 0deg keeps it up.
        // Math.atan2(dy, dx) is 0 when moving right (+X), so we add
        // 90° to bring the nose into alignment with travel direction.
        const headingDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90;

        // ---- Pitch (climb / dive) ----
        // The plane climbs toward the apex of the arc and descends
        // on approach. We read this from the radial distance from
        // the sphere center: rising distance ⇒ climbing.
        const radiusAhead  = Math.hypot(pAhead[0],  pAhead[1],  pAhead[2]);
        const radiusBehind = Math.hypot(pBehind[0], pBehind[1], pBehind[2]);
        const rawPitch = clamp((radiusAhead - radiusBehind) * 90, -25, 25);

        // ---- Bank (roll) ----
        // Aircraft bank into turns. We approximate the screen-path
        // curvature by comparing the heading at the previous sample
        // to the heading at the current one. A right-bend ⇒ bank right.
        const dxBack = screen.x - screenBehind.x;
        const dyBack = screen.y - screenBehind.y;
        const headingBack = Math.atan2(dyBack, dxBack) * 180 / Math.PI + 90;
        let dHeading = headingDeg - headingBack;
        if (dHeading >  180) dHeading -= 360;
        if (dHeading < -180) dHeading += 360;
        const rawBank = clamp(dHeading * 1.6, -35, 35);

        // ---- Smoothing ----
        // Numerical derivatives jitter on small steps; a low-pass
        // filter (alpha 0.18) gives a calm, intentional motion.
        const alpha = 0.18;
        a.smoothedPitch = a.smoothedPitch + (rawPitch - a.smoothedPitch) * alpha;
        a.smoothedBank  = a.smoothedBank  + (rawBank  - a.smoothedBank)  * alpha;

        // ---- Apply to nested transforms ----
        // Outer wrapper: position only.
        // .globe-plane-rot: heading (rotateZ).
        // .globe-plane-tilt: pitch (rotateX) + bank (rotateY).
        // Splitting them lets each axis act in its local frame.
        el.style.left = screen.x + 'px';
        el.style.top  = screen.y + 'px';
        const rot  = el.firstChild;                    // .globe-plane-rot
        const tilt = rot && rot.firstChild;            // .globe-plane-tilt
        if (rot)  rot.style.transform  = 'rotate(' + headingDeg.toFixed(1) + 'deg)';
        if (tilt) tilt.style.transform = 'rotateX(' + a.smoothedPitch.toFixed(1)
                                       + 'deg) rotateY(' + a.smoothedBank.toFixed(1) + 'deg)';
        el.classList.toggle('is-back', !screen.frontFacing);

        if (t >= 1) {
            // Hide the plane and call back to advance the carousel.
            el.hidden = true;
            const cb = a.onArrive;
            STATE.planeAnimation = null;
            if (typeof cb === 'function') cb();
        }
    }

    function hideSpotlight() {
        const el = STATE.spotlightEl;
        if (!el || el.hidden) return;
        STATE.spotlightArtist = null;
        STATE.spotlightAnchor = null;
        STATE.spotlightHideAt = 0;
        STATE.spotlightCooldownAt = performance.now() + SPOTLIGHT_GAP_MS;
        cancelCarousel();
        el.classList.remove('is-visible');
        el.classList.add('is-leaving');
        // Hide the node after the fade-out so it stops capturing clicks.
        setTimeout(() => {
            if (!STATE.spotlightArtist && el) el.hidden = true;
        }, SPOTLIGHT_FADE_MS);
        // Shrink the previously spotlit dot back to its base size.
        updateGlobeData();
    }

    // Called from the RAF loop. Repositions the spotlight to track its
    // artist as the globe rotates and tears it down once visible time is
    // up or the artist rotates to the back hemisphere.
    function positionSpotlight() {
        const el = STATE.spotlightEl;
        if (!el || !STATE.spotlightArtist) return;
        const anchor = STATE.spotlightAnchor;
        const a = STATE.spotlightArtist;
        // Anchor: itinerary stop (during carousel) or the artist's home
        // pin (simple chip). Falls back to home if anchor isn't set yet.
        const lat = anchor && Number.isFinite(anchor.lat)
            ? anchor.lat
            : Number(a.latitude) + getJitter(a.user_id, 'lat');
        const lng = anchor && Number.isFinite(anchor.lng)
            ? anchor.lng
            : Number(a.longitude) + getJitter(a.user_id, 'lng');
        const p = projectLatLng(lat, lng);
        if (!p.frontFacing) {
            // Don't hide while the plane is mid-flight — the chip will
            // re-anchor when the plane lands. If it's a simple chip (no
            // carousel running), going to the back means the user can't
            // see the artist anymore so we hide right away.
            if (!STATE.spotlightItinerary) hideSpotlight();
            return;
        }
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        // The simple-chip lifetime is governed by spotlightHideAt; the
        // carousel manages its own timing and doesn't set that field.
        if (STATE.spotlightHideAt && performance.now() >= STATE.spotlightHideAt) {
            hideSpotlight();
        }
    }

    // The "loop" is just a tick we run from RAF — every frame we check
    // if it's time to either pick a new artist (after cooldown) or stop
    // showing the current one.
    //
    // Behavior diverges by view mode:
    //   GLOBAL   — random picker auto-rotates through visible artists.
    //   SELECTED — spotlight is pinned to the selected artist; never
    //              auto-picks. The carousel loops indefinitely while
    //              the artist stays selected; clearSelection() tears it
    //              down.
    function tickSpotlight() {
        if (STATE.spotlightArtist) {
            positionSpotlight();
            return;
        }
        // No artist active. Only run the random picker in GLOBAL view.
        if (getViewMode() !== VIEW_GLOBAL) return;
        if (performance.now() < STATE.spotlightCooldownAt) return;
        const next = pickSpotlightCandidate();
        if (next) showSpotlight(next);
        else STATE.spotlightCooldownAt = performance.now() + SPOTLIGHT_GAP_MS;
    }

    // -------------------------------------------------------------
    // Globe initialization + render loop
    // -------------------------------------------------------------
    function initGlobe() {
        STATE.canvas = $('globe-canvas');
        STATE.labelsLayer = $('globe-labels');
        if (!STATE.canvas) {
            console.error('[explore-globe] canvas not found');
            return;
        }

        measureCanvas();

        STATE.targetPhi = STATE.phi;
        STATE.targetTheta = STATE.theta;

        STATE.globe = createGlobe(STATE.canvas, {
            devicePixelRatio: STATE.dpr,
            width: STATE.size.width * STATE.dpr,
            height: STATE.size.height * STATE.dpr,
            phi: STATE.phi,
            theta: STATE.theta,
            // `dark: 1` flips the day/night shading so the lit hemisphere
            // looks night-toned â€” perfect for our editorial-dark page.
            dark: 1,
            diffuse: 3,
            mapSamples: 16000,
            // Bumped brightness so the continent silhouettes are obvious
            // from the default zoom (previous values made the globe read
            // as a uniform speckled disc until the user zoomed in).
            mapBrightness: 14,
            // Keep the unlit side near pure black so we don't add noise
            // outside the actual landmasses.
            mapBaseBrightness: 0,
            baseColor: COLOR_BG,
            markerColor: COLOR_MARKER,
            glowColor: COLOR_GLOW,
            scale: STATE.scale,
            offset: STATE.offset,
            markers: [],
            arcs: [],
            arcColor: COLOR_ARC,
            arcWidth: 1.6,
            arcHeight: 0.36,
            markerElevation: 0.06,
            opacity: 1
            // NOTE: COBE 2.0.1's bundle does NOT auto-invoke `onRender`;
            // there is no internal RAF loop. We drive the loop ourselves
            // below in startRenderLoop() so phi/theta updates animate.
        });

        bindPointerEvents(STATE.canvas);

        // Resize observer keeps the globe crisp when the window changes.
        const resizeObs = new ResizeObserver(() => {
            measureCanvas();
            // After a resize, push new dimensions on the next frame so the
            // canvas backing buffer stays in sync with the CSS box.
            STATE.pendingResize = true;
        });
        resizeObs.observe(STATE.canvas.parentElement || document.body);

        // Initial loading veil hide once globe has data.
        const loading = $('globe-loading');
        if (loading) {
            // Tiny delay so the user perceives the globe popping in.
            setTimeout(() => loading.classList.add('is-hidden'), 350);
        }

        startRenderLoop();
        startNetworkAnimation();
    }

    // Periodically re-shuffle the global connection web so it visibly
    // "breathes". Pairs of pulses every 2.4s — fast enough to feel alive,
    // slow enough that the eye can read a single arc before it fades.
    // Skipped while the user is interacting (selected mode) or dragging.
    function startNetworkAnimation() {
        const TICK_MS = 2400;
        setInterval(() => {
            if (getViewMode() !== VIEW_GLOBAL) return;
            if (STATE.pointerDown) return;
            // Only re-render the markers/arcs payload, not the whole tree.
            updateGlobeData();
        }, TICK_MS);
    }

    // -------------------------------------------------------------
    // RAF loop â€” COBE 2.0.1 doesn't run its own loop, so we step the
    // camera every frame and push phi/theta into the globe ourselves.
    // -------------------------------------------------------------
    function startRenderLoop() {
        let stopped = false;
        function frame() {
            if (stopped) return;
            stepCamera();
            if (STATE.globe) {
                const update = {
                    phi: STATE.phi,
                    theta: STATE.theta
                };
                if (STATE.pendingResize) {
                    update.width = STATE.size.width * STATE.dpr;
                    update.height = STATE.size.height * STATE.dpr;
                    update.scale = STATE.scale;
                    STATE.pendingResize = false;
                }
                STATE.globe.update(update);
            }
            // Spotlight runs every frame so it tracks rotation smoothly.
            tickSpotlight();
            // The plane animation also runs from RAF — its callback
            // advances the carousel when it lands.
            tickPlane();
            STATE.raf = requestAnimationFrame(frame);
        }
        STATE.raf = requestAnimationFrame(frame);
        STATE.stopRenderLoop = () => { stopped = true; cancelAnimationFrame(STATE.raf); };
    }

    function measureCanvas() {
        const stage = STATE.canvas?.parentElement;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        // Canvas is square â€” fit largest square inside the stage frame.
        const side = Math.max(64, Math.min(rect.width, rect.height));
        STATE.size.width = side;
        STATE.size.height = side;
        STATE.dpr = Math.min(window.devicePixelRatio || 1, 2);
        STATE.canvas.style.width = side + 'px';
        STATE.canvas.style.height = side + 'px';
    }

    function stepCamera() {
        const now = performance.now();
        const dt = STATE.lastFrameAt ? Math.min(now - STATE.lastFrameAt, 64) : 16;
        STATE.lastFrameAt = now;

        // Resume auto-rotation after the user has been idle long enough.
        // Note: while an artist is selected we keep the globe still on
        // purpose â€” the page promise is "go to their location and stop"
        // so they can read the itinerary without the camera drifting.
        if (!STATE.pointerDown
            && !STATE.autoRotate
            && STATE.resumeAutoRotateAt
            && Date.now() > STATE.resumeAutoRotateAt
            && getViewMode() === VIEW_GLOBAL) {
            STATE.autoRotate = true;
            STATE.resumeAutoRotateAt = 0;
        }

        // Inertia after release.
        if (!STATE.pointerDown) {
            STATE.targetPhi   += STATE.velocityPhi;
            STATE.targetTheta += STATE.velocityTheta;
            STATE.velocityPhi   *= INERTIA_DECAY;
            STATE.velocityTheta *= INERTIA_DECAY;
            if (Math.abs(STATE.velocityPhi) < 1e-4)   STATE.velocityPhi = 0;
            if (Math.abs(STATE.velocityTheta) < 1e-4) STATE.velocityTheta = 0;
        }

        // Auto-rotation (only when no user input is active).
        if (STATE.autoRotate && !STATE.pointerDown) {
            STATE.targetPhi += AUTOROTATE_SPEED * (dt / 16.67);
        }

        // Clamp tilt so the globe stays right-side up.
        STATE.targetTheta = clamp(STATE.targetTheta, -THETA_CLAMP, THETA_CLAMP);

        // Smooth follow toward target (critically damped feel).
        STATE.phi   += (STATE.targetPhi   - STATE.phi)   * 0.18;
        STATE.theta += (STATE.targetTheta - STATE.theta) * 0.18;
    }

    // -------------------------------------------------------------
    // Pointer interaction (mouse + touch + pen)
    // -------------------------------------------------------------
    function bindPointerEvents(el) {
        el.addEventListener('pointerdown', e => {
            STATE.pointerDown = true;
            STATE.lastPointer = { x: e.clientX, y: e.clientY };
            STATE.autoRotate = false;
            STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;
            el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', e => {
            if (!STATE.pointerDown) return;
            const dx = e.clientX - STATE.lastPointer.x;
            const dy = e.clientY - STATE.lastPointer.y;
            STATE.lastPointer = { x: e.clientX, y: e.clientY };
            const dPhi = dx * DRAG_SENSITIVITY;
            // Vertical axis is intentionally NOT negated: dragging down
            // tilts the globe down so the user feels they're rotating the
            // sphere directly (matches Earth-style globes; trackpad-style
            // inversion was the previous behavior and felt fighting the
            // gesture).
            const dTheta = dy * DRAG_SENSITIVITY;
            STATE.targetPhi += dPhi;
            STATE.targetTheta += dTheta;
            STATE.velocityPhi   = dPhi * 0.3;
            STATE.velocityTheta = dTheta * 0.3;
        });
        const release = e => {
            if (!STATE.pointerDown) return;
            STATE.pointerDown = false;
            try { el.releasePointerCapture(e.pointerId); } catch {}
            STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;
        };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('pointerleave', () => {
            if (STATE.pointerDown) STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;
        });

        // Mouse wheel: subtle zoom via globe scale (clamped).
        el.addEventListener('wheel', e => {
            e.preventDefault();
            const next = clamp(STATE.scale * (e.deltaY > 0 ? 0.92 : 1.08), 0.7, 1.6);
            STATE.scale = next;
            // Push to globe so its rendering reflects the scale.
            if (STATE.globe) STATE.globe.update({ scale: STATE.scale });
        }, { passive: false });

        // Hover pause: only on devices with a real cursor.
        if (window.matchMedia('(hover: hover)').matches) {
            el.addEventListener('mouseenter', () => {
                STATE.autoRotate = false;
                STATE.resumeAutoRotateAt = 0;
            });
            el.addEventListener('mouseleave', () => {
                STATE.resumeAutoRotateAt = Date.now() + STATE.AUTOROTATE_RESUME_MS;
            });
        }
    }

    // -------------------------------------------------------------
    // Marker/arc payload sent to COBE on every dataset change.
    //
    // The page has only two visual modes (see VIEW_GLOBAL / VIEW_SELECTED
    // above) and this is the single place that picks the payload for each
    // one. Anything visual the globe shows comes through here, so when a
    // selection is cleared we can never end up with leftover pins.
    // -------------------------------------------------------------
    function updateGlobeData() {
        if (!STATE.globe) return;

        const mode = getViewMode();
        const markers = [];
        const arcs = [];

        if (mode === VIEW_SELECTED) {
            // SELECTED â€” only the artist's itinerary stops + arcs of light
            // connecting them. Nothing else on the globe so the user can
            // read the journey at a glance.
            const itin = STATE.selectedItinerary
                && STATE.selectedItinerary.artistId === STATE.selectedArtistId
                ? STATE.selectedItinerary.entries
                : [];

            if (itin.length) {
                // Active carousel stop, if any, gets a larger pin so the
                // user can match the chip to the dot on the globe.
                const activeIdx = STATE.spotlightItinerary
                    && STATE.spotlightArtist
                    && STATE.spotlightArtist.user_id === STATE.selectedArtistId
                    ? STATE.spotlightItineraryIndex
                    : -1;
                itin.forEach((entry, i) => {
                    const isActive = i === activeIdx;
                    markers.push({
                        location: [entry.lat, entry.lng],
                        size: isActive ? 0.16 : (i === 0 ? 0.10 : 0.07),
                        color: COLOR_ITIN,
                        id: 'itin-' + entry.id
                    });
                });
                for (let i = 0; i < itin.length - 1; i++) {
                    const a = itin[i], b = itin[i + 1];
                    arcs.push({
                        from: [a.lat, a.lng],
                        to: [b.lat, b.lng],
                        color: COLOR_ITIN_ARC,
                        id: 'arc-itin-' + a.id + '-' + b.id
                    });
                }
            } else {
                // Itinerary either empty or still loading. Show one
                // recommended-tone pin at the artist's home so the globe
                // doesn't go blank during the fetch.
                const sel = STATE.artistsGeo.find(a => a.user_id === STATE.selectedArtistId);
                if (sel) {
                    markers.push({
                        location: [Number(sel.latitude), Number(sel.longitude)],
                        size: 0.12,
                        color: COLOR_RECOMMEND,
                        id: 'artist-' + sel.user_id
                    });
                }
            }
        } else {
            // GLOBAL â€” every filtered artist as a tiny illuminated dot
            // (sized just above the COBE land-dots so it reads as a pin
            // without dominating the map) plus a quiet web of connection
            // arcs. The current spotlight pick is rendered at ~4x the
            // base size so the eye snaps to it; when it leaves, the dot
            // shrinks back. updateGlobeData() is re-run from the spot-
            // light show/hide functions so the size change is immediate.
            const spotlitId = STATE.spotlightArtist && STATE.spotlightArtist.user_id;
            STATE.filtered.forEach(a => {
                const lat = Number(a.latitude);
                const lng = Number(a.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                // Deterministic jitter so artists in the same city don't
                // collapse to a single dot.
                const jLat = lat + getJitter(a.user_id, 'lat');
                const jLng = lng + getJitter(a.user_id, 'lng');
                const isSpotlit = a.user_id === spotlitId;
                const baseSize = a.is_recommended ? 0.024 : 0.018;
                const spotlitSize = a.is_recommended ? 0.095 : 0.08;
                markers.push({
                    location: [jLat, jLng],
                    size: isSpotlit ? spotlitSize : baseSize,
                    color: a.is_recommended ? COLOR_RECOMMEND : COLOR_MARKER,
                    id: 'artist-' + a.user_id
                });
            });
            buildGlobalConnectionArcs(arcs);

            // If the spotlit artist has an itinerary, render its stops
            // as gold pins with light arcs between them. The pins live
            // only as long as the spotlight, so the user gets a quick
            // preview of "where they tour" without leaving GLOBAL view.
            if (spotlitId) {
                const itin = STATE.itineraryCache.get(spotlitId);
                if (itin && itin.length > 0) {
                    itin.forEach((e, i) => {
                        markers.push({
                            location: [e.lat, e.lng],
                            size: i === 0 ? 0.085 : 0.065,
                            color: COLOR_ITIN,
                            id: 'spotlit-itin-' + e.id
                        });
                    });
                    for (let i = 0; i < itin.length - 1; i++) {
                        const a = itin[i], b = itin[i + 1];
                        arcs.push({
                            from: [a.lat, a.lng],
                            to:   [b.lat, b.lng],
                            color: COLOR_ITIN_ARC,
                            id: 'spotlit-arc-' + a.id + '-' + b.id
                        });
                    }
                }
            }
        }

        STATE.globe.update({
            markers,
            arcs,
            width: STATE.size.width * STATE.dpr,
            height: STATE.size.height * STATE.dpr,
            scale: STATE.scale,
            offset: STATE.offset
        });
    }

    // The quiet web of "connections that exist" between artists, drawn
    // only in GLOBAL view. We use two real signals from the data:
    //   1. studio_id  â€” colleagues sharing a studio. Strong link, gold.
    //   2. country    â€” chained pairs in the same country (cap 3/country).
    //                   Loose link, blue. The cap keeps the globe readable.
    //
    // Arcs that would render as a single point are filtered out because
    // COBE draws zero-length arcs as a vertical sliver of visual noise.
    function buildGlobalConnectionArcs(out) {
        const minDistDeg = 0.45; // skip arcs shorter than ~50km
        const tooShort = (a, b) =>
            Math.abs(Number(a.latitude) - Number(b.latitude)) < minDistDeg
            && Math.abs(Number(a.longitude) - Number(b.longitude)) < minDistDeg;
        const jitterCoords = (a) => [
            Number(a.latitude) + getJitter(a.user_id, 'lat'),
            Number(a.longitude) + getJitter(a.user_id, 'lng')
        ];

        // 1) Studio links â€” every pair sharing a studio.
        const byStudio = new Map();
        STATE.filtered.forEach(a => {
            if (!a.studio_id) return;
            const list = byStudio.get(a.studio_id) || [];
            list.push(a);
            byStudio.set(a.studio_id, list);
        });
        byStudio.forEach((list, studioId) => {
            if (list.length < 2) return;
            const hub = list[0];
            for (let i = 1; i < list.length; i++) {
                const peer = list[i];
                if (tooShort(hub, peer)) continue;
                out.push({
                    from: jitterCoords(hub),
                    to:   jitterCoords(peer),
                    color: COLOR_ITIN_ARC,
                    id: 'studio-' + studioId + '-' + i
                });
            }
        });

        // 2) Country web — pick up to 3 random pairs per country, fresh
        //    on every call. Calling this every ~2.4s makes the network
        //    visibly "breathe": old arcs fade out, new ones fade in,
        //    suggesting the platform is full of activity. The shuffle is
        //    cheap (Fisher-Yates over 1-20 items per country).
        const byCountry = new Map();
        STATE.filtered.forEach(a => {
            if (!a.country) return;
            const list = byCountry.get(a.country) || [];
            list.push(a);
            byCountry.set(a.country, list);
        });
        byCountry.forEach((list, country) => {
            if (list.length < 2) return;
            const shuffled = list.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const cap = Math.min(shuffled.length - 1, 3);
            for (let i = 0; i < cap; i++) {
                const a = shuffled[i], b = shuffled[i + 1];
                if (tooShort(a, b)) continue;
                out.push({
                    from: jitterCoords(a),
                    to:   jitterCoords(b),
                    color: COLOR_ARC,
                    // Random suffix so consecutive shuffles render as
                    // different arcs and re-trigger COBE's enter
                    // animation. Without this, repeating (from, to)
                    // tuples would just sit there static.
                    id: 'country-' + country.replace(/\s+/g, '_') + '-' + i
                            + '-' + Math.floor(Math.random() * 10000)
                });
            }
        });
    }

    function cssEscape(s) {
        if (typeof CSS !== 'undefined' && CSS.escape) {
            try { return CSS.escape(s); } catch {}
        }
        return String(s).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
    }

    // -------------------------------------------------------------
    // Modal (re-uses the dialog already in /explore/globe/index.html)
    // -------------------------------------------------------------
    function buildDirectionsUrl(a) {
        const lat = Number(a && a.latitude);
        const lng = Number(a && a.longitude);
        const placeId = a && a.google_place_id;
        const addr = a && (a.formatted_address || '').trim();
        if (placeId) {
            const base = 'https://www.google.com/maps/dir/?api=1&destination=';
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return base + lat + '%2C' + lng + '&destination_place_id=' + encodeURIComponent(placeId);
            }
            return base + encodeURIComponent(addr || '') + '&destination_place_id=' + encodeURIComponent(placeId);
        }
        if (addr) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + '%2C' + lng;
        }
        return null;
    }

    function openArtistModal(artist) {
        if (!artist) return;
        const backdrop = $('globe-modal-backdrop');
        if (!backdrop) return;

        try {
            const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

            const cover = $('globe-modal-cover');
            if (cover) cover.style.backgroundImage = artist.profile_picture
                ? `url("${artist.profile_picture}")`
                : 'none';

            const stylesEl = $('globe-modal-styles');
            if (stylesEl) {
                const styles = parseStyles(artist.styles_array).slice(0, 5);
                stylesEl.innerHTML = styles.map(s => `<span class="tag-mini">${escapeHtml(s)}</span>`).join('');
            }

            setText('globe-modal-name', toTitleCase(artist.name || artist.username || 'Artista'));

            const badge = $('globe-modal-source-badge');
            if (badge) {
                if (artist.location_source === 'studio' && artist.studio_name) {
                    badge.textContent = 'Estudio Â· ' + artist.studio_name;
                    badge.classList.add('is-studio'); badge.classList.remove('is-independent');
                    badge.hidden = false;
                } else if (artist.work_type === 'independent' || artist.location_source === 'independent') {
                    badge.textContent = 'Independiente';
                    badge.classList.add('is-independent'); badge.classList.remove('is-studio');
                    badge.hidden = false;
                } else {
                    badge.hidden = true;
                }
            }

            const location = [artist.city, artist.country].filter(Boolean).map(toTitleCase).join(', ')
                || 'UbicaciÃ³n no disponible';
            setText('globe-modal-location', location);

            const addrRow = $('globe-modal-address-row');
            let addr = (artist.formatted_address || '').trim();
            if (!addr) {
                addr = [
                    [artist.street, artist.street_number].filter(Boolean).join(' '),
                    artist.unit, artist.locality, artist.postal_code
                ].filter(Boolean).join(', ');
            }
            if (addrRow) {
                if (addr) {
                    setText('globe-modal-address', addr);
                    addrRow.hidden = false;
                } else {
                    addrRow.hidden = true;
                }
            }

            const directions = $('globe-modal-cta-directions');
            if (directions) {
                const url = buildDirectionsUrl(artist);
                if (url) { directions.href = url; directions.hidden = false; }
                else { directions.removeAttribute('href'); directions.hidden = true; }
            }

            setText('globe-modal-experience',
                artist.years_experience ? `${artist.years_experience} aÃ±os exp.` : 'Experiencia reservada');

            setBioHtml('globe-modal-bio', artist.bio_description, 'Este artista todavia no escribio una bio.');

            const price = artist.session_price ? String(artist.session_price).replace(',00', '') : 'Consultar';
            setText('globe-modal-price', price);

            const username = artist.username || '';
            const quote = $('globe-modal-cta-quote');
            const profile = $('globe-modal-cta-profile');
            if (quote) quote.onclick = () => {
                window.location.href = '/quotation?artist=' + encodeURIComponent(username);
            };
            if (profile) profile.onclick = () => {
                window.location.href = '/artist/profile?artist=' + encodeURIComponent(username);
            };
        } catch (err) {
            console.error('[explore-globe] modal populate failed, opening anyway:', err);
        }

        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }

    function closeArtistModal() {
        const backdrop = $('globe-modal-backdrop');
        if (!backdrop) return;
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }

    function bindModalDismissers() {
        const backdrop = $('globe-modal-backdrop');
        const close = $('globe-modal-close');
        if (close) close.addEventListener('click', closeArtistModal);
        if (backdrop) backdrop.addEventListener('click', e => {
            if (e.target === backdrop) closeArtistModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeArtistModal();
        });
    }

    // Selected-card actions: clear / open modal / quote.
    function bindSelectedCardActions() {
        const card = $('globe-selected-card');
        if (!card) return;
        card.addEventListener('click', e => {
            const action = e.target.closest('[data-action]')?.dataset?.action;
            if (!action) return;
            if (action === 'clear-selection') {
                clearSelection();
                return;
            }
            const sel = STATE.selectedArtistId
                && STATE.artistsGeo.find(a => a.user_id === STATE.selectedArtistId);
            if (!sel) return;
            if (action === 'open-modal') openArtistModal(sel);
            if (action === 'quote') {
                window.location.href = '/quotation?artist=' + encodeURIComponent(sel.username || '');
            }
        });
    }

    // -------------------------------------------------------------
    // Bootstrap
    // -------------------------------------------------------------
    async function bootstrap() {
        bindModalDismissers();
        bindSelectedCardActions();

        await waitForConfigManager();
        STATE.artistsAll = await fetchArtists();
        STATE.artistsGeo = STATE.artistsAll.filter(a => {
            const lat = Number(a.latitude);
            const lng = Number(a.longitude);
            return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
        });

        console.log('[explore-globe] Loaded', STATE.artistsAll.length, 'artists,',
            STATE.artistsGeo.length, 'with coordinates');

        initFilterUI();
        initGlobe();
        applyFilters();
        prewarmItineraries();
    }

    // Background-fetch a small batch of artist itineraries so the
    // spotlight carousel has something to show without waiting for the
    // user to interact. We pick artists most likely to have schedule
    // data (linked to a studio) and keep the batch small so we don't
    // hammer the DB on page load.
    function prewarmItineraries() {
        const candidates = STATE.artistsGeo
            .filter(a => a.studio_id)
            .slice(0, 12);
        // Stagger the fetches so they don't burst all at once. The
        // geocoder inside fetchArtistItinerary self-rate-limits anyway,
        // but spacing keeps the network panel calm during dev.
        candidates.forEach((a, i) => {
            setTimeout(() => {
                fetchArtistItinerary(a.user_id).catch(() => {});
            }, 200 * i);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

    // Tiny debug hook — handy in DevTools.
    window.__exploreGlobe = STATE;
    // QA helper: force-spotlight an artist by user_id. Used in browser
    // tests to deterministically trigger the carousel without waiting on
    // the random picker. Returns true if the artist was found.
    window.__forceSpotlight = function (userId) {
        const artist = STATE.artistsGeo.find(a => a.user_id === userId);
        if (!artist) return false;
        if (STATE.spotlightArtist) hideSpotlight();
        setTimeout(() => showSpotlight(artist), 60);
        return true;
    };
})();
