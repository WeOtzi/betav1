// Page-only presentation actions. Authentication stays in client-auth.js.
function handleClientSocialUnavailable(provider) {
    const notice = document.getElementById('social-access-notice');
    const message = document.getElementById('social-access-message');
    if (!notice || !message) return;
    message.textContent = `El acceso con ${provider} todavía no está disponible. Ingresá con tu email o continuá con Google.`;
    notice.hidden = false;
}

function focusClientEmailLogin() {
    const notice = document.getElementById('social-access-notice');
    if (notice) notice.hidden = true;
    document.getElementById('login-email')?.focus();
}
