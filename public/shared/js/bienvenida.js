/**
 * WE OTZI - /bienvenida · selección de rol (rediseño Bauhaus 2026)
 * ----------------------------------------------------------------
 * Figma 238:2335 (= 205:666): "¿Cómo querés usar We Ötzi?" — dos cards
 * radio (cliente / artista) + CONTINUAR.
 *
 * Comportamiento al continuar:
 *  - Sin sesión  → cliente: /client/register · artista: /registerclosedbeta
 *  - Con sesión  → cliente: loader post-auth → /client/dashboard
 *                → artista: si tiene perfil en artists_db, loader → /artist/dashboard;
 *                  si no, /register-artist
 * La elección se guarda en localStorage ('wo-role-choice') y se preselecciona
 * al volver.
 *
 * Datos: solo via window.WeotziData.* (capa PostgREST). Auth directo via
 * window.ConfigManager.getSupabaseClient().auth.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'wo-role-choice';
    var ROUTES = {
        client: { register: '/client/register', dashboard: '/client/dashboard' },
        artist: { register: '/registerclosedbeta', dashboard: '/artist/dashboard', onboarding: '/register-artist' },
    };

    var busy = false;

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function readStoredRole() {
        try {
            var v = window.localStorage.getItem(STORAGE_KEY);
            return (v === 'client' || v === 'artist') ? v : null;
        } catch (e) { return null; }
    }

    function storeRole(role) {
        try { window.localStorage.setItem(STORAGE_KEY, role); } catch (e) { /* modo privado */ }
    }

    function selectedRole() {
        var input = $('.bnv-card-input:checked');
        return input ? input.value : null;
    }

    function syncSelection() {
        var role = selectedRole();
        $$('.bnv-card').forEach(function (card) {
            var isSelected = card.getAttribute('data-role') === role;
            card.classList.toggle('is-selected', isSelected);
        });
        var continueBtn = $('#bnv-continue');
        if (continueBtn && !busy) continueBtn.disabled = !role;
    }

    function setRole(role) {
        var input = $('#bnv-role-' + role);
        if (input && !input.checked) input.checked = true;
        syncSelection();
    }

    function setBusy(state) {
        busy = state;
        var continueBtn = $('#bnv-continue');
        if (continueBtn) {
            continueBtn.disabled = state || !selectedRole();
            continueBtn.setAttribute('aria-busy', state ? 'true' : 'false');
        }
        $$('.bnv-card-go').forEach(function (btn) { btn.disabled = state; });
    }

    async function getSession() {
        try {
            if (window.ConfigManager && typeof window.ConfigManager.ready === 'function') {
                await window.ConfigManager.ready();
            }
            var client = window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
                ? window.ConfigManager.getSupabaseClient()
                : null;
            if (!client) return null;
            var res = await client.auth.getSession();
            return (res && res.data && res.data.session) || null;
        } catch (e) {
            return null;
        }
    }

    async function artistHasProfile(userId) {
        try {
            if (!window.WeotziData || !window.WeotziData.Artists) return false;
            var res = await window.WeotziData.Artists.getByUserId(userId, 'user_id');
            return !!(res && res.data);
        } catch (e) {
            return false;
        }
    }

    function go(url) { window.location.href = url; }

    function goWithLoader(role, targetUrl) {
        if (window.WoPostAuthLoader && typeof window.WoPostAuthLoader.show === 'function') {
            window.WoPostAuthLoader.show({ role: role, targetUrl: targetUrl });
        } else {
            go(targetUrl);
        }
    }

    async function proceed() {
        var role = selectedRole();
        if (!role || busy) return;
        storeRole(role);
        setBusy(true);

        var session = await getSession();

        if (!session) {
            go(ROUTES[role].register);
            return;
        }

        if (role === 'client') {
            goWithLoader('client', ROUTES.client.dashboard);
            return;
        }

        // Artista con sesión: panel si ya tiene perfil, onboarding si no.
        var hasProfile = await artistHasProfile(session.user && session.user.id);
        if (hasProfile) {
            goWithLoader('artist', ROUTES.artist.dashboard);
        } else {
            go(ROUTES.artist.onboarding);
        }
    }

    function init() {
        // Preselección desde la visita anterior
        var stored = readStoredRole();
        if (stored) setRole(stored);
        else syncSelection();

        $$('.bnv-card-input').forEach(function (input) {
            input.addEventListener('change', syncSelection);
        });

        // Atajos "Continuar como … →": seleccionan y avanzan en un click
        $$('.bnv-card-go').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setRole(btn.getAttribute('data-role'));
                proceed();
            });
        });

        var continueBtn = $('#bnv-continue');
        if (continueBtn) continueBtn.addEventListener('click', proceed);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
