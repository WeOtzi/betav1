// ============================================
// Studio Authentication Module
// Mirrors client-auth.js. Studios authenticate via Supabase Auth and have a
// row in `studios` linked by user_id. RLS enforces studio ownership on all
// /studio/* writes.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url
        || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';

    // Reuse the same global supabase client name as the rest of the app.
    if (!window._supabase) {
        window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    }
    const _supabase = window._supabase;

    let currentStudioData = null;

    // -------------------------------------------------------------
    // Auth state
    // -------------------------------------------------------------
    async function checkStudioAuthState() {
        const currentPath = window.location.pathname;

        try {
            const { data: { session } } = await _supabase.auth.getSession();

            if (!session) {
                // No session: dashboard is protected, login/register are public.
                if (currentPath.startsWith('/studio/dashboard')) {
                    window.location.href = '/studio/login';
                }
                return null;
            }

            // Look for the studio row owned by this user.
            const { data: studio } = await WeotziData.Studios.getByUserId(session.user.id);

            if (studio) {
                currentStudioData = studio;
                window.currentStudioData = studio;
                // If on login/register, kick them to the dashboard.
                if (currentPath.startsWith('/studio/login')
                    || currentPath.startsWith('/studio/register')) {
                    window.location.href = '/studio/dashboard';
                    return null;
                }
                return studio;
            }

            // Logged in but NOT a studio: don't hijack — they may be an
            // artist or client. Just redirect away from /studio/dashboard if
            // they happen to land there.
            if (currentPath.startsWith('/studio/dashboard')) {
                // Not a studio account; bounce to home.
                window.location.href = '/';
            }
            return null;
        } catch (err) {
            console.error('[studio-auth] state check failed:', err);
            return null;
        }
    }

    // -------------------------------------------------------------
    // Login
    // -------------------------------------------------------------
    async function loginStudio(email, password) {
        const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Ensure they have a studio row; otherwise this session belongs to a
        // different role and we shouldn't pretend it's a studio login.
        const { data: studio, error: studioErr } = await WeotziData.Studios.getByUserId(data.session.user.id, 'id, user_id, name, slug, profile_complete');
        if (studioErr) throw studioErr;
        if (!studio) {
            await _supabase.auth.signOut();
            throw new Error('Esta cuenta no es de un estudio. Si querés registrar tu estudio, andá a /studio/register.');
        }

        currentStudioData = studio;
        window.currentStudioData = studio;
        return studio;
    }

    // -------------------------------------------------------------
    // Register: 1) create the auth user, 2) insert the studios row.
    //
    // The wizard collects the full payload then calls registerStudio() at
    // the end. This function does not handle locations/photos — those go
    // into separate inserts after the studios row exists (so we have an id
    // to FK against).
    // -------------------------------------------------------------
    async function registerStudio(payload) {
        const { email, password, name, ...studioFields } = payload || {};
        if (!email || !password || !name) {
            throw new Error('Faltan campos obligatorios: email, password, name.');
        }

        // 1) Create the auth user.
        const { data: signUp, error: signErr } = await _supabase.auth.signUp({
            email, password,
            options: { data: { user_type: 'studio' } }
        });
        if (signErr) throw signErr;
        const userId = signUp?.user?.id;
        if (!userId) throw new Error('Supabase no devolvió un user.id tras signUp.');

        // 2) Compute slug from name.
        const slug = String(name).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const normalized = String(name).trim().toUpperCase();

        // 3) Insert the studios row. RLS allows it because user_id == auth.uid().
        const { data: studio, error: insertErr } = await WeotziData.Studios.create({
                user_id:        userId,
                email:          email,
                name:           name.trim(),
                normalized_name: normalized,
                slug:           slug,
                tagline:        studioFields.tagline || null,
                bio:            studioFields.bio || null,
                founded_year:   studioFields.founded_year || null,
                languages:      studioFields.languages || [],
                instagram:      studioFields.instagram || null,
                tiktok:         studioFields.tiktok || null,
                whatsapp:       studioFields.whatsapp || null,
                contact_phone:  studioFields.contact_phone || null,
                cover_image:    studioFields.cover_image || null,
                logo_image:     studioFields.logo_image || null,
                photo_feed_items: studioFields.photo_feed_items || [],
                is_active:      true,
                profile_complete: false
            });

        if (insertErr) {
            // If the studios insert fails the auth user is now orphaned.
            // We log it; cleanup is a manual support task. (Same risk as
            // the artist register flow.)
            console.error('[studio-auth] studios insert failed; auth user orphaned', insertErr);
            throw insertErr;
        }

        currentStudioData = studio;
        window.currentStudioData = studio;
        return studio;
    }

    async function logoutStudio() {
        await _supabase.auth.signOut();
        window.location.href = '/';
    }

    async function requestStudioPasswordReset(email) {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/studio/login'
        });
        if (error) throw error;
        return true;
    }

    // -------------------------------------------------------------
    // Public API on window
    // -------------------------------------------------------------
    window.WeOtziStudioAuth = {
        check: checkStudioAuthState,
        login: loginStudio,
        register: registerStudio,
        logout: logoutStudio,
        requestPasswordReset: requestStudioPasswordReset,
        getSupabase: () => _supabase,
        getCurrent: () => currentStudioData
    };

    // Run state check on page load (parallels client-auth.js behavior).
    document.addEventListener('DOMContentLoaded', () => {
        checkStudioAuthState();
    });
})();
