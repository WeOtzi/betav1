// ============================================
// WE OTZI - Support Login
// Authentication for support team members
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    restoreThemeAndZoom();
    checkExistingSession();
});

/**
 * Check if user is already logged in and is a support user
 */
async function checkExistingSession() {
    try {
        const { data: { session }, error } = await _supabase.auth.getSession();
        
        if (session && !error) {
            // Check if this user is a support user
            const isSupport = await verifySupportUser(session.user.id);
            if (isSupport) {
                // Already logged in as support, redirect to dashboard
                window.location.href = '/support/dashboard';
                return;
            }
        }
    } catch (err) {
        console.error('Session check error:', err);
    }
}

/**
 * Verify if a user ID belongs to an active support user
 */
async function verifySupportUser(userId) {
    try {
        const { data, error } = await _supabase
            .from('support_users_db')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();
        
        if (error || !data) {
            return false;
        }
        
        return true;
    } catch (err) {
        console.error('Support verification error:', err);
        return false;
    }
}

// ============================================
// LOGIN HANDLER
// ============================================

window.handleSupportLogin = async function(event) {
    event.preventDefault();
    
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    const messageDiv = document.getElementById('form-message');
    
    // Clear previous messages
    messageDiv.className = 'form-message';
    messageDiv.textContent = '';
    
    // Show loading state
    btn.classList.add('loading');
    btn.disabled = true;
    
    try {
        // Step 1: Authenticate with Supabase Auth
        const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (authError) {
            throw new Error(authError.message === 'Invalid login credentials' 
                ? 'Email o contrasena incorrectos' 
                : authError.message);
        }
        
        if (!authData.user) {
            throw new Error('No se pudo autenticar el usuario');
        }
        
        // Step 2: Verify the user is in support_users_db
        const { data: supportData, error: supportError } = await _supabase
            .from('support_users_db')
            .select('*')
            .eq('user_id', authData.user.id)
            .eq('is_active', true)
            .single();
        
        if (supportError || !supportData) {
            // User authenticated but is not a support user - sign them out
            await _supabase.auth.signOut();
            throw new Error('No tienes permisos para acceder al panel de soporte. Contacta al administrador.');
        }
        
        // Step 3: Success - redirect to dashboard
        showMessage('Acceso autorizado. Redirigiendo...', 'success');
        
        setTimeout(() => {
            window.location.href = '/support/dashboard';
        }, 1000);
        
    } catch (err) {
        console.error('Login error:', err);
        showMessage(err.message, 'error');
        btn.classList.remove('loading');
        btn.disabled = false;
    }
};

/**
 * Display a message to the user
 */
function showMessage(text, type) {
    const messageDiv = document.getElementById('form-message');
    messageDiv.textContent = text;
    messageDiv.className = `form-message ${type}`;
}

// ============================================
// THEME & ZOOM CONTROLS
// ============================================

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function setZoom(factor) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clamped);
    localStorage.setItem('weotzi-zoom', clamped);
}

function zoomIn() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.85;
    setZoom(current + ZOOM_STEP);
}

function zoomOut() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.85;
    setZoom(current - ZOOM_STEP);
}

function restoreThemeAndZoom() {
    // Restore Theme
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // Restore Zoom
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', (e) => {
    // Enter to submit if in form
    if (e.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') {
        const form = document.getElementById('login-form');
        if (form) {
            form.dispatchEvent(new Event('submit'));
        }
    }
});
