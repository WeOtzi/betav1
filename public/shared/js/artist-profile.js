const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = window.supabase?.createClient
    ? (window._supabase = window._supabase || window.supabase.createClient(supabaseUrl, supabaseKey))
    : null;

// Columnas del perfil público. `studio_id` y `gallery_feed_items` alimentan las
// secciones Estudio y Portafolio del diseño; si un deploy viejo no las tiene, se
// reintenta con el set legacy (ver loadArtistData).
const ARTIST_PUBLIC_FIELDS_LEGACY = [
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
    'gallery_images',
    'verification_state',
    'languages',
    'instagram',
    'portafolio'
].join(',');

// `embajador` (ronda 2, P21): insignia pública de embajador ('si' la marca soporte).
const ARTIST_PUBLIC_FIELDS = `${ARTIST_PUBLIC_FIELDS_LEGACY},studio_id,gallery_feed_items,vacation_start,vacation_end,embajador`;

// Figma 801:1108: grilla de 3 columnas (4 filas en el frame). Nunca menos de 9
// celdas; con más obras se muestran todas (la galería aparte /artist/profile/gallery
// se retira, así que el perfil es el único lugar público del portafolio).
const MIN_GALLERY_SLOTS = 9;
const REVIEW_QUOTE_COUNT = 3;
const GALLERY_ALL_FILTER = 'todos';
// Tope de la primera oración de la bio para promoverla a titular-manifiesto.
const BIO_MANIFESTO_MAX_CHARS = 110;

const PROFILE_ERROR_CONTENT = {
    not_found: {
        eyebrow: 'Perfil público · No encontrado',
        title: 'Artista no encontrado, pero hay muchos más',
        message: 'Explorá más perfiles dentro del marketplace.'
    },
    technical: {
        eyebrow: 'Perfil público · Error de carga',
        title: 'No pudimos cargar este perfil',
        message: 'Podés intentarlo de nuevo o explorar otros artistas en el marketplace.'
    }
};

const ERROR_SCENE_SHAPE_CONFIG = {
    circle: { moveX: 6, moveY: 5, rotate: 1.1 },
    bar: { moveX: 8, moveY: 2.5, rotate: 0.55 },
    slab: { moveX: -5, moveY: 6, rotate: -0.7 },
    'line-a': { moveX: 4, moveY: -2.5, rotate: 0.3 },
    'line-b': { moveX: -3.5, moveY: 4, rotate: -0.28 }
};

// Estados de residencia del Figma. `waitlist` queda mapeado para cuando el CHECK
// de artist_tattoo_locations lo admita (hoy solo acepta open/closed).
const PRESENCE_BADGES = {
    open: { label: 'Agenda abierta', state: 'open' },
    waitlist: { label: 'Lista de espera', state: 'waitlist' },
    upcoming: { label: 'Próximamente', state: 'upcoming' },
    closed: { label: 'Agenda cerrada', state: 'closed' }
};

// Rotación cromática del DS para tablas/listas tipográficas (rojo · azul · ink).
const SPECIALTY_COLORS = ['var(--red-300)', 'var(--blue-300)', 'var(--yellow-300)', 'var(--ink)'];
const CITY_TONES = ['red', 'blue', 'ink'];
const REVIEW_AVATAR_COLORS = ['var(--ink)', 'var(--red-300)', 'var(--blue-400)'];
// Figma: triángulo de color rotando rojo → azul → amarillo por fila de residencia.
const PRESENCE_TONES = ['red', 'blue', 'yellow'];
const SPECIALTY_DESCRIPTIONS = {
    'fine-line': 'Trazo continuo de una sola aguja, ideal en zonas chicas y piezas delicadas.',
    blackwork: 'Negros sólidos y alto contraste, pensados para leerse a distancia.',
    botanico: 'Ilustración de plantas reales, con estudio previo de la especie.',
    minimalista: 'Piezas pequeñas, geométricas, sin relleno ni sombra.'
};

const GALLERY_CATEGORY_LABELS = {
    realizados: 'Realizados',
    flash: 'Flash',
    proyectos: 'Proyectos'
};

let artistData = null;
let studioData = null;
let tattooLocations = [];
let travelPresences = [];
let publicProfilePreferences = {
    privacy: { show_city: true, show_rating: true, show_socials: true, allow_search_indexing: false },
    profile: {},
    availability: {}
};
let publicProfileMetrics = {
    tattooCount: null,
    tattooCountLabel: '—',
    responseRate: null,
    responseRateLabel: '—',
    avgResponseMinutes: null,
    responseTimeLabel: '—'
};
let galleryItems = [];
// Estado de validación de Instagram del artista ({ enforced, verified, handle },
// ver gallery-visibility.js). null = sin helper o sin la clave del RPC: la
// galería se muestra completa, como antes de la validación.
let igValidationState = null;
let galleryFilter = GALLERY_ALL_FILTER;
let currentLightboxIndex = 0;
let reviewsWidgetMounted = false;
let portfolioAnalyticsObserver = null;
let errorSceneParallaxRaf = 0;
let errorSceneMotionShapes = [];
// Quién mira el perfil: 'owner' (el propio artista), 'artist' (otro artista),
// 'client' (sesión de cliente) o 'guest'. Decide la barra superior, la franja
// del dueño y los huecos de la galería.
let viewer = { kind: 'guest', session: null };
// Insignias públicas (RPC get_artist_public_badges): embajador y Most Wanted.
// null = sin la RPC (migración sin aplicar): el embajador sale de la columna.
let publicBadges = null;

function isUrlVideo(url) {
    const ext = String(url || '').split('?')[0].split('.').pop()?.toLowerCase();
    return ext === 'mp4' || ext === 'mov' || ext === 'webm' || ext === 'm4v';
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

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Auditoría PP-06: sin espacios ni @ iniciales, en minúsculas y con .wo
// (misma regla que el servidor, public/shared/js/artist-public-url.js).
function normalizeUsernameFromUrl(username) {
    if (window.WoArtistPublicUrl) return window.WoArtistPublicUrl.normalizeUsername(username);
    const raw = String(username || '').trim().replace(/^@+/, '').toLowerCase();
    if (!raw) return '';
    return raw.endsWith('.wo') ? raw : `${raw}.wo`;
}

function formatRequestedArtist(value) {
    const normalized = normalizeUsernameFromUrl(value);
    return normalized ? `@${normalized}` : '';
}

// Las dos CTA van directo al cotizador con el artista preseleccionado
// (/quotations solo redirigía a /quotation; auditoría PP-10).
function getQuotationUrl() {
    return getQuotationFormUrl();
}

function getQuotationFormUrl() {
    const username = artistData?.username || '';
    return `/quotation?artist=${encodeURIComponent(username)}`;
}

// `years_experience` viene como rango ("0-1", "5-10", "10+") o número suelto.
// El statstrip lo muestra crudo; la ficha lateral lo lee como "X años".
function formatExperienceStat(value) {
    return String(value || '').trim();
}

// Figma 344:1391: "8 años tatuando".
function formatExperienceFact(value) {
    if (window.ArtistProfilePresentation?.formatExperienceFact) {
        return window.ArtistProfilePresentation.formatExperienceFact(value);
    }
    const raw = formatExperienceStat(value);
    if (!raw) return '';
    return /años/i.test(raw) ? raw : `${raw} años tatuando`;
}

// Figma 344:1401: "$180 USD".
function formatSessionPriceFact(value) {
    if (window.ArtistProfilePresentation?.formatSessionPriceFact) {
        return window.ArtistProfilePresentation.formatSessionPriceFact(value);
    }
    return String(value || '').trim();
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

// "Sin ciudad" es el marcador de ciudad vacía que deja el alta de residencias.
function normalizeCityName(value) {
    const city = String(value || '').trim();
    return /^sin ciudad$/i.test(city) ? '' : city;
}

function normalizeTattooLocationRecord(record) {
    const agenda = String(record?.agenda_status || 'open').toLowerCase();
    return {
        id: record?.id || null,
        period_type: record?.period_type === 'upcoming' ? 'upcoming' : 'current',
        studio_name: (record?.studio_name || '').trim(),
        city: normalizeCityName(record?.city),
        country: String(record?.country || '').trim(),
        agenda_status: PRESENCE_BADGES[agenda] ? agenda : 'open',
        start_date: record?.start_date || '',
        end_date: record?.end_date || '',
        sort_order: Number.isFinite(record?.sort_order) ? record.sort_order : 0
    };
}

function toDate(value) {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortMonthLabel(date) {
    return date
        .toLocaleDateString('es-AR', { month: 'short' })
        .replace(/\./g, '')
        .toLowerCase();
}

// Figma: "12 – 18 oct" (mismo mes) · "28 sep – 4 oct" (meses distintos).
function formatResidencyRange(startDate, endDate) {
    const start = toDate(startDate);
    const end = toDate(endDate);
    if (!start || !end) return '';

    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${start.getDate()} – ${end.getDate()} ${shortMonthLabel(end)}`;
    }
    return `${start.getDate()} ${shortMonthLabel(start)} – ${end.getDate()} ${shortMonthLabel(end)}`;
}

function resolvePresenceBadge(location) {
    if (location.agenda_status === 'open') return PRESENCE_BADGES.open;
    if (location.agenda_status === 'waitlist') return PRESENCE_BADGES.waitlist;

    const start = toDate(location.start_date);
    if (start && start.getTime() > Date.now()) return PRESENCE_BADGES.upcoming;
    return PRESENCE_BADGES.closed;
}

function getLegacyTattooLocations() {
    return [];
}

document.addEventListener('DOMContentLoaded', () => {
    initializeProfile();
    setupEventListeners();
});

/**
 * Qué perfil se pidió (auditoría PP-02 / PP-04):
 *   ?artist=<usuario> (oficial) · ?u= / ?username= (enlaces viejos del cliente)
 *   ?id=<uuid> · la URL corta /<handle> (el servidor deja el usuario en el
 *   meta #profile-username; si no, se lee del path).
 */
function resolveRequestedArtist() {
    const PublicUrl = window.WoArtistPublicUrl;
    const params = new URLSearchParams(window.location.search);
    const fromSearch = PublicUrl
        ? PublicUrl.usernameFromSearch(window.location.search)
        : (params.get('artist') || params.get('u') || params.get('username') || '');
    if (fromSearch) return { username: fromSearch, alias: !params.get('artist') };

    const id = params.get('id') || '';
    if (id && (!PublicUrl || PublicUrl.isUuid(id))) return { userId: id, alias: true };

    const fromMeta = document.getElementById('profile-username')?.getAttribute('content') || '';
    if (fromMeta) return { username: fromMeta, shortUrl: true };

    if (PublicUrl) {
        const segments = window.location.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1] || '';
        const parsed = segments.length <= 2 ? PublicUrl.parsePathHandle(last) : null;
        if (parsed) return { username: parsed.username, shortUrl: true };
    }
    return null;
}

// Los alias (?u=, ?username=, ?id=) se reescriben a ?artist=<usuario> sin
// recargar, así el enlace que se copia de la barra es el oficial.
function canonicalizeLocation(ref) {
    if (!ref?.alias || !artistData?.username || !window.history?.replaceState) return;
    try {
        const url = new URL(window.location.href);
        ['u', 'username', 'id'].forEach((key) => url.searchParams.delete(key));
        url.searchParams.set('artist', artistData.username);
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (_) { /* la URL queda como llegó */ }
}

async function initializeProfile() {
    showLoading();
    let ref = null;

    try {
        ref = resolveRequestedArtist();

        if (!ref) {
            showError('not_found');
            return;
        }

        await loadArtistData(ref);
    } catch (error) {
        console.error('Profile initialization error:', error);
        showError('technical', { requestedArtist: ref?.username || '' });
    }
}

async function fetchPublicArtist(ref, columns) {
    if (ref.userId) {
        if (typeof WeotziData.Artists.getPublicByUserId !== 'function') return { data: null, error: null };
        return WeotziData.Artists.getPublicByUserId(ref.userId, columns);
    }
    return WeotziData.Artists.getPublicByExactUsername(normalizeUsernameFromUrl(ref.username), columns);
}

async function loadArtistData(refOrUsername) {
    const ref = typeof refOrUsername === 'string' ? { username: refOrUsername } : (refOrUsername || {});
    const searchUsername = ref.username ? normalizeUsernameFromUrl(ref.username) : '';

    if (!_supabase) {
        console.error('Supabase client is not available for artist profile.');
        showError('technical', { requestedArtist: searchUsername });
        return;
    }

    try {
        let { data: artist, error } = await fetchPublicArtist(ref, ARTIST_PUBLIC_FIELDS);

        // Deploys sin studio_id / gallery_feed_items: reintento con el set legacy.
        if (error) {
            const retry = await fetchPublicArtist(ref, ARTIST_PUBLIC_FIELDS_LEGACY);
            artist = retry.data;
            error = retry.error;
        }

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
        canonicalizeLocation(ref);
        [tattooLocations, travelPresences, studioData, publicProfilePreferences, publicProfileMetrics, viewer, publicBadges] = await Promise.all([
            loadArtistTattooLocations(artist.user_id),
            loadTravelPresences(artist.user_id),
            loadArtistStudio(artist.studio_id, artist.user_id),
            loadPublicProfilePreferences(artist.user_id),
            loadPublicProfileMetrics(artist.username || searchUsername),
            resolveViewer(artist.user_id),
            loadPublicBadges(artist.user_id)
        ]);
        // Barra, franja del dueño y botón compartir según quién mira (antes de
        // pintar: la galería y la bio dependen de si es el dueño).
        applyViewerChrome();
        // La galería se pinta recién en populateProfile, con el estado ya resuelto.
        igValidationState = resolveIgValidationState(publicProfilePreferences);
        populateProfile();
        hideLoading();
        showContent();
        scrollToRequestedSection();
        void renderArtistReviews().then(() => {
            applyProfileUrlState();
            scrollToRequestedSection({ afterReviews: true });
        });
        void loadStoreBand();
        watchViewerChanges();
        // El dueño deja su tarjeta Open Graph al día al ver su propio perfil.
        syncOwnShareCard(true);

        // Structured funnel telemetry (fire-and-forget, one event/hour).
        trackProfileEvent('profile_view').catch(() => { /* noop */ });
        setupPortfolioAnalytics();
    } catch (error) {
        console.error('Error loading artist data:', error);
        showError('technical', { requestedArtist: searchUsername });
    }
}

async function loadPublicProfileMetrics(username) {
    const fallback = {
        tattooCount: null,
        tattooCountLabel: '—',
        responseRate: null,
        responseRateLabel: '—',
        avgResponseMinutes: null,
        responseTimeLabel: '—'
    };
    try {
        const response = await fetch(`/api/artist/public-profile-metrics?artist=${encodeURIComponent(username)}`);
        if (!response.ok) return fallback;
        const payload = await response.json();
        if (!payload?.success || !payload.metrics || typeof payload.metrics !== 'object') return fallback;
        return { ...fallback, ...payload.metrics };
    } catch (error) {
        console.warn('Public profile metrics unavailable:', error);
        return fallback;
    }
}

async function loadPublicProfilePreferences(artistUserId) {
    const fallback = {
        privacy: { show_city: true, show_rating: true, show_socials: true, allow_search_indexing: false },
        profile: {},
        availability: {}
    };
    if (!artistUserId || !WeotziData?.ProfilePublic?.getPreferences) return fallback;
    try {
        // RPC security-definer `get_artist_public_profile_preferences` vía el repo del área.
        const data = await WeotziData.ProfilePublic.getPreferences(artistUserId);
        if (!data || typeof data !== 'object') return fallback;
        return {
            privacy: { ...fallback.privacy, ...(data.privacy || {}) },
            profile: data.profile && typeof data.profile === 'object' ? data.profile : {},
            availability: data.availability && typeof data.availability === 'object' ? data.availability : {},
            // Migración 20261030120000: { enforced, verified, handle }. Sin la
            // clave (migración no aplicada) queda null y no se filtra la galería.
            instagram_validation: data.instagram_validation && typeof data.instagram_validation === 'object'
                ? data.instagram_validation
                : null,
            // Migración 20261115110000: verification_state 'Yes' o documento de
            // identidad aprobado (la misma regla que el centro de la cuenta).
            verified: data.verified === true
        };
    } catch (error) {
        console.warn('Public profile preferences unavailable:', error);
        return fallback;
    }
}

// Insignias públicas del artista (ronda 2, P21). Sin el repo o sin la RPC queda
// null y el perfil se pinta igual, sin Most Wanted.
async function loadPublicBadges(artistUserId) {
    if (!artistUserId || typeof WeotziData?.ProfilePublic?.getBadges !== 'function') return null;
    try {
        return await WeotziData.ProfilePublic.getBadges(artistUserId);
    } catch (error) {
        console.warn('Public profile badges unavailable:', error);
        return null;
    }
}

// Fotos importadas de Instagram: ocultas al público hasta que el artista valida
// su cuenta (regla única en gallery-visibility.js, espejada en SQL).
function resolveIgValidationState(preferences) {
    const visibility = window.WoGalleryVisibility;
    const validation = preferences && preferences.instagram_validation;
    if (!visibility || typeof visibility.stateFrom !== 'function' || !validation) return null;
    return visibility.stateFrom(validation);
}

/**
 * Fire-and-forget tracking of a profile visit.
 * Throttled client-side: one ping per (visitor device × artist username) per hour
 * via localStorage. Server also dedupes by ip_hash to cover cross-device cases.
 */
async function trackProfileEvent(eventKind, detail = {}) {
    const username = artistData?.username;
    if (!username) return;
    try {
        const suffix = eventKind === 'artwork_view' ? `_${String(detail.artworkKey || '')}` : '';
        const key = `wo_pa_${String(username).toLowerCase()}_${eventKind}${suffix}`;
        const last = Number(localStorage.getItem(key) || 0);
        if (Date.now() - last < 60 * 60 * 1000) return; // 1h throttle
        localStorage.setItem(key, String(Date.now()));

        let session = null;
        try {
            if (_supabase?.auth?.getSession) {
                const { data } = await _supabase.auth.getSession();
                session = data?.session || null;
            }
        } catch (_) { /* unauth — ignore */ }

        const fp = (window.__loggingService?.getFingerprint?.())
            || window.__deviceFingerprint
            || null;

        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        await fetch('/api/artist/profile-event', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                artist_username: username,
                event_kind: eventKind,
                artwork_key: detail.artworkKey || null,
                artwork_title: detail.artworkTitle || null,
                device_fingerprint: fp,
                user_agent: navigator.userAgent,
                referrer: document.referrer || null
            }),
            keepalive: true
        });
    } catch (_) { /* silent */ }
}

function setupPortfolioAnalytics() {
    if (portfolioAnalyticsObserver) portfolioAnalyticsObserver.disconnect();
    const gallery = document.getElementById('block-gallery');
    if (!gallery || typeof IntersectionObserver !== 'function') return;
    portfolioAnalyticsObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.3)) return;
        portfolioAnalyticsObserver.disconnect();
        portfolioAnalyticsObserver = null;
        trackProfileEvent('portfolio_view').catch(() => { /* noop */ });
    }, { threshold: [0.3] });
    portfolioAnalyticsObserver.observe(gallery);
}

async function loadArtistTattooLocations(artistUserId) {
    if (!artistUserId || !WeotziData?.ProfilePublic?.listResidencies) return getLegacyTattooLocations();

    try {
        // Incluye `country` cuando la migración 20261028160000 está aplicada.
        const data = await WeotziData.ProfilePublic.listResidencies(artistUserId);
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

// Viajes confirmados de Travel (proyección pública): completan "Próximas
// residencias" con ciudad, país y fechas.
async function loadTravelPresences(artistUserId) {
    if (!artistUserId || !WeotziData?.ProfilePublic?.listTravelPresences) return [];
    return WeotziData.ProfilePublic.listTravelPresences(artistUserId);
}

// Estudio del artista + tamaño del roster (único dato de la fila del Figma con
// fuente real; AMBIENTE y ACCESOS no existen como columnas). El artista del
// perfil cuenta como residente aunque su vínculo sea solo `studio_id`.
// Sin foto: iniciales sobre fondo tinta, sin `<img src="">` (auditoría H4).
function renderAvatarInitials(artisticName) {
    const avatarImg = document.getElementById('avatar-image');
    if (avatarImg) {
        avatarImg.hidden = true;
        avatarImg.removeAttribute('src');
        avatarImg.classList.remove('loaded');
    }
    const placeholder = document.getElementById('avatar-placeholder');
    const initialsEl = document.getElementById('avatar-initials');
    if (!placeholder || !initialsEl) return;
    const initials = window.ArtistProfilePresentation?.artistInitials
        ? window.ArtistProfilePresentation.artistInitials(artisticName, artistData?.username)
        : String(artisticName || 'WO').slice(0, 2).toUpperCase();
    initialsEl.textContent = initials;
    initialsEl.setAttribute('aria-label', `Iniciales de ${artisticName}`);
    initialsEl.hidden = false;
    placeholder.querySelectorAll('[data-avatar-loading]').forEach((node) => { node.hidden = true; });
    placeholder.classList.add('has-initials');
}

// Estudio base: `artists_db.studio_id` y, si ese estudio no se puede leer
// (RLS, estudio dado de baja o el modo demo, que sirve `studios` desde
// fixtures), el de la primera membresía activa del artista (auditoría H4).
async function loadArtistStudio(studioId, artistUserId) {
    if (!WeotziData?.Studios?.getById) return null;

    // `*` y no una lista: así `location_verified` llega cuando la migración
    // 20261112120000_studio_claim_links está aplicada, sin romper la consulta
    // mientras la columna no exista (anon ya lee todas las columnas de `studios`).
    const fetchStudio = async (id) => {
        const { data, error } = await WeotziData.Studios.getById(id, '*');
        return !error && data ? data : null;
    };

    try {
        let studio = studioId ? await fetchStudio(studioId) : null;
        const listActive = WeotziData.StudioMemberships?.listActiveForArtist;
        if (!studio && artistUserId && typeof listActive === 'function') {
            let memberships = [];
            try {
                const result = await listActive.call(WeotziData.StudioMemberships, artistUserId);
                memberships = Array.isArray(result?.data) ? result.data : [];
            } catch (membershipError) {
                console.warn('Studio memberships unavailable:', membershipError);
            }
            const pick = window.ArtistProfilePresentation?.pickBaseStudioIds;
            const ids = pick ? pick(null, memberships) : memberships.map((m) => m?.studio_id).filter(Boolean);
            for (const id of ids.filter((value) => String(value) !== String(studioId || ''))) {
                studio = await fetchStudio(id);
                if (studio) break;
            }
        }
        if (!studio) return null;

        let roster = [];
        try {
            const result = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studio.id);
            roster = Array.isArray(result?.data) ? result.data : [];
        } catch (rosterError) {
            console.warn('Studio roster unavailable:', rosterError);
        }
        const rosterCount = window.ArtistProfilePresentation?.studioRosterCount
            ? window.ArtistProfilePresentation.studioRosterCount(roster, artistUserId)
            : Math.max(roster.length, artistUserId ? 1 : 0);

        return { ...studio, rosterCount };
    } catch (error) {
        console.warn('Studio lookup failed:', error);
        return null;
    }
}

function populateProfile() {
    if (!artistData) return;

    const privacy = publicProfilePreferences.privacy || {};
    const profileExtras = publicProfilePreferences.profile || {};
    const artisticName = artistData.name || profileExtras.full_name || (artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista');
    const styles = parseStylesArray(artistData.styles_array);
    const location = getLocationParts(artistData);

    // Los meta para compartir ya vienen escritos por el servidor
    // (lib/profile-meta.js); acá solo se sincronizan para la pestaña y por si
    // la página se sirvió sin pasar por él.
    const pageTitle = `${artisticName} · Tatuador en We Ötzi`;
    document.title = pageTitle;
    const ogBio = (window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(artistData.bio_description)
        : String(artistData.bio_description || '')).replace(/\s+/g, ' ').trim();
    const pageDescription = ogBio
        ? (ogBio.length > 160 ? `${ogBio.slice(0, 159).trim()}…` : ogBio)
        : `Mirá el portafolio de ${artisticName} y pedile una cotización en We Ötzi.`;
    setMetaContent(['og-title', 'twitter-title'], pageTitle);
    setMetaContent(['og-description', 'twitter-description', 'profile-description'], pageDescription);

    if (artistData.profile_picture) {
        // El servidor ya dejó la imagen para compartir (la tarjeta 1200×630 o la
        // foto): solo se completa si la página se sirvió sin pasar por él.
        const serverOgImage = document.getElementById('og-image')?.getAttribute('content') || '';
        if (!serverOgImage && /^https?:\/\//i.test(artistData.profile_picture)) setMetaContent(['og-image', 'twitter-image'], artistData.profile_picture);
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.hidden = false;
        avatarImg.addEventListener('error', () => renderAvatarInitials(artisticName), { once: true });
        avatarImg.src = artistData.profile_picture;
        avatarImg.classList.add('loaded');
    } else {
        renderAvatarInitials(artisticName);
    }

    setText('artist-name', artisticName);
    setText('artist-username', `@${artistData.username || 'usuario.wo'}`);
    setText('display-city', location.city);
    setText('display-country', location.country);

    const heroLocation = document.getElementById('hero-location');
    if (heroLocation) heroLocation.hidden = privacy.show_city === false;
    const robots = document.getElementById('profile-robots');
    if (robots) robots.content = privacy.allow_search_indexing === true ? 'index,follow' : 'noindex,nofollow';

    const heroBand = document.querySelector('.hero-band');
    const bannerUrl = safePublicHttpUrl(profileExtras.banner_url);
    if (heroBand) {
        heroBand.classList.toggle('has-profile-banner', !!bannerUrl);
        if (bannerUrl) heroBand.style.setProperty('--profile-banner-image', `url("${bannerUrl.replace(/"/g, '%22')}")`);
        else heroBand.style.removeProperty('--profile-banner-image');
    }

    // Sello "Verificado" (auditoría PP-11): misma regla que el centro de la
    // cuenta — verification_state 'Yes' o identidad aprobada (RPC de preferencias).
    const verifiedIcon = document.getElementById('artist-verified-icon');
    if (verifiedIcon) {
        verifiedIcon.hidden = !(artistData.verification_state === 'Yes' || publicProfilePreferences.verified === true);
    }
    renderBadges();

    renderVacation();
    renderSocials(profileExtras, privacy);
    renderGallery();
    renderStyles(styles);
    renderStats();
    renderSobreFacts();
    renderSpecialties(styles);
    renderStudio();
    renderPresence();
    renderCities();
    renderCtaMonths();
    renderActionbar(artisticName);
    setQuoteLinks();
    renderBio();
    syncTurnosLink();
}

function setMetaContent(ids, value) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.setAttribute('content', value);
    }
}

/**
 * Insignias de la cabecera (ronda 2, P21): Embajador We Ötzi y Most Wanted.
 * Salen de la RPC get_artist_public_badges (nunca trae conteos); si la RPC no
 * está, el embajador cae a la columna pública artists_db.embajador.
 */
function renderBadges() {
    const build = window.ArtistProfilePresentation?.buildProfileBadges;
    const list = build ? build({ badges: publicBadges, embajador: artistData?.embajador }) : [];
    const byId = Object.fromEntries(list.map((badge) => [badge.id, badge]));

    const ambassador = document.getElementById('artist-ambassador-badge');
    if (ambassador) {
        ambassador.hidden = !byId.ambassador;
        if (byId.ambassador) ambassador.title = byId.ambassador.title;
    }

    const wanted = document.getElementById('artist-most-wanted-badge');
    if (wanted) {
        wanted.hidden = !byId['most-wanted'];
        if (byId['most-wanted']) {
            wanted.title = byId['most-wanted'].title;
            setText('artist-most-wanted-text', byId['most-wanted'].label);
        }
    }
}

/* ---------- Quién mira: barra, franja del dueño y compartir ---------- */

function isOwnerView() {
    return viewer.kind === 'owner';
}

/**
 * Quién mira (nota N9 / bug T2-5). El modo dueño sale SOLO de la sesión real:
 * el id de la sesión tiene que ser el del artista de ESTE perfil.
 *
 * El bug: acá se preguntaba `ConfigManager.isDemoMode()`, que es otro flag
 * (features.demoMode, artistas de ejemplo del cotizador) y vale `true` por
 * defecto hasta que termina de cargar app-config.json. Al volver con Atrás la
 * página se rearma desde la caché, los datos del artista llegan antes que esa
 * configuración y cualquier visitante quedaba como "dueño": barra del artista
 * y franja "Estás viendo tu perfil público". El recorrido demo (wo-demo.js)
 * muestra el perfil del propio artista y llega con su sesión real: no
 * necesita ningún atajo (resolveViewerKind solo mira la sesión).
 */
async function resolveViewer(artistUserId) {
    const guest = { kind: 'guest', session: null };
    const decide = window.ArtistProfilePresentation?.resolveViewerKind;
    try {
        let session = null;
        if (_supabase?.auth?.getSession) {
            const { data } = await _supabase.auth.getSession();
            session = data?.session || null;
        }
        const sessionUserId = session?.user?.id || '';
        const ownerKind = decide
            ? decide({ artistUserId, sessionUserId })
            : (artistUserId && sessionUserId === artistUserId ? 'owner' : (sessionUserId ? 'client' : 'guest'));
        // `demo`: el dueño recorre su perfil en el sandbox (no se escribe nada real).
        if (ownerKind === 'owner') return { kind: 'owner', session, demo: window.WoDemo?.enabled === true };
        if (!sessionUserId) return guest;
        let isArtist = false;
        try {
            const own = await WeotziData?.Artists?.getOwnProfile?.('user_id');
            isArtist = Boolean(own?.data?.user_id);
        } catch (_) { /* sin fila de artista: es cliente */ }
        return { kind: isArtist ? 'artist' : 'client', session };
    } catch (error) {
        console.warn('Profile viewer unavailable:', error);
        return guest;
    }
}

/**
 * El estado de quién mira es el mismo al cargar y al volver con Atrás. Si el
 * navegador restaura la página desde su caché de navegación (bfcache) o la
 * sesión cambia en otra pestaña (ingreso, cierre), se vuelve a resolver y se
 * repinta lo que depende de eso: barra, franja del dueño, galería y bio.
 */
let viewerRefreshing = false;
async function refreshViewer() {
    if (!artistData?.user_id || viewerRefreshing) return;
    viewerRefreshing = true;
    try {
        // Misma sesión que al pintar: no hay nada que cambiar (ni se consulta de más).
        let sessionUserId = '';
        try {
            const { data } = await _supabase.auth.getSession();
            sessionUserId = data?.session?.user?.id || '';
        } catch (_) { /* sin sesión legible: se trata como visitante */ }
        if (sessionUserId === (viewer.session?.user?.id || '')) return;

        const next = await resolveViewer(artistData.user_id);
        const changed = next.kind !== viewer.kind;
        viewer = next;
        applyViewerChrome();
        if (changed) {
            renderGallery();
            renderBio();
        }
    } finally {
        viewerRefreshing = false;
    }
}

let viewerWatchBound = false;
function watchViewerChanges() {
    if (viewerWatchBound) return;
    viewerWatchBound = true;
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) void refreshViewer();
    });
    try {
        _supabase?.auth?.onAuthStateChange?.((event, session) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
                // Fuera del callback de auth: supabase-js no admite llamadas anidadas ahí.
                setTimeout(() => { void refreshViewer(); }, 0);
            } else if (event === 'TOKEN_REFRESHED' && session?.user?.id && session.user.id === viewer.session?.user?.id) {
                // Misma persona con token nuevo: las llamadas con Bearer usan el vigente.
                viewer = { ...viewer, session };
            }
        });
    } catch (_) { /* sin eventos de sesión: queda el estado de la carga */ }
}

/**
 * Barra superior (auditoría PP-03). El Figma 801:1108 dibuja la del artista
 * porque es la vista del dueño: se usa para el dueño y para otros artistas
 * con sesión. Un cliente ve su barra (como en el marketplace) y sin sesión
 * queda la pública del HTML.
 */
let publicTopbarHtml = null;
function applySessionTopbar() {
    const slot = document.getElementById('profile-topbar');
    if (!slot) return;
    // La barra pública del HTML se guarda para volver a ella si la sesión se cierra.
    if (publicTopbarHtml === null) publicTopbarHtml = slot.innerHTML;

    if (viewer.kind === 'owner' || viewer.kind === 'artist') {
        slot.innerHTML = '<weotzi-product-nav active="profile" menu-toggle-id="profile-product-menu-toggle"'
            + ' menu-id="profile-product-mobile-menu" profile-label="Centro de la cuenta"'
            + ' logout-handler="handleProfileLogout" dashboard-extras></weotzi-product-nav>';
        const bind = () => window.requestAnimationFrame(setupProfileNavigationMenu);
        if (window.customElements?.whenDefined) window.customElements.whenDefined('weotzi-product-nav').then(bind);
        else bind();
        return;
    }

    if (viewer.kind === 'client') {
        const meta = viewer.session?.user?.user_metadata || {};
        const initials = getReviewInitials(meta.full_name || meta.name || viewer.session?.user?.email || '');
        slot.innerHTML = `
            <header class="wo-topbar profile-public-topbar profile-client-topbar">
                <div class="wo-topbar-left">
                    <a href="/client/dashboard" class="wo-topbar-brand"><span class="wo-o-tile" aria-hidden="true">Ö</span>WE ÖTZI</a>
                    <nav class="wo-topbar-nav" aria-label="Navegación principal">
                        <a class="wo-topbar-item" href="/client/dashboard">Cotizaciones</a>
                        <a class="wo-topbar-item" href="/job-board">Job board</a>
                        <a class="wo-topbar-item" href="/marketplace">Explorar artistas</a>
                        <a class="wo-topbar-item" href="/explore">Tattoo globe</a>
                    </nav>
                </div>
                <div class="wo-topbar-right">
                    <a class="profile-client-tile" href="/client/dashboard" aria-label="Ir al centro de cuenta">${escapeHtml(initials)}</a>
                    <button class="wo-btn wo-btn--danger wo-btn--s wo-btn--mono" type="button" id="profile-client-logout">Log out</button>
                </div>
            </header>`;
        document.getElementById('profile-client-logout')?.addEventListener('click', handleProfileLogout);
        return;
    }

    // Sin sesión: la barra pública (se repone si antes hubo otra).
    if (!document.getElementById('profile-topbar-cta')) slot.innerHTML = publicTopbarHtml;
    const cta = document.getElementById('profile-topbar-cta');
    if (cta) cta.href = getQuotationFormUrl();
}

function applyViewerChrome() {
    const owner = isOwnerView();
    document.body.classList.toggle('is-owner-view', owner);
    applySessionTopbar();
    const ownerBar = document.getElementById('profile-owner-bar');
    if (ownerBar) ownerBar.hidden = !owner;
    const shareBtn = document.getElementById('profile-share-btn');
    if (shareBtn) shareBtn.hidden = !artistData?.username;
    renderViewerActions();
}

/* ---------- Ronda 2: favoritos y denuncia (contratos entre frentes) ---------- */

/**
 * Los botones [data-wo-favorite] y [data-wo-report] los activan los módulos de
 * otros frentes (wo-favorites.js / wo-report.js). Acá solo se dejan con sus
 * datos y se intenta cargar el módulo: si no existe en este deploy, los
 * botones quedan ocultos (nunca un botón que no hace nada).
 */
const OPTIONAL_MODULES = {
    favorites: { src: '/shared/js/wo-favorites.js', flag: 'wo-has-favorites', globals: ['WoFavorites', 'WoFavoritesReady'], event: 'wo:favorites-refresh' },
    report: { src: '/shared/js/wo-report.js', flag: 'wo-has-report', globals: ['WoReport', 'WoReportReady'], event: 'wo:report-refresh' }
};
const optionalModuleState = {};

function ensureOptionalModule(name) {
    const mod = OPTIONAL_MODULES[name];
    if (!mod) return Promise.resolve(false);
    if (optionalModuleState[name]) return optionalModuleState[name];
    const file = mod.src.split('/').pop();
    const ready = () => {
        document.documentElement.classList.add(mod.flag);
        return true;
    };
    optionalModuleState[name] = new Promise((resolve) => {
        // Ya está en la página (lo incluyó su frente) o ya dejó su global.
        if (mod.globals.some((key) => window[key]) || document.querySelector(`script[src*="${file}"]`)) {
            resolve(ready());
            return;
        }
        const script = document.createElement('script');
        script.src = appBaseUrl() + mod.src;
        script.async = true;
        script.onload = () => resolve(ready());
        script.onerror = () => { script.remove(); resolve(false); };
        document.head.appendChild(script);
    });
    return optionalModuleState[name];
}

// Avisa al módulo que hay botones nuevos (la galería se repinta al filtrar).
function refreshOptionalModule(name, root) {
    const mod = OPTIONAL_MODULES[name];
    if (!mod) return;
    void ensureOptionalModule(name).then((loaded) => {
        if (!loaded) return;
        try {
            document.dispatchEvent(new CustomEvent(mod.event, { detail: { root: root || document } }));
            const api = window[mod.globals[0]];
            const refresh = api && (api.refresh || api.scan || api.hydrate);
            if (typeof refresh === 'function') refresh.call(api, root || document);
        } catch (error) {
            console.warn(`[perfil] ${name}:`, error);
        }
    });
}

function renderViewerActions() {
    const userId = artistData?.user_id || '';
    const name = profileDisplayName();

    // Favorito del artista (cabecera): para todos menos el dueño.
    const favBtn = document.getElementById('profile-fav-btn');
    if (favBtn) {
        favBtn.dataset.id = userId;
        favBtn.dataset.label = name;
        favBtn.dataset.image = /^https?:\/\//i.test(artistData?.profile_picture || '') ? artistData.profile_picture : '';
        favBtn.hidden = !userId || isOwnerView();
        if (!favBtn.hidden) refreshOptionalModule('favorites', favBtn.parentElement);
    }

    // Denunciar perfil: solo artistas con sesión que no son el dueño.
    const reportBand = document.getElementById('profile-report-band');
    const reportBtn = document.getElementById('profile-report-btn');
    if (reportBand && reportBtn) {
        const canReport = Boolean(userId) && viewer.kind === 'artist';
        reportBtn.dataset.id = userId;
        reportBtn.dataset.label = name;
        reportBand.hidden = !canReport;
        if (canReport) refreshOptionalModule('report', reportBand);
    }
}

function appBaseUrl() {
    const configured = String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
    const base = configured || (/^\/beta(?:\/|$)/.test(window.location.pathname) ? '/beta' : '');
    return window.location.origin + base;
}

// URL para compartir: la canónica que escribió el servidor (URL corta) o la
// misma regla armada en el navegador.
function getPublicProfileUrl() {
    const fromServer = document.getElementById('profile-canonical')?.getAttribute('href') || '';
    if (/^https?:\/\//i.test(fromServer)) return fromServer;
    const username = artistData?.username || '';
    if (window.WoArtistPublicUrl) return window.WoArtistPublicUrl.publicProfileUrl(username, appBaseUrl());
    return `${appBaseUrl()}/artist/profile?artist=${encodeURIComponent(username)}`;
}

function profileDisplayName() {
    const extras = publicProfilePreferences.profile || {};
    return artistData?.name || extras.full_name || String(artistData?.username || '').replace(/\.wo$/i, '') || 'Artista';
}

/**
 * Paso "Compartí tu perfil" del onboarding (auditoría PP-07): solo cuando el
 * dueño comparte su propio perfil. Una vez por id en la página.
 */
const onboardingAcks = new Set();
async function acknowledgeOnboarding(id) {
    if (!isOwnerView() || onboardingAcks.has(id)) return;
    onboardingAcks.add(id);
    const body = { assisted: { acknowledge: id } };
    try {
        if (window.WoDemo && typeof window.WoDemo.api === 'function') {
            await window.WoDemo.api('/api/artist/onboarding', { method: 'POST', body });
        } else {
            const token = viewer.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/artist/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }
        document.dispatchEvent(new CustomEvent('wo:assist-refresh', { detail: { section: 'compartir' } }));
    } catch (error) {
        onboardingAcks.delete(id);
        console.warn('Onboarding share ack failed:', error);
    }
}

// Canales de la hoja → canales que guarda el servidor (artist_profile_shares).
// La historia de Instagram cuenta una sola vez (el toque en Instagram), no
// también cuando después se comparte o descarga la imagen ('story').
const SHARE_CHANNELS = {
    copy: 'copy', native: 'native', whatsapp: 'whatsapp', facebook: 'facebook', x: 'x',
    instagram: 'story', qr_download: 'qr'
};
const trackedShares = new Set();

/**
 * Cada compartido suma a Most Wanted (ronda 2, P21). Una vez por canal y
 * página; el servidor además cuenta una sola vez por persona, canal y hora.
 * Fire-and-forget: nunca frena ni rompe el compartir.
 */
function trackProfileShare(channel) {
    const mapped = SHARE_CHANNELS[channel];
    const username = artistData?.username;
    if (!mapped || !username || trackedShares.has(mapped) || viewer.demo || window.WoDemo?.enabled) return;
    trackedShares.add(mapped);
    const headers = { 'Content-Type': 'application/json' };
    const token = viewer.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch('/api/artist/profile-share', {
        method: 'POST',
        headers,
        body: JSON.stringify({ artist_username: username, channel: mapped }),
        keepalive: true
    }).catch(() => { trackedShares.delete(mapped); });
}

// Datos de la historia y de la tarjeta Open Graph (wo-share-cards.js).
function shareCardInput() {
    return { artist: artistData, prefs: publicProfilePreferences, name: profileDisplayName(), url: getPublicProfileUrl() };
}

// Solo el dueño (con su sesión) puede subir su tarjeta; se regenera si cambió
// algo. `auto`: chequeo al abrir el perfil (espaciado); al compartir no espera.
function syncOwnShareCard(auto = false) {
    if (!isOwnerView() || viewer.demo || !viewer.session || !window.WoShareCards?.syncOgCard) return;
    void window.WoShareCards.syncOgCard({ ...shareCardInput(), auto });
}

function openShareSheet(trigger, opts = {}) {
    if (!artistData?.username || !window.WoShareSheet) return;
    const owner = isOwnerView();
    const name = profileDisplayName();
    // Al compartir, la vista previa del enlace (og:image) tiene que estar al día.
    syncOwnShareCard();
    window.WoShareSheet.open({
        url: getPublicProfileUrl(),
        title: `${name} · We Ötzi`,
        text: owner ? 'Mirá mi perfil de artista en We Ötzi' : `Mirá el perfil de ${name} en We Ötzi`,
        name,
        image: artistData.profile_picture || '',
        fileName: String(artistData.username).replace(/\.wo$/i, ''),
        heading: owner ? 'Compartir mi perfil' : 'Compartir perfil',
        trigger,
        qr: opts.qr === true,
        // Historia de Instagram 1080×1920 (nota N8): la arma wo-share-cards.js.
        story: window.WoShareCards ? { artist: artistData, prefs: publicProfilePreferences, name } : null,
        extra: owner ? { label: 'Tarjeta QR con tu marca', href: '/artist/dashboard?panel=qr' } : null,
        onShare(channel) {
            trackProfileShare(channel);
            // Abrir el panel QR no es compartir; descargarlo, sí.
            if (channel === 'copy') void acknowledgeOnboarding('compartir.enlace');
            else if (channel !== 'qr') void acknowledgeOnboarding('compartir');
        }
    });
}

/**
 * Anclas que llegan en el enlace (auditoría PP-14): el contenido se pinta
 * después de cargar, así que el navegador no las resuelve solo.
 */
function scrollToRequestedSection(options = {}) {
    const hash = decodeURIComponent(String(window.location.hash || '').slice(1));
    if (!hash || !/^[a-z0-9_-]+$/i.test(hash)) return;
    if (hash === 'artist-reviews-panel' && !options.afterReviews) return;
    const target = document.getElementById(hash);
    if (!target || target.hidden) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch (_) { /* noop */ }
    });
}

// "Ver turnos disponibles": solo si la página tiene la sección pública #turnos.
function syncTurnosLink() {
    const link = document.getElementById('cta-turnos-link');
    if (link) link.hidden = !document.getElementById('turnos');
}

/* ---------- Vacaciones (Cuenta 801:571) ---------- */

function currentVacation() {
    const V = window.WoArtistVacation;
    return V ? V.fromArtist(artistData) : null;
}

function isOnVacation() {
    const V = window.WoArtistVacation;
    return !!(V && V.status(currentVacation()) === 'active');
}

function renderVacation() {
    const box = document.getElementById('hero-vacation');
    const V = window.WoArtistVacation;
    if (!box || !V) return;
    const text = V.notice(currentVacation());
    setText('hero-vacation-text', text);
    box.hidden = !text;
}

/* ---------- Redes (Instagram · TikTok · Sitio web) en la ficha "Sobre" ---------- */

function renderSocials(profileExtras, privacy) {
    const wrapper = document.getElementById('fact-socials');
    const value = document.getElementById('display-socials');
    const P = window.ArtistProfilePresentation;
    if (!wrapper || !value || !P || typeof P.buildSocialLinks !== 'function') return;
    const links = privacy && privacy.show_socials === false ? [] : P.buildSocialLinks(artistData, profileExtras);
    value.innerHTML = links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer me" aria-label="${escapeHtml(link.label)}: ${escapeHtml(link.handle)} (se abre en otra pestaña)">${escapeHtml(link.label)}</a>`).join(' · ');
    wrapper.hidden = links.length === 0;
}

function safePublicHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (_) {
        return '';
    }
}

/**
 * Banda azul (Figma 344:1375): el titular-manifiesto es la primera oración corta
 * de `bio_description`; el resto queda como párrafo. Si la bio trae links
 * (formato rico funcional) no se parte: se renderiza completa y sin manifiesto
 * para no perder los enlaces.
 */
function splitBioManifesto(plainText) {
    const text = String(plainText || '').trim();
    if (!text) return { manifesto: '', rest: text };

    const match = text.match(/^([^\n]+?[.!?…])(?:\s+|$)/);
    const sentence = match ? match[1].trim() : '';
    if (!sentence || sentence.length > BIO_MANIFESTO_MAX_CHARS) {
        return { manifesto: '', rest: text };
    }
    return { manifesto: sentence, rest: text.slice(match[0].length).trim() };
}

function bioHasRichFormat(safeHtml) {
    return /<(a|b|strong|i|em|u|s|strike|del|mark|span|ul|ol|li)[\s>]/i.test(String(safeHtml || ''));
}

function renderBio() {
    const manifestoEl = document.getElementById('bio-manifesto');
    const bioTextEl = document.getElementById('bio-text');
    if (!bioTextEl) return;

    const bio = artistData?.bio_description || '';
    // Revisión 12 nov 2026 (pág. 7): la presentación es HTML enriquecido
    // (WoRichText). Si trae formato (links, negrita, resaltado, tamaño, color,
    // listas) se renderiza completa, saneada en el cliente con la misma
    // allowlist que lib/bio-sanitizer.js; el manifiesto solo se extrae de
    // bios de texto plano para no perder ese formato.
    const hasRichFormat = window.BioFormatting
        ? bioHasRichFormat(window.BioFormatting.sanitizeBioHtml(bio))
        : false;
    const plain = window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(bio)
        : String(bio).trim();
    const { manifesto, rest } = hasRichFormat ? { manifesto: '', rest: plain } : splitBioManifesto(plain);

    if (manifestoEl) {
        manifestoEl.hidden = !manifesto;
        manifestoEl.textContent = manifesto;
    }

    // Sin presentación (PP-05): el visitante no ve un aviso de vacío; el dueño
    // ve a dónde ir para escribirla.
    if (!String(plain || '').trim()) {
        if (isOwnerView()) {
            bioTextEl.hidden = false;
            bioTextEl.innerHTML = '<p>Todavía no escribiste tu presentación. <a href="/artist/account#perfil">Sumala desde Editar perfil →</a></p>';
        } else {
            bioTextEl.hidden = true;
            bioTextEl.textContent = '';
        }
        return;
    }

    if (!manifesto) {
        bioTextEl.hidden = false;
        if (window.BioFormatting) {
            window.BioFormatting.renderBioHtml(bioTextEl, bio);
        } else {
            bioTextEl.textContent = plain || bioTextEl.dataset.emptyMessage || '';
        }
        return;
    }

    bioTextEl.hidden = !rest;
    bioTextEl.innerHTML = rest
        ? rest.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('')
        : '';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || '-';
}

/**
 * CTA dual del funnel (Figma): "Reservar sesión →" y "Solicitar cotización"
 * abren el cotizador (`/quotation?artist=<usuario>`, misma ruta que el badge
 * AGENDA ABIERTA de residencias) con el artista ya elegido. `/quotations`
 * solo redirigía ahí (auditoría PP-10).
 */
function setQuoteLinks() {
    const quotationUrl = getQuotationUrl();
    // Turnos: con reservas online activas, "Reservar sesión" abre /turnos (profile-turnos.js).
    const reserveUrl = (window.WoProfileTurnos && window.WoProfileTurnos.reserveUrl) || getQuotationFormUrl();

    for (const id of ['quote-cta-top-btn', 'quote-cta-bar-btn', 'quote-cta-band-btn', 'gallery-empty-cta']) {
        const el = document.getElementById(id);
        if (el) el.href = quotationUrl;
    }

    for (const id of ['reserve-cta-top-btn', 'reserve-cta-bottom-btn', 'reserve-cta-bar-btn']) {
        const el = document.getElementById(id);
        if (el) el.href = reserveUrl;
    }
}

function renderStyles(styles) {
    const stylesContainer = document.getElementById('display-styles');
    if (!stylesContainer) return;

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

/**
 * Statstrip del Figma. La experiencia y calificación siguen viniendo de sus
 * fuentes públicas; tatuajes completados y respuesta llegan como agregado del
 * servidor, sin exponer filas de cotizaciones.
 */
function renderStats() {
    const experienceCell = document.getElementById('statcell-experience');
    const experience = formatExperienceStat(artistData?.years_experience);

    if (experienceCell) {
        experienceCell.hidden = !experience;
        if (experience) setText('display-experience', experience);
    }

    setText('display-tattoos', publicProfileMetrics.tattooCountLabel || '—');
    setText('display-response-rate', publicProfileMetrics.responseRateLabel || '—');

    markLeadStatcell();
}

function markLeadStatcell() {
    const strip = document.getElementById('stats-strip');
    const band = document.getElementById('stats-band');
    if (!strip) return;

    const visible = Array.from(strip.querySelectorAll('.statcell')).filter((cell) => !cell.hidden);
    strip.querySelectorAll('.statcell').forEach((cell) => cell.classList.remove('statcell--lead'));
    if (visible.length) visible[0].classList.add('statcell--lead');
    if (band) band.hidden = visible.length === 0;
}

/**
 * Ficha lateral de la banda azul. El Figma lista EXPERIENCIA / IDIOMAS / SESIÓN
 * MÍNIMA / TIEMPO DE RESPUESTA; la última usa el agregado público del servidor.
 */
function renderSobreFacts() {
    const experience = formatExperienceFact(artistData?.years_experience);
    const languages = Array.isArray(artistData?.languages) ? artistData.languages.filter(Boolean) : [];
    const price = formatSessionPriceFact(artistData?.session_price);

    toggleFact('fact-experience', 'display-experience-fact', experience);
    toggleFact('fact-languages', 'display-languages', languages.length ? languages.join(' · ') : '');
    toggleFact('fact-price', 'display-price', price);
    setText('display-response-time', publicProfileMetrics.responseTimeLabel || '—');
}

function toggleFact(wrapperId, valueId, value) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    wrapper.hidden = !value;
    if (value) setText(valueId, value);
}

/**
 * Tabla de Especialidades: nombre real de `styles_array`, definición editorial
 * solo para los cuatro estilos documentados por el Figma y primera obra
 * etiquetada con ese estilo. Si falta contenido se presenta un slot vacío.
 */
function renderSpecialties(styles) {
    const band = document.getElementById('specialties-band');
    const table = document.getElementById('specialty-table');
    if (!band || !table) return;

    if (!styles.length) {
        band.hidden = true;
        table.innerHTML = '';
        return;
    }

    band.hidden = false;
    const rows = window.ArtistProfilePresentation?.buildSpecialtyRows
        ? window.ArtistProfilePresentation.buildSpecialtyRows(styles, galleryItems, SPECIALTY_DESCRIPTIONS)
        : styles.map((name) => ({ name, description: '', mediaUrl: '', mediaKind: 'image' }));
    table.innerHTML = rows.map((row, index) => `
        <div class="specialty-row">
            <span class="specialty-index">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
            <span class="specialty-swatch" style="--specialty-color: ${SPECIALTY_COLORS[index % SPECIALTY_COLORS.length]}" aria-hidden="true"></span>
            <p class="specialty-name">${escapeHtml(row.name)}</p>
            <p class="specialty-description">${escapeHtml(row.description)}</p>
            <span class="specialty-media${row.mediaUrl ? ' has-media' : ''}">
                ${row.mediaUrl
                    ? (row.mediaKind === 'video'
                        ? `<video src="${escapeHtml(row.mediaUrl)}" muted playsinline preload="metadata" aria-label="Muestra de ${escapeHtml(row.name)}"></video>`
                        : `<img src="${escapeHtml(row.mediaUrl)}" alt="Muestra de ${escapeHtml(row.name)}" loading="lazy" width="160" height="96">`)
                    : `<span class="specialty-media-empty"><i data-wo-icon="image" aria-hidden="true"></i><span>${escapeHtml(row.name)}</span></span>`}
            </span>
        </div>
    `).join('');
    window.WoIcons?.hydrate?.(table);
}

function buildStudioAddress(studio) {
    if (!studio) return '';
    if (studio.formatted_address) return String(studio.formatted_address).trim();

    const street = [studio.street, studio.street_number].filter(Boolean).join(' ').trim();
    const area = [studio.locality, studio.city].filter(Boolean).join(' · ').trim();
    return [street, area].filter(Boolean).join(', ');
}

/**
 * Panel de Estudio. Nombre, dirección y foto salen de `studios`; `ARTISTAS` sale
 * del roster activo. `AMBIENTE` y `ACCESOS` del Figma no tienen columna y no se
 * maquetan.
 */
// `studios.location_verified` (migración 20261112120000): false solo para el
// estudio que creó un tatuador y todavía no completó su alta. Sin la columna
// (undefined/null) se considera verificado.
function isStudioLocationUnverified(studio) {
    return Boolean(studio) && studio.location_verified === false;
}

function renderStudio() {
    const band = document.getElementById('studio-band');
    if (!band) return;

    if (!studioData?.name) {
        band.hidden = true;
        return;
    }

    band.hidden = false;
    setText('studio-name', studioData.name);

    const address = buildStudioAddress(studioData);
    const addressEl = document.getElementById('studio-address');
    if (addressEl) {
        addressEl.hidden = !address;
        addressEl.textContent = address;
    }

    const unverifiedEl = document.getElementById('studio-unverified');
    if (unverifiedEl) unverifiedEl.hidden = !isStudioLocationUnverified(studioData);

    const photos = parseJsonArray(studioData.photo_feed_items);
    const photoUrl = String(studioData.cover_image || photos.find((item) => item?.url)?.url || '').trim();
    const photoImg = document.getElementById('studio-photo-img');
    const photoEmpty = document.getElementById('studio-photo-empty');
    if (photoImg) {
        if (photoUrl) {
            photoImg.src = photoUrl;
            photoImg.alt = `Estudio ${studioData.name}`;
        } else {
            photoImg.removeAttribute('src');
            photoImg.alt = '';
        }
    }
    if (photoEmpty) photoEmpty.hidden = Boolean(photoUrl);

    const facts = document.getElementById('studio-facts');
    if (facts) {
        facts.innerHTML = studioData.rosterCount
            ? `<div class="studio-fact"><dt>Artistas</dt><dd>${escapeHtml(String(studioData.rosterCount))} ${studioData.rosterCount === 1 ? 'residente' : 'residentes'}</dd></div>`
            : '';
    }

    const link = document.getElementById('studio-link');
    if (link) {
        const ref = studioData.slug || studioData.id;
        link.hidden = !ref;
        if (ref) link.href = `/studio/profile?studio=${encodeURIComponent(ref)}`;
    }
}

/**
 * Portafolio: una sola grilla de trabajos con chips de filtro por estilo
 * (Figma 801:1108). El estilo de cada obra sale de `styles[]`/`style` o de su
 * categoría cuando no es una categoría de galería (realizados/flash/proyectos).
 */
function galleryStylesOf(raw) {
    if (window.ArtistProfilePresentation?.galleryItemStyles) {
        return window.ArtistProfilePresentation.galleryItemStyles(raw, GALLERY_CATEGORY_LABELS);
    }
    return (Array.isArray(raw?.styles) ? raw.styles : [raw?.style, raw?.style_name])
        .filter(Boolean)
        .map((style) => String(style).trim())
        .filter(Boolean);
}

function normalizeGalleryItems() {
    const items = [];
    const seen = new Set();
    const visibility = igValidationState && typeof window.WoGalleryVisibility?.isPubliclyVisible === 'function'
        ? window.WoGalleryVisibility
        : null;
    let hiddenCount = 0;

    for (const raw of parseJsonArray(artistData?.gallery_feed_items)) {
        // Se filtra sobre el ítem crudo: el mapeo de abajo descarta source,
        // ig_handle e ig_legacy, que son los que deciden la visibilidad.
        if (visibility && !visibility.isPubliclyVisible(raw, igValidationState)) {
            hiddenCount += 1;
            continue;
        }
        const url = String(raw?.url || '').trim();
        if (!url || seen.has(url)) continue;
        const category = GALLERY_CATEGORY_LABELS[String(raw?.category || '').toLowerCase()]
            ? String(raw.category).toLowerCase()
            : 'realizados';
        const key = String(raw?.id || raw?.key || url.split('?')[0].split('/').pop() || `work-${items.length + 1}`);
        const title = String(raw?.title || raw?.name || `${GALLERY_CATEGORY_LABELS[category]} ${items.length + 1}`);
        const styles = galleryStylesOf(raw);
        const filterValues = styles.map((style) => window.ArtistProfilePresentation?.filterKey?.(style) || String(style).toLowerCase());
        // Pie de foto (ronda 2): texto plano del ítem, si lo trae.
        const caption = galleryCaptionOf(raw);
        items.push({ url, key, title, category, styles, filterValues, caption, kind: raw?.kind === 'video' || isUrlVideo(url) ? 'video' : 'image' });
        seen.add(url);
    }

    // El respaldo legacy es para artistas sin feed: si el feed tenía fotos y
    // todas quedaron ocultas, no se las vuelve a mostrar desde gallery_images.
    if (!items.length && !hiddenCount) {
        for (const entry of parseJsonArray(artistData?.gallery_images)) {
            const url = typeof entry === 'string' ? entry.trim() : String(entry?.url || '').trim();
            if (!url || seen.has(url)) continue;
            const raw = typeof entry === 'object' && entry ? entry : {};
            const key = String(raw.id || raw.key || url.split('?')[0].split('/').pop() || `work-${items.length + 1}`);
            const title = String(raw.title || raw.name || `Trabajo ${items.length + 1}`);
            const styles = galleryStylesOf(raw);
            const filterValues = styles.map((style) => window.ArtistProfilePresentation?.filterKey?.(style) || String(style).toLowerCase());
            items.push({ url, key, title, category: 'realizados', styles, filterValues, caption: galleryCaptionOf(raw), kind: isUrlVideo(url) ? 'video' : 'image' });
            seen.add(url);
        }
    }

    return items;
}

// Pie de foto de un trabajo: `caption` del ítem (lo define el editor del
// portafolio), saneado a texto plano. Largo completo para el visor.
const GALLERY_CAPTION_MAX = 320;
function galleryCaptionOf(raw) {
    const clean = window.ArtistProfilePresentation?.workCaption;
    const value = raw && typeof raw === 'object' ? raw.caption : '';
    if (typeof value !== 'string' || !value.trim()) return '';
    return clean ? clean(value, GALLERY_CAPTION_MAX) : value.replace(/\s+/g, ' ').trim().slice(0, GALLERY_CAPTION_MAX);
}

function getVisibleGalleryItems() {
    if (galleryFilter === GALLERY_ALL_FILTER) return galleryItems;
    return galleryItems.filter((item) => item.category === galleryFilter || item.filterValues?.includes(galleryFilter));
}

/**
 * Dos grupos de chips sincronizados (Figma 801:1108): la entrada de portafolio
 * ("Todo", en contorno) y la grilla ("Todos", el activo en amarillo con sombra
 * dura). Ambos filtran la misma grilla.
 */
function renderGalleryChips() {
    const containers = ['portfolio-intro-chips', 'gallery-chips']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (!containers.length) return;

    let options = window.ArtistProfilePresentation?.buildPortfolioFilterOptions
        ? window.ArtistProfilePresentation.buildPortfolioFilterOptions(galleryItems, GALLERY_CATEGORY_LABELS)
        : [{ value: GALLERY_ALL_FILTER, label: 'Todos' }];
    if (options.length < 2) {
        options = [{ value: GALLERY_ALL_FILTER, label: 'Todos' }];
        galleryFilter = GALLERY_ALL_FILTER;
    }

    containers.forEach((chips) => {
        const isIntro = chips.id === 'portfolio-intro-chips';
        // Un único chip "Todos" no filtra nada: los filtros aparecen con 2 o más.
        chips.hidden = options.length < 2 || (!galleryItems.length && !isOwnerView());
        chips.innerHTML = options.map((option) => {
            const active = option.value === galleryFilter;
            const label = isIntro && option.value === GALLERY_ALL_FILTER ? 'Todo' : option.label;
            return `<button type="button" class="gallery-chip${active ? ' is-active' : ''}" data-gallery-filter="${escapeHtml(option.value)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
        }).join('');
    });
}

function renderGallery() {
    galleryItems = normalizeGalleryItems();
    // La banda de entrada "Portafolio" se quitó (ronda 2, nota N7); si un HTML
    // viejo en caché todavía la trae, queda oculta.
    const introBand = document.querySelector('.portfolio-intro-band');
    if (introBand) introBand.hidden = true;
    const owner = isOwnerView();
    const ownerCta = document.getElementById('gallery-owner-cta');
    if (ownerCta) ownerCta.hidden = !owner || galleryItems.length >= MIN_GALLERY_SLOTS;

    // Visitante + perfil sin trabajos: la banda se achica a un estado vacío con
    // salida (pedir cotización), sin título ni grilla de huecos.
    const emptyForVisitor = !owner && !galleryItems.length;
    const band = document.getElementById('block-gallery');
    if (band) band.classList.toggle('is-empty', emptyForVisitor);
    const head = document.getElementById('gallery-head');
    if (head) head.hidden = emptyForVisitor;
    const emptyCard = document.getElementById('gallery-empty-card');
    if (emptyCard) emptyCard.hidden = !emptyForVisitor;
    const count = document.getElementById('gallery-count');
    if (count) {
        count.hidden = !galleryItems.length;
        count.textContent = galleryItems.length === 1 ? '1 trabajo' : `${galleryItems.length} trabajos`;
    }

    renderGalleryChips();
    renderGalleryGrid();
}

/**
 * Celdas de la grilla. El dueño ve los 9 huecos del Figma (801:1108) como
 * invitación a completar el portafolio; el visitante, solo los trabajos: nunca
 * huecos punteados (ronda 2: los perfiles con pocos trabajos no muestran vacíos).
 */
function gallerySlotCount(visibleCount, owner) {
    if (owner) return Math.max(MIN_GALLERY_SLOTS, Math.ceil(visibleCount / 3) * 3);
    return visibleCount;
}

function renderGalleryGrid() {
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');
    if (!galleryGrid) return;

    const owner = isOwnerView();
    const visible = getVisibleGalleryItems();
    if (galleryEmpty) {
        // El visitante sin ningún trabajo ve la tarjeta #gallery-empty-card
        // (renderGallery); este texto queda para el dueño y para un filtro vacío.
        const emptyForVisitor = !owner && !galleryItems.length;
        galleryEmpty.style.display = visible.length || emptyForVisitor ? 'none' : 'block';
        galleryEmpty.textContent = owner
            ? 'Todavía no publicaste trabajos. Los espacios están reservados para tu próxima colección.'
            : 'No hay trabajos con este filtro.';
    }
    galleryGrid.hidden = !owner && !visible.length;

    const slotCount = gallerySlotCount(visible.length, owner);
    const artistName = profileDisplayName();
    const favoriteId = window.ArtistProfilePresentation?.favoriteWorkId;

    let html = '';
    for (let index = 0; index < slotCount; index += 1) {
        const item = visible[index];
        if (item) {
            const number = index + 1;
            const caption = item.caption || '';
            const label = caption ? `Abrir trabajo ${number}: ${caption}` : `Abrir trabajo ${number}`;
            const alt = caption || `Trabajo ${number} de ${artistName}`;
            // Favorito del trabajo (contrato data-wo-favorite, kind="design"): el
            // botón va vacío; lo activa wo-favorites.js. El dueño no se guarda a sí mismo.
            const favId = !owner && favoriteId ? favoriteId(artistData?.user_id, item.key) : '';
            const favLabel = caption || `${item.title} · ${artistName}`;
            const favButton = favId
                ? `<button type="button" class="profile-fav gallery-fav" data-wo-favorite data-kind="design" data-id="${escapeHtml(favId)}" data-label="${escapeHtml(favLabel)}" data-image="${escapeHtml(item.kind === 'video' ? '' : item.url)}" aria-label="${escapeHtml(`Guardar el trabajo ${number} en favoritos`)}"></button>`
                : '';
            html += `
                <figure class="gallery-cell${caption ? ' has-caption' : ''}">
                    <button type="button" class="gallery-image-item" data-gallery-index="${index}" aria-label="${escapeHtml(label)}">
                        ${item.kind === 'video'
                            ? `<video src="${escapeHtml(item.url)}" preload="metadata" muted playsinline></video><span class="gallery-play-overlay"><i data-wo-icon="play" class="wo-icon-18" aria-hidden="true"></i></span>`
                            : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(alt)}" loading="lazy" width="1200" height="800">`}
                        <span class="gallery-overlay"><span>Ver</span><span>${String(number).padStart(2, '0')}</span></span>
                    </button>
                    ${favButton}
                    ${caption ? `<figcaption class="gallery-caption">${escapeHtml(caption)}</figcaption>` : ''}
                </figure>
            `;
        } else {
            // Celda vacía con el slot de imagen del Figma (borde punteado + ícono).
            html += `
                <div class="gallery-image-item is-placeholder" aria-hidden="true">
                    <span class="gallery-slot-empty"><i data-wo-icon="image"></i><span>Foto de portafolio</span></span>
                </div>
            `;
        }
    }

    galleryGrid.innerHTML = html;
    galleryGrid.dataset.count = String(visible.length);
    // Los botones de favorito se acaban de crear: se avisa a su módulo.
    if (!owner && visible.length) refreshOptionalModule('favorites', galleryGrid);
}

/**
 * Próximas residencias: una sola tabla (sin separar actual/próximo). La línea
 * secundaria usa el nombre del estudio — `artist_tattoo_locations` no guarda país.
 */
/**
 * Próximas residencias (Figma 801:1108): ciudad + PAÍS en línea, fechas y
 * estado. Une `artist_tattoo_locations` con los viajes confirmados de Travel.
 * El estudio queda como tooltip de la fila (el diseño no lo muestra).
 */
function getResidencyRows() {
    const base = getLocationParts(artistData);
    if (window.ArtistProfilePresentation?.buildResidencyRows) {
        return window.ArtistProfilePresentation.buildResidencyRows(tattooLocations, travelPresences, {
            base: { city: base.city, country: base.country }
        });
    }
    return tattooLocations.map((location) => {
        const badge = resolvePresenceBadge(location);
        return {
            city: location.city || location.studio_name || '-',
            country: location.country || '',
            venue: location.city ? location.studio_name : '',
            dates: formatResidencyRange(location.start_date, location.end_date),
            state: badge.state,
            label: badge.label
        };
    });
}

function renderPresence() {
    const band = document.getElementById('presence-band');
    const table = document.getElementById('presence-table');
    if (!band || !table) return;

    const rows = getResidencyRows();
    if (!rows.length) {
        band.hidden = true;
        table.innerHTML = '';
        return;
    }

    band.hidden = false;
    const quoteFormUrl = getQuotationFormUrl();

    table.innerHTML = rows.map((row, index) => {
        const badgeHtml = row.state === 'open'
            ? `<a class="presence-badge" data-state="open" href="${escapeHtml(quoteFormUrl)}">${escapeHtml(row.label)}</a>`
            : `<span class="presence-badge" data-state="${escapeHtml(row.state)}">${escapeHtml(row.label)}</span>`;
        const venueTitle = row.venue ? ` title="${escapeHtml(row.venue)}"` : '';

        return `
            <div class="presence-row"${venueTitle}>
                <div class="presence-place">
                    <span class="presence-tri" data-tone="${PRESENCE_TONES[index % PRESENCE_TONES.length]}" aria-hidden="true"></span>
                    <p class="presence-city">${escapeHtml(row.city || '-')}</p>
                    ${row.country ? `<span class="presence-country">${escapeHtml(row.country)}</span>` : ''}
                </div>
                <div class="presence-when">
                    ${row.dates ? `<span class="presence-dates">${escapeHtml(row.dates)}</span>` : ''}
                    ${badgeHtml}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Store (contrato docs/plans/2026-10-30-store-artista.md §8.5): banda con hasta
 * 6 productos públicos y «Ver la Store →». Solo con el gate (features.store y
 * tablas disponibles) y vía WeotziData.Store.getStorefront. Sin productos o ante
 * cualquier falla queda oculta: la Store nunca rompe el perfil.
 *
 * La vitrina se busca por username, que en artists_db todavía no es único: la
 * banda se muestra solo si el vendedor que resolvió la RPC (seller.id) es el
 * artista de este perfil (user_id). Si no coincide, queda oculta.
 */
const STORE_BAND_MAX_ITEMS = 6;

async function isStoreGateOpen() {
    const Store = window.WeotziData?.Store;
    if (!Store || typeof Store.featureEnabled !== 'function' || typeof Store.isAvailable !== 'function') return false;
    if (typeof window.ConfigManager?.ready === 'function') {
        try { await window.ConfigManager.ready(); } catch (_) { /* sigue con la config por defecto */ }
    }
    if (!Store.featureEnabled()) return false;
    return (await Store.isAvailable()) === true;
}

async function loadStoreBand() {
    const band = document.getElementById('store-band');
    const grid = document.getElementById('store-band-grid');
    if (!band || !grid) return;
    band.hidden = true;
    try {
        if (!artistData?.username || !artistData?.user_id || !(await isStoreGateOpen())) return;
        const storefront = await window.WeotziData.Store.getStorefront('artist', artistData.username);
        const sellerId = storefront?.seller?.id;
        const sameArtist = sellerId != null && String(sellerId) === String(artistData.user_id);
        const products = sameArtist && Array.isArray(storefront?.products) ? storefront.products : [];
        if (!products.length) {
            grid.innerHTML = '';
            return;
        }
        renderStoreBand(products.slice(0, STORE_BAND_MAX_ITEMS), storefront);
        band.hidden = false;
    } catch (error) {
        console.warn('Store band unavailable:', error);
        band.hidden = true;
        grid.innerHTML = '';
    }
}

function renderStoreBand(products, storefront) {
    const grid = document.getElementById('store-band-grid');
    const link = document.getElementById('store-band-link');
    const M = window.WeotziStoreModel;
    const Store = window.WeotziData.Store;
    const handle = storefront?.seller?.handle || artistData.username;
    if (link) link.href = M ? M.storeUrl(handle) : `/store/?artist=${encodeURIComponent(handle)}`;

    grid.innerHTML = products.map((product) => {
        const image = Array.isArray(product.images) ? product.images.find((img) => img && img.path) : null;
        const src = image ? Store.previewUrl(image.path) : '';
        // Mismo precio que la vitrina (WeotziStoreModel.priceLabel): «Desde …»
        // solo con varios precios posibles o uno aproximado.
        const price = typeof M?.priceLabel === 'function' ? M.priceLabel(product).label : '';
        const kind = M?.KIND_LABELS?.[product.kind] || (product.kind === 'design' ? 'Diseño' : 'Merch');
        const badges = M ? M.productBadges(product) : [];
        const href = M ? M.itemUrl(product.id) : `/store/item/?id=${encodeURIComponent(product.id)}`;
        // Miniatura decorativa: el título del link ya nombra el producto.
        const media = src
            ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" width="600" height="750">`
            : '<span class="store-band-media-empty"><i data-wo-icon="image" aria-hidden="true"></i></span>';
        const badgeHtml = badges.length
            ? `<span class="store-band-badges">${badges.map((b) => `<span class="${escapeHtml(b.tag)} store-band-tag">${escapeHtml(b.label)}</span>`).join('')}</span>`
            : '';
        return `
            <li class="store-band-cell">
                <a class="store-band-item" href="${escapeHtml(href)}">
                    <span class="store-band-media">${media}${badgeHtml}</span>
                    <span class="store-band-body">
                        <span class="store-band-kind">${escapeHtml(kind)}</span>
                        <span class="store-band-title">${escapeHtml(product.title)}</span>
                        ${price ? `<span class="store-band-price">${escapeHtml(price)}</span>` : ''}
                    </span>
                </a>
            </li>
        `;
    }).join('');
    window.WoIcons?.hydrate?.(grid);
}

/**
 * "Dónde tatué": ciudad base + lugares donde ya tatuó (ubicaciones vigentes y
 * viajes de Travel ya iniciados), en bloque tipográfico con colores alternados.
 */
function renderCities() {
    const band = document.getElementById('cities-band');
    const list = document.getElementById('cities-list');
    if (!band || !list) return;

    if (publicProfilePreferences.privacy?.show_city === false) {
        band.hidden = true;
        list.innerHTML = '';
        return;
    }

    const location = getLocationParts(artistData);
    const cities = window.ArtistProfilePresentation?.buildVisitedCities
        ? window.ArtistProfilePresentation.buildVisitedCities(location.city, tattooLocations, travelPresences)
        : [location.city, ...tattooLocations.map((item) => normalizeCityName(item.city))]
            .filter((city, index, list) => city && city !== '-' && list.indexOf(city) === index);

    if (!cities.length) {
        band.hidden = true;
        list.innerHTML = '';
        return;
    }

    band.hidden = false;
    list.innerHTML = cities.map((city, index) => {
        const separator = index < cities.length - 1 ? '<span class="city-sep" aria-hidden="true"></span>' : '';
        return `<span class="city-name" data-tone="${CITY_TONES[index % CITY_TONES.length]}">${escapeHtml(city)}</span>${separator}`;
    }).join('');
}

/**
 * Chips de mes del CTA rojo: meses cubiertos por las residencias con agenda
 * abierta. Sin fechas cargadas no se inventa disponibilidad — no se pintan.
 */
function renderCtaMonths() {
    const container = document.getElementById('cta-months');
    if (!container) return;

    const months = [];
    const seen = new Set();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const location of tattooLocations) {
        if (location.agenda_status !== 'open') continue;
        const start = toDate(location.start_date);
        const end = toDate(location.end_date);
        // Solo tramos vigentes o futuros: no se anuncian meses ya pasados.
        if (!start || !end || end < today) continue;

        const cursor = new Date(Math.max(start.getTime(), today.getTime()));
        cursor.setDate(1);
        while (cursor <= end && months.length < 4) {
            const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
            if (!seen.has(key)) {
                seen.add(key);
                months.push(cursor.toLocaleDateString('es-AR', { month: 'long' }));
            }
            cursor.setMonth(cursor.getMonth() + 1);
        }
    }

    container.innerHTML = months
        .map((month) => `<span class="cta-month">${escapeHtml(month)}</span>`)
        .join('');

    const copy = document.getElementById('cta-copy');
    if (copy && publicProfileMetrics.responseTimeLabel === 'Menos de 24 h') {
        copy.textContent = 'Estoy tomando reservas para los próximos dos meses. Contame tu idea y te paso un presupuesto en menos de 24 horas.';
    }
}

function hasOpenAgenda() {
    if (isOnVacation()) return false;
    if (tattooLocations.some((location) => location.agenda_status === 'open')) return true;
    const weekly = publicProfilePreferences.availability?.weekly;
    return Array.isArray(weekly) && weekly.some((day) => day?.enabled === true);
}

function renderActionbar(artisticName) {
    const bar = document.getElementById('profile-actionbar');
    if (!bar) return;

    bar.hidden = false;
    setText('actionbar-name', artisticName);

    const isOpen = hasOpenAgenda();
    const dot = document.getElementById('actionbar-dot');
    const status = document.getElementById('actionbar-status');
    const heroBadge = document.getElementById('hero-agenda-badge');

    const vacationText = isOnVacation() && window.WoArtistVacation
        ? window.WoArtistVacation.notice(currentVacation()) : '';
    if (dot) dot.hidden = !isOpen;
    if (status) {
        status.hidden = !isOpen && !vacationText;
        status.textContent = isOpen ? 'Agenda abierta' : vacationText;
    }
    if (heroBadge) heroBadge.hidden = !isOpen;
}

/* ---------- Reseñas ---------- */

function renderStars(container, average) {
    if (!container) return;
    const rounded = Math.round(Number(average) || 0);
    container.innerHTML = Array.from({ length: 5 }, (_, index) => (
        `<i data-wo-icon="star" class="${index < rounded ? '' : 'is-empty'}" aria-hidden="true"></i>`
    )).join('');
}

function getReviewInitials(name) {
    return String(name || 'WO')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join('')
        .toUpperCase() || 'WO';
}

function formatReviewMeta(review) {
    const place = String(review?.reviewer_country || '').trim();
    const year = review?.created_at ? new Date(review.created_at).getFullYear() : '';
    return [place, Number.isFinite(year) && year ? String(year) : '']
        .filter(Boolean)
        .join(' · ');
}

/**
 * Panel amarillo de resumen + 3 citas, tal como el Figma. `verified_reviews` y
 * `public_review_summary` son las fuentes reales; el widget completo (filtros,
 * tags, paginación y respuestas) queda detrás de "Ver todas las reseñas".
 */
async function renderArtistReviews() {
    const panel = document.getElementById('artist-reviews-panel');
    if (!panel || !artistData?.user_id || !WeotziData?.from) return;

    try {
        const [summaryResult, quotesResult] = await Promise.all([
            WeotziData
                .from('public_review_summary')
                .select('review_count, average_rating')
                .eq('reviewee_type', 'artist')
                .eq('reviewee_user_id', artistData.user_id)
                .maybeSingle(),
            WeotziData
                .from('verified_reviews')
                .select('id, reviewer_display_name, reviewer_country, comment, created_at')
                .eq('reviewee_type', 'artist')
                .eq('reviewee_user_id', artistData.user_id)
                .eq('moderation_status', 'approved')
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .limit(REVIEW_QUOTE_COUNT)
        ]);

        const summary = summaryResult?.data || null;
        const quotes = Array.isArray(quotesResult?.data) ? quotesResult.data : [];
        const reviewCount = Number(summary?.review_count || 0);

        if (!reviewCount && !quotes.length) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;

        const average = Number(summary?.average_rating || 0);
        setText('reviews-score', average ? average.toFixed(1) : '-');
        renderStars(document.getElementById('reviews-stars'), average);
        setText('reviews-count', reviewCount ? `Sobre ${reviewCount} ${reviewCount === 1 ? 'reseña' : 'reseñas'}` : 'Sin reseñas todavía');

        // Calificación del statstrip: misma fuente real que el panel.
        const ratingCell = document.getElementById('statcell-rating');
        if (ratingCell) {
            const showRating = publicProfilePreferences.privacy?.show_rating !== false;
            ratingCell.hidden = !average || !showRating;
            if (average && showRating) setText('display-rating', average.toFixed(1));
            markLeadStatcell();
        }

        const cards = document.getElementById('reviews-cards');
        if (cards) {
            // Figma 344:1510-1542: avatar cuadrado · circular · cuadrado (ink, rojo,
            // azul) y el autor en dos líneas (nombre arriba, país · año debajo).
            cards.innerHTML = quotes.map((review, index) => `
                <article class="review-quote-card">
                    <p class="review-quote-text">“${escapeHtml(review.comment || '')}”</p>
                    <div class="review-quote-author">
                        <span class="review-quote-avatar${index % REVIEW_AVATAR_COLORS.length === 1 ? ' is-round' : ''}" style="--review-avatar-bg: ${REVIEW_AVATAR_COLORS[index % REVIEW_AVATAR_COLORS.length]}" aria-hidden="true">${escapeHtml(getReviewInitials(review.reviewer_display_name))}</span>
                        <span class="review-quote-who">
                            <span class="review-quote-name">${escapeHtml(review.reviewer_display_name || 'Cliente verificado')}</span>
                            <span class="review-quote-meta">${escapeHtml(formatReviewMeta(review))}</span>
                        </span>
                    </div>
                </article>
            `).join('');
        }
    } catch (error) {
        console.error('Artist reviews render failed:', error);
        panel.hidden = true;
    }
}

// Estados por URL para QA y enlaces directos: ?estilo=<estilo> filtra el
// portafolio (ej. estilo=blackwork) · ?resenas=1 abre todas las reseñas.
function applyProfileUrlState() {
    const params = new URLSearchParams(window.location.search);
    const style = window.ArtistProfilePresentation?.filterKey?.(params.get('estilo') || '') || '';
    if (style) {
        document.querySelector(`#gallery-chips [data-gallery-filter="${CSS.escape(style)}"]`)?.click();
    }
    const reviews = document.getElementById('artist-reviews');
    if (params.get('resenas') === '1' && reviews?.hidden && !document.getElementById('artist-reviews-panel')?.hidden) {
        toggleFullReviews();
    }
}

function toggleFullReviews() {
    const mount = document.getElementById('artist-reviews');
    const trigger = document.getElementById('reviews-all-link');
    if (!mount) return;

    const shouldOpen = mount.hidden;
    mount.hidden = !shouldOpen;
    if (trigger) {
        trigger.setAttribute('aria-expanded', String(shouldOpen));
        trigger.textContent = shouldOpen ? 'Ocultar las reseñas →' : 'Ver todas las reseñas →';
    }

    if (shouldOpen && !reviewsWidgetMounted && window.WeOtziReviews && artistData?.user_id) {
        reviewsWidgetMounted = true;
        window.WeOtziReviews.renderPublicReviews({
            mount: 'artist-reviews',
            revieweeType: 'artist',
            revieweeId: artistData.user_id,
            title: 'Reseñas del artista'
        });
    }
}

/* ---------- Escena Bauhaus del estado de error ---------- */

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

/* ---------- Eventos ---------- */

function setupEventListeners() {
    setupProfileNavigationMenu();
    setupProfileErrorSceneInteractivity();

    document.getElementById('reviews-all-link')?.addEventListener('click', toggleFullReviews);

    const shareBtn = document.getElementById('profile-share-btn');
    shareBtn?.addEventListener('click', () => openShareSheet(shareBtn));
    const ownerShareBtn = document.getElementById('profile-owner-share-btn');
    ownerShareBtn?.addEventListener('click', () => openShareSheet(ownerShareBtn));
    // La sección pública de turnos (otro módulo) avisa cuando se pinta.
    document.addEventListener('wo:turnos-ready', () => {
        syncTurnosLink();
        scrollToRequestedSection({ afterReviews: true });
    });

    for (const id of ['portfolio-intro-chips', 'gallery-chips']) {
        document.getElementById(id)?.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-gallery-filter]');
            if (!chip) return;
            galleryFilter = chip.dataset.galleryFilter || GALLERY_ALL_FILTER;
            renderGalleryChips();
            renderGalleryGrid();
            if (id === 'portfolio-intro-chips') {
                document.getElementById('block-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

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
}

function setupProfileNavigationMenu() {
    const navRoot = document.querySelector('weotzi-product-nav');
    const toggle = document.getElementById('profile-product-menu-toggle');
    const menu = document.getElementById('profile-product-mobile-menu');
    const setState = window.ArtistProfilePresentation?.setDisclosureState;
    if (!navRoot || !toggle || !menu || !setState || toggle.dataset.profileMenuBound === 'true') return;

    const closeMenu = (restoreFocus = false) => {
        setState(toggle, menu, false);
        if (restoreFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => {
        setState(toggle, menu, toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', (event) => {
        if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('click', (event) => {
        if (!navRoot.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') closeMenu(true);
    });

    toggle.dataset.profileMenuBound = 'true';
}

// Cierra sesión y vuelve al ingreso de quien miraba (artista o cliente).
async function handleProfileLogout() {
    const target = viewer.kind === 'client' ? '/client/login' : '/artist/login';
    try {
        await _supabase?.auth?.signOut?.();
    } finally {
        window.location.href = target;
    }
}

window.handleProfileLogout = handleProfileLogout;

/* ---------- Lightbox ---------- */

function handleGalleryActivation(event) {
    const item = event.target.closest('[data-gallery-index]');
    if (!item) return;
    const index = Number(item.dataset.galleryIndex);
    const selected = getVisibleGalleryItems()[index];
    if (!Number.isInteger(index) || !selected) return;
    trackProfileEvent('artwork_view', {
        artworkKey: selected.key || `work-${index + 1}`,
        artworkTitle: selected.title || `Trabajo ${index + 1}`
    }).catch(() => { /* noop */ });
    openLightbox(index);
}

function openLightbox(index) {
    if (!getVisibleGalleryItems().length) return;
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

    const visible = getVisibleGalleryItems();
    if (!visible.length) return;

    currentLightboxIndex += direction;
    if (currentLightboxIndex < 0) {
        currentLightboxIndex = visible.length - 1;
    } else if (currentLightboxIndex >= visible.length) {
        currentLightboxIndex = 0;
    }

    updateLightboxImage();
}

function updateLightboxImage() {
    const image = document.getElementById('lightbox-image');
    const video = document.getElementById('lightbox-video');
    const counter = document.getElementById('lightbox-counter');
    const visible = getVisibleGalleryItems();
    const item = visible[currentLightboxIndex];
    if (!item) return;

    if (item.kind === 'video') {
        image.style.display = 'none';
        image.src = '';
        video.style.display = 'block';
        video.src = item.url;
        video.load();
    } else {
        video.pause();
        video.style.display = 'none';
        video.removeAttribute('src');
        video.load();
        image.style.display = 'block';
        image.src = item.url;
        image.alt = item.caption || `Trabajo ${currentLightboxIndex + 1} de ${profileDisplayName()}`;
    }

    counter.textContent = `${currentLightboxIndex + 1} / ${visible.length}`;

    // Pie de foto completo del trabajo (ronda 2), si el ítem trae "caption".
    const caption = document.getElementById('lightbox-caption');
    if (caption) {
        caption.textContent = item.caption || '';
        caption.hidden = !item.caption;
    }
}

/* ---------- Estados de página ---------- */

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
