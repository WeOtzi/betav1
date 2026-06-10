// ============================================
// WE OTZI - Backoffice Superadmin Login
// ============================================

const SUPERADMIN_EMAIL = 'isai@weotzi.com';
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const backofficeSupabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));

function isSuperadminEmail(email) {
    return typeof email === 'string' && email.toLowerCase() === SUPERADMIN_EMAIL;
}

function getSafeBackofficeRedirect() {
    try {
        const url = new URL(window.location.href);
        const redirect = url.searchParams.get('redirect');
        if (!redirect) return '/backoffice/';
        if (!redirect.startsWith('/backoffice') || redirect.startsWith('//')) return '/backoffice/';
        if (redirect.startsWith('/backoffice/login')) return '/backoffice/';
        return redirect;
    } catch (_) {
        return '/backoffice/';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    restoreTheme();
    checkExistingSuperadminSession();
});

async function checkExistingSuperadminSession() {
    try {
        const { data: { session }, error } = await backofficeSupabase.auth.getSession();
        if (error || !session) return;
        if (isSuperadminEmail(session.user?.email)) {
            window.location.href = getSafeBackofficeRedirect();
            return;
        }
        await backofficeSupabase.auth.signOut();
    } catch (err) {
        console.warn('[backoffice-login] session check failed:', err.message);
    }
}

window.handleBackofficeLogin = async function handleBackofficeLogin(event) {
    event.preventDefault();

    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    const messageDiv = document.getElementById('form-message');

    messageDiv.className = 'form-message';
    messageDiv.textContent = '';
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const { data, error } = await backofficeSupabase.auth.signInWithPassword({
            email: SUPERADMIN_EMAIL,
            password
        });

        if (error) {
            throw new Error(error.message === 'Invalid login credentials'
                ? 'Credenciales incorrectas'
                : error.message);
        }

        if (!isSuperadminEmail(data.user?.email)) {
            await backofficeSupabase.auth.signOut();
            throw new Error('Esta cuenta no esta autorizada para Backoffice');
        }

        showMessage('Acceso superadmin autorizado. Redirigiendo...', 'success');
        setTimeout(() => {
            window.location.href = getSafeBackofficeRedirect();
        }, 500);
    } catch (err) {
        showMessage(err.message, 'error');
        btn.classList.remove('loading');
        btn.disabled = false;
    }
};

function showMessage(text, type) {
    const messageDiv = document.getElementById('form-message');
    messageDiv.textContent = text;
    messageDiv.className = `form-message ${type}`;
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
}

function restoreTheme() {
    if (localStorage.getItem('weotzi-theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') {
        const form = document.getElementById('login-form');
        if (form) form.dispatchEvent(new Event('submit'));
    }
});
