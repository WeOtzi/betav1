// [CH-07 / CH-08] START: Supabase Client and Auth Configuration
// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Pre-set password for new registrations - Uses config.js
const PRESET_PASSWORD = window.CONFIG?.registration?.presetPassword || 'OtziArtist2025';
// [CH-07 / CH-08] END

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
    // Don't redirect if already on landing page - let users browse freely
    const currentPath = window.location.pathname;
    
    // Skip redirect logic if on landing page - users should be able to stay there
    if (currentPath.includes('/registerclosedbeta')) {
        return;
    }
    
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) {
        // User is logged in, check if profile is complete
        // Use maybeSingle() instead of single() to handle 0 rows gracefully (prevents 406 error)
        const { data: artist, error } = await _supabase
            .from('artists_db')
            .select('name')
            .eq('user_id', session.user.id)
            .maybeSingle();
        
        if (error) {
            console.warn('checkAuthState error:', error);
            return;
        }
        
        // If no artist record exists OR profile is incomplete, redirect to complete it
        if (!artist || !artist.name) {
            window.location.href = '/register-artist';
        }
    }
}
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
    const modal = document.getElementById('login-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('login-email').focus();
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

// ============================================
// Registration Handler (Email + Password)
// ============================================

async function handleRegistration(e) {
    e.preventDefault();
    const btn = document.querySelector('.btn-register');
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
        // Check if email already exists
        const emailExists = await checkEmailExists(email);

        if (emailExists) {
            // User already registered - show login prompt
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.color = '';
            btn.disabled = false;
            
            showFormMessage(
                'Usuario registrado. <a href="#" onclick="openLoginModal(); return false;">Iniciar sesion</a>',
                'info'
            );
            return;
        }

        // Email does not exist, proceed with registration using password
        btn.innerHTML = 'REGISTRANDO...';

        // Get base URL for redirects (handles subdirectory deployments)
        const baseUrl = window.location.origin;

        // [CH-16] Generate temporary username from email prefix
        const emailPrefix = email.split('@')[0];
        const tempUsername = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '') + '.wo';
        
        // [CH-16] Generate WhatsApp link with username
        const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541162079567';
        const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${tempUsername}`);
        const whatsappLink = `https://api.whatsapp.com/send?phone=${weOtziWA.replace(/\+/g, '')}&text=${whatsappMessage}`;

        const { data: authData, error: authError } = await _supabase.auth.signUp({
            email: email,
            password: PRESET_PASSWORD,
            options: {
                emailRedirectTo: baseUrl + '/register-artist',
                data: {
                    username: tempUsername,
                    temp_password: PRESET_PASSWORD,
                    display_name: 'Artista',
                    whatsapp_link: whatsappLink
                }
            }
        });

        if (authError) throw authError;

        // If user was created successfully, insert initial record in artists_db
        if (authData.user) {
            const { error: insertError } = await _supabase
                .from('artists_db')
                .insert({
                    user_id: authData.user.id,
                    email: email,
                    username: tempUsername,
                    password: PRESET_PASSWORD,
                    email_confirmed: false
                });

            if (insertError) {
                console.error('Error inserting artist record:', insertError);
                // Don't throw - the auth user was created, we can update later
            }

            // Success - redirect to complete profile
            btn.innerHTML = 'REDIRIGIENDO...';
            btn.style.background = '#4CAF50';
            btn.style.color = 'white';

            showFormMessage(
                `Cuenta creada. Tu contrasena temporal es: <strong>${PRESET_PASSWORD}</strong>. Revisa tu email para confirmar.`,
                'success'
            );

            // Sign in the user to establish session (signUp doesn't create session automatically)
            const { error: signInError } = await _supabase.auth.signInWithPassword({
                email: email,
                password: PRESET_PASSWORD
            });

            if (signInError) {
                console.warn('Could not auto-login after signup:', signInError.message);
                // Still show success but user may need to login manually
            }

            // Auto-redirect after a moment
            setTimeout(() => {
                window.location.href = '/register-artist';
            }, 2500);
        }

    } catch (error) {
        console.error('Error in registration:', error.message);
        btn.innerHTML = 'ERROR';
        btn.style.background = 'var(--primary-red)';
        btn.style.color = 'white';
        
        let errorMessage = 'Error al registrar. Por favor, intenta de nuevo.';
        if (error.message.includes('already registered')) {
            errorMessage = 'Este email ya esta registrado. <a href="#" onclick="openLoginModal(); return false;">Iniciar sesion</a>';
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
        const { data, error } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // Success - check if profile is complete
        btn.innerHTML = 'BIENVENIDO!';
        btn.style.background = '#4CAF50';

        // Check if artist profile needs completion
        // Use maybeSingle() instead of single() to handle 0 rows gracefully (prevents 406 error)
        const { data: artist, error: artistError } = await _supabase
            .from('artists_db')
            .select('name')
            .eq('user_id', data.user.id)
            .maybeSingle();

        if (artistError) {
            console.warn('Artist lookup error:', artistError);
        }

        // If no artist record exists OR profile is incomplete, redirect to register
        if (!artist || !artist.name) {
            showLoginMessage('Redirigiendo para completar tu perfil...', 'success');
            setTimeout(() => {
                window.location.href = '/register-artist';
            }, 1500);
        } else {
            showLoginMessage('Sesion iniciada correctamente.', 'success');
            setTimeout(() => {
                closeLoginModal();
                // Redirect to dashboard
                window.location.href = '/artist/dashboard';
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

// ============================================
// Social Login Handler
// ============================================

async function handleSocialLogin(provider) {
    try {
        // Get base URL for redirects (handles subdirectory deployments)
        const baseUrl = window.location.origin;

        const { data, error } = await _supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: baseUrl + '/register-artist',
                scopes: provider === 'instagram' ? 'user_profile,user_media' : undefined
            }
        });

        if (error) throw error;
    } catch (error) {
        console.error(`Error logging in with ${provider}:`, error.message);
        showFormMessage(`Error al conectar con ${provider}. Por favor, intentalo de nuevo.`, 'error');
    }
}

// ============================================
// Password Recovery Handler
// ============================================

async function handlePasswordRecovery(e) {
    e.preventDefault();
    const emailInput = document.querySelector('.input-email');
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
        showFormMessage('Ingresa tu email para recuperar tu contrasena.', 'info');
        return;
    }

    try {
        // Get base URL for redirects (handles subdirectory deployments)
        const baseUrl = window.location.origin;

        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: baseUrl + '/reset-password'
        });

        if (error) throw error;

        showFormMessage('Te hemos enviado un email para restablecer tu contrasena.', 'success');
    } catch (error) {
        console.error('Password recovery error:', error.message);
        showFormMessage('Error al enviar el email de recuperacion.', 'error');
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
