const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = window.supabase?.createClient
    ? (window._supabase = window._supabase || window.supabase.createClient(supabaseUrl, supabaseKey))
    : null;

const ARTIST_PUBLIC_FIELDS = [
    'username',
    'user_id',
    'name',
    'profile_picture',
    'styles_array',
    'bio_description',
    'session_price',
    'years_experience',
    'ubicacion',
    'city',
    'country',
    'portafolio',
    'instagram',
    'whatsapp_url',
    'gallery_images',
    'work_type',
    'estudios',
    'nivel',
    'verification_state',
    'embajador',
    'languages'
].join(',');

const INITIAL_GALLERY_SLOTS = 9;
const GALLERY_PLACEHOLDER_SRC = '/shared/assets/placeholders/gallery-default.svg';
const PROFILE_MOBILE_MENU_BREAKPOINT = 768;
const ARTIST_MAP_CONTAINER_ID = 'artist-map';
const ARTIST_MAP_EMPTY_ID = 'artist-map-empty';
const ARTIST_MAP_POINTS_ID = 'artist-map-points';
const ARTIST_MAP_INFO_CARD_ID = 'artist-map-info-card';
const GEOCODE_CACHE_PREFIX = 'weotzi:artist-map:geocode:v1:';
const GEOCODE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const GEOCODE_MIN_INTERVAL_MS = 280;
const GEOCODE_OVER_QUERY_LIMIT_RETRIES = 3;
const GEOCODE_UNKNOWN_ERROR_RETRIES = 1;
const PROFILE_ERROR_CONTENT = {
    not_found: {
        eyebrow: 'Perfil público · No encontrado',
        title: 'Artista no encontrado.. pero no te preocupes, hay muchos más!',
        message: 'Explora más perfiles dentro del marketplace.'
    },
    technical: {
        eyebrow: 'Perfil público · Error de carga',
        title: 'Artista no encontrado.. pero no te preocupes, hay muchos más!',
        message: 'No pudimos cargar este perfil ahora mismo. Puedes intentarlo de nuevo o explorar otros artistas en el marketplace.'
    }
};
const ERROR_SCENE_SHAPE_CONFIG = {
    circle: { moveX: 6, moveY: 5, rotate: 1.1 },
    bar: { moveX: 8, moveY: 2.5, rotate: 0.55 },
    slab: { moveX: -5, moveY: 6, rotate: -0.7 },
    'line-a': { moveX: 4, moveY: -2.5, rotate: 0.3 },
    'line-b': { moveX: -3.5, moveY: 4, rotate: -0.28 }
};
const AGENDA_STATUS_LABELS = {
    open: 'Agenda abierta',
    closed: 'Agenda cerrada'
};

const VERIFICATION_META = {
    No: { label: 'No verificado', state: 'unverified' },
    Requested: { label: 'Verificacion solicitada', state: 'review' },
    'In Progress': { label: 'En verificacion', state: 'review' },
    'In Analysis': { label: 'En analisis', state: 'review' },
    Yes: { label: 'Verificado', state: 'verified' },
    Denied: { label: 'Verificacion denegada', state: 'unverified' },
    Canceled: { label: 'Verificacion cancelada', state: 'unverified' }
};

let artistData = null;
let tattooLocations = [];
let galleryItems = [];
let galleryExpanded = false;
let currentLightboxIndex = 0;
let artistMap = null;
let artistMapPoints = [];
let googleGeocoder = null;
let geocodeLastRequestAt = 0;
let artistMapRenderToken = 0;
let activeMapPointIndex = -1;
let errorSceneParallaxRaf = 0;
let errorSceneParallaxEl = null;
let errorSceneMotionShapes = [];
const geocodeInFlight = new Map();

function isUrlVideo(url) {
    const ext = String(url || '').split('?')[0].split('.').pop()?.toLowerCase();
    return ext === 'mp4' || ext === 'mov';
}

function parseStylesArray(styles) {
    if (Array.isArray(styles)) return styles.filter(Boolean);
    if (typeof styles === 'string') {
        try {
            const parsed = JSON.parse(styles);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [styles].filter(Boolean);
        } catch {
            return styles ? [styles] : [];
        }
    }
    return [];
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeUsernameFromUrl(username) {
    if (!username) return '';
    return username.endsWith('.wo') ? username : `${username}.wo`;
}

function formatRequestedArtist(value) {
    const normalized = normalizeUsernameFromUrl(String(value || '').trim().replace(/^@+/, ''));
    return normalized ? `@${normalized}` : '';
}

function normalizeExternalUrl(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

function getQuotationUrl() {
    const username = artistData?.username || '';
    return `/quotations?artist=${encodeURIComponent(username)}`;
}

function getQuotationFormUrl() {
    const username = artistData?.username || '';
    return `/quotation?artist=${encodeURIComponent(username)}`;
}

function getGalleryFeedUrl() {
    const username = artistData?.username || '';
    return `/artist/profile/gallery?artist=${encodeURIComponent(username)}`;
}

function getWhatsappQuoteUrl() {
    if (artistData?.whatsapp_url) return artistData.whatsapp_url;

    const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541127015926';
    const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
    const artistUsername = artistData?.username || 'artista';
    const whatsappMessage = encodeURIComponent(`Hola Otzi, quiero cotizar con ${artistUsername}`);
    return `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;
}

function getInstagramProfileUrl(instagramValue) {
    if (!instagramValue) return '';
    const handle = String(instagramValue).trim().replace(/^@+/, '');
    if (!handle) return '';
    return `https://instagram.com/${encodeURIComponent(handle)}`;
}

function getVerificationMeta(state) {
    return VERIFICATION_META[state] || VERIFICATION_META.No;
}

function getEmbajadorLabel(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'si') return 'Si';
    if (normalized === 'pendiente') return 'Pendiente';
    return 'No';
}

function resolveWorkType(data) {
    const wt = data.work_type
        || (data.estudios === 'Sin estudio/Independiente' ? 'independent'
            : (data.estudios ? 'studio' : ''));

    const labels = {
        independent: 'Independiente',
        studio: 'Estudio',
        both: 'Estudio e independiente'
    };

    return {
        key: wt,
        label: labels[wt] || 'No especificado'
    };
}

function formatExperience(value) {
    if (!value) return 'No especificada';
    const raw = String(value).trim();
    if (!raw) return 'No especificada';
    return /^\d+$/.test(raw) ? `${raw} anos` : raw;
}

function getLocationParts(data) {
    const ubicacion = String(data?.ubicacion || '').trim();
    const parts = ubicacion.split(',').map((part) => part.trim()).filter(Boolean);
    const city = data?.city || parts[0] || '-';
    const country = data?.country || parts[parts.length - 1] || '-';
    return {
        city,
        country,
        full: ubicacion || [city, country].filter((item) => item && item !== '-').join(', ') || '-'
    };
}

function normalizeTattooLocationRecord(record) {
    return {
        id: record?.id || null,
        period_type: record?.period_type === 'upcoming' ? 'upcoming' : 'current',
        studio_name: (record?.studio_name || '').trim(),
        city: (record?.city || '').trim(),
        agenda_status: record?.agenda_status === 'closed' ? 'closed' : 'open',
        start_date: record?.start_date || '',
        end_date: record?.end_date || '',
        sort_order: Number.isFinite(record?.sort_order) ? record.sort_order : 0
    };
}

function formatTattooRange(startDate, endDate) {
    if (!startDate || !endDate) return '-';
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';

    const startLabel = start.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).toUpperCase();
    const endLabel = end.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    return `${startLabel} - ${endLabel}`;
}

function getLegacyTattooLocations() {
    if (!artistData?.estudios || artistData.estudios === 'Sin estudio/Independiente') {
        return [];
    }

    return [{
        period_type: 'current',
        studio_name: artistData.estudios,
        city: artistData.city || '',
        agenda_status: 'open',
        start_date: '',
        end_date: '',
        sort_order: 0
    }];
}

function normalizeLocationQuery(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
}

function getGeocodeCacheKey(query) {
    return `${GEOCODE_CACHE_PREFIX}${encodeURIComponent(query)}`;
}

function readGeocodeCache(query, { allowExpired = false } = {}) {
    try {
        const raw = window.localStorage.getItem(getGeocodeCacheKey(query));
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
        if (!Number.isFinite(parsed.cachedAt)) return null;
        if (!allowExpired && Date.now() - parsed.cachedAt > GEOCODE_CACHE_TTL_MS) return null;

        return {
            lat: parsed.lat,
            lng: parsed.lng,
            displayName: String(parsed.displayName || query),
            placeId: String(parsed.placeId || '')
        };
    } catch {
        return null;
    }
}

function writeGeocodeCache(query, value) {
    try {
        window.localStorage.setItem(getGeocodeCacheKey(query), JSON.stringify({
            lat: value.lat,
            lng: value.lng,
            displayName: value.displayName || query,
            placeId: value.placeId || '',
            cachedAt: Date.now()
        }));
    } catch {
        // Ignore quota or privacy mode errors.
    }
}

function wait(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function hasGoogleGeocoderApi() {
    return Boolean(window.google?.maps?.Geocoder);
}

function ensureGoogleGeocoder() {
    if (!hasGoogleGeocoderApi()) return null;
    if (!googleGeocoder) {
        googleGeocoder = new window.google.maps.Geocoder();
    }
    return googleGeocoder;
}

function geocodeGoogleRequest(geocoder, query) {
    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            resolve({ results: [], status: 'TIMEOUT' });
        }, 7000);

        try {
            geocoder.geocode({ address: query }, (results, status) => {
                window.clearTimeout(timeoutId);
                resolve({ results, status });
            });
        } catch (error) {
            window.clearTimeout(timeoutId);
            reject(error);
        }
    });
}

async function geocodeWithGoogleMaps(query) {
    const geocoder = ensureGoogleGeocoder();
    if (!geocoder) {
        return { ok: false, status: 'GOOGLE_NOT_READY', result: null };
    }

    let overQueryRetries = 0;
    let unknownRetries = 0;

    while (true) {
        const { results, status } = await geocodeGoogleRequest(geocoder, query);

        if (status === 'OK' && Array.isArray(results) && results.length) {
            const first = results[0];
            const loc = first?.geometry?.location;
            const lat = typeof loc?.lat === 'function' ? Number(loc.lat()) : NaN;
            const lng = typeof loc?.lng === 'function' ? Number(loc.lng()) : NaN;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return {
                    ok: true,
                    status,
                    result: {
                        lat,
                        lng,
                        displayName: String(first.formatted_address || query),
                        placeId: String(first.place_id || '')
                    }
                };
            }
            return { ok: false, status: 'INVALID_GEOMETRY', result: null };
        }

        if (status === 'OVER_QUERY_LIMIT' && overQueryRetries < GEOCODE_OVER_QUERY_LIMIT_RETRIES) {
            const backoff = 400 * (2 ** overQueryRetries);
            overQueryRetries += 1;
            await wait(backoff);
            continue;
        }

        if (status === 'UNKNOWN_ERROR' && unknownRetries < GEOCODE_UNKNOWN_ERROR_RETRIES) {
            unknownRetries += 1;
            await wait(300);
            continue;
        }

        return { ok: false, status: String(status || 'UNKNOWN'), result: null };
    }
}

async function geocodeLocationQuery(query) {
    const normalizedQuery = normalizeLocationQuery(query);
    if (!normalizedQuery) return null;

    const fromCache = readGeocodeCache(normalizedQuery);
    if (fromCache) return fromCache;

    const inflight = geocodeInFlight.get(normalizedQuery);
    if (inflight) return inflight;

    const request = (async () => {
        const elapsedSinceLast = Date.now() - geocodeLastRequestAt;
        if (elapsedSinceLast < GEOCODE_MIN_INTERVAL_MS) {
            await wait(GEOCODE_MIN_INTERVAL_MS - elapsedSinceLast);
        }
        geocodeLastRequestAt = Date.now();

        const googleResult = await geocodeWithGoogleMaps(normalizedQuery);
        if (googleResult.ok && googleResult.result) {
            writeGeocodeCache(normalizedQuery, googleResult.result);
            return googleResult.result;
        }

        // Fallback definido: solo usar cache antigua si Google falla.
        const staleCache = readGeocodeCache(normalizedQuery, { allowExpired: true });
        if (staleCache) return staleCache;

        return null;
    })()
        .catch((error) => {
            console.warn('Geocoding failed:', normalizedQuery, error);
            return null;
        })
        .finally(() => {
            geocodeInFlight.delete(normalizedQuery);
        });

    geocodeInFlight.set(normalizedQuery, request);
    return request;
}

function buildMapPointQuery({ studio, city, country, fallback }) {
    const parts = [studio, city, country, fallback]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return normalizeLocationQuery(parts.join(', '));
}

function buildArtistMapCandidates() {
    if (!artistData) return [];

    const candidates = [];
    const primaryLocation = getLocationParts(artistData);
    const mainQuery = buildMapPointQuery({
        city: artistData.city,
        country: artistData.country,
        fallback: artistData.ubicacion || primaryLocation.full
    });

    if (mainQuery) {
        candidates.push({
            type: 'main',
            label: 'Ubicacion principal',
            query: mainQuery
        });
    }

    tattooLocations
        .filter((item) => item.period_type === 'current')
        .forEach((item) => {
            const query = buildMapPointQuery({
                studio: item.studio_name,
                city: item.city,
                country: artistData.country
            });
            if (!query) return;

            candidates.push({
                type: 'current',
                label: item.studio_name || item.city || 'Tatuando en',
                query
            });
        });

    tattooLocations
        .filter((item) => item.period_type === 'upcoming')
        .forEach((item) => {
            const query = buildMapPointQuery({
                studio: item.studio_name,
                city: item.city,
                country: artistData.country
            });
            if (!query) return;

            candidates.push({
                type: 'upcoming',
                label: item.studio_name || item.city || 'Proximamente en',
                query
            });
        });

    return candidates;
}

function typeToMapLabel(type) {
    if (type === 'main') return 'Principal';
    if (type === 'current') return 'Actual';
    return 'Próximamente';
}

function markerColorByType(type) {
    if (type === 'main') return '#e63a2e';
    if (type === 'current') return '#1e4ed8';
    return '#f2b705';
}

function isMobileArtistMapLayout() {
    return window.matchMedia(`(max-width: ${PROFILE_MOBILE_MENU_BREAKPOINT - 1}px)`).matches;
}

function getGoogleMapsUrlForPoint(point) {
    if (!point) return 'https://www.google.com/maps';
    const query = point.displayName || point.query || `${point.lat},${point.lng}`;
    const baseUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    if (point.placeId) {
        return `${baseUrl}&query_place_id=${encodeURIComponent(point.placeId)}`;
    }
    return baseUrl;
}

function setArtistMapInfoCard(point) {
    const mapEl = document.getElementById(ARTIST_MAP_CONTAINER_ID);
    if (!mapEl) return;

    let card = document.getElementById(ARTIST_MAP_INFO_CARD_ID);
    if (!card) {
        card = document.createElement('article');
        card.id = ARTIST_MAP_INFO_CARD_ID;
        card.className = 'artist-map-info-card';
        card.hidden = true;
        mapEl.appendChild(card);
    }

    if (isMobileArtistMapLayout()) {
        card.hidden = true;
        card.innerHTML = '';
        return;
    }

    if (!point) {
        card.hidden = true;
        card.innerHTML = '';
        return;
    }

    const mapsUrl = getGoogleMapsUrlForPoint(point);
    card.hidden = false;
    card.innerHTML = `
        <p class="artist-map-info-kicker">${escapeHtml(typeToMapLabel(point.type))}</p>
        <h4 class="artist-map-info-title">${escapeHtml(point.label || '-')}</h4>
        <p class="artist-map-info-address">${escapeHtml(point.displayName || point.query || '-')}</p>
        <p class="artist-map-info-coords">${escapeHtml(Number(point.lat).toFixed(4))}, ${escapeHtml(Number(point.lng).toFixed(4))}</p>
        <a class="artist-map-info-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
    `;
}

function getArtistMapPointPanelHtml(point) {
    if (!point) return '';
    const mapsUrl = getGoogleMapsUrlForPoint(point);
    return `
        <p class="artist-map-point-panel-kicker">${escapeHtml(typeToMapLabel(point.type))}</p>
        <h4 class="artist-map-point-panel-title">${escapeHtml(point.label || '-')}</h4>
        <p class="artist-map-point-panel-address">${escapeHtml(point.displayName || point.query || '-')}</p>
        <p class="artist-map-point-panel-coords">${escapeHtml(Number(point.lat).toFixed(4))}, ${escapeHtml(Number(point.lng).toFixed(4))}</p>
        <a class="artist-map-point-panel-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
    `;
}

function focusArtistMapPoint(point, { openGoogleMaps = false } = {}) {
    if (!point) return;

    if (artistMap && typeof artistMap.setFocus === 'function') {
        try {
            artistMap.setFocus({
                coords: [point.lat, point.lng],
                scale: 4.8,
                animate: true
            });
        } catch (error) {
            console.warn('Artist map focus failed:', error);
        }
    }

    setArtistMapInfoCard(point);

    if (openGoogleMaps) {
        const mapsUrl = getGoogleMapsUrlForPoint(point);
        window.setTimeout(() => {
            window.open(mapsUrl, '_blank', 'noopener,noreferrer');
        }, 140);
    }
}

function hasGoogleMapsApiKey() {
    return Boolean(window.CONFIG?.googleMaps?.apiKey);
}

function applyMarkerJitter(points) {
    const usage = new Map();
    return points.map((point) => {
        const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
        const seen = usage.get(key) || 0;
        usage.set(key, seen + 1);

        if (!seen) return point;

        const offsetStep = 0.12;
        const angle = (seen * 45) * (Math.PI / 180);
        return {
            ...point,
            lat: point.lat + Math.sin(angle) * offsetStep,
            lng: point.lng + Math.cos(angle) * offsetStep
        };
    });
}

function setArtistMapEmptyState(isEmpty, message = '') {
    const emptyEl = document.getElementById(ARTIST_MAP_EMPTY_ID);
    if (!emptyEl) return;

    emptyEl.hidden = !isEmpty;
    emptyEl.style.display = isEmpty ? '' : 'none';
    if (isEmpty && message) {
        emptyEl.textContent = message;
    }
}

function renderArtistMapPointsList(points) {
    const listEl = document.getElementById(ARTIST_MAP_POINTS_ID);
    if (!listEl) return;

    listEl.innerHTML = '';

    if (!points.length) {
        const emptyItem = document.createElement(listEl.tagName === 'UL' || listEl.tagName === 'OL' ? 'li' : 'p');
        emptyItem.className = 'artist-map-point-empty';
        emptyItem.textContent = 'No hay puntos geolocalizados disponibles.';
        listEl.appendChild(emptyItem);
        return;
    }

    const isMobile = isMobileArtistMapLayout();
    if (activeMapPointIndex >= points.length) {
        activeMapPointIndex = -1;
    }

    points.forEach((point, index) => {
        const item = document.createElement(listEl.tagName === 'UL' || listEl.tagName === 'OL' ? 'li' : 'p');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'artist-map-point-chip';
        button.dataset.mapPointIndex = String(index);
        button.dataset.pinType = point.type;
        button.style.setProperty('--pin-color', markerColorByType(point.type));
        button.textContent = `${typeToMapLabel(point.type)} · ${point.label}`;
        const isActive = activeMapPointIndex === index;
        if (isActive) {
            button.classList.add('is-active');
        }
        button.setAttribute('aria-expanded', String(Boolean(isMobile && isActive)));
        item.appendChild(button);

        if (isMobile && isActive) {
            const panel = document.createElement('div');
            panel.className = 'artist-map-point-panel';
            panel.innerHTML = getArtistMapPointPanelHtml(point);
            item.appendChild(panel);
        }

        listEl.appendChild(item);
    });
}

function ensureArtistMapInstance(mapElement, markers = []) {
    if (!window.jsVectorMap || !mapElement) return null;

    if (artistMap) return artistMap;

    try {
        artistMap = new window.jsVectorMap({
            selector: `#${ARTIST_MAP_CONTAINER_ID}`,
            map: 'world',
            backgroundColor: 'transparent',
            zoomOnScroll: true,
            zoomButtons: true,
            draggable: true,
            minZoom: 1,
            maxZoom: 8,
            markers,
            regionStyle: {
                initial: {
                    fill: '#f4f4f2',
                    stroke: 'rgba(18, 18, 18, 0.18)',
                    strokeWidth: 0.55
                },
                hover: {
                    fill: '#efede8'
                }
            },
            onMarkerTooltipShow: (_event, tooltip, index) => {
                const point = artistMapPoints[Number(index)];
                if (!point || !tooltip) return;
                const label = `${typeToMapLabel(point.type)} · ${point.label}`;
                const mapsUrl = getGoogleMapsUrlForPoint(point);
                tooltip.text(`
                    <strong>${escapeHtml(label)}</strong><br>
                    ${escapeHtml(point.displayName || point.query || '')}<br>
                    <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
                `, true);
                setArtistMapInfoCard(point);
            },
            onMarkerClick: (_event, index) => {
                const point = artistMapPoints[Number(index)];
                if (!point) return;
                activeMapPointIndex = Number(index);
                renderArtistMapPointsList(artistMapPoints);
                focusArtistMapPoint(point, { openGoogleMaps: !isMobileArtistMapLayout() });
            }
        });
        mapElement.classList.add('is-initialized');
        if (mapElement.dataset.infoCardBound !== 'true') {
            mapElement.addEventListener('mouseleave', () => {
                setArtistMapInfoCard(null);
            });
            mapElement.dataset.infoCardBound = 'true';
        }
    } catch (error) {
        console.error('Artist map initialization failed:', error);
        artistMap = null;
    }

    return artistMap;
}

async function renderArtistDynamicMap() {
    const renderToken = ++artistMapRenderToken;
    const mapElement = document.getElementById(ARTIST_MAP_CONTAINER_ID);
    const hasMapUi = Boolean(mapElement || document.getElementById(ARTIST_MAP_EMPTY_ID) || document.getElementById(ARTIST_MAP_POINTS_ID));
    if (!hasMapUi) return;

    try {
        const candidates = buildArtistMapCandidates();
        if (!candidates.length) {
            if (renderToken !== artistMapRenderToken) return;
            renderArtistMapPointsList([]);
            setArtistMapInfoCard(null);
            setArtistMapEmptyState(true, 'Sin ubicaciones geocodificables.');
            return;
        }

        const resolved = [];
        for (const candidate of candidates) {
            if (renderToken !== artistMapRenderToken) return;

            const geocoded = await geocodeLocationQuery(candidate.query);
            if (renderToken !== artistMapRenderToken) return;
            if (!geocoded) continue;

            resolved.push({
                ...candidate,
                lat: geocoded.lat,
                lng: geocoded.lng,
                displayName: geocoded.displayName,
                placeId: geocoded.placeId || ''
            });
        }

        if (renderToken !== artistMapRenderToken) return;

        if (!resolved.length) {
            renderArtistMapPointsList([]);
            setArtistMapInfoCard(null);
            if (!hasGoogleMapsApiKey()) {
                setArtistMapEmptyState(true, 'Google Maps no configurado para geocodificar ubicaciones.');
            } else if (!hasGoogleGeocoderApi()) {
                setArtistMapEmptyState(true, 'Cargando Google Maps para geocodificar ubicaciones...');
            } else {
                setArtistMapEmptyState(true, 'No pudimos geocodificar ubicaciones para el mapa.');
            }

            artistMapPoints = [];
            if (artistMap && typeof artistMap.removeMarkers === 'function') {
                try {
                    artistMap.removeMarkers();
                } catch (error) {
                    console.warn('Artist map marker reset failed:', error);
                }
            }
            return;
        }

        if (!window.jsVectorMap || !mapElement) {
            setArtistMapEmptyState(true, 'Mapa no disponible en este navegador.');
            artistMapPoints = [];
            setArtistMapInfoCard(null);
            return;
        }

        const jitteredPoints = applyMarkerJitter(resolved);
        if (activeMapPointIndex >= jitteredPoints.length) {
            activeMapPointIndex = -1;
        }
        renderArtistMapPointsList(jitteredPoints);
        const markers = jitteredPoints.map((point) => ({
            coords: [point.lat, point.lng],
            name: `${typeToMapLabel(point.type)} · ${point.label}`,
            style: {
                initial: {
                    fill: markerColorByType(point.type),
                    stroke: '#111111',
                    strokeWidth: 1.1,
                    r: 5
                },
                hover: {
                    fill: '#111111',
                    stroke: '#ffffff',
                    strokeWidth: 1.5
                }
            }
        }));

        artistMapPoints = jitteredPoints;
        if (!isMobileArtistMapLayout()) {
            if (activeMapPointIndex < 0 && jitteredPoints.length) {
                activeMapPointIndex = 0;
            }
            setArtistMapInfoCard(jitteredPoints[activeMapPointIndex] || jitteredPoints[0] || null);
        } else {
            setArtistMapInfoCard(null);
        }

        const mapWasCreated = !artistMap;
        const map = ensureArtistMapInstance(mapElement, markers);
        if (!map) {
            setArtistMapEmptyState(true, 'No fue posible inicializar el mapa.');
            artistMapPoints = [];
            return;
        }

        if (!mapWasCreated && typeof map.removeMarkers === 'function') {
            try {
                map.removeMarkers();
            } catch (error) {
                console.warn('Artist map marker cleanup failed:', error);
            }
        }

        if (!mapWasCreated && typeof map.addMarkers === 'function') {
            try {
                map.addMarkers(markers);
            } catch (error) {
                console.error('Artist map marker render failed:', error);
                artistMapPoints = [];
                setArtistMapEmptyState(true, 'No fue posible actualizar los pines del mapa.');
                return;
            }
        } else if (!mapWasCreated) {
            console.error('Artist map marker API not available on jsVectorMap 1.7.0.');
            artistMapPoints = [];
            setArtistMapEmptyState(true, 'No fue posible actualizar los pines del mapa.');
            return;
        }

        setArtistMapEmptyState(false);
    } catch (error) {
        console.error('Artist map render failed:', error);
        if (renderToken !== artistMapRenderToken) return;
        artistMapPoints = [];
        setArtistMapInfoCard(null);
        setArtistMapEmptyState(true, 'No fue posible cargar el mapa.');
    }
}

function getPortfolioLabel(value) {
    const url = normalizeExternalUrl(value);
    if (!url) return '-';
    try {
        return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
        return value;
    }
}

function setQuoteLinks() {
    const quotationUrl = getQuotationUrl();
    const topLink = document.getElementById('quote-cta-top-btn');
    const bottomLink = document.getElementById('quote-cta-bottom-btn');
    const headerLink = document.getElementById('profile-header-quote-link');
    const mobileLink = document.getElementById('profile-mobile-quote-link');

    if (topLink) topLink.href = quotationUrl;
    if (bottomLink) bottomLink.href = quotationUrl;
    if (headerLink) headerLink.href = quotationUrl;
    if (mobileLink) mobileLink.href = quotationUrl;
}

function initArtistProfileGoogleMaps() {
    try {
        ensureGoogleGeocoder();
        if (artistData) {
            void renderArtistDynamicMap();
        }
    } catch (error) {
        console.warn('Artist profile Google Maps bootstrap failed:', error);
    }
}

window.initArtistProfileGoogleMaps = initArtistProfileGoogleMaps;

document.addEventListener('DOMContentLoaded', () => {
    if (hasGoogleGeocoderApi()) {
        initArtistProfileGoogleMaps();
    }
    initializeProfile();
    setupEventListeners();
});

async function initializeProfile() {
    showLoading();
    let artistUsername = '';

    try {
        const urlParams = new URLSearchParams(window.location.search);
        artistUsername = urlParams.get('artist') || '';

        if (!artistUsername) {
            showError('not_found');
            return;
        }

        await loadArtistData(artistUsername);
    } catch (error) {
        console.error('Profile initialization error:', error);
        showError('technical', { requestedArtist: artistUsername });
    }
}

async function loadArtistData(username) {
    const searchUsername = normalizeUsernameFromUrl(username);

    if (!_supabase) {
        console.error('Supabase client is not available for artist profile.');
        showError('technical', { requestedArtist: searchUsername });
        return;
    }

    try {
        const { data: artist, error } = await WeotziData.Artists.getPublicByExactUsername(searchUsername, ARTIST_PUBLIC_FIELDS);

        if (error) {
            console.error('Error loading artist data:', error);
            showError('technical', { requestedArtist: searchUsername });
            return;
        }

        if (!artist) {
            showError('not_found', { requestedArtist: searchUsername });
            return;
        }

        artistData = artist;
        tattooLocations = await loadArtistTattooLocations(artist.user_id);
        populateProfile();
        hideLoading();
        showContent();
        renderArtistReviews();
        void renderArtistDynamicMap();

        // Track this profile visit (fire-and-forget, throttled client-side to 1h)
        trackProfileVisit(artist.username).catch(() => { /* noop */ });
    } catch (error) {
        console.error('Error loading artist data:', error);
        showError('technical', { requestedArtist: searchUsername });
    }
}

/**
 * Fire-and-forget tracking of a profile visit.
 * Throttled client-side: one ping per (visitor device × artist username) per hour
 * via localStorage. Server also dedupes by ip_hash to cover cross-device cases.
 */
async function trackProfileVisit(username) {
    if (!username) return;
    try {
        const key = `wo_pv_${String(username).toLowerCase()}`;
        const last = Number(localStorage.getItem(key) || 0);
        if (Date.now() - last < 60 * 60 * 1000) return; // 1h throttle
        localStorage.setItem(key, String(Date.now()));

        let isAuthenticated = false;
        try {
            if (_supabase?.auth?.getSession) {
                const { data } = await _supabase.auth.getSession();
                isAuthenticated = !!data?.session;
            }
        } catch (_) { /* unauth — ignore */ }

        const fp = (window.__loggingService?.getFingerprint?.())
            || window.__deviceFingerprint
            || null;

        await fetch('/api/artist/profile-visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artist_username: username,
                device_fingerprint: fp,
                user_agent: navigator.userAgent,
                is_authenticated: isAuthenticated,
                referrer: document.referrer || null
            }),
            keepalive: true
        });
    } catch (_) { /* silent */ }
}

async function loadArtistTattooLocations(artistUserId) {
    if (!artistUserId) return getLegacyTattooLocations();

    try {
        const { data, error } = await WeotziData.ArtistLocations.listByArtistUserId(artistUserId, 'id, period_type, studio_name, city, agenda_status, start_date, end_date, sort_order');

        if (error) {
            console.error('Error loading tattoo locations:', error);
            return getLegacyTattooLocations();
        }

        const list = Array.isArray(data) ? data.map(normalizeTattooLocationRecord) : [];
        if (!list.length) return getLegacyTattooLocations();

        return list.sort((a, b) => {
            const aRank = a.period_type === 'current' ? 0 : 1;
            const bRank = b.period_type === 'current' ? 0 : 1;
            if (aRank !== bRank) return aRank - bRank;
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            return String(a.start_date || '').localeCompare(String(b.start_date || ''));
        });
    } catch (error) {
        console.error('Error loading tattoo locations:', error);
        return getLegacyTattooLocations();
    }
}

function populateProfile() {
    if (!artistData) return;

    const artisticName = artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista';
    const styles = parseStylesArray(artistData.styles_array);
    const location = getLocationParts(artistData);
    const verification = getVerificationMeta(artistData.verification_state || 'No');
    const workType = resolveWorkType(artistData);
    const portfolioUrl = normalizeExternalUrl(artistData.portafolio);
    const instagramUrl = getInstagramProfileUrl(artistData.instagram);
    const whatsappUrl = getWhatsappQuoteUrl();
    const languages = Array.isArray(artistData.languages) ? artistData.languages.filter(Boolean) : [];
    const primaryCurrentLocation = tattooLocations.find((item) => item.period_type === 'current') || null;

    document.title = `${artisticName} | We Otzi`;
    document.getElementById('og-title').content = `${artisticName} - Tatuador en We Otzi`;

    const ogBio = window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(artistData.bio_description)
        : (artistData.bio_description || '');
    document.getElementById('og-description').content = ogBio || 'Conoce el trabajo de este artista tatuador';

    if (artistData.profile_picture) {
        document.getElementById('og-image').content = artistData.profile_picture;
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = artistData.profile_picture;
        avatarImg.classList.add('loaded');
    }

    setText('artist-name', artisticName);
    setText('artist-username', `@${artistData.username || 'usuario.wo'}`);

    const verifiedIcon = document.getElementById('artist-verified-icon');
    if (verifiedIcon) {
        verifiedIcon.hidden = artistData.verification_state !== 'Yes';
    }

    const level = artistData.nivel || 'Nuevo';
    setText('avatar-level-chip', level);

    const embajadorLabel = getEmbajadorLabel(artistData.embajador);
    const embajadorIcon = document.getElementById('avatar-embajador-icon');
    if (embajadorIcon) {
        embajadorIcon.hidden = embajadorLabel !== 'Si';
    }

    setText('display-city', location.city);
    setText('display-country', location.country);
    setText('display-city-detail', location.city);
    setText('display-country-detail', location.country);
    setText('display-location-detail', location.full);
    setLocationLink(location.full);

    renderStyles(styles);
    setText('stat-styles', styles.length ? String(styles.length) : '-');
    setText('display-experience', formatExperience(artistData.years_experience));
    setText('display-price', artistData.session_price || 'Consultar');

    const bioTextEl = document.getElementById('bio-text');
    if (window.BioFormatting) {
        window.BioFormatting.renderBioHtml(bioTextEl, artistData.bio_description);
    } else {
        bioTextEl.textContent = artistData.bio_description || 'Este artista todavia no agrego una descripcion.';
    }

    setText('display-artistic-name', artisticName);
    setText('display-full-name', artistData.name || '-');
    setText('display-username', `@${artistData.username || '-'}`);
    setText('display-level', level);
    setText('display-verification', verification.label);
    setText('display-embajador', embajadorLabel);
    setText('display-work-type', workType.label);
    setText('display-studio', primaryCurrentLocation?.studio_name || artistData.estudios || '-');
    setText('display-languages', languages.length ? languages.join(', ') : '-');

    setLink('display-instagram-link', instagramUrl, artistData.instagram || '-');
    setLink('display-portfolio-link', portfolioUrl, getPortfolioLabel(artistData.portafolio));
    setLink('display-whatsapp-link', whatsappUrl, 'Cotizar por WhatsApp');

    setupActionButtons({ instagramUrl, portfolioUrl, whatsappUrl });
    renderTattooPresence();
    renderGallery();
    setQuoteLinks();
}

function renderArtistReviews() {
    if (!artistData?.user_id || !window.WeOtziReviews) return;
    window.WeOtziReviews.renderPublicReviews({
        mount: 'artist-reviews',
        revieweeType: 'artist',
        revieweeId: artistData.user_id,
        title: 'Resenas del artista'
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || '-';
}

function setLocationLink(value) {
    const locationLink = document.getElementById('display-location-link');
    const textEl = document.getElementById('display-location');
    if (!locationLink || !textEl) return;

    textEl.textContent = value || '-';
    if (value && value !== '-') {
        locationLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
        locationLink.classList.remove('is-empty');
    } else {
        locationLink.removeAttribute('href');
        locationLink.classList.add('is-empty');
    }
}

function setLink(id, href, label) {
    const anchor = document.getElementById(id);
    if (!anchor) return;

    const strong = anchor.querySelector('strong');
    if (strong) strong.textContent = label || '-';

    if (href) {
        anchor.href = href;
        anchor.classList.remove('is-empty');
    } else {
        anchor.removeAttribute('href');
        anchor.classList.add('is-empty');
    }
}

function renderStyles(styles) {
    const stylesContainer = document.getElementById('display-styles');
    stylesContainer.innerHTML = '';

    if (!styles.length) {
        stylesContainer.textContent = 'Sin estilos cargados';
        return;
    }

    for (const styleName of styles) {
        const tag = document.createElement('span');
        tag.className = 'style-tag';
        tag.textContent = styleName;
        stylesContainer.appendChild(tag);
    }
}

function renderTattooPresence() {
    const currentLocations = tattooLocations.filter((item) => item.period_type === 'current');
    const upcomingLocations = tattooLocations.filter((item) => item.period_type === 'upcoming');

    renderTattooPresenceGroup('current-tattoo-locations', currentLocations, false);
    renderTattooPresenceGroup('upcoming-tattoo-locations', upcomingLocations, true);
}

function renderTattooPresenceGroup(containerId, locations, isUpcoming) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!locations.length) {
        container.innerHTML = `<p class="tattoo-presence-empty">${isUpcoming ? 'No hay destinos proximos cargados.' : 'No hay estudios actuales cargados.'}</p>`;
        return;
    }

    const quoteFormUrl = getQuotationFormUrl();

    container.innerHTML = locations.map((location) => {
        const cityLine = location.city
            ? `<div class="tattoo-presence-line"><span class="presence-meta-label">Ciudad</span><span class="tattoo-presence-value">${escapeHtml(location.city)}</span></div>`
            : '';
        const dateLine = isUpcoming
            ? `<div class="tattoo-presence-line"><span class="presence-meta-label">Fecha</span><span class="tattoo-presence-value">${escapeHtml(formatTattooRange(location.start_date, location.end_date))}</span></div>`
            : '';
        const isAgendaOpen = location.agenda_status === 'open';
        const agendaBadge = isAgendaOpen
            ? `<a href="${escapeHtml(quoteFormUrl)}" class="tattoo-presence-badge tattoo-presence-badge-link" data-state="open">Agenda abierta</a>`
            : `<span class="tattoo-presence-badge" data-state="${escapeHtml(location.agenda_status)}">${escapeHtml(AGENDA_STATUS_LABELS[location.agenda_status] || AGENDA_STATUS_LABELS.open)}</span>`;

        return `
            <article class="tattoo-presence-item">
                <div class="tattoo-presence-head">
                    <h4 class="tattoo-presence-title">${escapeHtml(location.studio_name || '-')}</h4>
                    ${agendaBadge}
                </div>
                <div class="tattoo-presence-meta">
                    ${cityLine}
                    ${dateLine}
                </div>
            </article>
        `;
    }).join('');
}

function renderGallery() {
    galleryItems = Array.isArray(artistData?.gallery_images)
        ? artistData.gallery_images.filter(Boolean)
        : [];

    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');
    const viewAllBtn = document.getElementById('gallery-view-all-btn');
    const hasGallery = galleryItems.length > 0;

    galleryEmpty.style.display = hasGallery ? 'none' : 'block';

    const slotCount = galleryExpanded
        ? Math.max(INITIAL_GALLERY_SLOTS, Math.ceil(galleryItems.length / 3) * 3)
        : INITIAL_GALLERY_SLOTS;

    const itemsToRender = galleryExpanded
        ? galleryItems.slice(0, slotCount)
        : galleryItems.slice(0, INITIAL_GALLERY_SLOTS);

    let html = '';
    for (let index = 0; index < slotCount; index += 1) {
        const url = itemsToRender[index];
        if (url) {
            const isVideo = isUrlVideo(url);
            html += `
                <button type="button" class="gallery-image-item" data-gallery-index="${index}" aria-label="Abrir trabajo ${index + 1}">
                    ${isVideo
                        ? `<video src="${escapeHtml(url)}" preload="metadata" muted playsinline></video><span class="gallery-play-overlay">&#9654;</span>`
                        : `<img src="${escapeHtml(url)}" alt="Trabajo ${index + 1}" loading="lazy" width="1200" height="1200">`}
                    <span class="gallery-overlay"><span>Ver</span><span>${String(index + 1).padStart(2, '0')}</span></span>
                </button>
            `;
        } else {
            html += `
                <div class="gallery-image-item is-placeholder" aria-hidden="true">
                    <img src="${GALLERY_PLACEHOLDER_SRC}" alt="Slot disponible" loading="lazy" width="1200" height="1200">
                    <span class="gallery-placeholder-meta"><span>Disponible</span><span>Slot libre</span></span>
                </div>
            `;
        }
    }

    galleryGrid.innerHTML = html;

    if (galleryItems.length > 0) {
        viewAllBtn.style.display = 'inline-flex';
        viewAllBtn.textContent = 'Abrir galeria completa';
    } else {
        viewAllBtn.style.display = 'none';
    }
}

function setupActionButtons({ instagramUrl, portfolioUrl, whatsappUrl }) {
    setActionLink(document.getElementById('whatsapp-quote-btn'), whatsappUrl, true);
    setActionLink(document.getElementById('instagram-link'), instagramUrl, Boolean(instagramUrl));
    setActionLink(document.getElementById('portfolio-action-link'), portfolioUrl, Boolean(portfolioUrl));
    setActionLink(document.getElementById('gallery-cta-btn'), getGalleryFeedUrl(), true);
    setActionLink(document.getElementById('gallery-feed-action-link'), getGalleryFeedUrl(), true);
}

function setActionLink(anchor, href, enabled) {
    if (!anchor) return;

    if (enabled) {
        anchor.href = href;
        anchor.classList.remove('is-disabled');
        anchor.setAttribute('aria-disabled', 'false');
    } else {
        anchor.href = '#';
        anchor.classList.add('is-disabled');
        anchor.setAttribute('aria-disabled', 'true');
    }
}

function supportsProfileErrorSceneParallax() {
    return Boolean(
        window.matchMedia
        && window.matchMedia('(pointer: fine)').matches
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

function applyProfileErrorSceneParallax() {
    errorSceneParallaxRaf = 0;

    if (!errorSceneMotionShapes.length) return;

    let isMoving = false;

    for (const shape of errorSceneMotionShapes) {
        shape.currentX += (shape.targetX - shape.currentX) * 0.16;
        shape.currentY += (shape.targetY - shape.currentY) * 0.16;
        shape.currentRotate += (shape.targetRotate - shape.currentRotate) * 0.16;

        shape.el.style.setProperty('--hover-x', `${shape.currentX.toFixed(2)}px`);
        shape.el.style.setProperty('--hover-y', `${shape.currentY.toFixed(2)}px`);
        shape.el.style.setProperty('--hover-r', `${shape.currentRotate.toFixed(2)}deg`);

        if (
            Math.abs(shape.targetX - shape.currentX) > 0.08
            || Math.abs(shape.targetY - shape.currentY) > 0.08
            || Math.abs(shape.targetRotate - shape.currentRotate) > 0.05
        ) {
            isMoving = true;
        }
    }

    if (isMoving) {
        errorSceneParallaxRaf = window.requestAnimationFrame(applyProfileErrorSceneParallax);
    }
}

function scheduleProfileErrorSceneParallax() {
    if (errorSceneParallaxRaf) return;
    errorSceneParallaxRaf = window.requestAnimationFrame(applyProfileErrorSceneParallax);
}

function resetProfileErrorSceneParallax(immediate = false) {
    for (const shape of errorSceneMotionShapes) {
        shape.targetX = 0;
        shape.targetY = 0;
        shape.targetRotate = 0;
    }

    if (immediate) {
        for (const shape of errorSceneMotionShapes) {
            shape.currentX = 0;
            shape.currentY = 0;
            shape.currentRotate = 0;
            shape.el.style.setProperty('--hover-x', '0px');
            shape.el.style.setProperty('--hover-y', '0px');
            shape.el.style.setProperty('--hover-r', '0deg');
        }
        if (errorSceneParallaxRaf) {
            window.cancelAnimationFrame(errorSceneParallaxRaf);
            errorSceneParallaxRaf = 0;
        }
        return;
    }

    scheduleProfileErrorSceneParallax();
}

function setupProfileErrorSceneInteractivity() {
    const errorEl = document.getElementById('profile-error');
    const sceneEl = document.querySelector('.profile-error__scene');
    if (!errorEl || !sceneEl) return;
    if (errorEl.dataset.sceneBound === 'true') return;

    errorSceneParallaxEl = sceneEl;
    errorSceneMotionShapes = Array.from(sceneEl.querySelectorAll('[data-shape]')).map((el) => {
        const config = ERROR_SCENE_SHAPE_CONFIG[el.dataset.shape] || { moveX: 4, moveY: 4, rotate: 0.4 };
        return {
            el,
            config,
            currentX: 0,
            currentY: 0,
            currentRotate: 0,
            targetX: 0,
            targetY: 0,
            targetRotate: 0
        };
    });

    if (supportsProfileErrorSceneParallax()) {
        sceneEl.addEventListener('pointermove', (event) => {
            const rect = sceneEl.getBoundingClientRect();
            if (!rect.width || !rect.height) return;

            const relativeX = (((event.clientX - rect.left) / rect.width) - 0.5) * 2;
            const relativeY = (((event.clientY - rect.top) / rect.height) - 0.5) * 2;

            for (const shape of errorSceneMotionShapes) {
                shape.targetX = relativeX * shape.config.moveX;
                shape.targetY = relativeY * shape.config.moveY;
                shape.targetRotate = (relativeX + (relativeY * 0.28)) * shape.config.rotate;
            }

            scheduleProfileErrorSceneParallax();
        });

        sceneEl.addEventListener('pointerleave', () => {
            resetProfileErrorSceneParallax();
        });
    }

    errorEl.dataset.sceneBound = 'true';
}

function setupEventListeners() {
    setupProfileNavigationMenu();
    setupProfileErrorSceneInteractivity();

    document.getElementById('share-profile-btn')?.addEventListener('click', shareProfile);
    document.getElementById(ARTIST_MAP_POINTS_ID)?.addEventListener('click', handleMapPointChipActivation);
    document.getElementById('gallery-view-all-btn')?.addEventListener('click', () => {
        window.location.href = getGalleryFeedUrl();
    });

    document.getElementById('gallery-grid')?.addEventListener('click', handleGalleryActivation);

    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev')?.addEventListener('click', () => navigateLightbox(-1));
    document.getElementById('lightbox-next')?.addEventListener('click', () => navigateLightbox(1));
    document.getElementById('gallery-lightbox')?.addEventListener('click', (event) => {
        if (event.target.id === 'gallery-lightbox') closeLightbox();
    });

    document.addEventListener('keydown', (event) => {
        const lightbox = document.getElementById('gallery-lightbox');
        if (!lightbox?.classList.contains('active')) return;

        if (event.key === 'Escape') closeLightbox();
        if (event.key === 'ArrowLeft') navigateLightbox(-1);
        if (event.key === 'ArrowRight') navigateLightbox(1);
    });

    window.addEventListener('resize', () => {
        if (!artistMapPoints.length) return;
        renderArtistMapPointsList(artistMapPoints);
        if (isMobileArtistMapLayout()) {
            setArtistMapInfoCard(null);
        } else if (activeMapPointIndex >= 0) {
            setArtistMapInfoCard(artistMapPoints[activeMapPointIndex] || null);
        }
    });
}

function setProfileMobileMenuOpen(isOpen) {
    const toggleBtn = document.getElementById('profile-mobile-menu-toggle');
    const menu = document.getElementById('profile-mobile-menu');
    if (!toggleBtn || !menu) return;

    const shouldOpen = Boolean(isOpen);
    menu.hidden = !shouldOpen;
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function setupProfileNavigationMenu() {
    const toggleBtn = document.getElementById('profile-mobile-menu-toggle');
    const menu = document.getElementById('profile-mobile-menu');
    if (!toggleBtn || !menu) return;
    if (toggleBtn.dataset.menuBound === 'true') return;

    setProfileMobileMenuOpen(false);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
        setProfileMobileMenuOpen(shouldOpen);
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            setProfileMobileMenuOpen(false);
        });
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        const clickInsideMenu = menu.contains(event.target);
        const clickOnToggle = toggleBtn.contains(event.target);
        if (!clickInsideMenu && !clickOnToggle) {
            setProfileMobileMenuOpen(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > PROFILE_MOBILE_MENU_BREAKPOINT) {
            setProfileMobileMenuOpen(false);
        }
    });

    toggleBtn.dataset.menuBound = 'true';
}

function handleGalleryActivation(event) {
    const item = event.target.closest('[data-gallery-index]');
    if (!item) return;
    const index = Number(item.dataset.galleryIndex);
    if (!Number.isInteger(index) || !galleryItems[index]) return;
    openLightbox(index);
}

function handleMapPointChipActivation(event) {
    const button = event.target.closest('[data-map-point-index]');
    if (!button) return;

    const index = Number(button.dataset.mapPointIndex);
    if (!Number.isInteger(index)) return;

    const point = artistMapPoints[index];
    if (!point) return;

    if (isMobileArtistMapLayout()) {
        activeMapPointIndex = activeMapPointIndex === index ? -1 : index;
        renderArtistMapPointsList(artistMapPoints);
    } else {
        activeMapPointIndex = index;
        renderArtistMapPointsList(artistMapPoints);
    }

    focusArtistMapPoint(point, { openGoogleMaps: false });
}

function openLightbox(index) {
    if (!galleryItems.length) return;
    currentLightboxIndex = index;
    updateLightboxImage();
    const lightbox = document.getElementById('gallery-lightbox');
    lightbox.classList.add('active');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    const video = document.getElementById('lightbox-video');

    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    lightbox.classList.remove('active');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function navigateLightbox(direction) {
    const video = document.getElementById('lightbox-video');
    if (video) video.pause();

    currentLightboxIndex += direction;
    if (currentLightboxIndex < 0) {
        currentLightboxIndex = galleryItems.length - 1;
    } else if (currentLightboxIndex >= galleryItems.length) {
        currentLightboxIndex = 0;
    }

    updateLightboxImage();
}

function updateLightboxImage() {
    const image = document.getElementById('lightbox-image');
    const video = document.getElementById('lightbox-video');
    const counter = document.getElementById('lightbox-counter');
    const url = galleryItems[currentLightboxIndex];
    const isVideo = isUrlVideo(url);

    if (isVideo) {
        image.style.display = 'none';
        image.src = '';
        video.style.display = 'block';
        video.src = url;
        video.load();
    } else {
        video.pause();
        video.style.display = 'none';
        video.removeAttribute('src');
        video.load();
        image.style.display = 'block';
        image.src = url;
    }

    counter.textContent = `${currentLightboxIndex + 1} / ${galleryItems.length}`;
}

async function shareProfile() {
    const shareBtn = document.getElementById('share-profile-btn');
    const username = artistData?.username || 'artista';
    const profileUrl = window.location.href;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `${username} - We Otzi`,
                text: `Conoce el trabajo de ${username} como tatuador en We Otzi`,
                url: profileUrl
            });
            shareBtn?.classList.add('shared');
            setTimeout(() => shareBtn?.classList.remove('shared'), 2000);
            return;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.log('Share failed, falling back to clipboard');
            }
        }
    }

    try {
        await navigator.clipboard.writeText(profileUrl);
        shareBtn?.classList.add('shared');
        showStatusMessage('Enlace del perfil copiado al portapapeles.');
        setTimeout(() => shareBtn?.classList.remove('shared'), 2000);
    } catch (error) {
        console.error('Error sharing profile:', error);
        showStatusMessage('Error al compartir el perfil.');
    }
}

function showLoading() {
    resetProfileErrorState();
    document.getElementById('profile-loading').style.display = 'flex';
    document.getElementById('profile-error').style.display = 'none';
    document.getElementById('profile-content').style.display = 'none';
}

function hideLoading() {
    document.getElementById('profile-loading').style.display = 'none';
}

function resetProfileErrorState() {
    const errorEl = document.getElementById('profile-error');
    if (!errorEl) return;

    errorEl.classList.remove('is-active');
    errorEl.dataset.errorType = '';
    resetProfileErrorSceneParallax(true);
}

function updateProfileErrorContent(type = 'not_found', context = {}) {
    const content = PROFILE_ERROR_CONTENT[type] || PROFILE_ERROR_CONTENT.not_found;
    const eyebrowEl = document.getElementById('profile-error-eyebrow');
    const titleEl = document.getElementById('profile-error-title');
    const messageEl = document.getElementById('profile-error-message');
    const requestedEl = document.getElementById('profile-error-requested');

    if (eyebrowEl) eyebrowEl.textContent = content.eyebrow;
    if (titleEl) titleEl.textContent = content.title;
    if (messageEl) messageEl.textContent = content.message;

    if (requestedEl) {
        const requestedArtist = formatRequestedArtist(context.requestedArtist);
        if (requestedArtist) {
            requestedEl.hidden = false;
            requestedEl.textContent = type === 'technical'
                ? `Intentamos cargar ${requestedArtist}`
                : `No encontramos ${requestedArtist}`;
        } else {
            requestedEl.hidden = true;
            requestedEl.textContent = '';
        }
    }
}

function showError(type = 'not_found', context = {}) {
    const errorEl = document.getElementById('profile-error');
    if (!errorEl) return;

    updateProfileErrorContent(type, context);
    document.getElementById('profile-loading').style.display = 'none';
    document.getElementById('profile-content').style.display = 'none';
    errorEl.style.display = 'flex';
    errorEl.dataset.errorType = type;
    errorEl.classList.remove('is-active');
    void errorEl.offsetWidth;
    errorEl.classList.add('is-active');
}

function showContent() {
    resetProfileErrorState();
    document.getElementById('profile-error').style.display = 'none';
    document.getElementById('profile-content').style.display = 'grid';
}

function showStatusMessage(message) {
    const messageDiv = document.getElementById('status-message');
    if (!messageDiv) return;

    messageDiv.textContent = message;
    setTimeout(() => {
        messageDiv.textContent = '';
    }, 4000);
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
}
