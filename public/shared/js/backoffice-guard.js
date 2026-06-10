// Backoffice access guard. Runs early on /backoffice/ to ensure the visitor
// is authenticated as the single hardcoded superadmin account. If not,
// redirects to /backoffice/login with a ?redirect= back to the original URL.
//
// Loaded after config-manager.js (so window.CONFIG is available) and before
// admin.js (so admin code never runs unauthenticated).

(function backofficeGuard() {
    const SUPERADMIN_EMAIL = 'isai@weotzi.com';

    function isSuperadminEmail(email) {
        return typeof email === 'string' && email.toLowerCase() === SUPERADMIN_EMAIL;
    }

    function redirectToLogin(reason) {
        const here = window.location.pathname + window.location.search + window.location.hash;
        const redirect = encodeURIComponent(here || '/backoffice/');
        const url = `/backoffice/login?redirect=${redirect}`;
        if (reason) console.warn('[backoffice-guard]', reason, '— redirecting to login');
        window.location.replace(url);
    }

    // Fallbacks mirror those used by backoffice-login.js so the guard works even
    // before config-manager.js finishes its async init() and populates window.CONFIG.
    const FALLBACK_URL = 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';

    async function check() {
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            console.error('[backoffice-guard] Supabase SDK not loaded');
            return;
        }

        const url = window.CONFIG?.supabase?.url || FALLBACK_URL;
        const key = window.CONFIG?.supabase?.anonKey || FALLBACK_ANON;

        const client = window._supabase = window._supabase || supabase.createClient(url, key);
        // Cache for downstream consumers (admin.js calls ConfigManager.getSupabaseClient()
        // which now reuses window._supabase too).
        window.__backofficeGuardClient = client;

        try {
            const { data, error } = await client.auth.getSession();
            if (error) return redirectToLogin('Session error: ' + error.message);
            const session = data && data.session;
            if (!session) return redirectToLogin('No active session');
            if (!isSuperadminEmail(session.user?.email)) {
                // Authenticated as a non-admin email — sign out and bounce to login.
                await client.auth.signOut().catch(() => {});
                return redirectToLogin('Email is not the superadmin account');
            }
            // Auth OK — keep the session in localStorage and let admin.js take over.
        } catch (err) {
            redirectToLogin('Guard exception: ' + err.message);
        }
    }

    check();
})();
