// Studio identity, confirmation-safe onboarding, catalog claims and password recovery.
//
// Estados del onboarding (lastState.kind, ver resolveState):
//   studio          la cuenta tiene estudio → panel
//   claim_pending   hay un reclamo de ficha en revisión → pantalla "Reclamo en revisión"
//   claim_rejected  el último reclamo fue rechazado → motivo + registrar un estudio nuevo
//   claim_failed    el reclamo guardado en el signUp no se pudo enviar al confirmar el email
//   claimable       complete_studio_registration rechazó el nombre porque una ficha sin
//                   dueño del catálogo ya lo usa (23514) → el registro ofrece reclamarla
//   registration_conflict  el alta fue rechazada por un homónimo con dueño (23505), por una
//                   sede en la dirección de un estudio parecido (23P01) o porque faltó
//                   aceptar los Términos (22023 terms_required) → el registro reabre el
//                   borrador (user_metadata.studio_registration) con el motivo
//   none            sesión sin estudio, reclamo ni borrador
// Nunca deja el error en el login: los conflictos llevan a /studio/register.
// Los reclamos degradan si la migración no está: el onboarding sigue como antes.
(function () {
    'use strict';
    let client = null;
    const basePath = window.WEOTZI_BASE_PATH || (window.location.pathname.startsWith('/beta/') ? '/beta' : '');
    const appUrl = path => basePath + path;
    let currentStudioData = null;
    let checking = null;
    // ── acceso (ACC-17): link vencido o ya usado (#error=…otp_expired). Se lee
    // antes de que supabase-js toque la URL; con error no se entra al modo
    // "Nueva contraseña" (no hay sesión de recuperación que lo respalde).
    const linkError = window.WeotziEmailConfirm?.readAuthLinkError?.({ clean: false })
        || (/(?:^|[#&?])error(?:_code)?=/.test(window.location.hash + '&' + window.location.search) ? { expired: true } : null);
    const recoveryMode = !linkError && (new URLSearchParams(window.location.search).get('recovery') === '1'
        || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.slice(1)));
    let initialCheck = null;
    let lastState = null;
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    // Rechazos de request_studio_claim que reintentar no arregla: se descarta el borrador.
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
    function asError(err) {
        const code = errorCode(err);
        const error = new Error(MISSING_SCHEMA_CODES.includes(code)
            ? MISSING_SCHEMA_MESSAGE
            : String(err?.message || 'No pudimos completar la acción. Intentá de nuevo.'));
        if (code) error.code = code;
        if (err?.hint) error.hint = err.hint;
        return error;
    }
    // Ficha sin dueño con el mismo nombre: "Ese estudio ya está en We Ötzi: reclamalo desde el registro."
    function isClaimableError(err) {
        const code = errorCode(err);
        return (!code || code === '23514') && /reclamalo/i.test(String(err?.message || ''));
    }
    // Faltó aceptar los Términos (migración 20261115210000).
    function isTermsError(err) {
        return errorCode(err) === '22023' && (err?.hint === 'terms_required' || /T[ée]rminos/i.test(String(err?.message || '')));
    }
    // Homónimo con dueño (23505), sede en la dirección de un estudio parecido (23P01) o términos.
    function isRegistrationConflict(err) {
        return ['23505', '23P01'].includes(errorCode(err)) || isTermsError(err);
    }
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtDate(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';
        const pad = n => String(n).padStart(2, '0');
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }
    async function finishRegistrationMedia(studio, email) {
        if (!window.WeOtziStudioMedia || !email) return remember(studio);
        try {
            if (!await window.WeOtziStudioMedia.hasPending(email)) return remember(studio);
            return remember(await window.WeOtziStudioMedia.finish(studio, email));
        } catch (error) {
            // Account and locations already exist. Keep access and local files available for retry.
            return remember({ ...studio, mediaPending: true, mediaError: error.message || 'No pudimos completar la subida de imágenes.' });
        }
    }
    // Email de bienvenida (servidor, una sola vez por cuenta). Nunca bloquea el alta.
    function requestWelcomeEmail(session) {
        try {
            if (window.WEOTZI_PREVIEW_COMMIT || typeof window.fetch !== 'function') return;
            const token = session?.access_token;
            if (!token) return;
            window.fetch(appUrl('/api/studio/registration/welcome'), {
                method: 'POST', keepalive: true,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: '{}'
            }).catch(() => {});
        } catch (_) { /* best-effort */ }
    }
    async function completeRegistration(draft, email) {
        const studios = window.WeotziData?.Studios;
        const { data, error } = typeof studios?.completeRegistration === 'function'
            ? await studios.completeRegistration(draft.profile, draft.locations)
            : await requireClient().rpc('complete_studio_registration', { p_profile: draft.profile, p_locations: draft.locations });
        if (error) throw error;
        const studio = Array.isArray(data) ? data[0] : data;
        if (!studio?.id) throw new Error('No pudimos completar el registro del estudio.');
        remember(studio);
        // Non-secret draft survives email confirmation on another device.
        // Clear it only after profile and locations have committed together.
        await client.auth.updateUser({ data: { studio_registration: null } }).catch(() => {});
        try {
            const { data: sessionData } = await requireClient().auth.getSession();
            requestWelcomeEmail(sessionData?.session);
        } catch (_) { /* best-effort */ }
        return finishRegistrationMedia(studio, email);
    }
    // Envía el reclamo (request_studio_claim exige el email confirmado, así que el
    // borrador del signUp espera en user_metadata.studio_claim hasta entonces).
    async function fileClaim(draft) {
        const studios = window.WeotziData?.Studios;
        if (typeof studios?.requestClaim !== 'function') throw asError({ code: '42883' });
        const { data, error } = (await studios.requestClaim(
            draft.studio_id, draft.evidence, draft.contact_name, draft.contact_phone, draft.terms_version
        )) || {};
        if (error) throw asError(error);
        // Un reclamo enviado reemplaza cualquier borrador de registro.
        await requireClient().auth.updateUser({ data: { studio_claim: null, studio_registration: null } }).catch(() => {});
        return data;
    }
    // Último reclamo de la cuenta, o null (también si la tabla falta: nunca bloquea).
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
    async function resolveState(session, { includeManaged = true } = {}) {
        const meta = session.user.user_metadata || {};
        const { data: studio, error } = await WeotziData.Studios.getByUserId(session.user.id);
        if (error) throw error;
        if (studio) return setState({ kind: 'studio', studio: await finishRegistrationMedia(studio, session.user.email) });
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
        // Un reclamo pendiente bloquea un alta nueva (aprobarlo fallaría).
        const claim = await loadMyClaim();
        if (claim?.status === 'pending') return setState({ kind: 'claim_pending', claim });
        if (claimError) return setState({ kind: 'claim_failed', claim, error: claimError.message });
        const draft = meta.studio_registration;
        if (draft?.profile && Array.isArray(draft.locations)) {
            try {
                return setState({ kind: 'studio', studio: await completeRegistration(draft, session.user.email) });
            } catch (err) {
                if (isRegistrationConflict(err)) {
                    return setState({ kind: 'registration_conflict', draft, code: isTermsError(err) ? 'terms' : errorCode(err), error: err.message });
                }
                if (!isClaimableError(err)) throw err;
                // Se conserva el borrador: puede cambiar el nombre o reclamar la ficha.
                return setState({ kind: 'claimable', name: draft.profile.name || '', draft, error: err.message });
            }
        }
        // Después del estudio propio, del reclamo y del borrador de registro.
        const managed = await managedStudio(includeManaged);
        if (managed) return setState({ kind: 'studio', studio: managed });
        if (claim?.status === 'rejected') return setState({ kind: 'claim_rejected', claim });
        return setState({ kind: 'none' });
    }
    async function managedStudio(includeManaged) {
        return includeManaged ? resolveManagedStudio() : null;
    }
    // Manager activo de un estudio (studio_artist_memberships role='manager'):
    // entra al panel solo con Mensajes y Equipo → solicitudes de cambio. Las RPC
    // vuelven a verificar el acceso en la base; esto solo decide qué se muestra.
    async function resolveManagedStudio() {
        if (typeof WeotziData?.Studios?.listMyAccess !== 'function') return null;
        const { data, error } = await WeotziData.Studios.listMyAccess();
        if (error) {
            // Sin la migración 20261113101000 la RPC no existe: se comporta como antes.
            warn('[studio-auth] list_my_studio_access:', error.message || error);
            return null;
        }
        const rows = (Array.isArray(data) ? data : []).filter(row => row && row.access === 'manager' && row.studio_id);
        if (!rows.length) return null;
        const wanted = new URLSearchParams(window.location.search).get('studio');
        const row = rows.find(r => wanted && (r.studio_id === wanted || r.slug === wanted)) || rows[0];
        return remember({
            id: row.studio_id, name: row.name, slug: row.slug, logo_image: row.logo_image || null,
            access: 'manager', managedStudios: rows.map(r => ({ id: r.studio_id, name: r.name, slug: r.slug }))
        });
    }
    // Pantalla de reclamo (en el registro, con los componentes del DS).
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
        const meta = claim ? '<div class="sr-summary">' + rows.map(([k, v]) =>
            `<div class="sr-summary-row"><strong>${escapeHtml(k)}</strong><p>${escapeHtml(v)}</p></div>`
        ).join('') + '</div>' : '';
        const target = studio.slug || studio.id;
        const profileLink = target
            ? `<a class="wo-btn wo-btn--secondary" href="${escapeHtml(appUrl('/studio/profile/?studio=') + encodeURIComponent(target))}">Ver la ficha pública</a>`
            : '';
        const registerLink = `<a class="wo-btn" href="${escapeHtml(appUrl('/studio/register?nuevo=1'))}">Registrar un estudio nuevo</a>`;
        const logoutButton = '<button type="button" class="wo-btn wo-btn--secondary" data-claim-action="logout">Cerrar sesión</button>';
        const head = title => '<p class="sr-kicker">Reclamo de estudio</p>'
            + `<h2 tabindex="-1">${escapeHtml(title)}</h2>`;
        if (kind === 'claim_pending') {
            return head('Reclamo en revisión') + meta
                + '<p class="sr-help">Soporte de We Ötzi está verificando que el estudio es tuyo. '
                + 'Te avisamos por email cuando lo apruebe; después vas a poder completar el perfil y las sedes desde el panel.</p>'
                + `<div class="sr-actions">${profileLink}${logoutButton}</div>`;
        }
        if (kind === 'claim_rejected') {
            const note = String(claim?.decision_note || '').trim();
            return head('No aprobamos tu reclamo') + meta
                + '<p class="sr-kicker sr-claim-motive">Motivo</p>'
                + `<p class="sr-help">${escapeHtml(note || 'Soporte no dejó un motivo.')}</p>`
                + '<p class="sr-help">Si el estudio es tuyo, escribinos a soporte con más datos. '
                + 'También podés registrar un estudio nuevo.</p>'
                + `<div class="sr-actions">${registerLink}${logoutButton}</div>`;
        }
        return head('No pudimos enviar tu reclamo')
            + `<p class="sr-help">${escapeHtml(state?.error || 'El reclamo ya no se puede enviar.')}</p>`
            + '<p class="sr-help">Podés buscar otro estudio del catálogo o registrar uno nuevo.</p>'
            + `<div class="sr-actions">${registerLink}${logoutButton}</div>`;
    }
    // Monta la pantalla en #studio-claim-screen (solo existe en /studio/register).
    function mountClaimScreen(state) {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc || typeof doc.getElementById !== 'function') return null;
        const screen = doc.getElementById('studio-claim-screen');
        if (!screen) return null;
        if (typeof doc.querySelectorAll === 'function') doc.querySelectorAll('[data-claim-hide]').forEach(el => { el.hidden = true; });
        screen.innerHTML = claimScreenHtml(state);
        screen.hidden = false;
        screen.querySelector('[data-claim-action="logout"]')?.addEventListener('click', () => {
            logout().catch(err => console.error('[studio-auth] logout failed:', err));
        });
        screen.querySelector('h2')?.focus?.();
        return screen;
    }
    // Reacción de la página a una cuenta con sesión y sin estudio.
    function presentState(state) {
        const path = currentPath();
        const onRegister = path.startsWith('/studio/register');
        switch (state?.kind) {
            case 'claim_pending':
                if (onRegister) mountClaimScreen(state);
                else window.location.href = appUrl('/studio/register?reclamo=1');
                break;
            case 'claim_rejected':
            case 'claim_failed':
                // El registro conserva el wizard y muestra un aviso.
                if (!onRegister) window.location.href = appUrl('/studio/register?reclamo=1');
                break;
            case 'claimable':
            case 'registration_conflict':
                if (!onRegister) window.location.href = appUrl('/studio/register?complete=1&revisar=1');
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
                // En /studio/register un manager sin estudio propio puede registrar el suyo.
                const state = await resolveState(session, { includeManaged: !path.startsWith('/studio/register') });
                const studio = state.studio;
                if (studio) {
                    const showResult = path.startsWith('/studio/register') &&
                        (studio.mediaPending || new URLSearchParams(window.location.search).get('registered') === '1');
                    if (showResult) {
                        if (typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent('weotzi:studio-ready', { detail: studio }));
                    } else if (path.startsWith('/studio/login') && (studio.mediaPending ||
                        new URLSearchParams(window.location.search).get('confirmed') === '1')) {
                        window.location.href = appUrl('/studio/register?registered=1');
                    } else if (path.startsWith('/studio/login') || path.startsWith('/studio/register')) {
                        window.location.href = appUrl('/studio/dashboard');
                    }
                    return studio;
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
    // Estado del chequeo de carga de la página (lo inicia si no corrió).
    async function whenChecked() {
        if (!initialCheck) initialCheck = checkStudioAuthState();
        await initialCheck;
        return lastState;
    }
    // Devuelve el estudio, o null después de redirigir a un estado de reclamo o
    // conflicto. Lanza si no hay nada que retomar.
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
        const { data: { session }, error: sessionError } = await requireClient().auth.getSession();
        if (sessionError) throw sessionError;
        if (session) {
            if (session.user.email?.toLowerCase() !== email.trim().toLowerCase()) {
                throw new Error('Hay otra cuenta abierta. Cerrá esa sesión antes de registrar un correo diferente.');
            }
            return completeRegistration(draft, email);
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
        return completeRegistration(draft, email);
    }
    // Reclama una ficha sin dueño. Con sesión: lo envía ya. Sin sesión: el signUp
    // guarda el borrador (sin secretos) en user_metadata.studio_claim y
    // resolveState lo envía al confirmar el email. Resuelve con
    // {confirmationRequired, email} o con el estado claim_pending.
    async function claimStudio(payload) {
        await ready();
        const { email, password, studioId, studio, evidence, contactName, contactPhone, termsVersion } = payload || {};
        const cleanEvidence = String(evidence || '').trim();
        if (!studioId) throw new Error('Elegí el estudio que querés reclamar.');
        if (!cleanEvidence) throw new Error('Contanos cómo podemos verificar que el estudio es tuyo.');
        if (cleanEvidence.length > 1000) throw new Error('La evidencia admite hasta 1000 caracteres.');
        if (!termsVersion) throw new Error('Aceptá los Términos y la Política de Privacidad para reclamar el estudio.');
        const draft = {
            studio_id: studioId,
            evidence: cleanEvidence,
            contact_name: String(contactName || '').trim() || null,
            contact_phone: String(contactPhone || '').trim() || null,
            terms_version: termsVersion
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
    // ── acceso (ER-17): enlace mágico para estudios, igual que el de artistas.
    // shouldCreateUser:false → nunca crea cuentas. Vuelve a /studio/login con la
    // sesión y checkStudioAuthState lleva al panel. Devuelve { ok, message, kind }
    // con el mensaje neutro también si el email no tiene cuenta.
    async function sendStudioMagicLink(email) {
        await ready();
        const clean = String(email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(clean)) throw new Error('Escribí un email válido.');
        let error = null;
        try {
            const res = await requireClient().auth.signInWithOtp({
                email: clean,
                options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + appUrl('/studio/login') }
            });
            error = res && res.error;
        } catch (err) { error = err || new Error('network'); }
        const EC = window.WeotziEmailConfirm;
        if (EC?.magicLinkOutcome) {
            const out = EC.magicLinkOutcome(error, clean);
            // studio-login.js muestra texto plano (textContent): sin entidades HTML.
            return { ...out, message: out.ok ? 'Si ' + clean + ' tiene una cuenta, te enviamos un link de acceso. Revisá tu correo (también spam).' : out.message };
        }
        if (error && !/signups? not allowed|user not found|otp_disabled/i.test(String(error.message || ''))) {
            return { ok: false, kind: 'error', message: 'No pudimos enviar el link de acceso. Probá de nuevo en un momento.' };
        }
        return { ok: true, kind: 'success', message: 'Si ' + clean + ' tiene una cuenta, te enviamos un link de acceso. Revisá tu correo.' };
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
        sendMagicLink: sendStudioMagicLink, linkError: () => linkError,
        isRecovery: () => recoveryMode, ready, appUrl, logout,
        whenChecked, getState: () => lastState, presentState, claimScreenHtml,
        isClaimableError, isRegistrationConflict, isTermsError,
        getSupabase: () => client || requireClient(), getCurrent: () => currentStudioData,
        isManager: () => currentStudioData?.access === 'manager'
    };
    document.addEventListener('DOMContentLoaded', () => { if (!initialCheck) initialCheck = checkStudioAuthState(); });
})();
