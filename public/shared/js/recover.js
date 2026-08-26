// ============================================================================
// We Ötzi · /recover — recuperación de contraseña única (cliente + artista + beta)
// Flujo 100% Supabase Auth con la anon key (frames Figma 243:2530 → 243:2778):
//   1. Email  → auth.resetPasswordForEmail(email) sin redirectTo (manda código OTP).
//               Copy neutral anti-enumeración: nunca revelamos si el email existe.
//   2. Código → auth.verifyOtp({ email, token, type: 'recovery' }) — crea sesión.
//   3. Nueva contraseña → auth.updateUser({ password }) con validaciones en vivo.
//   4. Éxito  → WoPostAuthLoader según rol (artista → /artist/dashboard,
//               cliente → /client/dashboard, sin sesión → /inicio).
// UI: public/recover/index.html + public/shared/css/recover-ds.css.
// Datos: solo window.WeotziData.Artists (detección de rol). Sin fetch ad-hoc.
// ============================================================================
(function () {
    'use strict';

    const RESEND_SECONDS = 60; // rate limit de Supabase para reenvío de OTP

    const state = {
        email: '',
        step: 1,
        resendTimer: null,
        resendLeft: 0,
        verified: false
    };

    // ---------- Supabase ----------
    function sb() {
        return window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
            ? window.ConfigManager.getSupabaseClient()
            : null;
    }

    // ---------- Helpers de DOM ----------
    const $ = (id) => document.getElementById(id);

    function setError(id, message) {
        const el = $(id);
        if (!el) return;
        if (!message) {
            el.hidden = true;
            if (id !== 'rc-confirm-error') el.textContent = '';
            return;
        }
        if (id !== 'rc-confirm-error') el.textContent = message;
        el.hidden = false;
    }

    function setBusy(btn, busy, busyLabel) {
        if (!btn) return;
        if (busy) {
            btn.dataset.prevHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="wo-spinner" aria-hidden="true"></span><span class="btn-text">' + busyLabel + '</span>';
        } else if (btn.dataset.prevHtml) {
            btn.innerHTML = btn.dataset.prevHtml;
            delete btn.dataset.prevHtml;
        }
    }

    // ---------- Stepper + vistas ----------
    function renderStep(step) {
        state.step = step;
        const steps = document.querySelectorAll('#rc-steps .rc-step');
        steps.forEach((li) => {
            const n = Number(li.dataset.step);
            const box = li.querySelector('.box');
            li.classList.toggle('is-active', n === step);
            li.classList.toggle('is-done', n < step);
            box.innerHTML = n < step ? '<i data-wo-icon="check" aria-hidden="true"></i>' : String(n);
        });
        $('rc-steps').hidden = step > 3;

        $('rc-view-email').hidden = step !== 1;
        $('rc-view-code').hidden = step !== 2;
        $('rc-view-password').hidden = step !== 3;
        $('rc-view-success').hidden = step !== 4;

        if (window.WoIcons) window.WoIcons.hydrate(document);
    }

    // ---------- Paso 1 · Email ----------
    function emailIsValid(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
    }

    function refreshEmailGate() {
        const value = $('rc-email').value.trim();
        $('rc-email-submit').disabled = !emailIsValid(value);
    }

    async function sendCode(email) {
        const client = sb();
        if (!client) throw new Error('config');
        // Sin redirectTo: la plantilla debe incluir {{ .Token }} (código de 6 dígitos).
        const { error } = await client.auth.resetPasswordForEmail(email);
        if (error) {
            const msg = String(error.message || '').toLowerCase();
            // Rate limit: el código ya se pidió hace poco — avanzamos igual,
            // sin revelar nada (anti-enumeración).
            if (msg.includes('rate limit') || msg.includes('security purposes') || msg.includes('seconds')) return;
            throw error;
        }
    }

    async function handleEmailSubmit(e) {
        e.preventDefault();
        const email = $('rc-email').value.trim().toLowerCase();
        if (!emailIsValid(email)) return;

        const btn = $('rc-email-submit');
        setError('rc-email-error', '');
        setBusy(btn, true, 'Enviando…');
        try {
            await sendCode(email);
            state.email = email;
            $('rc-code-email').textContent = email;
            renderStep(2);
            clearOtp();
            startResendCountdown();
            focusFirstOtp();
        } catch (err) {
            console.error('Recover: error al pedir el código:', err);
            setError('rc-email-error', 'No pudimos procesar la solicitud. Probá de nuevo en un momento.');
        } finally {
            setBusy(btn, false);
            refreshEmailGate();
        }
    }

    // ---------- Countdown de reenvío ----------
    function formatCountdown(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    function startResendCountdown() {
        stopResendCountdown();
        state.resendLeft = RESEND_SECONDS;
        $('rc-resend-wait').hidden = false;
        $('rc-resend-btn').hidden = true;
        $('rc-resend-timer').textContent = formatCountdown(state.resendLeft);
        state.resendTimer = window.setInterval(() => {
            state.resendLeft -= 1;
            if (state.resendLeft <= 0) {
                stopResendCountdown();
                $('rc-resend-wait').hidden = true;
                $('rc-resend-btn').hidden = false;
                return;
            }
            $('rc-resend-timer').textContent = formatCountdown(state.resendLeft);
        }, 1000);
    }

    function stopResendCountdown() {
        if (state.resendTimer) {
            window.clearInterval(state.resendTimer);
            state.resendTimer = null;
        }
    }

    async function handleResend() {
        const btn = $('rc-resend-btn');
        btn.disabled = true;
        setError('rc-code-error', '');
        try {
            await sendCode(state.email);
        } catch (err) {
            console.error('Recover: error al reenviar el código:', err);
        } finally {
            btn.disabled = false;
        }
        clearOtp();
        startResendCountdown();
        focusFirstOtp();
    }

    // ---------- Paso 2 · OTP ----------
    function otpBoxes() {
        return Array.from(document.querySelectorAll('#rc-otp .rc-otp-box'));
    }

    function otpValue() {
        return otpBoxes().map((b) => b.value).join('');
    }

    function clearOtp() {
        otpBoxes().forEach((b) => { b.value = ''; });
        $('rc-otp').classList.remove('is-error');
        refreshCodeGate();
    }

    function focusFirstOtp() {
        const first = otpBoxes()[0];
        if (first) first.focus();
    }

    function refreshCodeGate() {
        $('rc-code-submit').disabled = !/^\d{6}$/.test(otpValue());
    }

    // Distribuye dígitos desde `index` (cubre tipeo, pegado y autofill one-time-code).
    function fillOtpFrom(index, digits) {
        const boxes = otpBoxes();
        let i = index;
        for (const d of digits) {
            if (i >= boxes.length) break;
            boxes[i].value = d;
            i += 1;
        }
        const next = Math.min(i, boxes.length - 1);
        boxes[next].focus();
    }

    function bindOtp() {
        const boxes = otpBoxes();
        boxes.forEach((box, index) => {
            box.addEventListener('input', () => {
                $('rc-otp').classList.remove('is-error');
                setError('rc-code-error', '');
                const digits = box.value.replace(/\D/g, '');
                box.value = '';
                if (digits) fillOtpFrom(index, digits.split(''));
                refreshCodeGate();
                if (/^\d{6}$/.test(otpValue())) $('rc-code-submit').focus();
            });
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !box.value && index > 0) {
                    e.preventDefault();
                    boxes[index - 1].value = '';
                    boxes[index - 1].focus();
                    refreshCodeGate();
                } else if (e.key === 'ArrowLeft' && index > 0) {
                    boxes[index - 1].focus();
                } else if (e.key === 'ArrowRight' && index < boxes.length - 1) {
                    boxes[index + 1].focus();
                }
            });
            box.addEventListener('paste', (e) => {
                e.preventDefault();
                const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
                if (digits) fillOtpFrom(0, digits.split(''));
                refreshCodeGate();
            });
        });
    }

    async function handleCodeSubmit(e) {
        e.preventDefault();
        const token = otpValue();
        if (!/^\d{6}$/.test(token)) return;

        const btn = $('rc-code-submit');
        setError('rc-code-error', '');
        setBusy(btn, true, 'Verificando…');
        try {
            const client = sb();
            if (!client) throw new Error('config');
            const { error } = await client.auth.verifyOtp({ email: state.email, token, type: 'recovery' });
            if (error) throw error;
            state.verified = true;
            renderStep(3);
            $('rc-password').focus();
        } catch (err) {
            console.error('Recover: error al verificar el código:', err);
            $('rc-otp').classList.add('is-error');
            setError('rc-code-error', 'Código inválido o vencido. Revisalo o pedí uno nuevo.');
        } finally {
            setBusy(btn, false);
            refreshCodeGate();
        }
    }

    // ---------- Paso 3 · Nueva contraseña ----------
    const REQS = {
        length: (v) => v.length >= 8,
        upper: (v) => /[A-ZÁÉÍÓÚÜÑ]/.test(v),
        number: (v) => /\d/.test(v),
        symbol: (v) => /[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ\s]/.test(v)
    };

    function refreshPasswordGate() {
        const value = $('rc-password').value;
        const confirm = $('rc-password-confirm').value;

        let met = 0;
        for (const [name, test] of Object.entries(REQS)) {
            const ok = test(value);
            if (ok) met += 1;
            const row = document.querySelector('#rc-reqs [data-req="' + name + '"]');
            if (row) row.classList.toggle('is-ok', ok);
        }

        const pct = met * 25;
        const wrap = $('rc-strength');
        const label = pct === 100 ? 'Fuerte' : (pct >= 50 ? 'Media' : 'Débil');
        $('rc-strength-fill').style.width = pct + '%';
        $('rc-strength-label').textContent = label + ' (' + pct + '%)';
        wrap.classList.toggle('is-weak', pct > 0 && pct < 50);
        wrap.classList.toggle('is-mid', pct >= 50 && pct < 100);
        wrap.classList.toggle('is-strong', pct === 100);

        const mismatch = Boolean(value) && Boolean(confirm) && value !== confirm;
        setError('rc-confirm-error', mismatch ? 'mismatch' : '');

        $('rc-password-submit').disabled = !(met === 4 && confirm && value === confirm);
    }

    async function handlePasswordSubmit(e) {
        e.preventDefault();
        const password = $('rc-password').value;
        const confirm = $('rc-password-confirm').value;
        if (password !== confirm) return;

        const btn = $('rc-password-submit');
        setError('rc-password-error', '');
        setBusy(btn, true, 'Actualizando…');
        try {
            const client = sb();
            if (!client) throw new Error('config');
            const { error } = await client.auth.updateUser({ password });
            if (error) {
                const msg = String(error.message || '').toLowerCase();
                if (msg.includes('different') || msg.includes('should be different')) {
                    throw Object.assign(new Error('same-password'), { friendly: 'Tiene que ser distinta a la que ya usabas.' });
                }
                if (msg.includes('session') || msg.includes('not logged in') || msg.includes('missing')) {
                    throw Object.assign(new Error('no-session'), { friendly: 'La sesión de verificación venció. Volvé a pedir el código.' });
                }
                throw error;
            }
            renderStep(4);
        } catch (err) {
            console.error('Recover: error al actualizar la contraseña:', err);
            setError('rc-password-error', err.friendly || 'No pudimos actualizar la contraseña. Probá de nuevo.');
        } finally {
            setBusy(btn, false);
            refreshPasswordGate();
        }
    }

    function bindEyeToggles() {
        document.querySelectorAll('.rc-eye').forEach((btn) => {
            btn.addEventListener('click', () => {
                const input = $(btn.dataset.eyeFor);
                if (!input) return;
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.setAttribute('aria-pressed', String(show));
                btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
                btn.innerHTML = '<i data-wo-icon="' + (show ? 'eye-off' : 'eye') + '" class="wo-icon-18" aria-hidden="true"></i>';
                if (window.WoIcons) window.WoIcons.hydrate(btn);
                input.focus();
            });
        });
    }

    // ---------- Paso 4 · Éxito → panel según rol ----------
    async function resolveDestination() {
        try {
            const client = sb();
            if (!client) return { role: 'default', url: '/inicio' };
            const { data: { session } } = await client.auth.getSession();
            if (!session) return { role: 'default', url: '/inicio' };

            if (window.WeotziData && window.WeotziData.Artists) {
                const { data: artist } = await window.WeotziData.Artists.getByUserId(session.user.id, 'user_id');
                if (artist) return { role: 'artist', url: '/artist/dashboard' };
            }
            return { role: 'client', url: '/client/dashboard' };
        } catch (err) {
            console.warn('Recover: no se pudo resolver el rol, vamos a /inicio:', err);
            return { role: 'default', url: '/inicio' };
        }
    }

    async function handleSuccessCta() {
        const btn = $('rc-success-cta');
        setBusy(btn, true, 'Un segundo…');
        const dest = await resolveDestination();
        if (window.WoPostAuthLoader) {
            window.WoPostAuthLoader.show({ role: dest.role, targetUrl: dest.url });
        } else {
            window.location.href = dest.url;
        }
    }

    // ---------- Arranque ----------
    function backToLoginUrl() {
        const from = new URLSearchParams(window.location.search).get('from');
        return from === 'artist' ? '/artist/login' : '/client/login';
    }

    function init() {
        // Prefill desde ?email= y link de retorno según origen (?from=artist|client).
        const params = new URLSearchParams(window.location.search);
        const prefill = (params.get('email') || '').trim();
        if (prefill) $('rc-email').value = prefill;
        $('rc-back-login').href = backToLoginUrl();

        $('rc-email').addEventListener('input', () => {
            setError('rc-email-error', '');
            refreshEmailGate();
        });
        $('rc-email-form').addEventListener('submit', handleEmailSubmit);

        bindOtp();
        $('rc-code-form').addEventListener('submit', handleCodeSubmit);
        $('rc-resend-btn').addEventListener('click', handleResend);
        $('rc-back-to-email').addEventListener('click', () => {
            stopResendCountdown();
            renderStep(1);
            refreshEmailGate();
            $('rc-email').focus();
        });

        $('rc-password').addEventListener('input', refreshPasswordGate);
        $('rc-password-confirm').addEventListener('input', refreshPasswordGate);
        $('rc-password-form').addEventListener('submit', handlePasswordSubmit);
        bindEyeToggles();

        $('rc-success-cta').addEventListener('click', handleSuccessCta);

        refreshEmailGate();
        renderStep(1);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
