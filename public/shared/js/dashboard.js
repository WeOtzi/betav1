// ============================================
// WE ÖTZI - Artist Dashboard Logic
// Authentication, data management, and profile editing
// Connected to Supabase artists_db
// ============================================

let _supabase = null;
let dashboardAuthUrls = {
    registerClosedBeta: '/registerclosedbeta',
    login: '/registerclosedbeta',
    registerArtist: '/register-artist',
    dashboard: '/artist/dashboard',
    jobBoard: '/job-board'
};

// Current user and artist data
let currentUser = null;
let artistData = null;
let isEditMode = false;
let dashboardStudioId = null;
let dashboardSelectedStyles = [];
let artistTattooLocations = [];
let tattooLocationDrafts = [];
let dashboardStudioSearchTimeout = null;
let dashboardStudioAutocompleteInit = false;
let placesAutocompleteDashboard = null;
let currentQRUrl = '';         // URL actualmente mostrada en el modal QR
let currentQRDest = 'profile'; // Destino activo del QR: 'profile' | 'gallery'
let upcomingTravelModalEditIndex = null;
let upcomingTravelStudioAutocompleteInit = false;
let upcomingTravelCityAutocompleteInit = false;
let upcomingTravelStudioSearchTimeout = null;
let upcomingTravelCitySearchTimeout = null;
const currentLocationAutocompleteTimers = new Map();

const AGENDA_STATUS_LABELS = {
    open: 'Abierta',
    closed: 'Cerrada'
};

const ONBOARDING_MILESTONES = [
    { field: 'ms_profile_complete', label: 'Completa tu perfil' },
    { field: 'ms_first_quote_received', label: 'Recibe tu primera cotizacion' },
    { field: 'ms_whatsapp_shared', label: 'Comparte tu enlace de WhatsApp' },
    { field: 'ms_profile_shared', label: 'Comparte tu perfil publico' }
];
const VERIFICATION_TASKS = [
    { key: 'onboarding_started', label: 'EMPIEZA CON WE OTZI' },
    { key: 'request_sent', label: 'SOLICITUD ENVIADA' }
];

const BANNER_NOTICE_ONBOARDING = 'onboarding';
const BANNER_NOTICE_VERIFICATION = 'verification';
const BANNER_ROTATION_INTERVAL_MS = 7000;
const DASHBOARD_ARTIST_QUERY_TIMEOUT_MS = 8000;
const DASHBOARD_AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;
const DASHBOARD_SUPABASE_FALLBACK = {
    url: 'https://flbgmlvfiejfttlawnfu.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJmbGJn' +
        'bWx2ZmllamZ0dGxhd25mdSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzQ1OTEyNTg5LCJleHAiOjIwNjE0ODg1ODl9.' +
        'AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888'
};
const DASHBOARD_ARTIST_SELECT = [
    'id',
    'user_id',
    'username',
    'name',
    'email',
    'ubicacion',
    'city',
    'country',
    'country_code',
    'state_province',
    'locality',
    'street',
    'street_number',
    'unit',
    'postal_code',
    'formatted_address',
    'latitude',
    'longitude',
    'google_place_id',
    'styles_array',
    'estilo',
    'years_experience',
    'session_price',
    'session_price_amount',
    'session_price_currency',
    'preferred_display_currency',
    'portafolio',
    'instagram',
    'whatsapp_number',
    'whatsapp_url',
    'work_type',
    'estudios',
    'studio_id',
    'birth_date',
    'subscribed_newsletter',
    'bio_description',
    'profile_picture',
    'gallery_images',
    'gallery_feed_items',
    'embajador',
    'nivel',
    'verification_state',
    'ms_profile_complete',
    'ms_first_quote_received',
    'ms_first_quote_completed',
    'ms_whatsapp_shared',
    'ms_profile_shared',
    'profile_completeness'
].join(', ');

let bannerRotationIntervalId = null;
let bannerStateInitialized = false;
let bannerUIState = {
    expanded: false,
    activeNotice: BANNER_NOTICE_ONBOARDING
};
const DASHBOARD_MOBILE_MENU_BREAKPOINT = 768;

function getBannerStorageKey() {
    const userId = currentUser?.id || 'anonymous';
    return `wo:artist-dashboard:top-banner:${userId}`;
}

function readBannerPrefs() {
    const defaults = {
        expanded: false,
        activeNotice: BANNER_NOTICE_ONBOARDING
    };
    try {
        const raw = localStorage.getItem(getBannerStorageKey());
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        return {
            expanded: Boolean(parsed?.expanded),
            activeNotice: parsed?.activeNotice || BANNER_NOTICE_ONBOARDING
        };
    } catch (error) {
        return defaults;
    }
}

function persistBannerPrefs() {
    try {
        localStorage.setItem(getBannerStorageKey(), JSON.stringify({
            expanded: Boolean(bannerUIState.expanded),
            activeNotice: bannerUIState.activeNotice || BANNER_NOTICE_ONBOARDING
        }));
    } catch (error) {
        console.warn('Could not persist banner preferences:', error);
    }
}

function ensureBannerStateInitialized() {
    if (bannerStateInitialized) return;
    const prefs = readBannerPrefs();
    bannerUIState = {
        expanded: Boolean(prefs.expanded),
        activeNotice: prefs.activeNotice || BANNER_NOTICE_ONBOARDING
    };
    bannerStateInitialized = true;
}

function getAvailableBannerNotices() {
    const notices = [BANNER_NOTICE_ONBOARDING];
    const embajadorValue = (artistData?.embajador || '').toLowerCase();
    const verificationState = artistData?.verification_state || 'No';
    const shouldShowVerificationNotice = embajadorValue !== 'si' && verificationState !== 'Yes';
    if (shouldShowVerificationNotice) {
        notices.push(BANNER_NOTICE_VERIFICATION);
    }
    return notices;
}

function sanitizeBannerNotice(notice) {
    const availableNotices = getAvailableBannerNotices();
    return availableNotices.includes(notice) ? notice : availableNotices[0];
}

function getOnboardingProgress() {
    const total = ONBOARDING_MILESTONES.length;
    const completed = ONBOARDING_MILESTONES.reduce((acc, milestone) => (
        acc + (artistData?.[milestone.field] ? 1 : 0)
    ), 0);
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percentage };
}

function getVerificationTaskStatuses() {
    const onboardingCompleted = Boolean(artistData?.ms_profile_complete);
    const verificationState = artistData?.verification_state || 'No';
    const requestSentStates = ['Requested', 'In Progress', 'In Analysis', 'Yes'];
    return {
        onboarding_started: onboardingCompleted,
        request_sent: requestSentStates.includes(verificationState)
    };
}

function getVerificationBannerMeta() {
    const state = artistData?.verification_state || 'No';
    const embajadorValue = (artistData?.embajador || '').toLowerCase();
    const stateText = (VERIFICATION_STATES[state]?.text || VERIFICATION_STATES.No.text).toUpperCase();
    if (embajadorValue === 'pendiente') {
        return `EMBAJADOR PENDIENTE · ${stateText}`;
    }
    return stateText;
}

function stopBannerRotation() {
    if (bannerRotationIntervalId) {
        clearInterval(bannerRotationIntervalId);
        bannerRotationIntervalId = null;
    }
}

function cycleBannerNotice(direction = 1) {
    const availableNotices = getAvailableBannerNotices();
    if (availableNotices.length < 2) return;

    const currentNotice = sanitizeBannerNotice(bannerUIState.activeNotice);
    const currentIndex = availableNotices.indexOf(currentNotice);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + availableNotices.length) % availableNotices.length;

    bannerUIState.activeNotice = availableNotices[nextIndex];
    persistBannerPrefs();
    renderTopBanner();
}

function restartBannerRotation() {
    stopBannerRotation();
    if (!artistData) return;
    if (bannerUIState.expanded) return;

    const availableNotices = getAvailableBannerNotices();
    if (availableNotices.length < 2) return;

    bannerRotationIntervalId = window.setInterval(() => {
        cycleBannerNotice(1);
    }, BANNER_ROTATION_INTERVAL_MS);
}

function renderTopBanner() {
    if (!artistData) return;

    const banner = document.getElementById('verification-pending-banner');
    const shell = document.getElementById('banner-shell');
    const tabOnboarding = document.getElementById('banner-tab-onboarding');
    const tabVerification = document.getElementById('banner-tab-verification');
    const prevBtn = document.getElementById('banner-prev-btn');
    const nextBtn = document.getElementById('banner-next-btn');
    const toggleBtn = document.getElementById('verification-banner-toggle-btn');
    const toggleLabel = document.getElementById('banner-toggle-label');
    const summaryTitle = document.getElementById('banner-summary-title');
    const summaryMeta = document.getElementById('banner-summary-meta');
    const progressFill = document.getElementById('banner-progress-fill');
    const expandedContent = document.getElementById('banner-expanded-content');
    const checklistEl = document.getElementById('banner-onboarding-checklist');
    const onboardingPanel = document.getElementById('banner-panel-onboarding');
    const verificationPanel = document.getElementById('banner-panel-verification');
    const verificationChecklistEl = document.getElementById('banner-verification-checklist');

    if (!banner || !shell || !summaryTitle || !summaryMeta || !progressFill || !expandedContent || !checklistEl) {
        return;
    }

    ensureBannerStateInitialized();
    banner.style.display = 'block';

    const availableNotices = getAvailableBannerNotices();
    const activeNotice = sanitizeBannerNotice(bannerUIState.activeNotice);
    if (activeNotice !== bannerUIState.activeNotice) {
        bannerUIState.activeNotice = activeNotice;
        persistBannerPrefs();
    }

    const isExpanded = Boolean(bannerUIState.expanded);
    const { completed, total, percentage } = getOnboardingProgress();
    const hasVerificationNotice = availableNotices.includes(BANNER_NOTICE_VERIFICATION);
    const isVerificationActive = activeNotice === BANNER_NOTICE_VERIFICATION;

    checklistEl.innerHTML = ONBOARDING_MILESTONES.map((milestone) => {
        const isCompleted = Boolean(artistData?.[milestone.field]);
        return `
            <li class="banner-checklist-item ${isCompleted ? 'is-completed' : ''}">
                <span class="banner-checklist-label">${milestone.label}</span>
                <span class="banner-check-indicator" aria-hidden="true">${isCompleted ? '✓' : ''}</span>
            </li>
        `;
    }).join('');

    if (verificationChecklistEl) {
        const verificationTaskStatus = getVerificationTaskStatuses();
        verificationChecklistEl.innerHTML = VERIFICATION_TASKS.map((task) => {
            const isCompleted = Boolean(verificationTaskStatus[task.key]);
            return `
                <li class="banner-checklist-item ${isCompleted ? 'is-completed' : ''}">
                    <span class="banner-checklist-label">${task.label}</span>
                    <span class="banner-check-indicator" aria-hidden="true">${isCompleted ? '✓' : ''}</span>
                </li>
            `;
        }).join('');
    }

    if (isVerificationActive) {
        summaryTitle.textContent = 'ESTADO DE VERIFICACION';
        summaryMeta.textContent = getVerificationBannerMeta();
    } else {
        summaryTitle.textContent = completed >= total ? 'ONBOARDING COMPLETO' : 'EMPIEZA CON WE OTZI';
        summaryMeta.textContent = `${completed}/${total} TAREAS`;
    }

    progressFill.style.width = `${percentage}%`;

    shell.dataset.expanded = String(isExpanded);
    shell.dataset.activeNotice = activeNotice;
    shell.classList.toggle('is-verification', isVerificationActive);

    expandedContent.hidden = !isExpanded;
    if (onboardingPanel) onboardingPanel.hidden = isVerificationActive;
    if (verificationPanel) verificationPanel.hidden = !isVerificationActive;

    if (tabOnboarding) {
        tabOnboarding.classList.toggle('is-active', !isVerificationActive);
        tabOnboarding.setAttribute('aria-selected', String(!isVerificationActive));
    }
    if (tabVerification) {
        tabVerification.style.display = hasVerificationNotice ? 'inline-flex' : 'none';
        tabVerification.classList.toggle('is-active', isVerificationActive);
        tabVerification.setAttribute('aria-selected', String(isVerificationActive));
    }

    const hasMultipleNotices = availableNotices.length > 1;
    if (prevBtn) {
        prevBtn.disabled = !hasMultipleNotices;
        prevBtn.style.display = hasMultipleNotices ? 'inline-flex' : 'none';
    }
    if (nextBtn) {
        nextBtn.disabled = !hasMultipleNotices;
        nextBtn.style.display = hasMultipleNotices ? 'inline-flex' : 'none';
    }

    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(isExpanded));
    }
    if (toggleLabel) {
        if (isExpanded) {
            toggleLabel.textContent = 'Ocultar';
        } else {
            toggleLabel.textContent = isVerificationActive ? 'Ver estado' : 'Ver tareas';
        }
    }

    restartBannerRotation();
}

function setBannerExpanded(expanded) {
    bannerUIState.expanded = Boolean(expanded);
    persistBannerPrefs();
    renderTopBanner();
}

function setBannerActiveNotice(notice) {
    bannerUIState.activeNotice = sanitizeBannerNotice(notice);
    persistBannerPrefs();
    renderTopBanner();
}

function setDashboardMobileMenuOpen(isOpen) {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;

    const shouldOpen = Boolean(isOpen);
    menu.hidden = !shouldOpen;
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function setupDashboardNavigationMenu() {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;

    setDashboardMobileMenuOpen(false);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
        setDashboardMobileMenuOpen(shouldOpen);
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            setDashboardMobileMenuOpen(false);
        });
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        const clickInsideMenu = menu.contains(event.target);
        const clickOnToggle = toggleBtn.contains(event.target);
        if (!clickInsideMenu && !clickOnToggle) {
            setDashboardMobileMenuOpen(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > DASHBOARD_MOBILE_MENU_BREAKPOINT) {
            setDashboardMobileMenuOpen(false);
        }
    });
}

function getDashboardSupabaseConfig() {
    const configFromManager = (() => {
        try {
            if (!window.ConfigManager) return {};
            const current = typeof window.ConfigManager.get === 'function'
                ? window.ConfigManager.get()
                : null;
            return {
                url: typeof window.ConfigManager.getValue === 'function'
                    ? window.ConfigManager.getValue('supabase.url')
                    : current?.supabase?.url,
                anonKey: typeof window.ConfigManager.getValue === 'function'
                    ? window.ConfigManager.getValue('supabase.anonKey')
                    : current?.supabase?.anonKey
            };
        } catch (_) {
            return {};
        }
    })();

    return {
        url: configFromManager.url || window.CONFIG?.supabase?.url || DASHBOARD_SUPABASE_FALLBACK.url,
        anonKey: configFromManager.anonKey || window.CONFIG?.supabase?.anonKey || DASHBOARD_SUPABASE_FALLBACK.anonKey
    };
}

function getDashboardSupabaseProjectRef(supabaseUrl) {
    try {
        return new URL(supabaseUrl).hostname.split('.')[0] || '';
    } catch (_) {
        return '';
    }
}

function readStoredDashboardSession() {
    try {
        const { url } = getDashboardSupabaseConfig();
        const projectRef = getDashboardSupabaseProjectRef(url);
        if (!projectRef) return null;

        const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const session = parsed?.currentSession || parsed?.session || parsed;
        if (!session?.user?.id || !session.access_token) return null;

        const expiresAt = Number(session.expires_at || 0);
        if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) return null;
        return session;
    } catch (error) {
        console.warn('[dashboard] Stored session recovery failed:', error);
        return null;
    }
}

function createDashboardSupabaseClient(session = null) {
    if (typeof window.supabase === 'undefined') return null;
    if (_supabase && (!session?.access_token || _supabase.__dashboardSessionToken === session.access_token)) {
        return _supabase;
    }

    const { url, anonKey } = getDashboardSupabaseConfig();
    if (!url || !anonKey) return null;

    const options = session?.access_token
        ? { global: { headers: { Authorization: `Bearer ${session.access_token}` } } }
        : undefined;

    _supabase = window.supabase.createClient(url, anonKey, options);
    _supabase.__dashboardSessionToken = session?.access_token || '';
    window._supabase = _supabase;
    return _supabase;
}

async function fetchDashboardArtistViaRest(session) {
    if (!session?.user?.id || typeof fetch !== 'function') return null;
    const { url, anonKey } = getDashboardSupabaseConfig();
    if (!url || !anonKey) return null;

    const params = new URLSearchParams({
        select: DASHBOARD_ARTIST_SELECT,
        user_id: `eq.${session.user.id}`
    });

    const response = await withDashboardTimeout(fetch(`${url}/rest/v1/artists_db?${params.toString()}`, {
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${session.access_token}`
        }
    }), DASHBOARD_ARTIST_QUERY_TIMEOUT_MS, 'Stored session artist REST query');

    if (response?.dashboardTimedOut || !response?.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function bootstrapDashboardFromStoredSession() {
    const session = readStoredDashboardSession();
    if (!session?.user) return false;

    const supabaseClient = createDashboardSupabaseClient(session);
    if (!supabaseClient) return false;

    const artist = await fetchDashboardArtistViaRest(session);
    if (!artist?.name) return false;

    currentUser = session.user;
    window.currentUser = currentUser;

    await loadArtistData(artist);
    try {
        window.dispatchEvent(new CustomEvent('wo:dashboard-ready', {
            detail: { currentUser, supabase: _supabase, artistData }
        }));
    } catch (_) { /* ignore */ }

    return true;
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupEventListeners();
    setupGalleryListeners();
    restoreZoomPreference();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopBannerRotation();
    } else {
        restartBannerRotation();
    }
});

async function initializeDashboard() {
    try {
        if (!window.ArtistAuth || typeof window.ArtistAuth.resolveArtistAuthState !== 'function') {
            throw new Error('ArtistAuth helper is not available.');
        }

        if (await bootstrapDashboardFromStoredSession()) {
            return;
        }

        // Dashboard accepts existing artist rows even when onboarding milestones
        // are incomplete; the page itself surfaces profile completion tasks.
        const authState = await withDashboardTimeout(window.ArtistAuth.resolveArtistAuthState({
            artistSelect: 'user_id, username, name',
            returnTo: '/artist/dashboard',
            fallbackReturnTo: '/artist/dashboard'
        }), DASHBOARD_AUTH_BOOTSTRAP_TIMEOUT_MS, 'Artist auth resolver');

        if (authState.dashboardTimedOut) {
            if (await bootstrapDashboardFromStoredSession()) {
                return;
            }
            console.warn('[dashboard] Artist auth resolver timed out.');
            window.location.href = dashboardAuthUrls.login;
            return;
        }

        if (authState.urls) {
            dashboardAuthUrls = authState.urls;
        }

        _supabase = authState.supabase;

        if (authState.status === 'anonymous') {
            console.log('No authenticated session found. Redirecting to login...');
            window.location.href = dashboardAuthUrls.login;
            return;
        }

        if (authState.status === 'authenticated_non_artist' || authState.status === 'profile_incomplete') {
            console.log('Artist profile missing or incomplete. Redirecting to registration...');
            window.location.href = dashboardAuthUrls.registerArtist;
            return;
        }

        if (!authState.currentUser || !_supabase) {
            throw new Error(`Dashboard auth bootstrap failed with status: ${authState.status}`);
        }

        currentUser = authState.currentUser;
        window._supabase = _supabase;
        window.currentUser = currentUser;
        console.log('User authenticated:', currentUser.email);

        // Load artist data. ArtistAuth already fetched a minimal row; use it as
        // the first paint and enrich it below with the full dashboard payload.
        await loadArtistData(authState.artist);

        // Notify other modules (e.g., visitors-map) that the dashboard is bootstrapped
        try {
            window.dispatchEvent(new CustomEvent('wo:dashboard-ready', {
                detail: { currentUser, supabase: _supabase, artistData }
            }));
        } catch (_) { /* CustomEvent not supported — ignore */ }

    } catch (error) {
        console.error('Dashboard initialization error:', error);
        window.location.href = dashboardAuthUrls.registerClosedBeta;
    }
}

// ============================================
// DATA LOADING
// ============================================

function runDashboardStep(label, fn) {
    try {
        const result = fn();
        if (result && typeof result.catch === 'function') {
            result.catch((error) => {
                console.error(`[dashboard] ${label} failed:`, error);
            });
        }
        return result;
    } catch (error) {
        console.error(`[dashboard] ${label} failed:`, error);
        return null;
    }
}

function withDashboardTimeout(promise, timeoutMs, label) {
    let timeoutId = null;
    const timeout = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            resolve({
                dashboardTimedOut: true,
                error: {
                    code: 'DASHBOARD_TIMEOUT',
                    message: `${label} timed out after ${timeoutMs}ms`
                }
            });
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function applyDashboardArtistData(artist) {
    if (!artist || !artist.name) return false;

    artistData = {
        ...(artistData || {}),
        ...artist
    };
    window.artistData = artistData;

    // Render the primary dashboard as soon as an artist row is available.
    // Optional/secondary reads below must not leave the whole surface in
    // "Cargando..." if they are slow, blocked by RLS, or missing columns.
    runDashboardStep('sync gallery feed', () => syncDashboardGalleryFromFeed(normalizeDashboardGalleryFeedItems()));
    runDashboardStep('populate dashboard shell', populateDashboard);
    runDashboardStep('populate quotes', populateQuotes);
    runDashboardStep('update level badge', updateLevelBadge);
    runDashboardStep('update milestones UI', updateMilestonesUI);
    runDashboardStep('check profile completion', checkProfileCompletion);
    runDashboardStep('render gallery admin', renderGalleryAdmin);
    runDashboardStep('mount instagram import', mountInstagramImportInDashboard);

    return true;
}

async function loadArtistData(initialArtist = null) {
    if (!currentUser) return;

    try {
        const renderedInitialArtist = applyDashboardArtistData(initialArtist);
        const { data: artist, error, dashboardTimedOut } = await withDashboardTimeout(_supabase
            .from('artists_db')
            .select(DASHBOARD_ARTIST_SELECT)
            .eq('user_id', currentUser.id)
            .maybeSingle(), DASHBOARD_ARTIST_QUERY_TIMEOUT_MS, 'Full artist dashboard query');

        if (dashboardTimedOut) {
            console.warn('[dashboard] Full artist row query timed out; keeping initial artist payload.');
            return;
        }

        if (error && error.code !== 'PGRST116') {
            console.error('Error loading artist data:', error);
            return;
        }

        if (!artist || !artist.name) {
            if (renderedInitialArtist) return;
            // No profile found, redirect to registration
            console.log('No artist profile found. Redirecting to registration...');
            window.location.href = dashboardAuthUrls.registerArtist;
            return;
        }

        applyDashboardArtistData(artist);

        // If the artist is affiliated with a studio, fetch its address so the
        // editor can pre-fill the AddressPicker. Independent artists already
        // have their address fields on artist row (no separate fetch needed).
        if (artist.studio_id && (artist.work_type === 'studio' || artist.work_type === 'both')) {
            try {
                const { data: studio } = await _supabase
                    .from('studios')
                    .select('country, country_code, state_province, city, locality, street, street_number, unit, postal_code, formatted_address, latitude, longitude, google_place_id')
                    .eq('id', artist.studio_id)
                    .maybeSingle();
                if (studio) dashboardAddressDraft = studio;
            } catch (studioErr) {
                console.warn('[dashboard] Could not load studio address:', studioErr);
            }
        }

        runDashboardStep('refresh tattoo locations', async () => {
            await loadArtistTattooLocations();
            populateDashboard();
        });

    } catch (error) {
        console.error('Error loading artist data:', error);
    }
}

// ============================================
// Instagram Import (mode: dashboard)
// Lets the logged-in artist sync new media + bio from their public IG
// profile after the initial signup. Uses the same component as the wizard
// but in dashboard mode → server downloads media to Storage and patches
// the row directly. Existing items are deduplicated by IG permalink.
// ============================================
let _igImportDashboardMounted = false;
function mountInstagramImportInDashboard() {
    if (_igImportDashboardMounted) return;
    if (typeof window.IGImport?.mount !== 'function') return;
    if (!currentUser) return;
    const container = document.getElementById('ig-import-mount-dashboard');
    if (!container) return;

    const handle = (artistData?.instagram || '').replace(/^@/, '');

    window.IGImport.mount(container, {
        target: 'artist',
        targetId: currentUser.id,
        mode: 'dashboard',
        prefillHandle: handle,
        onComplete: async () => {
            // Refresh local state and rerender the gallery so imported items appear.
            await loadArtistData().catch(() => {});
        }
    });
    _igImportDashboardMounted = true;
}

async function loadArtistTattooLocations() {
    if (!currentUser || !_supabase) return;

    try {
        const { data, error } = await _supabase
            .from('artist_tattoo_locations')
            .select('*')
            .eq('artist_user_id', currentUser.id)
            .order('sort_order', { ascending: true })
            .order('start_date', { ascending: true, nullsFirst: true });

        if (error) {
            console.error('Error loading artist tattoo locations:', error);
            artistTattooLocations = [];
            tattooLocationDrafts = [];
            return;
        }

        const list = Array.isArray(data) ? data : [];
        list.sort((a, b) => {
            const aTypeRank = a.period_type === 'current' ? 0 : 1;
            const bTypeRank = b.period_type === 'current' ? 0 : 1;
            if (aTypeRank !== bTypeRank) return aTypeRank - bTypeRank;
            const aOrder = Number.isFinite(a.sort_order) ? a.sort_order : 0;
            const bOrder = Number.isFinite(b.sort_order) ? b.sort_order : 0;
            if (aOrder !== bOrder) return aOrder - bOrder;
            const aDate = a.start_date || '';
            const bDate = b.start_date || '';
            return aDate.localeCompare(bDate);
        });

        artistTattooLocations = list;
        tattooLocationDrafts = list.map(normalizeTattooLocationRecord);
    } catch (error) {
        console.error('Error loading artist tattoo locations:', error);
        artistTattooLocations = [];
        tattooLocationDrafts = [];
    }
}

function normalizeTattooLocationRecord(record) {
    return {
        id: record?.id || null,
        period_type: record?.period_type === 'upcoming' ? 'upcoming' : 'current',
        studio_id: record?.studio_id || null,
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
    const startLabel = start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    const endLabel = end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${startLabel} - ${endLabel}`;
}

function escapeHtml(value) {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderTattooPresenceGroup(containerId, locations, isUpcoming) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!locations.length) {
        container.innerHTML = '<p class="tattoo-presence-empty">Sin estudios cargados.</p>';
        return;
    }

    container.innerHTML = locations.map((location) => {
        const cityLine = location.city
            ? `<p class="tattoo-presence-line"><span class="tattoo-presence-key">Ciudad:</span><span class="tattoo-presence-value">${escapeHtml(location.city)}</span></p>`
            : '';
        const dateLine = isUpcoming
            ? `<p class="tattoo-presence-line"><span class="tattoo-presence-key">Fecha:</span><span class="tattoo-presence-value">${escapeHtml(formatTattooRange(location.start_date, location.end_date))}</span></p>`
            : '';

        return `
            <article class="tattoo-presence-item">
                <p class="tattoo-presence-line"><span class="tattoo-presence-key">Estudio:</span><span class="tattoo-presence-value">${escapeHtml(location.studio_name || '-')}</span></p>
                ${cityLine}
                ${dateLine}
                <p class="tattoo-presence-line"><span class="tattoo-presence-key">Estado de agenda:</span><span class="tattoo-presence-value">${escapeHtml(AGENDA_STATUS_LABELS[location.agenda_status] || AGENDA_STATUS_LABELS.open)}</span></p>
            </article>
        `;
    }).join('');
}

function buildTattooScheduleSummary() {
    const currentCount = artistTattooLocations.filter((item) => item.period_type === 'current').length;
    const upcomingCount = artistTattooLocations.filter((item) => item.period_type === 'upcoming').length;

    if (!currentCount && !upcomingCount) return '-';

    const parts = [];
    if (currentCount) parts.push(`${currentCount} actual${currentCount > 1 ? 'es' : ''}`);
    if (upcomingCount) parts.push(`${upcomingCount} proximo${upcomingCount > 1 ? 's' : ''}`);
    return parts.join(' · ');
}

function renderTattooLocationsEditor() {
    const currentListEl = document.getElementById('current-tattoo-location-editor-list');
    const upcomingListEl = document.getElementById('upcoming-tattoo-location-editor-list');
    if (!currentListEl || !upcomingListEl) return;

    const renderList = (type) => {
        const rows = tattooLocationDrafts
            .map((item, index) => ({ item, index }))
            .filter((entry) => entry.item.period_type === type);

        if (!rows.length) {
            return '<p class="tattoo-location-editor-empty">Sin estudios cargados.</p>';
        }

        if (type === 'upcoming') {
            return rows.map(({ item, index }) => `
                <div class="tattoo-location-editor-item tattoo-location-editor-item-upcoming" data-index="${index}" data-type="${type}">
                    <div class="tattoo-upcoming-summary-grid">
                        <div class="tattoo-upcoming-cell">
                            <p class="tattoo-upcoming-key">Estudio</p>
                            <p class="tattoo-upcoming-value">${escapeHtml(item.studio_name || '-')}</p>
                        </div>
                        <div class="tattoo-upcoming-cell">
                            <p class="tattoo-upcoming-key">Ciudad</p>
                            <p class="tattoo-upcoming-value">${escapeHtml(item.city || '-')}</p>
                        </div>
                        <div class="tattoo-upcoming-cell">
                            <p class="tattoo-upcoming-key">Rango de fechas</p>
                            <p class="tattoo-upcoming-value">${escapeHtml(formatTattooRange(item.start_date, item.end_date))}</p>
                        </div>
                        <div class="tattoo-upcoming-cell">
                            <p class="tattoo-upcoming-key">Estado de agenda</p>
                            <p class="tattoo-upcoming-value">${escapeHtml(AGENDA_STATUS_LABELS[item.agenda_status] || AGENDA_STATUS_LABELS.open)}</p>
                        </div>
                    </div>
                    <div class="tattoo-upcoming-actions">
                        <button type="button" class="tattoo-upcoming-action-btn" data-action="edit-upcoming">Editar</button>
                        <button type="button" class="tattoo-location-remove-btn" data-action="remove">Quitar</button>
                    </div>
                </div>
            `).join('');
        }

        return rows.map(({ item, index }) => {
            const studioField = `
                <div class="tattoo-location-field">
                    <label class="tattoo-location-label">Estudio</label>
                    <div class="current-location-autocomplete">
                        <input type="text" class="form-input-dashboard current-location-autocomplete-input" data-field="studio_name" value="${escapeHtml(item.studio_name || '')}" placeholder="Nombre del estudio" aria-label="Nombre del estudio" autocomplete="off">
                        <div class="current-location-suggestions" data-field="studio_name"></div>
                    </div>
                </div>
            `;
            const cityField = `
                <div class="tattoo-location-field">
                    <label class="tattoo-location-label">Ciudad</label>
                    <div class="current-location-autocomplete">
                        <input type="text" class="form-input-dashboard current-location-autocomplete-input" data-field="city" value="${escapeHtml(item.city || '')}" placeholder="Ciudad" aria-label="Ciudad" autocomplete="off">
                        <div class="current-location-suggestions" data-field="city"></div>
                    </div>
                </div>
            `;
            const agendaField = `
                <div class="tattoo-location-field">
                    <label class="tattoo-location-label">Estado de agenda</label>
                    <select class="form-select-dashboard" data-field="agenda_status" aria-label="Estado de agenda">
                        <option value="open" ${item.agenda_status === 'open' ? 'selected' : ''}>Agenda abierta</option>
                        <option value="closed" ${item.agenda_status === 'closed' ? 'selected' : ''}>Agenda cerrada</option>
                    </select>
                </div>
            `;
            return `
                <div class="tattoo-location-editor-item" data-index="${index}" data-type="${type}">
                    <div class="tattoo-location-editor-grid">
                        ${studioField}
                        ${cityField}
                        ${agendaField}
                    </div>
                    <button type="button" class="tattoo-location-remove-btn" data-action="remove">Quitar</button>
                </div>
            `;
        }).join('');
    };

    currentListEl.innerHTML = renderList('current');
    upcomingListEl.innerHTML = renderList('upcoming');
}

function addTattooLocationDraft(periodType) {
    const type = periodType === 'upcoming' ? 'upcoming' : 'current';
    tattooLocationDrafts.push({
        id: null,
        period_type: type,
        studio_id: null,
        studio_name: '',
        city: '',
        agenda_status: 'open',
        start_date: '',
        end_date: '',
        sort_order: 0
    });
    renderTattooLocationsEditor();
}

function openUpcomingTravelModal(index = null) {
    const modal = document.getElementById('upcoming-travel-modal');
    if (!modal) return;

    const studioInput = document.getElementById('upcoming-travel-studio');
    const cityInput = document.getElementById('upcoming-travel-city');
    const startInput = document.getElementById('upcoming-travel-start');
    const endInput = document.getElementById('upcoming-travel-end');
    const agendaInput = document.getElementById('upcoming-travel-agenda');
    const titleEl = document.getElementById('upcoming-travel-modal-title');
    const messageEl = document.getElementById('upcoming-travel-message');

    upcomingTravelModalEditIndex = Number.isInteger(index) ? index : null;
    const item = upcomingTravelModalEditIndex !== null ? tattooLocationDrafts[upcomingTravelModalEditIndex] : null;

    if (titleEl) {
        titleEl.textContent = item ? 'Editar Viaje' : 'Agregar Viaje';
    }
    if (studioInput) studioInput.value = item?.studio_name || '';
    if (cityInput) cityInput.value = item?.city || '';
    if (startInput) startInput.value = item?.start_date || '';
    if (endInput) endInput.value = item?.end_date || '';
    if (agendaInput) agendaInput.value = item?.agenda_status || 'open';
    if (messageEl) {
        messageEl.textContent = '';
        messageEl.className = 'form-message';
    }

    initUpcomingTravelModalAutocomplete();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (studioInput) studioInput.focus();
}

function initUpcomingTravelModalAutocomplete() {
    const studioInput = document.getElementById('upcoming-travel-studio');
    const studioSuggestions = document.getElementById('upcoming-travel-studio-suggestions');
    const cityInput = document.getElementById('upcoming-travel-city');
    const citySuggestions = document.getElementById('upcoming-travel-city-suggestions');

    if (studioInput && studioSuggestions && !upcomingTravelStudioAutocompleteInit) {
        upcomingTravelStudioAutocompleteInit = true;

        studioInput.addEventListener('input', () => {
            const query = studioInput.value.trim();
            if (query.length < 2) {
                hideUpcomingTravelSuggestions(studioSuggestions);
                return;
            }
            clearTimeout(upcomingTravelStudioSearchTimeout);
            upcomingTravelStudioSearchTimeout = setTimeout(() => {
                searchUpcomingTravelStudios(query);
            }, 220);
        });
    }

    if (cityInput && citySuggestions && !upcomingTravelCityAutocompleteInit) {
        upcomingTravelCityAutocompleteInit = true;

        cityInput.addEventListener('input', () => {
            const query = cityInput.value.trim();
            if (query.length < 2) {
                hideUpcomingTravelSuggestions(citySuggestions);
                return;
            }
            clearTimeout(upcomingTravelCitySearchTimeout);
            upcomingTravelCitySearchTimeout = setTimeout(() => {
                searchUpcomingTravelCities(query);
            }, 220);
        });
    }
}

async function searchUpcomingTravelStudios(query) {
    const suggestionsEl = document.getElementById('upcoming-travel-studio-suggestions');
    if (!suggestionsEl || !_supabase) return;

    try {
        const normalized = query.toUpperCase();
        const { data, error } = await _supabase
            .from('studios')
            .select('name, normalized_name')
            .ilike('normalized_name', `%${normalized}%`)
            .order('name')
            .limit(8);

        if (error) {
            hideUpcomingTravelSuggestions(suggestionsEl);
            return;
        }

        const results = Array.isArray(data) ? data.map((row) => row.name).filter(Boolean) : [];
        renderUpcomingTravelSuggestions({
            suggestionsEl,
            results,
            query,
            inputId: 'upcoming-travel-studio'
        });
    } catch (error) {
        hideUpcomingTravelSuggestions(suggestionsEl);
    }
}

async function searchUpcomingTravelCities(query) {
    const suggestionsEl = document.getElementById('upcoming-travel-city-suggestions');
    if (!suggestionsEl || !_supabase) return;

    try {
        const [artistsRes, locationsRes] = await Promise.all([
            _supabase
                .from('artists_db')
                .select('city')
                .ilike('city', `%${query}%`)
                .limit(10),
            _supabase
                .from('artist_tattoo_locations')
                .select('city')
                .ilike('city', `%${query}%`)
                .limit(10)
        ]);

        const merged = [];
        const pushCity = (value) => {
            if (!value) return;
            const cleaned = String(value).trim();
            if (!cleaned) return;
            if (!merged.some((city) => city.toLowerCase() === cleaned.toLowerCase())) {
                merged.push(cleaned);
            }
        };

        (artistsRes.data || []).forEach((row) => pushCity(row.city));
        (locationsRes.data || []).forEach((row) => pushCity(row.city));

        merged.sort((a, b) => a.localeCompare(b, 'es'));

        renderUpcomingTravelSuggestions({
            suggestionsEl,
            results: merged.slice(0, 8),
            query,
            inputId: 'upcoming-travel-city'
        });
    } catch (error) {
        hideUpcomingTravelSuggestions(suggestionsEl);
    }
}

function renderUpcomingTravelSuggestions({ suggestionsEl, results, query, inputId }) {
    const safeQuery = (query || '').trim();
    if (!suggestionsEl) return;

    let uniqueResults = Array.isArray(results) ? results : [];
    uniqueResults = uniqueResults.filter((item, idx) => uniqueResults.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === idx);

    if (!uniqueResults.length) {
        suggestionsEl.innerHTML = `<div class="upcoming-travel-suggestion-item suggestion-custom" data-value="${escapeHtml(safeQuery)}">Usar: "${escapeHtml(safeQuery)}"</div>`;
    } else {
        const exact = uniqueResults.some((item) => item.toLowerCase() === safeQuery.toLowerCase());
        let html = uniqueResults
            .map((item) => `<div class="upcoming-travel-suggestion-item" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`)
            .join('');
        if (!exact && safeQuery) {
            html += `<div class="upcoming-travel-suggestion-item suggestion-custom" data-value="${escapeHtml(safeQuery)}">Usar: "${escapeHtml(safeQuery)}"</div>`;
        }
        suggestionsEl.innerHTML = html;
    }

    suggestionsEl.querySelectorAll('.upcoming-travel-suggestion-item').forEach((item) => {
        item.addEventListener('click', () => {
            const input = document.getElementById(inputId);
            if (input) input.value = item.dataset.value || '';
            hideUpcomingTravelSuggestions(suggestionsEl);
        });
    });

    suggestionsEl.classList.add('visible');
}

function hideUpcomingTravelSuggestions(suggestionsEl) {
    if (!suggestionsEl) return;
    suggestionsEl.classList.remove('visible');
    suggestionsEl.innerHTML = '';
}

function hideAllUpcomingTravelSuggestions() {
    hideUpcomingTravelSuggestions(document.getElementById('upcoming-travel-studio-suggestions'));
    hideUpcomingTravelSuggestions(document.getElementById('upcoming-travel-city-suggestions'));
}

function closeUpcomingTravelModal() {
    const modal = document.getElementById('upcoming-travel-modal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    hideAllUpcomingTravelSuggestions();
    upcomingTravelModalEditIndex = null;
}

function closeUpcomingTravelModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeUpcomingTravelModal();
    }
}

function showUpcomingTravelMessage(message, type = 'error') {
    const messageEl = document.getElementById('upcoming-travel-message');
    if (!messageEl) return;
    messageEl.textContent = message || '';
    messageEl.className = `form-message ${type}`;
}

function handleUpcomingTravelSave(event) {
    event.preventDefault();

    const studio = document.getElementById('upcoming-travel-studio')?.value.trim() || '';
    const city = document.getElementById('upcoming-travel-city')?.value.trim() || '';
    const startDate = document.getElementById('upcoming-travel-start')?.value || '';
    const endDate = document.getElementById('upcoming-travel-end')?.value || '';
    const agenda = document.getElementById('upcoming-travel-agenda')?.value === 'closed' ? 'closed' : 'open';

    if (!studio) {
        showUpcomingTravelMessage('Completa el nombre del estudio.', 'error');
        return;
    }
    if (!startDate || !endDate) {
        showUpcomingTravelMessage('Completa inicio y fin del viaje.', 'error');
        return;
    }
    if (endDate < startDate) {
        showUpcomingTravelMessage('La fecha de fin no puede ser menor a la de inicio.', 'error');
        return;
    }

    if (upcomingTravelModalEditIndex !== null && tattooLocationDrafts[upcomingTravelModalEditIndex]) {
        tattooLocationDrafts[upcomingTravelModalEditIndex] = {
            ...tattooLocationDrafts[upcomingTravelModalEditIndex],
            period_type: 'upcoming',
            studio_name: studio,
            city,
            start_date: startDate,
            end_date: endDate,
            agenda_status: agenda
        };
    } else {
        tattooLocationDrafts.push({
            id: null,
            period_type: 'upcoming',
            studio_id: null,
            studio_name: studio,
            city,
            agenda_status: agenda,
            start_date: startDate,
            end_date: endDate,
            sort_order: 0
        });
    }

    renderTattooLocationsEditor();
    closeUpcomingTravelModal();
}

function handleTattooLocationsEditorInput(event) {
    const target = event.target;
    if (!target || !target.dataset || !target.dataset.field) return;

    const itemEl = target.closest('.tattoo-location-editor-item');
    if (!itemEl) return;
    const index = Number(itemEl.dataset.index);
    if (!Number.isInteger(index) || !tattooLocationDrafts[index]) return;

    const field = target.dataset.field;
    tattooLocationDrafts[index][field] = target.value;

    if (itemEl.dataset.type === 'current' && (field === 'studio_name' || field === 'city')) {
        const suggestionsEl = itemEl.querySelector(`.current-location-suggestions[data-field="${field}"]`);
        if (!suggestionsEl) return;

        const query = (target.value || '').trim();
        if (query.length < 2) {
            hideCurrentLocationSuggestions(suggestionsEl);
            return;
        }

        const timerKey = `${index}:${field}`;
        const existingTimer = currentLocationAutocompleteTimers.get(timerKey);
        if (existingTimer) clearTimeout(existingTimer);

        const timeoutId = setTimeout(() => {
            if (field === 'studio_name') {
                searchCurrentLocationStudios({ itemEl, index, query, suggestionsEl });
            } else {
                searchCurrentLocationCities({ itemEl, index, query, suggestionsEl });
            }
        }, 220);

        currentLocationAutocompleteTimers.set(timerKey, timeoutId);
    }
}

function handleTattooLocationsEditorClick(event) {
    const suggestionItem = event.target.closest('.current-location-suggestion-item');
    if (suggestionItem) {
        const itemEl = suggestionItem.closest('.tattoo-location-editor-item');
        if (!itemEl) return;
        const index = Number(itemEl.dataset.index);
        if (!Number.isInteger(index) || !tattooLocationDrafts[index]) return;

        const field = suggestionItem.dataset.field;
        const value = suggestionItem.dataset.value || '';
        const input = itemEl.querySelector(`.current-location-autocomplete-input[data-field="${field}"]`);
        const suggestionsEl = itemEl.querySelector(`.current-location-suggestions[data-field="${field}"]`);

        if (input) input.value = value;
        if (field && tattooLocationDrafts[index]) {
            tattooLocationDrafts[index][field] = value;
        }
        hideCurrentLocationSuggestions(suggestionsEl);
        return;
    }

    const editUpcomingBtn = event.target.closest('[data-action="edit-upcoming"]');
    if (editUpcomingBtn) {
        const itemEl = editUpcomingBtn.closest('.tattoo-location-editor-item');
        if (!itemEl) return;
        const index = Number(itemEl.dataset.index);
        if (!Number.isInteger(index) || !tattooLocationDrafts[index]) return;
        openUpcomingTravelModal(index);
        return;
    }

    const removeBtn = event.target.closest('[data-action="remove"]');
    if (!removeBtn) return;

    const itemEl = removeBtn.closest('.tattoo-location-editor-item');
    if (!itemEl) return;
    const index = Number(itemEl.dataset.index);
    if (!Number.isInteger(index) || !tattooLocationDrafts[index]) return;

    tattooLocationDrafts.splice(index, 1);
    renderTattooLocationsEditor();
}

async function searchCurrentLocationStudios({ itemEl, index, query, suggestionsEl }) {
    if (!_supabase || !itemEl || !suggestionsEl) return;
    try {
        const normalized = query.toUpperCase();
        const { data, error } = await _supabase
            .from('studios')
            .select('name, normalized_name')
            .ilike('normalized_name', `%${normalized}%`)
            .order('name')
            .limit(8);

        if (error) {
            hideCurrentLocationSuggestions(suggestionsEl);
            return;
        }

        const results = Array.isArray(data) ? data.map((row) => row.name).filter(Boolean) : [];
        renderCurrentLocationSuggestions({
            itemEl,
            index,
            field: 'studio_name',
            query,
            suggestionsEl,
            results
        });
    } catch (error) {
        hideCurrentLocationSuggestions(suggestionsEl);
    }
}

async function searchCurrentLocationCities({ itemEl, index, query, suggestionsEl }) {
    if (!_supabase || !itemEl || !suggestionsEl) return;
    try {
        const [artistsRes, locationsRes] = await Promise.all([
            _supabase
                .from('artists_db')
                .select('city')
                .ilike('city', `%${query}%`)
                .limit(10),
            _supabase
                .from('artist_tattoo_locations')
                .select('city')
                .ilike('city', `%${query}%`)
                .limit(10)
        ]);

        const merged = [];
        const pushCity = (value) => {
            if (!value) return;
            const cleaned = String(value).trim();
            if (!cleaned) return;
            if (!merged.some((city) => city.toLowerCase() === cleaned.toLowerCase())) {
                merged.push(cleaned);
            }
        };

        (artistsRes.data || []).forEach((row) => pushCity(row.city));
        (locationsRes.data || []).forEach((row) => pushCity(row.city));
        merged.sort((a, b) => a.localeCompare(b, 'es'));

        renderCurrentLocationSuggestions({
            itemEl,
            index,
            field: 'city',
            query,
            suggestionsEl,
            results: merged.slice(0, 8)
        });
    } catch (error) {
        hideCurrentLocationSuggestions(suggestionsEl);
    }
}

function renderCurrentLocationSuggestions({ itemEl, index, field, query, suggestionsEl, results }) {
    if (!itemEl || !suggestionsEl) return;
    const safeQuery = (query || '').trim();
    let uniqueResults = Array.isArray(results) ? results : [];
    uniqueResults = uniqueResults.filter((item, idx) => uniqueResults.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === idx);

    if (!uniqueResults.length && !safeQuery) {
        hideCurrentLocationSuggestions(suggestionsEl);
        return;
    }

    let html = uniqueResults
        .map((item) => `<div class="current-location-suggestion-item" data-index="${index}" data-field="${field}" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`)
        .join('');

    const exact = uniqueResults.some((item) => item.toLowerCase() === safeQuery.toLowerCase());
    if (!exact && safeQuery) {
        html += `<div class="current-location-suggestion-item suggestion-custom" data-index="${index}" data-field="${field}" data-value="${escapeHtml(safeQuery)}">Usar: "${escapeHtml(safeQuery)}"</div>`;
    }

    suggestionsEl.innerHTML = html;
    suggestionsEl.classList.add('visible');
}

function hideCurrentLocationSuggestions(suggestionsEl) {
    if (!suggestionsEl) return;
    suggestionsEl.classList.remove('visible');
    suggestionsEl.innerHTML = '';
}

function hideAllCurrentLocationSuggestions() {
    document.querySelectorAll('.current-location-suggestions.visible').forEach((el) => hideCurrentLocationSuggestions(el));
}

function buildTattooLocationsPayload() {
    const payload = [];
    let currentOrder = 0;
    let upcomingOrder = 0;

    for (const draft of tattooLocationDrafts) {
        const location = normalizeTattooLocationRecord(draft);
        const hasAnyValue = Boolean(
            location.studio_name
            || location.start_date
            || location.end_date
            || location.city
        );

        if (!hasAnyValue) continue;

        if (!location.studio_name) {
            const scope = location.period_type === 'upcoming' ? 'proxima fecha' : 'actual';
            throw new Error(`Completa el estudio para la ubicacion ${scope}.`);
        }

        if (location.period_type === 'upcoming') {
            if (!location.start_date || !location.end_date) {
                throw new Error('Completa fecha de inicio y fin para cada proximo estudio.');
            }
            if (location.end_date < location.start_date) {
                throw new Error('La fecha de fin no puede ser menor a la fecha de inicio.');
            }
            location.sort_order = upcomingOrder;
            upcomingOrder += 1;
        } else {
            location.start_date = '';
            location.end_date = '';
            location.sort_order = currentOrder;
            currentOrder += 1;
        }

        payload.push(location);
    }

    return payload;
}

async function saveArtistTattooLocations(locationsPayload) {
    if (!currentUser) return;

    const studioCache = new Map();
    const rows = [];

    for (const location of locationsPayload) {
        const normalizedStudio = location.studio_name.toUpperCase().trim();
        let resolvedStudioId = null;

        if (normalizedStudio) {
            if (studioCache.has(normalizedStudio)) {
                resolvedStudioId = studioCache.get(normalizedStudio);
            } else {
                resolvedStudioId = await dashboardFindOrCreateStudio(location.studio_name);
                studioCache.set(normalizedStudio, resolvedStudioId || null);
            }
        }

        rows.push({
            artist_user_id: currentUser.id,
            period_type: location.period_type,
            studio_id: resolvedStudioId,
            studio_name: location.studio_name.trim(),
            city: location.city || null,
            agenda_status: location.agenda_status === 'closed' ? 'closed' : 'open',
            start_date: location.period_type === 'upcoming' ? location.start_date : null,
            end_date: location.period_type === 'upcoming' ? location.end_date : null,
            sort_order: location.sort_order
        });
    }

    const { error: deleteError } = await _supabase
        .from('artist_tattoo_locations')
        .delete()
        .eq('artist_user_id', currentUser.id);

    if (deleteError) throw deleteError;

    if (rows.length > 0) {
        const { error: insertError } = await _supabase
            .from('artist_tattoo_locations')
            .insert(rows);
        if (insertError) throw insertError;
    }

    await loadArtistTattooLocations();
}

function populateDashboard() {
    if (!artistData) return;
    const normalizedArtistLocation = normalizeDashboardLocation(artistData.ubicacion || '');
    if (normalizedArtistLocation !== (artistData.ubicacion || '')) {
        artistData.ubicacion = normalizedArtistLocation;
    }

    // Identity Block
    const artisticName = artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista';
    document.getElementById('artist-name').textContent = artisticName;
    document.getElementById('artist-username').textContent = '@' + (artistData.username || 'usuario.wo');
    const locationValue = artistData.ubicacion || 'Sin ubicacion';
    const locationText = document.getElementById('location-text');
    const locationLink = document.getElementById('location-link');
    locationText.textContent = locationValue;
    if (locationLink) {
        if (artistData.ubicacion) {
            locationLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(artistData.ubicacion)}`;
            locationLink.classList.remove('is-empty');
        } else {
            locationLink.removeAttribute('href');
            locationLink.classList.add('is-empty');
        }
    }

    const fallbackTattooLocations = (!artistTattooLocations.length
        && artistData.estudios
        && artistData.estudios !== 'Sin estudio/Independiente')
        ? [{
            period_type: 'current',
            studio_name: artistData.estudios,
            agenda_status: 'open',
            city: artistData.city || '',
            start_date: '',
            end_date: '',
            sort_order: 0
        }]
        : [];

    const tattooLocationsForUI = artistTattooLocations.length ? artistTattooLocations : fallbackTattooLocations;

    const currentTattooLocations = tattooLocationsForUI
        .filter((location) => location.period_type === 'current')
        .map(normalizeTattooLocationRecord);
    const upcomingTattooLocations = tattooLocationsForUI
        .filter((location) => location.period_type === 'upcoming')
        .map(normalizeTattooLocationRecord);

    renderTattooPresenceGroup('current-tattoo-locations', currentTattooLocations, false);
    renderTattooPresenceGroup('upcoming-tattoo-locations', upcomingTattooLocations, true);

    // Profile Picture (Avatar)
    if (artistData.profile_picture) {
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = artistData.profile_picture;
        avatarImg.classList.add('loaded');
    }

    // Stats Block
    document.getElementById('stat-experience').textContent = artistData.years_experience || '-';
    const stylesCount = artistData.styles_array ? artistData.styles_array.length : 0;
    document.getElementById('stat-styles').textContent = stylesCount;
    document.getElementById('stat-price').textContent = (
        artistData.session_price_amount && artistData.session_price_currency
            && window.WeOtziCurrency && window.WeOtziCurrency.isReady()
        ? window.WeOtziCurrency.formatInline(artistData.session_price_amount, artistData.session_price_currency, { showSecondary: false })
        : (artistData.session_price || '-')
    );

    // Bio & Portfolio (render sanitized rich text)
    const bioTextEl = document.getElementById('bio-text');
    if (window.BioFormatting) {
        window.BioFormatting.renderBioHtml(bioTextEl, artistData.bio_description);
    } else {
        bioTextEl.textContent = artistData.bio_description || 'Sin bio aun. Edita tu perfil para agregar una descripcion.';
    }

    const portfolioLink = document.getElementById('portfolio-url');
    if (artistData.portafolio) {
        portfolioLink.href = artistData.portafolio;
        portfolioLink.style.display = 'inline-flex';
    } else {
        portfolioLink.style.display = 'none';
    }

    // Profile Form - Display Values
    document.getElementById('display-artistic-name').textContent = artisticName || '-';
    document.getElementById('display-full-name').textContent = artistData.name || '-';
    document.getElementById('display-email').textContent = artistData.email || currentUser.email || '-';
    document.getElementById('display-location').textContent = artistData.ubicacion || '-';
    const tattooScheduleSummary = buildTattooScheduleSummary();
    document.getElementById('display-tattoo-schedule-summary').textContent = (
        tattooScheduleSummary === '-' && fallbackTattooLocations.length
            ? '1 actual'
            : tattooScheduleSummary
    );

    tattooLocationDrafts = tattooLocationsForUI.map(normalizeTattooLocationRecord);
    renderTattooLocationsEditor();

    // Styles
    const stylesContainer = document.getElementById('display-styles');
    if (artistData.styles_array && artistData.styles_array.length > 0) {
        stylesContainer.innerHTML = artistData.styles_array
            .map(s => `<span class="style-tag">${s}</span>`)
            .join('');
    } else {
        stylesContainer.textContent = '-';
    }

    document.getElementById('display-experience').textContent = 
        artistData.years_experience ? `${artistData.years_experience} anos` : '-';
    document.getElementById('display-price').textContent = (
        artistData.session_price_amount && artistData.session_price_currency
            && window.WeOtziCurrency && window.WeOtziCurrency.isReady()
        ? window.WeOtziCurrency.formatInline(artistData.session_price_amount, artistData.session_price_currency)
        : (artistData.session_price || '-')
    );
    document.getElementById('display-portfolio').textContent = artistData.portafolio || '-';

    // Work Type - prefer work_type column, fall back to estudios heuristic
    const wt = artistData.work_type
        || (artistData.estudios === 'Sin estudio/Independiente' ? 'independent'
            : (artistData.estudios ? 'studio' : ''));
    const workTypeLabels = { independent: 'Independiente', studio: 'Estudio', both: 'Ambos' };
    document.getElementById('display-work-type').textContent = workTypeLabels[wt] || '-';

    const studioRow = document.getElementById('studio-row');
    const showStudio = wt === 'studio' || wt === 'both';
    if (showStudio && artistData.estudios && artistData.estudios !== 'Sin estudio/Independiente') {
        studioRow.style.display = 'flex';
        document.getElementById('display-studio').textContent = artistData.estudios;
    }

    // Sync address row (works for studio, both, and independent).
    refreshDashboardAddressEditor(wt);

    // Birth Date (parse as local date to avoid UTC-offset showing wrong day)
    if (artistData.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(artistData.birth_date)) {
        const [y, m, d] = artistData.birth_date.split('-');
        const birthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        document.getElementById('display-birthdate').textContent = birthDate.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } else if (artistData.birth_date) {
        document.getElementById('display-birthdate').textContent = artistData.birth_date;
    }

    // Newsletter
    document.getElementById('display-newsletter').textContent = 
        artistData.subscribed_newsletter ? 'Suscrito' : 'No suscrito';
    document.getElementById('input-newsletter').checked = artistData.subscribed_newsletter || false;

    // Instagram
    document.getElementById('display-instagram').textContent = artistData.instagram || '-';
    document.getElementById('input-instagram').value = artistData.instagram || '';

    // WhatsApp
    document.getElementById('display-whatsapp').textContent = artistData.whatsapp_number || '-';
    document.getElementById('input-whatsapp').value = artistData.whatsapp_number || '';

    // Embajador (read-only, managed by support team)
    const embajadorValue = artistData.embajador || '';
    document.getElementById('display-embajador').textContent = 
        embajadorValue === 'si' ? 'Si' : 
        embajadorValue === 'pendiente' ? 'Pendiente' : 'No';

    // Show embajador badge if active
    const embajadorBadge = document.getElementById('embajador-badge');
    if (embajadorValue === 'si') {
        embajadorBadge.style.display = 'flex';
    } else {
        embajadorBadge.style.display = 'none';
    }

    // Verification State Display
    updateVerificationUI(artistData.verification_state || 'No');

    // Social links in identity block
    const instagramLink = document.getElementById('instagram-link');
    if (artistData.instagram) {
        const igHandle = artistData.instagram.replace('@', '');
        instagramLink.href = `https://instagram.com/${igHandle}`;
        instagramLink.style.display = 'flex';
    } else {
        instagramLink.style.display = 'none';
    }

    const whatsappLink = document.getElementById('whatsapp-link');
    const copyWhatsappBtn = document.getElementById('copy-whatsapp-btn');
    
    // Always generate link to We Otzi, using artist username
    const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541127015926';
    const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
    const username = artistData.username || 'artista';
    const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${username}`);
    const finalWhatsappUrl = `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;

    if (artistData.whatsapp_url || artistData.whatsapp_number) {
        whatsappLink.href = finalWhatsappUrl;
        whatsappLink.style.display = 'flex';
        copyWhatsappBtn.style.display = 'flex';
        copyWhatsappBtn.dataset.url = finalWhatsappUrl;
    } else {
        whatsappLink.style.display = 'none';
        copyWhatsappBtn.style.display = 'none';
    }

    // Set quotes admin button listener (placeholder removed)
    const quotesAdminBtn = document.getElementById('go-to-quotes-btn');
    if (quotesAdminBtn) {
        // Navigation is now handled by inline onclick in dashboard.html
    }

    // Populate input fields for edit mode
    document.getElementById('input-artistic-name').value = artisticName;
    document.getElementById('input-full-name').value = artistData.name || '';
    document.getElementById('input-location').value = normalizeDashboardLocation(artistData.ubicacion || '');
    dashboardSelectedStyles = artistData.styles_array ? [...artistData.styles_array] : [];
    updateStylesTriggerUI();
    document.getElementById('input-experience').value = artistData.years_experience || '0-1';
    
    // Parse session price - prefer structured columns, fall back to legacy text
    if (artistData.session_price_amount && artistData.session_price_currency) {
        document.getElementById('input-price').value = artistData.session_price_amount;
        document.getElementById('input-currency').value = artistData.session_price_currency;
    } else if (artistData.session_price) {
        const priceParts = artistData.session_price.split(' ');
        document.getElementById('input-price').value = priceParts[0] || '';
        document.getElementById('input-currency').value = priceParts[1] || 'USD';
    }

    document.getElementById('input-portfolio').value = artistData.portafolio || '';
    document.getElementById('input-birthdate').value = artistData.birth_date || '';

    // Work type input - prefer work_type column
    const resolvedWt = artistData.work_type
        || (artistData.estudios === 'Sin estudio/Independiente' ? 'independent'
            : (artistData.estudios ? 'studio' : ''));
    document.getElementById('input-work-type').value = resolvedWt || 'independent';
    if ((resolvedWt === 'studio' || resolvedWt === 'both') && artistData.estudios && artistData.estudios !== 'Sin estudio/Independiente') {
        document.getElementById('input-studio').value = artistData.estudios;
    }
    dashboardStudioId = artistData.studio_id || null;
}

// ============================================
// QUOTES MANAGEMENT
// ============================================

async function populateQuotes() {
    if (!currentUser) return;

    try {
        // Fetch all quotes for the current artist (excluding drafts/in_progress)
        const { data, error } = await _supabase
            .from('quotations_db')
            .select('quote_status')
            .eq('artist_id', currentUser.id)
            .neq('quote_status', 'in_progress');

        if (error) throw error;

        const stats = {
            total: data ? data.length : 0,
            pending: data ? data.filter(q => q.quote_status === 'pending').length : 0,
            answered: data ? data.filter(q => q.quote_status === 'responded').length : 0
        };

        // Update UI
        document.getElementById('quote-total').textContent = stats.total;
        document.getElementById('quote-pending').textContent = stats.pending;
        document.getElementById('quote-answered').textContent = stats.answered;

        // Visual feedback for pending quotes
        const pendingVal = document.getElementById('quote-pending');
        if (stats.pending > 0) {
            pendingVal.classList.add('highlight-red');
        } else {
            pendingVal.classList.remove('highlight-red');
        }

        // Check quote-related milestones
        checkQuoteMilestones(stats);

    } catch (error) {
        console.error('Error fetching quotes stats:', error);
    }

    try {
        const { count, error } = await _supabase
            .from('job_board_applications')
            .select('id', { count: 'exact', head: true })
            .eq('artist_id', currentUser.id);

        if (!error) {
            const el = document.getElementById('quote-applications');
            if (el) el.textContent = count || 0;
        }
    } catch (appErr) {
        console.error('Error fetching applications count:', appErr);
    }
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    setupDashboardNavigationMenu();

    // Edit toggle button
    const editToggleBtn = document.getElementById('edit-toggle-btn');
    editToggleBtn.addEventListener('click', toggleEditMode);

    const profileGalleryUploadBtn = document.getElementById('profile-gallery-upload-btn');
    if (profileGalleryUploadBtn) {
        profileGalleryUploadBtn.addEventListener('click', openProfileGalleryUploader);
    }

    // Profile form submission
    const profileForm = document.getElementById('profile-form');
    profileForm.addEventListener('submit', handleProfileSave);

    // Cancel button
    const cancelBtn = document.getElementById('profile-cancel');
    cancelBtn.addEventListener('click', cancelEditMode);

    // Bio edit
    const editBioBtn = document.getElementById('edit-bio-btn');
    editBioBtn.addEventListener('click', toggleBioEdit);

    const bioCancelBtn = document.getElementById('bio-cancel');
    bioCancelBtn.addEventListener('click', cancelBioEdit);

    const bioSaveBtn = document.getElementById('bio-save');
    bioSaveBtn.addEventListener('click', saveBio);

    // Work type change
    const workTypeSelect = document.getElementById('input-work-type');
    workTypeSelect.addEventListener('change', handleWorkTypeChange);

    const addCurrentTattooLocationBtn = document.getElementById('add-current-tattoo-location-btn');
    if (addCurrentTattooLocationBtn) {
        addCurrentTattooLocationBtn.addEventListener('click', () => addTattooLocationDraft('current'));
    }

    const addUpcomingTattooLocationBtn = document.getElementById('add-upcoming-tattoo-location-btn');
    if (addUpcomingTattooLocationBtn) {
        addUpcomingTattooLocationBtn.addEventListener('click', () => openUpcomingTravelModal());
    }

    const tattooLocationsEditor = document.getElementById('tattoo-locations-editor');
    if (tattooLocationsEditor) {
        tattooLocationsEditor.addEventListener('input', handleTattooLocationsEditorInput);
        tattooLocationsEditor.addEventListener('change', handleTattooLocationsEditorInput);
        tattooLocationsEditor.addEventListener('click', handleTattooLocationsEditorClick);
    }

    const upcomingTravelForm = document.getElementById('upcoming-travel-form');
    if (upcomingTravelForm) {
        upcomingTravelForm.addEventListener('submit', handleUpcomingTravelSave);
    }

    document.addEventListener('click', (event) => {
        const modal = document.getElementById('upcoming-travel-modal');
        if (!modal || !modal.classList.contains('active')) return;

        const clickedInsideStudio = event.target.closest('#upcoming-travel-studio, #upcoming-travel-studio-suggestions');
        const clickedInsideCity = event.target.closest('#upcoming-travel-city, #upcoming-travel-city-suggestions');
        if (!clickedInsideStudio) hideUpcomingTravelSuggestions(document.getElementById('upcoming-travel-studio-suggestions'));
        if (!clickedInsideCity) hideUpcomingTravelSuggestions(document.getElementById('upcoming-travel-city-suggestions'));
    });

    document.addEventListener('click', (event) => {
        const clickedCurrentAutocomplete = event.target.closest('.current-location-autocomplete');
        if (!clickedCurrentAutocomplete) {
            hideAllCurrentLocationSuggestions();
        }
    });

    // Avatar upload
    const avatarUploadBtn = document.getElementById('avatar-upload-btn');
    const avatarInput = document.getElementById('avatar-input');
    avatarUploadBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', handleAvatarUpload);

    // AI Avatar Generator
    const avatarAiBtn = document.getElementById('avatar-ai-btn');
    if (avatarAiBtn) {
        avatarAiBtn.addEventListener('click', openAIAvatarModal);
    }

    // Action buttons
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', handleLogout);

    const changePasswordBtn = document.getElementById('change-password-btn');
    changePasswordBtn.addEventListener('click', openPasswordModal);

    // Verification button
    const verificationBtn = document.getElementById('request-verification-btn');
    verificationBtn.addEventListener('click', openVerificationModal);

    // Copy WhatsApp link button
    const copyWhatsappBtn = document.getElementById('copy-whatsapp-btn');
    copyWhatsappBtn.addEventListener('click', copyWhatsappLink);

    // Share profile button
    const shareProfileBtn = document.getElementById('share-profile-btn');
    shareProfileBtn.addEventListener('click', shareProfile);

    // Preview profile button
    const previewProfileBtn = document.getElementById('preview-profile-btn');
    if (previewProfileBtn) {
        previewProfileBtn.addEventListener('click', previewPublicProfile);
    }

    // Gallery edit input
    const galleryEditInput = document.getElementById('gallery-edit-input');
    if (galleryEditInput) {
        galleryEditInput.addEventListener('change', handleGalleryEditUpload);
    }

    // QR Modal tabs
    setupQRTabListeners();

    // Top banner controls
    const bannerToggleBtn = document.getElementById('verification-banner-toggle-btn');
    if (bannerToggleBtn) {
        bannerToggleBtn.addEventListener('click', () => {
            setBannerExpanded(!bannerUIState.expanded);
        });
    }

    const bannerTabOnboarding = document.getElementById('banner-tab-onboarding');
    if (bannerTabOnboarding) {
        bannerTabOnboarding.addEventListener('click', () => {
            setBannerActiveNotice(BANNER_NOTICE_ONBOARDING);
        });
    }

    const bannerTabVerification = document.getElementById('banner-tab-verification');
    if (bannerTabVerification) {
        bannerTabVerification.addEventListener('click', () => {
            setBannerActiveNotice(BANNER_NOTICE_VERIFICATION);
        });
    }

    const bannerPrevBtn = document.getElementById('banner-prev-btn');
    if (bannerPrevBtn) {
        bannerPrevBtn.addEventListener('click', () => {
            cycleBannerNotice(-1);
        });
    }

    const bannerNextBtn = document.getElementById('banner-next-btn');
    if (bannerNextBtn) {
        bannerNextBtn.addEventListener('click', () => {
            cycleBannerNotice(1);
        });
    }

}

// ============================================
// COPY WHATSAPP LINK
// ============================================

async function copyWhatsappLink() {
    const copyBtn = document.getElementById('copy-whatsapp-btn');
    const url = copyBtn.dataset.url;

    if (!url) {
        showStatusMessage('No hay enlace de WhatsApp.', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        
        // Visual feedback
        copyBtn.classList.add('copied');
        showStatusMessage('Enlace de WhatsApp copiado al portapapeles.', 'success');
        
        // Track milestone
        trackMilestone('ms_whatsapp_shared');
        
        setTimeout(() => {
            copyBtn.classList.remove('copied');
        }, 2000);

    } catch (err) {
        console.error('Error copying to clipboard:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            copyBtn.classList.add('copied');
            showStatusMessage('Enlace de WhatsApp copiado al portapapeles.', 'success');
            trackMilestone('ms_whatsapp_shared');
            setTimeout(() => {
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (e) {
            showStatusMessage('Error al copiar el enlace.', 'error');
        }
        document.body.removeChild(textArea);
    }
}

// ============================================
// LOCATION AUTOCOMPLETE & GEOLOCATION
// ============================================

function sanitizeDashboardLocationSegment(segment) {
    if (!segment || typeof segment !== 'string') return '';
    return segment
        .replace(/\b(?:[A-Z]{1,3}\d{3,6}[A-Z]{0,3}|\d{3,8}(?:-\d{3,4})?)\b/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,\s-]+|[,\s-]+$/g, '')
        .trim();
}

function normalizeDashboardLocation(rawLocation) {
    if (!rawLocation || typeof rawLocation !== 'string') return '';
    const parts = rawLocation
        .split(',')
        .map((segment) => sanitizeDashboardLocationSegment(segment))
        .filter(Boolean);

    const deduped = [];
    for (const part of parts) {
        if (!deduped.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
            deduped.push(part);
        }
    }

    return deduped.slice(0, 3).join(', ');
}

function getDashboardAddressComponent(components, acceptedTypes) {
    if (!Array.isArray(components)) return '';

    for (const acceptedType of acceptedTypes) {
        const match = components.find((component) => component.types && component.types.includes(acceptedType));
        if (match && match.long_name) {
            return sanitizeDashboardLocationSegment(match.long_name);
        }
    }

    return '';
}

function buildDashboardLocationFromComponents(components, fallbackAddress = '') {
    const city = getDashboardAddressComponent(components, [
        'locality',
        'postal_town',
        'administrative_area_level_3',
        'administrative_area_level_2',
        'sublocality_level_1',
        'sublocality'
    ]);
    const province = getDashboardAddressComponent(components, [
        'administrative_area_level_1',
        'administrative_area_level_2'
    ]);
    const country = getDashboardAddressComponent(components, ['country']);

    const structured = [city, province, country].filter(Boolean);
    const dedupedStructured = structured.filter((part, index, arr) => (
        arr.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index
    ));

    if (dedupedStructured.length > 0) {
        return dedupedStructured.join(', ');
    }

    return normalizeDashboardLocation(fallbackAddress);
}

// Initialize Google Places Autocomplete on the location input.
// Called by Google Maps callback and also when entering edit mode
// (to handle race condition between Maps API load and user action).
function initDashboardGooglePlaces() {
    const locationInput = document.getElementById('input-location');
    if (!locationInput || typeof google === 'undefined' || !google.maps || !google.maps.places) return;
    if (placesAutocompleteDashboard) return; // already initialized

    placesAutocompleteDashboard = new google.maps.places.Autocomplete(locationInput, {
        types: ['geocode'],
        fields: ['formatted_address', 'address_components']
    });

    placesAutocompleteDashboard.addListener('place_changed', () => {
        const place = placesAutocompleteDashboard.getPlace();
        if (!place) return;

        const normalizedLocation = buildDashboardLocationFromComponents(
            place.address_components,
            place.formatted_address
        );
        if (normalizedLocation) {
            locationInput.value = normalizedLocation;
        }
    });
}


// Cross-platform geolocation: GPS (navigator.geolocation) with IP-based fallback (ipapi.co).
// Covers iOS Safari, Android Chrome/Firefox, Desktop (Win/Mac/Linux), all modern browsers.
function getDashboardGeolocation() {
    const btn = document.getElementById('dashboard-geolocation-btn');
    const hint = document.getElementById('dashboard-location-hint');
    const locationInput = document.getElementById('input-location');
    if (!btn || !hint || !locationInput) return;

    btn.classList.add('loading');
    hint.textContent = 'Obteniendo ubicacion...';
    hint.style.color = 'var(--fg)';

    // Reverse geocode coordinates to "Localidad, Provincia, Pais"
    async function reverseGeocode(latitude, longitude) {
        if (typeof google === 'undefined' || !google.maps) return null;
        try {
            const geocoder = new google.maps.Geocoder();
            const response = await geocoder.geocode({
                location: { lat: latitude, lng: longitude }
            });
            if (!response.results || !response.results.length) return null;

            for (const result of response.results) {
                const normalizedResult = buildDashboardLocationFromComponents(
                    result.address_components,
                    result.formatted_address
                );
                if (normalizedResult) {
                    return normalizedResult;
                }
            }

            return null;
        } catch (err) {
            return null;
        }
    }

    async function handleLocationSuccess(latitude, longitude) {
        try {
            const address = await reverseGeocode(latitude, longitude);
            if (address) {
                locationInput.value = address;
                hint.textContent = 'Ubicacion detectada!';
                hint.style.color = '#4CAF50';
            } else {
                hint.textContent = 'No se pudo determinar la direccion. Ingresala manualmente.';
                hint.style.color = 'var(--primary-red, #e53935)';
            }
        } catch (err) {
            hint.textContent = 'Error al obtener la direccion.';
            hint.style.color = 'var(--primary-red, #e53935)';
        }
        btn.classList.remove('loading');
    }

    // Layer 2: IP-based geolocation — used when GPS is unavailable or times out
    async function tryIPGeolocation() {
        try {
            const response = await fetch('https://ipapi.co/json/');
            if (!response.ok) throw new Error('IP geolocation failed');
            const data = await response.json();
            if (data.latitude && data.longitude) {
                await handleLocationSuccess(data.latitude, data.longitude);
            } else {
                throw new Error('No coordinates in IP response');
            }
        } catch (err) {
            btn.classList.remove('loading');
            hint.textContent = 'No se pudo obtener la ubicacion. Ingresala manualmente.';
            hint.style.color = 'var(--primary-red, #e53935)';
        }
    }

    // Layer 1: Browser GPS (works on all platforms including iOS Safari with HTTPS)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                await handleLocationSuccess(position.coords.latitude, position.coords.longitude);
            },
            async (error) => {
                // PERMISSION_DENIED: user explicitly said no — don't fallback, show message
                if (error.code === error.PERMISSION_DENIED) {
                    btn.classList.remove('loading');
                    hint.textContent = 'Permiso de ubicacion denegado. Ingresala manualmente.';
                    hint.style.color = 'var(--primary-red, #e53935)';
                    return;
                }
                // POSITION_UNAVAILABLE or TIMEOUT: try IP fallback
                hint.textContent = 'Intentando metodo alternativo...';
                await tryIPGeolocation();
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    } else {
        // No GPS support at all (rare) — go directly to IP fallback
        tryIPGeolocation().catch(() => {});
    }
}

// Make getDashboardGeolocation explicitly available on window
// (safe for future module conversion; also required by onclick= in HTML)
window.getDashboardGeolocation = getDashboardGeolocation;

// ============================================
// EDIT MODE TOGGLE
// ============================================

function toggleEditMode() {
    isEditMode = !isEditMode;
    const editBtn = document.getElementById('edit-toggle-btn');
    const formActions = document.getElementById('form-actions');
    const galleryEditSection = document.getElementById('gallery-edit-section');

    // Toggle button state
    if (isEditMode) {
        editBtn.classList.add('active');
        editBtn.querySelector('span').textContent = 'Cancelar';
        formActions.style.display = 'flex';
        // Show gallery edit section and render preview
        if (galleryEditSection) {
            galleryEditSection.style.display = 'flex';
            renderGalleryEditPreview();
        }
    } else {
        editBtn.classList.remove('active');
        editBtn.querySelector('span').textContent = 'Editar';
        formActions.style.display = 'none';
        closeUpcomingTravelModal();
        // Hide gallery edit section
        if (galleryEditSection) {
            galleryEditSection.style.display = 'none';
        }
    }

    // Toggle display/input visibility
    const displayElements = document.querySelectorAll('.form-value:not(.form-value-readonly)');
    const inputElements = document.querySelectorAll('.form-input-dashboard:not(#input-location), .form-select-dashboard, .price-input-group, .dashboard-location-group, .toggle-switch');

    displayElements.forEach(el => {
        el.style.display = isEditMode ? 'none' : 'block';
    });

    inputElements.forEach(el => {
        // Check if this is the studio row
        if (el.id === 'input-studio' || el.closest('#studio-row')) {
            const workType = document.getElementById('input-work-type').value;
            if (workType === 'studio' || workType === 'both') {
                el.style.display = isEditMode ? 'block' : 'none';
            }
        } else if (el.id === 'price-input-group') {
            el.style.display = isEditMode ? 'flex' : 'none';
        } else if (el.classList.contains('dashboard-location-group')) {
            el.style.display = isEditMode ? 'flex' : 'none';
            if (isEditMode) initDashboardGooglePlaces();
        } else {
            el.style.display = isEditMode ? 'block' : 'none';
        }
    });

    // Special handling for styles value container and edit trigger
    const stylesValue = document.getElementById('display-styles');
    if (stylesValue) {
        stylesValue.style.display = isEditMode ? 'none' : 'flex';
    }
    const stylesTrigger = document.getElementById('styles-edit-trigger');
    if (stylesTrigger) {
        stylesTrigger.style.display = isEditMode ? 'flex' : 'none';
    }

    const tattooLocationsEditor = document.getElementById('tattoo-locations-editor');
    if (tattooLocationsEditor) {
        tattooLocationsEditor.style.display = isEditMode ? 'flex' : 'none';
        if (isEditMode) renderTattooLocationsEditor();
    }

    // Handle studio row visibility based on work type
    handleWorkTypeChange();
}

function cancelEditMode() {
    if (isEditMode) {
        // Clear location hint so it doesn't show stale text on next edit session
        const locationHint = document.getElementById('dashboard-location-hint');
        if (locationHint) locationHint.textContent = '';
        // Restore original values
        populateDashboard();
        toggleEditMode();
    }
}

function openProfileGalleryUploader() {
    const galleryEditSection = document.getElementById('gallery-edit-section');
    const galleryEditInput = document.getElementById('gallery-edit-input');

    if (!galleryEditSection || !galleryEditInput) {
        showStatusMessage('No se encontro el cargador de galeria.', 'error');
        return;
    }

    if (!isEditMode) {
        toggleEditMode();
    } else {
        renderGalleryEditPreview();
    }

    galleryEditSection.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    galleryEditInput.click();
}

// ============================================
// Dashboard Studio Autocomplete
// ============================================

function initDashboardStudioAutocomplete() {
    const input = document.getElementById('input-studio');
    const suggestionsEl = document.getElementById('dashboard-studio-suggestions');
    if (!input || !suggestionsEl || dashboardStudioAutocompleteInit) return;
    dashboardStudioAutocompleteInit = true;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        dashboardStudioId = null;
        if (query.length < 2) { hideDashboardSuggestions(); return; }
        clearTimeout(dashboardStudioSearchTimeout);
        dashboardStudioSearchTimeout = setTimeout(() => searchDashboardStudios(query), 250);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideDashboardSuggestions();
        if (e.key === 'Enter') {
            e.preventDefault();
            const active = suggestionsEl.querySelector('.studio-suggestion-item.active');
            if (active) active.click();
            else hideDashboardSuggestions();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            navDashboardSuggestions(e.key === 'ArrowDown' ? 1 : -1);
        }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
            hideDashboardSuggestions();
        }
    });
}

async function searchDashboardStudios(query) {
    const suggestionsEl = document.getElementById('dashboard-studio-suggestions');
    if (!suggestionsEl) return;
    try {
        const { data, error } = await _supabase
            .from('studios')
            .select('id, name, normalized_name')
            .ilike('normalized_name', `%${query.toUpperCase()}%`)
            .order('name')
            .limit(8);
        if (error) { hideDashboardSuggestions(); return; }
        renderDashboardSuggestions(data || [], query);
    } catch { hideDashboardSuggestions(); }
}

function renderDashboardSuggestions(results, query) {
    const el = document.getElementById('dashboard-studio-suggestions');
    if (!el) return;
    if (!results.length) {
        el.innerHTML = `<div class="studio-suggestion-item studio-suggestion-new" data-action="create">Crear: "${query}"</div>`;
    } else {
        const exact = results.some(s => s.normalized_name === query.toUpperCase());
        let html = results.map(s =>
            `<div class="studio-suggestion-item" data-id="${s.id}" data-name="${s.name}">${s.name}</div>`
        ).join('');
        if (!exact) html += `<div class="studio-suggestion-item studio-suggestion-new" data-action="create">Crear: "${query}"</div>`;
        el.innerHTML = html;
    }
    el.querySelectorAll('.studio-suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            const input = document.getElementById('input-studio');
            if (item.dataset.action === 'create') {
                dashboardStudioId = null;
            } else {
                dashboardStudioId = item.dataset.id;
                if (input) input.value = item.dataset.name;
            }
            hideDashboardSuggestions();
        });
    });
    el.classList.add('visible');
}

function hideDashboardSuggestions() {
    const el = document.getElementById('dashboard-studio-suggestions');
    if (el) { el.classList.remove('visible'); el.innerHTML = ''; }
}

function navDashboardSuggestions(dir) {
    const el = document.getElementById('dashboard-studio-suggestions');
    if (!el) return;
    const items = Array.from(el.querySelectorAll('.studio-suggestion-item'));
    if (!items.length) return;
    const idx = items.findIndex(i => i.classList.contains('active'));
    items.forEach(i => i.classList.remove('active'));
    let next = idx + dir;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    items[next].classList.add('active');
    items[next].scrollIntoView({ block: 'nearest' });
}

async function dashboardFindOrCreateStudio(name) {
    if (!name) return null;
    const normalized = name.toUpperCase().trim();
    if (dashboardStudioId) return dashboardStudioId;

    const { data: existing } = await _supabase
        .from('studios')
        .select('id')
        .eq('normalized_name', normalized)
        .maybeSingle();
    if (existing) return existing.id;

    const { data: created, error } = await _supabase
        .from('studios')
        .insert({ name: name.trim(), normalized_name: normalized })
        .select('id')
        .single();
    if (error && error.code === '23505') {
        const { data: retry } = await _supabase.from('studios').select('id').eq('normalized_name', normalized).single();
        return retry?.id || null;
    }
    return created?.id || null;
}

function handleWorkTypeChange() {
    const workType = document.getElementById('input-work-type').value;
    const studioRow = document.getElementById('studio-row');
    const studioInput = document.getElementById('input-studio');
    const studioDisplay = document.getElementById('display-studio');

    if (workType === 'studio' || workType === 'both') {
        studioRow.style.display = 'flex';
        if (isEditMode) {
            studioInput.style.display = 'block';
            studioDisplay.style.display = 'none';
            initDashboardStudioAutocomplete();
        }
    } else {
        studioRow.style.display = 'none';
        dashboardStudioId = null;
    }

    refreshDashboardAddressEditor(workType);
}

// ----- Dashboard Address Picker (mirrors register flow) -----
let dashboardAddressPicker = null;
let dashboardAddressDraft  = null;

function refreshDashboardAddressEditor(workType) {
    const row     = document.getElementById('address-row');
    const label   = document.getElementById('address-row-label');
    const display = document.getElementById('display-address');
    const editor  = document.getElementById('dashboard-address-editor');
    if (!row) return;

    const wantRow = workType === 'studio' || workType === 'both' || workType === 'independent';
    row.style.display = wantRow ? 'flex' : 'none';

    if (label) {
        label.textContent = (workType === 'independent')
            ? 'Dirección donde recibís clientes'
            : 'Dirección del estudio';
    }

    if (!wantRow) return;

    // Display value: pick from artistData (independent) OR studio (studio/both)
    const sourceAddr = pickArtistAddressForDisplay(workType);
    if (display) {
        display.textContent = sourceAddr.formatted_address || '-';
    }

    if (isEditMode) {
        if (display) display.style.display = 'none';
        if (editor)  editor.style.display = 'block';
        ensureDashboardAddressPicker();
        // Pre-fill the picker with the current address.
        if (dashboardAddressPicker && sourceAddr) {
            dashboardAddressPicker.setValue(sourceAddr);
            const previewEl = document.getElementById('dashboard-address-preview');
            if (window.WeOtziAddressPicker && previewEl) {
                window.WeOtziAddressPicker.renderPreview(previewEl, sourceAddr);
            }
            dashboardAddressDraft = Object.assign({}, sourceAddr);
        }
    } else {
        if (display) display.style.display = 'block';
        if (editor)  editor.style.display = 'none';
    }
}

function pickArtistAddressForDisplay(workType) {
    if (!artistData) return {};
    if (workType === 'independent') {
        return {
            country:           artistData.country           || '',
            country_code:      artistData.country_code      || '',
            state_province:    artistData.state_province    || '',
            city:              artistData.city              || '',
            locality:          artistData.locality          || '',
            street:            artistData.street            || '',
            street_number:     artistData.street_number     || '',
            unit:              artistData.unit              || '',
            postal_code:       artistData.postal_code       || '',
            formatted_address: artistData.formatted_address || '',
            latitude:          artistData.latitude          || null,
            longitude:         artistData.longitude         || null,
            google_place_id:   artistData.google_place_id   || ''
        };
    }
    // For studio/both, the address shown belongs to the linked studio. The
    // dashboard doesn't keep that in artistData, so we read it from the
    // editor's session cache (or empty if not yet fetched).
    return Object.assign({}, dashboardAddressDraft || {});
}

function ensureDashboardAddressPicker() {
    if (dashboardAddressPicker) return dashboardAddressPicker;
    if (!window.WeOtziAddressPicker) return null;
    const input = document.getElementById('input-address-search');
    const previewEl = document.getElementById('dashboard-address-preview');
    if (!input) return null;
    dashboardAddressPicker = window.WeOtziAddressPicker.attach(input, {
        placeholder: 'Buscar dirección…',
        onChange(address) {
            dashboardAddressDraft = address;
            if (previewEl) window.WeOtziAddressPicker.renderPreview(previewEl, address);
        }
    });
    return dashboardAddressPicker;
}

// ============================================
// BIO EDITING
// ============================================

function toggleBioEdit() {
    const bioContent = document.getElementById('bio-content');
    const bioEditMode = document.getElementById('bio-edit-mode');
    const bioEditor = document.getElementById('bio-editor');

    if (bioEditor) {
        const currentHtml = artistData?.bio_description || '';
        bioEditor.innerHTML = window.BioFormatting
            ? window.BioFormatting.sanitizeBioHtml(currentHtml)
            : currentHtml;
    }

    bioContent.style.display = 'none';
    bioEditMode.style.display = 'flex';

    initDashboardBioToolbar();
}

function cancelBioEdit() {
    const bioContent = document.getElementById('bio-content');
    const bioEditMode = document.getElementById('bio-edit-mode');

    bioContent.style.display = 'block';
    bioEditMode.style.display = 'none';
}

async function saveBio() {
    const bioEditor = document.getElementById('bio-editor');
    if (!bioEditor) return;

    const rawHtml = bioEditor.innerHTML;
    const newBio = window.BioFormatting
        ? window.BioFormatting.sanitizeBioHtml(rawHtml)
        : rawHtml;

    try {
        const { error } = await _supabase
            .from('artists_db')
            .update({ bio_description: newBio || null })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        artistData.bio_description = newBio;
        const bioTextEl = document.getElementById('bio-text');
        if (window.BioFormatting) {
            window.BioFormatting.renderBioHtml(bioTextEl, newBio);
        } else {
            bioTextEl.innerHTML = newBio || 'Sin bio aun. Edita tu perfil para agregar una descripcion.';
        }

        const bioContent = document.getElementById('bio-content');
        const bioEditMode = document.getElementById('bio-edit-mode');
        bioContent.style.display = 'block';
        bioEditMode.style.display = 'none';

        showStatusMessage('Bio actualizada correctamente.', 'success');

    } catch (error) {
        console.error('Error saving bio:', error);
        showStatusMessage('Error al guardar la bio.', 'error');
    }
}

let _dashBioToolbarInitialized = false;

function initDashboardBioToolbar() {
    if (_dashBioToolbarInitialized) return;
    _dashBioToolbarInitialized = true;

    const toolbar = document.getElementById('dashboard-bio-toolbar');
    const bioEditor = document.getElementById('bio-editor');
    if (!toolbar || !bioEditor) return;

    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.toolbar-btn');
        if (!btn) return;
        e.preventDefault();
        const command = btn.dataset.command;
        if (!command) return;

        if (command === 'createLink') {
            const url = prompt('Ingresa la URL del enlace:', 'https://');
            if (url) document.execCommand(command, false, url);
        } else if (command === 'foreColor' || command === 'hiliteColor') {
            return;
        } else {
            document.execCommand(command, false, null);
        }
        bioEditor.focus();
    });

    const textColorPicker = document.getElementById('dash-text-color-picker');
    const bgColorPicker = document.getElementById('dash-bg-color-picker');

    if (textColorPicker) {
        textColorPicker.addEventListener('input', (e) => {
            document.execCommand('foreColor', false, e.target.value);
            bioEditor.focus();
        });
    }
    if (bgColorPicker) {
        bgColorPicker.addEventListener('input', (e) => {
            document.execCommand('hiliteColor', false, e.target.value);
            bioEditor.focus();
        });
    }

    bioEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation();
        }
    });
}

// ============================================
// PROFILE SAVE
// ============================================

async function handleProfileSave(e) {
    e.preventDefault();

    const saveBtn = document.getElementById('profile-save');
    saveBtn.textContent = 'Guardando...';
    saveBtn.disabled = true;

    try {
        // Gather form data
        const artisticName = document.getElementById('input-artistic-name').value.trim();
        const fullName = document.getElementById('input-full-name').value.trim();
        const location = normalizeDashboardLocation(document.getElementById('input-location').value.trim());
        const styles = [...dashboardSelectedStyles];
        const experience = document.getElementById('input-experience').value;
        const price = document.getElementById('input-price').value;
        const currency = document.getElementById('input-currency').value;
        const portfolio = document.getElementById('input-portfolio').value.trim();
        const workType = document.getElementById('input-work-type').value;
        const studioName = document.getElementById('input-studio').value.trim();
        const birthDate = document.getElementById('input-birthdate').value;
        const newsletter = document.getElementById('input-newsletter').checked;
        const instagram = document.getElementById('input-instagram').value.trim();
        const whatsappNumber = document.getElementById('input-whatsapp').value.trim();
        const tattooLocationsPayload = buildTattooLocationsPayload();
        // Note: embajador is managed by support team only - not editable by artist

        // Format username
        const username = formatUsername(artisticName);

        // Format session price
        const sessionPrice = price ? `${price} ${currency}` : null;

        // Keep legacy studio fields in sync with the first active location
        const firstCurrentLocation = tattooLocationsPayload.find((location) => location.period_type === 'current') || null;
        let normalizedWorkType = workType || null;
        let estudios;
        let resolvedStudioId = null;

        if (firstCurrentLocation) {
            resolvedStudioId = await dashboardFindOrCreateStudio(firstCurrentLocation.studio_name);
            estudios = firstCurrentLocation.studio_name.toUpperCase();
            if (!normalizedWorkType || normalizedWorkType === 'independent') {
                normalizedWorkType = 'studio';
            }
        } else if (tattooLocationsPayload.length > 0) {
            estudios = 'Sin estudio/Independiente';
            normalizedWorkType = 'independent';
        } else if (workType === 'independent') {
            estudios = 'Sin estudio/Independiente';
        } else if (studioName) {
            resolvedStudioId = await dashboardFindOrCreateStudio(studioName);
            estudios = studioName.toUpperCase();
        } else {
            estudios = null;
        }

        // Capitalize full name
        const capitalizedName = capitalizeWords(fullName);

        // Generate WhatsApp URL for We Otzi (always points to We Otzi)
        const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541127015926';
        const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
        const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${username}`);
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;

        document.getElementById('input-location').value = location;

        // Address: independent → store on artists_db. studio/both → push to
        // the linked studios row (if we have one).
        const pickedAddress = dashboardAddressDraft || null;
        const isIndependent = normalizedWorkType === 'independent';
        const indepAddress  = (isIndependent && pickedAddress) ? pickedAddress : {};

        if ((normalizedWorkType === 'studio' || normalizedWorkType === 'both')
            && resolvedStudioId
            && pickedAddress
            && pickedAddress.formatted_address) {
            try {
                await _supabase.from('studios').update({
                    country:           pickedAddress.country || null,
                    country_code:      pickedAddress.country_code || null,
                    state_province:    pickedAddress.state_province || null,
                    city:              pickedAddress.city || null,
                    locality:          pickedAddress.locality || null,
                    street:            pickedAddress.street || null,
                    street_number:     pickedAddress.street_number || null,
                    unit:              pickedAddress.unit || null,
                    postal_code:       pickedAddress.postal_code || null,
                    formatted_address: pickedAddress.formatted_address,
                    latitude:          Number.isFinite(pickedAddress.latitude)  ? pickedAddress.latitude  : null,
                    longitude:         Number.isFinite(pickedAddress.longitude) ? pickedAddress.longitude : null,
                    google_place_id:   pickedAddress.google_place_id || null,
                    geocoded_at:       new Date().toISOString()
                }).eq('id', resolvedStudioId);
            } catch (addrErr) {
                console.warn('[dashboard] Could not persist studio address:', addrErr);
            }
        }

        const updateData = {
            username: username,
            name: capitalizedName,
            ubicacion: location,
            styles_array: styles,
            estilo: styles.join(', '),
            years_experience: experience,
            session_price: sessionPrice,
            session_price_amount: price ? parseFloat(price) || null : null,
            session_price_currency: currency || null,
            portafolio: portfolio || null,
            estudios: estudios,
            studio_id: resolvedStudioId,
            work_type: normalizedWorkType,
            birth_date: birthDate || null,
            subscribed_newsletter: newsletter,
            instagram: instagram || null,
            whatsapp_number: whatsappNumber || null,
            whatsapp_url: whatsappUrl,
            // Independent's own structured address (cleared when studio mode).
            country_code:      isIndependent ? (indepAddress.country_code      || null) : null,
            state_province:    isIndependent ? (indepAddress.state_province    || null) : null,
            locality:          isIndependent ? (indepAddress.locality          || null) : null,
            street:            isIndependent ? (indepAddress.street            || null) : null,
            street_number:     isIndependent ? (indepAddress.street_number     || null) : null,
            unit:              isIndependent ? (indepAddress.unit              || null) : null,
            postal_code:       isIndependent ? (indepAddress.postal_code       || null) : null,
            formatted_address: isIndependent ? (indepAddress.formatted_address || null) : null,
            google_place_id:   isIndependent ? (indepAddress.google_place_id   || null) : null,
            latitude:          isIndependent && Number.isFinite(indepAddress.latitude)  ? indepAddress.latitude  : null,
            longitude:         isIndependent && Number.isFinite(indepAddress.longitude) ? indepAddress.longitude : null,
            geocoded_at:       isIndependent && indepAddress.formatted_address ? new Date().toISOString() : null
        };

        const { error } = await _supabase
            .from('artists_db')
            .update(updateData)
            .eq('user_id', currentUser.id);

        if (error) throw error;

        await saveArtistTattooLocations(tattooLocationsPayload);

        // Update local data
        artistData = { ...artistData, ...updateData };

        // Exit edit mode and refresh display
        toggleEditMode();
        populateDashboard();
        
        // Recheck profile completion milestone
        checkProfileCompletion();

        showStatusMessage('Perfil actualizado correctamente.', 'success');

    } catch (error) {
        console.error('Error saving profile:', error);
        showStatusMessage(error?.message || 'Error al guardar el perfil.', 'error');
    } finally {
        saveBtn.textContent = 'Guardar Cambios';
        saveBtn.disabled = false;
    }
}

// ============================================
// AVATAR UPLOAD
// ============================================

// ============================================
// AI AVATAR GENERATOR
// ============================================

function openAIAvatarModal() {
    const modal = document.getElementById('ai-avatar-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeAIAvatarModal() {
    const modal = document.getElementById('ai-avatar-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
        // Clear state
        document.getElementById('ai-avatar-preview-container').style.display = 'none';
        document.getElementById('use-ai-avatar-btn').style.display = 'none';
        document.getElementById('ai-avatar-message').textContent = '';
        document.getElementById('ai-avatar-prompt').value = '';
    }
}

function closeAIAvatarModalOnOverlay(e) {
    if (e.target.id === 'ai-avatar-modal') {
        closeAIAvatarModal();
    }
}

async function generateAIAvatar() {
    const promptInput = document.getElementById('ai-avatar-prompt');
    const prompt = promptInput.value.trim();
    const messageEl = document.getElementById('ai-avatar-message');
    const generateBtn = document.getElementById('generate-ai-avatar-btn');
    const previewContainer = document.getElementById('ai-avatar-preview-container');
    const previewImg = document.getElementById('ai-avatar-preview');
    const useBtn = document.getElementById('use-ai-avatar-btn');

    if (!prompt) {
        messageEl.textContent = 'Por favor ingresa una descripción.';
        messageEl.className = 'form-message error';
        return;
    }

    const config = window.ConfigManager?.get() || {};

    messageEl.textContent = 'Generando imagen, esto puede tardar unos segundos...';
    messageEl.className = 'form-message info';
    generateBtn.disabled = true;
    previewContainer.style.display = 'none';
    useBtn.style.display = 'none';

    try {
        const aiSettings = config.aiProfilePicture || {};
        const fullPrompt = `${aiSettings.defaultPrompt || ''}\n\nUser request: ${prompt}`;

        const response = await fetch('/api/gemini/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: fullPrompt,
                model: aiSettings.model || config.gemini?.model,
                aspectRatio: "1:1",
                imageSize: aiSettings.resolution || "1K",
                temperature: aiSettings.temperature || 0.7,
                maxOutputTokens: aiSettings.maxTokens || 1024,
                safetySettings: aiSettings.filters === 'High' ? [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" }
                ] : undefined
            })
        });

        const data = await response.json();

        if (!data.success) throw new Error(data.error || 'Error al generar imagen');

        previewImg.src = data.image;
        previewContainer.style.display = 'block';
        useBtn.style.display = 'block';
        messageEl.textContent = '¡Imagen generada con éxito!';
        messageEl.className = 'form-message success';

    } catch (error) {
        console.error('AI Generation Error:', error);
        messageEl.textContent = 'Error: ' + error.message;
        messageEl.className = 'form-message error';
    } finally {
        generateBtn.disabled = false;
    }
}

async function useAIAvatar() {
    const previewImg = document.getElementById('ai-avatar-preview');
    const base64Data = previewImg.src;
    
    if (!base64Data.startsWith('data:image/')) return;

    const messageEl = document.getElementById('ai-avatar-message');
    const useBtn = document.getElementById('use-ai-avatar-btn');
    
    messageEl.textContent = 'Subiendo imagen a tu perfil...';
    messageEl.className = 'form-message info';
    useBtn.disabled = true;

    try {
        // Convert base64 to blob
        const res = await fetch(base64Data);
        const blob = await res.blob();
        
        // Generate unique filename
        const fileName = `ai-avatar-${Date.now()}.png`;
        const filePath = `${currentUser.id}/${fileName}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await _supabase.storage
            .from('profile-pictures')
            .upload(filePath, blob, {
                cacheControl: '3600',
                upsert: true,
                contentType: 'image/png'
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = _supabase.storage
            .from('profile-pictures')
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Update artist record
        const { error: updateError } = await _supabase
            .from('artists_db')
            .update({ profile_picture: publicUrl })
            .eq('user_id', currentUser.id);

        if (updateError) throw updateError;

        // Update UI
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = publicUrl;
        avatarImg.classList.add('loaded');
        artistData.profile_picture = publicUrl;

        showStatusMessage('Foto de perfil actualizada con IA.', 'success');
        closeAIAvatarModal();
        
        if (typeof checkProfileCompletion === 'function') {
            checkProfileCompletion();
        }

    } catch (error) {
        console.error('Error saving AI avatar:', error);
        messageEl.textContent = 'Error al guardar la imagen: ' + error.message;
        messageEl.className = 'form-message error';
    } finally {
        useBtn.disabled = false;
    }
}

// ============================================

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Permitir HEIC (file.type puede estar vacío en Chrome/Firefox para HEIC)
    const isImage = file.type.startsWith('image/') || isHEICFile(file);
    if (!isImage) {
        showStatusMessage('Por favor selecciona una imagen.', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB pre-compresión; se comprime a ≤1MB
        showStatusMessage('La imagen es muy grande. Maximo 10MB.', 'error');
        return;
    }

    const loadingEl = document.getElementById('avatar-loading');
    loadingEl.classList.add('active');

    const queue = new UploadQueue(
        async (processedFile) => {
            const fileExt = processedFile.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { error: uploadError } = await _supabase.storage
                .from('profile-pictures')
                .upload(filePath, processedFile, { cacheControl: '3600', upsert: true });

            if (uploadError) {
                if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('not found')) {
                    showStatusMessage('El almacenamiento de fotos no esta configurado. Contacta al administrador.', 'error');
                    return;
                }
                throw uploadError;
            }

            const { data: urlData } = _supabase.storage.from('profile-pictures').getPublicUrl(filePath);
            const publicUrl = urlData.publicUrl;

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ profile_picture: publicUrl })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            const avatarImg = document.getElementById('avatar-image');
            avatarImg.src = publicUrl;
            avatarImg.classList.add('loaded');
            artistData.profile_picture = publicUrl;
            showStatusMessage('Foto de perfil actualizada.', 'success');
            checkProfileCompletion();
        },
        () => {},
        (file, err) => {
            console.error('Error uploading avatar:', err);
            showStatusMessage('Error al subir la imagen.', 'error');
        }
    );

    try {
        await queue.addFiles([file]);
    } catch (error) {
        console.error('Error uploading avatar:', error);
        showStatusMessage('Error al subir la imagen.', 'error');
    } finally {
        loadingEl.classList.remove('active');
        e.target.value = '';
    }
}

// ============================================
// GALLERY MANAGEMENT
// ============================================

const MAX_GALLERY_IMAGES = 12;
const MAX_GALLERY_VIDEOS = 2;
const MAX_VIDEO_SIZE_MB = 80;
const MAX_VIDEO_DURATION_S = 30;
let dashboardGalleryLightboxReady = false;
let dashboardGalleryLightboxState = {
    items: [],
    index: 0,
    origin: 'admin'
};

function isVideoFile(file) {
    return file.type === 'video/mp4' || file.type === 'video/quicktime';
}

function isUrlVideo(url) {
    const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
    return ext === 'mp4' || ext === 'mov';
}

function getVideoDuration(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => { URL.revokeObjectURL(video.src); resolve(video.duration); };
        video.onerror = () => resolve(0);
        video.src = URL.createObjectURL(file);
    });
}

const GALLERY_CATEGORY_OPTIONS = ['realizados', 'flash', 'proyectos'];
const GALLERY_CATEGORY_LABELS = {
    realizados: 'Realizado',
    flash: 'Flash',
    proyectos: 'Proyecto'
};

function normalizeGalleryCategory(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'flash') return 'flash';
    if (raw === 'proyectos' || raw === 'proyecto' || raw === 'projects' || raw === 'project') return 'proyectos';
    return 'realizados';
}

function parseJsonArraySafe(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeDashboardGalleryFeedItems() {
    const normalized = [];
    const seen = new Set();

    const feedItems = parseJsonArraySafe(artistData?.gallery_feed_items);
    for (const raw of feedItems) {
        const url = String(raw?.url || '').trim();
        if (!url || seen.has(url)) continue;

        const category = normalizeGalleryCategory(raw?.category);
        normalized.push({
            url,
            category,
            kind: raw?.kind === 'video' || isUrlVideo(url) ? 'video' : 'image',
            created_at: raw?.created_at || new Date().toISOString()
        });
        seen.add(url);
    }

    if (!normalized.length) {
        const legacyItems = parseJsonArraySafe(artistData?.gallery_images);
        for (const entry of legacyItems) {
            const url = typeof entry === 'string'
                ? entry.trim()
                : String(entry?.url || '').trim();

            if (!url || seen.has(url)) continue;

            normalized.push({
                url,
                category: 'realizados',
                kind: isUrlVideo(url) ? 'video' : 'image',
                created_at: new Date().toISOString()
            });
            seen.add(url);
        }
    }

    return normalized;
}

function syncDashboardGalleryFromFeed(feedItems) {
    const safeFeed = Array.isArray(feedItems) ? feedItems : [];
    artistData.gallery_feed_items = safeFeed;
    artistData.gallery_images = safeFeed.map((item) => item.url);
}

function isMissingGalleryFeedColumnError(error) {
    const haystack = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return haystack.includes('gallery_feed_items') && haystack.includes('column');
}

async function persistDashboardGalleryFeed(feedItems) {
    const safeFeed = Array.isArray(feedItems) ? feedItems : [];
    const legacyImages = safeFeed.map((item) => item.url);

    const payload = {
        gallery_images: legacyImages,
        gallery_feed_items: safeFeed
    };

    let { error } = await _supabase
        .from('artists_db')
        .update(payload)
        .eq('user_id', currentUser.id);

    if (error && isMissingGalleryFeedColumnError(error)) {
        const retry = await _supabase
            .from('artists_db')
            .update({ gallery_images: legacyImages })
            .eq('user_id', currentUser.id);
        error = retry.error;
    }

    if (error) throw error;

    syncDashboardGalleryFromFeed(safeFeed);
}

function getSelectedGalleryCategory(selectId) {
    const select = document.getElementById(selectId);
    const category = normalizeGalleryCategory(select?.value);
    if (select && !GALLERY_CATEGORY_OPTIONS.includes(select.value)) {
        select.value = category;
    }
    return category;
}

function setupGalleryListeners() {
    const galleryInput = document.getElementById('gallery-input');
    if (galleryInput) {
        galleryInput.addEventListener('change', handleGalleryUpload);
    }
    setupDashboardGalleryLightbox();
}

function setupDashboardGalleryLightbox() {
    if (dashboardGalleryLightboxReady) return;

    const lightbox = document.getElementById('dashboard-gallery-lightbox');
    const closeBtn = document.getElementById('dashboard-lightbox-close');
    const prevBtn = document.getElementById('dashboard-lightbox-prev');
    const nextBtn = document.getElementById('dashboard-lightbox-next');
    const adminGrid = document.getElementById('gallery-admin-grid');
    const editPreview = document.getElementById('gallery-edit-preview');

    if (!lightbox || !closeBtn || !prevBtn || !nextBtn || !adminGrid || !editPreview) return;

    dashboardGalleryLightboxReady = true;

    adminGrid.addEventListener('click', (event) => handleDashboardGalleryClick(event, 'admin'));
    editPreview.addEventListener('click', (event) => handleDashboardGalleryClick(event, 'edit'));

    closeBtn.addEventListener('click', closeDashboardGalleryLightbox);
    prevBtn.addEventListener('click', () => navigateDashboardGalleryLightbox(-1));
    nextBtn.addEventListener('click', () => navigateDashboardGalleryLightbox(1));

    lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox) {
            closeDashboardGalleryLightbox();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (!lightbox.classList.contains('active')) return;
        if (event.key === 'Escape') closeDashboardGalleryLightbox();
        if (event.key === 'ArrowLeft') navigateDashboardGalleryLightbox(-1);
        if (event.key === 'ArrowRight') navigateDashboardGalleryLightbox(1);
    });
}

function handleDashboardGalleryClick(event, origin) {
    if (event.target.closest('.gallery-item-delete, .gallery-edit-thumb-delete')) return;

    const itemSelector = origin === 'edit' ? '.gallery-edit-thumb' : '.gallery-item';
    const itemEl = event.target.closest(itemSelector);
    if (!itemEl) return;

    const index = Number(itemEl.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;

    openDashboardGalleryLightbox(index, origin);
}

function openDashboardGalleryLightbox(index, origin = 'admin') {
    const lightbox = document.getElementById('dashboard-gallery-lightbox');
    const images = normalizeDashboardGalleryFeedItems().map((item) => item.url);
    if (!lightbox || !images.length) return;

    dashboardGalleryLightboxState = {
        items: images,
        index: Math.min(Math.max(index, 0), images.length - 1),
        origin
    };

    lightbox.dataset.origin = origin;
    updateDashboardGalleryLightboxItem();
    lightbox.classList.add('active');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeDashboardGalleryLightbox() {
    const lightbox = document.getElementById('dashboard-gallery-lightbox');
    if (!lightbox) return;

    stopDashboardLightboxVideo();
    lightbox.classList.remove('active');
    lightbox.setAttribute('aria-hidden', 'true');
    delete lightbox.dataset.origin;
    document.body.style.overflow = '';
}

function stopDashboardLightboxVideo() {
    const video = document.getElementById('dashboard-lightbox-video');
    if (!video) return;

    video.pause();
    video.removeAttribute('src');
    video.load();
}

function navigateDashboardGalleryLightbox(direction) {
    const items = dashboardGalleryLightboxState.items || [];
    if (!items.length) return;

    stopDashboardLightboxVideo();
    let nextIndex = dashboardGalleryLightboxState.index + direction;
    if (nextIndex < 0) nextIndex = items.length - 1;
    if (nextIndex >= items.length) nextIndex = 0;
    dashboardGalleryLightboxState.index = nextIndex;
    updateDashboardGalleryLightboxItem();
}

function updateDashboardGalleryLightboxItem() {
    const image = document.getElementById('dashboard-lightbox-image');
    const video = document.getElementById('dashboard-lightbox-video');
    const counter = document.getElementById('dashboard-lightbox-counter');
    const items = dashboardGalleryLightboxState.items || [];
    const currentUrl = items[dashboardGalleryLightboxState.index];
    if (!image || !video || !counter || !currentUrl) return;

    const isVideo = isUrlVideo(currentUrl);
    if (isVideo) {
        image.style.display = 'none';
        image.removeAttribute('src');
        video.style.display = 'block';
        video.src = currentUrl;
        video.load();
    } else {
        stopDashboardLightboxVideo();
        video.style.display = 'none';
        image.style.display = 'block';
        image.src = currentUrl;
    }

    counter.textContent = `${dashboardGalleryLightboxState.index + 1} / ${items.length}`;
}

async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentFeedItems = normalizeDashboardGalleryFeedItems();
    const remainingSlots = MAX_GALLERY_IMAGES - currentFeedItems.length;
    const selectedCategory = getSelectedGalleryCategory('gallery-category-select');

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} archivos mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    const videoFiles = files.filter(f => isVideoFile(f));
    const imageFiles = files.filter(f => !isVideoFile(f));

    // Validate image files
    for (const file of imageFiles) {
        if (!file.type.startsWith('image/') && !isHEICFile(file)) {
            showStatusMessage('Solo se permiten imagenes o videos en formato MP4/MOV.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 10MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    // Validate video files
    const currentVideoCount = currentFeedItems.filter((item) => isUrlVideo(item.url)).length;
    if (currentVideoCount + videoFiles.length > MAX_GALLERY_VIDEOS) {
        showStatusMessage(`Ya tienes el maximo de ${MAX_GALLERY_VIDEOS} videos en tu portfolio.`, 'error');
        e.target.value = '';
        return;
    }
    for (const file of videoFiles) {
        if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
            showStatusMessage(`El video no puede superar los ${MAX_VIDEO_SIZE_MB}MB.`, 'error');
            e.target.value = '';
            return;
        }
        const duration = await getVideoDuration(file);
        if (duration > MAX_VIDEO_DURATION_S) {
            showStatusMessage(`El video supera los ${MAX_VIDEO_DURATION_S} segundos permitidos.`, 'error');
            e.target.value = '';
            return;
        }
        if (file.name.toLowerCase().endsWith('.mov')) {
            showStatusMessage('Nota: los archivos .MOV pueden no reproducirse en Firefox.', 'warning');
        }
    }

    const loadingEl = document.getElementById('gallery-admin-loading');
    const progressFill = document.getElementById('gallery-progress-fill');
    const uploadCounter = document.getElementById('gallery-upload-counter');
    if (progressFill) progressFill.style.width = '0%';
    loadingEl.style.display = 'block';

    const uploadedUrls = [];

    try {
        // Upload images via UploadQueue (handles HEIC conversion + compression)
        if (imageFiles.length > 0) {
            const queue = new UploadQueue(
                async (processedFile) => {
                    const fileExt = processedFile.name.split('.').pop();
                    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
                    const filePath = `${currentUser.id}/${fileName}`;
                    const { error: uploadError } = await _supabase.storage
                        .from('artist-gallery')
                        .upload(filePath, processedFile, { cacheControl: '3600', upsert: false });
                    if (uploadError) { console.error('Upload error:', uploadError); return; }
                    const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
                    uploadedUrls.push(urlData.publicUrl);
                },
                (current, total) => {
                    const overall = Math.round(((current) / files.length) * 100);
                    if (progressFill) progressFill.style.width = `${overall}%`;
                    if (uploadCounter) uploadCounter.textContent = `${current} / ${files.length}`;
                },
                (file, err) => { console.error('Gallery upload error:', err); }
            );
            await queue.addFiles(imageFiles);
        }

        // Upload videos directly (no HEIC conversion or compression)
        for (let i = 0; i < videoFiles.length; i++) {
            const file = videoFiles[i];
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;
            const overall = Math.round(((imageFiles.length + i + 1) / files.length) * 100);
            if (progressFill) progressFill.style.width = `${overall}%`;
            if (uploadCounter) uploadCounter.textContent = `${imageFiles.length + i + 1} / ${files.length}`;
            const { error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, file, { cacheControl: '3600', upsert: false });
            if (uploadError) { console.error('Video upload error:', uploadError); continue; }
            const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
            uploadedUrls.push(urlData.publicUrl);
        }

        if (uploadedUrls.length > 0) {
            const newFeedItems = uploadedUrls.map((url) => ({
                url,
                category: selectedCategory,
                kind: isUrlVideo(url) ? 'video' : 'image',
                created_at: new Date().toISOString()
            }));
            await persistDashboardGalleryFeed([...currentFeedItems, ...newFeedItems]);
            renderGalleryAdmin();
            renderGalleryEditPreview();
            showStatusMessage(`${uploadedUrls.length} archivo(s) subido(s) en ${selectedCategory}.`, 'success');
        }
    } catch (error) {
        console.error('Error uploading gallery files:', error);
        showStatusMessage('Error al subir los archivos.', 'error');
    } finally {
        loadingEl.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
        if (uploadCounter) uploadCounter.textContent = '0 / 0';
        e.target.value = '';
    }
}

function renderGalleryAdmin() {
    const grid = document.getElementById('gallery-admin-grid');
    const emptyState = document.getElementById('gallery-empty');
    const feedItems = normalizeDashboardGalleryFeedItems();
    syncDashboardGalleryFromFeed(feedItems);

    if (feedItems.length === 0) {
        grid.innerHTML = '';
        grid.appendChild(emptyState);
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';
    const filledSlots = feedItems.map((item, index) => {
        const url = item.url;
        const isVideo = isUrlVideo(url);
        const categoryLabel = GALLERY_CATEGORY_LABELS[normalizeGalleryCategory(item.category)] || 'Realizado';
        return `
        <div class="gallery-item" data-index="${index}">
            ${isVideo
                ? `<video src="${url}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>
                   <span class="gallery-video-badge">VIDEO</span>
                   <span class="gallery-video-play">&#9654;</span>`
                : `<img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">`}
            <span class="gallery-category-badge">${categoryLabel}</span>
            <button class="gallery-item-delete" onclick="deleteGalleryImage(${index})" aria-label="Eliminar archivo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>`;
    });

    const emptySlots = Array.from({ length: Math.max(0, MAX_GALLERY_IMAGES - feedItems.length) }, () => (
        '<div class="gallery-item-slot" aria-hidden="true"></div>'
    ));

    grid.innerHTML = [...filledSlots, ...emptySlots].join('');
}

async function deleteGalleryImage(index) {
    const feedItems = normalizeDashboardGalleryFeedItems();
    const imageUrl = feedItems[index]?.url;

    if (!imageUrl) return;

    if (!confirm('Estas seguro de eliminar este archivo?')) return;

    try {
        const urlParts = imageUrl.split('/artist-gallery/');
        if (urlParts.length > 1) {
            const filePath = urlParts[1];
            await _supabase.storage.from('artist-gallery').remove([filePath]);
        }

        const nextFeedItems = feedItems.filter((_, i) => i !== index);
        await persistDashboardGalleryFeed(nextFeedItems);
        renderGalleryAdmin();
        renderGalleryEditPreview();
        showStatusMessage('Archivo eliminado correctamente.', 'success');

    } catch (error) {
        console.error('Error deleting gallery file:', error);
        showStatusMessage('Error al eliminar el archivo.', 'error');
    }
}

// ============================================
// LOGOUT
// ============================================

async function handleLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        
        window.location.href = dashboardAuthUrls.registerClosedBeta;
    } catch (error) {
        console.error('Logout error:', error);
        showStatusMessage('Error al cerrar sesion.', 'error');
    }
}

// ============================================
// PASSWORD CHANGE
// ============================================

function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('new-password').focus();
}

function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('password-form').reset();
    clearPasswordMessage();
}

function closePasswordModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closePasswordModal();
    }
}

function showPasswordMessage(message, type = 'info') {
    const messageDiv = document.getElementById('password-message');
    messageDiv.textContent = message;
    messageDiv.className = 'form-message ' + type;
}

function clearPasswordMessage() {
    const messageDiv = document.getElementById('password-message');
    messageDiv.textContent = '';
    messageDiv.className = 'form-message';
}

async function handlePasswordChange(e) {
    e.preventDefault();
    
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        showPasswordMessage('Las contrasenas no coinciden.', 'error');
        return;
    }

    if (newPassword.length < 8) {
        showPasswordMessage('La contrasena debe tener al menos 8 caracteres.', 'error');
        return;
    }

    const submitBtn = document.querySelector('#password-form .btn-modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Actualizando...';

    try {
        const { error } = await _supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        showPasswordMessage('Contrasena actualizada correctamente.', 'success');
        
        setTimeout(() => {
            closePasswordModal();
        }, 1500);

    } catch (error) {
        console.error('Password change error:', error);
        showPasswordMessage('Error al cambiar la contrasena.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            Actualizar
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
        `;
    }
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        setDashboardMobileMenuOpen(false);
        closePasswordModal();
        closeVerificationModal();
        closeUpcomingTravelModal();
        closeQRModal();
    }
});

// ============================================
// VERIFICATION SYSTEM
// ============================================

const VERIFICATION_STATES = {
    'No': { text: 'No Verificado', canRequest: true },
    'Requested': { text: 'Solicitud Enviada', canRequest: false },
    'In Progress': { text: 'En Proceso', canRequest: false },
    'In Analysis': { text: 'En Analisis', canRequest: false },
    'Yes': { text: 'Verificado', canRequest: false },
    'Denied': { text: 'Denegado', canRequest: true },
    'Canceled': { text: 'Cancelado', canRequest: true }
};

function updateVerificationUI(state) {
    const badge = document.getElementById('verification-badge');
    const badgeText = document.getElementById('verification-text');
    const verifyBtn = document.getElementById('request-verification-btn');
    
    const stateConfig = VERIFICATION_STATES[state] || VERIFICATION_STATES['No'];
    
    // Update badge
    badge.setAttribute('data-state', state);
    badgeText.textContent = stateConfig.text;
    badge.style.display = 'inline-flex';
    
    // Update button state and text
    if (state === 'Yes') {
        verifyBtn.classList.add('verified');
        verifyBtn.classList.remove('requested', 'in-progress');
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Perfil Verificado
        `;
        verifyBtn.disabled = true;
    } else if (state === 'Requested' || state === 'In Progress' || state === 'In Analysis') {
        verifyBtn.classList.add('requested');
        verifyBtn.classList.remove('verified', 'in-progress');
        const statusText = state === 'Requested' ? 'Solicitud Enviada' : 
                          state === 'In Progress' ? 'En Proceso' : 'En Analisis';
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${statusText}
        `;
        verifyBtn.disabled = true;
    } else {
        verifyBtn.classList.remove('verified', 'requested', 'in-progress');
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
            </svg>
            Verificar Perfil
        `;
        verifyBtn.disabled = false;
    }

    renderTopBanner();
}

function openVerificationModal() {
    // Check if user can request verification
    const currentState = artistData?.verification_state || 'No';
    const stateConfig = VERIFICATION_STATES[currentState];
    
    if (!stateConfig.canRequest) {
        showStatusMessage(`Tu solicitud ya esta ${stateConfig.text.toLowerCase()}.`, 'info');
        return;
    }
    
    const modal = document.getElementById('verification-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    clearVerificationMessage();
}

function closeVerificationModal() {
    const modal = document.getElementById('verification-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    clearVerificationMessage();
}

function closeVerificationModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeVerificationModal();
    }
}

function showVerificationMessage(message, type = 'info') {
    const messageDiv = document.getElementById('verification-message');
    messageDiv.textContent = message;
    messageDiv.className = 'form-message ' + type;
}

function clearVerificationMessage() {
    const messageDiv = document.getElementById('verification-message');
    messageDiv.textContent = '';
    messageDiv.className = 'form-message';
}

async function submitVerificationRequest() {
    const submitBtn = document.getElementById('submit-verification-btn');
    
    if (!currentUser || !artistData) {
        showVerificationMessage('Error: No se pudo identificar tu cuenta.', 'error');
        return;
    }
    
    // Disable button and show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
        <span>Enviando solicitud...</span>
    `;
    
    try {
        // Update verification_state to "Requested"
        const { error } = await _supabase
            .from('artists_db')
            .update({ verification_state: 'Requested' })
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        
        // Update local data
        artistData.verification_state = 'Requested';
        
        // Update UI
        updateVerificationUI('Requested');
        
        // Show success message
        showVerificationMessage('Solicitud enviada correctamente. Nuestro equipo se pondra en contacto contigo pronto.', 'success');
        
        // Close modal after delay
        setTimeout(() => {
            closeVerificationModal();
            showStatusMessage('Solicitud de verificacion enviada.', 'success');
        }, 2500);
        
    } catch (error) {
        console.error('Error submitting verification request:', error);
        showVerificationMessage('Error al enviar la solicitud. Intenta de nuevo.', 'error');
        
        // Restore button
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            Solicitar Verificacion
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
        `;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function showStatusMessage(message, type = 'info') {
    const messageDiv = document.getElementById('status-message');
    messageDiv.textContent = message;
    messageDiv.className = 'status-message ' + type;

    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'status-message';
    }, 4000);
}

function capitalizeWords(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatUsername(artisticName) {
    if (!artisticName) return '';
    
    let username = artisticName.toLowerCase();
    username = username.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    username = username.replace(/[^a-z0-9]/g, '');
    
    return username + '.wo';
}

// ============================================
// THEME TOGGLE
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const btn = document.querySelector('.theme-toggle');
    btn.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-yellow');
    setTimeout(() => {
        btn.style.backgroundColor = '';
    }, 300);
}

// ============================================
// ZOOM CONTROLS
// ============================================

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.8;
}

function setZoom(factor) {
    const clampedFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clampedFactor);
    localStorage.setItem('weotzi-zoom', clampedFactor);
}

function zoomIn() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom - ZOOM_STEP);
}

function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// LEVEL & MILESTONES SYSTEM
// ============================================

function updateLevelBadge() {
    if (!artistData) return;
    
    const levelBadge = document.getElementById('artist-level-badge');
    const levelText = document.getElementById('level-text');
    const nivel = artistData.nivel || 'Nuevo';
    
    levelText.textContent = nivel;
    levelBadge.setAttribute('data-level', nivel);
}

function updateMilestonesUI() {
    if (!artistData) return;
    renderTopBanner();
}

async function checkProfileCompletion() {
    if (!artistData || !currentUser) return;
    
    // Already completed, no need to check again
    if (artistData.ms_profile_complete) return;
    
    // Define required fields for profile completion
    const requiredFields = [
        'name',
        'username',
        'ubicacion',
        'styles_array',
        'session_price',
        'years_experience',
        'whatsapp_number',
        'instagram',
        'profile_picture'
    ];
    
    // Check if all required fields are filled
    const isComplete = requiredFields.every(field => {
        const value = artistData[field];
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        return value && value.trim && value.trim() !== '';
    });
    
    if (isComplete) {
        await trackMilestone('ms_profile_complete');
    }
}

async function trackMilestone(milestoneField) {
    if (!currentUser || !artistData) return;
    
    // Already completed
    if (artistData[milestoneField]) return;
    
    try {
        const updateData = { [milestoneField]: true };
        
        const { error } = await _supabase
            .from('artists_db')
            .update(updateData)
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        
        // Update local data
        artistData[milestoneField] = true;
        
        // Update UI
        updateMilestonesUI();
        
        // Show success feedback
        const milestoneNames = {
            ms_profile_complete: 'Perfil Completo',
            ms_first_quote_received: 'Primera Cotizacion Recibida',
            ms_whatsapp_shared: 'Enlace WhatsApp Compartido',
            ms_profile_shared: 'Perfil Compartido',
            ms_first_quote_completed: 'Primera Cotizacion Completada'
        };
        
        showStatusMessage(`Hito desbloqueado: ${milestoneNames[milestoneField]}!`, 'success');
        
        console.log(`Milestone unlocked: ${milestoneField}`);
        
    } catch (error) {
        console.error('Error tracking milestone:', error);
    }
}

async function shareProfile() {
    const shareBtn = document.getElementById('share-profile-btn');
    const username = artistData?.username || 'artista';
    
    // Generate profile URL pointing to the public profile page
    const baseUrl = window.location.origin;
    const profileUrl = `${baseUrl}/artist/profile?artist=${encodeURIComponent(username)}`;
    const shareText = `Mira mi perfil de artista en We Otzi: ${profileUrl}`;
    
    // Try native share API first (mobile)
    if (navigator.share) {
        try {
            await navigator.share({
                title: `${username} - We Otzi`,
                text: `Conoce mi trabajo como tatuador en We Otzi`,
                url: profileUrl
            });
            
            // Track milestone
            trackMilestone('ms_profile_shared');
            shareBtn.classList.add('shared');
            setTimeout(() => shareBtn.classList.remove('shared'), 2000);
            return;
        } catch (err) {
            // User cancelled or share failed, fall back to clipboard
            if (err.name !== 'AbortError') {
                console.log('Share failed, falling back to clipboard');
            }
        }
    }
    
    // Fallback: copy to clipboard
    try {
        await navigator.clipboard.writeText(profileUrl);
        shareBtn.classList.add('shared');
        showStatusMessage('Enlace de perfil copiado al portapapeles.', 'success');
        
        // Track milestone
        trackMilestone('ms_profile_shared');
        
        setTimeout(() => shareBtn.classList.remove('shared'), 2000);
    } catch (err) {
        console.error('Error sharing profile:', err);
        showStatusMessage('Error al compartir el perfil.', 'error');
    }
}

// Check for quote-based milestones
async function checkQuoteMilestones(stats) {
    if (!currentUser || !artistData) return;
    
    // Check if received at least 1 quote
    if (stats.total > 0 && !artistData.ms_first_quote_received) {
        await trackMilestone('ms_first_quote_received');
    }
    
    // Check if completed at least 1 quote (status 'responded' or 'completed')
    if (stats.answered > 0 && !artistData.ms_first_quote_completed) {
        await trackMilestone('ms_first_quote_completed');
    }
}

// ============================================
// PREVIEW PUBLIC PROFILE
// ============================================

function previewPublicProfile() {
    if (!artistData || !artistData.username) {
        showStatusMessage('No se puede mostrar el perfil. Completa tu perfil primero.', 'error');
        return;
    }
    
    const username = artistData.username;
    const baseUrl = window.location.origin;
    const profileUrl = `${baseUrl}/artist/profile?artist=${encodeURIComponent(username)}`;
    
    // Open in new tab
    window.open(profileUrl, '_blank');
}

// ============================================
// GALLERY EDIT MODE FUNCTIONS
// ============================================

function renderGalleryEditPreview() {
    const previewContainer = document.getElementById('gallery-edit-preview');
    const countEl = document.getElementById('gallery-edit-count');
    const feedItems = normalizeDashboardGalleryFeedItems();
    syncDashboardGalleryFromFeed(feedItems);

    if (!previewContainer) return;

    // Update count
    if (countEl) {
        countEl.textContent = `${feedItems.length}/${MAX_GALLERY_IMAGES} archivos`;
    }

    if (feedItems.length === 0) {
        previewContainer.innerHTML = '<div class="gallery-edit-empty">Sin archivos. Sube fotos o videos de tus trabajos.</div>';
        return;
    }

    previewContainer.innerHTML = feedItems.map((item, index) => {
        const url = item.url;
        const isVideo = isUrlVideo(url);
        const categoryLabel = GALLERY_CATEGORY_LABELS[normalizeGalleryCategory(item.category)] || 'Realizado';
        return `
        <div class="gallery-edit-thumb" data-index="${index}">
            ${isVideo
                ? `<video src="${url}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>
                   <span class="gallery-video-badge" style="font-size:8px;">VIDEO</span>`
                : `<img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">`}
            <span class="gallery-category-badge">${categoryLabel}</span>
            <button class="gallery-edit-thumb-delete" onclick="deleteGalleryEditImage(${index})" aria-label="Eliminar archivo">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>`;
    }).join('');
}

async function handleGalleryEditUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentFeedItems = normalizeDashboardGalleryFeedItems();
    const remainingSlots = MAX_GALLERY_IMAGES - currentFeedItems.length;
    const selectedCategory = getSelectedGalleryCategory('gallery-edit-category-select');

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} archivos mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    const videoFiles = files.filter(f => isVideoFile(f));
    const imageFiles = files.filter(f => !isVideoFile(f));

    // Validate image files
    for (const file of imageFiles) {
        if (!file.type.startsWith('image/') && !isHEICFile(file)) {
            showStatusMessage('Solo se permiten imagenes o videos en formato MP4/MOV.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 10MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    // Validate video files
    const currentVideoCount = currentFeedItems.filter((item) => isUrlVideo(item.url)).length;
    if (currentVideoCount + videoFiles.length > MAX_GALLERY_VIDEOS) {
        showStatusMessage(`Ya tienes el maximo de ${MAX_GALLERY_VIDEOS} videos en tu portfolio.`, 'error');
        e.target.value = '';
        return;
    }
    for (const file of videoFiles) {
        if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
            showStatusMessage(`El video no puede superar los ${MAX_VIDEO_SIZE_MB}MB.`, 'error');
            e.target.value = '';
            return;
        }
        const duration = await getVideoDuration(file);
        if (duration > MAX_VIDEO_DURATION_S) {
            showStatusMessage(`El video supera los ${MAX_VIDEO_DURATION_S} segundos permitidos.`, 'error');
            e.target.value = '';
            return;
        }
        if (file.name.toLowerCase().endsWith('.mov')) {
            showStatusMessage('Nota: los archivos .MOV pueden no reproducirse en Firefox.', 'warning');
        }
    }

    const editLoadingEl = document.getElementById('gallery-edit-loading');
    const editProgressFill = document.getElementById('gallery-edit-progress-fill');
    const editUploadCounter = document.getElementById('gallery-edit-upload-counter');
    if (editProgressFill) editProgressFill.style.width = '0%';
    if (editLoadingEl) editLoadingEl.style.display = 'block';

    const uploadedUrls = [];

    try {
        // Upload images via UploadQueue
        if (imageFiles.length > 0) {
            const queue = new UploadQueue(
                async (processedFile) => {
                    const fileExt = processedFile.name.split('.').pop();
                    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
                    const filePath = `${currentUser.id}/${fileName}`;
                    const { error: uploadError } = await _supabase.storage
                        .from('artist-gallery')
                        .upload(filePath, processedFile, { cacheControl: '3600', upsert: false });
                    if (uploadError) { console.error('Upload error:', uploadError); return; }
                    const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
                    uploadedUrls.push(urlData.publicUrl);
                },
                (current, total) => {
                    if (editProgressFill) editProgressFill.style.width = `${Math.round((current / files.length) * 100)}%`;
                    if (editUploadCounter) editUploadCounter.textContent = `${current} / ${files.length}`;
                },
                (file, err) => { console.error('Gallery edit upload error:', err); }
            );
            await queue.addFiles(imageFiles);
        }

        // Upload videos directly
        for (let i = 0; i < videoFiles.length; i++) {
            const file = videoFiles[i];
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;
            const overall = Math.round(((imageFiles.length + i + 1) / files.length) * 100);
            if (editProgressFill) editProgressFill.style.width = `${overall}%`;
            if (editUploadCounter) editUploadCounter.textContent = `${imageFiles.length + i + 1} / ${files.length}`;
            const { error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, file, { cacheControl: '3600', upsert: false });
            if (uploadError) { console.error('Video upload error:', uploadError); continue; }
            const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
            uploadedUrls.push(urlData.publicUrl);
        }

        if (uploadedUrls.length > 0) {
            const newFeedItems = uploadedUrls.map((url) => ({
                url,
                category: selectedCategory,
                kind: isUrlVideo(url) ? 'video' : 'image',
                created_at: new Date().toISOString()
            }));
            await persistDashboardGalleryFeed([...currentFeedItems, ...newFeedItems]);
            renderGalleryEditPreview();
            renderGalleryAdmin();
            showStatusMessage(`${uploadedUrls.length} archivo(s) subido(s) en ${selectedCategory}.`, 'success');
        }
    } catch (error) {
        console.error('Error uploading gallery files:', error);
        showStatusMessage('Error al subir los archivos.', 'error');
    } finally {
        if (editLoadingEl) editLoadingEl.style.display = 'none';
        if (editProgressFill) editProgressFill.style.width = '0%';
        if (editUploadCounter) editUploadCounter.textContent = '0 / 0';
        e.target.value = '';
    }
}

async function deleteGalleryEditImage(index) {
    const feedItems = normalizeDashboardGalleryFeedItems();
    const imageUrl = feedItems[index]?.url;

    if (!imageUrl) return;

    if (!confirm('Estas seguro de eliminar este archivo?')) return;

    try {
        const urlParts = imageUrl.split('/artist-gallery/');
        if (urlParts.length > 1) {
            const filePath = urlParts[1];
            await _supabase.storage.from('artist-gallery').remove([filePath]);
        }

        const nextFeedItems = feedItems.filter((_, i) => i !== index);
        await persistDashboardGalleryFeed(nextFeedItems);
        renderGalleryEditPreview();
        renderGalleryAdmin();
        showStatusMessage('Archivo eliminado correctamente.', 'success');

    } catch (error) {
        console.error('Error deleting gallery file:', error);
        showStatusMessage('Error al eliminar el archivo.', 'error');
    }
}

// Global exports
window.handleLogout = handleLogout;
window.openAIAvatarModal = openAIAvatarModal;
window.closeAIAvatarModal = closeAIAvatarModal;
window.closeAIAvatarModalOnOverlay = closeAIAvatarModalOnOverlay;
window.generateAIAvatar = generateAIAvatar;
window.useAIAvatar = useAIAvatar;

// ============================================
// STYLES POPUP MODAL
// ============================================

let _dashboardLoadedStyles = [];
// Temp selection while modal is open
let _tempSelectedStyles = [];

function updateStylesTriggerUI() {
    const tagsEl = document.getElementById('styles-trigger-tags');
    if (!tagsEl) return;
    if (dashboardSelectedStyles.length === 0) {
        tagsEl.innerHTML = '<span class="styles-trigger-placeholder">Seleccionar estilos...</span>';
    } else {
        tagsEl.innerHTML = dashboardSelectedStyles
            .map(s => `<span class="style-tag">${s}</span>`)
            .join('');
    }
}

async function openStylesModal() {
    const modal = document.getElementById('styles-modal');
    if (!modal) return;

    // Copy current selection to temp
    _tempSelectedStyles = [...dashboardSelectedStyles];

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    await loadDashboardStylesGrid();
}

function closeStylesModal() {
    const modal = document.getElementById('styles-modal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
    const customInput = document.getElementById('dashboard-custom-style-input');
    if (customInput) customInput.value = '';
}

function closeStylesModalOnOverlay(event) {
    if (event.target === document.getElementById('styles-modal')) {
        closeStylesModal();
    }
}

function confirmStylesSelection() {
    dashboardSelectedStyles = [..._tempSelectedStyles];
    updateStylesTriggerUI();
    closeStylesModal();
}

async function loadDashboardStylesGrid() {
    const grid = document.getElementById('dashboard-styles-grid');
    if (!grid) return;

    grid.innerHTML = '<span style="opacity:0.5;font-size:0.85rem;">Cargando estilos...</span>';

    try {
        if (window.ConfigManager && typeof window.ConfigManager.loadTattooStylesFlatFromDB === 'function') {
            _dashboardLoadedStyles = await window.ConfigManager.loadTattooStylesFlatFromDB();
        }
    } catch (err) {
        console.error('Error loading tattoo styles from DB:', err);
    }

    const parentStyles = (_dashboardLoadedStyles || [])
        .filter(s => !s.parent_id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    grid.innerHTML = '';

    const normalizeStyle = (name) => (name || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Add DB styles
    parentStyles.forEach(style => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dashboard-style-btn';
        btn.dataset.style = style.name;
        btn.textContent = style.name;
        const isSelected = _tempSelectedStyles.some(s => normalizeStyle(s) === normalizeStyle(style.name));
        if (isSelected) btn.classList.add('selected');
        btn.addEventListener('click', () => toggleDashboardStyleBtn(btn));
        grid.appendChild(btn);
    });

    // Add any custom styles already in selection that aren't in DB
    _tempSelectedStyles.forEach(sel => {
        const alreadyInGrid = Array.from(grid.querySelectorAll('.dashboard-style-btn'))
            .some(btn => normalizeStyle(btn.dataset.style) === normalizeStyle(sel));
        if (!alreadyInGrid) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dashboard-style-btn selected dashboard-style-custom';
            btn.dataset.style = sel;
            btn.textContent = sel;
            btn.addEventListener('click', () => toggleDashboardStyleBtn(btn));
            grid.appendChild(btn);
        }
    });
}

function toggleDashboardStyleBtn(btn) {
    const styleName = btn.dataset.style;
    const normalizeStyle = (name) => (name || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const idx = _tempSelectedStyles.findIndex(s => normalizeStyle(s) === normalizeStyle(styleName));
    if (idx >= 0) {
        _tempSelectedStyles.splice(idx, 1);
        btn.classList.remove('selected');
    } else {
        _tempSelectedStyles.push(styleName);
        btn.classList.add('selected');
    }
}

function addDashboardCustomStyle() {
    const input = document.getElementById('dashboard-custom-style-input');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    const normalizeStyle = (name) => (name || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const exists = _tempSelectedStyles.some(s => normalizeStyle(s) === normalizeStyle(raw));
    if (exists) {
        input.value = '';
        return;
    }

    const grid = document.getElementById('dashboard-styles-grid');
    const existingBtn = grid ? Array.from(grid.querySelectorAll('.dashboard-style-btn'))
        .find(btn => normalizeStyle(btn.dataset.style) === normalizeStyle(raw)) : null;

    if (existingBtn) {
        if (!existingBtn.classList.contains('selected')) {
            existingBtn.classList.add('selected');
            _tempSelectedStyles.push(existingBtn.dataset.style);
        }
    } else if (grid) {
        _tempSelectedStyles.push(raw);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dashboard-style-btn selected dashboard-style-custom';
        btn.dataset.style = raw;
        btn.textContent = raw;
        btn.addEventListener('click', () => toggleDashboardStyleBtn(btn));
        grid.appendChild(btn);
    }

    input.value = '';
}

window.openStylesModal = openStylesModal;
window.closeStylesModal = closeStylesModal;
window.closeStylesModalOnOverlay = closeStylesModalOnOverlay;
window.confirmStylesSelection = confirmStylesSelection;
window.addDashboardCustomStyle = addDashboardCustomStyle;

// ============================================
// QR CODE MODAL
// ============================================

function openQRModal() {
    if (typeof qrcode === 'undefined') {
        showStatusMessage('Error al cargar el generador de QR. Recarga la página.', 'error');
        return;
    }
    if (!artistData?.username) {
        showStatusMessage('Completa tu perfil para generar el QR.', 'error');
        return;
    }

    // Mostrar botón Compartir solo si la API está disponible
    const shareBtn = document.getElementById('qr-share-btn');
    if (shareBtn) {
        shareBtn.style.display = ('share' in navigator) ? '' : 'none';
    }

    // Resetear tabs al estado inicial (PERFIL activo)
    document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
    const profileTab = document.querySelector('.qr-tab[data-dest="profile"]');
    if (profileTab) profileTab.classList.add('active');
    currentQRDest = 'profile';

    generateQR('profile');

    document.getElementById('qr-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeQRModal() {
    document.getElementById('qr-modal').classList.remove('active');
    document.body.style.overflow = '';
}

function closeQRModalOnOverlay(e) {
    if (e.target.id === 'qr-modal') {
        closeQRModal();
    }
}

function generateQR(dest) {
    const username = artistData.username;
    const origin = window.location.origin;
    const encodedUsername = encodeURIComponent(username);

    const url = dest === 'gallery'
        ? `${origin}/artist/profile/gallery?artist=${encodedUsername}`
        : `${origin}/artist/profile?artist=${encodedUsername}`;

    currentQRUrl = url;
    currentQRDest = dest;

    const urlDisplay = document.getElementById('qr-url-display');
    if (urlDisplay) urlDisplay.textContent = url;

    try {
        const qr = qrcode(0, 'M'); // type 0 = auto, M = medium error correction
        qr.addData(url);
        qr.make();

        const canvas = document.getElementById('qr-canvas');
        const size = 240;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const moduleCount = qr.getModuleCount();
        const cellSize = size / moduleCount;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#1a1a1a';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(
                        Math.floor(col * cellSize),
                        Math.floor(row * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    );
                }
            }
        }
        // Store qr instance for SVG export
        canvas._qrInstance = qr;
    } catch (err) {
        console.error('QR generation error:', err);
        showStatusMessage('Error generando el QR.', 'error');
    }
}

function setupQRTabListeners() {
    document.querySelectorAll('.qr-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            generateQR(tab.dataset.dest);
        });
    });
}

function downloadQRPNG() {
    const canvas = document.getElementById('qr-canvas');
    if (!canvas.width) return;
    const dataUrl = canvas.toDataURL('image/png');
    const username = artistData?.username || 'perfil';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${username}-${currentQRDest}.png`;
    a.click();
}

function downloadQRSVG() {
    const username = artistData?.username || 'perfil';
    const canvas = document.getElementById('qr-canvas');
    const qr = canvas?._qrInstance;
    if (!qr) {
        showStatusMessage('Genera el QR primero.', 'error');
        return;
    }
    try {
        const moduleCount = qr.getModuleCount();
        const cellSize = 4;
        const margin = 8;
        const svgSize = moduleCount * cellSize + margin * 2;
        let cells = '';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    const x = margin + col * cellSize;
                    const y = margin + row * cellSize;
                    cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#1a1a1a"/>`;
                }
            }
        }
        const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}"><rect width="${svgSize}" height="${svgSize}" fill="#ffffff"/>${cells}</svg>`;
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qr-${username}-${currentQRDest}.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        console.error('SVG generation error:', err);
        showStatusMessage('Error generando el SVG.', 'error');
    }
}

function copyQRUrl() {
    const btn = document.getElementById('qr-copy-btn');
    const resetBtn = () => { if (btn) btn.textContent = '⎘ Copiar URL'; };

    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentQRUrl)
            .then(() => {
                if (btn) btn.textContent = '✓ Copiado';
                setTimeout(resetBtn, 2000);
            })
            .catch(() => showStatusMessage('No se pudo copiar la URL.', 'error'));
    } else {
        // Fallback para WebViews sin Clipboard API
        const input = document.createElement('input');
        input.value = currentQRUrl;
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.select();
        try {
            document.execCommand('copy');
            if (btn) btn.textContent = '✓ Copiado';
            setTimeout(resetBtn, 2000);
        } catch (e) {
            showStatusMessage('No se pudo copiar la URL.', 'error');
        }
        document.body.removeChild(input);
    }
}

function shareQRUrl() {
    if (!('share' in navigator)) return;
    const username = artistData?.username || 'artista';
    navigator.share({
        title: `${username} — We Otzi`,
        url: currentQRUrl
    }).catch(() => {}); // El usuario puede cancelar el share — silencioso
}

// Exponer funciones llamadas desde onclick en el HTML
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.closeQRModalOnOverlay = closeQRModalOnOverlay;
window.downloadQRPNG = downloadQRPNG;
window.downloadQRSVG = downloadQRSVG;
window.copyQRUrl = copyQRUrl;
window.shareQRUrl = shareQRUrl;
window.openUpcomingTravelModal = openUpcomingTravelModal;
window.closeUpcomingTravelModal = closeUpcomingTravelModal;
window.closeUpcomingTravelModalOnOverlay = closeUpcomingTravelModalOnOverlay;
