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

const ARTIST_PUBLIC_FIELDS = `${ARTIST_PUBLIC_FIELDS_LEGACY},studio_id,gallery_feed_items`;

// Figma: grilla de 3 columnas con 12 slots; nunca menos de 9 (3 filas llenas).
const MIN_GALLERY_SLOTS = 9;
const MAX_GALLERY_SLOTS = 12;
const GALLERY_PLACEHOLDER_SRC = '/shared/assets/placeholders/gallery-default.svg';
const PROFILE_MOBILE_MENU_BREAKPOINT = 768;
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
const REVIEW_AVATAR_COLORS = ['var(--ink)', 'var(--red-300)', 'var(--blue-300)'];
// Figma: triángulo de color rotando rojo → azul → amarillo por fila de residencia.
const PRESENCE_TONES = ['red', 'blue', 'yellow'];

const GALLERY_CATEGORY_LABELS = {
    realizados: 'Realizados',
    flash: 'Flash',
    proyectos: 'Proyectos'
};

let artistData = null;
let studioData = null;
let tattooLocations = [];
let publicProfilePreferences = {
    privacy: { show_city: true, show_rating: true, show_socials: true, allow_search_indexing: false },
    profile: {},
    availability: {}
};
let galleryItems = [];
let galleryFilter = GALLERY_ALL_FILTER;
let currentLightboxIndex = 0;
let reviewsWidgetMounted = false;
let portfolioAnalyticsObserver = null;
let errorSceneParallaxRaf = 0;
let errorSceneMotionShapes = [];

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

function normalizeUsernameFromUrl(username) {
    if (!username) return '';
    return username.endsWith('.wo') ? username : `${username}.wo`;
}

function formatRequestedArtist(value) {
    const normalized = normalizeUsernameFromUrl(String(value || '').trim().replace(/^@+/, ''));
    return normalized ? `@${normalized}` : '';
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

// `years_experience` viene como rango ("0-1", "5-10", "10+") o número suelto.
// El statstrip lo muestra crudo; la ficha lateral lo lee como "X años".
function formatExperienceStat(value) {
    return String(value || '').trim();
}

function formatExperienceFact(value) {
    const raw = formatExperienceStat(value);
    if (!raw) return '';
    return /años/i.test(raw) ? raw : `${raw} años`;
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
        let { data: artist, error } = await WeotziData.Artists.getPublicByExactUsername(searchUsername, ARTIST_PUBLIC_FIELDS);

        // Deploys sin studio_id / gallery_feed_items: reintento con el set legacy.
        if (error) {
            const retry = await WeotziData.Artists.getPublicByExactUsername(searchUsername, ARTIST_PUBLIC_FIELDS_LEGACY);
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
        [tattooLocations, studioData, publicProfilePreferences] = await Promise.all([
            loadArtistTattooLocations(artist.user_id),
            loadArtistStudio(artist.studio_id),
            loadPublicProfilePreferences(artist.user_id)
        ]);

        populateProfile();
        hideLoading();
        showContent();
        void renderArtistReviews();

        // Structured funnel telemetry (fire-and-forget, one event/hour).
        trackProfileEvent('profile_view').catch(() => { /* noop */ });
        setupPortfolioAnalytics();
    } catch (error) {
        console.error('Error loading artist data:', error);
        showError('technical', { requestedArtist: searchUsername });
    }
}

async function loadPublicProfilePreferences(artistUserId) {
    const fallback = {
        privacy: { show_city: true, show_rating: true, show_socials: true, allow_search_indexing: false },
        profile: {},
        availability: {}
    };
    if (!artistUserId || !_supabase?.rpc) return fallback;
    try {
        const { data, error } = await _supabase.rpc('get_artist_public_profile_preferences', {
            p_artist_user_id: artistUserId
        });
        if (error || !data || typeof data !== 'object') return fallback;
        return {
            privacy: { ...fallback.privacy, ...(data.privacy || {}) },
            profile: data.profile && typeof data.profile === 'object' ? data.profile : {},
            availability: data.availability && typeof data.availability === 'object' ? data.availability : {}
        };
    } catch (error) {
        console.warn('Public profile preferences unavailable:', error);
        return fallback;
    }
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

// Estudio del artista + tamaño del roster (único dato de la fila del Figma con
// fuente real; AMBIENTE y ACCESOS no existen como columnas).
async function loadArtistStudio(studioId) {
    if (!studioId || !WeotziData?.Studios?.getById) return null;

    try {
        const { data: studio, error } = await WeotziData.Studios.getById(
            studioId,
            'id, slug, name, cover_image, photo_feed_items, formatted_address, street, street_number, locality, city, country'
        );
        if (error || !studio) return null;

        let rosterCount = 0;
        try {
            const { data: roster } = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studio.id);
            rosterCount = Array.isArray(roster) ? roster.length : 0;
        } catch (rosterError) {
            console.warn('Studio roster unavailable:', rosterError);
        }

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

    renderPublicSocials(privacy, profileExtras);

    const verifiedIcon = document.getElementById('artist-verified-icon');
    if (verifiedIcon) {
        verifiedIcon.hidden = artistData.verification_state !== 'Yes';
    }

    renderStyles(styles);
    renderStats();
    renderSobreFacts();
    renderSpecialties(styles);
    renderStudio();
    renderGallery();
    renderPresence();
    renderCities();
    renderCtaMonths();
    renderActionbar(artisticName);
    setQuoteLinks();
    renderBio();
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

function socialProfileUrl(provider, value) {
    const handle = String(value || '').trim().replace(/^@+/, '');
    if (!handle) return '';
    if (provider === 'instagram') return `https://www.instagram.com/${encodeURIComponent(handle)}`;
    if (provider === 'tiktok') return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
    return '';
}

function renderPublicSocials(privacy, profileExtras) {
    const container = document.getElementById('hero-socials');
    if (!container) return;
    if (privacy.show_socials === false) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    const links = [
        ['Instagram', socialProfileUrl('instagram', artistData?.instagram)],
        ['TikTok', socialProfileUrl('tiktok', profileExtras?.tiktok)],
        ['Sitio web', safePublicHttpUrl(artistData?.portafolio)]
    ].filter((entry) => entry[1]);
    container.hidden = !links.length;
    container.innerHTML = links.map(([label, url]) => `
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>
    `).join('');
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

function renderBio() {
    const manifestoEl = document.getElementById('bio-manifesto');
    const bioTextEl = document.getElementById('bio-text');
    if (!bioTextEl) return;

    const bio = artistData?.bio_description || '';
    const hasLinks = window.BioFormatting
        ? /<a[\s>]/i.test(window.BioFormatting.sanitizeBioHtml(bio))
        : false;
    const plain = window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(bio)
        : String(bio).trim();
    const { manifesto, rest } = hasLinks ? { manifesto: '', rest: plain } : splitBioManifesto(plain);

    if (manifestoEl) {
        manifestoEl.hidden = !manifesto;
        manifestoEl.textContent = manifesto;
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
 * CTA dual del funnel (Figma): "Reservar sesión →" abre el wizard de cotización
 * (`/quotation`, misma ruta que el badge AGENDA ABIERTA de residencias) y
 * "Solicitar cotización" lleva al listado (`/quotations`).
 */
function setQuoteLinks() {
    const quotationUrl = getQuotationUrl();
    const reserveUrl = getQuotationFormUrl();

    for (const id of ['quote-cta-top-btn', 'quote-cta-bar-btn', 'profile-header-quote-link', 'profile-mobile-quote-link']) {
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
 * Statstrip. El Figma pide 4 métricas; solo `AÑOS TATUANDO` (years_experience) y
 * `CALIFICACIÓN` (public_review_summary) tienen fuente real — TATUAJES y TASA DE
 * RESPUESTA no existen como columnas y quedan fuera.
 */
function renderStats() {
    const experienceCell = document.getElementById('statcell-experience');
    const experience = formatExperienceStat(artistData?.years_experience);

    if (experienceCell) {
        experienceCell.hidden = !experience;
        if (experience) setText('display-experience', experience);
    }

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
 * MÍNIMA / TIEMPO DE RESPUESTA; las tres primeras existen en artists_db, la
 * cuarta no tiene columna y se omite.
 */
function renderSobreFacts() {
    const experience = formatExperienceFact(artistData?.years_experience);
    const languages = Array.isArray(artistData?.languages) ? artistData.languages.filter(Boolean) : [];
    const price = String(artistData?.session_price || '').trim();

    toggleFact('fact-experience', 'display-experience-fact', experience);
    toggleFact('fact-languages', 'display-languages', languages.length ? languages.join(' · ') : '');
    toggleFact('fact-price', 'display-price', price);
}

function toggleFact(wrapperId, valueId, value) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    wrapper.hidden = !value;
    if (value) setText(valueId, value);
}

/**
 * Tabla de Especialidades: numeral + cuadrado de color + nombre del estilo, todo
 * derivado de `styles_array`. La descripción y la miniatura por estilo del Figma
 * no tienen fuente (el catálogo guarda solo label/value) y se omiten.
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
    table.innerHTML = styles.map((styleName, index) => `
        <div class="specialty-row">
            <span class="specialty-index">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
            <span class="specialty-swatch" style="--specialty-color: ${SPECIALTY_COLORS[index % SPECIALTY_COLORS.length]}" aria-hidden="true"></span>
            <p class="specialty-name">${escapeHtml(styleName)}</p>
        </div>
    `).join('');
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
 * Portafolio: una sola tabla de trabajos con chips de filtro. Los chips filtran
 * por categoría de `gallery_feed_items` (dato real); el filtrado por estilo del
 * Figma necesitaría etiquetar cada imagen con su estilo.
 */
function normalizeGalleryItems() {
    const items = [];
    const seen = new Set();

    for (const raw of parseJsonArray(artistData?.gallery_feed_items)) {
        const url = String(raw?.url || '').trim();
        if (!url || seen.has(url)) continue;
        const category = GALLERY_CATEGORY_LABELS[String(raw?.category || '').toLowerCase()]
            ? String(raw.category).toLowerCase()
            : 'realizados';
        const key = String(raw?.id || raw?.key || url.split('?')[0].split('/').pop() || `work-${items.length + 1}`);
        const title = String(raw?.title || raw?.name || `${GALLERY_CATEGORY_LABELS[category]} ${items.length + 1}`);
        items.push({ url, key, title, category, kind: raw?.kind === 'video' || isUrlVideo(url) ? 'video' : 'image' });
        seen.add(url);
    }

    if (!items.length) {
        for (const entry of parseJsonArray(artistData?.gallery_images)) {
            const url = typeof entry === 'string' ? entry.trim() : String(entry?.url || '').trim();
            if (!url || seen.has(url)) continue;
            const raw = typeof entry === 'object' && entry ? entry : {};
            const key = String(raw.id || raw.key || url.split('?')[0].split('/').pop() || `work-${items.length + 1}`);
            const title = String(raw.title || raw.name || `Trabajo ${items.length + 1}`);
            items.push({ url, key, title, category: 'realizados', kind: isUrlVideo(url) ? 'video' : 'image' });
            seen.add(url);
        }
    }

    return items;
}

function getVisibleGalleryItems() {
    if (galleryFilter === GALLERY_ALL_FILTER) return galleryItems;
    return galleryItems.filter((item) => item.category === galleryFilter);
}

function renderGalleryChips() {
    const chips = document.getElementById('gallery-chips');
    if (!chips) return;

    const categories = Array.from(new Set(galleryItems.map((item) => item.category)));
    if (categories.length < 2) {
        chips.hidden = true;
        chips.innerHTML = '';
        galleryFilter = GALLERY_ALL_FILTER;
        return;
    }

    chips.hidden = false;
    const options = [{ value: GALLERY_ALL_FILTER, label: 'Todos' }]
        .concat(categories.map((category) => ({ value: category, label: GALLERY_CATEGORY_LABELS[category] || category })));

    chips.innerHTML = options.map((option) => `
        <button type="button" class="gallery-chip${option.value === galleryFilter ? ' is-active' : ''}" data-gallery-filter="${escapeHtml(option.value)}" aria-pressed="${option.value === galleryFilter}">${escapeHtml(option.label)}</button>
    `).join('');
}

function renderGallery() {
    galleryItems = normalizeGalleryItems();
    renderGalleryChips();
    renderGalleryGrid();
}

function renderGalleryGrid() {
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');
    const viewAllBtn = document.getElementById('gallery-view-all-btn');
    if (!galleryGrid) return;

    const visible = getVisibleGalleryItems();
    if (galleryEmpty) galleryEmpty.style.display = visible.length ? 'none' : 'block';

    const slotCount = Math.min(
        MAX_GALLERY_SLOTS,
        Math.max(MIN_GALLERY_SLOTS, Math.ceil(visible.length / 3) * 3)
    );

    let html = '';
    for (let index = 0; index < slotCount; index += 1) {
        const item = visible[index];
        if (item) {
            html += `
                <button type="button" class="gallery-image-item" data-gallery-index="${index}" aria-label="Abrir trabajo ${index + 1}">
                    ${item.kind === 'video'
                        ? `<video src="${escapeHtml(item.url)}" preload="metadata" muted playsinline></video><span class="gallery-play-overlay"><i data-wo-icon="play" class="wo-icon-18" aria-hidden="true"></i></span>`
                        : `<img src="${escapeHtml(item.url)}" alt="Trabajo ${index + 1}" loading="lazy" width="1200" height="800">`}
                    <span class="gallery-overlay"><span>Ver</span><span>${String(index + 1).padStart(2, '0')}</span></span>
                </button>
            `;
        } else {
            html += `
                <div class="gallery-image-item is-placeholder" aria-hidden="true">
                    <img src="${GALLERY_PLACEHOLDER_SRC}" alt="" loading="lazy" width="1200" height="800">
                    <span class="gallery-placeholder-meta"><span>Disponible</span><span>Slot libre</span></span>
                </div>
            `;
        }
    }

    galleryGrid.innerHTML = html;

    if (viewAllBtn) {
        viewAllBtn.style.display = galleryItems.length ? 'inline-flex' : 'none';
    }
}

/**
 * Próximas residencias: una sola tabla (sin separar actual/próximo). La línea
 * secundaria usa el nombre del estudio — `artist_tattoo_locations` no guarda país.
 */
function renderPresence() {
    const band = document.getElementById('presence-band');
    const table = document.getElementById('presence-table');
    if (!band || !table) return;

    if (!tattooLocations.length) {
        band.hidden = true;
        table.innerHTML = '';
        return;
    }

    band.hidden = false;
    const quoteFormUrl = getQuotationFormUrl();

    table.innerHTML = tattooLocations.map((location, index) => {
        const badge = resolvePresenceBadge(location);
        const dates = formatResidencyRange(location.start_date, location.end_date);
        const badgeHtml = badge.state === 'open'
            ? `<a class="presence-badge" data-state="open" href="${escapeHtml(quoteFormUrl)}">${escapeHtml(badge.label)}</a>`
            : `<span class="presence-badge" data-state="${escapeHtml(badge.state)}">${escapeHtml(badge.label)}</span>`;

        return `
            <div class="presence-row">
                <div class="presence-place">
                    <span class="presence-tri" data-tone="${PRESENCE_TONES[index % PRESENCE_TONES.length]}" aria-hidden="true"></span>
                    <div>
                        <p class="presence-city">${escapeHtml(location.city || location.studio_name || '-')}</p>
                        ${location.city && location.studio_name ? `<p class="presence-venue">${escapeHtml(location.studio_name)}</p>` : ''}
                    </div>
                </div>
                <div class="presence-when">
                    ${dates ? `<span class="presence-dates">${escapeHtml(dates)}</span>` : ''}
                    ${badgeHtml}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * "Dónde tatué": ciudades únicas del artista (base + residencias cargadas),
 * en bloque tipográfico con colores alternados.
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
    const cities = [];
    const seen = new Set();

    for (const candidate of [location.city, ...tattooLocations.map((item) => item.city)]) {
        const city = normalizeCityName(candidate);
        if (!city || city === '-') continue;
        const key = city.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cities.push(city);
    }

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
}

function hasOpenAgenda() {
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

    if (dot) dot.hidden = !isOpen;
    if (status) {
        status.hidden = !isOpen;
        status.textContent = isOpen ? 'Agenda abierta' : '';
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
            cards.innerHTML = quotes.map((review, index) => `
                <article class="review-quote-card">
                    <p class="review-quote-text">“${escapeHtml(review.comment || '')}”</p>
                    <div class="review-quote-author">
                        <span class="review-quote-avatar" style="--review-avatar-bg: ${REVIEW_AVATAR_COLORS[index % REVIEW_AVATAR_COLORS.length]}" aria-hidden="true">${escapeHtml(getReviewInitials(review.reviewer_display_name))}</span>
                        <span>
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

    document.getElementById('gallery-chips')?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-gallery-filter]');
        if (!chip) return;
        galleryFilter = chip.dataset.galleryFilter || GALLERY_ALL_FILTER;
        renderGalleryChips();
        renderGalleryGrid();
    });

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
    }

    counter.textContent = `${currentLightboxIndex + 1} / ${visible.length}`;
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
