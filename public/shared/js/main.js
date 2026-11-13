// [CH-07 / CH-08] START: Supabase Client and Auth Configuration
// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));
const WEOTZI_WHATSAPP_FALLBACK = '+541127015926';

function getAppBasePath() {
    if (typeof window === 'undefined') return '';
    if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
    const path = window.location?.pathname || '';
    return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
}

function appUrl(path) {
    const normalized = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
    const basePath = getAppBasePath();
    if (basePath && (normalized === basePath || normalized.startsWith(basePath + '/'))) {
        return normalized;
    }
    return basePath + normalized;
}

// Note: the historical `resolvePresetPassword()` / `DEFAULT_ARTIST_PASSWORD`
// helpers used to seed every new artist with the shared "OtziArtist2025"
// password. They were removed when the wizard switched to per-user passwords
// — there is no longer any codepath in main.js that needs a fallback.
// [CH-07 / CH-08] END

const DASHBOARD_MOBILE_MENU_BREAKPOINT = 768;
// (La proyeccion de perfil de artista vive ahora en WeotziData.Artists, encapsulada
// en getProfileByUserId/getProfileByEmail; la constante local quedo sin uso.)
let pendingLoginEmail = '';

// [CH-04 / CH-05 / CH-06] START: Logo interaction logic
document.addEventListener('DOMContentLoaded', () => {
    const logoBlock = document.querySelector('.block-logo');
    const logoText = document.querySelector('.logo-text');
    const secretMessage = document.getElementById('logo-secret-message');
    let clickCount = 0;

    if (logoText) {
        logoText.addEventListener('click', () => {
            clickCount++;
            if (clickCount === 10) {
                secretMessage.classList.add('visible');
            }
        });
    }

    if (logoBlock) {
        logoBlock.addEventListener('mousemove', (e) => {
            const rect = logoBlock.getBoundingClientRect();
            const x = (e.clientX - rect.left - rect.width / 2) / 20;
            const y = (e.clientY - rect.top - rect.height / 2) / 20;

            logoText.style.transform = `translate(${x}px, ${y}px)`;
        });

        logoBlock.addEventListener('mouseleave', () => {
            logoText.style.transform = 'translate(0, 0)';
        });
    }

    // [CH-12] START: Initialize random info text
    initRandomInfoText();
    // [CH-12] END

    // [CH-07] START: Check if user is already logged in and redirect if needed
    checkAuthState();
    // [CH-07] END
});

function setLandingDashboardMobileMenuOpen(isOpen) {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;

    const shouldOpen = Boolean(isOpen);
    menu.hidden = !shouldOpen;
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function setupLandingDashboardNavigationMenu() {
    const toggleBtn = document.getElementById('dashboard-mobile-menu-toggle');
    const menu = document.getElementById('dashboard-mobile-menu');
    if (!toggleBtn || !menu) return;
    if (toggleBtn.dataset.menuBound === 'true') return;

    setLandingDashboardMobileMenuOpen(false);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
        setLandingDashboardMobileMenuOpen(shouldOpen);
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            setLandingDashboardMobileMenuOpen(false);
        });
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        const clickInsideMenu = menu.contains(event.target);
        const clickOnToggle = toggleBtn.contains(event.target);
        if (!clickInsideMenu && !clickOnToggle) {
            setLandingDashboardMobileMenuOpen(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > DASHBOARD_MOBILE_MENU_BREAKPOINT) {
            setLandingDashboardMobileMenuOpen(false);
        }
    });

    toggleBtn.dataset.menuBound = 'true';
}

// [CH-12] START: Random Info Text - Dynamic Content
// Selects a random HTML paragraph from config.js and injects it into the landing page
function initRandomInfoText() {
    const infoBlock = document.querySelector('.block-info');
    if (!infoBlock) return;

    // Get info texts from config
    const infoTexts = window.CONFIG?.infoTexts;
    if (!infoTexts || infoTexts.length === 0) return;

    // Select a random text
    const randomIndex = Math.floor(Math.random() * infoTexts.length);
    const selectedText = infoTexts[randomIndex];

    // Find the main paragraph to replace (the second <p> in block-info)
    const paragraphs = infoBlock.querySelectorAll('p');
    if (paragraphs.length >= 2) {
        // Use outerHTML to replace with HTML content (includes <p> tags)
        paragraphs[1].outerHTML = selectedText;
    }
}
// [CH-12] END

// [CH-07] START: Check authentication state on page load
async function checkAuthState() {
    const currentPath = window.location.pathname;
    const isLandingPage = currentPath.includes('/registerclosedbeta');
    const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
    const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
        registerClosedBeta: '/registerclosedbeta',
        login: '/registerclosedbeta',
        registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist',
        dashboard: '/artist/dashboard',
        jobBoard: '/job-board'
    };
    
    const { data: { session } } = await _supabase.auth.getSession();
    let artist = null;
    let artistProgress = null;
    let artistLookupFailed = false;

    if (session) {
        const { data: artistData, error: artistError } = await WeotziData.Artists.getProfileByUserId(session.user.id);

        if (artistError) {
            console.warn('checkAuthState artist lookup error:', artistError);
            artistLookupFailed = true;
        } else {
            artist = artistData || null;
            artistProgress = getArtistRegistrationProgress(artist);
        }
    }

    const isLoggedIn = Boolean(session);
    document.body.classList.toggle('menu-authenticated', isLoggedIn);

    const dashboardLinksCol = document.getElementById('dashboard-nav-links-col');
    const dashboardMobileMenu = document.getElementById('dashboard-mobile-menu');
    if (dashboardLinksCol) {
        dashboardLinksCol.hidden = !isLoggedIn;
    }
    if (dashboardMobileMenu) {
        dashboardMobileMenu.hidden = true;
    }
    if (isLoggedIn) {
        setupLandingDashboardNavigationMenu();
    } else {
        setLandingDashboardMobileMenuOpen(false);
    }

    // Always toggle the login button if it exists
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        if (session) {
            loginBtn.innerHTML = 'LOG OUT';
            loginBtn.onclick = (e) => {
                e.preventDefault();
                handleLogout();
            };
            loginBtn.setAttribute('aria-label', 'Cerrar sesion');
        } else {
            loginBtn.innerHTML = 'LOG IN';
            loginBtn.onclick = (e) => {
                e.preventDefault();
                openLoginModal();
            };
            loginBtn.setAttribute('aria-label', 'Iniciar sesion');
        }
    }

    // Skip redirect logic if on landing page - users should be able to stay there
    if (isLandingPage) {
        clearLandingResumeState();
        removeActiveSessionBanner();
        // Sesión activa: el Figma final no tiene un estado "sesión activa" en
        // Crear cuenta (801:536); su lugar es "Ya iniciaste sesión" (2001:3334)
        // en /artist/login, que también resuelve perfil incompleto, cuenta de
        // cliente y cerrar sesión. Evita registrar una cuenta nueva encima de
        // otra sesión abierta.
        if (session && !isSignupPreviewState()) {
            const loginParams = new URLSearchParams();
            if (requestedReturnTo) loginParams.set('returnTo', requestedReturnTo);
            const loginQuery = loginParams.toString();
            window.location.replace(appUrl('/artist/login' + (loginQuery ? '?' + loginQuery : '')));
        }
        return;
    }

    if (session) {
        if (artistLookupFailed) {
            return;
        }

        // If no artist record exists OR profile is incomplete, redirect to complete it
        if (!artist || !artistProgress || !artistProgress.isComplete) {
            window.location.href = appUrl(getArtistResumeUrl(authUrls.registerArtist, artistProgress));
        }
    }
}

// QA del preview: ?state=signup muestra el formulario limpio aunque exista la
// sesión ficticia. En producción el parámetro se ignora.
function isSignupPreviewState() {
    if (window.WEOTZI_PREVIEW !== true) return false;
    return new URLSearchParams(window.location.search || '').get('state') === 'signup';
}

const ACTIVE_SESSION_NOTE_ID = 'active-session-note';

function removeActiveSessionBanner() {
    if (typeof document === 'undefined') return;
    const note = document.getElementById(ACTIVE_SESSION_NOTE_ID);
    if (note) {
        note.hidden = true;
        note.innerHTML = '';
    }
}

/**
 * Handle user logout and redirect
 */
async function handleLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;

        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, '') || {
            registerClosedBeta: '/registerclosedbeta'
        };
        window.location.href = appUrl(authUrls.registerClosedBeta);
    } catch (error) {
        console.error('Logout error:', error.message);
    }
}

// Global export
window.handleLogout = handleLogout;
// [CH-07] END

// Theme toggle function
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const btn = document.querySelector('.theme-toggle');
    btn.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-yellow');
    setTimeout(() => {
        btn.style.backgroundColor = '';
    }, 300);
}

// ============================================
// Modal Functions
// ============================================

function openLoginModal() {
    const params = new URLSearchParams();
    const currentReturnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (currentReturnTo) {
        params.set('returnTo', currentReturnTo);
    }
    if (pendingLoginEmail) {
        params.set('email', pendingLoginEmail);
    }
    const query = params.toString();
    window.location.href = appUrl('/artist/login' + (query ? '?' + query : ''));
}

// El modal de login legado salió del Figma final: "Ingresá" lleva a
// /artist/login. Se conservan los nombres por compatibilidad, con guardas.
function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    clearLoginMessage();
    const form = document.getElementById('login-form');
    if (form) form.reset();
}

function closeLoginModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeLoginModal();
    }
}

// ============================================
// Form Message Helpers
// ============================================

function showFormMessage(message, type = 'info') {
    const messageDiv = document.getElementById('form-message');
    if (messageDiv) {
        messageDiv.innerHTML = message;
        messageDiv.className = 'form-message ' + type;
    }
}

function clearFormMessage() {
    const messageDiv = document.getElementById('form-message');
    if (messageDiv) {
        messageDiv.innerHTML = '';
        messageDiv.className = 'form-message';
    }
    if (typeof hideResumeBanner === 'function') hideResumeBanner();
}

async function readJsonResponse(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (_) {
        return { success: false, error: `Respuesta invalida del servidor (${res.status}).` };
    }
}

function withUrlParams(url, params) {
    const [path, queryString = ''] = String(url || '').split('?');
    const search = new URLSearchParams(queryString);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `${path}?${query}` : path;
}

async function createOrResumeArtistDraft({ email = '', source = 'email', extraData = null } = {}) {
    const response = await fetch(appUrl('/api/register/artist-draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            source,
            step: email ? 3 : 1,
            data: { email, registration_source: source, ...(extraData || {}) }
        })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.success) {
        const error = new Error(payload.error || 'No se pudo iniciar el registro.');
        error.code = payload.code;
        error.payload = payload;
        throw error;
    }
    return payload;
}

function buildDraftWizardUrl(registerArtistUrl, draftPayload, source, email) {
    return withUrlParams(registerArtistUrl || '/register-artist', {
        draft: draftPayload?.draft_id,
        source,
        email
    });
}

function showLoginMessage(message, type = 'info') {
    const messageDiv = document.getElementById('login-message');
    if (messageDiv) {
        messageDiv.innerHTML = message;
        messageDiv.className = 'form-message ' + type;
    }
}

function clearLoginMessage() {
    const messageDiv = document.getElementById('login-message');
    if (messageDiv) {
        messageDiv.innerHTML = '';
        messageDiv.className = 'form-message';
    }
}

// ============================================
// Check if email already exists
// ============================================

async function checkEmailExists(email) {
    const { data, error } = await _supabase.rpc('check_email_registered', {
        check_email: email
    });
    
    if (error) {
        console.error('Error checking email:', error);
        return false;
    }
    
    return data === true;
}

async function getIncompleteArtistByEmail(email) {
    try {
        const { data: artist, error: artistError } = await WeotziData.Artists.getProfileByEmail(email);

        if (artistError || !artist) {
            return null;
        }

        const artistProgress = getArtistRegistrationProgress(artist);
        if (!artistProgress || artistProgress.isComplete) {
            return null;
        }

        return {
            artist,
            progress: artistProgress
        };
    } catch (error) {
        console.warn('Incomplete registration lookup failed:', error);
        return null;
    }
}

// ============================================
// Registration Handler (Email + Password)
// ============================================

// Estado del botón REGISTRARME sin estilos inline: el texto cambia dentro de
// .btn-text (la flecha Feather se conserva) y el aspecto lo da la clase
// is-busy / [aria-busy] de registerclosedbeta-ds.css. Los errores se muestran
// en #form-message (wo-alert del DS), nunca pintando el botón.
function setRegisterButtonState(btn, label) {
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = text ? text.textContent : btn.textContent;
    const busy = Boolean(label);
    if (text) text.textContent = busy ? label : btn.dataset.idleLabel;
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
}

// Validación propia (el form lleva novalidate): mensajes del DS en
// #form-message en lugar del tooltip nativo "Completa este campo".
// Revisión 12/11 (p. 2): todos los campos son obligatorios; Estilo deja de
// serlo solo con "Añadir más adelante, mi estilo no está aquí".
function validateBetaForm({ fullName, email, country, city, style, styleLater, terms }) {
    if (!fullName) return { field: 'beta-fullname', message: 'Contanos tu nombre completo.' };
    if (!email) return { field: 'beta-email', message: 'Escribí tu email.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { field: 'beta-email', message: 'Revisá el email: parece incompleto.' };
    if (!country) return { field: 'beta-country', message: 'Seleccioná tu país.' };
    if (!city) return { field: 'beta-city', message: 'Contanos en qué ciudad tatuás.' };
    if (!style && !styleLater) return { field: 'beta-style', message: 'Seleccioná tu estilo principal o marcá "Añadir más adelante".' };
    if (!terms) return { field: 'beta-terms', message: 'Para seguir, aceptá los términos y condiciones.' };
    return null;
}

// ---- Revisión 12/11 (p. 2): catálogos de Crear cuenta ----
// Estilos: exactamente los de la revisión, en orden alfabético.
const BETA_STYLE_OPTIONS = [
    'Blackwork', 'Fine Line', 'Geométrico', 'Japonés', 'Lettering / Caligrafía',
    'Microrealismo', 'Minimalista', 'Neotradicional', 'Realismo', 'Tradicional americano'
];

// Países: Estados Unidos, Argentina y España primero; el resto alfabético.
// `code` (ISO 3166-1 alfa-2) restringe las sugerencias de ciudad de Places.
const BETA_COUNTRIES = [
    { name: 'Estados Unidos', code: 'us' },
    { name: 'Argentina', code: 'ar' },
    { name: 'España', code: 'es' },
    { name: 'Alemania', code: 'de' },
    { name: 'Australia', code: 'au' },
    { name: 'Brasil', code: 'br' },
    { name: 'Canadá', code: 'ca' },
    { name: 'Chile', code: 'cl' },
    { name: 'Colombia', code: 'co' },
    { name: 'Corea del Sur', code: 'kr' },
    { name: 'Costa Rica', code: 'cr' },
    { name: 'Dinamarca', code: 'dk' },
    { name: 'Finlandia', code: 'fi' },
    { name: 'Francia', code: 'fr' },
    { name: 'Grecia', code: 'gr' },
    { name: 'Indonesia', code: 'id' },
    { name: 'Italia', code: 'it' },
    { name: 'Japón', code: 'jp' },
    { name: 'México', code: 'mx' },
    { name: 'Noruega', code: 'no' },
    { name: 'Nueva Zelanda', code: 'nz' },
    { name: 'Países Bajos', code: 'nl' },
    { name: 'Panamá', code: 'pa' },
    { name: 'Perú', code: 'pe' },
    { name: 'Polonia', code: 'pl' },
    { name: 'Portugal', code: 'pt' },
    { name: 'Reino Unido', code: 'gb' },
    { name: 'Suecia', code: 'se' },
    { name: 'Suiza', code: 'ch' },
    { name: 'Tailandia', code: 'th' },
    { name: 'Uruguay', code: 'uy' },
    { name: 'Venezuela', code: 've' }
];

function betaCountryByName(name) {
    return BETA_COUNTRIES.find((country) => country.name === name) || null;
}

// Handoff al wizard /register-artist. El borrador del servidor guarda nombre,
// email, país, ciudad y estilos (artists_db); lo que no tiene columna (que el
// estilo quedó "para más adelante", el código del país y el place_id de la
// ciudad) viaja en localStorage bajo BETA_SIGNUP_HANDOFF_KEY y en la URL
// (?styleLater=1).
const BETA_SIGNUP_HANDOFF_KEY = 'wo:artist-registration:signup-handoff';

function buildBetaSignupData({ fullName, email, country, countryCode, city, cityPlaceId, style, styleLater }) {
    const styles = !styleLater && style ? [style] : [];
    return {
        draftData: {
            full_name: fullName,
            location_country: country,
            location_city: city,
            city,
            styles
        },
        handoff: {
            version: 1,
            full_name: fullName,
            email,
            country,
            country_code: countryCode || null,
            city,
            city_place_id: cityPlaceId || null,
            styles,
            style_later: Boolean(styleLater)
        }
    };
}

function saveBetaSignupHandoff(handoff, draftId) {
    try {
        localStorage.setItem(BETA_SIGNUP_HANDOFF_KEY, JSON.stringify({
            ...handoff,
            draft_id: draftId || null,
            saved_at: Date.now()
        }));
    } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.WoBetaSignup = {
        BETA_STYLE_OPTIONS,
        BETA_COUNTRIES,
        BETA_SIGNUP_HANDOFF_KEY,
        betaCountryByName,
        buildBetaSignupData,
        parseBetaCatalogs,
        validateBetaForm
    };
}

async function handleRegistration(e) {
    e.preventDefault();
    const btn = document.querySelector('#beta-form .btn-register-primary');
    const emailInput = document.querySelector('.input-email');
    const email = String(emailInput?.value || '').trim().toLowerCase();
    // Revisión 12/11 (p. 2): nombre, email, país, ciudad y estilo (o "más
    // adelante") son obligatorios. Todo viaja al borrador para que el wizard
    // los precargue.
    const fullName = String(document.getElementById('beta-fullname')?.value || '').trim();
    const country = String(document.getElementById('beta-country')?.value || '').trim();
    const cityInput = document.getElementById('beta-city');
    const city = String(cityInput?.value || '').trim();
    const styleLater = Boolean(document.getElementById('beta-style-later')?.checked);
    const style = styleLater ? '' : String(document.getElementById('beta-style')?.value || '').trim();
    const terms = Boolean(document.getElementById('beta-terms')?.checked);

    clearFormMessage();
    document.querySelectorAll('#beta-form [aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));

    const invalid = validateBetaForm({ fullName, email, country, city, style, styleLater, terms });
    if (invalid) {
        showFormMessage(invalid.message, 'error');
        const field = document.getElementById(invalid.field);
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }
        return;
    }

    setRegisterButtonState(btn, 'Validando…');

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist'
        };

        setRegisterButtonState(btn, 'Guardando…');
        const signup = buildBetaSignupData({
            fullName,
            email,
            country,
            countryCode: betaCountryByName(country)?.code,
            city,
            cityPlaceId: cityInput?.dataset.placeId || '',
            style,
            styleLater
        });
        const draftPayload = await createOrResumeArtistDraft({
            email,
            source: 'email',
            // El servidor guarda fecha y versión de la aceptación (lib/terms-acceptance.js).
            extraData: { ...signup.draftData, terms_accepted: terms }
        });
        saveBetaSignupHandoff(signup.handoff, draftPayload?.draft_id);
        const artistProgress = getArtistRegistrationProgress(draftPayload.artist);
        let targetUrl = buildDraftWizardUrl(
            getArtistResumeUrl(authUrls.registerArtist, artistProgress),
            draftPayload,
            'email',
            email
        );
        if (styleLater) targetUrl = withUrlParams(targetUrl, { styleLater: '1' });

        setRegisterButtonState(btn, 'Redirigiendo…');
        showFormMessage('Registro iniciado. Te llevamos a completar tu perfil…', 'success');

        setTimeout(() => {
            window.location.href = appUrl(targetUrl);
        }, 700);
        return;
    } catch (error) {
        console.error('Error in registration:', error.message);
        setRegisterButtonState(btn, '');

        let errorMessage = 'No pudimos iniciar tu registro. Probá de nuevo en un momento.';
        if (error.code === 'ALREADY_REGISTERED') {
            pendingLoginEmail = email;
            errorMessage = 'Este email ya tiene una cuenta. <a href="#" onclick="openLoginModal(); return false;">Iniciá sesión</a>.';
        }

        showFormMessage(errorMessage, 'error');
    }
}

async function handleContinueRegistration(e) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }

    const btn = document.querySelector('#beta-form .btn-continue-registration');
    const originalText = btn ? btn.innerHTML : 'Continuar';
    const emailInput = document.querySelector('.input-email');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

    clearFormMessage();

    if (!email) {
        showFormMessage('Ingresa tu correo para continuar.', 'info');
        return;
    }

    if (btn) {
        btn.innerHTML = 'VALIDANDO...';
        btn.disabled = true;
    }

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist'
        };

        const draftPayload = await createOrResumeArtistDraft({ email, source: 'email' });
        const artistProgress = getArtistRegistrationProgress(draftPayload.artist);
        const targetUrl = buildDraftWizardUrl(
            getArtistResumeUrl(authUrls.registerArtist, artistProgress),
            draftPayload,
            'email',
            email
        );
        clearFormMessage();
        showFormMessage(`<a href="${targetUrl}">Continuar registro</a>`, 'success');
        pendingLoginEmail = email;
    } catch (error) {
        console.error('Continue registration error:', error);
        showFormMessage('Error al validar el registro. Intenta nuevamente.', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// ============================================
// Login Handler
// ============================================

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.querySelector('.btn-modal-submit');
    const originalText = btn.innerHTML;
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    clearLoginMessage();

    if (!email || !password) return;

    // Switch to loading state
    btn.innerHTML = 'VALIDANDO...';
    btn.disabled = true;

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist',
            dashboard: '/artist/dashboard'
        };

        const { data, error } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;
        pendingLoginEmail = '';

        // Success - check if profile is complete
        btn.innerHTML = 'BIENVENIDO';
        btn.style.background = 'var(--system-success)';

        // Check if artist profile needs completion
        // Use maybeSingle() instead of single() to handle 0 rows gracefully (prevents 406 error)
        const { data: artist, error: artistError } = await WeotziData.Artists.getProfileByUserId(data.user.id);

        if (artistError) {
            console.warn('Artist lookup error:', artistError);
        }

        const artistProgress = getArtistRegistrationProgress(artist);

        // If no artist record exists OR profile is incomplete, redirect to register
        if (!artist || !artistProgress || !artistProgress.isComplete) {
            const resumeUrl = getArtistResumeUrl(authUrls.registerArtist, artistProgress);
            const resumeStepLabel = artistProgress?.nextStep ? `paso ${String(artistProgress.nextStep).padStart(2, '0')}` : 'siguiente paso';
            showLoginMessage(`Perfil en progreso. Te redirigimos al ${resumeStepLabel}.`, 'success');
            setTimeout(() => {
                window.location.href = appUrl(resumeUrl);
            }, 1500);
        } else {
            showLoginMessage('Sesion iniciada correctamente.', 'success');
            setTimeout(() => {
                closeLoginModal();
                // Redirect to dashboard
                window.location.href = requestedReturnTo ? appUrl(requestedReturnTo) : appUrl(authUrls.dashboard);
            }, 1500);
        }

    } catch (error) {
        console.error('Login error:', error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
        
        // ── confirmacion-email: cuenta sin confirmar → aviso con "Reenviar email".
        const EC = window.WeotziEmailConfirm;
        const loginBox = document.getElementById('login-message');
        if (EC && loginBox && EC.isEmailNotConfirmedError(error)) {
            loginBox.className = '';
            EC.renderLoginNotice(loginBox, {
                email,
                client: _supabase,
                redirectTo: EC.redirectUrl('/register-artist/', { confirmado: '1' })
            });
            return;
        }

        let errorMessage = 'Error al iniciar sesion.';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email o contrasena incorrectos.';
        }

        showLoginMessage(errorMessage, 'error');
    }
}

function getArtistRegistrationProgress(artist) {
    if (window.ArtistRegistrationProgress?.analyzeArtistProfile) {
        return window.ArtistRegistrationProgress.analyzeArtistProfile(artist);
    }

    const hasName = Boolean(artist && String(artist.name || '').trim());
    return {
        isComplete: hasName,
        nextStep: hasName ? null : 2,
        completedCount: hasName ? 1 : 0,
        requiredCount: 11,
        completedLabels: hasName ? ['Nombre completo'] : [],
        remainingLabels: hasName ? [] : ['Nombre completo']
    };
}

function getArtistResumeUrl(registerArtistUrl, progress) {
    if (window.ArtistRegistrationProgress?.withResumeStep) {
        return window.ArtistRegistrationProgress.withResumeStep(registerArtistUrl, progress?.nextStep || null);
    }
    return registerArtistUrl;
}

function getArtistStartOverUrl(registerArtistUrl) {
    const [path, queryString = ''] = String(registerArtistUrl || '/register-artist').split('?');
    const params = new URLSearchParams(queryString);
    params.delete('resumeStep');
    params.set('startOver', '1');
    const query = params.toString();
    return query ? `${path}?${query}` : path;
}

function buildResumeActionLinks(authUrls, progress, allowStartOver) {
    const resumeUrl = getArtistResumeUrl(authUrls.registerArtist, progress);
    const continueLink = `<a href="${resumeUrl}">Continuar registro</a>`;
    if (!allowStartOver) {
        return continueLink;
    }

    const startOverUrl = getArtistStartOverUrl(authUrls.registerArtist);
    const startOverLink = `<a href="${startOverUrl}">Empezar de 0</a>`;
    return `${continueLink} o ${startOverLink}`;
}

function showResumeBanner(authUrls, progress, allowStartOver) {
    const banner = document.getElementById('resume-registration-banner');
    if (!banner) return;

    const resumeUrl = getArtistResumeUrl(authUrls.registerArtist, progress);
    let secondaryHtml = '';
    if (allowStartOver) {
        const startOverUrl = getArtistStartOverUrl(authUrls.registerArtist);
        secondaryHtml = `<a href="${startOverUrl}" class="resume-banner__btn resume-banner__btn--secondary">Empezar de 0</a>`;
    }

    banner.innerHTML = `
        <div class="resume-banner__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="2.5" stroke-linecap="square">
                <path d="M12 9v4l3 2"/>
                <circle cx="12" cy="12" r="9"/>
            </svg>
        </div>
        <div class="resume-banner__body">
            <p class="resume-banner__label">Registro en progreso detectado</p>
            <p class="resume-banner__hint">Tienes un registro sin completar con este correo</p>
        </div>
        <div class="resume-banner__actions">
            <a href="${resumeUrl}" class="resume-banner__btn">
                Continuar registro
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            ${secondaryHtml}
        </div>`;
    banner.hidden = false;
}

function hideResumeBanner() {
    const banner = document.getElementById('resume-registration-banner');
    if (banner) {
        banner.hidden = true;
        banner.innerHTML = '';
    }
}

function clearLandingResumeState() {
    const resumePanel = document.getElementById('resume-registration-state');
    const betaForm = document.getElementById('beta-form');
    if (resumePanel) resumePanel.hidden = true;
    if (betaForm) betaForm.hidden = false;
    hideResumeBanner();
}

// ============================================
// Social Login Handler
// ============================================

async function handleSocialLogin(provider) {
    // Instagram is special: Meta deprecated Basic Display API in Dec 2024 and
    // their official Login API requires Business/Creator accounts + 4-6 weeks
    // of app review. Instead of OAuth, we offer a "quick-start" flow: the
    // user pastes their handle, we scrape the public profile via Apify, then
    // they confirm what to import and finish signup with email/password.
    if (provider === 'instagram') {
        return handleInstagramQuickStart();
    }

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist'
        };

        const draftPayload = await createOrResumeArtistDraft({ source: provider });
        const targetUrl = buildDraftWizardUrl(authUrls.registerArtist, draftPayload, provider, '');
        window.location.href = appUrl(targetUrl);
    } catch (error) {
        console.error(`Error logging in with ${provider}:`, error.message);
        showFormMessage(`Error al conectar con ${provider}. Por favor, intentalo de nuevo.`, 'error');
    }
}

// Instagram quick-start: redirect straight to the wizard with ?source=instagram.
// The wizard is special-cased to allow an unauthenticated caller in this flow:
// the user pastes their @handle on Step 0, the import runs (Apify, no auth
// required in signup mode), and the wizard then collects email/password as
// part of its normal sequence. Auth creation happens server-side only on the
// final confirmation step, without creating a browser session.
function handleInstagramQuickStart() {
    try { localStorage.setItem('weotzi_signup_via_instagram', '1'); } catch (_) {}
    createOrResumeArtistDraft({ source: 'instagram' })
        .then((draftPayload) => {
            window.location.href = appUrl(buildDraftWizardUrl('/register-artist/', draftPayload, 'instagram', ''));
        })
        .catch(() => {
            window.location.href = appUrl('/register-artist/?source=instagram');
        });
}

// ============================================
// Formulario beta (Figma 22-1106)
// ============================================

// "Continuá con EMAIL" = el formulario de la página: lleva el foco al inicio.
function focusBetaForm() {
    const first = document.getElementById('beta-fullname') || document.querySelector('.input-email');
    if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first.focus({ preventScroll: true });
    }
}

// "Continuá con Facebook": el OAuth de Supabase vive en /artist/login
// (artist-login.js). Al volver sin perfil de artista, ese flujo deriva al
// wizard /register-artist con la sesión ya iniciada.
function handleFacebookSignup() {
    const params = new URLSearchParams();
    params.set('oauth', 'facebook');
    const currentReturnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (currentReturnTo) params.set('returnTo', currentReturnTo);
    window.location.href = appUrl('/artist/login?' + params.toString());
}

// Revisión 12/11 (p. 2): ESTILO muestra solo la lista fija de la revisión
// (ya no el catálogo completo de tattoo_styles). PAÍS es un select y CIUDAD
// sugiere ciudades de ese país con Google Places. Los selects los mejora el
// componente del DS (window.WoControls); esta página no los estiliza.
function refreshBetaControl(el) {
    try { window.WoControls?.refresh?.(el); } catch (_) {}
}

function fillBetaSelect(select, items) {
    if (!select) return;
    const placeholder = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (placeholder) select.appendChild(placeholder);
    items.forEach(({ value, label, code }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (code) opt.dataset.code = code;
        select.appendChild(opt);
    });
    refreshBetaControl(select);
}

function populateBetaStyleSelect(styles = BETA_STYLE_OPTIONS) {
    fillBetaSelect(
        document.getElementById('beta-style'),
        styles.map((name) => ({ value: name, label: name }))
    );
}

function populateBetaCountrySelect(countries = BETA_COUNTRIES) {
    fillBetaSelect(
        document.getElementById('beta-country'),
        countries.map(({ name, code }) => ({ value: name, label: name, code }))
    );
}

// GET /api/registration/catalogs (grupo Backend) es la fuente principal; las
// listas locales de arriba son el respaldo (mismo contenido). Acepta
// { styles: { quick: [{ label }] }, countries: [{ name, code }] } o
// { quickStyles: [...] }, con o sin envoltorio `data`.
function parseBetaCatalogs(payload) {
    const data = payload && typeof payload === 'object' ? (payload.data || payload) : null;
    if (!data) return null;
    const quick = Array.isArray(data.quickStyles) ? data.quickStyles : data.styles?.quick;
    const styles = (Array.isArray(quick) ? quick : [])
        .map((s) => String(typeof s === 'string' ? s : (s?.label || s?.name || '')).trim())
        .filter(Boolean);
    const countries = (Array.isArray(data.countries) ? data.countries : [])
        .map((c) => ({ name: String(c?.name || '').trim(), code: String(c?.code || '').trim().toLowerCase() }))
        .filter((c) => c.name && /^[a-z]{2}$/.test(c.code));
    return {
        styles: styles.length ? styles : null,
        countries: countries.length ? countries : null
    };
}

function loadBetaCatalogs() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(appUrl('/api/registration/catalogs'), { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((payload) => {
            const catalogs = parseBetaCatalogs(payload);
            if (!catalogs) return null;
            const styleSelect = document.getElementById('beta-style');
            const countrySelect = document.getElementById('beta-country');
            // Solo si el usuario todavía no eligió nada (no se le cambia la lista en la mano).
            if (catalogs.styles && styleSelect && !styleSelect.value) populateBetaStyleSelect(catalogs.styles);
            if (catalogs.countries && countrySelect && !countrySelect.value) {
                BETA_COUNTRIES.splice(0, BETA_COUNTRIES.length, ...catalogs.countries);
                populateBetaCountrySelect(catalogs.countries);
            }
            return catalogs;
        });
}

// "Añadir más adelante": bloquea Estilo y deja de exigirlo.
function syncBetaStyleLater() {
    const later = document.getElementById('beta-style-later');
    const select = document.getElementById('beta-style');
    if (!later || !select) return;
    const deferred = later.checked;
    if (deferred) select.value = '';
    select.disabled = deferred;
    select.required = !deferred;
    if (deferred) select.removeAttribute('aria-invalid');
    refreshBetaControl(select);
}

// ---- Ciudad con Google Places (types: ['(cities)'], restringido al país) ----
const betaCityState = { autocomplete: null, placesFailed: false, loading: null };

function isBetaPlacesConfigured() {
    try {
        if (typeof window.ConfigManager?.isGoogleMapsConfigured === 'function') {
            return window.ConfigManager.isGoogleMapsConfigured();
        }
    } catch (_) {}
    const key = window.CONFIG?.googleMaps?.apiKey || '';
    return Boolean(key) && !String(key).includes('YOUR_');
}

function ensureBetaCityAutocomplete(input) {
    if (betaCityState.autocomplete || betaCityState.placesFailed) return Promise.resolve(betaCityState.autocomplete);
    if (betaCityState.loading) return betaCityState.loading;
    if (typeof window.WeOtziGeocoder?.ensureGoogleMapsLoaded !== 'function' || !isBetaPlacesConfigured()) {
        betaCityState.placesFailed = true;
        return Promise.resolve(null);
    }
    betaCityState.loading = window.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] })
        .then(() => {
            if (!window.google?.maps?.places?.Autocomplete) throw new Error('Places no disponible');
            const ac = new window.google.maps.places.Autocomplete(input, {
                types: ['(cities)'],
                fields: ['name', 'place_id', 'address_components']
            });
            ac.addListener('place_changed', () => {
                const place = ac.getPlace() || {};
                if (!place.place_id) return;
                const locality = (place.address_components || [])
                    .find((c) => (c.types || []).includes('locality'));
                input.value = place.name || locality?.long_name || input.value;
                input.dataset.placeId = place.place_id;
                input.removeAttribute('aria-invalid');
            });
            betaCityState.autocomplete = ac;
            return ac;
        })
        .catch((error) => {
            // Sin key, key inválida o red caída: Ciudad queda como texto libre.
            betaCityState.placesFailed = true;
            console.info('[beta] Ciudad como texto libre:', error && error.message);
            return null;
        });
    return betaCityState.loading;
}

function syncBetaCityWithCountry() {
    const countrySelect = document.getElementById('beta-country');
    const cityInput = document.getElementById('beta-city');
    if (!countrySelect || !cityInput) return;
    const country = betaCountryByName(countrySelect.value);
    cityInput.value = '';
    delete cityInput.dataset.placeId;
    cityInput.disabled = !country;
    cityInput.placeholder = country ? 'Buscá tu ciudad' : 'Elegí primero tu país';
    if (!country) return;
    ensureBetaCityAutocomplete(cityInput).then((ac) => {
        if (ac) ac.setComponentRestrictions({ country: country.code });
    });
}

function initBetaSignupFields() {
    if (!document.getElementById('beta-form')) return;
    populateBetaStyleSelect();
    populateBetaCountrySelect();
    loadBetaCatalogs();
    document.getElementById('beta-style-later')?.addEventListener('change', syncBetaStyleLater);
    document.getElementById('beta-country')?.addEventListener('change', syncBetaCityWithCountry);
    const cityInput = document.getElementById('beta-city');
    if (cityInput) {
        // Con la lista de Places abierta, Enter elige la sugerencia y no envía.
        cityInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || !betaCityState.autocomplete) return;
            const list = Array.from(document.querySelectorAll('.pac-container'))
                .find((el) => el.style.display !== 'none' && el.querySelector('.pac-item'));
            if (list) event.preventDefault();
        });
        // Si se edita a mano, el place_id anterior ya no corresponde.
        cityInput.addEventListener('input', () => { delete cityInput.dataset.placeId; });
    }
    syncBetaStyleLater();
}
document.addEventListener('DOMContentLoaded', initBetaSignupFields);

// ============================================
// Password Recovery Handler
// ============================================

/**
 * Generate a random temporary password
 */
function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

async function handlePasswordRecovery(e) {
    e.preventDefault();

    // La recuperación vive ahora en /recover (código OTP de Supabase Auth).
    // Solo redirigimos, con el email prefilleado si ya lo tipearon en el modal.
    const emailInput = document.getElementById('login-email') || document.querySelector('.input-email');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
    const qs = email ? '&email=' + encodeURIComponent(email) : '';
    window.location.href = appUrl('/recover?from=artist' + qs);
}

// ============================================
// [CH-15] Global Zoom Controls
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
    // Store preference in localStorage
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

// Restore zoom preference on page load
function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// Initialize zoom on load
document.addEventListener('DOMContentLoaded', restoreZoomPreference);
