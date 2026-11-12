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

// Al volver de un enlace de recuperacion, Supabase emite PASSWORD_RECOVERY:
// en vez de redirigir, mostramos el formulario de nueva contrasena.
let backofficeRecoveryMode = /type=recovery/.test(window.location.hash) ||
    new URLSearchParams(window.location.search).get('mode') === 'recovery';

backofficeSupabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        backofficeRecoveryMode = true;
        if (document.readyState !== 'loading') showRecoveryForm();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    restoreTheme();
    if (backofficeRecoveryMode) showRecoveryForm();
    checkExistingSuperadminSession();
});

function backofficeReturnUrl(extra) {
    const url = new URL('/backoffice/login', window.location.origin);
    const redirect = getSafeBackofficeRedirect();
    if (redirect !== '/backoffice/') url.searchParams.set('redirect', redirect);
    if (extra) Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
}

function showRecoveryForm() {
    ['login-form', 'btn-magic', 'magic-divider', 'btn-reset'].forEach((id) => {
        document.getElementById(id).hidden = true;
    });
    document.getElementById('recovery-form').hidden = false;
    document.getElementById('new-password').focus();
}

// Enlace magico: Supabase envia un link de un solo uso que abre esta misma
// pagina con la sesion en la URL; checkExistingSuperadminSession la detecta y
// redirige al backoffice. shouldCreateUser:false evita crear cuentas nuevas.
window.handleBackofficeMagicLink = async function handleBackofficeMagicLink() {
    const btn = document.getElementById('btn-magic');
    btn.disabled = true;
    try {
        const { error } = await backofficeSupabase.auth.signInWithOtp({
            email: SUPERADMIN_EMAIL,
            options: { shouldCreateUser: false, emailRedirectTo: backofficeReturnUrl() }
        });
        if (error) throw error;
        showMessage('Enlace enviado a ' + SUPERADMIN_EMAIL + '. Abrelo en este navegador para entrar.', 'success');
    } catch (err) {
        showMessage('No se pudo enviar el enlace: ' + err.message, 'error');
    } finally {
        setTimeout(() => { btn.disabled = false; }, 30000);
    }
};

window.handleBackofficePasswordReset = async function handleBackofficePasswordReset() {
    try {
        const { error } = await backofficeSupabase.auth.resetPasswordForEmail(SUPERADMIN_EMAIL, {
            redirectTo: backofficeReturnUrl({ mode: 'recovery' })
        });
        if (error) throw error;
        showMessage('Te enviamos un email a ' + SUPERADMIN_EMAIL + ' para definir una nueva contrasena.', 'success');
    } catch (err) {
        showMessage('No se pudo enviar el email: ' + err.message, 'error');
    }
};

window.handleBackofficeNewPassword = async function handleBackofficeNewPassword(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-recovery');
    const password = document.getElementById('new-password').value;
    btn.classList.add('loading');
    btn.disabled = true;
    try {
        const { data: { session } } = await backofficeSupabase.auth.getSession();
        if (!session || !isSuperadminEmail(session.user?.email)) {
            throw new Error('El enlace expiro. Pide uno nuevo con "Restablecer contrasena".');
        }
        const { error } = await backofficeSupabase.auth.updateUser({ password });
        if (error) throw error;
        showMessage('Contrasena actualizada. Redirigiendo...', 'success');
        setTimeout(() => { window.location.href = getSafeBackofficeRedirect(); }, 800);
    } catch (err) {
        showMessage(err.message, 'error');
        btn.classList.remove('loading');
        btn.disabled = false;
    }
};

async function checkExistingSuperadminSession() {
    try {
        const { data: { session }, error } = await backofficeSupabase.auth.getSession();
        if (error || !session) return;
        if (backofficeRecoveryMode) return;
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
        if (backofficeRecoveryMode) return;
        const form = document.getElementById('login-form');
        if (form) form.dispatchEvent(new Event('submit'));
    }
});
