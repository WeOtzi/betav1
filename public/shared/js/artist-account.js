// ============================================
// Centro de la cuenta del artista (/artist/account) — DS Bauhaus
// Refs Figma: 156:10014 Mi Perfil · 156:10807 Portafolio · 156:11993 Cobros
// · 156:12247 Disponibilidad · 158:13029 Notificaciones · 158:13480 Seguridad
// y Privacidad · 161:14150 Integraciones · 161:14507 Verificación ·
// 162:15088 Configuración.
// SPA por secciones con ruteo por hash (#perfil … #configuracion).
// Datos: SOLO via window.WeotziData.* (artists/quotations/account repos);
// auth y storage directo sobre el cliente supabase-js.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;
    const D = window.WeotziData;

    const SECTIONS = ['perfil', 'portafolio', 'cobros', 'disponibilidad', 'notificaciones',
        'seguridad', 'integraciones', 'verificacion', 'configuracion'];

    const LANGS = ['Español', 'Inglés', 'Portugués', 'Francés', 'Italiano', 'Alemán'];

    // Evento → defaults Email / Push / SMS (ref 158:13029).
    const NOTIF_EVENTS = [
        ['mensajes', 'Mensajes', true, true, false],
        ['cotizaciones', 'Cotizaciones', true, true, true],
        ['invitaciones', 'Invitaciones', true, true, false],
        ['spots', 'Spots', true, false, false],
        ['job_board', 'Job board', false, true, false],
        ['calendario', 'Calendario', true, true, false],
        ['promociones', 'Promociones', false, false, false]
    ];

    const PRIVACY_ROWS = [
        ['show_city', 'Mostrar ciudad en mi perfil público', 'Los clientes ven tu ciudad aproximada al buscar artistas.', true],
        ['show_rating', 'Mostrar mi calificación', 'Tu puntaje promedio es visible en el Job board y Spots.', true],
        ['show_socials', 'Mostrar redes sociales', 'Instagram, TikTok y sitio web visibles en tu perfil.', true],
        ['allow_search_indexing', 'Aparecer en buscadores externos', 'Permitir que Google indexe tu perfil público.', false]
    ];

    const DAYS = [
        ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'],
        ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo']
    ];
    const WORKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

    const DOC_TYPES = [
        ['identidad', 'Documento de identidad'],
        ['bioseguridad', 'Certificado de bioseguridad'],
        ['domicilio', 'Comprobante de domicilio']
    ];

    const TIMEZONES = [
        'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago',
        'America/Sao_Paulo', 'America/Bogota', 'America/Lima', 'America/Mexico_City',
        'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/Lisbon',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome'
    ];

    const MIN_WORK_SLOTS = 8;

    const INTEGRATIONS = {
        google_calendar: { label: 'Google Calendar', scopes: ['calendar.readonly'] },
        apple_calendar: { label: 'Apple Calendar', scopes: ['calendar.readonly'] },
        instagram: { label: 'Instagram', scopes: ['portfolio.import'] },
        stripe: { label: 'Stripe', scopes: ['payments.read'] },
        whatsapp_business: { label: 'WhatsApp Business', scopes: ['messages.notify'] }
    };

    const DEFAULT_APP_SETTINGS = {
        timezone: 'America/Argentina/Buenos_Aires', date_format: 'DD/MM/AAAA', time_format: '24h',
        language: 'es', theme: 'system', density: 'comfortable', text_size: 'medium', animations: true,
        start_page: 'dashboard', confirm_logout: true, reduce_motion: false, high_contrast: false,
        interface_scale: '100', display_name: 'artistic', page_size: '25', default_sort: 'recent'
    };

    let user = null;
    let artist = null;
    let prefs = null;          // fila de user_preferences (o null)
    let works = [];            // gallery_feed_items normalizados
    let weekly = [];           // [{day, enabled, start, end}]
    let notifMatrix = {};      // {evento: {email, push}}
    let verifAvailable = false;
    let verifDocs = [];
    let paymentMethods = [];
    let financialEntries = [];
    let integrations = [];
    let integrationsAvailable = false;
    let currentSessionId = null;
    let accountSessions = [];
    let verifiedMfaFactors = [];
    let pendingMfaFactor = null;
    let toastTimer = null;

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireChrome();
        try {
            const { data } = await _supabase.auth.getSession();
            const session = data?.session || null;
            if (!session) { window.location.href = '/artist/login'; return; }
            user = session.user;
            currentSessionId = parseJwt(session.access_token)?.session_id || null;
        } catch (err) {
            console.error('[account] sesión:', err);
            window.location.href = '/artist/login';
            return;
        }

        const { data: row, error } = await D.Artists.getAccountByUserId(user.id);
        if (error) console.error('[account] artista:', error);
        if (!row) { window.location.href = '/artist/login'; return; }
        artist = row;
        prefs = await D.Prefs.get(user.id).catch(() => null);

        fillProfile();
        setupProfile();
        works = normalizeWorks(artist.gallery_feed_items, artist.gallery_images);
        renderWorks();
        setupWorks();
        setupBilling();
        loadFinancials();
        setupAvailability();
        renderNotifMatrix();
        setupSecurity();
        renderPrivacy();
        loadIntegrations();
        renderVerification();
        loadVerifDocs();
        setupSettings();
        setupDialogs();

        applyHash();
        window.addEventListener('hashchange', applyHash);
    }

    // ============================================
    // Chrome: topbar + ruteo por hash + toast
    // ============================================

    function wireChrome() {
        const menuToggle = $('aac-mobile-menu-toggle');
        const mobileMenu = $('aac-mobile-menu');
        const closeMobileMenu = () => {
            if (!menuToggle || !mobileMenu) return;
            mobileMenu.hidden = true;
            menuToggle.setAttribute('aria-expanded', 'false');
        };

        closeMobileMenu();
        menuToggle?.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = menuToggle.getAttribute('aria-expanded') !== 'true';
            mobileMenu.hidden = !open;
            menuToggle.setAttribute('aria-expanded', String(open));
        });
        mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
        document.addEventListener('click', (event) => {
            if (!mobileMenu || mobileMenu.hidden) return;
            if (mobileMenu.contains(event.target) || menuToggle?.contains(event.target)) return;
            closeMobileMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || mobileMenu?.hidden) return;
            closeMobileMenu();
            menuToggle?.focus();
        });
        window.matchMedia('(min-width: 48.0625rem)').addEventListener?.('change', (event) => {
            if (event.matches) closeMobileMenu();
        });

        $('aac-logout')?.addEventListener('click', async () => {
            if (appSettings().confirm_logout && !window.confirm('¿Querés cerrar tu sesión?')) return;
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[account] logout:', err); }
            window.location.href = '/artist/login';
        });
    }

    function setupDialogs() {
        document.querySelectorAll('[data-dialog-close]').forEach((button) => {
            button.addEventListener('click', () => $(button.dataset.dialogClose)?.close());
        });
        document.querySelectorAll('dialog.aac-dialog').forEach((dialog) => {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) dialog.close();
            });
        });
        $('aac-mfa-dialog')?.addEventListener('close', async () => {
            const abandonedFactor = pendingMfaFactor;
            pendingMfaFactor = null;
            $('aac-mfa-enrollment').replaceChildren();
            $('aac-mfa-code').value = '';
            if (!abandonedFactor?.id || !_supabase.auth.mfa?.unenroll) return;
            const { error } = await _supabase.auth.mfa.unenroll({ factorId: abandonedFactor.id });
            if (error) console.warn('[account] limpiar factor MFA incompleto:', error);
        });
    }

    function applyHash() {
        const raw = (window.location.hash || '').replace('#', '');
        const active = SECTIONS.includes(raw) ? raw : 'perfil';
        SECTIONS.forEach((s) => {
            const sec = $('aac-' + s);
            if (sec) sec.hidden = s !== active;
        });
        let activeNav = null;
        document.querySelectorAll('[data-aac-nav]').forEach((item) => {
            const isActive = item.getAttribute('data-aac-nav') === active;
            item.classList.toggle('is-active', isActive);
            if (isActive) activeNav = item;
        });
        activeNav?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        window.scrollTo({ top: 0 });
    }

    function toast(msg, ok = true) {
        const el = $('aac-toast');
        if (!el) return;
        $('aac-toast-text').textContent = msg;
        el.classList.toggle('wo-alert--success', ok);
        el.classList.toggle('wo-alert--error', !ok);
        el.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function debounce(fn, ms) {
        let t = null;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function appSettings() {
        return (prefs && prefs.app_settings) || {};
    }

    // Guarda una sección de user_preferences y refresca la copia local.
    async function savePrefs(section, patch) {
        prefs = await D.Prefs.saveSection(user.id, section, patch) || prefs;
    }

    async function updateArtist(patch) {
        const { error } = await D.Artists.updateByUserId(user.id, patch);
        if (error) throw error;
        Object.assign(artist, patch);
    }

    async function uploadTo(bucket, path, file) {
        const { error } = await _supabase.storage.from(bucket)
            .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || undefined });
        if (error) throw error;
        const { data } = _supabase.storage.from(bucket).getPublicUrl(path);
        return data?.publicUrl || null;
    }

    async function removeFromStorage(bucket, path) {
        const { error } = await _supabase.storage.from(bucket).remove([path]);
        if (error) throw error;
    }

    async function queueVerificationCleanup(path) {
        if (!path) return;
        const saved = appSettings().verification_cleanup_paths;
        const paths = [...new Set([...(Array.isArray(saved) ? saved : []), path])].slice(-20);
        await savePrefs('app_settings', { verification_cleanup_paths: paths });
    }

    async function removeOrQueueVerificationPath(path) {
        if (!path) return true;
        try {
            await removeFromStorage('artist-verification', path);
            return true;
        } catch (error) {
            console.warn('[account] limpieza documental pendiente:', error);
            await queueVerificationCleanup(path).catch((queueError) =>
                console.warn('[account] no se pudo registrar la limpieza pendiente:', queueError)
            );
            return false;
        }
    }

    async function retryVerificationCleanup() {
        const saved = appSettings().verification_cleanup_paths;
        if (!Array.isArray(saved) || !saved.length) return;
        const referenced = new Set(verifDocs.map((doc) => doc.storage_path).filter(Boolean));
        const remaining = [];
        for (const path of saved) {
            if (referenced.has(path)) continue;
            try {
                await removeFromStorage('artist-verification', path);
            } catch (error) {
                console.warn('[account] reintento de limpieza documental:', error);
                remaining.push(path);
            }
        }
        if (remaining.length !== saved.length) {
            await savePrefs('app_settings', { verification_cleanup_paths: remaining }).catch(() => null);
        }
    }

    function fileExt(file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        return ext.replace(/[^a-z0-9]/g, '') || 'jpg';
    }

    // ============================================
    // 1 · Mi perfil
    // ============================================

    function profilePrefs() {
        return appSettings().profile || {};
    }

    function fillProfile() {
        const p = profilePrefs();
        $('aac-name').value = artist.name || '';
        $('aac-fullname').value = p.full_name || '';
        $('aac-username').value = artist.username || '';
        $('aac-bio').value = artist.bio_description || '';
        $('aac-city').value = artist.city || '';
        $('aac-country').value = artist.country || '';
        $('aac-instagram').value = artist.instagram || '';
        $('aac-tiktok').value = p.tiktok || '';
        $('aac-website').value = artist.portafolio || '';

        // Idiomas como chips seleccionables (multiselección sobre languages[]).
        const current = Array.isArray(artist.languages) ? artist.languages : [];
        const all = [...LANGS];
        current.forEach((l) => { if (!all.includes(l)) all.push(l); });
        $('aac-langs').innerHTML = all.map((lang) => {
            const on = current.includes(lang);
            return `<button type="button" class="wo-chip${on ? ' is-active' : ''}" data-lang="${esc(lang)}" aria-pressed="${on}">${esc(lang)}</button>`;
        }).join('');
        $('aac-langs').querySelectorAll('[data-lang]').forEach((chip) => {
            chip.addEventListener('click', () => {
                const on = chip.classList.toggle('is-active');
                chip.setAttribute('aria-pressed', String(on));
            });
        });

        setDropMedia($('aac-photo-drop'), artist.profile_picture, 'Foto de perfil');
        setDropMedia($('aac-banner-drop'), p.banner_url, 'Banner de perfil');
    }

    function setDropMedia(drop, url, alt) {
        if (!drop) return;
        drop.querySelector('img')?.remove();
        if (url) {
            drop.classList.add('has-media');
            const img = document.createElement('img');
            img.src = url;
            img.alt = alt;
            drop.appendChild(img);
        } else {
            drop.classList.remove('has-media');
        }
    }

    function setupProfile() {
        wireDrop($('aac-banner-drop'), $('aac-banner-input'), async (file) => {
            const url = await uploadTo('profile-pictures', `${user.id}/banner-${Date.now()}.${fileExt(file)}`, file);
            const p = { ...profilePrefs(), banner_url: url };
            await savePrefs('app_settings', { profile: p });
            setDropMedia($('aac-banner-drop'), url, 'Banner de perfil');
            toast('Banner actualizado');
        });
        wireDrop($('aac-photo-drop'), $('aac-photo-input'), async (file) => {
            const url = await uploadTo('profile-pictures', `${user.id}/${Date.now()}.${fileExt(file)}`, file);
            await updateArtist({ profile_picture: url });
            setDropMedia($('aac-photo-drop'), url, 'Foto de perfil');
            toast('Foto de perfil actualizada');
        });

        $('aac-profile-save').addEventListener('click', saveProfile);
    }

    // Dropzone: click (label ya abre el input), drag & drop y subida.
    function wireDrop(drop, input, onFile) {
        if (!drop || !input) return;
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            try { await onFile(file); }
            catch (err) { console.error('[account] upload:', err); toast('No pudimos subir la imagen', false); }
        });
        ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
        }));
        drop.addEventListener('drop', async (e) => {
            const file = e.dataTransfer?.files && e.dataTransfer.files[0];
            if (!file) return;
            try { await onFile(file); }
            catch (err) { console.error('[account] upload:', err); toast('No pudimos subir la imagen', false); }
        });
    }

    function normalizeHandle(value) {
        const v = String(value || '').trim();
        if (!v) return '';
        return v.startsWith('@') ? v : '@' + v;
    }

    async function saveProfile() {
        const btn = $('aac-profile-save');
        const errEl = $('aac-username-error');
        errEl.hidden = true;
        $('aac-username').classList.remove('wo-input--error');

        const username = $('aac-username').value.trim().toLowerCase();
        if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
            errEl.textContent = 'El nombre de usuario lleva entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.';
            errEl.hidden = false;
            $('aac-username').classList.add('wo-input--error');
            return;
        }

        btn.disabled = true;
        try {
            if (username !== (artist.username || '').toLowerCase()) {
                const { data: taken } = await D.Artists.isUsernameAvailable(username, user.id);
                if (taken && taken.length) {
                    errEl.textContent = 'Ese nombre de usuario ya está en uso.';
                    errEl.hidden = false;
                    $('aac-username').classList.add('wo-input--error');
                    return;
                }
            }

            const languages = Array.from($('aac-langs').querySelectorAll('[data-lang].is-active'))
                .map((chip) => chip.getAttribute('data-lang'));

            await updateArtist({
                name: $('aac-name').value.trim() || null,
                username,
                languages,
                bio_description: $('aac-bio').value.trim() || null,
                city: $('aac-city').value.trim() || null,
                country: $('aac-country').value.trim() || null,
                instagram: normalizeHandle($('aac-instagram').value) || null,
                portafolio: $('aac-website').value.trim() || null
            });

            const p = {
                ...profilePrefs(),
                full_name: $('aac-fullname').value.trim(),
                tiktok: normalizeHandle($('aac-tiktok').value)
            };
            await savePrefs('app_settings', { profile: p });

            fillIntegrations();
            toast('Cambios guardados');
        } catch (err) {
            console.error('[account] guardar perfil:', err);
            toast('No pudimos guardar los cambios', false);
        } finally {
            btn.disabled = false;
        }
    }

    // ============================================
    // 2 · Portafolio
    // ============================================

    function isVideoUrl(url) {
        const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
        return ext === 'mp4' || ext === 'mov';
    }

    function normalizeWorks(feedItems, legacyImages) {
        const out = [];
        const seen = new Set();
        const parse = (v) => {
            if (Array.isArray(v)) return v;
            if (typeof v !== 'string') return [];
            try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
        };
        for (const raw of parse(feedItems)) {
            const url = String(raw?.url || '').trim();
            if (!url || seen.has(url)) continue;
            out.push({
                url,
                category: raw?.category || 'realizados',
                kind: raw?.kind === 'video' || isVideoUrl(url) ? 'video' : 'image',
                created_at: raw?.created_at || new Date().toISOString()
            });
            seen.add(url);
        }
        if (!out.length) {
            for (const entry of parse(legacyImages)) {
                const url = typeof entry === 'string' ? entry.trim() : String(entry?.url || '').trim();
                if (!url || seen.has(url)) continue;
                out.push({ url, category: 'realizados', kind: isVideoUrl(url) ? 'video' : 'image', created_at: new Date().toISOString() });
                seen.add(url);
            }
        }
        return out;
    }

    function renderWorks() {
        const grid = $('aac-works');
        const total = Math.max(MIN_WORK_SLOTS, Math.ceil((works.length + 1) / 4) * 4);
        const cells = works.map((item, i) => `
            <div class="aac-work">
                ${item.kind === 'video'
                    ? `<video src="${esc(item.url)}" preload="metadata" muted playsinline></video>`
                    : `<img src="${esc(item.url)}" alt="Trabajo ${i + 1}" loading="lazy">`}
                <div class="aac-work-tools">
                    <button type="button" class="wo-iconbtn" data-work-up="${i}" aria-label="Subir en el orden" ${i === 0 ? 'disabled' : ''}><i data-wo-icon="arrow-up"></i></button>
                    <button type="button" class="wo-iconbtn" data-work-down="${i}" aria-label="Bajar en el orden" ${i === works.length - 1 ? 'disabled' : ''}><i data-wo-icon="arrow-down"></i></button>
                    <button type="button" class="wo-iconbtn" data-work-del="${i}" aria-label="Quitar trabajo"><i data-wo-icon="trash-2"></i></button>
                </div>
            </div>`);
        for (let i = works.length; i < total; i++) {
            cells.push(`
            <button type="button" class="wo-dropzone aac-drop aac-work-drop" data-work-add>
                <i data-wo-icon="image" aria-hidden="true"></i>
                <span class="aac-drop-title">Trabajo</span>
                <span class="aac-drop-hint">o buscá archivos</span>
            </button>`);
        }
        grid.innerHTML = cells.join('');

        grid.querySelectorAll('[data-work-add]').forEach((cell) => {
            cell.addEventListener('click', () => $('aac-works-input').click());
        });
        grid.querySelectorAll('[data-work-up]').forEach((btn) => btn.addEventListener('click', () => moveWork(Number(btn.dataset.workUp), -1)));
        grid.querySelectorAll('[data-work-down]').forEach((btn) => btn.addEventListener('click', () => moveWork(Number(btn.dataset.workDown), 1)));
        grid.querySelectorAll('[data-work-del]').forEach((btn) => btn.addEventListener('click', () => removeWork(Number(btn.dataset.workDel))));
    }

    function setupWorks() {
        $('aac-works-add').addEventListener('click', () => $('aac-works-input').click());
        $('aac-works-input').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
            e.target.value = '';
            if (!files.length) return;
            try {
                for (const file of files) {
                    const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt(file)}`;
                    const url = await uploadTo('artist-gallery', path, file);
                    if (url) works.push({ url, category: 'realizados', kind: 'image', created_at: new Date().toISOString() });
                }
                await persistWorks();
                toast(files.length === 1 ? 'Trabajo agregado' : `${files.length} trabajos agregados`);
            } catch (err) {
                console.error('[account] portafolio:', err);
                toast('No pudimos subir los archivos', false);
            }
            renderWorks();
        });
    }

    async function persistWorks() {
        await updateArtist({
            gallery_feed_items: works,
            gallery_images: works.map((w) => w.url)
        });
    }

    async function moveWork(index, dir) {
        const target = index + dir;
        if (target < 0 || target >= works.length) return;
        const [item] = works.splice(index, 1);
        works.splice(target, 0, item);
        renderWorks();
        try { await persistWorks(); toast('Orden actualizado'); }
        catch (err) { console.error('[account] orden portafolio:', err); toast('No pudimos guardar el orden', false); }
    }

    async function removeWork(index) {
        const item = works[index];
        if (!item) return;
        if (!window.confirm('¿Querés quitar este trabajo del portafolio?')) return;
        works.splice(index, 1);
        renderWorks();
        try {
            const parts = item.url.split('/artist-gallery/');
            if (parts.length > 1) await _supabase.storage.from('artist-gallery').remove([parts[1]]);
            await persistWorks();
            toast('Trabajo quitado');
        } catch (err) {
            console.error('[account] quitar trabajo:', err);
            toast('No pudimos quitar el trabajo', false);
        }
    }

    // ============================================
    // 3 · Cobros y facturación
    // ============================================

    function fmtMoney(amount, code) {
        const cur = window.WeOtziCurrency;
        const info = cur && typeof cur.get === 'function' ? cur.get(code) : null;
        const symbol = (info && info.symbol) || '$';
        return symbol + Math.round(amount).toLocaleString('es-AR');
    }

    function formatShortDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
            .format(date).replace('.', '');
    }

    function renderLedger() {
        const wrap = $('aac-ledger');
        const visible = financialEntries.filter((entry) => !entry.metadata_json?.summary_only);
        if (!visible.length) {
            wrap.innerHTML = '<div class="wo-empty"><i data-wo-icon="inbox" aria-hidden="true"></i><span class="wo-empty-title">Sin movimientos todavía</span><p>Cuando cobres a través de We Ötzi vas a ver el detalle acá.</p></div>';
            return;
        }
        wrap.innerHTML = visible.map((entry) => {
            const amount = Number(entry.amount) || 0;
            return `<div class="aac-ledger-row">
                <strong>${esc(entry.title)}</strong>
                <span class="aac-ledger-date">${esc(formatShortDate(entry.occurred_at))}</span>
                <span class="aac-ledger-amount ${amount >= 0 ? 'is-positive' : 'is-negative'}">${amount >= 0 ? '+' : '−'} ${esc(fmtMoney(Math.abs(amount), entry.currency))}</span>
            </div>`;
        }).join('');
    }

    async function loadFinancials() {
        try {
            const cur = window.WeOtziCurrency;
            if (cur && typeof cur.init === 'function') await cur.init().catch(() => null);

            const available = D.FinancialLedger && await D.FinancialLedger.isAvailable();
            if (available) {
                financialEntries = await D.FinancialLedger.list(user.id, 50);
                const target = String(artist.preferred_display_currency || artist.session_price_currency || 'USD').toUpperCase();
                const monthStart = new Date();
                monthStart.setDate(1);
                monthStart.setHours(0, 0, 0, 0);
                let month = 0;
                let availableBalance = 0;
                let nextPayout = null;
                financialEntries.forEach((entry) => {
                    const amount = Number(entry.amount) || 0;
                    const when = new Date(entry.occurred_at);
                    const sameCurrency = String(entry.currency || target).toUpperCase() === target;
                    if (!sameCurrency) return;
                    if (entry.status === 'completed') availableBalance += amount;
                    if (entry.entry_type === 'income' && entry.status === 'completed' && !Number.isNaN(when.getTime()) && when >= monthStart) month += Math.max(0, amount);
                    if (entry.entry_type === 'payout' && entry.status === 'pending' && (!nextPayout || when < new Date(nextPayout.occurred_at))) nextPayout = entry;
                });
                if (nextPayout) availableBalance = Math.abs(Number(nextPayout.amount) || availableBalance);
                $('aac-stat-balance').textContent = fmtMoney(Math.max(0, availableBalance), target);
                $('aac-stat-month').textContent = fmtMoney(month, target);
                $('aac-stat-next').textContent = nextPayout ? formatShortDate(nextPayout.occurred_at).replace(/\s+\d{4}$/, '') : '—';
                renderLedger();
                return;
            }

            const quotes = await D.Quotations.listForArtist(user.id, {
                select: 'quote_status, final_budget_amount, final_budget_currency, client_completed_at, artist_completed_at, updated_at, created_at'
            });

            const target = String(artist.preferred_display_currency || artist.session_price_currency || 'USD').toUpperCase();
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            let month = 0, total = 0;
            (quotes || []).forEach((q) => {
                if (q.quote_status !== 'completed') return;
                const raw = parseFloat(q.final_budget_amount);
                if (!isFinite(raw) || raw <= 0) return;
                const from = String(q.final_budget_currency || target).toUpperCase();
                let value = raw;
                if (from !== target) {
                    const conv = cur && typeof cur.convert === 'function' ? cur.convert(raw, from, target) : null;
                    if (conv === null || !isFinite(conv)) return; // sin tipo de cambio no inventamos
                    value = conv;
                }
                total += value;
                const when = new Date(q.client_completed_at || q.artist_completed_at || q.updated_at || q.created_at);
                if (!isNaN(when) && when >= monthStart) month += value;
            });

            $('aac-stat-balance').textContent = fmtMoney(total, target);
            $('aac-stat-month').textContent = fmtMoney(month, target);
            $('aac-stat-next').textContent = '—';
            financialEntries = [];
            renderLedger();
        } catch (err) {
            console.error('[account] ingresos:', err);
            $('aac-stat-balance').textContent = '—';
            $('aac-stat-month').textContent = '—';
            $('aac-stat-next').textContent = '—';
            financialEntries = [];
            renderLedger();
        }
    }

    async function setupBilling() {
        try {
            const row = await D.Billing.get(user.id);
            if (row) {
                $('aac-legal-name').value = row.legal_name || '';
                $('aac-tax-id').value = row.tax_id || '';
            }
        } catch (err) {
            console.warn('[account] datos fiscales:', err);
        }
        $('aac-billing-save').addEventListener('click', async () => {
            const btn = $('aac-billing-save');
            btn.disabled = true;
            try {
                await D.Billing.upsert(user.id, {
                    legalName: $('aac-legal-name').value.trim() || null,
                    taxId: $('aac-tax-id').value.trim() || null
                });
                toast('Datos fiscales guardados');
            } catch (err) {
                console.error('[account] guardar fiscales:', err);
                toast('No pudimos guardar los datos fiscales', false);
            } finally {
                btn.disabled = false;
            }
        });

        const methodsAvailable = D.PaymentMethods && await D.PaymentMethods.isAvailable();
        if (!methodsAvailable) {
            $('aac-method-add').disabled = true;
            $('aac-methods').innerHTML = '<div class="wo-alert wo-alert--warning">Aplicá la migración del Centro de Cuenta para gestionar métodos tokenizados.</div>';
            return;
        }
        await reloadPaymentMethods();
        $('aac-method-add').addEventListener('click', () => openPaymentDialog());
        $('aac-method-form').addEventListener('submit', savePaymentMethod);
    }

    function paymentProviderLabel(provider) {
        return ({ stripe: 'Visa', mercado_pago: 'MP', paypal: 'PP', wise: 'Wise', bank_transfer: 'Banco' })[provider] || provider;
    }

    async function reloadPaymentMethods() {
        paymentMethods = await D.PaymentMethods.list(user.id);
        renderPaymentMethods();
    }

    function renderPaymentMethods() {
        const wrap = $('aac-methods');
        if (!paymentMethods.length) {
            wrap.innerHTML = '<div class="wo-empty"><i data-wo-icon="credit-card" aria-hidden="true"></i><span class="wo-empty-title">Sin métodos de pago</span><p>Agregá una referencia tokenizada emitida por tu proveedor.</p></div>';
            return;
        }
        wrap.innerHTML = paymentMethods.map((method) => `
            <div class="aac-method">
                <span class="aac-method-logo">${esc(paymentProviderLabel(method.provider))}</span>
                <div class="aac-row-main">
                    <div class="aac-row-title">${esc(method.display_name)} ${method.is_default ? '<span class="aac-badge aac-badge--success">Predeterminado</span>' : ''}</div>
                    <div class="aac-row-sub">${esc(method.account_hint || (method.last_four ? `•••• ${method.last_four}` : 'Referencia protegida por el proveedor'))}</div>
                </div>
                <div class="aac-method-actions">
                    ${method.is_default ? '' : `<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-method-default="${method.id}">Predeterminar</button>`}
                    <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-method-edit="${method.id}">Editar</button>
                    <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-method-delete="${method.id}">Eliminar</button>
                </div>
            </div>`).join('');

        wrap.querySelectorAll('[data-method-edit]').forEach((button) => button.addEventListener('click', () => {
            openPaymentDialog(paymentMethods.find((method) => method.id === button.dataset.methodEdit));
        }));
        wrap.querySelectorAll('[data-method-default]').forEach((button) => button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await D.PaymentMethods.setDefault(user.id, button.dataset.methodDefault);
                await reloadPaymentMethods();
                toast('Método predeterminado actualizado');
            } catch (error) {
                console.error('[account] predeterminar método:', error);
                toast('No pudimos actualizar el método', false);
            } finally { button.disabled = false; }
        }));
        wrap.querySelectorAll('[data-method-delete]').forEach((button) => button.addEventListener('click', async () => {
            if (!window.confirm('¿Querés eliminar este método tokenizado?')) return;
            button.disabled = true;
            try {
                await D.PaymentMethods.remove(user.id, button.dataset.methodDelete);
                await reloadPaymentMethods();
                toast('Método eliminado');
            } catch (error) {
                console.error('[account] eliminar método:', error);
                toast('No pudimos eliminar el método', false);
            } finally { button.disabled = false; }
        }));
    }

    function openPaymentDialog(method = null) {
        $('aac-method-id').value = method?.id || '';
        $('aac-method-provider').value = method?.provider || 'stripe';
        $('aac-method-name').value = method?.display_name || '';
        $('aac-method-reference').value = method?.provider_reference || '';
        $('aac-method-last4').value = method?.last_four || '';
        $('aac-method-hint').value = method?.account_hint || '';
        $('aac-method-default').checked = !!method?.is_default;
        $('aac-method-dialog-title').textContent = method ? 'Editar método' : 'Agregar método';
        $('aac-method-dialog').showModal();
    }

    async function savePaymentMethod(event) {
        event.preventDefault();
        const provider = $('aac-method-provider').value;
        const lastFour = $('aac-method-last4').value.trim();
        if (lastFour && !/^[0-9A-Za-z]{4}$/.test(lastFour)) {
            toast('Ingresá exactamente los últimos 4 caracteres', false);
            return;
        }
        const submit = event.submitter;
        if (submit) submit.disabled = true;
        try {
            const saved = await D.PaymentMethods.save(user.id, {
                id: $('aac-method-id').value || null,
                provider,
                methodType: provider === 'stripe' ? 'card_token' : ['wise', 'bank_transfer'].includes(provider) ? 'bank_account_token' : 'wallet',
                providerReference: $('aac-method-reference').value.trim(),
                displayName: $('aac-method-name').value.trim(),
                brand: provider === 'stripe' ? 'Tarjeta' : null,
                lastFour: lastFour || null,
                accountHint: $('aac-method-hint').value.trim() || null,
                isDefault: false,
                metadata: { entered_via: 'account_center' }
            });
            if ($('aac-method-default').checked) await D.PaymentMethods.setDefault(user.id, saved.id);
            $('aac-method-dialog').close();
            await reloadPaymentMethods();
            toast('Método guardado de forma segura');
        } catch (error) {
            console.error('[account] guardar método:', error);
            toast('No pudimos guardar el método tokenizado', false);
        } finally { if (submit) submit.disabled = false; }
    }

    // ============================================
    // 4 · Disponibilidad
    // ============================================

    function defaultWeekly() {
        return DAYS.map(([day]) => ({
            day,
            enabled: WORKDAYS.includes(day),
            start: '10:00',
            end: '19:00'
        }));
    }

    const saveWeekly = debounce(async () => {
        try {
            await savePrefs('app_settings', { availability: { weekly } });
            toast('Disponibilidad guardada');
        } catch (err) {
            console.error('[account] disponibilidad:', err);
            toast('No pudimos guardar la disponibilidad', false);
        }
    }, 700);

    function setupAvailability() {
        const stored = appSettings().availability?.weekly;
        weekly = Array.isArray(stored) && stored.length === 7
            ? DAYS.map(([day], i) => ({
                day,
                enabled: !!stored[i]?.enabled,
                start: stored[i]?.start || '10:00',
                end: stored[i]?.end || '19:00'
            }))
            : defaultWeekly();

        const wrap = $('aac-days');
        wrap.innerHTML = DAYS.map(([day, label], i) => `
            <div class="aac-dayrow${weekly[i].enabled ? '' : ' is-off'}" data-day="${day}">
                <span class="aac-dayrow-name">${label}</span>
                <label class="wo-toggle">
                    <input type="checkbox" data-day-toggle="${i}" ${weekly[i].enabled ? 'checked' : ''} aria-label="Disponible los ${label.toLowerCase()}">
                    <span class="knob"></span>
                </label>
                <span class="aac-dayrow-hours">
                    <input class="wo-input aac-time" type="time" data-day-start="${i}" value="${esc(weekly[i].start)}" aria-label="Hora de inicio del ${label.toLowerCase()}">
                    <span class="wo-faint">–</span>
                    <input class="wo-input aac-time" type="time" data-day-end="${i}" value="${esc(weekly[i].end)}" aria-label="Hora de fin del ${label.toLowerCase()}">
                </span>
                <span class="aac-dayrow-off">No disponible</span>
            </div>`).join('');

        wrap.querySelectorAll('[data-day-toggle]').forEach((input) => {
            input.addEventListener('change', () => {
                const i = Number(input.dataset.dayToggle);
                weekly[i].enabled = input.checked;
                input.closest('.aac-dayrow').classList.toggle('is-off', !input.checked);
                saveWeekly();
            });
        });
        wrap.querySelectorAll('[data-day-start], [data-day-end]').forEach((input) => {
            input.addEventListener('change', () => {
                const isStart = input.dataset.dayStart !== undefined;
                const i = Number(isStart ? input.dataset.dayStart : input.dataset.dayEnd);
                if (isStart) weekly[i].start = input.value || '10:00';
                else weekly[i].end = input.value || '19:00';
                saveWeekly();
            });
        });

        // Vacaciones → columnas reales de artists_db.
        $('aac-vac-from').value = artist.vacation_start || '';
        $('aac-vac-to').value = artist.vacation_end || '';
        const saveVacations = async () => {
            try {
                await updateArtist({
                    vacation_start: $('aac-vac-from').value || null,
                    vacation_end: $('aac-vac-to').value || null
                });
                toast('Vacaciones guardadas');
            } catch (err) {
                console.error('[account] vacaciones:', err);
                toast('No pudimos guardar las vacaciones', false);
            }
        };
        $('aac-vac-from').addEventListener('change', saveVacations);
        $('aac-vac-to').addEventListener('change', saveVacations);
    }

    // ============================================
    // 5 · Notificaciones (Email / Push / SMS persistentes)
    // ============================================

    function renderNotifMatrix() {
        const saved = (prefs && prefs.notification_prefs) || {};
        notifMatrix = {};
        NOTIF_EVENTS.forEach(([key, , emailDefault, pushDefault, smsDefault]) => {
            notifMatrix[key] = {
                email: typeof saved[key]?.email === 'boolean' ? saved[key].email : emailDefault,
                push: typeof saved[key]?.push === 'boolean' ? saved[key].push : pushDefault,
                sms: typeof saved[key]?.sms === 'boolean' ? saved[key].sms : smsDefault
            };
        });

        $('aac-notif-rows').innerHTML = NOTIF_EVENTS.map(([key, label]) => `
            <div class="aac-matrix-row">
                <span class="aac-matrix-label">${label}</span>
                <span class="aac-matrix-cell">
                    <label class="wo-toggle">
                        <input type="checkbox" data-notif-event="${key}" data-notif-channel="email" ${notifMatrix[key].email ? 'checked' : ''} aria-label="Avisos de ${label.toLowerCase()} por email">
                        <span class="knob"></span>
                    </label>
                </span>
                <span class="aac-matrix-cell">
                    <label class="wo-toggle">
                        <input type="checkbox" data-notif-event="${key}" data-notif-channel="push" ${notifMatrix[key].push ? 'checked' : ''} aria-label="Avisos de ${label.toLowerCase()} por push">
                        <span class="knob"></span>
                    </label>
                </span>
                <span class="aac-matrix-cell">
                    <label class="wo-toggle">
                        <input type="checkbox" data-notif-event="${key}" data-notif-channel="sms" ${notifMatrix[key].sms ? 'checked' : ''} aria-label="Avisos de ${label.toLowerCase()} por SMS">
                        <span class="knob"></span>
                    </label>
                </span>
            </div>`).join('');

        $('aac-notif-rows').querySelectorAll('[data-notif-event]').forEach((input) => {
            input.addEventListener('change', async () => {
                notifMatrix[input.dataset.notifEvent][input.dataset.notifChannel] = input.checked;
                try {
                    await savePrefs('notification_prefs', notifMatrix);
                    toast('Preferencia guardada');
                } catch (err) {
                    console.error('[account] notificaciones:', err);
                    toast('No pudimos guardar la preferencia', false);
                }
            });
        });
    }

    // ============================================
    // 6 · Seguridad y privacidad
    // ============================================

    function parseJwt(token) {
        try {
            const payload = String(token || '').split('.')[1];
            if (!payload) return null;
            const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(decodeURIComponent(atob(normalized).split('').map((ch) => `%${('00' + ch.charCodeAt(0).toString(16)).slice(-2)}`).join('')));
        } catch { return null; }
    }

    function describeDevice() {
        const ua = navigator.userAgent || '';
        const browser = /Edg\//.test(ua) ? 'Edge'
            : /Firefox\//.test(ua) ? 'Firefox'
            : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
        const os = /Windows/.test(ua) ? 'Windows'
            : /Mac OS X/.test(ua) ? 'macOS'
            : /Android/.test(ua) ? 'Android'
            : /iPhone|iPad/.test(ua) ? 'iOS'
            : /Linux/.test(ua) ? 'Linux' : '';
        return { browser, operatingSystem: os, deviceName: os ? `${os} — ${browser}` : browser };
    }

    async function hashUserAgent() {
        try {
            if (!window.crypto?.subtle) return null;
            const bytes = new TextEncoder().encode(navigator.userAgent || '');
            const digest = await window.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        } catch { return null; }
    }

    async function setupSecurity() {
        $('aac-pass-save').addEventListener('click', async () => {
            const errEl = $('aac-pass-error');
            errEl.hidden = true;
            const current = $('aac-pass-current').value;
            const next = $('aac-pass-new').value;
            if (!current || !next) {
                errEl.textContent = 'Completá la contraseña actual y la nueva.';
                errEl.hidden = false;
                return;
            }
            if (next.length < 8) {
                errEl.textContent = 'La nueva contraseña lleva al menos 8 caracteres.';
                errEl.hidden = false;
                return;
            }
            if (next === current) {
                errEl.textContent = 'La nueva contraseña tiene que ser distinta de la actual.';
                errEl.hidden = false;
                return;
            }
            const btn = $('aac-pass-save');
            btn.disabled = true;
            try {
                const { data: signData, error: signErr } = await _supabase.auth.signInWithPassword({ email: user.email, password: current });
                if (signErr) {
                    errEl.textContent = 'La contraseña actual no es correcta.';
                    errEl.hidden = false;
                    return;
                }
                currentSessionId = parseJwt(signData?.session?.access_token)?.session_id || currentSessionId;
                const { error: updErr } = await _supabase.auth.updateUser({ password: next });
                if (updErr) throw updErr;
                $('aac-pass-current').value = '';
                $('aac-pass-new').value = '';
                toast('Contraseña actualizada');
            } catch (err) {
                console.error('[account] contraseña:', err);
                errEl.textContent = 'No pudimos actualizar la contraseña. Probá de nuevo.';
                errEl.hidden = false;
            } finally {
                btn.disabled = false;
            }
        });

        $('aac-close-others').addEventListener('click', async () => {
            const btn = $('aac-close-others');
            btn.disabled = true;
            try {
                const { error } = await _supabase.auth.signOut({ scope: 'others' });
                if (error) throw error;
                if (currentSessionId && D.AccountSessions) await D.AccountSessions.revokeOthers(user.id, currentSessionId).catch(() => null);
                await loadAccountSessions();
                toast('Cerramos la sesión en tus otros dispositivos');
            } catch (err) {
                console.error('[account] cerrar sesiones:', err);
                toast('No pudimos cerrar las otras sesiones', false);
            } finally {
                btn.disabled = false;
            }
        });

        $('aac-mfa-action').addEventListener('click', handleMfaAction);
        $('aac-mfa-form').addEventListener('submit', verifyMfaEnrollment);
        $('aac-delete-request').addEventListener('click', () => $('aac-delete-dialog').showModal());
        $('aac-delete-form').addEventListener('submit', requestAccountDeletion);

        await Promise.all([loadAccountSessions(), loadMfaState(), loadDeletionRequests()]);
    }

    async function loadAccountSessions() {
        const wrap = $('aac-sessions');
        const available = D.AccountSessions && await D.AccountSessions.isAvailable();
        if (!available || !currentSessionId) {
            wrap.innerHTML = `<div class="aac-row"><div class="aac-row-main"><div class="aac-row-title">${esc(describeDevice().deviceName)}</div><div class="aac-row-sub">Sesión actual · Activa ahora</div></div><span class="aac-badge aac-badge--info">Este dispositivo</span></div>`;
            return;
        }
        const device = describeDevice();
        device.userAgentHash = await hashUserAgent();
        await D.AccountSessions.touch(user.id, currentSessionId, device).catch((error) => console.warn('[account] registrar sesión:', error));
        accountSessions = await D.AccountSessions.list(user.id).catch(() => []);
        renderAccountSessions();
    }

    function renderAccountSessions() {
        const wrap = $('aac-sessions');
        if (!accountSessions.length) {
            wrap.innerHTML = `<div class="aac-row"><div class="aac-row-main"><div class="aac-row-title">${esc(describeDevice().deviceName)}</div><div class="aac-row-sub">Sesión actual · Activa ahora</div></div><span class="aac-badge aac-badge--info">Este dispositivo</span></div>`;
            return;
        }
        wrap.innerHTML = accountSessions.map((session) => {
            const current = session.auth_session_id === currentSessionId;
            const seen = current ? 'Activa ahora' : `Última actividad ${formatShortDate(session.last_seen_at)}`;
            return `<div class="aac-row">
                <div class="aac-row-main">
                    <div class="aac-row-title">${esc(session.device_name)}</div>
                    <div class="aac-session-meta"><span>${esc([session.city, session.country].filter(Boolean).join(', '))}</span><span>${esc(seen)}</span></div>
                </div>
                <div class="aac-row-side">${current
                    ? '<span class="aac-badge aac-badge--info">Este dispositivo</span>'
                    : `<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-session-revoke="${session.auth_session_id}">Cerrar sesión</button>`}
                </div>
            </div>`;
        }).join('');
        wrap.querySelectorAll('[data-session-revoke]').forEach((button) => button.addEventListener('click', async () => {
            if (!window.confirm('Por seguridad, Supabase cerrará todas las demás sesiones. ¿Continuar?')) return;
            button.disabled = true;
            try {
                const { error } = await _supabase.auth.signOut({ scope: 'others' });
                if (error) throw error;
                await D.AccountSessions.revokeOthers(user.id, currentSessionId);
                await loadAccountSessions();
                toast('Sesiones remotas cerradas');
            } catch (error) {
                console.error('[account] revocar sesión:', error);
                toast('No pudimos cerrar la sesión remota', false);
            } finally { button.disabled = false; }
        }));
    }

    async function loadMfaState() {
        const status = $('aac-mfa-status');
        try {
            if (!_supabase.auth.mfa?.listFactors) throw new Error('MFA no disponible en esta versión');
            const { data, error } = await _supabase.auth.mfa.listFactors();
            if (error) throw error;
            verifiedMfaFactors = (data?.all || data?.totp || []).filter((factor) => factor.status === 'verified');
            if (verifiedMfaFactors.length) {
                status.textContent = 'Autenticación en dos pasos activa mediante una app TOTP.';
                $('aac-mfa-action').textContent = 'Desactivar';
            } else {
                status.textContent = 'Podés activarla con cualquier app autenticadora compatible con TOTP.';
                $('aac-mfa-action').textContent = 'Configurar';
            }
        } catch (error) {
            console.warn('[account] MFA:', error);
            status.textContent = 'MFA no está habilitado por el proveedor de autenticación en este entorno.';
            $('aac-mfa-action').disabled = true;
        }
    }

    async function handleMfaAction() {
        const button = $('aac-mfa-action');
        button.disabled = true;
        try {
            if (verifiedMfaFactors.length) {
                if (!window.confirm('¿Querés desactivar la autenticación en dos pasos?')) return;
                const { error } = await _supabase.auth.mfa.unenroll({ factorId: verifiedMfaFactors[0].id });
                if (error) throw error;
                await loadMfaState();
                toast('Autenticación en dos pasos desactivada');
                return;
            }
            const { data, error } = await _supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'We Ötzi · Centro de Cuenta' });
            if (error) throw error;
            pendingMfaFactor = data;
            const qr = data?.totp?.qr_code;
            const secret = data?.totp?.secret;
            $('aac-mfa-enrollment').innerHTML = `${qr ? `<img class="aac-mfa-qr" src="${esc(qr)}" alt="Código QR para configurar TOTP">` : ''}<p>Escaneá el QR con tu app autenticadora.${secret ? ` Si no podés, ingresá esta clave: <code>${esc(secret)}</code>.` : ''}</p>`;
            $('aac-mfa-code').value = '';
            $('aac-mfa-dialog').showModal();
        } catch (error) {
            console.error('[account] configurar MFA:', error);
            toast('No pudimos configurar la autenticación en dos pasos', false);
        } finally { button.disabled = false; }
    }

    async function verifyMfaEnrollment(event) {
        event.preventDefault();
        const code = $('aac-mfa-code').value.trim();
        if (!pendingMfaFactor?.id || !/^\d{6}$/.test(code)) {
            toast('Ingresá el código de 6 dígitos', false);
            return;
        }
        const submit = event.submitter;
        if (submit) submit.disabled = true;
        try {
            const { error } = await _supabase.auth.mfa.challengeAndVerify({ factorId: pendingMfaFactor.id, code });
            if (error) throw error;
            pendingMfaFactor = null;
            $('aac-mfa-dialog').close();
            await loadMfaState();
            toast('Autenticación en dos pasos activada');
        } catch (error) {
            console.error('[account] verificar MFA:', error);
            toast('El código no es válido o venció', false);
        } finally { if (submit) submit.disabled = false; }
    }

    async function loadDeletionRequests() {
        const status = $('aac-delete-status');
        const available = D.AccountDeletionRequests && await D.AccountDeletionRequests.isAvailable();
        if (!available) {
            status.textContent = 'La solicitud auditable requiere la migración del Centro de Cuenta.';
            $('aac-delete-request').disabled = true;
            return;
        }
        const rows = await D.AccountDeletionRequests.list(user.id).catch(() => []);
        const open = rows.find((row) => ['requested', 'in_review', 'approved'].includes(row.status));
        if (open) {
            status.textContent = `Solicitud ${open.status === 'requested' ? 'recibida' : 'en revisión'} · ${formatShortDate(open.requested_at)}`;
            $('aac-delete-request').disabled = true;
        } else {
            status.textContent = 'La solicitud queda registrada para revisión de soporte.';
            $('aac-delete-request').disabled = false;
        }
    }

    async function requestAccountDeletion(event) {
        event.preventDefault();
        if (!$('aac-delete-confirm').checked) return;
        const submit = event.submitter;
        if (submit) submit.disabled = true;
        try {
            await D.AccountDeletionRequests.request(user.id, $('aac-delete-reason').value);
            $('aac-delete-dialog').close();
            await loadDeletionRequests();
            toast('Solicitud de eliminación registrada');
        } catch (error) {
            console.error('[account] solicitud de eliminación:', error);
            toast('No pudimos registrar la solicitud', false);
        } finally { if (submit) submit.disabled = false; }
    }

    function renderPrivacy() {
        const saved = (prefs && prefs.privacy) || {};
        $('aac-privacy-rows').innerHTML = PRIVACY_ROWS.map(([key, title, help, def]) => {
            const on = typeof saved[key] === 'boolean' ? saved[key] : def;
            return `
            <div class="aac-togglerow">
                <div class="aac-togglerow-main">
                    <div class="aac-row-title">${title}</div>
                    <div class="aac-row-sub">${help}</div>
                </div>
                <label class="wo-toggle">
                    <input type="checkbox" data-privacy="${key}" ${on ? 'checked' : ''} aria-label="${title}">
                    <span class="knob"></span>
                </label>
            </div>`;
        }).join('');

        $('aac-privacy-rows').querySelectorAll('[data-privacy]').forEach((input) => {
            input.addEventListener('change', async () => {
                try {
                    await savePrefs('privacy', { [input.dataset.privacy]: input.checked });
                    toast('Preferencia guardada');
                } catch (err) {
                    console.error('[account] privacidad:', err);
                    toast('No pudimos guardar la preferencia', false);
                }
            });
        });
    }

    // ============================================
    // 7 · Integraciones
    // ============================================

    async function loadIntegrations() {
        const available = D.AccountIntegrations && await D.AccountIntegrations.isAvailable();
        integrationsAvailable = !!available;
        if (available) integrations = await D.AccountIntegrations.list(user.id).catch(() => []);
        else integrations = [];
        renderIntegrations(available);
        document.querySelectorAll('[data-integration-action]').forEach((button) => {
            button.addEventListener('click', () => handleIntegrationAction(button.dataset.integrationAction, available));
        });
    }

    function fillIntegrations() {
        renderIntegrations(integrationsAvailable);
    }

    function renderIntegrations(available = true) {
        const handle = (artist.instagram || '').trim();
        const sub = $('aac-ig-sub');
        if (sub) sub.innerHTML = handle
            ? `${esc(handle.startsWith('@') ? handle : '@' + handle)} · <a href="/artist/dashboard">Gestioná la importación desde tu dashboard →</a>`
            : 'Importá publicaciones a tu portafolio. <a href="/artist/dashboard">Gestioná la importación desde tu dashboard →</a>';

        document.querySelectorAll('[data-integration-row]').forEach((row) => {
            const provider = row.dataset.integrationRow;
            const connection = integrations.find((item) => item.provider === provider);
            const action = row.querySelector('[data-integration-action]');
            if (!action) return;
            const status = connection?.status || (provider === 'instagram' && handle ? 'connected' : 'disconnected');
            action.textContent = status === 'connected' ? 'Conectado' : status === 'pending' ? 'Pendiente' : 'Conectar';
            action.classList.toggle('is-connected', status === 'connected');
            action.disabled = !available;
            action.title = !available ? 'Requiere la migración del Centro de Cuenta' : (connection?.account_label || '');
        });
    }

    async function handleIntegrationAction(provider, available) {
        if (!available) {
            toast('Aplicá la migración del Centro de Cuenta', false);
            return;
        }
        const meta = INTEGRATIONS[provider];
        if (!meta) return;
        const current = integrations.find((item) => item.provider === provider);
        try {
            if (current?.status === 'connected') {
                if (!window.confirm(`¿Querés desconectar ${meta.label}?`)) return;
                await D.AccountIntegrations.save(user.id, provider, { status: 'disconnected' });
                toast(`${meta.label} desconectado`);
            } else {
                const authorizeUrl = window.CONFIG?.integrations?.[provider]?.authorizeUrl;
                if (authorizeUrl) {
                    const returnTo = `${window.location.origin}/artist/account#integraciones`;
                    window.location.href = `${authorizeUrl}${authorizeUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(returnTo)}`;
                    return;
                }
                const label = window.prompt(`Ingresá el alias público de ${meta.label}. La conexión quedará pendiente hasta completar OAuth con el proveedor.`);
                if (label === null) return;
                await D.AccountIntegrations.save(user.id, provider, {
                    status: 'pending',
                    accountLabel: label.trim() || null,
                    scopes: meta.scopes,
                    metadata: { authorization_required: true }
                });
                toast(`Autorización de ${meta.label} pendiente`);
            }
            integrations = await D.AccountIntegrations.list(user.id);
            renderIntegrations(true);
        } catch (error) {
            console.error('[account] integración:', error);
            toast('No pudimos actualizar la integración', false);
        }
    }

    // ============================================
    // 8 · Verificación
    // ============================================

    function renderVerification() {
        const state = artist.verification_state || 'No';
        const box = $('aac-verif-alert');
        const canRequest = ['No', 'Denied', 'Canceled'].includes(state);
        let cls = 'wo-alert--warning';
        let icon = 'alert-circle';
        let title = 'Todavía no verificaste tu identidad';
        let detail = 'Solicitá la verificación para ganar confianza y prioridad en el Job board.';

        if (state === 'Yes') {
            cls = 'wo-alert--success';
            icon = 'check-circle';
            title = 'Identidad verificada';
            detail = 'Tu perfil muestra la insignia de verificado.';
        } else if (['Requested', 'In Progress', 'In Analysis'].includes(state)) {
            cls = 'wo-alert--info';
            icon = 'clock';
            title = 'Verificación en proceso';
            detail = 'Estamos revisando tu solicitud. Te avisamos por email cuando termine.';
        } else if (state === 'Denied') {
            cls = 'wo-alert--error';
            icon = 'alert-circle';
            title = 'Verificación denegada';
            detail = 'Podés volver a solicitarla cuando tengas la documentación al día.';
        }

        box.innerHTML = `
            <div class="wo-alert ${cls}">
                <i data-wo-icon="${icon}" aria-hidden="true"></i>
                <div>
                    <strong>${title}</strong><br>${detail}
                </div>
            </div>
            ${canRequest ? '<div class="aac-actions" style="margin-top:var(--space-4)"><button type="button" class="wo-btn wo-btn--ghost" id="aac-verif-request">Solicitar verificación</button></div>' : ''}`;

        $('aac-verif-request')?.addEventListener('click', async () => {
            try {
                await updateArtist({ verification_state: 'Requested' });
                renderVerification();
                toast('Solicitud de verificación enviada');
            } catch (err) {
                console.error('[account] solicitar verificación:', err);
                toast('No pudimos enviar la solicitud', false);
            }
        });
    }

    async function loadVerifDocs() {
        try {
            verifAvailable = await D.VerificationDocs.isAvailable();
            if (verifAvailable) {
                verifDocs = await D.VerificationDocs.list(user.id);
                await retryVerificationCleanup();
            }
        } catch (err) {
            console.warn('[account] documentos:', err);
            verifAvailable = false;
        }
        renderDocs();
    }

    function docBadge(doc) {
        if (!doc) return '<span class="aac-state aac-state--soon">Sin cargar</span>';
        const status = String(doc.status || 'pendiente').toLowerCase();
        if (status.includes('verific') || status.includes('aprob')) return '<span class="aac-badge aac-badge--success">Verificado</span>';
        if (status.includes('rechaz') || status.includes('deneg')) return '<span class="aac-badge aac-badge--error">Rechazado</span>';
        return '<span class="aac-badge aac-badge--warning">Pendiente</span>';
    }

    function renderDocs() {
        const wrap = $('aac-docs');
        $('aac-docs-note').hidden = verifAvailable;

        wrap.innerHTML = DOC_TYPES.map(([type, label]) => {
            const doc = verifDocs.find((d) => d.doc_type === type) || null;
            const status = doc ? String(doc.status || 'pendiente').toLowerCase() : '';
            const immutable = status.includes('verific') || status.includes('aprob');
            const deletable = doc && !immutable;
            return `
            <div class="aac-row${verifAvailable ? '' : ' is-soon'}">
                <span class="aac-row-tile"><i data-wo-icon="file-text" aria-hidden="true"></i></span>
                <div class="aac-row-main">
                    <div class="aac-row-title">${label}</div>
                    ${doc ? `<div class="aac-row-sub">${esc(doc.file_name || '')}</div>` : ''}
                </div>
                <div class="aac-row-side">
                    ${docBadge(doc)}
                    ${doc ? `<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-doc-view="${esc(doc.id)}">Ver</button>` : ''}
                    ${immutable ? '' : `<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-doc-upload="${type}" ${verifAvailable ? '' : 'disabled'}>${doc ? 'Reemplazar' : 'Subir'}</button>`}
                    ${deletable ? `<button type="button" class="wo-iconbtn wo-iconbtn--s" data-doc-del="${esc(doc.id)}" aria-label="Eliminar documento"><i data-wo-icon="trash-2"></i></button>` : ''}
                    <input type="file" data-doc-input="${type}" accept="image/*,.pdf" hidden>
                </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('[data-doc-upload]').forEach((btn) => {
            btn.addEventListener('click', () => {
                wrap.querySelector(`[data-doc-input="${btn.dataset.docUpload}"]`)?.click();
            });
        });
        wrap.querySelectorAll('[data-doc-input]').forEach((input) => {
            input.addEventListener('change', async () => {
                const file = input.files && input.files[0];
                const type = input.dataset.docInput;
                input.value = '';
                if (!file) return;
                const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
                if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
                    toast('Usá PDF, JPG, PNG o WebP de hasta 10 MB', false);
                    return;
                }
                let path = null;
                try {
                    path = `${user.id}/${type}-${Date.now()}.${fileExt(file)}`;
                    await uploadTo('artist-verification', path, file);
                    const result = await D.VerificationDocs.replace({
                        artistUserId: user.id,
                        docType: type,
                        fileName: file.name,
                        storagePath: path
                    });
                    const oldPath = result?.previous?.storage_path;
                    let cleanupComplete = true;
                    if (oldPath && oldPath !== path) {
                        cleanupComplete = await removeOrQueueVerificationPath(oldPath);
                    }
                    verifDocs = await D.VerificationDocs.list(user.id);
                    renderDocs();
                    toast(result?.previous
                        ? (cleanupComplete ? 'Documento reemplazado' : 'Documento reemplazado; limpieza anterior pendiente')
                        : 'Documento subido', cleanupComplete);
                } catch (err) {
                    console.error('[account] subir documento:', err);
                    if (path) await removeOrQueueVerificationPath(path);
                    toast('No pudimos subir el documento', false);
                }
            });
        });
        wrap.querySelectorAll('[data-doc-view]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const doc = verifDocs.find((item) => item.id === btn.dataset.docView);
                if (!doc?.storage_path) return;
                try {
                    const { data, error } = await _supabase.storage.from('artist-verification').createSignedUrl(doc.storage_path, 60);
                    if (error) throw error;
                    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
                } catch (error) {
                    console.error('[account] abrir documento:', error);
                    toast('No pudimos abrir el documento', false);
                }
            });
        });
        wrap.querySelectorAll('[data-doc-del]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!window.confirm('¿Querés eliminar este documento?')) return;
                try {
                    const doc = verifDocs.find((item) => item.id === btn.dataset.docDel);
                    await D.VerificationDocs.delete(btn.dataset.docDel);
                    const cleanupComplete = await removeOrQueueVerificationPath(doc?.storage_path);
                    verifDocs = await D.VerificationDocs.list(user.id);
                    renderDocs();
                    toast(cleanupComplete ? 'Documento eliminado' : 'Documento eliminado; limpieza del archivo pendiente', cleanupComplete);
                } catch (err) {
                    console.error('[account] eliminar documento:', err);
                    verifDocs = await D.VerificationDocs.list(user.id).catch(() => verifDocs);
                    renderDocs();
                    toast('No pudimos eliminar el documento', false);
                }
            });
        });
    }

    // ============================================
    // 9 · Configuración
    // ============================================

    async function setupSettings() {
        const cur = window.WeOtziCurrency;
        if (cur && typeof cur.init === 'function') await cur.init().catch(() => null);
        const catalog = cur && typeof cur.list === 'function' && cur.list().length
            ? cur.list()
            : [{ code: 'USD', symbol: '$' }, { code: 'EUR', symbol: '€' }, { code: 'ARS', symbol: '$' }];

        const currencySel = $('aac-currency');
        currencySel.innerHTML = '<option value="">Seleccioná una moneda</option>' + catalog.map((c) =>
            `<option value="${esc(c.code)}">${esc(c.code)}${c.symbol ? ` (${esc(c.symbol)})` : ''}</option>`
        ).join('');
        currencySel.value = artist.preferred_display_currency || '';

        const detectedTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Argentina/Buenos_Aires';
        const tzList = TIMEZONES.includes(detectedTz) ? TIMEZONES : [detectedTz, ...TIMEZONES];
        const tzSel = $('aac-timezone');
        tzSel.innerHTML = tzList.map((tz) => `<option value="${esc(tz)}">${esc(tz.replace(/_/g, ' '))}</option>`).join('');

        let s = { ...DEFAULT_APP_SETTINGS, ...appSettings() };
        $('aac-setting-country').value = s.country || artist.country || '';
        $('aac-setting-city').value = s.city || artist.city || '';
        tzSel.value = s.timezone && tzList.includes(s.timezone) ? s.timezone : detectedTz;
        $('aac-dateformat').value = s.date_format;
        $('aac-timeformat').value = s.time_format;
        $('aac-language').value = s.language;
        $('aac-text-size').value = s.text_size;
        $('aac-animations').checked = s.animations !== false;
        $('aac-start-page').value = s.start_page;
        $('aac-confirm-logout').checked = s.confirm_logout !== false;
        $('aac-reduce-motion').checked = !!s.reduce_motion;
        $('aac-high-contrast').checked = !!s.high_contrast;
        $('aac-interface-scale').value = String(s.interface_scale);
        $('aac-page-size').value = String(s.page_size);
        $('aac-default-sort').value = s.default_sort;
        setSegmentState('theme', s.theme);
        setSegmentState('density', s.density);
        setSegmentState('display_name', s.display_name);
        applyAppearanceSettings(s);

        currencySel.addEventListener('change', async () => {
            try {
                await updateArtist({ preferred_display_currency: currencySel.value || null });
                toast('Moneda preferida guardada');
            } catch (err) {
                console.error('[account] moneda:', err);
                toast('No pudimos guardar la moneda', false);
            }
        });

        const saveSetting = (patch) => savePrefs('app_settings', patch)
            .then(() => {
                s = { ...s, ...patch };
                applyAppearanceSettings(s);
                toast('Preferencia guardada');
            })
            .catch((err) => {
                console.error('[account] configuración:', err);
                toast('No pudimos guardar la preferencia', false);
            });
        tzSel.addEventListener('change', () => saveSetting({ timezone: tzSel.value }));
        $('aac-dateformat').addEventListener('change', () => saveSetting({ date_format: $('aac-dateformat').value }));
        $('aac-timeformat').addEventListener('change', () => saveSetting({ time_format: $('aac-timeformat').value }));
        $('aac-language').addEventListener('change', () => saveSetting({ language: $('aac-language').value }));
        $('aac-text-size').addEventListener('change', () => saveSetting({ text_size: $('aac-text-size').value }));
        $('aac-animations').addEventListener('change', () => saveSetting({ animations: $('aac-animations').checked }));
        $('aac-start-page').addEventListener('change', () => saveSetting({ start_page: $('aac-start-page').value }));
        $('aac-confirm-logout').addEventListener('change', () => saveSetting({ confirm_logout: $('aac-confirm-logout').checked }));
        $('aac-reduce-motion').addEventListener('change', () => saveSetting({ reduce_motion: $('aac-reduce-motion').checked }));
        $('aac-high-contrast').addEventListener('change', () => saveSetting({ high_contrast: $('aac-high-contrast').checked }));
        $('aac-interface-scale').addEventListener('change', () => saveSetting({ interface_scale: $('aac-interface-scale').value }));
        $('aac-page-size').addEventListener('change', () => saveSetting({ page_size: $('aac-page-size').value }));
        $('aac-default-sort').addEventListener('change', () => saveSetting({ default_sort: $('aac-default-sort').value }));

        document.querySelectorAll('[data-setting][data-value]').forEach((button) => {
            button.addEventListener('click', () => {
                setSegmentState(button.dataset.setting, button.dataset.value);
                saveSetting({ [button.dataset.setting]: button.dataset.value });
            });
        });

        const saveRegion = debounce(async () => {
            const country = $('aac-setting-country').value.trim();
            const city = $('aac-setting-city').value.trim();
            try {
                await updateArtist({ country: country || null, city: city || null });
                await saveSetting({ country, city });
                $('aac-country').value = country;
                $('aac-city').value = city;
            } catch (error) {
                console.error('[account] región:', error);
                toast('No pudimos guardar la región', false);
            }
        }, 600);
        $('aac-setting-country').addEventListener('input', saveRegion);
        $('aac-setting-city').addEventListener('input', saveRegion);

        $('aac-reset-settings').addEventListener('click', async () => {
            if (!window.confirm('¿Querés restablecer las preferencias de la aplicación?')) return;
            try {
                await savePrefs('app_settings', DEFAULT_APP_SETTINGS);
                window.location.reload();
            } catch (error) {
                console.error('[account] restablecer configuración:', error);
                toast('No pudimos restablecer las preferencias', false);
            }
        });
    }

    function setSegmentState(setting, value) {
        document.querySelectorAll(`[data-setting="${setting}"]`).forEach((button) => {
            const active = button.dataset.value === String(value);
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    function applyAppearanceSettings(settings) {
        const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const resolvedTheme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
        document.body.dataset.aacTheme = resolvedTheme || 'light';
        document.body.dataset.aacDensity = settings.density || 'comfortable';
        document.body.dataset.aacTextSize = settings.text_size || 'medium';
        document.body.classList.toggle('aac-no-animations', settings.animations === false || !!settings.reduce_motion);
        document.body.classList.toggle('aac-high-contrast', !!settings.high_contrast);
        document.documentElement.style.fontSize = `${Math.max(90, Math.min(125, Number(settings.interface_scale) || 100))}%`;
    }
})();
