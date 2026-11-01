// Studio access UI shares the artist design system; identity stays in studio-auth.js.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const auth = window.WeOtziStudioAuth;
    const form = $('studio-login-form');
    const recoveryForm = $('studio-recovery-form');
    const codeFields = $('studio-recovery-code-fields');
    const status = $('login-status');
    const idleContent = new WeakMap();
    let busy = false;

    function showStatus(kind, message, focus) {
        status.className = 'studio-status studio-status-' + kind;
        status.textContent = message;
        status.hidden = false;
        if (focus) status.focus();
    }
    function clearStatus() {
        status.hidden = true;
        document.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute('aria-invalid'));
    }
    function setBusy(button, loading) {
        busy = !!loading;
        form.setAttribute('aria-busy', String(busy));
        recoveryForm.setAttribute('aria-busy', String(busy));
        document.querySelectorAll('form input, form button, .studio-login-help button').forEach(control => { control.disabled = busy; });
        if (busy) {
            idleContent.set(button, Array.from(button.childNodes).map(node => node.cloneNode(true)));
            button.setAttribute('aria-busy', 'true');
            button.textContent = loading;
        } else {
            button.removeAttribute('aria-busy');
            button.replaceChildren(...(idleContent.get(button) || []));
        }
    }
    function showRecovery(withCode, email) {
        clearStatus();
        form.hidden = true;
        recoveryForm.hidden = false;
        codeFields.hidden = !withCode;
        $('recovery-email').required = withCode;
        $('recovery-code').required = withCode;
        if (withCode) $('recovery-email').value = email || '';
        $('studio-login-title').textContent = withCode ? 'Recuperar acceso' : 'Nueva contraseña';
        $('studio-login-copy').textContent = withCode
            ? 'Ingresá el código recibido por correo y elegí una contraseña nueva.'
            : 'Elegí una contraseña nueva para recuperar el acceso a tu estudio.';
        $('poster-login').hidden = true;
        $('poster-recovery').hidden = false;
        $('studio-back-to-login').hidden = false;
        $('have-recovery-code').hidden = true;
        $('forgot-password-link').hidden = !withCode;
        (withCode ? (email ? $('recovery-code') : $('recovery-email')) : $('recovery-password')).focus();
    }
    function showLogin() {
        if (busy) return;
        clearStatus();
        recoveryForm.reset();
        $('recovery-confirm').setCustomValidity('');
        recoveryForm.hidden = true;
        form.hidden = false;
        $('poster-login').hidden = false;
        $('poster-recovery').hidden = true;
        $('studio-login-title').textContent = 'Bienvenido de vuelta';
        $('studio-login-copy').textContent = 'Ingresá para gestionar tu estudio.';
        $('studio-back-to-login').hidden = true;
        $('have-recovery-code').hidden = false;
        $('forgot-password-link').hidden = false;
        $('login-email').focus();
    }
    document.querySelectorAll('form input').forEach(input => {
        input.addEventListener('input', () => {
            input.removeAttribute('aria-invalid');
            if (input.id === 'recovery-password' || input.id === 'recovery-confirm') $('recovery-confirm').setCustomValidity('');
        });
        input.addEventListener('invalid', () => input.setAttribute('aria-invalid', 'true'));
    });
    $('have-recovery-code').addEventListener('click', () => {
        if (!busy) showRecovery(true, $('login-email').value.trim());
    });
    $('studio-back-to-login').addEventListener('click', showLogin);

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        clearStatus();
        if (!form.reportValidity()) return;
        const email = $('login-email').value.trim();
        const password = $('login-password').value;
        const button = $('login-submit');
        setBusy(button, 'Accediendo…');
        try {
            const studio = await auth.login(email, password);
            showStatus('success', 'Acceso correcto. Redirigiendo…');
            const showRegistration = studio.mediaPending || new URLSearchParams(window.location.search).get('confirmed') === '1';
            window.location.href = auth.appUrl(showRegistration ? '/studio/register?registered=1' : '/studio/dashboard');
        } catch (error) {
            const message = /invalid login credentials/i.test(error?.message || '')
                ? 'El email o la contraseña no son correctos. Revisá tus datos e intentá nuevamente.'
                : error?.message || 'No pudimos iniciar sesión. Revisá tus datos.';
            showStatus('error', message, true);
            setBusy(button, false);
        }
    });
    recoveryForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        clearStatus();
        const password = $('recovery-password').value;
        const confirm = $('recovery-confirm');
        confirm.setCustomValidity(password === confirm.value ? '' : 'Las contraseñas no coinciden.');
        if (!recoveryForm.reportValidity()) return;
        const email = $('recovery-email').value;
        const code = $('recovery-code').value;
        const button = $('recovery-submit');
        setBusy(button, 'Guardando contraseña…');
        try {
            if (!codeFields.hidden) {
                await auth.verifyRecoveryCode(email, code);
                codeFields.hidden = true;
                $('recovery-email').required = false;
                $('recovery-code').required = false;
            }
            await auth.changePassword(password);
            recoveryForm.reset();
            showStatus('success', 'Contraseña actualizada. Entrando al panel…');
            window.location.replace(auth.appUrl('/studio/dashboard'));
        } catch (error) {
            showStatus('error', error?.message || 'No pudimos actualizar la contraseña.', true);
            setBusy(button, false);
        }
    });
    $('forgot-password-link').addEventListener('click', async () => {
        if (busy) return;
        clearStatus();
        const emailInput = recoveryForm.hidden ? $('login-email') : $('recovery-email');
        if (!emailInput.reportValidity()) return;
        const email = emailInput.value.trim();
        const button = $('forgot-password-link');
        setBusy(button, 'Enviando correo…');
        try {
            await auth.requestPasswordReset(email);
            showRecovery(true, email);
            showStatus('success', 'Revisá tu correo. Ingresá el código recibido o abrí el enlace para elegir una contraseña nueva.');
        } catch (error) {
            showStatus('error', error?.message || 'No pudimos enviar el email.', true);
        } finally { setBusy(button, false); }
    });
    // Keep links correct both at /beta and at a branch preview prefix.
    const prefix = auth.appUrl('/');
    document.querySelectorAll('a[href^="/"]').forEach(link => {
        const href = link.getAttribute('href');
        if (prefix !== '/' && !href.startsWith(prefix)) link.setAttribute('href', auth.appUrl(href));
    });
    if (auth.isRecovery()) showRecovery(false);
})();
