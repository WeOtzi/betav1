// Identidad Supplies: alta con confirmación de email, registro idempotente
// y recuperación de contraseña. Espejo de studio-auth.js
// (docs/plans/2026-10-30-estudios-plataforma.md → Supplies).
//   - signUp con user_type 'supplies' y el borrador del negocio en
//     user_metadata.supplies_registration (sin email ni contraseña).
//   - Con sesión confirmada: WeotziData.Supplies.completeRegistration (RPC
//     idempotente, devuelve la fila completa de supply_vendors) → remember.
//   - Sin la migración M5 aplicada no se crea ninguna cuenta: el alta se
//     frena antes del signUp (si no, handle_new_user crearía un artista).
(function () {
    'use strict';
    let client = null;
    const basePath = window.WEOTZI_BASE_PATH || (window.location.pathname.startsWith('/beta/') ? '/beta' : '');
    const appUrl = path => basePath + path;
    let currentVendor = null;
    let checking = null;
    let unavailable = false;
    const recoveryMode = new URLSearchParams(window.location.search).get('recovery') === '1'
        || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.slice(1));
    const MISSING_MESSAGE = 'Supplies todavía no está disponible (falta aplicar una migración).';
    const MISSING_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    const PROBE_UID = '00000000-0000-0000-0000-000000000000';
    // Claves que viajan en el borrador (lista blanca de complete_supply_vendor_registration).
    const DRAFT_KEYS = [
        'name', 'description', 'logo_image', 'cover_image', 'contact_email', 'phone', 'whatsapp', 'website',
        'instagram', 'country', 'city', 'ships_to_countries', 'lead_time_days', 'currency', 'min_order_amount',
        'platform_discount_pct', 'free_shipping_threshold', 'benefits'
    ];
    const PRIVATE_KEYS = ['legal_name', 'tax_id', 'fiscal_address', 'billing_email', 'notes'];

    function requireClient() {
        client = window.WeotziData?.getClient?.() || window._supabase || client;
        if (!client) throw new Error('No pudimos conectar. Recargá la página e intentá nuevamente.');
        return client;
    }
    function repo() {
        const supplies = window.WeotziData?.Supplies;
        if (!supplies) throw new Error('No pudimos cargar Supplies. Recargá la página e intentá nuevamente.');
        return supplies;
    }
    async function ready() {
        if (window.ConfigManager?.ready) await window.ConfigManager.ready();
        return requireClient();
    }
    function isMissing(err) {
        return !!err && MISSING_CODES.includes(String(err.code || err.cause?.code || ''));
    }
    function missingError() {
        const err = new Error(MISSING_MESSAGE);
        err.code = 'SUPPLIES_UNAVAILABLE';
        return err;
    }
    function friendly(err) {
        if (err?.code === 'SUPPLIES_UNAVAILABLE' || isMissing(err)) return MISSING_MESSAGE;
        const kit = window.WeOtziStudioKit;
        if (kit?.friendlyError) return kit.friendlyError(err, 'No pudimos cargar tu cuenta Supplies. Intentá nuevamente.');
        return err?.message || 'No pudimos cargar tu cuenta Supplies. Intentá nuevamente.';
    }
    function remember(vendor) {
        currentVendor = vendor || null;
        window.currentSupplyVendor = currentVendor;
        return currentVendor;
    }
    // Solo la lista blanca del perfil: nunca email de login ni contraseña.
    function sanitizeDraft(profile) {
        const source = profile || {};
        const draft = {};
        DRAFT_KEYS.forEach(key => {
            if (source[key] !== undefined && source[key] !== null && source[key] !== '') draft[key] = source[key];
        });
        const privateSource = source.private && typeof source.private === 'object' ? source.private : source;
        const privateData = {};
        PRIVATE_KEYS.forEach(key => {
            const value = privateSource[key];
            if (value !== undefined && value !== null && value !== '') privateData[key] = value;
        });
        if (Object.keys(privateData).length) draft.private = privateData;
        return draft;
    }
    // ¿Está la migración de Supplies aplicada? Lectura inocua (anon puede leer
    // supply_vendors públicos); la tabla ausente vuelve como `unavailable`.
    async function isAvailable() {
        if (unavailable) return false;
        const res = await repo().getVendorByUserId(PROBE_UID);
        if (res?.unavailable) { unavailable = true; return false; }
        return true;
    }
    async function completeRegistration(draft) {
        const { data, error } = await repo().completeRegistration(draft);
        if (error) {
            if (isMissing(error)) { unavailable = true; throw missingError(); }
            throw error;
        }
        const vendor = Array.isArray(data) ? data[0] : data;
        if (!vendor?.id) throw new Error('No pudimos completar el registro de tu cuenta Supplies.');
        remember(vendor);
        // El borrador sobrevive a la confirmación en otro dispositivo; se borra
        // solo cuando la cuenta quedó creada.
        await client.auth.updateUser({ data: { supplies_registration: null } }).catch(() => {});
        return vendor;
    }
    async function resolveVendor(session) {
        const res = await repo().getVendorByUserId(session.user.id);
        if (res?.unavailable) { unavailable = true; throw missingError(); }
        if (res?.error) throw res.error;
        if (res?.data) return remember(res.data);
        const draft = session.user.user_metadata?.supplies_registration;
        if (draft && typeof draft === 'object' && draft.name) return completeRegistration(draft);
        return null;
    }
    async function checkSuppliesAuthState() {
        if (checking) return checking;
        checking = (async () => {
            const path = window.location.pathname.slice(basePath.length);
            try {
                await ready();
                const { data: { session }, error } = await requireClient().auth.getSession();
                if (error) throw error;
                if (!session) {
                    if (path.startsWith('/supplies/dashboard')) window.location.href = appUrl('/supplies/login');
                    return null;
                }
                if (recoveryMode) return null;
                const vendor = await resolveVendor(session);
                if (vendor) {
                    if (path.startsWith('/supplies/login') || path.startsWith('/supplies/register')) {
                        window.location.href = appUrl('/supplies/dashboard');
                    }
                    return vendor;
                }
                if (path.startsWith('/supplies/dashboard')) window.location.href = appUrl('/supplies/register?complete=1');
                return null;
            } catch (err) {
                const status = document.getElementById('login-status') || document.getElementById('wizard-status')
                    || document.getElementById('dashboard-status');
                if (status) {
                    status.className = 'studio-status studio-status-' + (err?.code === 'SUPPLIES_UNAVAILABLE' ? 'info' : 'error');
                    status.textContent = friendly(err);
                    status.hidden = false;
                }
                console.error('[supplies-auth] state check failed:', err);
                return null;
            }
        })();
        try { return await checking; } finally { checking = null; }
    }
    async function loginSupplies(email, password) {
        await ready();
        const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const vendor = await resolveVendor(data.session);
        if (!vendor) throw new Error('Tu cuenta todavía no tiene una tienda Supplies. Completala desde Registrar tu tienda.');
        return vendor;
    }
    async function registerSupplies(payload) {
        await ready();
        const { email, password, ...profile } = payload || {};
        if (!email || !String(profile.name || '').trim()) {
            throw new Error('Completá el nombre del negocio y el correo.');
        }
        if (!await isAvailable()) throw missingError();
        const draft = sanitizeDraft(profile);
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
                emailRedirectTo: window.location.origin + appUrl('/supplies/login?confirmed=1'),
                data: { user_type: 'supplies', supplies_registration: draft }
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
    async function requestSuppliesPasswordReset(email) {
        await ready();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Escribí un email válido.');
        const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), {
            redirectTo: window.location.origin + appUrl('/supplies/login?recovery=1')
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
    window.WeOtziSuppliesAuth = {
        check: checkSuppliesAuthState, login: loginSupplies, register: registerSupplies,
        requestPasswordReset: requestSuppliesPasswordReset, changePassword, verifyRecoveryCode,
        isRecovery: () => recoveryMode, isAvailable, isUnavailable: () => unavailable,
        ready, appUrl, remember, sanitizeDraft, friendlyError: friendly,
        logout: async () => {
            const { error } = await requireClient().auth.signOut();
            if (error) throw error;
            remember(null);
            window.location.href = appUrl('/supplies/login');
        },
        getSupabase: () => client || requireClient(), getCurrent: () => currentVendor
    };
    document.addEventListener('DOMContentLoaded', checkSuppliesAuthState);
})();
