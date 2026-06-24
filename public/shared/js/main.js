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
        // Surface stale sessions explicitly. The login button already turns
        // into LOG OUT, but that's easy to miss and was the proximate cause
        // of users completing a fresh signup while a previous account's
        // session was still active in localStorage — leading the dashboard
        // to load the wrong identity afterwards. The banner forces a
        // decision: continue with this account, or sign out to start over.
        if (session) {
            renderActiveSessionBanner({
                email: session.user?.email || '',
                dashboardUrl: appUrl(authUrls.dashboard),
                artistComplete: Boolean(artistProgress?.isComplete)
            });
        } else {
            removeActiveSessionBanner();
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

const ACTIVE_SESSION_BANNER_ID = 'active-session-banner';

function renderActiveSessionBanner({ email, dashboardUrl, artistComplete }) {
    if (typeof document === 'undefined') return;
    if (document.getElementById(ACTIVE_SESSION_BANNER_ID)) return;

    const banner = document.createElement('div');
    banner.id = ACTIVE_SESSION_BANNER_ID;
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
        'padding:12px 16px', 'background:#15110D', 'color:#F2EFE6',
        'border-bottom:2px solid #F2B519', 'font:600 14px/1.35 system-ui,sans-serif',
        'display:flex', 'gap:12px', 'align-items:center', 'justify-content:center',
        'flex-wrap:wrap', 'text-align:center'
    ].join(';');

    const message = document.createElement('span');
    message.innerHTML = `Ya hay sesion activa con <strong>${escapeHtmlForBanner(email || 'tu cuenta')}</strong>. ${
        artistComplete
            ? 'Si querés registrar otra cuenta, cerra sesion primero.'
            : 'Tu perfil esta incompleto — podes continuarlo, o cerrar sesion para usar otra cuenta.'
    }`;
    banner.appendChild(message);

    if (dashboardUrl) {
        const dashLink = document.createElement('a');
        dashLink.href = dashboardUrl;
        dashLink.textContent = 'Ir al dashboard';
        dashLink.style.cssText = 'background:#F2B519;color:#15110D;padding:6px 12px;text-decoration:none;border-radius:2px;';
        banner.appendChild(dashLink);
    }

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Cerrar sesion';
    logoutBtn.style.cssText = 'background:transparent;color:#F2EFE6;border:1px solid #F2EFE6;padding:6px 12px;cursor:pointer;border-radius:2px;font:inherit;';
    logoutBtn.addEventListener('click', () => { handleLogout().catch(() => {}); });
    banner.appendChild(logoutBtn);

    document.body.appendChild(banner);
    document.body.style.paddingTop = `${banner.offsetHeight}px`;
}

function removeActiveSessionBanner() {
    if (typeof document === 'undefined') return;
    const banner = document.getElementById(ACTIVE_SESSION_BANNER_ID);
    if (banner) {
        banner.remove();
        document.body.style.paddingTop = '';
    }
}

function escapeHtmlForBanner(value) {
    return String(value || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    clearLoginMessage();
    document.getElementById('login-form').reset();
}

function closeLoginModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeLoginModal();
    }
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLoginModal();
    }
});

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

async function createOrResumeArtistDraft({ email = '', source = 'email' } = {}) {
    const response = await fetch(appUrl('/api/register/artist-draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            source,
            step: email ? 3 : 1,
            data: { email, registration_source: source }
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

async function handleRegistration(e) {
    e.preventDefault();
    const btn = document.querySelector('#beta-form .btn-register-primary');
    const originalText = btn.innerHTML;
    const emailInput = document.querySelector('.input-email');
    const email = emailInput.value.trim().toLowerCase();

    clearFormMessage();

    if (!email) return;

    // Switch to validation state
    btn.innerHTML = 'VALIDANDO...';
    btn.style.background = 'var(--primary-yellow)';
    btn.style.color = 'var(--fg)';
    btn.disabled = true;

    try {
        const requestedReturnTo = window.ArtistAuth?.getReturnTo(window.location.search, '') || '';
        const authUrls = window.ArtistAuth?.getRouteUrls(window.ConfigManager, requestedReturnTo) || {
            registerArtist: requestedReturnTo ? `/register-artist?returnTo=${encodeURIComponent(requestedReturnTo)}` : '/register-artist'
        };

        btn.innerHTML = 'GUARDANDO...';
        const draftPayload = await createOrResumeArtistDraft({ email, source: 'email' });
        const artistProgress = getArtistRegistrationProgress(draftPayload.artist);
        const targetUrl = buildDraftWizardUrl(
            getArtistResumeUrl(authUrls.registerArtist, artistProgress),
            draftPayload,
            'email',
            email
        );

        btn.innerHTML = 'REDIRIGIENDO...';
        btn.style.background = '#4CAF50';
        btn.style.color = 'white';
        showFormMessage('Registro iniciado. Continuaremos sin iniciar sesion automaticamente.', 'success');

        setTimeout(() => {
            window.location.href = appUrl(targetUrl);
        }, 700);
        return;
/*

        const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${tempUsername}`);
*/
    } catch (error) {
        console.error('Error in registration:', error.message);
        btn.innerHTML = 'ERROR';
        btn.style.background = 'var(--primary-red)';
        btn.style.color = 'white';
        
        let errorMessage = 'Error al registrar. Por favor, intenta de nuevo.';
        if (error.code === 'ALREADY_REGISTERED') {
            pendingLoginEmail = email;
            errorMessage = 'Este email ya tiene un registro enviado. <a href="#" onclick="openLoginModal(); return false;">Inicia sesion</a>.';
        }
        
        showFormMessage(errorMessage, 'error');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.color = '';
            btn.disabled = false;
        }, 3000);
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
        btn.innerHTML = 'BIENVENIDO!';
        btn.style.background = '#4CAF50';

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
    const emailInput = document.querySelector('.input-email');
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
        showFormMessage('Ingresa tu email para recuperar tu contrasena.', 'info');
        return;
    }

    showFormMessage('Procesando solicitud...', 'info');

    try {
        // Generate a temporary password
        const tempPassword = generateTempPassword();
        
        // Call backend to reset password
        const response = await fetch(appUrl('/api/auth/reset-temp-password'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                userType: 'artist',
                tempPassword: tempPassword
            })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            if (response.status === 404) {
                throw new Error('No encontramos una cuenta con ese email.');
            }
            throw new Error(result.error || 'Error al procesar la solicitud');
        }
        
        // Trigger n8n webhook to send email with temp password
        if (window.ConfigManager && typeof window.ConfigManager.sendN8NEvent === 'function') {
            try {
                await window.ConfigManager.sendN8NEvent('password_reset_temp', {
                    email: email,
                    temp_password: tempPassword,
                    user_type: 'artist',
                        login_url: window.location.origin + appUrl('/registerclosedbeta')
                });
                console.log('n8n event sent: password_reset_temp (artist)');
            } catch (webhookErr) {
                console.warn('Could not send password_reset_temp event:', webhookErr);
            }
        }

        showFormMessage('Te hemos enviado un email con tu nueva contrasena temporal.', 'success');
    } catch (error) {
        console.error('Password recovery error:', error.message);
        showFormMessage(error.message || 'Error al enviar el email de recuperacion.', 'error');
    }
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
