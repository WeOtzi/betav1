// Studio identity, confirmation-safe onboarding and password recovery.
(function () {
    'use strict';
    let client = null;
    const basePath = window.WEOTZI_BASE_PATH || (window.location.pathname.startsWith('/beta/') ? '/beta' : '');
    const appUrl = path => basePath + path;
    let currentStudioData = null;
    let checking = null;
    const recoveryMode = new URLSearchParams(window.location.search).get('recovery') === '1'
        || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.slice(1));
    function requireClient() {
        client = window.WeotziData?.getClient?.() || window._supabase || client;
        if (!client) throw new Error('No pudimos conectar. Recargá la página e intentá nuevamente.');
        return client;
    }
    async function ready() {
        if (window.ConfigManager?.ready) await window.ConfigManager.ready();
        return requireClient();
    }
    function remember(studio) {
        currentStudioData = studio;
        window.currentStudioData = studio;
        return studio;
    }
    async function completeRegistration(draft) {
        const { data, error } = await requireClient().rpc('complete_studio_registration', {
            p_profile: draft.profile, p_locations: draft.locations
        });
        if (error) throw error;
        const studio = Array.isArray(data) ? data[0] : data;
        if (!studio?.id) throw new Error('No pudimos completar el registro del estudio.');
        remember(studio);
        // Non-secret draft survives email confirmation on another device.
        // Clear it only after profile and locations have committed together.
        await client.auth.updateUser({ data: { studio_registration: null } }).catch(() => {});
        return studio;
    }
    async function resolveStudio(session) {
        const { data: studio, error } = await WeotziData.Studios.getByUserId(session.user.id);
        if (error) throw error;
        if (studio) return remember(studio);
        const draft = session.user.user_metadata?.studio_registration;
        if (draft?.profile && Array.isArray(draft.locations)) return completeRegistration(draft);
        return null;
    }
    async function checkStudioAuthState() {
        if (checking) return checking;
        checking = (async () => {
            const path = window.location.pathname.slice(basePath.length);
            try {
                await ready();
                const { data: { session }, error } = await requireClient().auth.getSession();
                if (error) throw error;
                if (!session) {
                    if (path.startsWith('/studio/dashboard')) window.location.href = appUrl('/studio/login');
                    return null;
                }
                if (recoveryMode) return null;
                const studio = await resolveStudio(session);
                if (studio) {
                    if (path.startsWith('/studio/login') || path.startsWith('/studio/register')) {
                        window.location.href = appUrl('/studio/dashboard');
                    }
                    return studio;
                }
                if (path.startsWith('/studio/dashboard')) window.location.href = appUrl('/studio/register?complete=1');
                return null;
            } catch (err) {
                const status = document.getElementById('login-status') || document.getElementById('wizard-status')
                    || document.getElementById('dashboard-status');
                if (status) {
                    status.className = 'studio-status studio-status-error';
                    status.textContent = err.message || 'No se pudo cargar tu estudio. Intentá nuevamente.';
                    status.hidden = false;
                }
                console.error('[studio-auth] state check failed:', err);
                return null;
            }
        })();
        try { return await checking; } finally { checking = null; }
    }
    async function loginStudio(email, password) {
        await ready();
        const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const studio = await resolveStudio(data.session);
        if (!studio) throw new Error('Tu cuenta todavía no tiene un estudio. Completá el registro desde Registrar tu estudio.');
        return studio;
    }
    async function registerStudio(payload) {
        await ready();
        const { email, password, locations, ...profile } = payload || {};
        if (!email || !profile.name || !Array.isArray(locations) || !locations.length) {
            throw new Error('Completá el nombre, correo y al menos una sede.');
        }
        const draft = { profile, locations };
        const { data: { session } } = await requireClient().auth.getSession();
        if (session) {
            if (session.user.email?.toLowerCase() !== email.trim().toLowerCase()) {
                throw new Error('Hay otra cuenta abierta. Cerrá esa sesión antes de registrar un correo diferente.');
            }
            return completeRegistration(draft);
        }
        if (!password || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const { data, error } = await client.auth.signUp({
            email: email.trim(), password,
            options: {
                emailRedirectTo: window.location.origin + appUrl('/studio/login?confirmed=1'),
                data: { user_type: 'studio', studio_registration: draft }
            }
        });
        if (error) throw error;
        if (!data?.user?.id) throw new Error('No pudimos crear tu cuenta. Intentá nuevamente.');
        if (Array.isArray(data.user.identities) && !data.user.identities.length) {
            throw new Error('Ya existe una cuenta con ese email. Iniciá sesión para continuar.');
        }
        if (!data.session) return { confirmationRequired: true, email: email.trim() };
        return completeRegistration(draft);
    }
    async function requestStudioPasswordReset(email) {
        await ready();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Escribí un email válido.');
        const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), {
            redirectTo: window.location.origin + appUrl('/studio/login?recovery=1')
        });
        if (error) throw error;
        return true;
    }
    async function changePassword(password) {
        await ready();
        if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const { data: { session } } = await requireClient().auth.getSession();
        if (!session) throw new Error('El enlace venció. Solicitá un nuevo correo de recuperación.');
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
    }
    async function verifyRecoveryCode(email, token) {
        await ready();
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'recovery' });
        if (error) throw error;
    }
    window.WeOtziStudioAuth = {
        check: checkStudioAuthState, login: loginStudio, register: registerStudio,
        requestPasswordReset: requestStudioPasswordReset, changePassword, verifyRecoveryCode,
        isRecovery: () => recoveryMode, ready, appUrl,
        logout: async () => {
            const { error } = await requireClient().auth.signOut();
            if (error) throw error;
            remember(null);
            window.location.href = appUrl('/studio/login');
        },
        getSupabase: () => client || requireClient(), getCurrent: () => currentStudioData
    };
    document.addEventListener('DOMContentLoaded', checkStudioAuthState);
})();
