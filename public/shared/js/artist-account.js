// ============================================
// Centro de la cuenta del artista (/artist/account) — DS Bauhaus
// Figma final "We Otzi Pantallas final" (oct 2026, fileKey w3JA83CcP5ISKjyOu87mx1):
//   801:565 Mi perfil y redes · 801:566 Gestionar portafolio
//   801:568/569/570 Cobros · We Ötzi Wallet (wallet-account.js)
//   801:571/1110 Disponibilidad por ubicación · 801:572 Notificaciones
//   801:575 Seguridad y recuperación · 801:573 Verificación · 801:574 Configuración
// SPA por secciones con ruteo por hash (#perfil … #configuracion).
// Estados por URL para QA: ?vista=editar|guardado#disponibilidad,
//   ?modal=agregar-destino|card|datos-fiscales#cobros, ?modal=travel#disponibilidad,
//   ?modal=telefono|pregunta#seguridad.
// Datos: SOLO via window.WeotziData.* (artists/quotations/account repos);
// auth y storage directo sobre el cliente supabase-js (excepciones legítimas).
// Modo asistido (wo-assist.js): las secciones llevan anclas data-assist
// ("<paso>.<check>") y cada guardado exitoso dispara `wo:assist-refresh`
// en document con { section }. Validación de Instagram del portafolio vía
// GET/POST /api/artist/instagram-verification (degrada si no hay backend).
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;
    const D = window.WeotziData;
    const AV = window.WoAccountAvailability;
    const CM = window.WoAccountContact;        // account-contact-model.js (WhatsApp / email)
    const GV = window.WoGalleryVisibility;     // gallery-visibility.js (fotos de IG pendientes)

    const SECTIONS = ['perfil', 'portafolio', 'cobros', 'disponibilidad', 'notificaciones',
        'seguridad', 'verificacion', 'configuracion'];

    const LANGS = ['Español', 'Inglés', 'Portugués', 'Francés', 'Italiano', 'Alemán'];
    const FALLBACK_STYLES = ['Realismo', 'Black & grey', 'Fine line', 'Blackwork', 'Tradicional', 'Neotradicional',
        'Japonés', 'Geométrico', 'Dotwork', 'Lettering', 'Acuarela', 'Minimalista', 'Ornamental', 'Anime'];
    const PRICE_CURRENCIES = ['USD', 'EUR', 'ARS', 'MXN', 'COP', 'CLP', 'PEN', 'BRL', 'GBP'];

    // Evento → defaults Email / Push / SMS (ref 801:572).
    const NOTIF_EVENTS = [
        ['mensajes', 'Mensajes', true, true, false],
        ['cotizaciones', 'Cotizaciones', true, true, true],
        ['invitaciones', 'Invitaciones', true, true, false],
        ['spots', 'Spots', true, false, false],
        ['job_board', 'Job Board', false, true, false],
        ['calendario', 'Calendario', true, true, false],
        ['promociones', 'Promociones', false, false, false]
    ];

    // Tipo, nombre y si es obligatorio (identidad y domicilio; bioseguridad
    // suma confianza pero es opcional). isVerified() sigue mirando identidad.
    const DOC_TYPES = [
        ['identidad', 'Documento de identidad', true],
        ['bioseguridad', 'Certificado de bioseguridad', false],
        ['domicilio', 'Comprobante de domicilio', true]
    ];

    const WORK_CATEGORIES = [['realizados', 'Realizado'], ['flash', 'Flash'], ['proyectos', 'Proyecto']];

    // Validación de Instagram (servicio Express; 503 sin la migración 20261030120000).
    const IG_ENDPOINT = '/api/artist/instagram-verification';
    const IG_POLL_MS = 20000;
    const IG_FOLLOW_URL = 'https://www.instagram.com/weotzi/';
    const IG_DEMO_CODE = 'WO-DEMO42';

    // Modalidad de trabajo (lib/artist-registration.js ALLOWED_WORK_TYPES) y
    // valores legacy de artists_db.estudios / artist_tattoo_locations.
    const WORK_TYPES = ['studio', 'independent', 'both'];
    const INDEPENDENT_STUDIO = 'Sin estudio/Independiente';
    const PRIVATE_STUDIO_NAME = 'ESTUDIO PRIVADO';
    const MODALITY_HINTS = {
        studio: 'Tatuás en un estudio: queda como tu estudio base en Ubicaciones.',
        independent: 'Tatuás por tu cuenta, en tu propio espacio o a domicilio.',
        both: 'Combinás un estudio con tu propio espacio: el estudio queda como tu base.'
    };

    const TIMEZONES = [
        'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago',
        'America/Sao_Paulo', 'America/Bogota', 'America/Lima', 'America/Mexico_City',
        'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/Lisbon',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome'
    ];
    const COUNTRIES = ['Argentina', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Costa Rica', 'Ecuador', 'España',
        'Estados Unidos', 'Guatemala', 'México', 'Paraguay', 'Perú', 'Portugal', 'Uruguay', 'Venezuela',
        'Alemania', 'Francia', 'Italia', 'Reino Unido', 'Canadá', 'Australia'];

    const MIN_WORK_SLOTS = 8;
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

    const DEFAULT_APP_SETTINGS = {
        timezone: 'America/Argentina/Buenos_Aires', date_format: 'DD/MM/AAAA', time_format: '24h',
        language: 'es', theme: 'light', density: 'comfortable', text_size: 'medium', animations: true,
        start_page: 'dashboard', confirm_logout: true, reduce_motion: false, high_contrast: false,
        interface_scale: '100', display_name: 'artistic', page_size: '25', default_sort: 'recent'
    };

    let user = null;
    let artist = null;
    let extras = null;          // estilos, experiencia, tarifa, WhatsApp, newsletter
    let prefs = null;           // fila de user_preferences (o null)
    let works = [];             // gallery_feed_items normalizados
    let notifMatrix = {};
    let verifAvailable = false;
    let verifDocs = [];
    let integrations = [];
    let integrationsAvailable = false;
    let currentSessionId = null;
    let accountSessions = [];
    let verifiedMfaFactors = [];
    let pendingMfaFactor = null;
    let toastTimer = null;
    let langsPicker = null;
    let stylesPicker = null;
    const avState = { locations: [], activeId: null, editing: false, drafts: {}, virtual: false };
    // Id de la ubicación base sin fila en artist_tattoo_locations (avState.virtual).
    const VIRTUAL_BASE_ID = 'base';
    let phoneStage = 'number';
    // Estado de la validación de Instagram (objeto `instagram` del endpoint).
    const igState = { data: null, loading: false, busy: false, signature: '', lastRequest: null, pollTimer: null };
    // Typeahead del estudio en Modalidad de trabajo.
    const modeState = { selected: null, results: [], active: -1, token: 0, timer: null };

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
        [prefs, extras] = await Promise.all([
            D.Prefs.get(user.id).catch(() => null),
            D.AccountProfile ? D.AccountProfile.getExtras(user.id).catch((err) => { console.warn('[account] oficio:', err); return null; }) : null
        ]);

        setupDialogs();
        applyAppearanceSettings({ ...DEFAULT_APP_SETTINGS, ...appSettings() });
        fillProfile();
        setupProfile();
        setupContact();
        works = normalizeWorks(artist.gallery_feed_items, artist.gallery_images);
        renderWorks();
        setupWorks();
        setupIgVerification();
        const availabilityReady = setupAvailability().catch((err) => console.error('[account] disponibilidad:', err));
        setupModality();
        renderNotifMatrix();
        setupSecurity().catch((err) => console.error('[account] seguridad:', err));
        loadVerifDocs();
        setupSettings().catch((err) => console.error('[account] configuración:', err));
        if (window.AacWallet) {
            window.AacWallet.init({
                D, user, artist, esc, toast, savePrefs, appSettings,
                isVerified, profileFullName: () => profilePrefs().full_name || ''
            }).catch((err) => console.error('[account] wallet:', err));
        }

        applyHash();
        window.addEventListener('hashchange', applyHash);
        openStateFromQuery(availabilityReady);
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
            if (appSettings().confirm_logout !== false && !window.confirm('¿Querés cerrar tu sesión?')) return;
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
            syncMfaToggle();
            if (!abandonedFactor?.id || !_supabase.auth.mfa?.unenroll) return;
            const { error } = await _supabase.auth.mfa.unenroll({ factorId: abandonedFactor.id });
            if (error) console.warn('[account] limpiar factor MFA incompleto:', error);
        });
    }

    function currentSection() {
        const raw = (window.location.hash || '').replace('#', '');
        return SECTIONS.includes(raw) ? raw : 'perfil';
    }

    function applyHash() {
        const active = currentSection();
        SECTIONS.forEach((s) => {
            const sec = $('aac-' + s);
            if (sec) sec.hidden = s !== active;
        });
        let activeNav = null;
        document.querySelectorAll('[data-aac-nav]').forEach((item) => {
            const isActive = item.getAttribute('data-aac-nav') === active;
            item.classList.toggle('is-active', isActive);
            if (isActive) { activeNav = item; item.setAttribute('aria-current', 'page'); }
            else item.removeAttribute('aria-current');
        });
        document.querySelectorAll('[data-aac-only]').forEach((el) => { el.hidden = el.dataset.aacOnly !== active; });
        // Las pestañas de ubicaciones se midieron ocultas: recalcular al mostrarlas.
        if (active === 'disponibilidad') requestAnimationFrame(revealActiveTab);
        activeNav?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        window.scrollTo({ top: 0 });
    }

    async function openStateFromQuery(availabilityReady) {
        const params = new URLSearchParams(window.location.search);
        const section = currentSection();
        const vista = params.get('vista');
        const modal = params.get('modal');
        if (section === 'perfil' && vista === 'oficio') {
            const details = $('aac-oficio');
            if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); }
        }
        if (section === 'disponibilidad') {
            // Las ubicaciones se cargan async: el banner necesita la ubicación activa.
            await availabilityReady;
            if (vista === 'editar') enterAvailabilityEdit();
            if (vista === 'guardado') showAvailabilitySaved(activeLocation());
            if (modal === 'travel') openTravelDialog();
        }
        if (section === 'seguridad') {
            if (modal === 'telefono') openPhoneDialog();
            if (modal === 'pregunta') openQuestionDialog();
        }
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

    // Modo demo (wo-demo.js): auth y la API Express no pasan por el emulador,
    // así que esas acciones se simulan o se frenan.
    function isDemo() {
        return !!(window.WoDemo && window.WoDemo.enabled);
    }

    // Rutas internas respetando el base path (/beta en producción, preview local).
    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        if (base && (path === base || String(path).indexOf(base + '/') === 0)) return path;
        return base + path;
    }

    // Avisa al panel del modo asistido (wo-assist.js) que vuelva a pedir su estado.
    function assistRefresh(section) {
        try {
            document.dispatchEvent(new CustomEvent('wo:assist-refresh', { detail: { section } }));
        } catch (err) { console.warn('[account] wo:assist-refresh:', err); }
    }

    // Error en línea de un campo: <id>-error + aria-invalid en el input.
    function setFieldError(inputId, message) {
        const input = $(inputId);
        const el = $(inputId + '-error');
        if (el) { el.textContent = message || ''; el.hidden = !message; }
        if (!input) return;
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
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

    function formatShortDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
            .format(date).replace('.', '');
    }

    // "2 nov, 00:57": reloj de 24 h (con 12 h ICU escribe "12:57 a. m." y el
    // recorte del punto lo dejaba en "a m.."). Solo se le saca el punto al mes,
    // que algunos ICU escriben "nov.".
    function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            .formatToParts(date)
            .map((part) => (part.type === 'month' ? part.value.replace(/\.$/, '') : part.value))
            .join('');
    }

    function formatLongDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const parts = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
        const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
        return `${get('day')} de ${get('month')}, ${get('year')}`;
    }

    function relativeTime(value) {
        const t = Date.parse(value);
        if (Number.isNaN(t)) return '';
        const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
        if (mins < 5) return 'Activo ahora';
        if (mins < 60) return `Hace ${mins} minutos`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
        const days = Math.round(hours / 24);
        return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
    }

    // ============================================
    // Multiselección (Idiomas / Estilos)
    // ============================================

    function createMulti(container, { options, selected, labelId, placeholder }) {
        let values = [...new Set(selected || [])];
        let all = [...options];
        values.forEach((v) => { if (!all.includes(v)) all.push(v); });
        const menuId = container.id + '-menu';
        container.innerHTML = `
            <button type="button" class="aac-multi-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${menuId}" aria-labelledby="${labelId} ${container.id}-value">
                <span class="aac-multi-value" id="${container.id}-value"></span>
                <i data-wo-icon="chevron-down" aria-hidden="true"></i>
            </button>
            <div class="aac-multi-menu" id="${menuId}" role="listbox" aria-multiselectable="true" hidden></div>`;
        const trigger = container.querySelector('.aac-multi-trigger');
        const menu = container.querySelector('.aac-multi-menu');
        const valueEl = container.querySelector('.aac-multi-value');

        function paintValue() {
            valueEl.textContent = values.length ? values.join(', ') : placeholder;
            valueEl.classList.toggle('is-empty', !values.length);
        }
        function paintMenu() {
            menu.innerHTML = all.map((opt, i) => `
                <label class="aac-multi-option" role="option" aria-selected="${values.includes(opt)}">
                    <input type="checkbox" value="${esc(opt)}" ${values.includes(opt) ? 'checked' : ''} id="${container.id}-opt-${i}">
                    <span>${esc(opt)}</span>
                </label>`).join('');
        }
        function setOpen(open) {
            menu.hidden = !open;
            trigger.setAttribute('aria-expanded', String(open));
            if (open) menu.querySelector('input')?.focus();
        }
        trigger.addEventListener('click', () => setOpen(menu.hidden));
        menu.addEventListener('change', (event) => {
            const input = event.target.closest('input[type="checkbox"]');
            if (!input) return;
            if (input.checked) values.push(input.value);
            else values = values.filter((v) => v !== input.value);
            input.closest('.aac-multi-option').setAttribute('aria-selected', String(input.checked));
            paintValue();
        });
        document.addEventListener('click', (event) => {
            if (!menu.hidden && !container.contains(event.target)) setOpen(false);
        });
        container.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !menu.hidden) { setOpen(false); trigger.focus(); }
        });
        paintValue();
        paintMenu();
        return {
            get: () => [...values],
            setOptions(next) {
                all = [...new Set([...(next || []), ...values])];
                paintMenu();
            }
        };
    }

    // ============================================
    // 1 · Mi perfil (+ oficio y tarifa)
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
        $('aac-instagram').value = artist.instagram ? normalizeHandle(artist.instagram) : '';
        $('aac-tiktok').value = p.tiktok || '';
        $('aac-website').value = artist.portafolio || '';

        langsPicker = createMulti($('aac-langs'), {
            options: LANGS,
            selected: Array.isArray(artist.languages) ? artist.languages : [],
            labelId: 'aac-langs-label',
            placeholder: 'Elegí tus idiomas'
        });

        const styles = Array.isArray(extras?.styles_array) ? extras.styles_array
            : String(extras?.estilo || '').split(',').map((s) => s.trim()).filter(Boolean);
        stylesPicker = createMulti($('aac-styles'), {
            options: FALLBACK_STYLES,
            selected: styles,
            labelId: 'aac-styles-label',
            placeholder: 'Elegí tus estilos'
        });
        if (window.ConfigManager?.loadTattooStylesFlatFromDB) {
            window.ConfigManager.loadTattooStylesFlatFromDB().then((rows) => {
                const names = (rows || []).filter((r) => r && r.is_active !== false).map((r) => r.display_name || r.name).filter(Boolean);
                if (names.length) stylesPicker.setOptions(names);
            }).catch(() => null);
        }

        setExperience(extras?.years_experience);
        $('aac-price-currency').innerHTML = PRICE_CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join('');
        const priceCurrency = extras?.session_price_currency || artist.session_price_currency || 'USD';
        if (!PRICE_CURRENCIES.includes(priceCurrency)) $('aac-price-currency').insertAdjacentHTML('beforeend', `<option value="${esc(priceCurrency)}">${esc(priceCurrency)}</option>`);
        $('aac-price-currency').value = priceCurrency;
        $('aac-price').value = extras?.session_price_amount ?? '';
        $('aac-contact-whatsapp').value = extras?.whatsapp_number || '';

        setDropMedia($('aac-photo-drop'), artist.profile_picture, 'Foto de perfil');
        setDropMedia($('aac-banner-drop'), p.banner_url, 'Banner de perfil');
    }

    // years_experience guarda rangos ("3-5") o, en datos viejos, años sueltos.
    function setExperience(value) {
        const sel = $('aac-experience');
        const raw = value == null ? '' : String(value).trim();
        const n = Number(raw);
        let range = raw;
        if (raw && Number.isFinite(n) && !/-|\+/.test(raw)) {
            range = n < 1 ? '0-1' : n < 3 ? '1-3' : n < 5 ? '3-5' : n < 10 ? '5-10' : '10+';
        }
        if (range && !Array.from(sel.options).some((o) => o.value === range)) {
            sel.insertAdjacentHTML('beforeend', `<option value="${esc(range)}">${esc(range)}</option>`);
        }
        sel.value = range;
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
            assertImage(file);
            const url = await uploadTo('profile-pictures', `${user.id}/banner-${Date.now()}.${fileExt(file)}`, file);
            const p = { ...profilePrefs(), banner_url: url };
            await savePrefs('app_settings', { profile: p });
            setDropMedia($('aac-banner-drop'), url, 'Banner de perfil');
            toast('Banner actualizado');
            assistRefresh('perfil');
        });
        wireDrop($('aac-photo-drop'), $('aac-photo-input'), async (file) => {
            assertImage(file);
            const url = await uploadTo('profile-pictures', `${user.id}/${Date.now()}.${fileExt(file)}`, file);
            await updateArtist({ profile_picture: url });
            setDropMedia($('aac-photo-drop'), url, 'Foto de perfil');
            toast('Foto de perfil actualizada');
            assistRefresh('perfil');
        });

        $('aac-profile-save').addEventListener('click', saveProfile);
        $('aac-oficio-save').addEventListener('click', saveOficio);
    }

    function assertImage(file) {
        if (!file.type.startsWith('image/')) throw new Error('Formato no admitido');
        if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen supera los 15 MB');
    }

    // Dropzone: click (label ya abre el input), drag & drop y subida.
    function wireDrop(drop, input, onFile) {
        if (!drop || !input) return;
        const run = async (file) => {
            try { await onFile(file); }
            catch (err) {
                console.error('[account] upload:', err);
                toast(/15 MB|Formato/.test(err?.message || '') ? err.message : 'No pudimos subir la imagen', false);
            }
        };
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (file) run(file);
        });
        ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
        }));
        drop.addEventListener('drop', (e) => {
            const file = e.dataTransfer?.files && e.dataTransfer.files[0];
            if (file) run(file);
        });
    }

    function normalizeHandle(value) {
        const v = String(value || '').trim().replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, '').replace(/\/+$/, '');
        if (!v) return '';
        return v.startsWith('@') ? v : '@' + v;
    }

    async function saveProfile() {
        const btn = $('aac-profile-save');
        const errEl = $('aac-username-error');
        errEl.hidden = true;
        $('aac-username').removeAttribute('aria-invalid');
        setFieldError('aac-contact-whatsapp', '');

        const username = $('aac-username').value.trim().toLowerCase();
        if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
            errEl.textContent = 'El nombre de usuario lleva entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.';
            errEl.hidden = false;
            $('aac-username').setAttribute('aria-invalid', 'true');
            $('aac-username').focus();
            return;
        }
        // Un WhatsApp guardado antes del formato internacional (por ejemplo
        // "11 5555-1234") no frena el resto del perfil: solo se valida si el
        // artista tocó el campo. Sin cambios, saveWhatsapp no escribe nada.
        const storedWhatsapp = extras?.whatsapp_number || null;
        const whatsappUntouched = $('aac-contact-whatsapp').value.trim() === String(storedWhatsapp || '').trim();
        const whatsapp = whatsappUntouched
            ? { ok: true, value: storedWhatsapp }
            : CM
                ? CM.normalizeWhatsapp($('aac-contact-whatsapp').value)
                : { ok: true, value: $('aac-contact-whatsapp').value.trim() || null };
        if (!whatsapp.ok) {
            setFieldError('aac-contact-whatsapp', whatsapp.error);
            $('aac-contact-whatsapp').focus();
            return;
        }
        btn.disabled = true;
        try {
            if (username !== (artist.username || '').toLowerCase()) {
                const { data: taken } = await D.Artists.isUsernameAvailable(username, user.id);
                if (taken && taken.length) {
                    errEl.textContent = 'Ese nombre de usuario ya está en uso.';
                    errEl.hidden = false;
                    $('aac-username').setAttribute('aria-invalid', 'true');
                    return;
                }
            }

            const instagram = normalizeHandle($('aac-instagram').value);
            await updateArtist({
                name: $('aac-name').value.trim() || null,
                username,
                languages: langsPicker.get(),
                bio_description: $('aac-bio').value.trim() || null,
                city: $('aac-city').value.trim() || null,
                country: $('aac-country').value.trim() || null,
                instagram: instagram ? instagram.replace(/^@/, '') : null,
                portafolio: $('aac-website').value.trim() || null
            });

            const p = {
                ...profilePrefs(),
                full_name: $('aac-fullname').value.trim(),
                tiktok: normalizeHandle($('aac-tiktok').value)
            };
            await savePrefs('app_settings', { profile: p });

            $('aac-setting-city').value = artist.city || '';
            setCountrySelect(artist.country || '');
            const whatsappSaved = await saveWhatsapp(whatsapp.value);
            toast(whatsappSaved ? 'Cambios guardados' : 'Guardamos tu perfil, pero no el WhatsApp', whatsappSaved);
            renderIgVerify();
            assistRefresh('perfil');
        } catch (err) {
            console.error('[account] guardar perfil:', err);
            toast('No pudimos guardar los cambios', false);
        } finally {
            btn.disabled = false;
        }
    }

    // El WhatsApp va en un UPDATE aparte: trigger_sync_artist_to_auth lo copia a
    // auth.users.phone (único) y un número repetido no tiene que frenar el
    // resto del perfil. Devuelve false si no se pudo guardar.
    async function saveWhatsapp(value) {
        const input = $('aac-contact-whatsapp');
        if ((value || null) === (extras?.whatsapp_number || null)) {
            input.value = value || '';
            return true;
        }
        try {
            await updateArtist({ whatsapp_number: value });
            extras = { ...(extras || {}), whatsapp_number: value };
            input.value = value || '';
            return true;
        } catch (err) {
            console.error('[account] whatsapp:', err);
            setFieldError('aac-contact-whatsapp', CM && CM.isDuplicatePhoneError(err)
                ? CM.MESSAGES.whatsappDuplicate
                : 'No pudimos guardar el WhatsApp. Probá de nuevo.');
            return false;
        }
    }

    // ---- Contacto: email de acceso ----

    function setupContact() {
        const email = $('aac-contact-email');
        if (!email) return;
        email.value = user.email || '';
        renderEmailHelp();
        email.addEventListener('change', onEmailChange);
        email.addEventListener('input', () => setFieldError('aac-contact-email', ''));
        $('aac-contact-whatsapp').addEventListener('input', () => setFieldError('aac-contact-whatsapp', ''));
        syncArtistEmail();
    }

    function renderEmailHelp(message) {
        const help = $('aac-contact-email-help');
        if (!help) return;
        const pending = user.new_email && !(CM ? CM.sameEmail(user.new_email, user.email) : user.new_email === user.email);
        help.textContent = message
            || (pending ? `Cambio pendiente: confirmá el enlace que te enviamos a ${user.new_email}.`
                : 'Es el correo con el que entrás a We Ötzi. Si lo cambiás, te mandamos un enlace para confirmarlo.');
    }

    // El cambio de correo es de auth: Supabase manda un enlace y lo aplica al
    // confirmarlo. En el demo no se toca (auth no pasa por el emulador).
    async function onEmailChange() {
        const input = $('aac-contact-email');
        setFieldError('aac-contact-email', '');
        const email = CM ? CM.normalizeEmail(input.value) : input.value.trim().toLowerCase();
        const unchanged = !email || (CM ? CM.sameEmail(email, user.email) : email === String(user.email || '').toLowerCase());
        if (unchanged) { input.value = user.email || ''; return; }
        if (!(CM ? CM.isValidEmail(email) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
            setFieldError('aac-contact-email', CM ? CM.MESSAGES.emailInvalid : 'Ingresá un correo válido.');
            return;
        }
        if (isDemo()) {
            input.value = user.email || '';
            toast('En el modo demo no se guardan cambios de correo', false);
            return;
        }
        input.disabled = true;
        try {
            const { error } = await _supabase.auth.updateUser({ email });
            if (error) throw error;
            user.new_email = email;
            input.value = user.email || '';
            renderEmailHelp(`Te enviamos un enlace a ${email}. El cambio se aplica cuando lo confirmes.`);
            toast('Te enviamos un enlace para confirmar el correo');
            assistRefresh('perfil');
        } catch (err) {
            console.error('[account] cambiar email:', err);
            setFieldError('aac-contact-email', /already|registered|exists/i.test(err?.message || '')
                ? 'Ese correo ya está asociado a otra cuenta de We Ötzi.'
                : 'No pudimos pedir el cambio de correo. Probá de nuevo.');
        } finally {
            input.disabled = false;
        }
    }

    // artists_db.email sigue al correo de acceso confirmado (por ejemplo después
    // de confirmar un cambio desde el enlace). En el demo no se escribe nada.
    async function syncArtistEmail() {
        if (isDemo() || !CM || !user?.email || CM.sameEmail(user.email, artist.email)) return;
        try { await updateArtist({ email: CM.normalizeEmail(user.email) }); }
        catch (err) { console.warn('[account] sincronizar email:', err); }
    }

    // Oficio y tarifa (antes en /artist/profile/details; plegado debajo de Mi
    // perfil porque el Figma no lo dibuja). Columnas opcionales de artists_db.
    async function saveOficio() {
        const btn = $('aac-oficio-save');
        const priceRaw = $('aac-price').value.trim();
        const price = priceRaw === '' ? null : Number(priceRaw);
        if (price !== null && (!Number.isFinite(price) || price < 0)) {
            toast('Ingresá una tarifa válida', false);
            $('aac-price').focus();
            return;
        }
        const styles = stylesPicker.get();
        const currency = $('aac-price-currency').value || 'USD';
        const oficio = {
            styles_array: styles,
            estilo: styles.join(', ') || null,
            years_experience: $('aac-experience').value || null,
            session_price_amount: price,
            session_price_currency: price !== null ? currency : null,
            session_price: price !== null ? `${price} ${currency}` : null
        };
        btn.disabled = true;
        try {
            await updateArtist(oficio);
            extras = { ...(extras || {}), ...oficio };
            toast('Oficio y tarifa guardados');
            assistRefresh('perfil');
        } catch (err) {
            console.error('[account] oficio y tarifa:', err);
            toast('No pudimos guardar oficio y tarifa', false);
        } finally {
            btn.disabled = false;
        }
    }

    // ============================================
    // 2 · Gestionar portafolio
    // ============================================

    function isVideoUrl(url) {
        const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
        return ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
    }

    function normalizeCategory(raw) {
        const v = String(raw || '').trim().toLowerCase();
        if (['flash', 'flash_disponibles', 'available_flash'].includes(v)) return 'flash';
        if (['proyectos', 'proyecto', 'projects', 'project'].includes(v)) return 'proyectos';
        return 'realizados';
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
                ...raw,
                url,
                category: normalizeCategory(raw?.category),
                kind: raw?.kind === 'video' || raw?.media_type === 'video' || isVideoUrl(url) ? 'video' : 'image',
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
        const catOptions = (current) => WORK_CATEGORIES.map(([v, l]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`).join('');
        // Fotos de Instagram que el cliente todavía no ve (gallery-visibility.js).
        const visibility = igVisibilityState();
        const pendingCount = pendingWorksCount(visibility);
        const cells = works.map((item, i) => {
            const pending = isPendingWork(item, visibility);
            const label = `Trabajo ${i + 1}${pending ? ' · pendiente de validación' : ''}`;
            return `
            <div class="aac-work${pending ? ' is-pending' : ''}">
                ${item.kind === 'video'
                    ? `<video src="${esc(item.url)}" preload="metadata" muted playsinline aria-label="${label} (video)"></video>`
                    : `<img src="${esc(item.url)}" alt="${label}" loading="lazy">`}
                ${pending ? '<span class="aac-work-badge">Pendiente de validación</span>' : ''}
                <div class="aac-work-tools">
                    <select class="aac-work-cat" data-work-cat="${i}" aria-label="Categoría del trabajo ${i + 1}">${catOptions(item.category)}</select>
                    <button type="button" class="aac-work-btn" data-work-up="${i}" aria-label="Mover antes" ${i === 0 ? 'disabled' : ''}><i data-wo-icon="arrow-left" aria-hidden="true"></i></button>
                    <button type="button" class="aac-work-btn" data-work-down="${i}" aria-label="Mover después" ${i === works.length - 1 ? 'disabled' : ''}><i data-wo-icon="arrow-right" aria-hidden="true"></i></button>
                    <button type="button" class="aac-work-btn" data-work-del="${i}" aria-label="Quitar trabajo"><i data-wo-icon="trash-2" aria-hidden="true"></i></button>
                </div>
            </div>`;
        });
        for (let i = works.length; i < total; i++) {
            cells.push(`
            <button type="button" class="aac-drop aac-work-drop" data-work-add>
                <i data-wo-icon="image" aria-hidden="true"></i>
                <span class="aac-drop-title">Trabajo</span>
                <span class="aac-drop-hint">o <u>buscá archivos</u></span>
            </button>`);
        }
        grid.innerHTML = cells.join('');

        const summary = $('aac-works-summary');
        if (summary) {
            summary.hidden = !pendingCount;
            summary.textContent = !pendingCount ? ''
                : pendingCount === 1
                    ? '1 foto importada de Instagram está pendiente de validación: los clientes todavía no la ven.'
                    : `${pendingCount} fotos importadas de Instagram están pendientes de validación: los clientes todavía no las ven.`;
        }
        renderIgVerify();
    }

    function setupWorks() {
        const grid = $('aac-works');
        grid.addEventListener('click', (event) => {
            const btn = event.target.closest('button');
            if (!btn) return;
            if (btn.hasAttribute('data-work-add')) { $('aac-works-input').click(); return; }
            if (btn.dataset.workUp !== undefined) moveWork(Number(btn.dataset.workUp), -1);
            else if (btn.dataset.workDown !== undefined) moveWork(Number(btn.dataset.workDown), 1);
            else if (btn.dataset.workDel !== undefined) removeWork(Number(btn.dataset.workDel));
        });
        grid.addEventListener('change', async (event) => {
            const select = event.target.closest('[data-work-cat]');
            if (!select) return;
            const item = works[Number(select.dataset.workCat)];
            if (!item) return;
            item.category = select.value;
            try { await persistWorks(); toast('Categoría actualizada'); }
            catch (err) { console.error('[account] categoría:', err); toast('No pudimos guardar la categoría', false); }
        });
        // Arrastrar archivos sobre cualquier casillero vacío.
        grid.addEventListener('dragover', (e) => { if (e.target.closest('[data-work-add]')) { e.preventDefault(); e.target.closest('[data-work-add]').classList.add('dragover'); } });
        grid.addEventListener('dragleave', (e) => { e.target.closest('[data-work-add]')?.classList.remove('dragover'); });
        grid.addEventListener('drop', (e) => {
            const cell = e.target.closest('[data-work-add]');
            if (!cell) return;
            e.preventDefault();
            cell.classList.remove('dragover');
            addWorkFiles(Array.from(e.dataTransfer?.files || []));
        });

        $('aac-works-add').addEventListener('click', () => $('aac-works-input').click());
        $('aac-works-input').addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            addWorkFiles(files);
        });
        $('aac-works-ig').addEventListener('click', openInstagramImport);
    }

    async function addWorkFiles(list) {
        const files = list.filter((f) => (f.type.startsWith('image/') && f.size <= MAX_IMAGE_BYTES)
            || (/^video\/(mp4|quicktime)$/.test(f.type) && f.size <= MAX_VIDEO_BYTES));
        if (list.length && !files.length) { toast('Usá imágenes de hasta 15 MB o videos MP4/MOV de hasta 100 MB', false); return; }
        if (!files.length) return;
        let added = 0;
        try {
            for (const file of files) {
                const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt(file)}`;
                const url = await uploadTo('artist-gallery', path, file);
                if (url) {
                    works.push({ url, category: 'realizados', kind: file.type.startsWith('video/') ? 'video' : 'image', media_type: file.type.startsWith('video/') ? 'video' : 'image', created_at: new Date().toISOString() });
                    added += 1;
                }
            }
            await persistWorks();
            toast(added === 1 ? 'Trabajo agregado' : `${added} trabajos agregados`);
        } catch (err) {
            console.error('[account] portafolio:', err);
            toast('No pudimos subir los archivos', false);
        }
        renderWorks();
    }

    function openInstagramImport() {
        if (!window.IGImport?.open) { toast('La importación de Instagram no está disponible', false); return; }
        window.IGImport.open({
            target: 'artist',
            targetId: user.id,
            mode: 'dashboard',
            prefillHandle: artist.instagram || '',
            onComplete: async () => {
                try {
                    const { data } = await D.Artists.getAccountByUserId(user.id);
                    if (data) {
                        artist = { ...artist, ...data };
                        works = normalizeWorks(artist.gallery_feed_items, artist.gallery_images);
                        renderWorks();
                    }
                    toast('Importamos tus publicaciones de Instagram');
                    loadIgState();
                    assistRefresh('portafolio');
                } catch (err) { console.warn('[account] recargar portafolio:', err); }
            }
        });
    }

    async function persistWorks() {
        await updateArtist({
            gallery_feed_items: works,
            gallery_images: works.map((w) => w.url)
        });
        assistRefresh('portafolio');
    }

    // ============================================
    // 2b · Validación de Instagram del portafolio
    // ============================================
    // Las fotos importadas de Instagram se publican cuando el artista valida la
    // cuenta: código WO-XXXXXX por correo + mensaje directo a @weotzi desde esa
    // cuenta. Sin la migración el endpoint responde 503 y la tarjeta solo avisa.

    function igHandle() {
        const raw = String(artist?.instagram || '').trim()
            .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '');
        return GV ? GV.normalizeHandle(raw) : raw.replace(/^@+/, '').toLowerCase();
    }

    // { enforced, verified, handle } para gallery-visibility.js. Sin backend
    // (available false) no se exige nada: todo se ve como hasta ahora.
    function igVisibilityState() {
        const ig = igState.data;
        if (!GV || !ig) return { enforced: false, verified: false, handle: null };
        return GV.stateFrom({ ...ig, enforced: ig.available === true, handle: ig.verified_handle || ig.handle || null });
    }

    function isPendingWork(item, state) {
        return !!(GV && GV.isPendingValidation(item, state));
    }

    function pendingWorksCount(state) {
        return GV ? GV.pendingCount(works, state || igVisibilityState()) : 0;
    }

    // Endpoints Express del artista: WoDemo.api (fetch nativo + Bearer + base
    // path) si está; si no, fetch con el token de la sesión. Rechaza si !ok.
    async function igApi(path, { method = 'GET', body } = {}) {
        if (window.WoDemo && typeof window.WoDemo.api === 'function') {
            return window.WoDemo.api(path, body === undefined ? { method } : { method, body });
        }
        const { data } = await _supabase.auth.getSession();
        const token = data?.session?.access_token || '';
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(appPath(path), {
            method, headers, cache: 'no-store',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let json = null;
        try { json = await res.json(); } catch { json = null; }
        if (!res.ok || json?.success === false) {
            const error = new Error(json?.error || `HTTP ${res.status}`);
            error.status = res.status;
            error.code = json?.code || null;
            throw error;
        }
        return json || {};
    }

    function setupIgVerification() {
        const box = $('aac-ig-verify');
        if (!box) return;
        box.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-ig-action="request"]');
            if (btn && !btn.disabled) requestIgCode();
        });
        // El polling se corta con la sección o la pestaña ocultas y retoma al volver.
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollIgSoon(); });
        window.addEventListener('hashchange', () => setTimeout(pollIgSoon, 0));
        loadIgState();
    }

    // Demo: tarjeta pendiente simulada, sin llamadas a la API.
    function demoIgState() {
        return {
            available: true, status: 'pending', simulated: true,
            handle: igHandle() || 'tu.cuenta', verified_handle: null, verified_at: null,
            expires_at: new Date(Date.now() + 72 * 3600000).toISOString(),
            email_masked: CM ? CM.maskEmail(user?.email) || null : null,
            email_sent: true
        };
    }

    async function loadIgState() {
        if (isDemo()) { applyIgState(demoIgState()); return; }
        if (igState.loading) return;
        igState.loading = true;
        let next;
        try {
            const res = await igApi(IG_ENDPOINT);
            next = { ...res, available: res.available !== false };
        } catch (err) {
            // 503 sin migración, 404 sin endpoint, 403 del preview o sin red.
            console.warn('[account] validación de Instagram no disponible:', err?.status || err?.message || err);
            next = { available: false, status: 'none' };
        } finally {
            igState.loading = false;
        }
        applyIgState(next);
    }

    function applyIgState(next) {
        const signature = JSON.stringify([next.available, next.status, next.handle, next.verified_handle,
            next.verified_at, next.expires_at, next.email_masked, next.pending_items, next.email_sent]);
        igState.data = next;
        if (signature !== igState.signature) {
            const changed = !!igState.signature;
            igState.signature = signature;
            renderWorks(); // repinta badges, resumen y la tarjeta
            if (changed) assistRefresh('portafolio');
        }
        scheduleIgPoll();
    }

    function igSectionVisible() {
        const section = $('aac-portafolio');
        return !!section && !section.hidden && document.visibilityState !== 'hidden';
    }

    // Cada 20 s mientras hay un código pendiente y la sección está a la vista.
    function scheduleIgPoll() {
        clearTimeout(igState.pollTimer);
        igState.pollTimer = null;
        if (isDemo() || igState.data?.status !== 'pending') return;
        igState.pollTimer = setTimeout(() => {
            igState.pollTimer = null;
            if (igSectionVisible()) loadIgState();
        }, IG_POLL_MS);
    }

    function pollIgSoon() {
        if (isDemo() || igState.loading || igState.pollTimer || igState.data?.status !== 'pending' || !igSectionVisible()) return;
        loadIgState();
    }

    async function requestIgCode() {
        if (isDemo()) { toast('En modo demo la validación es simulada.'); return; }
        const handle = igHandle();
        if (!handle) { toast('Cargá tu usuario de Instagram en Mi perfil', false); return; }
        if (igState.busy) return;
        igState.busy = true;
        renderIgVerify();
        try {
            const res = await igApi(IG_ENDPOINT, { method: 'POST', body: { handle } });
            const emailSent = res.email_sent !== false;
            igState.lastRequest = { expires_at: res.expires_at || null, email_sent: emailSent };
            igState.busy = false;
            applyIgState({
                ...(igState.data || {}), available: true, status: res.status || 'pending',
                handle: res.handle || handle, expires_at: res.expires_at || null,
                email_masked: res.email_masked || igState.data?.email_masked || null, email_sent: emailSent
            });
            toast(emailSent ? 'Te mandamos el código por correo' : 'Generamos el código, pero no pudimos enviarte el correo', emailSent);
        } catch (err) {
            console.error('[account] código de Instagram:', err);
            igState.busy = false;
            const status = Number(err?.status) || 0;
            if (status === 409) { toast('Esa cuenta de Instagram ya está validada'); loadIgState(); return; }
            if (status === 503 || status === 404) {
                applyIgState({ available: false, status: 'none' });
                toast('La validación de Instagram todavía no está habilitada', false);
                return;
            }
            renderIgVerify();
            toast(status === 429 ? 'Pediste varios códigos seguidos. Probá de nuevo en un rato.'
                : status === 400 ? 'Revisá tu usuario de Instagram en Mi perfil.'
                : 'No pudimos generar el código. Probá de nuevo.', false);
        }
    }

    function igFollowUrl() {
        const url = igState.data?.instructions?.follow_url;
        return /^https:\/\/(www\.)?instagram\.com\//.test(String(url || '')) ? url : IG_FOLLOW_URL;
    }

    function renderIgVerify() {
        const box = $('aac-ig-verify');
        if (!box) return;
        const ig = igState.data;
        if (!ig) {
            box.className = 'aac-ig';
            box.innerHTML = '<p class="aac-ig-text">Revisando la validación de tu Instagram…</p>';
            return;
        }
        const handle = igHandle();
        const pending = pendingWorksCount();
        const head = (chip) => `<div class="aac-ig-head"><i data-wo-icon="instagram" aria-hidden="true"></i><span class="aac-ig-eyebrow">Validación de Instagram</span>${chip || ''}</div>`;
        const requestBtn = (label, cls) => `<button type="button" class="aac-btn ${cls} aac-btn--s" data-ig-action="request" ${handle && !igState.busy ? '' : 'disabled'}>${igState.busy ? 'Generando código…' : label}</button>`;
        const profileLink = (label) => `<a class="aac-btn aac-btn--text aac-btn--s" href="#perfil">${label}</a>`;
        let tone = '';
        let html = '';

        if (ig.available === false) {
            tone = ' aac-ig--muted';
            html = head() + '<p class="aac-ig-text">La validación de Instagram se habilita pronto. Mientras tanto tus fotos importadas se muestran como hasta ahora.</p>';
        } else if (ig.status === 'verified'
            // Cambió el usuario en Mi perfil: el GET responde status none/expired
            // para la cuenta nueva, pero la anterior sigue validada y sus fotos
            // se publican. Mientras no haya un código pendiente para la nueva,
            // se muestra lo validado y se ofrece validar la nueva.
            || (ig.status !== 'pending' && ig.verified_handle && (ig.verified === true || ig.verified_at))) {
            tone = ' aac-ig--ok';
            const verified = GV ? GV.normalizeHandle(ig.verified_handle || ig.handle) : String(ig.verified_handle || ig.handle || '');
            const changed = handle && verified && handle !== verified;
            html = head('<span class="aac-chip-ok">Validado</span>')
                + `<h2 class="aac-ig-title">Instagram validado · @${esc(verified)}</h2>`
                + `<p class="aac-ig-text">${!pending ? 'Tu portafolio está validado: tus fotos importadas se muestran en tu perfil público.'
                    : pending === 1 ? `1 foto de otra cuenta sigue pendiente: solo se publican las de @${esc(verified)}.`
                    : `${pending} fotos de otra cuenta siguen pendientes: solo se publican las de @${esc(verified)}.`}</p>`
                + (changed ? `<p class="aac-ig-meta">En Mi perfil tu Instagram ahora es <strong>@${esc(handle)}</strong> y todavía no está validado. ${ig.status === 'expired' ? 'El código que pediste venció: generá uno nuevo para' : 'Validalo para'} publicar lo que importes desde esa cuenta.</p>
                    <div class="aac-ig-actions">${requestBtn('Validar esta cuenta', 'aac-btn--accent')}</div>` : '');
        } else if (ig.status === 'pending') {
            tone = ' aac-ig--pending';
            const who = esc(GV ? GV.normalizeHandle(ig.handle || handle) : (ig.handle || handle));
            const mail = ig.email_masked ? `Revisá tu correo <strong>${esc(ig.email_masked)}</strong>` : 'Revisá tu correo';
            // El GET no trae email_sent: se recuerda el del último POST para ese código.
            const last = igState.lastRequest;
            const sameCode = !!(last && last.expires_at && Date.parse(last.expires_at) === Date.parse(ig.expires_at));
            const emailSent = typeof ig.email_sent === 'boolean' ? ig.email_sent : !(sameCode && last.email_sent === false);
            const expires = ig.expires_at ? formatDateTime(ig.expires_at) : '';
            // Si el correo no salió, el paso 1 no puede decir que se mandó: pide
            // reenviarlo (el aviso de abajo explica qué pasó).
            const resend = ig.email_masked
                ? `Tocá “Reenviar código” y revisá tu correo <strong>${esc(ig.email_masked)}</strong>`
                : 'Tocá “Reenviar código” y revisá tu correo';
            const steps = [
                ig.simulated
                    ? `${mail}: en el demo tu código de ejemplo es <strong class="aac-ig-code">${IG_DEMO_CODE}</strong>.`
                    : emailSent
                        ? `${mail}: te mandamos un código que empieza con WO-.`
                        : `${resend}: el código empieza con WO-.`,
                `Desde <strong>@${who}</strong>, seguí a <strong>@weotzi</strong> en Instagram.`,
                'Mandá el código por mensaje directo a <strong>@weotzi</strong>. Cuando lo recibamos, tu portafolio queda validado.'
            ];
            html = head('<span class="aac-chip-warn">Pendiente</span>')
                + `<h2 class="aac-ig-title">Validá @${who}</h2>`
                + `<ol class="aac-ig-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`
                + (expires ? `<p class="aac-ig-meta">El código vence el ${esc(expires)}.</p>` : '')
                + (emailSent ? '' : '<p class="aac-ig-warn" role="alert">No pudimos enviarte el correo con el código. Tocá “Reenviar código” o escribinos por soporte.</p>')
                + (ig.simulated ? '<p class="aac-ig-note">En modo demo la validación es simulada.</p>' : '')
                + `<div class="aac-ig-actions">
                    <a class="aac-btn aac-btn--outline aac-btn--s" href="${esc(igFollowUrl())}" target="_blank" rel="noopener">Abrir @weotzi →</a>
                    ${requestBtn('Reenviar código', 'aac-btn--text')}
                </div>`;
        } else {
            const expired = ig.status === 'expired';
            html = head(`<span class="aac-chip-muted">${expired ? 'Código vencido' : 'Sin validar'}</span>`)
                + '<h2 class="aac-ig-title">Validá tu cuenta de Instagram</h2>'
                + (expired ? '<p class="aac-ig-text">Tu código anterior venció. Generá uno nuevo para seguir.</p>' : '')
                + '<p class="aac-ig-text">Las fotos que importás de Instagram no se muestran en tu perfil público hasta que valides que la cuenta es tuya. Te mandamos un código por correo y nos lo enviás por mensaje directo.</p>'
                + (pending ? `<p class="aac-ig-meta">${pending === 1 ? '1 foto importada espera' : `${pending} fotos importadas esperan`} la validación.</p>` : '')
                + (handle ? `<p class="aac-ig-meta">Cuenta a validar: <strong>@${esc(handle)}</strong></p>`
                    : '<p class="aac-ig-meta">Primero cargá tu usuario de Instagram en Mi perfil.</p>')
                + `<div class="aac-ig-actions">${requestBtn('Generar código', 'aac-btn--accent')}${profileLink(handle ? 'Cambiar en Mi perfil →' : 'Ir a Mi perfil →')}</div>`;
        }
        box.className = 'aac-ig' + tone;
        box.innerHTML = html;
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
            await persistWorks();
            const parts = item.url.split('/artist-gallery/');
            if (parts.length > 1) await _supabase.storage.from('artist-gallery').remove([parts[1].split('?')[0]]).catch(() => null);
            toast('Trabajo quitado');
        } catch (err) {
            console.error('[account] quitar trabajo:', err);
            toast('No pudimos quitar el trabajo', false);
        }
    }

    // ============================================
    // 4 · Disponibilidad por ubicación (801:571 · 801:1110)
    // ============================================

    function availabilitySettings() {
        return appSettings().availability || {};
    }

    function baseLocation() {
        return AV.sortLocations(avState.locations).find((l) => !AV.isTravel(l)) || null;
    }

    function activeLocation() {
        return avState.locations.find((l) => l.id === avState.activeId) || null;
    }

    function isBase(loc) {
        const base = baseLocation();
        return !!(base && loc && base.id === loc.id);
    }

    function scheduleOf(loc) {
        if (!loc) return AV.defaultWeekly();
        if (avState.drafts[loc.id]?.weekly) return avState.drafts[loc.id].weekly;
        return AV.scheduleFor(availabilitySettings(), loc, isBase(loc));
    }

    function statusOf(loc) {
        if (!loc) return 'open';
        return avState.drafts[loc.id]?.agenda_status || loc.agenda_status || 'open';
    }

    async function setupAvailability() {
        $('av-edit').addEventListener('click', enterAvailabilityEdit);
        $('av-cancel').addEventListener('click', cancelAvailabilityEdit);
        $('av-save').addEventListener('click', saveAvailability);
        $('av-travel-add').addEventListener('click', openTravelDialog);
        $('av-travel-form').addEventListener('submit', submitTravel);
        $('av-tabs').addEventListener('click', (event) => {
            const tab = event.target.closest('[data-av-loc]');
            if (!tab) return;
            avState.activeId = tab.dataset.avLoc;
            $('av-saved').hidden = true;
            renderAvailability();
        });
        $('av-tabs').addEventListener('keydown', (event) => {
            if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
            const tabs = Array.from($('av-tabs').querySelectorAll('[data-av-loc]'));
            const i = tabs.findIndex((t) => t.dataset.avLoc === avState.activeId);
            const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            if (next) { avState.activeId = next.dataset.avLoc; renderAvailability(); $('av-tabs').querySelector(`[data-av-loc="${CSS.escape(avState.activeId)}"]`)?.focus(); }
        });
        $('av-current').addEventListener('click', (event) => {
            if (!event.target.closest('[data-av-pause]') || !avState.editing) return;
            const loc = activeLocation();
            if (!loc || loc.virtual) return;
            // Pausar recuerda el estado previo (abierta o lista de espera) para reactivar.
            const prev = statusOf(loc);
            const resume = avState.drafts[loc.id]?.resume_status || (loc.agenda_status !== 'closed' ? loc.agenda_status : 'open');
            const next = prev === 'closed' ? resume : 'closed';
            if (prev !== 'closed') avState.drafts[loc.id] = { ...(avState.drafts[loc.id] || {}), resume_status: prev };
            avState.drafts[loc.id] = { ...(avState.drafts[loc.id] || {}), weekly: scheduleOf(loc), agenda_status: next };
            renderAvailability();
        });
        $('av-current').addEventListener('change', (event) => {
            const select = event.target.closest('[data-av-status]');
            const loc = activeLocation();
            if (!select || !loc || !avState.editing) return;
            avState.drafts[loc.id] = { ...(avState.drafts[loc.id] || {}), weekly: scheduleOf(loc), agenda_status: select.value };
            renderAvailability();
        });
        $('av-days').addEventListener('change', onDayChange);
        $('av-tabs').addEventListener('scroll', updateTabsOverflow, { passive: true });
        window.addEventListener('resize', debounce(updateTabsOverflow, 120));
        $('av-tabs-wrap').addEventListener('click', (event) => {
            const arrow = event.target.closest('[data-av-scroll]');
            if (!arrow) return;
            const tabs = $('av-tabs');
            tabs.scrollBy({ left: Number(arrow.dataset.avScroll) * Math.max(160, tabs.clientWidth * 0.6), behavior: 'smooth' });
        });

        // Vacaciones → columnas reales de artists_db (aplican a todas las ubicaciones).
        $('aac-vac-from').value = artist.vacation_start || '';
        $('aac-vac-to').value = artist.vacation_end || '';
        const saveVacations = async () => {
            const from = $('aac-vac-from').value || null;
            const to = $('aac-vac-to').value || null;
            if (from && to && to < from) { toast('La fecha “hasta” tiene que ser posterior a “desde”', false); return; }
            try {
                await updateArtist({ vacation_start: from, vacation_end: to });
                toast('Vacaciones guardadas');
                assistRefresh('disponibilidad');
            } catch (err) {
                console.error('[account] vacaciones:', err);
                toast('No pudimos guardar las vacaciones', false);
            }
        };
        $('aac-vac-from').addEventListener('change', saveVacations);
        $('aac-vac-to').addEventListener('change', saveVacations);

        await Promise.all([loadLocations(), loadIntegrations()]);
    }

    async function loadLocations() {
        let rows = [];
        try {
            rows = D.AvailabilityLocations ? await D.AvailabilityLocations.list(user.id) : [];
        } catch (err) {
            console.warn('[account] ubicaciones:', err);
        }
        avState.virtual = !rows.length;
        avState.locations = rows.length ? AV.sortLocations(rows) : [{
            id: VIRTUAL_BASE_ID, virtual: true, period_type: 'current', studio_name: null, city: artist.city || '',
            country: artist.country || '', agenda_status: 'open', sort_order: 0
        }];
        carryAvailabilityDrafts();
        if (!avState.locations.some((l) => l.id === avState.activeId)) {
            const def = AV.defaultLocation(avState.locations, new Date().toISOString());
            avState.activeId = def ? def.id : avState.locations[0].id;
        }
        renderAvailability();
    }

    // Recargar las ubicaciones a mitad de una edición (por ejemplo al guardar la
    // modalidad, que crea el estudio base) no pierde lo editado: el borrador de
    // la base virtual pasa a la base real, y los de filas que ya no están se
    // descartan para que saveAvailability nunca arme un patch sin ubicación.
    function carryAvailabilityDrafts() {
        const ids = new Set(avState.locations.map((l) => l.id));
        const realBase = avState.virtual ? null : baseLocation();
        if (realBase && avState.activeId === VIRTUAL_BASE_ID) avState.activeId = realBase.id;
        Object.keys(avState.drafts).forEach((id) => {
            if (ids.has(id)) return;
            const draft = avState.drafts[id];
            delete avState.drafts[id];
            if (id === VIRTUAL_BASE_ID && realBase) {
                avState.drafts[realBase.id] = { ...draft, ...(avState.drafts[realBase.id] || {}) };
            }
        });
    }

    function renderAvailability() {
        const section = $('aac-disponibilidad');
        section.classList.toggle('is-editing', avState.editing);
        $('av-edit').hidden = avState.editing;
        $('av-cancel').hidden = !avState.editing;
        $('av-save').hidden = !avState.editing;

        $('av-tabs').innerHTML = avState.locations.map((loc) => {
            const active = loc.id === avState.activeId;
            const paused = statusOf(loc) === 'closed';
            const sub = AV.locationSubtitle({ ...loc, agenda_status: statusOf(loc) }, scheduleOf(loc));
            return `<button type="button" class="av-tab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? '0' : '-1'}" data-av-loc="${esc(loc.id)}">
                <span class="av-tab-kind">${esc(AV.locationKind(loc, avState.locations))}</span>
                <span class="av-tab-title">${esc(AV.locationTitle(loc))}</span>
                <span class="av-tab-sub">${esc(sub)}</span>
            </button>`;
        }).join('');
        revealActiveTab();

        const loc = activeLocation();
        const weekly = scheduleOf(loc);
        const paused = statusOf(loc) === 'closed';
        if (loc) {
            const detail = AV.locationDetail(loc);
            $('av-current').innerHTML = `
                <div class="av-current-main">
                    <div class="av-current-title"><strong>${esc(AV.locationTitle(loc))}</strong><span class="av-badge${paused ? ' av-badge--paused' : statusOf(loc) === 'waitlist' ? ' av-badge--waitlist' : ''}">${esc(AV.statusLabel(statusOf(loc)))}</span></div>
                    ${detail ? `<span class="av-current-detail">${esc(detail)}</span>` : ''}
                </div>
                <div class="av-current-meta">
                    <div class="av-meta"><span class="av-meta-label">Vigencia</span><span class="av-meta-value">${esc(AV.vigencia(loc))}</span></div>
                    <div class="av-meta"><span class="av-meta-label">Horas semanales</span><span class="av-meta-value">${esc(String(AV.weeklyHours(weekly)).replace('.', ','))} h</span></div>
                    ${avState.editing && AV.isTravel(loc) && !loc.virtual && !paused ? `<label class="av-meta"><span class="av-meta-label">Agenda</span><select class="av-status-select" data-av-status aria-label="Estado de la agenda en ${esc(AV.locationTitle(loc))}"><option value="open" ${statusOf(loc) === 'open' ? 'selected' : ''}>Abierta</option><option value="waitlist" ${statusOf(loc) === 'waitlist' ? 'selected' : ''}>Lista de espera</option></select></label>` : ''}
                    <button type="button" class="av-pause" data-av-pause ${avState.editing && !loc.virtual ? '' : 'disabled'} title="${avState.editing ? '' : 'Tocá “Editar disponibilidad” para pausar o reactivar'}">${paused ? 'Reactivar ubicación' : 'Pausar ubicación'}</button>
                </div>`;
        } else {
            $('av-current').innerHTML = '';
        }

        const short = AV.cityShort(loc);
        $('av-days-title').textContent = short ? `Días laborales — ${short}` : 'Días laborales';
        $('av-days').innerHTML = AV.DAYS.map(([day, label], i) => {
            const row = weekly[i];
            const switchHtml = `<label class="aac-switch"><input type="checkbox" data-av-day="${i}" ${row.enabled ? 'checked' : ''} ${avState.editing ? '' : 'disabled'} aria-label="Disponible los ${label.toLowerCase()}"><span class="aac-switch-knob" aria-hidden="true"></span></label>`;
            let hours;
            if (avState.editing && row.enabled) {
                hours = `<span class="av-day-edit">
                    <input class="aac-input av-time" type="time" data-av-start="${i}" value="${esc(row.start)}" aria-label="Hora de inicio del ${label.toLowerCase()}">
                    <span aria-hidden="true">—</span>
                    <input class="aac-input av-time" type="time" data-av-end="${i}" value="${esc(row.end)}" aria-label="Hora de fin del ${label.toLowerCase()}">
                </span>`;
            } else if (row.enabled) {
                hours = `<span>${esc(row.start)} — ${esc(row.end)}</span>${AV.isHalfDay(row) ? '<span class="av-day-tag">Media jornada</span>' : ''}`;
            } else {
                hours = '<span>No disponible</span>';
            }
            return `<div class="av-day" data-day="${day}">
                <span class="av-day-name">${label}</span>
                ${switchHtml}
                <span class="av-day-hours${row.enabled ? '' : ' is-off'}">${hours}</span>
            </div>`;
        }).join('');
        renderSync();
    }

    // Pestañas que no entran (5+ ubicaciones): flechas + desvanecido en el borde
    // y la pestaña activa siempre a la vista, sin mover la página.
    function revealActiveTab() {
        const tabs = $('av-tabs');
        const active = tabs.querySelector('.av-tab.is-active');
        if (active && tabs.clientWidth) {
            const left = active.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
            const right = left + active.offsetWidth;
            if (left < tabs.scrollLeft) tabs.scrollLeft = left;
            else if (right > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = right - tabs.clientWidth;
        }
        updateTabsOverflow();
    }

    function updateTabsOverflow() {
        const tabs = $('av-tabs');
        const wrap = $('av-tabs-wrap');
        if (!tabs || !wrap) return;
        const max = tabs.scrollWidth - tabs.clientWidth;
        const atStart = tabs.scrollLeft <= 2;
        const atEnd = tabs.scrollLeft >= max - 2;
        wrap.classList.toggle('has-more-start', max > 2 && !atStart);
        wrap.classList.toggle('has-more-end', max > 2 && !atEnd);
        wrap.querySelector('.av-tabs-arrow--prev').hidden = !(max > 2 && !atStart);
        wrap.querySelector('.av-tabs-arrow--next').hidden = !(max > 2 && !atEnd);
    }

    function onDayChange(event) {
        if (!avState.editing) return;
        const loc = activeLocation();
        if (!loc) return;
        const weekly = scheduleOf(loc).map((r) => ({ ...r }));
        const t = event.target;
        if (t.dataset.avDay !== undefined) weekly[Number(t.dataset.avDay)].enabled = t.checked;
        else if (t.dataset.avStart !== undefined) weekly[Number(t.dataset.avStart)].start = t.value;
        else if (t.dataset.avEnd !== undefined) weekly[Number(t.dataset.avEnd)].end = t.value;
        else return;
        avState.drafts[loc.id] = { ...(avState.drafts[loc.id] || {}), weekly };
        // Repintar solo si cambió un toggle (los inputs de hora conservan el foco).
        if (t.dataset.avDay !== undefined) renderAvailability();
        else {
            const tab = $('av-tabs').querySelector(`[data-av-loc="${CSS.escape(loc.id)}"] .av-tab-sub`);
            if (tab) tab.textContent = AV.locationSubtitle({ ...loc, agenda_status: statusOf(loc) }, weekly);
            const hours = $('av-current').querySelectorAll('.av-meta-value')[1];
            if (hours) hours.textContent = `${String(AV.weeklyHours(weekly)).replace('.', ',')} h`;
        }
    }

    function enterAvailabilityEdit() {
        avState.editing = true;
        avState.drafts = {};
        $('av-saved').hidden = true;
        $('av-error').hidden = true;
        renderAvailability();
        $('av-days').querySelector('input:not(:disabled)')?.focus();
    }

    function cancelAvailabilityEdit() {
        avState.editing = false;
        avState.drafts = {};
        $('av-error').hidden = true;
        renderAvailability();
        $('av-edit').focus();
    }

    // Una ubicación sin horario guardado muestra el horario por defecto (lunes a
    // viernes). Si se guarda sin tocarlo, se guarda lo que se ve: así el paso
    // Disponibilidad del modo asistido lo cuenta.
    function seedVisibleSchedule() {
        const loc = activeLocation();
        if (!loc || avState.drafts[loc.id]?.weekly) return;
        const av = availabilitySettings();
        const stored = av.locations?.[loc.id]?.weekly || (isBase(loc) && av.weekly);
        if (stored) return;
        avState.drafts[loc.id] = { ...(avState.drafts[loc.id] || {}), weekly: scheduleOf(loc) };
    }

    async function saveAvailability() {
        const errEl = $('av-error');
        errEl.hidden = true;
        seedVisibleSchedule();
        const edited = Object.keys(avState.drafts).filter((id) => avState.locations.some((l) => l.id === id));
        for (const id of edited) {
            const errors = AV.validateWeekly(avState.drafts[id].weekly || []);
            if (errors.length) {
                const loc = avState.locations.find((l) => l.id === id);
                errEl.textContent = `${AV.locationTitle(loc)} · ${errors[0]}`;
                errEl.hidden = false;
                avState.activeId = id;
                renderAvailability();
                return;
            }
        }
        const btn = $('av-save');
        btn.disabled = true;
        try {
            let availability = availabilitySettings();
            for (const id of edited) {
                const loc = avState.locations.find((l) => l.id === id);
                const draft = avState.drafts[id];
                if (draft.weekly) availability = AV.availabilityPatch(availability, loc, draft.weekly, isBase(loc));
                if (draft.agenda_status && draft.agenda_status !== loc.agenda_status && !loc.virtual) {
                    try {
                        await D.AvailabilityLocations.setAgendaStatus(user.id, loc.id, draft.agenda_status);
                        loc.agenda_status = draft.agenda_status;
                    } catch (statusErr) {
                        // 'waitlist' necesita la migración 20261028160000 (no aplicada).
                        if (draft.agenda_status !== 'waitlist') throw statusErr;
                        console.warn('[account] lista de espera no disponible:', statusErr);
                        toast('La lista de espera todavía no está habilitada en el servidor', false);
                    }
                }
            }
            if (edited.length) await savePrefs('app_settings', { availability });
            avState.editing = false;
            avState.drafts = {};
            renderAvailability();
            // El banner nombra la ubicación editada, no la pestaña activa al guardar.
            const editedLoc = edited.length === 1 ? avState.locations.find((l) => l.id === edited[0]) : null;
            showAvailabilitySaved(edited.length > 1 ? null : (editedLoc || activeLocation()), edited.length);
            assistRefresh('disponibilidad');
        } catch (err) {
            console.error('[account] disponibilidad:', err);
            errEl.textContent = 'No pudimos guardar la disponibilidad. Probá de nuevo.';
            errEl.hidden = false;
        } finally {
            btn.disabled = false;
        }
    }

    function showAvailabilitySaved(loc, count) {
        $('av-saved-name').textContent = loc ? AV.locationTitle(loc) : `${count || 0} ubicaciones`;
        $('av-saved').hidden = false;
    }

    function openTravelDialog() {
        $('av-travel-error').hidden = true;
        $('av-travel-form').reset();
        $('av-travel-start').min = new Date().toISOString().slice(0, 10);
        $('av-travel-dialog').showModal();
    }

    async function submitTravel(event) {
        event.preventDefault();
        const errEl = $('av-travel-error');
        errEl.hidden = true;
        const input = {
            city: $('av-travel-city').value,
            studioName: $('av-travel-studio').value,
            country: $('av-travel-country').value,
            agendaStatus: $('av-travel-status').value,
            startDate: $('av-travel-start').value,
            endDate: $('av-travel-end').value
        };
        const check = AV.validateUpcoming(input, new Date().toISOString());
        if (!check.ok) { errEl.textContent = Object.values(check.errors)[0]; errEl.hidden = false; return; }
        const submit = event.submitter;
        if (submit) submit.disabled = true;
        try {
            const row = await D.AvailabilityLocations.addUpcoming(user.id, input, avState.locations.filter((l) => !l.virtual));
            $('av-travel-dialog').close();
            avState.activeId = row?.id || avState.activeId;
            await loadLocations();
            toast(row?.degraded
                ? 'Destino agregado sin país ni lista de espera: el servidor todavía no los admite.'
                : 'Destino Travel agregado. Definí sus horarios con “Editar disponibilidad”.', !row?.degraded);
            assistRefresh('disponibilidad');
        } catch (err) {
            console.error('[account] destino travel:', err);
            errEl.textContent = 'No pudimos agregar el destino. Revisá las fechas y probá de nuevo.';
            errEl.hidden = false;
        } finally { if (submit) submit.disabled = false; }
    }

    // ---- Modalidad de trabajo y estudio base ----
    // artists_db.work_type ∈ studio | independent | both, estudios (nombre en
    // mayúsculas o 'Sin estudio/Independiente') y studio_id, como el registro.

    function currentWorkType() {
        const type = String(extras?.work_type || '').trim().toLowerCase();
        if (WORK_TYPES.includes(type)) return type;
        const legacy = String(extras?.estudios || '').trim();
        if (!legacy) return '';
        return legacy === INDEPENDENT_STUDIO ? 'independent' : 'studio';
    }

    function currentStudioName() {
        const legacy = String(extras?.estudios || '').trim();
        return legacy && legacy !== INDEPENDENT_STUDIO ? legacy : '';
    }

    function selectedWorkType() {
        return document.querySelector('input[name="aac-modalidad"]:checked')?.value || '';
    }

    function modalityError(message) {
        const el = $('aac-modalidad-error');
        if (!el) return;
        el.textContent = message || '';
        el.hidden = !message;
    }

    function setupModality() {
        const block = $('aac-modalidad');
        if (!block) return;
        const type = currentWorkType();
        const studioName = currentStudioName();
        block.querySelectorAll('input[name="aac-modalidad"]').forEach((input) => {
            input.checked = input.value === type;
            input.addEventListener('change', () => { modalityError(''); renderModality(); });
        });
        const input = $('aac-modalidad-studio');
        const list = $('aac-modalidad-studio-list');
        input.value = studioName;
        modeState.selected = extras?.studio_id && studioName ? { id: extras.studio_id, name: studioName } : null;
        input.addEventListener('input', onStudioInput);
        input.addEventListener('keydown', onStudioKeydown);
        input.addEventListener('blur', () => setTimeout(closeStudioList, 150));
        list.addEventListener('mousedown', (event) => event.preventDefault()); // conserva el foco en el input
        list.addEventListener('click', (event) => {
            const option = event.target.closest('[data-studio-index]');
            if (option) pickStudio(Number(option.dataset.studioIndex));
        });
        $('aac-modalidad-save').addEventListener('click', saveModality);
        renderModality();
    }

    function renderModality() {
        const type = selectedWorkType();
        const field = $('aac-modalidad-studio-field');
        field.hidden = !(type === 'studio' || type === 'both');
        $('aac-modalidad-hint').textContent = MODALITY_HINTS[type] || 'Elegí si tatuás en un estudio, en tu propio espacio o en los dos.';
        if (field.hidden) closeStudioList();
    }

    function onStudioInput() {
        modeState.selected = null;
        modalityError('');
        const query = $('aac-modalidad-studio').value.trim();
        clearTimeout(modeState.timer);
        if (!query) { modeState.token += 1; closeStudioList(); return; }
        modeState.timer = setTimeout(() => searchStudios(query), 250);
    }

    async function searchStudios(query) {
        const token = ++modeState.token;
        let rows = [];
        try {
            if (D.Studios?.searchByNormalizedName) {
                const { data, error } = await D.Studios.searchByNormalizedName(query.toUpperCase(), {
                    limit: 8, columns: 'id, name, normalized_name, city, country'
                });
                if (error) throw error;
                rows = data || [];
            }
        } catch (err) {
            console.warn('[account] buscar estudios:', err);
        }
        if (token !== modeState.token) return; // llegó una búsqueda más nueva
        renderStudioList(query, rows);
    }

    function renderStudioList(query, rows) {
        const list = $('aac-modalidad-studio-list');
        const input = $('aac-modalidad-studio');
        const upper = query.toUpperCase();
        const exact = rows.some((r) => String(r.normalized_name || r.name || '').trim().toUpperCase() === upper);
        modeState.results = rows.map((r) => ({ id: r.id, name: r.name || r.normalized_name, meta: [r.city, r.country].filter(Boolean).join(', ') }));
        if (!exact) modeState.results.push({ id: null, name: query, create: true });
        modeState.active = -1;
        list.innerHTML = modeState.results.map((r, i) => `
            <li class="aac-typeahead-option${r.create ? ' is-new' : ''}" role="option" id="aac-modalidad-opt-${i}" aria-selected="false" data-studio-index="${i}">
                ${r.create
                    ? `<span class="aac-typeahead-name">Agregar «${esc(r.name)}»</span>`
                    : `<span class="aac-typeahead-name">${esc(r.name)}</span>${r.meta ? `<span class="aac-typeahead-meta">${esc(r.meta)}</span>` : ''}`}
            </li>`).join('');
        list.hidden = !modeState.results.length;
        input.setAttribute('aria-expanded', String(!list.hidden));
        input.removeAttribute('aria-activedescendant');
    }

    function paintStudioActive() {
        const input = $('aac-modalidad-studio');
        $('aac-modalidad-studio-list').querySelectorAll('[data-studio-index]').forEach((option) => {
            const on = Number(option.dataset.studioIndex) === modeState.active;
            option.classList.toggle('is-active', on);
            option.setAttribute('aria-selected', String(on));
            if (on) { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
        });
        if (modeState.active < 0) input.removeAttribute('aria-activedescendant');
    }

    function onStudioKeydown(event) {
        const list = $('aac-modalidad-studio-list');
        if (event.key === 'Escape') {
            if (!list.hidden) { event.preventDefault(); event.stopPropagation(); closeStudioList(); }
            return;
        }
        const n = modeState.results.length;
        if (list.hidden || !n) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const down = event.key === 'ArrowDown';
            modeState.active = modeState.active < 0 ? (down ? 0 : n - 1) : (modeState.active + (down ? 1 : -1) + n) % n;
            paintStudioActive();
        } else if (event.key === 'Enter' && modeState.active >= 0) {
            event.preventDefault();
            pickStudio(modeState.active);
        }
    }

    function pickStudio(index) {
        const result = modeState.results[index];
        if (!result) return;
        $('aac-modalidad-studio').value = result.name;
        modeState.selected = result.create ? null : { id: result.id, name: result.name };
        closeStudioList();
    }

    function closeStudioList() {
        const list = $('aac-modalidad-studio-list');
        const input = $('aac-modalidad-studio');
        if (!list || !input) return;
        list.hidden = true;
        modeState.active = -1;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    // Mismo find-or-create que el registro (register.js findOrCreateStudio):
    // busca por normalized_name y, si no existe, crea la fila mínima del
    // catálogo; ante una carrera (23505) vuelve a leer. null si no se pudo.
    async function findOrCreateStudio(name) {
        if (!D.Studios?.findIdByNormalizedName) return null;
        const normalized = name.toUpperCase().trim();
        const { data: existing, error: findErr } = await D.Studios.findIdByNormalizedName(normalized);
        if (findErr) { console.warn('[account] buscar estudio:', findErr); return null; }
        if (existing) return existing.id;
        const { data: created, error: createErr } = await D.Studios.createMinimal({ name: name.trim(), normalizedName: normalized });
        if (createErr) {
            if (createErr.code === '23505') {
                const { data: retry } = await D.Studios.findIdByNormalizedName(normalized, { single: true });
                return retry?.id || null;
            }
            console.warn('[account] crear estudio:', createErr);
            return null;
        }
        return created?.id || null;
    }

    // Estudio base = artist_tattoo_locations current · sort_order 0 (como el
    // registro). Independiente: si la base apuntaba a un estudio queda como
    // ESTUDIO PRIVADO sin studio_id; la fila se conserva para no perder los
    // horarios guardados con su id (availability.locations[<id>]).
    async function syncBaseLocation(type, studioId, nameUpper) {
        if (!D.ArtistLocations?.upsertCurrentLocation) return false;
        let rows;
        try {
            rows = D.AvailabilityLocations ? await D.AvailabilityLocations.list(user.id) : [];
        } catch (err) {
            console.warn('[account] ubicaciones:', err);
            rows = avState.locations.filter((l) => !l.virtual);
        }
        const base = rows.find((l) => l.period_type === 'current' && Number(l.sort_order) === 0) || null;
        let row = null;
        if (type !== 'independent') {
            row = {
                artist_user_id: user.id, period_type: 'current', sort_order: 0,
                studio_id: studioId, studio_name: nameUpper,
                city: artist.city || base?.city || null,
                agenda_status: base?.agenda_status || 'open'
            };
        } else if (base && base.studio_id) {
            row = {
                artist_user_id: user.id, period_type: 'current', sort_order: 0,
                studio_id: null, studio_name: PRIVATE_STUDIO_NAME,
                city: base.city || artist.city || null,
                agenda_status: base.agenda_status || 'open'
            };
        }
        if (!row) return true;
        try {
            const { error } = await D.ArtistLocations.upsertCurrentLocation(row);
            if (error) throw error;
            return true;
        } catch (err) {
            console.warn('[account] estudio base:', err);
            return false;
        }
    }

    async function saveModality() {
        modalityError('');
        const type = selectedWorkType();
        if (!WORK_TYPES.includes(type)) { modalityError('Elegí cómo trabajás: estudio, independiente o ambos.'); return; }
        const withStudio = type !== 'independent';
        const name = $('aac-modalidad-studio').value.trim();
        if (withStudio && !name) {
            modalityError('Escribí el nombre de tu estudio o elegilo de la lista.');
            $('aac-modalidad-studio').focus();
            return;
        }
        const btn = $('aac-modalidad-save');
        btn.disabled = true;
        try {
            const nameUpper = withStudio ? name.toUpperCase() : null;
            let studioId = null;
            if (withStudio) {
                const picked = modeState.selected && String(modeState.selected.name || '').toUpperCase() === nameUpper;
                studioId = picked ? modeState.selected.id : await findOrCreateStudio(name);
            }
            const patch = {
                work_type: type,
                estudios: withStudio ? nameUpper : INDEPENDENT_STUDIO,
                studio_id: studioId
            };
            await updateArtist(patch);
            extras = { ...(extras || {}), ...patch };
            modeState.selected = withStudio && studioId ? { id: studioId, name } : null;
            const baseSaved = await syncBaseLocation(type, studioId, nameUpper);
            await loadLocations();
            toast(baseSaved ? 'Modalidad guardada' : 'Guardamos la modalidad, pero no pudimos actualizar tu estudio base', baseSaved);
            assistRefresh('disponibilidad');
        } catch (err) {
            console.error('[account] modalidad:', err);
            modalityError('No pudimos guardar la modalidad. Probá de nuevo.');
        } finally {
            btn.disabled = false;
        }
    }

    // Google Calendar (artist_integration_connections) — sincronización externa.
    async function loadIntegrations() {
        try {
            integrationsAvailable = !!(D.AccountIntegrations && await D.AccountIntegrations.isAvailable());
            integrations = integrationsAvailable ? await D.AccountIntegrations.list(user.id).catch(() => []) : [];
        } catch { integrationsAvailable = false; integrations = []; }
        document.querySelectorAll('[data-integration-action]').forEach((button) => {
            button.addEventListener('click', () => handleIntegrationAction(button.dataset.integrationAction));
        });
        renderSync();
    }

    function renderSync() {
        const row = document.querySelector('[data-integration-row="google_calendar"]');
        if (!row) return;
        const action = row.querySelector('[data-integration-action]');
        const note = $('av-sync-note');
        const connection = integrations.find((item) => item.provider === 'google_calendar');
        const status = connection?.status || 'disconnected';
        const active = avState.locations.filter((l) => statusOf(l) !== 'closed').length;
        const word = ['', 'la ubicación activa', 'las dos ubicaciones activas', 'las tres ubicaciones activas'][active] || `las ${active} ubicaciones activas`;
        if (status === 'connected') {
            note.textContent = active === 1 ? `Sincroniza ${word}` : `Sincroniza ${word}`;
            action.textContent = 'Conectado';
        } else if (status === 'pending') {
            note.textContent = 'Autorización pendiente con Google';
            action.textContent = 'Pendiente';
        } else {
            note.textContent = 'Sincronizá tus ubicaciones con tu calendario';
            action.textContent = 'Conectar';
        }
        action.classList.toggle('is-connected', status === 'connected');
        action.disabled = !integrationsAvailable;
        action.title = integrationsAvailable ? (connection?.account_label || '') : 'Integración no disponible en este entorno';
    }

    async function handleIntegrationAction(provider) {
        if (!integrationsAvailable) { toast('La sincronización con Google Calendar no está disponible en este entorno', false); return; }
        const current = integrations.find((item) => item.provider === provider);
        try {
            if (current?.status === 'connected' || current?.status === 'pending') {
                if (!window.confirm('¿Querés desconectar Google Calendar?')) return;
                await D.AccountIntegrations.save(user.id, provider, { status: 'disconnected' });
                toast('Google Calendar desconectado');
            } else {
                const authorizeUrl = window.CONFIG?.integrations?.[provider]?.authorizeUrl;
                if (authorizeUrl) {
                    const returnTo = `${window.location.origin}/artist/account#disponibilidad`;
                    window.location.href = `${authorizeUrl}${authorizeUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(returnTo)}`;
                    return;
                }
                await D.AccountIntegrations.save(user.id, provider, {
                    status: 'pending',
                    scopes: ['calendar.readonly'],
                    metadata: { authorization_required: true, requested_from: 'account_availability' }
                });
                toast('Pedido de conexión registrado: falta autorizar Google Calendar');
            }
            integrations = await D.AccountIntegrations.list(user.id);
            renderSync();
        } catch (error) {
            console.error('[account] integración:', error);
            toast('No pudimos actualizar la sincronización', false);
        }
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
        // Promociones por email = newsletter del artista (antes en /artist/profile/details).
        if (typeof saved.promociones?.email !== 'boolean' && typeof extras?.subscribed_newsletter === 'boolean') {
            notifMatrix.promociones.email = extras.subscribed_newsletter;
        }

        const cell = (key, label, channel, name) => `
            <span class="aac-matrix-cell">
                <label class="aac-switch">
                    <input type="checkbox" data-notif-event="${key}" data-notif-channel="${channel}" ${notifMatrix[key][channel] ? 'checked' : ''} aria-label="Avisos de ${label.toLowerCase()} por ${name}">
                    <span class="aac-switch-knob" aria-hidden="true"></span>
                </label>
            </span>`;
        $('aac-notif-rows').innerHTML = NOTIF_EVENTS.map(([key, label]) => `
            <div class="aac-matrix-row">
                <span class="aac-matrix-label">${label}</span>
                ${cell(key, label, 'email', 'email')}
                ${cell(key, label, 'push', 'push')}
                ${cell(key, label, 'sms', 'SMS')}
            </div>`).join('');

        $('aac-notif-rows').addEventListener('change', async (event) => {
            const input = event.target.closest('[data-notif-event]');
            if (!input) return;
            notifMatrix[input.dataset.notifEvent][input.dataset.notifChannel] = input.checked;
            try {
                await savePrefs('notification_prefs', notifMatrix);
                if (input.dataset.notifEvent === 'promociones' && input.dataset.notifChannel === 'email') {
                    await updateArtist({ subscribed_newsletter: input.checked }).catch((err) => console.warn('[account] newsletter:', err));
                }
                toast('Preferencia guardada');
                assistRefresh('notificaciones');
            } catch (err) {
                console.error('[account] notificaciones:', err);
                input.checked = !input.checked;
                notifMatrix[input.dataset.notifEvent][input.dataset.notifChannel] = input.checked;
                toast('No pudimos guardar la preferencia', false);
            }
        });
    }

    // ============================================
    // 6 · Seguridad y recuperación (801:575)
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

    async function hashText(text) {
        try {
            if (!window.crypto?.subtle) return null;
            const bytes = new TextEncoder().encode(text);
            const digest = await window.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        } catch { return null; }
    }

    async function setupSecurity() {
        $('aac-pass-save').addEventListener('click', changePassword);
        $('aac-close-others').addEventListener('click', closeOtherSessions);
        $('aac-mfa-toggle').addEventListener('change', handleMfaToggle);
        $('aac-mfa-form').addEventListener('submit', verifyMfaEnrollment);
        $('aac-delete-request').addEventListener('click', () => $('aac-delete-dialog').showModal());
        $('aac-delete-form').addEventListener('submit', requestAccountDeletion);
        $('aac-phone-edit').addEventListener('click', openPhoneDialog);
        $('aac-phone-form').addEventListener('submit', submitPhone);
        $('aac-question-edit').addEventListener('click', openQuestionDialog);
        $('aac-question-form').addEventListener('submit', submitQuestion);
        renderRecovery();

        await Promise.all([loadAccountSessions(), loadMfaState(), loadDeletionRequests()]);
    }

    async function changePassword() {
        const errEl = $('aac-pass-error');
        errEl.hidden = true;
        const current = $('aac-pass-current').value;
        const next = $('aac-pass-new').value;
        const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
        if (!current || !next) return fail('Completá la contraseña actual y la nueva.');
        if (next.length < 8) return fail('La nueva contraseña lleva al menos 8 caracteres.');
        if (next === current) return fail('La nueva contraseña tiene que ser distinta de la actual.');
        const btn = $('aac-pass-save');
        btn.disabled = true;
        try {
            const { data: signData, error: signErr } = await _supabase.auth.signInWithPassword({ email: user.email, password: current });
            if (signErr) return fail('La contraseña actual no es correcta.');
            currentSessionId = parseJwt(signData?.session?.access_token)?.session_id || currentSessionId;
            const { error: updErr } = await _supabase.auth.updateUser({ password: next });
            if (updErr) throw updErr;
            $('aac-pass-current').value = '';
            $('aac-pass-new').value = '';
            toast('Contraseña actualizada');
        } catch (err) {
            console.error('[account] contraseña:', err);
            fail('No pudimos actualizar la contraseña. Probá de nuevo.');
        } finally {
            btn.disabled = false;
        }
    }

    async function closeOtherSessions() {
        if (!window.confirm('Vamos a cerrar tu sesión en todos los demás dispositivos. ¿Continuar?')) return;
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
    }

    async function loadAccountSessions() {
        const available = D.AccountSessions && await D.AccountSessions.isAvailable();
        accountSessions = [];
        if (available) {
            if (currentSessionId) {
                const device = describeDevice();
                device.userAgentHash = await hashText(navigator.userAgent || '');
                await D.AccountSessions.touch(user.id, currentSessionId, device).catch((error) => console.warn('[account] registrar sesión:', error));
            }
            accountSessions = await D.AccountSessions.list(user.id).catch(() => []);
        }
        renderAccountSessions();
    }

    function sessionLabel(session) {
        const name = String(session.device_name || '').trim();
        const browser = session.browser || '';
        if (!name || /este dispositivo/i.test(name)) return [session.operating_system, browser].filter(Boolean).join(' — ') || 'Dispositivo';
        return browser && !name.includes(browser) ? `${name} — ${browser}` : name;
    }

    function renderAccountSessions() {
        const wrap = $('aac-sessions');
        const device = describeDevice();
        // Sesión actual: por id de sesión del JWT o, si no viene, por navegador + SO.
        let current = accountSessions.find((s) => currentSessionId && s.auth_session_id === currentSessionId)
            || (!currentSessionId ? accountSessions.find((s) => s.browser === device.browser && s.operating_system === device.operatingSystem) : null)
            || null;
        const others = accountSessions.filter((s) => s !== current);
        const place = (s) => [s.city, AV.countryCode({ country: s.country }) || s.country].filter(Boolean).join(', ');
        const currentHtml = `<div class="aac-session">
            <div class="aac-session-main"><strong>${esc(current ? sessionLabel(current) : device.deviceName)}</strong><span class="aac-session-meta">${esc([current ? place(current) : '', 'Activo ahora'].filter(Boolean).join(' · '))}</span></div>
            <span class="aac-chip-ok">Este dispositivo</span>
        </div>`;
        // Sin "Cerrar sesión" por dispositivo (Figma 801:575 lo dibuja): Supabase no
        // permite revocar una sesión ajena desde el cliente y el botón terminaba
        // cerrando todas. Queda "Cerrar todas las demás sesiones" hasta tener un
        // endpoint/RPC con service role que revoque por session_id.
        wrap.innerHTML = currentHtml + others.map((s) => `<div class="aac-session">
            <div class="aac-session-main"><strong>${esc(sessionLabel(s))}</strong><span class="aac-session-meta">${esc([place(s), relativeTime(s.last_seen_at)].filter(Boolean).join(' · '))}</span></div>
        </div>`).join('');
        $('aac-close-others').disabled = !others.length;
    }

    async function loadMfaState() {
        const status = $('aac-mfa-status');
        const toggle = $('aac-mfa-toggle');
        try {
            if (!_supabase.auth.mfa?.listFactors) throw new Error('MFA no disponible en esta versión');
            const { data, error } = await _supabase.auth.mfa.listFactors();
            if (error) throw error;
            verifiedMfaFactors = (data?.all || data?.totp || []).filter((factor) => factor.status === 'verified');
            toggle.disabled = false;
            status.hidden = true;
        } catch (error) {
            console.warn('[account] MFA:', error);
            verifiedMfaFactors = [];
            status.textContent = 'La autenticación en dos pasos no está habilitada en este entorno.';
            status.hidden = false;
            toggle.disabled = true;
        }
        syncMfaToggle();
    }

    function syncMfaToggle() {
        $('aac-mfa-toggle').checked = verifiedMfaFactors.length > 0;
    }

    async function handleMfaToggle() {
        const toggle = $('aac-mfa-toggle');
        const wantsOn = toggle.checked;
        syncMfaToggle(); // el estado real se refleja cuando termina el flujo
        toggle.disabled = true;
        try {
            if (!wantsOn && verifiedMfaFactors.length) {
                if (!window.confirm('¿Querés desactivar la autenticación en dos pasos?')) return;
                const { error } = await _supabase.auth.mfa.unenroll({ factorId: verifiedMfaFactors[0].id });
                if (error) throw error;
                await loadMfaState();
                toast('Autenticación en dos pasos desactivada');
                return;
            }
            if (wantsOn && !verifiedMfaFactors.length) {
                const { data, error } = await _supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'We Ötzi · Centro de Cuenta' });
                if (error) throw error;
                pendingMfaFactor = data;
                const qr = data?.totp?.qr_code;
                const secret = data?.totp?.secret;
                $('aac-mfa-enrollment').innerHTML = `${qr ? `<img class="aac-mfa-qr" src="${esc(qr)}" alt="Código QR para configurar la app autenticadora" width="240" height="240">` : ''}<p class="wal-confirm-text">Escaneá el QR con tu app autenticadora.${secret ? ` Si no podés, ingresá esta clave: <code>${esc(secret)}</code>.` : ''}</p>`;
                $('aac-mfa-code').value = '';
                $('aac-mfa-dialog').showModal();
            }
        } catch (error) {
            console.error('[account] configurar MFA:', error);
            toast('No pudimos configurar la autenticación en dos pasos', false);
        } finally {
            toggle.disabled = false;
            syncMfaToggle();
        }
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
            status.textContent = 'Para eliminar tu cuenta escribinos por soporte.';
            $('aac-delete-request').disabled = true;
            return;
        }
        const rows = await D.AccountDeletionRequests.list(user.id).catch(() => []);
        const open = rows.find((row) => ['requested', 'in_review', 'approved'].includes(row.status));
        if (open) {
            status.textContent = `Solicitud ${open.status === 'requested' ? 'recibida' : 'en revisión'} · ${formatShortDate(open.requested_at)}`;
            $('aac-delete-request').disabled = true;
        } else {
            status.textContent = '';
            $('aac-delete-request').disabled = false;
        }
    }

    async function requestAccountDeletion(event) {
        event.preventDefault();
        if (!$('aac-delete-confirm').checked) { toast('Confirmá que entendés que la eliminación es permanente', false); return; }
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

    // ---- Recuperación: verificación telefónica + pregunta de seguridad ----

    function recoverySettings() {
        return appSettings().recovery || {};
    }

    function renderRecovery() {
        const rec = recoverySettings();
        const phone = rec.phone || {};
        const phoneVerified = phone.status === 'verified' || !!user?.phone_confirmed_at;
        $('aac-phone-status').textContent = phoneVerified ? 'Verificado'
            : phone.status === 'pending' ? `Pendiente de verificación${phone.number_masked ? ' · ' + phone.number_masked : ''}`
            : 'Sin configurar';
        const q = rec.security_question || {};
        $('aac-question-status').textContent = q.answer_hash ? `Configurada · ${q.question}` : 'Configurar';
    }

    function phoneError(msg) {
        const el = $('aac-phone-error');
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    function openPhoneDialog() {
        phoneStage = 'number';
        phoneError('');
        $('aac-phone-code-field').hidden = true;
        $('aac-phone-code').value = '';
        $('aac-phone-number').disabled = false;
        $('aac-phone-submit').textContent = 'Enviar código';
        $('aac-phone-help').textContent = 'Te enviamos un código por SMS para confirmar el número.';
        $('aac-phone-dialog').showModal();
    }

    function normalizePhone(value) {
        const digits = String(value || '').replace(/[^\d+]/g, '');
        if (!/^\+\d{8,15}$/.test(digits)) return null;
        return digits;
    }

    async function submitPhone(event) {
        event.preventDefault();
        phoneError('');
        const phone = normalizePhone($('aac-phone-number').value);
        if (!phone) { phoneError('Ingresá el número con código de país, por ejemplo +54 9 11 1234 5678.'); return; }
        const masked = `···· ${phone.slice(-4)}`;
        const btn = $('aac-phone-submit');
        btn.disabled = true;
        try {
            if (phoneStage === 'number') {
                const { error } = await _supabase.auth.updateUser({ phone });
                if (error) throw Object.assign(error, { stage: 'send' });
                phoneStage = 'code';
                $('aac-phone-number').disabled = true;
                $('aac-phone-code-field').hidden = false;
                $('aac-phone-code').focus();
                btn.textContent = 'Verificar código';
                $('aac-phone-help').textContent = `Te mandamos un código al ${masked}.`;
                await savePrefs('app_settings', { recovery: { ...recoverySettings(), phone: { status: 'pending', number_masked: masked, updated_at: new Date().toISOString() } } });
                renderRecovery();
                return;
            }
            const token = $('aac-phone-code').value.trim();
            if (!/^\d{6}$/.test(token)) { phoneError('Ingresá el código de 6 dígitos.'); return; }
            const { error } = await _supabase.auth.verifyOtp({ phone, token, type: 'phone_change' });
            if (error) throw Object.assign(error, { stage: 'verify' });
            await savePrefs('app_settings', { recovery: { ...recoverySettings(), phone: { status: 'verified', number_masked: masked, verified_at: new Date().toISOString() } } });
            renderRecovery();
            $('aac-phone-dialog').close();
            toast('Teléfono verificado');
        } catch (err) {
            console.error('[account] teléfono:', err);
            if (err?.stage === 'verify') { phoneError('El código no es válido o venció.'); return; }
            // Sin proveedor de SMS configurado: el número queda pendiente.
            await savePrefs('app_settings', { recovery: { ...recoverySettings(), phone: { status: 'pending', number_masked: masked, updated_at: new Date().toISOString() } } }).catch(() => null);
            renderRecovery();
            phoneError('No pudimos enviar el SMS en este momento. Guardamos el número como pendiente de verificación.');
        } finally { btn.disabled = false; }
    }

    function openQuestionDialog() {
        const q = recoverySettings().security_question || {};
        $('aac-question-error').hidden = true;
        $('aac-question-answer').value = '';
        if (q.question) $('aac-question-select').value = q.question;
        $('aac-question-dialog').showModal();
    }

    async function submitQuestion(event) {
        event.preventDefault();
        const errEl = $('aac-question-error');
        errEl.hidden = true;
        const question = $('aac-question-select').value;
        const answer = $('aac-question-answer').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
        if (answer.length < 3) { errEl.textContent = 'La respuesta lleva al menos 3 caracteres.'; errEl.hidden = false; return; }
        const salt = Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
        const hash = await hashText(`${salt}:${answer}`);
        if (!hash) { errEl.textContent = 'Tu navegador no permite guardar la respuesta de forma segura.'; errEl.hidden = false; return; }
        try {
            await savePrefs('app_settings', { recovery: { ...recoverySettings(), security_question: { question, answer_hash: hash, salt, algorithm: 'sha256', updated_at: new Date().toISOString() } } });
            renderRecovery();
            $('aac-question-dialog').close();
            toast('Pregunta de seguridad guardada');
        } catch (err) {
            console.error('[account] pregunta de seguridad:', err);
            errEl.textContent = 'No pudimos guardar la pregunta. Probá de nuevo.';
            errEl.hidden = false;
        }
    }

    // ============================================
    // 7 · Verificación y documentos (801:573)
    // ============================================

    function docStatus(doc) {
        const status = String(doc?.status || '').toLowerCase();
        if (!doc) return 'missing';
        if (status.includes('verific') || status.includes('aprob')) return 'verified';
        if (status.includes('rechaz') || status.includes('deneg')) return 'rejected';
        return 'pending';
    }

    function identityDoc() {
        return verifDocs.find((d) => d.doc_type === 'identidad') || null;
    }

    function isVerified() {
        return artist?.verification_state === 'Yes' || docStatus(identityDoc()) === 'verified';
    }

    // Obligatorios sin cargar: un documento cuenta si existe y no fue rechazado.
    function missingRequiredDocs() {
        return DOC_TYPES.filter(([type, , required]) => {
            if (!required) return false;
            const status = docStatus(verifDocs.find((d) => d.doc_type === type) || null);
            return status === 'missing' || status === 'rejected';
        }).map(([, label]) => label.charAt(0).toLowerCase() + label.slice(1));
    }

    function renderVerification() {
        const state = artist.verification_state || 'No';
        const idDoc = identityDoc();
        const box = $('aac-verif-alert');
        let cls = '';
        let icon = 'check-circle';
        let title = 'Identidad verificada';
        let detail = idDoc?.reviewed_at ? `Confirmada el ${formatLongDate(idDoc.reviewed_at)}.` : 'Tu perfil muestra la insignia de verificado.';
        let action = '';

        if (!isVerified()) {
            if (['Requested', 'In Progress', 'In Analysis'].includes(state)) {
                cls = ' aac-verif-box--info'; icon = 'clock';
                title = 'Verificación en proceso';
                detail = 'Estamos revisando tu solicitud. Te avisamos por email cuando termine.';
            } else if (state === 'Denied' || docStatus(idDoc) === 'rejected') {
                cls = ' aac-verif-box--error'; icon = 'alert-circle';
                title = 'Verificación denegada';
                detail = 'Revisá tus documentos y volvé a solicitarla. El documento de identidad y el comprobante de domicilio son obligatorios; el certificado de bioseguridad es opcional.';
                action = '<button type="button" class="aac-btn aac-btn--outline aac-btn--s" id="aac-verif-request">Solicitar verificación</button>';
            } else {
                cls = ' aac-verif-box--warning'; icon = 'alert-circle';
                title = 'Todavía no verificaste tu identidad';
                detail = 'Subí tu documento de identidad y un comprobante de domicilio (obligatorios) y solicitá la verificación. El certificado de bioseguridad es opcional y suma confianza.';
                action = '<button type="button" class="aac-btn aac-btn--outline aac-btn--s" id="aac-verif-request">Solicitar verificación</button>';
            }
        }

        box.innerHTML = `<div class="aac-verif-box${cls}" role="status">
            <i data-wo-icon="${icon}" aria-hidden="true"></i>
            <div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div>
            ${action}
        </div>`;

        $('aac-verif-request')?.addEventListener('click', async () => {
            const missing = verifAvailable ? missingRequiredDocs() : [];
            if (missing.length) {
                toast(`Antes de solicitarla, subí tu ${missing.join(' y tu ')}.`, false);
                return;
            }
            try {
                await updateArtist({ verification_state: 'Requested' });
                renderVerification();
                toast('Solicitud de verificación enviada');
                assistRefresh('verificacion');
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
        renderVerification();
        renderDocs();
        window.AacWallet?.refreshStatus?.();
    }

    function docBadge(status) {
        if (status === 'verified') return '<span class="aac-chip-ok">Verificado</span>';
        if (status === 'rejected') return '<span class="aac-chip-error">Rechazado</span>';
        if (status === 'pending') return '<span class="aac-chip-warn">Pendiente</span>';
        return '<span class="aac-chip-muted">Sin cargar</span>';
    }

    function renderDocs() {
        const wrap = $('aac-docs');
        $('aac-docs-note').hidden = verifAvailable;

        wrap.innerHTML = DOC_TYPES.map(([type, label, required]) => {
            const doc = verifDocs.find((d) => d.doc_type === type) || null;
            const status = docStatus(doc);
            const nameTag = doc ? 'button' : 'span';
            const nameAttrs = doc ? ` type="button" data-doc-view="${esc(doc.id)}" title="Ver ${esc(doc.file_name || label)}"` : '';
            const actions = [];
            if (status !== 'verified') actions.push(`<button type="button" class="aac-doc-action" data-doc-upload="${type}" ${verifAvailable ? '' : 'disabled'}>${doc ? 'Reemplazar' : 'Subir'}</button>`);
            if (doc && status !== 'verified') actions.push(`<button type="button" class="aac-doc-action aac-doc-action--danger" data-doc-del="${esc(doc.id)}">Eliminar</button>`);
            return `
            <div class="aac-doc" data-assist="verificacion.${type}">
                <${nameTag} class="aac-doc-name"${nameAttrs}><i data-wo-icon="copy" aria-hidden="true"></i><span>${label}</span><span class="aac-doc-req${required ? ' is-required' : ''}">${required ? 'Obligatorio' : 'Opcional'}</span></${nameTag}>
                <div class="aac-doc-side">
                    ${actions.join('')}
                    ${docBadge(status)}
                    <input type="file" data-doc-input="${type}" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
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
                    renderVerification();
                    renderDocs();
                    toast(result?.previous
                        ? (cleanupComplete ? 'Documento reemplazado' : 'Documento reemplazado; limpieza anterior pendiente')
                        : 'Documento subido', cleanupComplete);
                    assistRefresh('verificacion');
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
                    renderVerification();
                    renderDocs();
                    toast(cleanupComplete ? 'Documento eliminado' : 'Documento eliminado; limpieza del archivo pendiente', cleanupComplete);
                    assistRefresh('verificacion');
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
    // 8 · Configuración y accesibilidad (801:574)
    // ============================================

    function setCountrySelect(value) {
        const sel = $('aac-setting-country');
        const list = COUNTRIES.includes(value) || !value ? COUNTRIES : [value, ...COUNTRIES];
        sel.innerHTML = '<option value="">Elegí un país</option>' + list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        sel.value = value || '';
    }

    async function setupSettings() {
        const cur = window.WeOtziCurrency;
        if (cur && typeof cur.init === 'function') await cur.init().catch(() => null);
        const catalog = cur && typeof cur.list === 'function' && cur.list().length
            ? cur.list()
            : [{ code: 'USD', symbol: '$' }, { code: 'EUR', symbol: '€' }, { code: 'ARS', symbol: '$' }];

        const currencySel = $('aac-currency');
        currencySel.innerHTML = '<option value="">Elegí una moneda</option>' + catalog.map((c) =>
            `<option value="${esc(c.code)}">${esc(c.code)}${c.symbol ? ` (${esc(c.symbol)})` : ''}</option>`
        ).join('');
        // Moneda efectiva: la elegida o, si no hay, la de la tarifa (la que usa el Wallet).
        currencySel.value = artist.preferred_display_currency || artist.session_price_currency || '';

        const detectedTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Argentina/Buenos_Aires';
        const tzList = TIMEZONES.includes(detectedTz) ? TIMEZONES : [detectedTz, ...TIMEZONES];
        const tzSel = $('aac-timezone');
        tzSel.innerHTML = tzList.map((tz) => `<option value="${esc(tz)}">${esc(tz.replace(/_/g, ' '))}</option>`).join('');

        let s = { ...DEFAULT_APP_SETTINGS, ...appSettings() };
        setCountrySelect(s.country || artist.country || '');
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
                toast('Moneda predeterminada guardada');
                assistRefresh('configuracion');
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
                assistRefresh('configuracion');
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

        // Lo que la página muestra es lo que mira el paso Configuración del modo
        // asistido: la zona horaria del select y, si nunca se eligió una moneda,
        // la que se ve (la de la tarifa). La moneda va en un UPDATE aparte para
        // que un error ahí no frene la región; saveSetting avisa al final.
        const saveRegion = async () => {
            const country = $('aac-setting-country').value.trim();
            const city = $('aac-setting-city').value.trim();
            try {
                await updateArtist({ country: country || null, city: city || null });
                if (!artist.preferred_display_currency && currencySel.value) {
                    await updateArtist({ preferred_display_currency: currencySel.value })
                        .catch((err) => console.warn('[account] moneda mostrada:', err));
                }
                await saveSetting({ country, city, timezone: tzSel.value });
                $('aac-country').value = country;
                $('aac-city').value = city;
            } catch (error) {
                console.error('[account] región:', error);
                toast('No pudimos guardar la región', false);
            }
        };
        $('aac-setting-country').addEventListener('change', saveRegion);
        $('aac-setting-city').addEventListener('input', debounce(saveRegion, 600));

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
