// Studio identity, confirmation-safe onboarding, catalog claims and password recovery.
//
// Onboarding states (lastState.kind, see resolveState):
//   studio          the account owns a studio → dashboard
//   claim_pending   a studio_claim_requests row is under review → "Reclamo en revisión"
//   claim_rejected  the latest claim was rejected → motive + "Registrar un estudio nuevo"
//   claim_failed    the claim saved at signUp could not be filed after confirming the email
//   claimable       complete_studio_registration refused the name because an unowned
//                   catalog studio already uses it → the register page offers the claim
//   none            signed in without studio, claim or draft
// Every claim call degrades when the M1 migration is not applied: missing repo
// methods or RPCs fall back to the plain registration flow.
(function () {
    'use strict';
    let client = null;
    const basePath = window.WEOTZI_BASE_PATH || (window.location.pathname.startsWith('/beta/') ? '/beta' : '');
    const appUrl = path => basePath + path;
    let currentStudioData = null;
    let checking = null;
    let initialCheck = null;
    let lastState = null;
    const recoveryMode = new URLSearchParams(window.location.search).get('recovery') === '1'
        || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.slice(1));
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    // request_studio_claim rejections that retrying cannot fix (owned studio,
    // another pending claim, invalid evidence…): the signUp draft is dropped.
    const DEFINITIVE_CLAIM_CODES = ['23514', '22023'];
    const CLAIM_STATUS = { pending: 'En revisión', approved: 'Aprobado', rejected: 'Rechazado' };
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
    function setState(state) {
        lastState = state;
        return state;
    }
    function currentPath() {
        return window.location.pathname.slice(basePath.length);
    }
    function warn(...args) {
        (console.warn || console.error || function () {}).apply(console, args);
    }
    function errorCode(err) {
        return String((err && (err.code || err.cause?.code)) || '');
    }
    // PostgREST errors arrive as plain objects: keep code and message, and turn
    // "migration pending" codes into the shared friendly copy.
    function asError(err) {
        const code = errorCode(err);
        const error = new Error(MISSING_SCHEMA_CODES.includes(code)
            ? MISSING_SCHEMA_MESSAGE
            : String(err?.message || 'No pudimos completar la acción. Intentá de nuevo.'));
        if (code) error.code = code;
        return error;
    }
    // complete_studio_registration (M1) refuses a name that an unowned catalog
    // studio already uses: "Ese estudio ya está en We Ötzi: reclamalo desde el registro."
    function isClaimableError(err) {
        const code = errorCode(err);
        return (!code || code === '23514') && /reclamalo/i.test(String(err?.message || ''));
    }
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtDate(value) {
        const kit = window.WeOtziStudioKit;
        if (typeof kit?.fmtDate === 'function') return kit.fmtDate(value);
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';
        const pad = n => String(n).padStart(2, '0');
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
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
    // Files the claim (request_studio_claim needs a confirmed email, so the
    // signUp draft waits in user_metadata.studio_claim until then).
    async function fileClaim(draft) {
        const studios = window.WeotziData?.Studios;
        if (typeof studios?.requestClaim !== 'function') throw asError({ code: '42883' });
        const { data, error } = (await studios.requestClaim(
            draft.studio_id, draft.evidence, draft.contact_name, draft.contact_phone
        )) || {};
        if (error) throw asError(error);
        // A filed claim supersedes any registration draft: clear both once it committed.
        await requireClient().auth.updateUser({ data: { studio_claim: null, studio_registration: null } }).catch(() => {});
        return data;
    }
    // Latest claim of the session user, or null (also when the table is missing
    // or the read fails: claims never block the regular onboarding).
    async function loadMyClaim() {
        const studios = window.WeotziData?.Studios;
        if (typeof studios?.getMyClaim !== 'function') return null;
        try {
            const { data, error } = (await studios.getMyClaim()) || {};
            if (error) { warn('[studio-auth] claim lookup failed:', error); return null; }
            return data || null;
        } catch (err) {
            warn('[studio-auth] claim lookup failed:', err);
            return null;
        }
    }
    async function resolveState(session) {
        const meta = session.user.user_metadata || {};
        const { data: studio, error } = await WeotziData.Studios.getByUserId(session.user.id);
        if (error) throw error;
        if (studio) return setState({ kind: 'studio', studio: remember(studio) });
        let claimError = null;
        const claimDraft = meta.studio_claim?.studio_id ? meta.studio_claim : null;
        if (claimDraft) {
            try {
                await fileClaim(claimDraft);
            } catch (err) {
                if (!DEFINITIVE_CLAIM_CODES.includes(errorCode(err))) throw err;
                claimError = err;
                await requireClient().auth.updateUser({ data: { studio_claim: null } }).catch(() => {});
            }
        }
        // A pending claim blocks a new registration (approving it would fail).
        const claim = await loadMyClaim();
        if (claim?.status === 'pending') return setState({ kind: 'claim_pending', claim });
        if (claimError) return setState({ kind: 'claim_failed', claim, error: claimError.message });
        const draft = meta.studio_registration;
        if (draft?.profile && Array.isArray(draft.locations)) {
            try {
                return setState({ kind: 'studio', studio: await completeRegistration(draft) });
            } catch (err) {
                if (!isClaimableError(err)) throw err;
                // Keep the draft: the user may rename the studio or claim the catalog one.
                return setState({ kind: 'claimable', name: draft.profile.name || '', error: err.message });
            }
        }
        if (claim?.status === 'rejected') return setState({ kind: 'claim_rejected', claim });
        return setState({ kind: 'none' });
    }
    function claimScreenHtml(state) {
        const kind = state?.kind;
        const claim = kind === 'claim_failed' ? null : (state?.claim || null);
        const studio = claim?.studios || {};
        const studioName = studio.name || 'Tu estudio';
        const rows = [['Estudio', studioName]];
        const place = [studio.city, studio.country].filter(Boolean).join(' · ');
        if (place) rows.push(['Ubicación', place]);
        if (claim?.created_at) rows.push(['Enviado', fmtDate(claim.created_at)]);
        if (kind === 'claim_rejected' && claim?.decided_at) rows.push(['Resuelto', fmtDate(claim.decided_at)]);
        if (claim?.status) rows.push(['Estado', CLAIM_STATUS[claim.status] || CLAIM_STATUS.pending]);
        const meta = claim ? '<div class="studio-meta-grid">' + rows.map(([k, v]) =>
            `<div class="studio-meta-row"><span class="key">${escapeHtml(k)}</span><span class="val">${escapeHtml(v)}</span></div>`
        ).join('') + '</div>' : '';
        const target = studio.slug || studio.id;
        const profileLink = target
            ? `<a class="studio-btn studio-btn-ghost" href="${escapeHtml(appUrl('/studio/profile/?studio=') + encodeURIComponent(target))}">Ver la ficha pública</a>`
            : '';
        const registerLink = `<a class="studio-btn studio-btn-primary" href="${escapeHtml(appUrl('/studio/register'))}">Registrar un estudio nuevo</a>`;
        const logoutButton = '<button type="button" class="studio-btn studio-btn-ghost" data-claim-action="logout">Cerrar sesión</button>';
        const head = title => '<p class="studio-section-kicker">Reclamo de estudio</p>'
            + `<h2 class="studio-h2" tabindex="-1">${escapeHtml(title)}</h2>`;
        if (kind === 'claim_pending') {
            return head('Reclamo en revisión') + meta
                + '<p class="studio-help" style="margin-top:14px;">Soporte de We Ötzi está verificando que el estudio es tuyo. '
                + 'Te avisamos por email cuando lo apruebe; después vas a poder completar el perfil desde el panel.</p>'
                + `<div class="studio-form" style="margin-top:18px;">${profileLink}${logoutButton}</div>`;
        }
        if (kind === 'claim_rejected') {
            const note = String(claim?.decision_note || '').trim();
            return head('No aprobamos tu reclamo') + meta
                + '<p class="studio-label" style="margin-top:14px;">Motivo</p>'
                + `<p class="studio-bio">${escapeHtml(note || 'Soporte no dejó un motivo.')}</p>`
                + '<p class="studio-help" style="margin-top:14px;">Si el estudio es tuyo, escribinos a soporte con más datos. '
                + 'También podés registrar un estudio nuevo.</p>'
                + `<div class="studio-form" style="margin-top:18px;">${registerLink}${logoutButton}</div>`;
        }
        return head('No pudimos enviar tu reclamo')
            + `<p class="studio-bio">${escapeHtml(state?.error || 'El reclamo ya no se puede enviar.')}</p>`
            + '<p class="studio-help" style="margin-top:14px;">Podés buscar otro estudio del catálogo o registrar uno nuevo.</p>'
            + `<div class="studio-form" style="margin-top:18px;">${registerLink}${logoutButton}</div>`;
    }
    // Renders the claim screen into #studio-claim-screen (login and register
    // pages) or, on the dashboard, into a card that replaces the panel shell.
    function mountClaimScreen(state) {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc || typeof doc.createElement !== 'function' || typeof doc.querySelectorAll !== 'function') return null;
        let screen = doc.getElementById('studio-claim-screen');
        if (!screen) {
            const host = doc.createElement('main');
            host.className = 'studio-center';
            screen = doc.createElement('section');
            screen.id = 'studio-claim-screen';
            screen.className = 'studio-card';
            screen.setAttribute('aria-live', 'polite');
            host.appendChild(screen);
            (doc.querySelector('.studio-page') || doc.body).appendChild(host);
        }
        doc.querySelectorAll('[data-claim-hide], .studio-dash-shell').forEach(el => { el.hidden = true; });
        screen.innerHTML = claimScreenHtml(state);
        screen.hidden = false;
        screen.querySelector('[data-claim-action="logout"]')?.addEventListener('click', () => {
            logout().catch(err => console.error('[studio-auth] logout failed:', err));
        });
        screen.querySelector('h2')?.focus?.();
        return screen;
    }
    // Page reaction to a signed-in account without studio.
    function presentState(state) {
        const path = currentPath();
        const onRegister = path.startsWith('/studio/register');
        switch (state?.kind) {
            case 'claim_pending':
                mountClaimScreen(state);
                break;
            case 'claim_rejected':
            case 'claim_failed':
                // The register page keeps the wizard and shows a notice instead.
                if (!onRegister) mountClaimScreen(state);
                break;
            case 'claimable':
                if (!onRegister) window.location.href = appUrl('/studio/register?reclamar=1');
                break;
            case 'none':
                if (path.startsWith('/studio/dashboard')) window.location.href = appUrl('/studio/register?complete=1');
                break;
            default:
                break;
        }
        return state;
    }
    async function checkStudioAuthState() {
        if (checking) return checking;
        checking = (async () => {
            const path = currentPath();
            try {
                await ready();
                const { data: { session }, error } = await requireClient().auth.getSession();
                if (error) throw error;
                if (!session) {
                    setState({ kind: 'anonymous' });
                    if (path.startsWith('/studio/dashboard')) window.location.href = appUrl('/studio/login');
                    return null;
                }
                if (recoveryMode) return null;
                const state = await resolveState(session);
                if (state.studio) {
                    if (path.startsWith('/studio/login') || path.startsWith('/studio/register')) {
                        window.location.href = appUrl('/studio/dashboard');
                    }
                    return state.studio;
                }
                presentState(state);
                return null;
            } catch (err) {
                setState({ kind: 'error', error: err.message || 'No se pudo cargar tu estudio. Intentá nuevamente.' });
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
    // State of the page-load check (starts it when it did not run yet).
    async function whenChecked() {
        if (!initialCheck) initialCheck = checkStudioAuthState();
        await initialCheck;
        return lastState;
    }
    // Returns the studio, or null after presenting a claim state (review screen
    // or redirect to the claim offer). Throws when there is nothing to resume.
    async function loginStudio(email, password) {
        await ready();
        const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const state = await resolveState(data.session);
        if (state.studio) return state.studio;
        if (state.kind !== 'none') { presentState(state); return null; }
        throw new Error('Tu cuenta todavía no tiene un estudio. Completá el registro desde Registrar tu estudio.');
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
    // Claims an unowned catalog studio. Signed in: files it now. Otherwise the
    // signUp keeps the non-secret draft in user_metadata.studio_claim and
    // resolveState files it after the email confirmation (like studio_registration).
    // Resolves to {confirmationRequired, email} or to the claim_pending state.
    async function claimStudio(payload) {
        await ready();
        const { email, password, studioId, studio, evidence, contactName, contactPhone } = payload || {};
        const cleanEvidence = String(evidence || '').trim();
        if (!studioId) throw new Error('Elegí el estudio que querés reclamar.');
        if (!cleanEvidence) throw new Error('Contanos cómo podemos verificar que el estudio es tuyo.');
        if (cleanEvidence.length > 1000) throw new Error('La evidencia admite hasta 1000 caracteres.');
        const draft = {
            studio_id: studioId,
            evidence: cleanEvidence,
            contact_name: String(contactName || '').trim() || null,
            contact_phone: String(contactPhone || '').trim() || null
        };
        const fileNow = async () => {
            const claimId = await fileClaim(draft);
            const claim = await loadMyClaim() || {
                id: claimId, studio_id: studioId, status: 'pending',
                created_at: new Date().toISOString(), studios: studio || null
            };
            return setState({ kind: 'claim_pending', claim });
        };
        const { data: { session } } = await requireClient().auth.getSession();
        if (session) {
            if (email && session.user.email?.toLowerCase() !== String(email).trim().toLowerCase()) {
                throw new Error('Hay otra cuenta abierta. Cerrá esa sesión antes de reclamar con un correo diferente.');
            }
            return fileNow();
        }
        if (!/^\S+@\S+\.\S+$/.test(String(email || '').trim())) throw new Error('Escribí un email válido.');
        if (!password || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const { data, error } = await client.auth.signUp({
            email: email.trim(), password,
            options: {
                emailRedirectTo: window.location.origin + appUrl('/studio/login?confirmed=1'),
                data: { user_type: 'studio', studio_claim: draft }
            }
        });
        if (error) throw error;
        if (!data?.user?.id) throw new Error('No pudimos crear tu cuenta. Intentá nuevamente.');
        if (Array.isArray(data.user.identities) && !data.user.identities.length) {
            throw new Error('Ya existe una cuenta con ese email. Iniciá sesión y volvé a reclamar el estudio.');
        }
        if (!data.session) return { confirmationRequired: true, email: email.trim() };
        return fileNow();
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
    async function logout() {
        const { error } = await requireClient().auth.signOut();
        if (error) throw error;
        remember(null);
        window.location.href = appUrl('/studio/login');
    }
    window.WeOtziStudioAuth = {
        check: checkStudioAuthState, login: loginStudio, register: registerStudio, claim: claimStudio,
        requestPasswordReset: requestStudioPasswordReset, changePassword, verifyRecoveryCode,
        isRecovery: () => recoveryMode, ready, appUrl, logout,
        whenChecked, getState: () => lastState, presentState, isClaimableError, claimScreenHtml,
        getSupabase: () => client || requireClient(), getCurrent: () => currentStudioData
    };
    document.addEventListener('DOMContentLoaded', () => { if (!initialCheck) initialCheck = checkStudioAuthState(); });
})();
