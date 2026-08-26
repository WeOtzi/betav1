/**
 * WE OTZI - Centro de cuenta del cliente (/client/profile)
 * --------------------------------------------------------
 * Dos modos en la misma pagina:
 *  - Sin query param: centro de cuenta (sidebar Mi perfil / Seguridad /
 *    Notificaciones / Configuracion). Requiere sesion de cliente.
 *  - Con ?client= | ?u= | ?id=: perfil publico del cliente (comportamiento
 *    heredado de la pagina anterior: hero + resenas verificadas).
 *
 * Datos SOLO via window.WeotziData.* (clients-repo, account-repo). Auth y
 * Storage directos sobre el cliente supabase (regla de la capa de datos).
 */
(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';

    const SECTIONS = ['perfil', 'seguridad', 'notificaciones', 'configuracion'];
    const NOTIF_EVENTS = ['postulaciones', 'mensajes', 'cotizaciones'];

    let supa = null;
    let sessionUser = null;
    let currentClient = null;
    let savedPrefs = null;
    let pendingAvatarFile = null;
    const statusTimers = new WeakMap();

    document.addEventListener('DOMContentLoaded', init);

    function $(id) { return document.getElementById(id); }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function initials(name) {
        return String(name || 'C')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || '')
            .join('') || 'C';
    }

    function getSupa() {
        if (supa) return supa;
        supa = window.ConfigManager?.getSupabaseClient?.()
            || window._supabase
            || (window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null);
        if (supa && !window._supabase) window._supabase = supa;
        return supa;
    }

    function setStatus(el, text, isError) {
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
        const prev = statusTimers.get(el);
        if (prev) clearTimeout(prev);
        if (text && !isError) {
            statusTimers.set(el, setTimeout(() => { el.textContent = ''; }, 4000));
        }
    }

    function init() {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('client') || params.get('u') || params.get('id');
        if (ref) {
            initPublic(ref);
        } else {
            initAccount();
        }
    }

    // ========================================================================
    // Modo perfil publico (?client=alias) — heredado de la pagina anterior
    // ========================================================================

    async function initPublic(ref) {
        $('cpa-public-root').hidden = false;
        const msgEl = $('cpa-public-msg');

        if (!window.WeotziData?.ClientProfiles) {
            msgEl.textContent = 'No se pudo cargar el perfil · recargá la página';
            return;
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
        let query = window.WeotziData.ClientProfiles.select('*');
        query = isUuid ? query.eq('user_id', ref) : query.eq('public_username', ref.replace(/^@+/, ''));

        const { data: profile, error } = await query.maybeSingle();

        if (error || !profile) {
            msgEl.textContent = 'Cliente no encontrado o perfil no público';
            return;
        }

        const name = profile.public_username || 'Cliente';
        document.title = `@${name} · We Ötzi`;
        $('cpa-public-name').textContent = `@${name}`;
        $('cpa-public-meta').textContent = [profile.country, profile.city_residence].filter(Boolean).join(' · ') || 'País no indicado';

        const avatarEl = $('cpa-public-avatar');
        avatarEl.innerHTML = profile.profile_picture
            ? `<img src="${escapeHtml(profile.profile_picture)}" alt="">`
            : `<span>${escapeHtml(initials(name))}</span>`;

        msgEl.hidden = true;
        $('cpa-public-hero').hidden = false;

        if (window.WeOtziReviews) {
            window.WeOtziReviews.renderPublicReviews({
                mount: 'client-reviews',
                revieweeType: 'client',
                revieweeId: profile.user_id,
                title: 'Reseñas del cliente'
            });
        }
    }

    // ========================================================================
    // Modo centro de cuenta
    // ========================================================================

    async function initAccount() {
        $('cpa-account').hidden = false;
        applyHash();
        window.addEventListener('hashchange', applyHash);

        const client = getSupa();
        if (!client || !window.WeotziData?.Clients) {
            console.error('[client-profile] falta supabase o la capa de datos');
            return;
        }

        const { data: { session } } = await client.auth.getSession();
        if (!session) {
            window.location.href = '/client/login';
            return;
        }
        sessionUser = session.user;

        const { data: row, error } = await window.WeotziData.Clients.getByUserId(sessionUser.id);
        if (error || !row) {
            // El dashboard es quien crea la fila del cliente (alta OAuth, etc.).
            window.location.href = '/client/dashboard';
            return;
        }
        currentClient = row;

        fillProfileForm();
        renderTopbarTile();
        wireAccountEvents();
        await loadPrefs();
    }

    // ---------- Router por hash (sidebar + paneles) ----------

    function applyHash() {
        let section = (window.location.hash || '#perfil').replace('#', '');
        if (!SECTIONS.includes(section)) section = 'perfil';

        document.querySelectorAll('[data-panel]').forEach((panel) => {
            panel.hidden = panel.getAttribute('data-panel') !== section;
        });
        document.querySelectorAll('.cpa-side-item').forEach((item) => {
            const active = item.getAttribute('data-section') === section;
            item.classList.toggle('is-active', active);
            if (active) item.setAttribute('aria-current', 'true');
            else item.removeAttribute('aria-current');
        });
    }

    // ---------- Mi perfil ----------

    function fillProfileForm() {
        $('cpa-full-name').value = currentClient.full_name || '';
        $('cpa-username').value = currentClient.public_username || '';
        $('cpa-email').value = sessionUser.email || currentClient.email || '';
        $('cpa-whatsapp').value = currentClient.whatsapp || '';
        $('cpa-city').value = currentClient.city_residence || '';
        $('cpa-country').value = currentClient.country || '';
        renderAvatarPreview(currentClient.profile_picture || null);
    }

    function renderAvatarPreview(src) {
        const el = $('cpa-avatar-preview');
        if (src) {
            el.innerHTML = `<img src="${escapeHtml(src)}" alt="">`;
        } else {
            el.innerHTML = `<span>${escapeHtml(initials(currentClient.full_name || currentClient.email))}</span>`;
        }
    }

    function renderTopbarTile() {
        const tile = $('cpa-topbar-avatar');
        if (currentClient.profile_picture) {
            tile.innerHTML = `<img src="${escapeHtml(currentClient.profile_picture)}" alt="">`;
        } else {
            tile.textContent = 'Ö';
        }
    }

    function normalizePublicUsername(value) {
        return String(value || '')
            .trim()
            .replace(/^@+/, '')
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9._-]/g, '')
            .slice(0, 40);
    }

    function handleAvatarPick(event) {
        const file = event.target.files && event.target.files[0];
        const statusEl = $('cpa-profile-status');
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setStatus(statusEl, 'Elegí una imagen JPG o PNG', true);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setStatus(statusEl, 'La imagen supera los 5 MB', true);
            return;
        }
        pendingAvatarFile = file;
        setStatus(statusEl, '');
        const reader = new FileReader();
        reader.onload = (e) => {
            $('cpa-avatar-preview').innerHTML = `<img src="${e.target.result}" alt="">`;
        };
        reader.readAsDataURL(file);
    }

    async function uploadPendingAvatar() {
        if (!pendingAvatarFile) return currentClient.profile_picture || null;
        const client = getSupa();
        const ext = (pendingAvatarFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${sessionUser.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await client.storage
            .from('profile-pictures')
            .upload(path, pendingAvatarFile, { cacheControl: '3600', upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = client.storage.from('profile-pictures').getPublicUrl(path);
        return urlData.publicUrl;
    }

    async function handleProfileSave(event) {
        event.preventDefault();
        const btn = $('cpa-profile-save');
        const statusEl = $('cpa-profile-status');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        setStatus(statusEl, '');

        try {
            const fullName = $('cpa-full-name').value.trim();
            const publicUsername = normalizePublicUsername($('cpa-username').value);
            const country = $('cpa-country').value.trim();
            const whatsapp = $('cpa-whatsapp').value.trim();
            const city = $('cpa-city').value.trim();

            let profilePictureUrl = currentClient.profile_picture || null;
            try {
                profilePictureUrl = await uploadPendingAvatar();
            } catch (uploadError) {
                console.error('[client-profile] error subiendo la foto:', uploadError);
                setStatus(statusEl, 'No se pudo subir la foto · probá con otra imagen', true);
                return;
            }

            // Mismas columnas de clients_db que guardaba el modal del dashboard.
            const updateData = {
                full_name: fullName || currentClient.full_name,
                public_username: publicUsername || null,
                country: country || null,
                public_profile_enabled: true,
                whatsapp: whatsapp || null,
                city_residence: city || null
            };
            if ((fullName || currentClient.full_name) && publicUsername && country) {
                updateData.profile_completed_at = currentClient.profile_completed_at || new Date().toISOString();
            }
            if (profilePictureUrl) {
                updateData.profile_picture = profilePictureUrl;
            }

            const { error: updateError } = await window.WeotziData.Clients.updateByUserId(sessionUser.id, updateData);
            if (updateError) throw updateError;

            currentClient = { ...currentClient, ...updateData };
            pendingAvatarFile = null;
            renderAvatarPreview(currentClient.profile_picture || null);
            renderTopbarTile();
            setStatus(statusEl, 'Cambios guardados');
        } catch (error) {
            console.error('[client-profile] error guardando el perfil:', error);
            setStatus(statusEl, 'No se pudieron guardar los cambios · probá de nuevo', true);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    // ---------- Seguridad ----------

    async function handlePasswordSave(event) {
        event.preventDefault();
        const btn = $('cpa-password-save');
        const statusEl = $('cpa-password-status');
        const passNew = $('cpa-pass-new').value;
        const passRepeat = $('cpa-pass-repeat').value;

        if (passNew.length < 8) {
            setStatus(statusEl, 'La contraseña tiene que tener al menos 8 caracteres', true);
            return;
        }
        if (passNew !== passRepeat) {
            setStatus(statusEl, 'Las contraseñas no coinciden', true);
            return;
        }

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Actualizando…';
        setStatus(statusEl, '');

        try {
            const { error } = await getSupa().auth.updateUser({ password: passNew });
            if (error) throw error;
            $('cpa-pass-new').value = '';
            $('cpa-pass-repeat').value = '';
            setStatus(statusEl, 'Contraseña actualizada');
        } catch (error) {
            console.error('[client-profile] error actualizando contraseña:', error);
            const msg = /different from the old/i.test(error?.message || '')
                ? 'La nueva contraseña tiene que ser distinta de la actual'
                : 'No se pudo actualizar la contraseña · probá de nuevo';
            setStatus(statusEl, msg, true);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    // ---------- Preferencias (Notificaciones + Configuración) ----------

    async function loadPrefs() {
        if (!window.WeotziData?.Prefs) return;
        try {
            savedPrefs = await window.WeotziData.Prefs.get(sessionUser.id);
        } catch (error) {
            console.error('[client-profile] error cargando preferencias:', error);
            savedPrefs = null;
        }

        const notif = savedPrefs?.notification_prefs || {};
        NOTIF_EVENTS.forEach((eventKey) => {
            const input = document.querySelector(`input[data-notif="${eventKey}"]`);
            if (!input) return;
            const saved = notif[eventKey];
            // Default sin preferencia guardada: email activado.
            input.checked = saved ? saved.email !== false : true;
        });

        const app = savedPrefs?.app_settings || {};
        const tzSelect = $('cpa-timezone');
        if (app.timezone) {
            if (![...tzSelect.options].some((o) => o.value === app.timezone)) {
                const opt = document.createElement('option');
                opt.value = app.timezone;
                opt.textContent = app.timezone;
                tzSelect.appendChild(opt);
            }
            tzSelect.value = app.timezone;
        } else {
            // Sugerencia local sin persistir (se guarda recién al cambiar).
            const guess = Intl.DateTimeFormat().resolvedOptions?.().timeZone;
            if (guess && [...tzSelect.options].some((o) => o.value === guess)) {
                tzSelect.value = guess;
            }
        }
        if (app.date_format) {
            $('cpa-dateformat').value = app.date_format;
        }
    }

    async function saveNotifPrefs() {
        const statusEl = $('cpa-notif-status');
        const value = {};
        const prev = savedPrefs?.notification_prefs || {};
        NOTIF_EVENTS.forEach((eventKey) => {
            const input = document.querySelector(`input[data-notif="${eventKey}"]`);
            value[eventKey] = {
                email: input ? !!input.checked : true,
                push: prev[eventKey]?.push === true
            };
        });
        try {
            savedPrefs = await window.WeotziData.Prefs.saveSection(sessionUser.id, 'notification_prefs', value) || savedPrefs;
            setStatus(statusEl, 'Guardado');
        } catch (error) {
            console.error('[client-profile] error guardando notificaciones:', error);
            setStatus(statusEl, 'No se pudo guardar · probá de nuevo', true);
        }
    }

    async function saveAppSettings() {
        const statusEl = $('cpa-settings-status');
        const value = {
            timezone: $('cpa-timezone').value || null,
            date_format: $('cpa-dateformat').value || null
        };
        try {
            savedPrefs = await window.WeotziData.Prefs.saveSection(sessionUser.id, 'app_settings', value) || savedPrefs;
            setStatus(statusEl, 'Guardado');
        } catch (error) {
            console.error('[client-profile] error guardando configuración:', error);
            setStatus(statusEl, 'No se pudo guardar · probá de nuevo', true);
        }
    }

    // ---------- Wiring ----------

    function wireAccountEvents() {
        $('cpa-profile-form').addEventListener('submit', handleProfileSave);
        $('cpa-avatar-btn').addEventListener('click', () => $('cpa-avatar-input').click());
        $('cpa-avatar-input').addEventListener('change', handleAvatarPick);

        $('cpa-password-form').addEventListener('submit', handlePasswordSave);

        document.querySelectorAll('input[data-notif]').forEach((input) => {
            input.addEventListener('change', saveNotifPrefs);
        });

        $('cpa-timezone').addEventListener('change', saveAppSettings);
        $('cpa-dateformat').addEventListener('change', saveAppSettings);

        $('cpa-logout').addEventListener('click', async () => {
            try {
                await getSupa().auth.signOut();
            } catch (error) {
                console.error('[client-profile] error cerrando sesión:', error);
            }
            window.location.href = '/client/login';
        });
    }
})();
